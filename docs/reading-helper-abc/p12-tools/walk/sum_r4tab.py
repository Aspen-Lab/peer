import json,glob,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
step=sys.argv[1] if len(sys.argv)>1 else 'default'
for f in sorted(glob.glob(R+f'R4TAB-*-{step}-light.json')):
    d=json.load(open(f)); b=d['withCards']['base']
    if not b.get('tab'): print(d['cell'],'NO TAB',d['cardsOpen']); continue
    t=b['tab']; h=b['hit']; sh=b.get('stripHit')
    txt=[x.get('gapTextToHit') for x in d['withCards']['text']]
    oc=[(c['kind'],c['face'],c['hit'],c['faceHeader'],c['hitHeader']) for c in b['overlapCards']]
    sc=d.get('scan',{}).get('margin',{})
    dr={k[4:]:(v['marginBefore'],v['marginAfter']) for k,v in d.items() if k.startswith('drag')}
    chg=[k for k,v in dr.items() if v[0]==v[1]]
    print(d['cell'],'cards',len(d['cardsOpen']),'face',(t['x'],t['y'],t['w'],t['h']),'hit',(h['from'],h['to']) if h else None,'strip',(b['strip']['x'],b['strip']['right']),'stripHit',(sh['from'],sh['to']) if sh else None,'gapFace',b['gapFaceToStrip'],'hitGap',b.get('hitGapToStripHit'),'ov',b['overlapFaceStrip'],b['overlapHitStrip'],'cards',oc,'mast',b['overlapMasthead'],'leg',b['overlapLegend'],'toLeg',b['tabBottomToLegendTop'],'txtGap',txt,'scan',sc.get('colresize'),'/',sc.get('hit'),'/',sc.get('total'),'blocked',sc.get('nBlocked'),'noChangeDrags',chg,'press',d.get('tabPress',{}).get('notesWindowOpened'))
