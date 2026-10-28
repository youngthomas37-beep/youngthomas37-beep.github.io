import math
import unittest
from simulator import Block, Config, G, Node, Simulation, Tx

class ConsensusTests(unittest.TestCase):
    def block(self, parent=G, txs=(), nonce=1, time=1, work=1):
        return Block(parent,txs,0,time,nonce,work)

    def test_tie_and_reorg_restore_pool(self):
        n=Node(0); tx=Tx('a','coin1','alice'); n.transaction(tx)
        a=self.block(txs=(tx,)); b=self.block(nonce=2)
        n.receive(a,1); n.receive(b,2)
        self.assertEqual(n.tip,a.id)  # first seen on equal work
        c=self.block(b.id,nonce=3,time=3); n.receive(c,3)
        self.assertEqual(n.tip,c.id); self.assertEqual(n.reorgs[0]['depth'],1)
        self.assertIn(tx.id,n.pool)

    def test_conflict_reorg_removes_loser(self):
        n=Node(0); x=Tx('a','coin1','a'); y=Tx('b','coin1','b')
        n.transaction(x); n.transaction(y)
        a=self.block(txs=(x,)); b=self.block(txs=(y,),nonce=2)
        n.receive(a,1); n.receive(b,2); n.receive(self.block(b.id,nonce=3,time=3),3)
        self.assertEqual(n.spent[n.tip],frozenset({'coin1'})); self.assertFalse(n.pool)

    def test_invalid_chain_never_wins(self):
        n=Node(0); x=Tx('a','coin1','a'); y=Tx('b','coin1','b')
        a=self.block(txs=(x,)); n.receive(a,1)
        bad=self.block(a.id,(y,),2,2); self.assertEqual(n.receive(bad,2),'invalid')
        self.assertEqual(n.tip,a.id)
        self.assertEqual(n.receive(self.block(txs=(x,y),nonce=4),3),'invalid')
        self.assertEqual(n.receive(self.block(work=100,nonce=5),3),'invalid')

    def test_orphan_recovers(self):
        n=Node(0); a=self.block(); b=self.block(a.id,nonce=2,time=2)
        self.assertEqual(n.receive(b,2),'orphan'); n.receive(a,3)
        self.assertEqual(n.tip,b.id); self.assertFalse(n.pending)

    def test_deep_reorg(self):
        n=Node(0); a=self.block(); n.receive(a,1)
        a2=self.block(a.id,nonce=2,time=2); n.receive(a2,2)
        parent=G
        for j in range(3):
            b=self.block(parent,nonce=10+j,time=3+j); n.receive(b,3+j); parent=b.id
        self.assertEqual(n.reorgs[-1]['depth'],2)

    def test_reproducible(self):
        c=Config(duration=1500,interval=10,delay=8,seed=7)
        a=Simulation(c); b=Simulation(c)
        self.assertEqual(a.run(),b.run()); self.assertEqual(a.events,b.events)
        self.assertGreater(a.fork_blocks,0)
        if not a.metrics()['final_agreement']:
            self.assertIsNone(a.metrics()['stale_blocks'])
            self.assertTrue(a.metrics()['unresolved_divergence'])

    def test_zero_delay_and_boundaries(self):
        for count in [10,100]:
            s=Simulation(Config(nodes=count,duration=1000,interval=10,delay=0))
            r=s.run(); self.assertEqual(r['stale_blocks'],0); self.assertTrue(r['final_agreement'])
            self.assertFalse(r['reorg_depths'])

    def test_poisson_and_hash_shares(self):
        s=Simulation(Config(nodes=10,duration=100000,interval=10,delay=0,tx_rate=0,shares=(3,1,0,0,0,0,0,0,0,0)))
        r=s.run(); count=r['mined_blocks']; expected=10000
        self.assertLess(abs(count-expected),5*math.sqrt(expected))
        self.assertLess(abs(r['blocks_by_miner'][0]/count-.75),.03)
        self.assertEqual(set(r['blocks_by_miner']),{0,1})

    def test_config_validation(self):
        for cfg in [Config(nodes=9),Config(nodes=101),Config(delay=-1),Config(shares=(1,)),Config(interval=0),Config(delay=float('nan'))]:
            with self.assertRaises(ValueError): cfg.validate()

if __name__=='__main__': unittest.main(verbosity=2)
