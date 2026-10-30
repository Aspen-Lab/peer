#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
echo "resume chain start $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_res_a.txt 3
echo "resume chain: a done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_res_b.txt 3
echo "resume chain: b done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_res_c.txt 2
echo "resume chain: c done $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_res_d.txt 2
echo "resume chain: d done $(date +%H:%M:%S)" >> ../logs/queue.log
