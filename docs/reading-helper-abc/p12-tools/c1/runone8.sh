#!/bin/bash
# runone8.sh <TAG> <pdf> <k> : one independent run — fresh uploads dir, fresh server, fresh browser context.
set -u
TAG=$1; PDF=$2; K=$3
R=__P12_SCRATCH__/p12/a57
WT=$R/wt8
H=$R/harness
OUTD=$R/out8/$TAG-run$K
SEALED=__P12_SCRATCH__/p12/mgr/sealed-c1
mkdir -p $OUTD
# memory guard (pause under 1 GB available)
while [ "$(free -m | awk '/Mem:/{print $7}')" -lt 1024 ]; do echo "[mem] waiting" >&2; sleep 20; done
# the port must be free
if (echo > /dev/tcp/127.0.0.1/4244) 2>/dev/null; then echo "port 4244 busy" >&2; exit 3; fi
rm -rf $R/uploads
cd $WT/web
env -u PEER_TEST_GEMINI_API_KEY PEER_PRIVATE_UPLOAD_DIR=$R/uploads setsid npx next dev -p 4244 > $OUTD/dev.log 2>&1 &
SP=$!
echo $SP > $OUTD/server.pid
READY=0
for i in $(seq 1 300); do
  if grep -aq "Ready" $OUTD/dev.log; then READY=1; break; fi
  if ! kill -0 $SP 2>/dev/null; then break; fi
  sleep 1
done
if [ $READY = 0 ]; then echo "server not ready" >&2; fi
# the server's process group: from the listener on 4244 (setsid may fork, so $SP is not the group)
LP=$(pgrep -f "/p12/a57/wt8/web/node_modules/.bin/next dev" | head -1)
SPG=""
if [ -n "$LP" ]; then SPG=$(ps -o pgid= -p $LP | tr -d ' '); fi
if [ -n "$SPG" ] && ! readlink /proc/$SPG/cwd 2>/dev/null | grep -q "/p12/a57/wt8/web"; then echo "group $SPG is not mine" >&2; SPG=""; fi
echo "${SPG:-none}" > $OUTD/server.pgid
START=$(date +%s)
if [ $READY = 1 ]; then
  cd $H
  PORT=4244 PEER_TEST_PDF="$PDF" OUT_DIR=$OUTD TAG=$TAG RUN=$K DEEP=${DEEP:-0} BLOCK_REPORT=${BLOCK_REPORT:-0} SEALED_DIR=$SEALED node keyed8.mjs > $OUTD/harness.log 2>&1
  echo "harness exit $?" >> $OUTD/harness.log
fi
END=$(date +%s)
echo $((END-START)) > $OUTD/harness-seconds.txt
sleep 2
node $H/llmcount.mjs $OUTD/dev.log > $OUTD/llm.json; node $H/structlog4.mjs $OUTD/dev.log > $OUTD/structlog.json
# stop only my server, by its process group
if [ -n "$SPG" ]; then kill -TERM -- -$SPG 2>/dev/null; sleep 3; kill -KILL -- -$SPG 2>/dev/null; else kill -TERM $SP 2>/dev/null; fi
sleep 1
if (echo > /dev/tcp/127.0.0.1/4244) 2>/dev/null; then echo "WARNING: 4244 still answers" >&2; fi
rm -rf $R/uploads
node -e 'const l=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));const r=(()=>{try{return JSON.parse(require("fs").readFileSync(process.argv[2],"utf8"))}catch{return {}}})();const s=r.structure||{};console.log(JSON.stringify({tag:process.argv[3],run:process.argv[4],calls:l.calls,ok:l.ok,err:l.err,in:l.tokensIn,out:l.tokensOut,think:l.tokensThink,status:s.status,fellBack:s.fellBack,corr:s.corrections,looks:s.secondLooks,structReq:r.structureRequests,rows:r.map&&r.map.rowsAfter,changed:r.map&&r.map.rowsChangedByReview,wallMs:r.wallTotalMs,applyMs:r.timing&&r.timing.structureAnsweredMs,markers:l.markers,stop:r.stopReason,error:r.error}))' $OUTD/llm.json $OUTD/result.json $TAG $K
