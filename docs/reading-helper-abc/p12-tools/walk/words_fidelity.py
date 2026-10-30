import re,subprocess,json,sys
R='__P12_SCRATCH__/p12/r2/a92/'
U='__P12_PDF_DIR__/'
pdfs={'P1':'P1.pdf','P2':'P2.pdf','P3':'P3.pdf'}
LIG={'ﬀ':'ff','ﬁ':'fi','ﬂ':'fl','ﬃ':'ffi','ﬄ':'ffl'}
def norm(t):
    for a,b in LIG.items(): t=t.replace(a,b)
    t=re.sub(r'-\n','',t); t=re.sub(r'\s+',' ',t).lower()
    return re.findall(r"[a-z0-9]+",t)
res={}
for k,f in pdfs.items():
    pdf=norm(subprocess.run(['pdftotext','-q',U+f,'-'],capture_output=True,text=True).stdout)
    app=norm(open(R+'private/body-'+k+'.txt').read())
    W=10
    appset=set(' '.join(app[i:i+W]) for i in range(len(app)-W+1))
    n=len(pdf)-W+1; hit=sum(1 for i in range(n) if ' '.join(pdf[i:i+W]) in appset)
    appw=len(app); pdfw=len(pdf)
    # ligature signature in the app text: a word fragment followed by a short fragment that completes fi/fl/ff words
    raw=open(R+'private/body-'+k+'.txt').read()
    frag=len(re.findall(r'\b(?:pro|signi|speci|quanti|identi|di|e|bene|suf|con|ef|of|af)\s(?:le|cant|c|cation|cation|ciency|cient|ects?|ect|fer)\b',raw))
    # pdf side: how many words carry a ligature glyph in the PDF text layer
    pdfraw=subprocess.run(['pdftotext','-q',U+f,'-'],capture_output=True,text=True).stdout
    ligwords=len(re.findall(r'\w*[ﬀ-ﬄ]\w*',pdfraw))
    # whole words containing fi/fl/ff in the app text vs expected from the pdf
    app_fi=len(re.findall(r'\w*(?:fi|fl|ff)\w*',raw.lower())); pdf_fi=len(re.findall(r'\w*(?:fi|fl|ff)\w*',re.sub('|'.join(LIG),lambda m:LIG[m.group(0)],pdfraw).lower()))
    res[k]=dict(pdf_words=pdfw,app_words=appw,windows=n,windows_found_contiguously=hit,fraction=round(hit/n,3),pdf_words_with_ligature_glyph=ligwords,words_with_fi_fl_ff_pdf=pdf_fi,words_with_fi_fl_ff_app=app_fi,app_fragments_like_broken_fi_fl_words=frag)
print(json.dumps(res,indent=1))
json.dump(res,open(R+'pack/words-fidelity.json','w'),indent=1)
