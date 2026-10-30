#!/bin/bash
# usage: dump-all.sh <tag>  -> mgr/out/P*-<tag>.json from V, then C0 scores
S=__P12_SCRATCH__/p12; U=__P12_PDF_DIR__
cd __P12_SCRATCH__/p504/wt/web || exit 1
for p in P1:0a323712 P2:a01ce493 P3:b06bdbbf P4:49c73586 P5:918eb623 P6:4b98c05d; do
  n=${p%%:*}; f=$(ls $U/${p%%:*}.pdf)
  MGR_PDF="$f" MGR_OUT=$S/mgr/out/$n-$1.json env -u PEER_TEST_GEMINI_API_KEY npx vitest run --maxWorkers=2 --config $S/mgr/tools/vitest.vf.config.mjs 2>&1 | grep -E "FAIL|Error|failed" | head -3
done
cd $S/mgr
for n in P1 P2 P3; do echo "$n $(python3 score-c.py truth-P1-P3.json $n out/$n-$1.json | grep -E "strict|FAIL" | tr "\n" " ")"; done
for n in P4 P5 P6; do echo "$n $(python3 score-c.py truth-P4-P6.sealed.json $n out/$n-$1.json | grep -E "strict|FAIL" | tr "\n" " ")"; done
echo done
