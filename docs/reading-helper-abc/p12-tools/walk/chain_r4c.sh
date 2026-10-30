#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
while pgrep -f "runq.sh jobs_r4b.txt" > /dev/null || pgrep -f "chain_r4b.sh" > /dev/null; do sleep 20; done
./runq.sh jobs_r4c.txt 1
node capfidelity.cjs > ../logs/capfidelity.log 2>&1
echo "chain r4c done $(date +%H:%M:%S)" >> ../logs/queue.log
