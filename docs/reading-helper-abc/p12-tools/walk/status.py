import json,glob,os,time,datetime,sys
R='__P12_SCRATCH__/p12/r2/a92/'
since=float(sys.argv[1]) if len(sys.argv)>1 else time.time()-3*3600
for f in sorted(glob.glob(R+'pack/*.json'), key=os.path.getmtime):
    if os.path.getmtime(f)<since: continue
    try: d=json.load(open(f))
    except Exception as e: print(os.path.basename(f),'unreadable'); continue
    if not isinstance(d,dict): continue
    pe=d.get('pageerrors') or []; ce=d.get('consoleErrors') or d.get('console') or []
    mud=[e for e in pe if 'Maximum update' in str(e)]
    print(datetime.datetime.fromtimestamp(os.path.getmtime(f)).strftime('%H:%M'), os.path.basename(f), 'partial=%s'%d.get('partial'), 'pageerr=%d'%len(pe), 'MUD=%d'%len(mud), 'errs=%s'%(len(d.get('errors') or [])), 'reopened=%s'%d.get('browserReopened'))
