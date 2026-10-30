import json,sys,glob
R='__P12_SCRATCH__/p12/r2/a92/pack/'
for f in sys.argv[1:] or sorted(glob.glob(R+'B7-*.json')):
    f=f if f.startswith('/') else R+f
    d=json.load(open(f))
    print('=====',d['cell'],'load',round(d['load'],1),'hash',d['hashBefore']==d['hashAfter'],'pageerr',len(d['pageerrors']))
    print(' inventory:',[ (t['kind'],t.get('label'),t.get('imgNat'),t.get('page'),t.get('fig'),t.get('hasCaption'), t.get('visible')) for t in d['inventory']])
    print(' captionOnly:',d['captionOnly'])
    resp={}
    for r in d['figureResponsesAfter']: resp[r['u']]=r['status']
    print(' responses:',resp)
    for t in d['targets']:
        ex=t.get('ex') or {}; o=ex.get('open') or {}; st=o.get('st') or {}
        z=ex.get('zoom') or {}
        print('  -',t['target'],'p',t.get('page'),'click',t['click'].get('clicked'),t['click'].get('reason',''),(t['click'].get('hit') or {}).get('ok'),'opened',t.get('opened'),'ms',o.get('ms'),'canvas',st.get('canvas'),'img',st.get('img'),'load',st.get('loading'),'cap',st.get('captionLen'),'focusIn',ex.get('focusAfterOpen'),'zoom',(z.get('start'),z.get('zoomIn'),z.get('zoomIn2'),z.get('zoomOut'),z.get('fit'),z.get('wheel'),z.get('panMoved')) if z else None,'esc',ex.get('escapeClosed'),'closeCtl',ex.get('closeControlClosed'),'err',t.get('error'))
