#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
while pgrep -f "chain_res_r4.sh" > /dev/null; do sleep 20; done
./runq.sh jobs_fixtab.txt 1
echo "fixtab chain done $(date +%H:%M:%S)" >> ../logs/queue.log
