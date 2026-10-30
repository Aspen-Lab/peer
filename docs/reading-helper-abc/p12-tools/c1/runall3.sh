#!/bin/bash
# runall3.sh : phase 3 (§1h.468): P6 x5, P4 x3, P3 x3. Stops on a quota marker or before the call ceiling (66; a run needs at most 5).
R=__P12_SCRATCH__/p12/a57
H=$R/harness
U=__P12_PDF_DIR__
declare -A PDFS=( [P3]=b06bdbbf [P4]=49c73586 [P6]=4b98c05d )
CEIL=66
mkdir -p $R/out3
PLAN="P6:1 P6:2 P6:3 P6:4 P6:5 P4:1 P4:2 P4:3 P3:1 P3:2 P3:3"
for item in $PLAN; do
  T=${item%%:*}; K=${item##*:}
  PDF=$(ls $U/${T}.pdf)
  OUTD=$R/out3/$T-run$K
  if [ -s $OUTD/result.json ] && [ -s $OUTD/llm.json ]; then continue; fi
  TOTAL=$(cat $R/out3/*/llm.json 2>/dev/null | node -e 'let n=0;for(const l of require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean)){n+=JSON.parse(l).calls}console.log(n)')
  echo "[runall3] $(date -u +%H:%M:%SZ) before $T run$K: Google calls so far $TOTAL" >> $R/out3/runall.log
  if [ "$TOTAL" -gt "$((CEIL-5))" ]; then echo "[runall3] CEILING: stopping before $T run$K" >> $R/out3/runall.log; exit 0; fi
  LINE=$(DEEP=0 $H/runone3.sh $T "$PDF" $K 2>>$R/out3/runall.err | tail -1)
  echo "$LINE" >> $R/out3/summary.jsonl
  echo "[runall3] $LINE" >> $R/out3/runall.log
  if echo "$LINE" | grep -qE '"stop":"[^"]'; then echo "[runall3] STOP reason in run" >> $R/out3/runall.log; exit 0; fi
  if cat $OUTD/llm.json | node -e 'const l=JSON.parse(require("fs").readFileSync(0,"utf8"));const m=l.markers;process.exit((m["429"]+m.RESOURCE_EXHAUSTED+m.PERMISSION_DENIED+m.quota+m.billing)>0?0:1)'; then echo "[runall3] QUOTA MARKER in $T run$K dev.log" >> $R/out3/runall.log; exit 0; fi
  if [ ! -s $OUTD/result.json ]; then echo "[runall3] no result.json for $T run$K: stopping to look" >> $R/out3/runall.log; exit 0; fi
done
echo "[runall3] DONE" >> $R/out3/runall.log
