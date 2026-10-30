#!/bin/bash
# runall8.sh : phase 8 (§1h.485): P5 x 5 on one head. The 47 calls left of 280 are the ceiling; a run takes at most 4,
# so none starts above 43. out8/summary.jsonl is appended after every run (a container restart loses nothing finished).
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
CEIL=47
NEED=4
T=P5
PDF=$(ls $U/P5.pdf)
mkdir -p $R/out8
for K in 1 2 3 4 5; do
  OUTD=$R/out8/$T-run$K
  if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
  TOTAL=$(cat $R/out8/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
  echo "[runall8] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out8/runall.log
  if [ "$((TOTAL+NEED))" -gt "$CEIL" ]; then echo "[runall8] CEILING: stopping before $T run$K" >> $R/out8/runall.log; exit 0; fi
  LINE=$(DEEP=0 $H/runone8.sh $T "$PDF" $K 2>>$R/out8/runall.err | tail -1)
  echo "$LINE" >> $R/out8/summary.jsonl
  echo "[runall8] $LINE" >> $R/out8/runall.log
  if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall8] STOP reason in run" >> $R/out8/runall.log; exit 0; fi
  if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall8] QUOTA MARKER in $T run$K dev.log" >> $R/out8/runall.log; exit 0; fi
  if [ ! -s $OUTD/result.json ]; then echo "[runall8] no result.json for $T run$K: stopping to look" >> $R/out8/runall.log; exit 0; fi
done
echo "[runall8] DONE" >> $R/out8/runall.log
