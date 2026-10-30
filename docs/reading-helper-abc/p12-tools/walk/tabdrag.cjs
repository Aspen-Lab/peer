// a real drag on the margin divider with a sticky card open: at the tab's height, and clear of it
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./bat_layout.cjs');
(async () => {
  const key = process.argv[2], wn = process.argv[3];
  const s = await L.openPaper(key, L.W[wn], {}); const p = s.page; const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(L.W[wn][1] * 0.4)) }); await p.waitForTimeout(800); await L.still(p);
  const tab = await p.evaluate(() => { const t = Array.from(document.querySelectorAll('button')).find(b => /open your notes/i.test(b.getAttribute('aria-label') || b.textContent) && getComputedStyle(b).position === 'fixed'); const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
  const res = { cell: `TABDRAG-${key}-${wn}-default-light`, tab };
  const sep = await B.sepRect(p, 'margin'); res.sep = sep;
  const drag = async (name, y, dx) => {
    const sepNow = await B.sepRect(p, 'margin'); const before = await B.gridWidths(p); const x = sepNow.x + 6;
    await p.mouse.move(x, y); const cursor = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? getComputedStyle(e).cursor + ':' + (e.closest('[role=separator]') ? 'divider' : (e.getAttribute('aria-label') || e.tagName)) : null; }, { x, y });
    await p.mouse.down(); await p.mouse.move(x + dx / 2, y, { steps: 5 }); await p.mouse.move(x + dx, y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(600);
    const after = await B.gridWidths(p); const notes = await p.evaluate(() => !!document.querySelector('section[aria-label="Your notes"]'));
    res[name] = { y: Math.round(y), cursor, marginBefore: before.margin, marginAfter: after.margin, notesWindowOpened: notes };
    if (notes) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
  };
  await drag('atTabHeight', tab.y + tab.h / 2, -60);
  await drag('clearOfTab', (tab.y + tab.h + 40 < L.W[wn][1] - 50) ? tab.y + tab.h + 40 : tab.y - 40, -60);
  res.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${L.R}/pack/${res.cell}.json`, JSON.stringify(res, null, 1));
  console.log(res.cell, JSON.stringify(res.atTabHeight), JSON.stringify(res.clearOfTab));
  await s.browser.close();
})();
