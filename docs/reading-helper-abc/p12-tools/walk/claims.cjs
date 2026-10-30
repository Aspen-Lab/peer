// claims: C P12-53 (no /structure request with no key), C P12-63 (closing split's rows wear a role tag; no placeholder heading opens the body), C P12-56 (supp/ED stay text)
const L = require('./lib2.cjs');
const cp = require('child_process');
const PACK = L.R + '/pack';
async function run(key, prof) {
  const s = prof === 'key' ? await L.openKey(key, L.W.W1, { settle: 6000 }) : await L.openPaper(key, L.W.W1, { settle: 6000 });
  const p = s.page;
  await p.waitForTimeout(20000); // idle: would a structure review be asked now?
  const out = await p.evaluate(() => {
    const left = document.querySelector('[data-reader-left]');
    const rows = Array.from(left.querySelectorAll('li[data-level]')).map(li => {
      const a = li.querySelector('a'); const meta = li.querySelector('.annotation.ml-auto, span.annotation:last-child');
      const t = (a ? a.textContent : '').trim();
      return { level: Number(li.getAttribute('data-level')), words3: t.split(/\s+/).slice(0, 3).join(' '), titleLen: t.length, meta: (meta ? meta.textContent : '').replace(/\s+/g, ' ').trim() };
    });
    const body = document.querySelector('#paper-body');
    const heads = Array.from(body.querySelectorAll('h1,h2,h3,h4')).map(h => ({ tag: h.tagName, txt: h.textContent.replace(/\s+/g, ' ').trim() }));
    const first = body.querySelector('h1,h2,h3,h4,p');
    return { rows, heads, firstBlock: first ? first.tagName : null, firstBlockIsHeading: first ? /^H/.test(first.tagName) : null, nParagraphs: body.querySelectorAll('p').length };
  });
  // does each body heading occur verbatim in the PDF text? (verdict only; the words stay out of the pack)
  const raw = cp.execSync(`pdftotext "${L.INPUTS[key]}" - 2>/dev/null`, { maxBuffer: 1 << 26 }).toString(); const txt = raw.replace(/\s+/g, ' ').toLowerCase(); const lines = raw.split('\n').map(l => l.replace(/\s+/g, ' ').trim().toLowerCase());
  const norm = (t) => t.replace(/\s+/g, ' ').trim().toLowerCase();
  out.heads = out.heads.map(h => ({ tag: h.tag, words2: h.txt.split(' ').slice(0, 2).join(' '), len: h.txt.length, inPdfText: txt.includes(norm(h.txt)), asPdfLine: lines.some(l => l === norm(h.txt) || (l.length <= norm(h.txt).length + 12 && l.endsWith(norm(h.txt)) ) || (h.txt.split(' ').length > 1 && l.startsWith(norm(h.txt)) && l.length < norm(h.txt).length + 40)) }));
  out.rows = out.rows.map(r => ({ ...r }));
  out.roleTags = out.rows.map(r => (/^(setup|method|evidence|interpretation|apparatus|body)\b/.exec(r.meta) || [])[1] || (r.meta.split('·')[0] || '').trim().slice(0, 20));
  out.structureRequests = s.log.requests.filter(r => /structure/i.test(r.u)).map(r => r.m + ' ' + r.u.replace(/upload%3A[0-9a-f]+/, 'upload:ID').slice(0, 80));
  out.allApiRequests = s.log.requests.filter(r => /\/api\//.test(r.u)).map(r => r.m + ' ' + r.u.replace(/upload%3A[0-9a-f]+/, 'upload:ID').replace(/\?.*$/, '')).reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {});
  out.supplementaryControls = await p.evaluate(() => Array.from(document.querySelectorAll('button,a,[role=button]')).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(t => /supplement|extended data/i.test(t)).length);
  out.cell = `${key}-W1-default-light-${prof}`; out.load = require('os').loadavg()[0];
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  await p.screenshot({ path: `${PACK}/CLAIMS-${key}-W1-default-light-${prof}.png` });
  L.fs.writeFileSync(`${PACK}/CLAIMS-${key}-W1-default-light-${prof}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3] || 'nokey').then(o => console.log(o.cell, 'rows', o.rows.length, 'tags', o.roleTags.join(','), 'structureReq', o.structureRequests.length, 'heads', o.heads.length, 'notInPdf', o.heads.filter(h => !h.inPdfText).length, 'notAsLine', o.heads.filter(h => !h.asPdfLine).length, 'first', o.firstBlock)).catch(e => { console.error('ERR', e); process.exit(1); });
