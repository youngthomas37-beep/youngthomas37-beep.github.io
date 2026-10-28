"""Reproduce sample runs, repeated-seed comparison and report."""
import csv, json
from pathlib import Path
from simulator import Config, Simulation

def main():
    root=Path('results'); root.mkdir(exist_ok=True)
    rows=[]
    for nodes in (10,30,100):
        for delay in (0,2,20):
            for seed in (7,42,2026):
                s=Simulation(Config(nodes=nodes,delay=delay,seed=seed,duration=12000))
                m=s.run()
                rows.append({k:m[k] for k in ('mined_blocks','fork_rate','stale_blocks','stale_fraction','mean_convergence_seconds','reorg_count','max_reorg_depth','final_agreement')} | {'nodes':nodes,'delay':delay,'seed':seed})
                if nodes==30 and delay==20 and seed==42: s.save(root/'demo')
    with (root/'comparison.csv').open('w',newline='') as f:
        w=csv.DictWriter(f,fieldnames=list(rows[0])); w.writeheader(); w.writerows(rows)
    report=['# Verified experiment results','', '27 runs: 10/30/100 nodes, mean delays 0/2/20 seconds, seeds 7/42/2026.',
            'Each run mines for 12,000 simulated seconds at a 60-second expected network block interval, then drains messages.',
            'These accelerated educational scenarios are not estimates for the live Bitcoin network.','',
            '|Nodes|Mean delay (s)|Mean stale fraction (agreed runs)|Agreed runs|Mean fork rate|Max reorg depth|',
            '|---:|---:|---:|---:|---:|---:|']
    for n in (10,30,100):
        for d in (0,2,20):
            group=[r for r in rows if r['nodes']==n and r['delay']==d]
            known=[r['stale_fraction'] for r in group if r['stale_fraction'] is not None]
            stale=f'{sum(known)/len(known):.3f}' if known else 'N/A'
            report.append(f"|{n}|{d}|{stale}|{len(known)}/3|{sum(r['fork_rate'] for r in group)/3:.3f}|{max(r['max_reorg_depth'] for r in group)}|")
    report += ['',f"All runs reached identical final tips after draining: {all(r['final_agreement'] for r in rows)}.",
               'Three seeds illustrate variability; this is not a confidence-interval study.',
               'See comparison.csv for individual runs; demo/ contains full block/message logs, reorgs, timeline and plot.']
    (root/'REPORT.md').write_text('\n'.join(report),encoding='utf-8')
    print('\n'.join(report))

if __name__=='__main__': main()
