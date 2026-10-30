#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
./runq.sh jobs_early_c.txt 2
echo "early c done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_early_d.txt 1
echo "early d done $(date +%H:%M:%S)" >> ../logs/queue.log
