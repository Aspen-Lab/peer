import json,glob,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
for f in sorted(glob.glob(R+'B345-P*.json')):
    d=json.load(open(f)); flags=[]
    cell=d['cell']
    if d.get('partial'): flags.append('PARTIAL')
    if d.get('errors'): flags.append('errors:'+json.dumps(d['errors'])[:200])
    if d.get('browserReopened'): flags.append('reopened %s'%d['browserReopened'])
    P1=d['P1']; P2=d['P2']; P2b=d.get('P2b',{})
    ex=P1.get('explain'); st=P2.get('sticky')
    out=[cell]
    if ex: out.append('E-align %s'%ex['alignDelta']); 
    if st: out.append('S-align %s'%st['alignDelta'])
    if ex and ex.get('sel') and ex['sel'].get('paperMove'): pm=ex['sel']['paperMove']; out.append('E-paper(dT,dL,dW)=%s,%s,%s'%(pm['dTop'],pm['dLeft'],pm['dW']))
    if st and st.get('sel') and st['sel'].get('paperMove'): pm=st['sel']['paperMove']; out.append('S-paper=%s,%s,%s'%(pm['dTop'],pm['dLeft'],pm['dW']))
    if P2b.get('cards'): out.append('F %s %s'%(P2b.get('how'),[(c['top'],c['h']) for c in P2b['cards']]))
    for name,t in (('E',P1.get('tallyExplain')),('S',P2.get('tallySticky')),('F',P2b.get('tallyFigure'))):
        if t: out.append('tally%s words=%s'%(name,sum(c['textRectsUnderGroup'] for x in t for c in (x['overCards'] or [])))+' hdr=%s'%sum(c['overHeader'] for x in t for c in (x['overCards'] or [])))
    for name,t in (('E',P1.get('stripExplain')),('S',P2.get('stripSticky')),('F',P2b.get('stripFigure'))):
        if t: 
            w=0
            for x in t:
                s=x.get('strip')
                if s and s.get('cards'): w+=sum(c.get('words',0) if isinstance(c,dict) else 0 for c in s['cards'])
            out.append('strip%s words=%s'%(name,w))
    b3=d['B3']
    if b3.get('two'):
        out.append('B3 kinds %s h %s Δ%s'%(b3['order'],[round(c['rect']['h'],1) for c in b3['two']['cards']],b3['heightDelta']))
        m=b3.get('secondCardPaperMove') or {}; out.append('2nd-card paper move %s,%s,%s'%(m.get('dTop'),m.get('dLeft'),m.get('dW')))
        for k,v in (b3.get('scroll') or {}).items():
            if v.get('present'): out.append('scroll %s overscroll=%s hidden=%s A:%s B:%s'%(k,v['overscrollBehavior'],v['hiddenPx'],v['phaseA']['scrollTop'],v['phaseB']['pageMovedPx']))
            else: out.append('scroll %s absent'%k)
        mi=b3.get('minimums') or []
        out.append('min %s'%[(m['kind'],m['cardH'],m['headerH'],m['visibleTextLinesBelowHeader']) for m in mi])
    print(' | '.join(str(x) for x in out))
    b4=d['B4']
    if b4.get('rest'):
        r=b4['rest']
        print('   B4 rest h=%s cursor=%s line=%s %s contrast d/a/b=%s/%s/%s grip=%sx%s probes=%s hover=%s focus=%s fv=%s'%(r['rect']['h'],r['cursor'],r['lineH'],r['lineRgb'],r['contrastDivider'],r['contrastAbove'],r['contrastBelow'],r['grip']['w'],r['grip']['h'],sorted(set((p['hit'],p['cursor']) for p in b4['cursorProbes'])),b4['hover']['lineBg'],b4['focus']['lineBg'],b4['focus'].get('focusVisible')))
        print('   B4 keys',{k:v['h'] for k,v in b4['keys'].items()},'drags',{k:b4[k]['h'] for k in ('dragMid','drag60','dragFarDown','dragFarUp') if k in b4})
        print('   B4 minDown',[(m['kind'],m['cardH'],m['headerH'],m['bodyBelowHeaderPx'],m['visibleTextLinesBelowHeader']) for m in b4['minInfoDown']],'minUp',[(m['kind'],m['cardH'],m['headerH'],m['bodyBelowHeaderPx'],m['visibleTextLinesBelowHeader']) for m in b4['minInfoUp']])
        print('   B4 session',{k:(v['kinds'],[round(x) for x in v['h']]) for k,v in b4['session'].items()})
    else: print('   B4 no divider',json.dumps(b4)[:200])
    for o in d['B5']['orders']:
        th=o['three']
        print('   B5',o['order'],'/',o['closing'],th['kinds'],[round(x) for x in th['h']],'divs',len(th['divs']),'track',th['track'] and (th['track']['split'],th['track']['clientH'],th['track']['scrollH']),'min',[(m['kind'],m['cardH'],m['visibleTextLinesBelowHeader'],m['headerInsideCard']) for m in o['min']],'afterDrag',o.get('afterDrag') and ([round(x) for x in o['afterDrag']['h']],o['afterDrag']['sum']),'close',[(c['closed'],[round(x) for x in c['h']]) for c in o['closeSteps']],'ctrl',json.dumps(o.get('controls'))[:150] if '--ctrl' in sys.argv else '')
    print('   hash',d['hashBefore']==d['hashAfter'],'pe',len(d['pageerrors']),'cons',len(d['console']),[c['text'][:60] for c in d['console']][:3])
