import json,glob
R='__P12_SCRATCH__/p12/r2/a92/pack/'
def g(o,k): return o[k] if o else None
print('cell | mode | centre | para | 20px: all n/min/med/mean/max/<58 | first4 n/med/mean || 12px emu: all n/med/mean/<58 | first4 med/mean')
for f in sorted(glob.glob(R+'R4CPL-*.json')):
    d=json.load(open(f)); a=d['all']; e=d['emulatedPad12']['all']; f4=d['first4']; f4e=d['emulatedPad12']['first4']
    print(d['cell'].replace('R4CPL-',''),d['mode'],d['centre']['w'] if d['centre'] else None,d['paragraph']['w'] if d['paragraph'] else None,'|',[g(a,k) for k in ('n','min','median','mean','max','below58')],[g(f4,k) for k in ('n','median','mean')],'||',[g(e,k) for k in ('n','median','mean','below58')],'|',g(f4e,'median'),g(f4e,'mean'))
