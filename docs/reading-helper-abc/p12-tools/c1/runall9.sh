#!/bin/bash
# runall9.sh : phase 9 (§1h.491): P3, P4, P5, P6 x 2 each on one head. The ceiling is the 37 calls left of 280; a run takes at
# most 4, so none starts above 33. out9/summary.jsonl is appended after every run (a container restart loses nothing finished).
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
declare -A PDFS=( [P3]=b06bdbbf [P4]=49c73586 [P5]=918eb623 [P6]=4b98c05d )
CEIL=37
NEED=4
mkdir -p $R/out9
for T in P3 P4 P5 P6; do
  PDF=$(ls $U/${T}.pdf)
  for K in 1 2; do
    OUTD=$R/out9/$T-run$K
    if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
    TOTAL=$(cat $R/out9/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
    echo "[runall9] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out9/runall.log
    if [ "$((TOTAL+NEED))" -gt "$CEIL" ]; then echo "[runall9] CEILING: stopping before $T run$K" >> $R/out9/runall.log; exit 0; fi
    LINE=$(DEEP=0 $H/runone9.sh $T "$PDF" $K 2>>$R/out9/runall.err | tail -1)
    echo "$LINE" >> $R/out9/summary.jsonl
    echo "[runall9] $LINE" >> $R/out9/runall.log
    if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall9] STOP reason in run" >> $R/out9/runall.log; exit 0; fi
    if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall9] QUOTA MARKER in $T run$K dev.log" >> $R/out9/runall.log; exit 0; fi
    if [ ! -s $OUTD/result.json ]; then echo "[runall9] no result.json for $T run$K: stopping to look" >> $R/out9/runall.log; exit 0; fi
  done
done
echo "[runall9] DONE" >> $R/out9/runall.log
