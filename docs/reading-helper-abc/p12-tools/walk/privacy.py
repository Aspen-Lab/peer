import json,subprocess,os,sys
R='__P12_SCRATCH__/p12/r2/a92'
WT=R+'/wt'
probes=json.load(open(R+'/probes.private.json'))
locs={'dev.log (+dev-1.log, dev-2.log: the earlier server runs)':[R+'/dev.log',R+'/dev-1.log',R+'/dev-2.log'],'stub/':[R+'/stub'],'pack/':[R+'/pack']}
def count(probe, paths):
    n=0
    for p in paths:
        if not os.path.exists(p): continue
        r=subprocess.run(['grep','-rFc','--binary-files=text','--',probe,p],capture_output=True,text=True)
        for line in r.stdout.splitlines():
            n+=int(line.rsplit(':',1)[-1]) if ':' in line else int(line)
    return n
def tracked(probe):
    r=subprocess.run(['git','-C',WT,'grep','-F','-c','--',probe],capture_output=True,text=True)
    return sum(int(l.rsplit(':',1)[-1]) for l in r.stdout.splitlines() if l.strip())
def uploads(probe):
    return count(probe,[R+'/uploads'])
print('probe purpose | dev.log | stub/ | pack/ | worktree tracked files | (uploads/, allowed)')
tot=0
for purpose,val in probes.items():
    row=[count(val,v) for v in locs.values()]+[tracked(val)]
    tot+=sum(row)
    print(f'{purpose} | '+' | '.join(map(str,row))+f' | {uploads(val)}')
print('TOTAL hits outside uploads/:',tot)
