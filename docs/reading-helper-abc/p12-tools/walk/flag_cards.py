import json,glob
R='__P12_SCRATCH__/p12/r2/a92/pack/'
for f in sorted(glob.glob(R+'B345-P*.json')):
    d=json.load(open(f)); fl=[]; cell=d['cell']
    if d.get('partial'): fl.append('PARTIAL')
    if d.get('errors'): fl.append('ERRORS %s'%json.dumps(d['errors'])[:160])
    if 'hashBefore' in d and d['hashBefore']!=d['hashAfter']: fl.append('HASH')
    if d.get('pageerrors'): fl.append('PAGEERR %d'%len(d['pageerrors']))
    P1=d['P1']; P2=d['P2']
    for nm,x in (('E',P1.get('explain')),('S',P2.get('sticky'))):
        if x:
            a=x['alignDelta']
            if a is not None and abs(a)>8: fl.append('%s-align %s'%(nm,a))
            pm=(x.get('sel') or {}).get('paperMove')
            if pm and (pm['dTop'] or pm['dLeft'] or pm['dW']): fl.append('%s paper moved %s'%(nm,pm))
    b3=d['B3']
    if b3.get('heightDelta') is None or b3['heightDelta']>2: fl.append('B3 delta %s'%b3.get('heightDelta'))
    m=b3.get('secondCardPaperMove') or {}
    if m.get('dTop') or m.get('dLeft') or m.get('dW'): fl.append('2nd-card paper move %s'%m)
    for k,v in (b3.get('scroll') or {}).items():
        if not v.get('present'): fl.append('scroll %s absent'%k)
    b4=d['B4']
    if not b4.get('rest'): fl.append('B4 no divider')
    else:
        r=b4['rest']
        if r['cursor']!='row-resize': fl.append('B4 cursor %s'%r['cursor'])
        if min(r['contrastDivider'],r['contrastAbove'],r['contrastBelow'])<3: fl.append('B4 contrast %s'%[r['contrastDivider'],r['contrastAbove'],r['contrastBelow']])
        if not all(p['hit'] and p['cursor']=='row-resize' for p in b4['cursorProbes']): fl.append('B4 probes %s'%sorted(set((p['hit'],p['cursor']) for p in b4['cursorProbes'])))
        if b4['hover']['lineBg']==r['lineBg']: fl.append('B4 no hover change')
        if b4['focus']['lineBg']==r['lineBg'] or not b4['focus'].get('focusVisible'): fl.append('B4 focus %s'%b4['focus'])
        k=b4['keys']
        if k['down1']['h']==k['start']['h']: fl.append('B4 key no change')
        if b4['drag60']['h']==k['start']['h']: fl.append('B4 drag no change')
        for nm in ('minInfoDown','minInfoUp'):
            for mi in b4[nm]:
                if mi['visibleTextLinesBelowHeader']<1 or not mi.get('headerInsideCard',True): fl.append('B4 min %s %s'%(nm,(mi['kind'],mi['cardH'],mi['visibleTextLinesBelowHeader'])))
        s=b4['session']
        if s['ratioSet']['h']!=s['afterRaise']['h'] or s['ratioSet']['h']!=s['backWide']['h']: fl.append('B4 session (raise/resize) %s'%{k_:[round(x) for x in v['h']] for k_,v in s.items()})
    for o in d['B5']['orders']:
        th=o['three']; h=th['h']
        tr=th['track']
        if len(th['divs'])!=2: fl.append('B5 %s divs %d'%(o['order'],len(th['divs'])))
        if max(h)-min(h)>2: fl.append('B5 %s heights %s'%(o['order'],[round(x) for x in h]))
        ov = tr and tr['scrollH']>tr['clientH']+1
        if not ov and abs(sum(h)+24-tr['clientH'])>6 and abs(sum(h)-tr['clientH'])>30: fl.append('B5 %s sum %s vs track %s'%(o['order'],round(sum(h)),tr['clientH']))
        for mi in o['min']:
            if mi['visibleTextLinesBelowHeader']<1 or not mi['headerInsideCard']: fl.append('B5 %s min %s'%(o['order'],(mi['kind'],mi['cardH'],mi['visibleTextLinesBelowHeader'])))
        # closing redistribution: after closing the first card the survivors sum should be >= before sum
        prev=sum(h)
        for cs in o['closeSteps']:
            sm=sum(cs['h'])
            if cs['h'] and sm<prev-30: fl.append('B5 %s close %s sum %s<%s'%(o['order'],cs['closed'],round(sm),round(prev)))
            if cs['h']: prev=sm
    print(cell,'orders',len(d['B5']['orders']),'FLAGS:',fl if fl else 'none')
