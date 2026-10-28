# Bitcoin-style discrete-event network simulator

Python 3.10+; no third-party dependencies. This is an educational executable model, not Bitcoin consensus software, a wallet, or a security proof.

## Run

From this folder:

```sh
python -m unittest -v
python simulator.py --nodes 30 --duration 18000 --interval 60 --delay 20 --seed 42 --output results/custom
python simulator.py --nodes 10 --shares 40,20,10,10,5,5,5,3,2,0 --delay-model exponential --delay 15
python experiments.py
```

`--delay` is mean one-way message delay in simulated seconds. Uniform draws span [0, 2*delay]; exponential draws have that mean and unbounded support. Zero is instantaneous. `--interval` is the expected network mining interval before stale blocks, not the accepted-chain interval. Duration and all times use seconds. Hash weights are normalized; zero means a validating, non-mining node. Defaults: 30 equal miners, 18,000 seconds, interval 60, mean delay 20, seed 42, transaction rate .05/s, conflict probability .25, capacity 50 transactions/block. CLI flags expose each value.

## Grounding in the uploaded paper

Source: Satoshi Nakamoto, *Bitcoin: A Peer-to-Peer Electronic Cash System*, uploaded PDF, Sections 3–5 (pages 2–4). Public reference: https://bitcoin.org/bitcoin.pdf . The uploaded text was read directly.

* Section 3: each block identifier is SHA-256 over its contents, including the parent identifier. This commits the simulated chain to previous blocks and transactions. It does not establish trustworthy wall-clock time.
* Section 4: miner i has an independent exponential waiting time with rate `share[i]/interval`. Their superposition is a Poisson process. Accepted block work is fixed at one unit, accumulated from the parent. The node selects strictly greater cumulative work; at fixed difficulty this is also the longest valid chain. A block cannot claim arbitrary work: local validation rejects work other than one. Mining arrivals are a trusted simulator abstraction, not verified hash puzzles.
* Section 5: transactions and blocks arrive separately at each node after random delays. Nodes mine on their own tip, accept only locally valid branches, retain competing branches and keep the first seen tip on equal work. More cumulative work triggers a switch, even if transactions from the former branch must be undone. Missing-parent blocks wait until the parent arrives. Out-of-order delivery therefore works without reading another node's state.

## Local state, transactions and reorganization

Each node has its own block index, cumulative work, branch-specific spent-coin state, remembered transactions, first-seen mempool and orphan buffer. The event engine orders deliveries; it never chooses a shared winning tip. Miners' clocks continue across tip changes: exponential memorylessness makes this equivalent to restarting their search on the new tip under constant hash power. A discovered block uses the miner's current tip and current candidate transactions.

Transactions spend one pre-funded genesis coin (`coin0` through `coin99999`) to a named recipient; outputs cannot subsequently be spent. The generator deliberately announces alternative spends of existing coin identifiers. Nodes retain alternatives but place only the first eligible spend per coin in their mempool. Validation rejects repeated spends within a block or its ancestry, including high-work-looking invalid blocks. A transaction may validly appear on competing branches. On a reorg the node uses the new branch's spent set and rebuilds its mempool from all remembered transactions: detached spends return only when compatible with the winning history. Ordering is local arrival order, not a global transaction order.

## Explicit simplifications

No actual nonce search, target verification, difficulty adjustment, signatures, script, full UTXO accounting, Merkle trees, rewards, fees, coinbase maturity, timestamps rules, block weight or Bitcoin wire protocol. SHA-256 identifiers are commitments only. Fixed unit work intentionally avoids inventing a variable-difficulty consensus rule. No adversarial withholding, partitions, churn, bandwidth queues or dropped messages. Fully connected reliable direct broadcast uses independent delays per destination and message; nodes do not relay. Unknown parents eventually arrive because all mined blocks were broadcast; no explicit request protocol is modeled. Independent local state does not imply independent failures. All nodes honestly validate the toy rules. No claim about majority-attack probabilities follows from this model.

Transactions and mining stop at duration; already queued deliveries drain to completion. Equal-work competing terminal tips can remain different after draining if no later block breaks the tie: final agreement is measured, never forced. A finite simulation cannot demonstrate permanent finality. Very large rates/durations consume memory because histories and logs are retained.

## Metrics and files

* `fork_rate`: number of mined blocks whose parent already had a mined child, divided by total mined blocks. This global observer metric counts additional siblings, not every block implicated in a fork.
* `stale_blocks` / `stale_fraction`: mined blocks outside the final common chain, reported only if all nodes agree after drain; otherwise null. Orphans awaiting a parent are a different concept.
* `reorg_count`: node-local switches detaching at least one accepted block; ordinary extensions are excluded. `depth` counts detached blocks to the common ancestor; the same network fork can cause many node reorgs.
* `convergence_times_seconds`: durations of episodes with more than one distinct exact tip, ending when every node again has the same tip. This includes routine propagation, not only competing forks. Overlapping propagation merges episodes. Unresolved episodes are censored and flagged rather than counted as completed. Mean is null if no episode completes.
* `timeline.csv`: event-time distinct tips, largest identical-tip fraction and maximum local height. Duplicate timestamps are possible; SVG thins points for display only.
* `events.jsonl`: mining and block receipt outcomes; `blocks.jsonl`: all mined blocks and transactions; `reorgs.json`: every node's detach depth, old/new tips and time; `metrics.json`: full configuration, shares, seeds and metrics; `network.svg`: two-panel timeline plot.

Identical configuration, seed, Python implementation and code reproduce event ordering and outputs; integer event serials break time ties deterministically. Mining, network and transaction RNG streams are separate. JSON numeric miner keys become strings when serialized.

## Verification and sample results

`test_simulator.py` covers ties, single/deep reorgs, transaction restoration and conflicts, invalid double spends, invalid claimed work, orphan recovery, determinism, 10/100-node boundaries, zero-delay agreement, configuration errors, and statistical Poisson counts/hash-share allocation. The 10,000-block statistical test uses a fixed seed and broad bounds; it is a sanity check rather than a proof.

`experiments.py` runs 27 seeded scenarios and writes `results/REPORT.md` plus the comparison CSV. The complete 30-node, mean-delay-20, seed-42 demo includes logs and plot. `TEST_RESULTS.txt` records the delivered test execution.
