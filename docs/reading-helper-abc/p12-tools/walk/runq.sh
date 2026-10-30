#!/bin/bash
# usage: runq.sh jobsfile concurrency  (each job retried once when it fails; pauses while available memory < 1500 MB)
cd __P12_SCRATCH__/p12/r2/a92/tools
cat "$1" | xargs -P "$2" -I{} bash -c '
for w in $(seq 1 120); do a=$(free -m | awk "/^Mem:/{print \$7}"); [ "$a" -gt 1500 ] && break; echo "mem low ($a MB), waiting" >> ../logs/queue.log; sleep 30; done
name=$(echo "{}" | tr " ." "__"); for try in 1 2; do timeout 5400 node {} > ../logs/$name.try$try.log 2>&1; rc=$?; echo "done {} try=$try rc=$rc $(date +%H:%M:%S) load=$(cut -d" " -f1 /proc/loadavg)" >> ../logs/queue.log; [ $rc -eq 0 ] && break; sleep 15; done'
