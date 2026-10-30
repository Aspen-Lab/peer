#!/bin/bash
# runall.sh : P1..P6 x 5 runs (skips a run whose result.json exists), stops on a quota marker or at the call ceiling.
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
declare -A PDFS=( [P1]=0a323712 [P2]=a01ce493 [P3]=b06bdbbf [P4]=49c73586 [P5]=918eb623 [P6]=4b98c05d )
CEIL=${CEIL:-140}       # internal stop; phase 1 spent 6 calls, the brief's ceiling is 150 in all
NEED=${NEED:-6}         # headroom a run may need (report 1 + review 1 + looks 3 + 1)
for T in P1 P2 P3 P4 P5 P6; do
  PDF=$(ls $U/${T}.pdf)
  for K in 1 2 3 4 5; do
    OUTD=$R/out2/$T-run$K
    if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
    TOTAL=$(cat $R/out2/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
    echo "[runall] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out2/runall.log
    if [ "$TOTAL" -ge "$((CEIL-NEED+1))" ] && [ "${BLOCK_REPORT:-0}" != 1 ]; then echo "[runall] headroom low: switching to BLOCK_REPORT=1" >> $R/out2/runall.log; export BLOCK_REPORT=1; fi
    if [ "$TOTAL" -ge "$((CEIL-NEED+1))" ] && [ "${BLOCK_REPORT:-0}" = 1 ] && [ "$TOTAL" -ge "$((CEIL-4))" ]; then echo "[runall] CEILING: stopping before $T run$K" >> $R/out2/runall.log; exit 0; fi
    LINE=$(DEEP=0 $H/runone.sh $T "$PDF" $K 2>>$R/out2/runall.err | tail -1)
    echo "$LINE" >> $R/out2/summary.jsonl
    echo "[runall] $LINE" >> $R/out2/runall.log
    if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall] STOP reason in run" >> $R/out2/runall.log; exit 0; fi
    if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall] QUOTA MARKER in $T run$K dev.log" >> $R/out2/runall.log; exit 0; fi
  done
done
echo "[runall] DONE" >> $R/out2/runall.log
