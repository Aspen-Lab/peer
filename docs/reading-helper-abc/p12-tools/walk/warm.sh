#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
node e1.cjs P1 W1 > ../logs/warm.log 2>&1
node cell_fig.cjs P1 W4 2 three >> ../logs/warm.log 2>&1
echo "warm done $(date +%H:%M:%S)" >> ../logs/queue.log
(setsid ./chain_res.sh > ../logs/chain_res.out 2>&1 &)
(setsid ./chain_res_r4.sh > ../logs/chain_res_r4.out 2>&1 &)
