#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
./runq.sh jobs_res_r4.txt 1
node capfidelity.cjs > ../logs/capfidelity.log 2>&1
echo "resume r4 chain done $(date +%H:%M:%S)" >> ../logs/queue.log
