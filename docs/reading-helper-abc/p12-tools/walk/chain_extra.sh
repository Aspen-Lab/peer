#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
while pgrep -f "chain_fixtab.sh" > /dev/null; do sleep 20; done
./runq.sh jobs_extra.txt 1
echo "extra chain done $(date +%H:%M:%S)" >> ../logs/queue.log
