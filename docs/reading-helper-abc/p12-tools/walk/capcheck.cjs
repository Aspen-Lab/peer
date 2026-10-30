// caption fidelity: for every figure of each paper, the inline caption's length, its ending, and its case against the PDF's caption start (private; the pack keeps counts and flags only)
const L = require('./lib2.cjs'); const cp = require('child_process');
(async () => {
  const out = {};
  for (const k of ['P1', 'P2', 'P3']) {
    const s = await L.openPaper(k, L.W.W1, { settle: 6000 }); const p = s.page;
    const caps = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure')).map(f => { const c = f.querySelector('figcaption'); return c ? c.textContent.replace(/\s+/g, ' ').trim() : null; }));
    const raw = cp.execSync(`pdftotext -q "${L.INPUTS[k]}" - 2>/dev/null`, { maxBuffer: 1 << 26 }).toString();
    const flat = raw.replace(/\s+/g, ' ');
    out[k] = caps.map((c, i) => {
      if (!c) return { i, none: true };
      const body = c.replace(/^(Fig(?:ure)?\.?\s*\d+[a-z]?\s*[·|.:]?\s*)/i, '');
      const first6 = body.split(' ').slice(0, 5).join(' ');
      const inPdfExact = flat.includes(first6);
      const inPdfCI = flat.toLowerCase().includes(first6.toLowerCase());
      const last = body.slice(-24);
      // PDF word window containing the first six words, then how many chars of the PDF follow before a blank-line gap in the raw text
      const idx = raw.toLowerCase().indexOf(first6.toLowerCase().split(' ').slice(0, 3).join(' '));
      return { i, len: c.length, endsWithPeriod: /[.)]\s*$/.test(c), tail: last, firstWordsExactInPdf: inPdfExact, firstWordsCaseInsensitiveInPdf: inPdfCI };
    });
    await s.browser.close();
  }
  L.fs.writeFileSync(L.R + '/private/capcheck.json', JSON.stringify(out, null, 1));
  for (const k of Object.keys(out)) console.log(k, out[k].map(c => c.none ? 'none' : `${c.len}${c.endsWithPeriod ? '.' : '!'}${c.firstWordsExactInPdf ? 'E' : (c.firstWordsCaseInsensitiveInPdf ? 'c' : 'x')}`).join(' '));
})();
