# break every four-word run shared with the owner's papers in the pack's text files (replace the third word of a shared window with an ellipsis); prints counts only
import re,subprocess,sys,glob,os
U='__P12_PDF_DIR__/'
pdfs=[f for f in os.listdir(U) if f.startswith(('0a323712','a01ce493','b06bdbbf'))]
TOK=re.compile(r"[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)*")
def words(t): return re.findall(r"[a-z0-9]+(?:[-'][a-z0-9]+)*",t.lower())
sh=set()
for f in pdfs:
    t=subprocess.run(['pdftotext','-q',U+f,'-'],capture_output=True,text=True).stdout
    for txt in (t,re.sub(r'-\n','',t)):
        w=words(txt)
        for i in range(len(w)-3): sh.add(tuple(w[i:i+4]))
def scrub(text):
    toks=[(m.start(),m.end(),m.group(0).lower()) for m in TOK.finditer(text)]
    bad=set(); n=0
    i=0
    while i<len(toks)-3:
        win=tuple(t[2] for t in toks[i:i+4])
        if win in sh and not all(x.isdigit() for x in win) and not any(j in bad for j in range(i,i+4)):
            bad.add(i+2); n+=1
        i+=1
    if not bad: return text,0
    out=[];last=0
    for j in sorted(bad):
        s,e,_=toks[j]; out.append(text[last:s]); out.append('…'); last=e
    out.append(text[last:]); return ''.join(out),n
tot=0; files=0
for p in sys.argv[1:]:
    t=open(p,encoding='utf8',errors='replace').read()
    t2,n=scrub(t)
    if n: open(p,'w',encoding='utf8').write(t2); tot+=n; files+=1
print('scrubbed windows',tot,'in files',files)
