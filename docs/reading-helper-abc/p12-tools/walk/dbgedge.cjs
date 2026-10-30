const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openPaper(process.argv[2] || 'P1', L.W[process.argv[3] || 'W1'], {}); const p = s.page; const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: 300 }); await p.waitForTimeout(800); await L.still(p);
  const r = await p.evaluate(() => {
    const strip = document.querySelector('[data-reader-divider="margin"]').getBoundingClientRect();
    const out = { strip: [strip.x, strip.right, strip.top, strip.bottom], pts: [] };
    const y = 350;
    for (let dx = 8; dx <= 12.01; dx += 0.25) { const x = strip.x + dx; const e = document.elementFromPoint(x, y); const r = e ? e.getBoundingClientRect() : null; out.pts.push({ x: +x.toFixed(2), tag: e && e.tagName, attr: e && (e.getAttribute('data-margin-card') || e.getAttribute('data-reader-divider') || e.getAttribute('aria-label')), rect: r && [r.x, r.right, r.top, r.bottom].map(v => +v.toFixed(2)), cursor: e && getComputedStyle(e).cursor, cls: e && (typeof e.className === 'string' ? e.className.slice(0, 80) : '') }); }
    const card = document.querySelector('[data-margin-card]'); const cs = getComputedStyle(card);
    out.card = { rect: [card.getBoundingClientRect().x, card.getBoundingClientRect().right], tag: card.tagName, ml: cs.marginLeft, outline: cs.outline, boxShadow: cs.boxShadow.slice(0, 80), border: cs.borderLeftWidth, pos: cs.position, left: cs.left, transform: cs.transform };
    const par = card.parentElement; const ps = getComputedStyle(par); out.parent = { tag: par.tagName, cls: String(par.className).slice(0, 100), rect: [par.getBoundingClientRect().x, par.getBoundingClientRect().right], ml: ps.marginLeft, pl: ps.paddingLeft, pos: ps.position };
    return out;
  });
  console.log(JSON.stringify(r, null, 1));
  await s.browser.close();
})();
