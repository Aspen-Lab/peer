import json,glob,os
R='__P12_SCRATCH__/p12/r2/a92/pack/'
def acc_contrast(rgb, bg):
    def p(s): return [int(x) for x in s[s.index('(')+1:s.index(')')].split(',')]
    def lum(c):
        f=lambda v:(v/255/12.92) if v/255<=0.03928 else ((v/255+0.055)/1.055)**2.4
        return 0.2126*f(c[0])+0.7152*f(c[1])+0.0722*f(c[2])
    a,b=lum(p(rgb)),lum(p(bg)); hi,lo=max(a,b),min(a,b); return round((hi+0.05)/(lo+0.05),2)
for f in sorted(glob.glob(R+'B1-*.json')):
    d=json.load(open(f))
    L=d['layout']
    print('==',d['cell'],'mode',L['mode'],L['leftState'],'centre',L['centre'] and L['centre']['w'],'margin',L['margin'] and L['margin']['w'],'left',L['left'] and L['left']['w'],'chars',L['charsPerLine'],'hOverflow',L['hOverflow'],'rest',len(L['rest']),'load',round(d['load'],1))
    for r in d['rest']:
        hv=d['panes'][r['pane']].get('hover'); fo=d['panes'][r['pane']].get('focus')
        print('  ',r['pane'],'w',r['rect']['w'],'line',r['lineW'],r['lineRgb'],'contrast L/R',r['contrastLeft'],r['contrastRight'],'cursor',r['cursor'],[ (c['same'],c['cursor']) for c in r['cursorProbes']],
              'hover',hv and (hv['w'],hv['rgb'],acc_contrast(hv['rgb'],r['bgLeft'])), 'focus',fo and (fo['w'],fo['rgb'],fo['focusVisible']))
        k=d['panes'][r['pane']]['keys']; dr=d['panes'][r['pane']]['drag']
        print('      keys start',k['start'],'+1',k['grow1']['v'],'+shift',k['growShift']['v'],'-1',k['shrink1']['v'],'End',k['end']['v'],'Home',k['home']['v'],'Enter',k['enter']['v'],'| centre@End',k['end']['grid']['centre'],'centre@Home',k['home']['grid']['centre'],'| drag',dr['dx'],dr['before'],'->',dr['after'],'grid',dr['gridBefore'],'->',dr['gridAfter'])
    for pn,v in d['panes'].items():
        if not v.get('present'): print('  pane',pn,'absent (no separator element)')
    print('   hash',d['hashBefore']==d['hashAfter'],'pageerr',len(d['pageerrors']),'console',len(d['console']), 'restHairlines',L['rest'])
