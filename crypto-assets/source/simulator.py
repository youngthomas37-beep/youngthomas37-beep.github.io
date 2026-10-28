"""Discrete-event educational network; Python 3.10+, standard library only."""
from __future__ import annotations
import argparse, csv, hashlib, heapq, json, math, random
from collections import Counter
from dataclasses import dataclass, asdict
from pathlib import Path

@dataclass(frozen=True)
class Tx:
    id: str
    coin: str
    recipient: str

@dataclass(frozen=True)
class Block:
    parent: str
    txs: tuple[Tx, ...]
    miner: int
    time: float
    nonce: int
    work: int = 1
    @property
    def id(self):
        return hashlib.sha256(json.dumps(asdict(self), sort_keys=True).encode()).hexdigest()

GENESIS = Block('', (), -1, 0, 0, 0)
G = GENESIS.id

class Node:
    def __init__(self, index):
        self.index = index
        self.blocks = {G: GENESIS}
        self.work = {G: 0}
        self.spent = {G: frozenset()}
        self.tip = G
        self.pending = {}
        self.transactions = {}
        self.pool = {}
        self.reorgs = []
        self.invalid = set()

    def path(self, tip=None):
        result = []
        tip = self.tip if tip is None else tip
        while tip != G:
            result.append(tip)
            tip = self.blocks[tip].parent
        return result

    def rebuild_pool(self):
        # Remember even conflicting transactions so detached transactions can return.
        occupied = set(self.spent[self.tip])
        self.pool = {}
        for tx in self.transactions.values():
            if tx.coin not in occupied:
                self.pool[tx.id] = tx
                occupied.add(tx.coin)

    def transaction(self, tx):
        if tx.coin.startswith('coin') and tx.coin[4:].isdigit() and 0 <= int(tx.coin[4:]) < 100000:
            self.transactions.setdefault(tx.id, tx)
            self.rebuild_pool()

    def receive(self, block, now):
        bid = block.id
        if bid in self.blocks or bid in self.invalid:
            return 'duplicate'
        if block.parent not in self.blocks:
            self.pending[bid] = block
            return 'orphan'
        used = set(self.spent[block.parent])
        valid = block.work == 1 and block.miner >= 0 and block.time >= self.blocks[block.parent].time
        for tx in block.txs:
            valid &= (tx.coin not in used and tx.coin.startswith('coin') and tx.coin[4:].isdigit()
                      and 0 <= int(tx.coin[4:]) < 100000)
            used.add(tx.coin)
        if not valid:
            self.invalid.add(bid)
            self.pending.pop(bid, None)
            return 'invalid'
        self.blocks[bid] = block
        self.work[bid] = self.work[block.parent] + block.work
        self.spent[bid] = frozenset(used)
        for tx in block.txs:
            self.transactions.setdefault(tx.id, tx)
        if self.work[bid] > self.work[self.tip]:
            if block.parent == self.tip:
                detached = []
            else:
                old_path, new_path = self.path(), set(self.path(bid))
                detached = [b for b in old_path if b not in new_path]
            if detached:
                self.reorgs.append({'time': now, 'node': self.index, 'depth': len(detached),
                                    'old': self.tip, 'new': bid})
            self.tip = bid
            self.rebuild_pool()
        self.pending.pop(bid, None)
        for child in list(self.pending.values()):
            if child.parent == bid:
                self.receive(child, now)
        return 'accepted'

@dataclass
class Config:
    nodes: int = 30
    duration: float = 18000
    interval: float = 60
    delay: float = 20
    delay_model: str = 'uniform'
    seed: int = 42
    tx_rate: float = .05
    conflict_probability: float = .25
    capacity: int = 50
    shares: tuple[float, ...] = ()
    def validate(self):
        if not 10 <= self.nodes <= 100: raise ValueError('nodes must be 10..100')
        if not all(math.isfinite(x) for x in (self.duration,self.interval,self.delay,self.tx_rate,self.conflict_probability)):
            raise ValueError('parameters must be finite')
        if self.duration <= 0 or self.interval <= 0 or self.delay < 0 or self.tx_rate < 0: raise ValueError('invalid time/rate')
        if self.capacity < 1 or not 0 <= self.conflict_probability <= 1: raise ValueError('invalid capacity/conflict probability')
        if self.delay_model not in ('uniform','exponential'): raise ValueError('unknown delay model')
        if self.shares and (len(self.shares) != self.nodes or any(not math.isfinite(x) or x < 0 for x in self.shares) or sum(self.shares) <= 0):
            raise ValueError('provide one nonnegative hash share per node with positive total')

class Simulation:
    def __init__(self, config):
        config.validate()
        self.c = config
        # Separate streams prevent message scheduling from changing mining arrivals.
        self.mining = random.Random(config.seed)
        self.network = random.Random(config.seed + 1)
        self.tx_rng = random.Random(config.seed + 2)
        self.nodes = [Node(i) for i in range(config.nodes)]
        weights = config.shares or (1,) * config.nodes
        self.shares = [x / sum(weights) for x in weights]
        self.queue, self.serial, self.now = [], 0, 0
        self.blocks, self.events, self.timeline = {}, [], []
        self.fork_blocks = 0
        self.children = Counter()
        self.diverged_at = None
        self.convergence = []

    def schedule(self, time, kind, node, payload=None):
        self.serial += 1
        heapq.heappush(self.queue, (time, self.serial, kind, node, payload))

    def broadcast(self, kind, origin, payload):
        for i in range(self.c.nodes):
            if i != origin:
                delay = (self.network.uniform(0, 2*self.c.delay) if self.c.delay_model == 'uniform'
                         else self.network.expovariate(1/self.c.delay) if self.c.delay else 0)
                self.schedule(self.now + delay, kind, i, payload)

    def observe(self):
        tips = Counter(n.tip for n in self.nodes)
        if len(tips) > 1 and self.diverged_at is None: self.diverged_at = self.now
        if len(tips) == 1 and self.diverged_at is not None:
            self.convergence.append(self.now - self.diverged_at)
            self.diverged_at = None
        self.timeline.append((self.now, len(tips), max(tips.values()) / self.c.nodes,
                              max(n.work[n.tip] for n in self.nodes)))

    def run(self):
        for i, share in enumerate(self.shares):
            if share: self.schedule(self.mining.expovariate(share/self.c.interval), 'mine', i)
        if self.c.tx_rate: self.schedule(self.tx_rng.expovariate(self.c.tx_rate), 'create', 0)
        tx_count = 0
        while self.queue:
            self.now, _, kind, i, payload = heapq.heappop(self.queue)
            node = self.nodes[i]
            if kind == 'mine':
                if self.now > self.c.duration: continue
                block = Block(node.tip, tuple(list(node.pool.values())[:self.c.capacity]), i, self.now, len(self.blocks)+1)
                self.blocks[block.id] = block
                if self.children[block.parent]: self.fork_blocks += 1
                self.children[block.parent] += 1
                node.receive(block, self.now)
                self.broadcast('block', i, block)
                self.events.append({'time':self.now,'event':'mined','node':i,'block':block.id,'parent':block.parent})
                self.schedule(self.now+self.mining.expovariate(self.shares[i]/self.c.interval), 'mine', i)
            elif kind == 'create':
                if self.now > self.c.duration: continue
                tx_count += 1
                coin = tx_count
                if tx_count > 1 and self.tx_rng.random() < self.c.conflict_probability:
                    coin = self.tx_rng.randrange(1, tx_count)
                tx = Tx(f'tx{tx_count}', f'coin{coin % 100000}', f'payee{tx_count}')
                i = self.tx_rng.randrange(self.c.nodes)
                self.nodes[i].transaction(tx)
                self.broadcast('tx', i, tx)
                self.schedule(self.now+self.tx_rng.expovariate(self.c.tx_rate), 'create', 0)
            elif kind == 'block':
                status = node.receive(payload, self.now)
                self.events.append({'time':self.now,'event':status,'node':i,'block':payload.id})
            else: node.transaction(payload)
            self.observe()
        return self.metrics()

    def metrics(self):
        tips = {n.tip for n in self.nodes}
        agreed = len(tips) == 1
        canonical = set(self.nodes[0].path()) if agreed else set()
        reorgs = [r for n in self.nodes for r in n.reorgs]
        return {'config':asdict(self.c),'hash_shares':self.shares,'mined_blocks':len(self.blocks),
                'fork_blocks':self.fork_blocks,'fork_rate':self.fork_blocks/max(1,len(self.blocks)),
                'stale_blocks':len(self.blocks)-len(canonical) if agreed else None,
                'stale_fraction':(len(self.blocks)-len(canonical))/max(1,len(self.blocks)) if agreed else None,
                'final_agreement':agreed,'final_height':len(canonical) if agreed else None,
                'reorg_count':len(reorgs),'max_reorg_depth':max((r['depth'] for r in reorgs),default=0),
                'reorg_depths':[r['depth'] for r in reorgs],
                'convergence_times_seconds':self.convergence,
                'mean_convergence_seconds':sum(self.convergence)/len(self.convergence) if self.convergence else None,
                'unresolved_divergence':self.diverged_at is not None,
                'drain_end_time':self.now,'blocks_by_miner':dict(Counter(b.miner for b in self.blocks.values()))}

    def save(self, directory):
        p = Path(directory); p.mkdir(parents=True,exist_ok=True)
        (p/'metrics.json').write_text(json.dumps(self.metrics(),indent=2),encoding='utf-8')
        with (p/'events.jsonl').open('w',encoding='utf-8') as f:
            for event in self.events: f.write(json.dumps(event)+'\n')
        with (p/'blocks.jsonl').open('w',encoding='utf-8') as f:
            for bid,b in self.blocks.items(): f.write(json.dumps({'id':bid,**asdict(b)})+'\n')
        with (p/'timeline.csv').open('w',newline='',encoding='utf-8') as f:
            w=csv.writer(f); w.writerow(['time','distinct_tips','largest_tip_share','max_height']); w.writerows(self.timeline)
        (p/'reorgs.json').write_text(json.dumps([r for n in self.nodes for r in n.reorgs],indent=2),encoding='utf-8')
        self.plot(p/'network.svg')

    def plot(self, path):
        # Dependency-free vector plot, thinning only the displayed data.
        data=self.timeline[::max(1,len(self.timeline)//2500)]
        if self.timeline: data.append(self.timeline[-1])
        end=max((x[0] for x in data),default=1) or 1
        lines=['<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="540" viewBox="0 0 1000 540">',
               '<rect width="1000" height="540" fill="#f8fafc"/>',
               '<g font-family="sans-serif" fill="#172554"><text x="60" y="32" font-size="22">Local views and agreement over time</text>']
        for panel,label,col,value,scale in [(0,'Distinct chain tips','#7c3aed',1,self.c.nodes),(1,'Largest identical-tip group (%)','#0284c7',2,1)]:
            top=65+panel*220
            lines.append(f'<text x="60" y="{top}">{label}</text>')
            for frac in [0,.5,1]:
                y=top+170-frac*145
                lines.append(f'<path d="M60 {y} H940" stroke="#cbd5e1"/><text x="10" y="{y+4}">{frac*scale if panel==0 else frac*100:g}</text>')
            pts=' '.join(f'{60+880*r[0]/end:.2f},{top+170-145*r[value]/scale:.2f}' for r in data)
            lines.append(f'<polyline points="{pts}" fill="none" stroke="{col}" stroke-width="1.3"/>')
        lines.append(f'<text x="60" y="520">0</text><text x="770" y="520">{end:.1f} simulated seconds</text></g></svg>')
        Path(path).write_text('\n'.join(lines),encoding='utf-8')

def main():
    p=argparse.ArgumentParser(description=__doc__)
    for name,typ,default in [('nodes',int,30),('duration',float,18000),('interval',float,60),('delay',float,20),('seed',int,42),('tx-rate',float,.05),('conflict-probability',float,.25),('capacity',int,50)]:
        p.add_argument('--'+name,type=typ,default=default)
    p.add_argument('--delay-model',choices=['uniform','exponential'],default='uniform')
    p.add_argument('--shares',help='comma-separated relative hash weights, one per node')
    p.add_argument('--output',default='results')
    a=vars(p.parse_args()); out=a.pop('output'); a['shares']=tuple(map(float,a['shares'].split(','))) if a['shares'] else ()
    sim=Simulation(Config(**a)); result=sim.run(); sim.save(out)
    print(json.dumps({k:v for k,v in result.items() if k not in ('config','reorg_depths','convergence_times_seconds','hash_shares','blocks_by_miner')},indent=2))

if __name__=='__main__': main()
