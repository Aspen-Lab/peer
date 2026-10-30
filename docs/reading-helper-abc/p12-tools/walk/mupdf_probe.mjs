import fs from 'node:fs';
const mupdf = await import('__P12_SCRATCH__/p12/r2/a38/wt/web/node_modules/mupdf/dist/mupdf.js');
const [pdf, pageNo] = process.argv.slice(2);
const doc = mupdf.Document.openDocument(fs.readFileSync(pdf), 'application/pdf');
const page = doc.loadPage(Number(pageNo) - 1);
const b = page.getBounds();
const st = page.toStructuredText('preserve-images');
const j = JSON.parse(st.asJSON());
console.log('page bounds', b.join(','));
for (const blk of j.blocks) {
  const txt = (blk.lines || []).map(l => l.text).join(' ');
  const head = txt.trim().slice(0, 7);
  console.log(blk.type, JSON.stringify([blk.bbox.x, blk.bbox.y, blk.bbox.w, blk.bbox.h].map(v => Math.round(v))), blk.type === 'text' ? (/^\s*fig/i.test(txt) ? 'CAPTION? ' + head : 'text[' + (blk.lines || []).length + ' lines]') : '');
}
