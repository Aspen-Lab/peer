#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
while pgrep -f "runq.sh jobs_r4.txt" > /dev/null; do sleep 20; done
./runq.sh jobs_r4b.txt 1
echo "chain r4b done $(date +%H:%M:%S)" >> ../logs/queue.log
