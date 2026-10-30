#!/bin/bash
# full gates on the final combination V; key unset, no dev server
cd __P12_SCRATCH__/p504/wt/web || exit 1
LOG=__P12_SCRATCH__/p12/mgr/gates-V.log
echo "== $(git log --oneline -1)" > $LOG
env -u PEER_TEST_GEMINI_API_KEY npm run lint 2>&1 | grep -E "problems|error " | tail -3 >> $LOG
env -u PEER_TEST_GEMINI_API_KEY TZ=America/Chicago npx vitest run --maxWorkers=2 > ${LOG%.log}.test.out 2>&1
grep -E "FAIL|Test Files|Tests " ${LOG%.log}.test.out | grep -v "^ *✓" | head -40 >> $LOG
env -u PEER_TEST_GEMINI_API_KEY npm run build > ${LOG%.log}.build.out 2>&1; echo "build $?" >> $LOG
rm -rf .next
echo done >> $LOG
