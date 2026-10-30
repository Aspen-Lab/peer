import json,glob,sys
R='__P12_SCRATCH__/p12/r2/a92/pack/'
def chk(cell):
    d=json.load(open(R+'B89-'+cell+'.json'))
    b8=d['B8']; steps={s['name']:s for s in d['B9']['steps']}
    row={'cell':d['cell']}
    if b8.get('present'):
        r=b8['rest']; h=b8['hover']; f=b8['focus']
        row['B8']=dict(font=r['font'],heading=r['headingFont'],fontEq=(r['font']==r['headingFont']),bg=r['bg'],fg=r['fg'],ratio=r['textRatio'],hoverBg=h['bg'],hoverRatio=h['textRatio'],focusOutline=f['outline'] and (f['outline']['w'],f['outline']['color'],f['outline']['ratioVsPage']),focusVisible=f.get('focusVisible'),tri=r['hasTriangle'],opened=b8['opened']['expanded'],closed=b8['closedAgain']['expanded'],enter=b8['afterEnter'],space=b8['afterSpace'],panel=b8['panel'] and b8['panel']['visible'])
    else: row['B8']='absent'
    def g(n):
        s=steps.get(n); 
        if not s: return None
        st=s['state']; return (st.get('label'),st.get('bg'),st.get('fg'),st.get('textRatio'),st.get('boundaryVsBar'),st.get('taRows'),s.get('newApi'))
    row['B9']={n:g(n) for n in ('initial-empty','typed-after-500ms','after-click-submit','repeat-click','repeat-enter','edit-immediate','edit-after-500ms','revert-after-600ms','cleared','long-typed')}
    row['hash']=d['hashBefore']==d['hashAfter']; row['pageerrors']=len(d['pageerrors']); row['console']=len(d['console']); row['load']=round(d['load'],1)
    return row
for f in sorted(glob.glob(R+'B89-*.json')):
    cell=f.split('B89-')[1][:-5]
    r=chk(cell); print('=====',r['cell'],'hash',r['hash'],'pageerr',r['pageerrors'],'console',r['console'],'load',r['load'])
    print(' B8',r['B8'])
    for k,v in r['B9'].items(): print('   B9',k,v)
