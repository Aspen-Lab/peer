#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
echo "chain start $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_r3a.txt 3
echo "chain: a done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_r3b.txt 3
echo "chain: b done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_r3c.txt 2
echo "chain: c done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_r3d.txt 2
echo "chain: d done $(date +%H:%M:%S)" >> ../logs/queue.log
