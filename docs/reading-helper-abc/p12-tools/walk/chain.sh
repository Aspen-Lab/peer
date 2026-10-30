#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
# start C when A has finished (B keeps running), D when B has finished
while pgrep -f "runq.sh jobs_A.txt" > /dev/null; do sleep 20; done
echo "chain: A done, starting C $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_C.txt 2
echo "chain: C done $(date +%H:%M:%S)" >> ../logs/queue.log
while pgrep -f "runq.sh jobs_B.txt" > /dev/null; do sleep 20; done
echo "chain: B done, starting D $(date +%H:%M:%S)" >> ../logs/queue.log
./runq.sh jobs_D.txt 2
echo "chain: D done $(date +%H:%M:%S)" >> ../logs/queue.log
