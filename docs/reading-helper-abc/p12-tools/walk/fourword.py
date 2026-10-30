import re,subprocess,sys,glob
U='__P12_PDF_DIR__/'
pdfs={'P1':'P1.pdf','P2':'P2.pdf','P3':'P3.pdf'}
def words(t): return re.findall(r"[a-z0-9]+(?:[-'][a-z0-9]+)*",t.lower())
sh={}
for k,f in pdfs.items():
    t=subprocess.run(['pdftotext','-q',U+f,'-'],capture_output=True,text=True).stdout
    # also the line-joined variant (hyphen-joined line breaks)
    t2=re.sub(r'-\n','',t)
    for txt in (t,t2):
        w=words(txt)
        for i in range(len(w)-3): sh.setdefault(tuple(w[i:i+4]),set()).add(k)
print('shingles',len(sh),file=sys.stderr)
def scan(path):
    txt=open(path,encoding='utf8',errors='replace').read()
    # drop code spans / file names / numbers-only tables: scan prose lines only
    w=words(txt); hits=[]
    for i in range(len(w)-3):
        t=tuple(w[i:i+4])
        if t in sh and not all(x.isdigit() for x in t): hits.append((' '.join(t),sorted(sh[t])))
    return hits
for p in sys.argv[1:]:
    h=scan(p); print(p.split('/')[-1],'hits',len(h))
    seen=set()
    for t,k in h:
        if t not in seen: print('   ',t,k); seen.add(t)
        if len(seen)>40: break
