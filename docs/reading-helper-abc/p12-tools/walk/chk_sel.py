import json,glob
R='__P12_SCRATCH__/p12/r2/a92/pack/'
rows=[]
for f in sorted(glob.glob(R+'B6-P*-default-light-*.json')):
    d=json.load(open(f)); prof='key' if 'placeholder' in d['profile'] else 'nokey'
    flags=[]
    if d['hashBefore']['sha']!=d['hashAfter']['sha']: flags.append('HASH')
    if d['pageerrors']: flags.append('PE%d'%len(d['pageerrors']))
    line=[d['cell'],prof]
    for k in d['kinds']:
        if 'error' in k: line.append(k['kind']+':ERR '+k['error'][:60]); continue
        hl=k.get('highlight') or {}; names=k.get('offered')
        s='%s[%s|HL %s->%s pp=%s|TN=%s|EX=%s]'%(k['kind'],'/'.join(n.split()[0] for n in (names or [])) or 'NONE',hl.get('marksBefore'),hl.get('marksAfter'),hl.get('perParagraph'),(k.get('takeNotes') or {}).get('sticky'),(k.get('explain') or {}).get('card'))
        if k.get('note'): s+=' note='+k['note']
        if hl and not hl.get('ok'): s+=' HLFAIL'
        if hl and hl.get('afterRemove') not in (0,None): s+=' RM%s'%hl.get('afterRemove')
        line.append(s)
    print(' '.join(line),flags)
