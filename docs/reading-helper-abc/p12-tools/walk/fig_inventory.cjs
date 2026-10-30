const L = require('./lib2.cjs');
async function scrollAll(p) {
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 900; y += 500) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(220); }
  await p.waitForTimeout(2500);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
}
async function inventory(p) {
  return p.evaluate(() => {
    const figs = Array.from(document.querySelectorAll('#paper-body figure, #paper-body [data-figure]'));
    const rows = figs.map((f, i) => {
      const btn = f.querySelector('button[aria-label^="Open Fig"]'); const img = f.querySelector('img'); const cap = f.querySelector('figcaption');
      const r = btn ? btn.getBoundingClientRect() : f.getBoundingClientRect();
      return { i, id: f.id || null, btn: btn ? btn.getAttribute('aria-label') : null, btnBox: btn ? [Math.round(r.width), Math.round(r.height)] : null, img: img ? { nat: img.naturalWidth + 'x' + img.naturalHeight, complete: img.complete, srcq: (img.getAttribute('src') || '').replace(/^.*figure-image\?/, '') } : null, hasCaption: !!cap, capHead: cap ? cap.textContent.trim().slice(0, 8) : null };
    });
    const plates = Array.from(document.querySelectorAll('button[aria-label="Enlarge figure"]')).map(b => { const r = b.getBoundingClientRect(); return { where: b.closest('[data-reader-left]') ? 'left' : b.closest('#paper-body') ? 'body' : 'other', box: [Math.round(r.width), Math.round(r.height)] }; });
    const allBtn = Array.from(document.querySelectorAll('button')).filter(b => /^Open Fig/.test(b.getAttribute('aria-label') || '')).length;
    return { rows, plates, allBtn };
  });
}
(async () => {
  const k = process.argv[2]; const profile = process.argv[3] || 'nokey';
  const s = profile === 'key' ? await L.openKey(k, L.W.W1, { settle: 8000 }) : await L.openPaper(k, L.W.W1, { settle: 8000 });
  const p = s.page;
  await scrollAll(p);
  const inv = await inventory(p);
  console.log(k, profile, 'figures', inv.rows.length, 'openButtons', inv.allBtn, 'plates', JSON.stringify(inv.plates));
  for (const r of inv.rows) console.log(' ', r.i, r.btn, JSON.stringify(r.btnBox), r.img && r.img.nat, r.img && r.img.complete, r.img && r.img.srcq, r.hasCaption ? r.capHead : 'nocap');
  console.log('http errors', JSON.stringify(s.log.console.filter(c => /^http/.test(c.t)).map(c => c.t + ' ' + c.text.slice(0, 90))));
  await s.browser.close();
})();
