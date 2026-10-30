#!/bin/bash
# runall5.sh : phase 5 (§1h.477): P6 x5, P4 x1. The ceiling is 17 Google calls; a run starts only if its expected calls
# (P6 3, P4 2) still fit. Stops on a quota marker, on a stop reason, or on a run with no result.
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
declare -A PDFS=( [P4]=49c73586 [P6]=4b98c05d )
declare -A NEED=( [P4]=2 [P6]=3 )
CEIL=17
mkdir -p $R/out5
PLAN="P6:1 P6:2 P6:3 P6:4 P6:5 P4:1"
for item in $PLAN; do
  T=${item%%:*}; K=${item##*:}
  PDF=$(ls $U/${T}.pdf)
  OUTD=$R/out5/$T-run$K
  if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
  TOTAL=$(cat $R/out5/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
  echo "[runall5] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out5/runall.log
  if [ "$((TOTAL+${NEED[$T]}))" -gt "$CEIL" ]; then echo "[runall5] CEILING: stopping before $T run$K" >> $R/out5/runall.log; exit 0; fi
  LINE=$(DEEP=0 $H/runone5.sh $T "$PDF" $K 2>>$R/out5/runall.err | tail -1)
  echo "$LINE" >> $R/out5/summary.jsonl
  echo "[runall5] $LINE" >> $R/out5/runall.log
  if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall5] STOP reason in run" >> $R/out5/runall.log; exit 0; fi
  if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall5] QUOTA MARKER in $T run$K dev.log" >> $R/out5/runall.log; exit 0; fi
  if [ ! -s $OUTD/result.json ]; then echo "[runall5] no result.json for $T run$K: stopping to look" >> $R/out5/runall.log; exit 0; fi
done
echo "[runall5] DONE" >> $R/out5/runall.log
