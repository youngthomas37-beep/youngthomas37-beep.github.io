# Verified experiment results

27 runs: 10/30/100 nodes, mean delays 0/2/20 seconds, seeds 7/42/2026.
Each run mines for 12,000 simulated seconds at a 60-second expected network block interval, then drains messages.
These accelerated educational scenarios are not estimates for the live Bitcoin network.

|Nodes|Mean delay (s)|Mean stale fraction (agreed runs)|Agreed runs|Mean fork rate|Max reorg depth|
|---:|---:|---:|---:|---:|---:|
|10|0|0.000|3/3|0.000|0|
|10|2|0.035|3/3|0.035|1|
|10|20|0.235|2/3|0.211|2|
|30|0|0.000|3/3|0.000|0|
|30|2|0.026|3/3|0.026|1|
|30|20|0.238|3/3|0.214|3|
|100|0|0.000|3/3|0.000|0|
|100|2|0.027|3/3|0.027|1|
|100|20|0.235|2/3|0.212|3|

All runs reached identical final tips after draining: False.
Three seeds illustrate variability; this is not a confidence-interval study.
See comparison.csv for individual runs; demo/ contains full block/message logs, reorgs, timeline and plot.