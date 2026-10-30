#!/bin/bash
# runall6.sh : phase 6 (§1h.481): P1..P6 x 5 on one head. The ceiling for this phase is 97 Google calls (245 in all); a run
# takes at most 4 here (phase 2's most), so none starts above 93. Stops on a quota marker, a stop reason, or a run with no result.
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
declare -A PDFS=( [P1]=0a323712 [P2]=a01ce493 [P3]=b06bdbbf [P4]=49c73586 [P5]=918eb623 [P6]=4b98c05d )
CEIL=97
NEED=4
mkdir -p $R/out6
for T in P1 P2 P3 P4 P5 P6; do
  PDF=$(ls $U/${T}.pdf)
  for K in 1 2 3 4 5; do
    OUTD=$R/out6/$T-run$K
    if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
    TOTAL=$(cat $R/out6/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
    echo "[runall6] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out6/runall.log
    if [ "$((TOTAL+NEED))" -gt "$CEIL" ]; then echo "[runall6] CEILING: stopping before $T run$K" >> $R/out6/runall.log; exit 0; fi
    LINE=$(DEEP=0 $H/runone6.sh $T "$PDF" $K 2>>$R/out6/runall.err | tail -1)
    echo "$LINE" >> $R/out6/summary.jsonl
    echo "[runall6] $LINE" >> $R/out6/runall.log
    if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall6] STOP reason in run" >> $R/out6/runall.log; exit 0; fi
    if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall6] QUOTA MARKER in $T run$K dev.log" >> $R/out6/runall.log; exit 0; fi
    if [ ! -s $OUTD/result.json ]; then echo "[runall6] no result.json for $T run$K: stopping to look" >> $R/out6/runall.log; exit 0; fi
  done
done
echo "[runall6] DONE" >> $R/out6/runall.log
