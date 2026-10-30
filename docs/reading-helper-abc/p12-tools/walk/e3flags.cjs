const L = require('./lib2.cjs'); const cp = require('child_process');
const key = process.argv[2];
const raw = cp.execSync(`pdftotext -q "${L.INPUTS[key]}" - 2>/dev/null`, { maxBuffer: 1 << 27 }).toString();
const forms = new Map();
for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-?/g)) { const f = m[0], k = f.toLowerCase(); if (!forms.has(k)) forms.set(k, new Set()); forms.get(k).add(f); }
for (const n of ['body','headings','mapRows','inlineCaptions','cardCaptions','summary']) {
  const t = L.fs.readFileSync(`${L.R}/private/e3-${key}-${n}.txt`, 'utf8'); const out = {};
  for (const m of t.matchAll(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-?/g)) { const f = m[0], k = f.toLowerCase(); const pf = forms.get(k); if (pf && !pf.has(f)) out[f] = (out[f] || 0) + 1; }
  console.log(n, JSON.stringify(out));
}
