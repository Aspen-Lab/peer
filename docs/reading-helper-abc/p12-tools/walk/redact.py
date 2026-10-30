import json,glob,os,re,sys
R='__P12_SCRATCH__/p12/r2/a92/'
P=json.load(open(R+'probes.private.json'))
typed={k:v for k,v in P.items() if not k.startswith('a highlighted passage') and not k.startswith('five words from a paragraph') and k!='the placeholder key'}
n=0; files=0
for f in glob.glob(R+'pack/*.json')+glob.glob(R+'pack/*.md'):
    t=open(f,encoding='utf8',errors='replace').read(); t2=t
    for k,v in typed.items():
        if v in t2:
            c=t2.count(v); t2=t2.replace(v,'['+re.sub(r'\W+','-',k.split('(')[0].strip().lower())[:40]+']'); n+=c
    if t2!=t: open(f,'w',encoding='utf8').write(t2); files+=1
print('redacted typed strings',n,'in files',files)
