import json,glob,re,collections,os
R='__P12_SCRATCH__/p12/r2/a92/'
P=R+'pack/'
cells=0; pe=0; cons=collections.Counter(); mud=0; snag=0; withpe=[]
for f in sorted(glob.glob(P+'*.json')):
    try: d=json.load(open(f))
    except: continue
    if not isinstance(d,dict) or ('pageerrors' not in d and 'console' not in d and 'consoleErrors' not in d): continue
    cells+=1
    e=d.get('pageerrors') or []
    if e: pe+=len(e); withpe.append((os.path.basename(f),len(e)))
    for c in (d.get('console') or [])+(d.get('consoleErrors') or []):
        t=(c.get('text') if isinstance(c,dict) else str(c))
        cons[re.sub(r'upload%3A[0-9a-f]+','upload:ID',t)[:110]]+=1
        if re.search('Maximum update depth',t,re.I): mud+=1
        if re.search('hit a snag',t,re.I): snag+=1
    s=json.dumps(d)
    if re.search('Maximum update depth',s) and 'maxUpdateDepth' not in s[:0]: pass
print('JSON cells with error fields',cells,'page errors',pe,'cells with page errors',withpe[:10],'MUD in console',mud,'snag in console',snag)
print('console messages (not filtered):',dict(cons))
log=''.join(open(R+n,errors='replace').read() for n in ('dev-1.log','dev-2.log','dev.log') if os.path.exists(R+n))
print('dev.log lines',log.count('\n'))
for pat in ['snag','Maximum update depth','hydrat','Unhandled','TypeError','ReferenceError','⨯','Error:']:
    print(' dev.log',pat,len(re.findall(pat,log,re.I if pat not in ('⨯','Error:','TypeError','ReferenceError') else 0)))
st=collections.Counter()
for m in re.finditer(r'(GET|POST|PUT|DELETE) (/\S+?)(?:\?\S*)? (\d{3}) in',log):
    path=re.sub(r'upload%3A[0-9a-f]+','upload:ID',m.group(2)); st[(m.group(1),path,m.group(3))]+=1
nonok=[(k,v) for k,v in st.items() if not k[2].startswith('2') and not k[2].startswith('3')]
print('non-2xx/3xx dev.log answers:',sorted(nonok,key=lambda x:-x[1])[:12])
print('total requests',sum(st.values()))
