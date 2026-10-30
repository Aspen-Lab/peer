#!/bin/bash
cd __P12_SCRATCH__/p12/r2/a92/tools
while pgrep -f "runq5.sh jobs_main.txt" > /dev/null; do sleep 30; done
./runq5.sh jobs_main2.txt 2
