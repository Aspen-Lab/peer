// private: each card caption against the PDF's own caption block: does the card's last 40 characters occur in the PDF, and how far is its length from the PDF's span (label start to that ending)?
const L = require('./lib2.cjs'); const cp = require('child_process');
const out = {};
for (const k of ['P1', 'P2', 'P3']) {
  const raw = cp.execSync(`pdftotext -q "${L.INPUTS[k]}" - 2>/dev/null`, { maxBuffer: 1 << 27 }).toString().replace(/\s+/g, ' ');
  const caps = L.fs.readFileSync(`${L.R}/private/e3-${k}-cardCaptions.txt`, 'utf8').split('\n').map(l => l.split(' || '));
  out[k] = caps.map(([head, cap], i) => {
    const tail = cap.slice(-40); const ti = raw.indexOf(tail);
    // the caption's own start in the PDF text
    const first = cap.slice(0, 30); let si = raw.indexOf(first);
    if (si < 0) si = raw.indexOf(cap.slice(0, 15));
    return { i, appLen: cap.length, tailFound: ti >= 0, startFound: si >= 0, pdfSpan: (ti >= 0 && si >= 0) ? (ti + 40 - si) : null, endsSentence: /[.)]$/.test(cap.trim()) };
  });
  console.log(k, JSON.stringify(out[k]));
}
L.fs.writeFileSync(`${L.R}/pack/CAPFID.json`, JSON.stringify(out, null, 1));
