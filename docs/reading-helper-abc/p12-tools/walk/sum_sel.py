import json,glob,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
for f in sorted(glob.glob(R+'B6-P*-*-default-light-*.json')):
    d=json.load(open(f))
    print('=====',d['cell'],d['profile'],'load',round(d['load'],1),'hash',d['hashBefore']==d['hashAfter'],'perr',len(d['pageerrors']),'con',len(d['console']))
    for k in d['kinds']:
        if 'error' in k: print('  ',k['kind'],'ERROR',k['error'][:100]); continue
        hl=k.get('highlight') or {}
        print('  ',k['kind'].ljust(8),'sel',(k.get('sel') or {}) and {a:b for a,b in (k.get('sel') or {}).items() if a in('len','paragraphs')},'offered',k.get('offered'),'| HL',('marks',hl.get('marksBefore'),'->',hl.get('marksAfter'),'blocks',hl.get('perParagraph'),'bg',hl.get('bg'),'ratio',(hl.get('contrast') or {}).get('ratio'),'removed->',hl.get('afterRemove')) if hl else None,'| TN',k.get('takeNotes'),'| EX',k.get('explain'), k.get('note') or '')
