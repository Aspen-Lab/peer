import json,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
def summ(f):
    d=json.load(open(R+f))
    print('=====',d['cell'],'vp',d['viewport'],'load',round(d['load'],1),'hash',d['hashBefore']==d['hashAfter'],'pageerr',len(d['pageerrors']),'console',len(d['console']))
    P1=d['P1']; print(' single explain: align',P1['explain']['alignDelta'],[ (c['top'],c['h'],c['left'],c['w']) for c in P1['explain']['cards']], 'sel top',P1['explain']['sel'] and P1['explain']['sel']['firstLineTop'])
    P2=d['P2']; print(' single sticky: align',P2['sticky']['alignDelta'],[(c['top'],c['h']) for c in P2['sticky']['cards']])
    if 'P2b' in d: print(' single figure:',d['P2b'].get('how'),d['P2b'].get('cards'))
    for key,name in (('tallyExplain','explain'),('tallySticky','sticky')):
        t=(P1 if name=='explain' else P2).get(key)
        if t: print('  tally',name,[ (x['y'], [ (c['kind'],c['textRectsUnderGroup'],c['overHeader']) for c in (x['overCards'] or [])]) for x in t])
    if 'P2b' in d and d['P2b'].get('tallyFigure'): print('  tally figure',[ (x['y'], [ (c['kind'],c['textRectsUnderGroup'],c['overHeader']) for c in (x['overCards'] or [])]) for x in d['P2b']['tallyFigure']])
    b3=d['B3']; print(' B3 two:',[(c['kind'],c['rect']['h'],c['rect']['top']) for c in b3['two']['cards']],'delta',b3['heightDelta'],'refMoved',(b3['refBefore'] or {}).get('top'),(b3['refAfter'] or {}).get('top'), 'track',b3['two'].get('track') and (b3['two']['track']['split'],b3['two']['track']['clientH'],b3['two']['track']['scrollH']))
    for k,v in b3['scroll'].items():
        if v.get('present'): print('   scroll',k,v['scroller'],'hidden',v['hiddenPx'],'overscroll',v['overscrollBehavior'],'A: top',v['phaseA']['scrollTop'],'pageY',v['phaseA']['scrollYBefore'],'->',v['phaseA']['scrollYAfter'],'| B: page moved',v['phaseB']['pageMovedPx'])
        else: print('   scroll',k,'absent')
    print('   minimums',[(m['kind'],m['cardH'],m['headerH'],m['visibleTextLinesBelowHeader']) for m in b3.get('minimums',[])])
    b4=d['B4']
    if b4.get('rest'):
        r=b4['rest']; print(' B4 rest: h',r['rect']['h'],'cursor',r['cursor'],'line',r['lineH'],r['lineRgb'],'contrast div/above/below',r['contrastDivider'],r['contrastAbove'],r['contrastBelow'],'grip',r['grip']['w'],r['grip']['h'],'| probes',set((p['hit'],p['cursor']) for p in b4['cursorProbes']),'| hover',b4['hover']['lineBg'],'focus',b4['focus']['lineBg'],b4['focus']['focusVisible'])
        print('   keys',{k:v['h'] for k,v in b4['keys'].items()})
        print('   drags',{k:b4[k]['h'] for k in ('dragMid','drag60','dragFarDown','dragFarUp') if k in b4})
        print('   minDown',[(m['kind'],m['cardH'],m['headerH'],m['bodyBelowHeaderPx'],m['visibleTextLinesBelowHeader']) for m in b4['minInfoDown']])
        print('   minUp',[(m['kind'],m['cardH'],m['headerH'],m['bodyBelowHeaderPx'],m['visibleTextLinesBelowHeader']) for m in b4['minInfoUp']])
        print('   session',{k:(v['kinds'],[round(x) for x in v['h']]) for k,v in b4['session'].items()})
    else: print(' B4: no divider',b4)
    for o in d['B5']['orders']:
        th=o['three']; print(' B5',o['order'],'/',o['closing'],th['kinds'],[round(x) for x in th['h']],'divs',len(th['divs']),'track',th['track'] and (th['track']['split'],th['track']['clientH'],th['track']['scrollH']),'fig',o.get('figureHow'),'| min',[(m['kind'],m['cardH'],m['visibleTextLinesBelowHeader'],m['headerInsideCard']) for m in o['min']],'| close',[(c['closed'],[round(x) for x in c['h']]) for c in o['closeSteps']])
for f in sys.argv[1:]: summ(f)
