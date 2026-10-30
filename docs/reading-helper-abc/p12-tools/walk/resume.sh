#!/bin/bash
# usage: resume.sh N   (N = restart number; the previous dev.log becomes dev-N.log)
R=__P12_SCRATCH__/p12/r2/a92; WT=$R/wt; T=$R/tools
mv $R/dev.log $R/dev-$1.log 2>/dev/null
cd $WT/web && PEER_PRIVATE_UPLOAD_DIR=$R/uploads P602_DIR=$R/stub NODE_OPTIONS="--require $WT/docs/reading-helper-abc/harness/model-stub.cjs" setsid env -u PEER_TEST_GEMINI_API_KEY npx next dev -p 4247 > $R/dev.log 2>&1 &
cd $T
python3 - <<'PY'
import re,os
T='__P12_SCRATCH__/p12/r2/a92/tools/'
q=open(T+'../logs/queue.log').read().splitlines()
done=set()
for l in q:
    m=re.match(r'done (.*?) try=\d+ rc=0',l)
    if m: done.add(m.group(1).strip())
def rd(f): return [l.strip() for l in open(T+f).read().splitlines() if l.strip()] if os.path.exists(T+f) else []
def rem(fs,extra=()):
    out=[]
    for f in fs:
        out+= [l for l in rd(f) if l not in done]
    out+=[e for e in extra if e not in done]
    seen=set(); u=[]
    for l in out:
        if l not in seen: seen.add(l); u.append(l)
    return u
lists={'a':rem(['jobs_r3a.txt'],['cell_fig.cjs P3 W1 2 all']),'b':rem(['jobs_r3b.txt']),'c':rem(['jobs_r3c.txt']),'d':rem(['jobs_r3d.txt']),
 'r4':rem(['jobs_r4.txt','jobs_r4b.txt','jobs_r4c.txt','jobs_fixtab.txt','jobs_fix1.txt','jobs_extra.txt'])}
for k,v in lists.items():
    open(T+f'jobs_res_{k}.txt','w').write('\n'.join(v)+('\n' if v else '')); print(k,len(v))
PY
