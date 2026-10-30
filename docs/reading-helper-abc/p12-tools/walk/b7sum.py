import json,glob,os,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
for f in sorted(glob.glob(R+'B7-*.json')):
    d=json.load(open(f)); inv=d['inventory']
    body=[t for t in inv if t['kind']=='body']; bodyCap={t['label'].split(' ')[1:3][0]+t['label'].split(' ')[2]:t['bodyCapLen'] for t in body} if body else {}
    tg=d['targets']; opened=[t for t in tg if t.get('opened')]
    caps=[]
    for t in tg:
        st=((t.get('ex') or {}).get('open') or {}).get('st') or {}
        caps.append((t['target'].replace('body:Open ','').replace(' in the margin',''), st.get('captionLen'), st.get('capOverflowY'), st.get('capClientH'), st.get('capScrollH')))
    summ=[(x.get('openedInMargin'), (x.get('card') or {}).get('captionLen'), x.get('lightbox'), x.get('escapeClosed')) for x in d['summary']['targets']]
    ok_zoom=all(((t.get('ex') or {}).get('zoom') or {}).get('fit')=='100 %' and ((t.get('ex') or {}).get('zoom') or {}).get('zoomIn2')=='200 %' and ((t.get('ex') or {}).get('zoom') or {}).get('panMoved') for t in opened)
    esc=sum(1 for t in opened if (t.get('ex') or {}).get('escapeClosed'))
    foc=sum(1 for t in opened if (t.get('ex') or {}).get('focusAfterOpen'))
    resp=[r['status'] for r in d['figureResponsesAfter']]; bad=[s for s in resp if s!=200]
    sv=d.get('secondView') or {}
    print(d['cell'],'targets',len(tg),'opened',len(opened),'clickfail',sum(1 for t in tg if not (t['click'] or {}).get('clicked')),'esc',esc,'focus',foc,'zoomOK',ok_zoom,'| img requests',len(resp),'non200',len(bad),'| 2nd view',sv.get('opened'),sv.get('figureImageRequests'),'| summary',summ,'| supp',d['supplementaryControls'],'ED',d['extendedDataInventory'],'| hash',d['hashBefore']['sha']==d['hashAfter']['sha'],'pe',len(d['pageerrors']),'cons',len(d['console']),'load',round(d['load'],1))
    print('    caps (card):',caps)
    print('    inline caps:',[(t['label'].replace('Open ','').replace(' in the margin',''),t['bodyCapLen']) for t in body])
