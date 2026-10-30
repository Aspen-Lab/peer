// the fixed notes tab (with a card open) against the margin pane divider: overlap, and what a real press at the overlap does
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const key = process.argv[2], wn = process.argv[3];
  const s = await L.openPaper(key, L.W[wn], {}); const p = s.page;
  const paras = await C.goodParas(p);
  const res = { cell: `TABDIV-${key}-${wn}-default-light`, load: require('os').loadavg()[0] };
  const info = async () => p.evaluate(() => {
    const rr = e => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const tab = Array.from(document.querySelectorAll('body *')).find(e => getComputedStyle(e).position === 'fixed' && /notes/i.test((e.getAttribute('aria-label') || e.textContent || '')) && e.getBoundingClientRect().height > 30 && e.getBoundingClientRect().width < 140 && e.getBoundingClientRect().x > innerWidth * 0.4);
    const divs = Array.from(document.querySelectorAll('[role=separator]')).map(d => ({ label: d.getAttribute('aria-label'), orient: d.getAttribute('aria-orientation'), rect: rr(d) }));
    return { tab: rr(tab), tabLabel: tab ? (tab.getAttribute('aria-label') || tab.textContent.trim()).slice(0, 30) : null, divs, vw: innerWidth, vh: innerHeight };
  });
  res.noCard = await info();
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(L.W[wn][1] * 0.4)) }); await p.waitForTimeout(800); await L.still(p);
  res.sticky = await info();
  // the point of the margin divider (vertical one) at the tab's mid-height: who is on top?
  const v = res.sticky.divs.find(d => d.orient !== 'horizontal' && d.rect && d.rect.h > 200 && d.rect.w < 30 && d.rect.x > res.sticky.vw * 0.4);
  if (v && res.sticky.tab) {
    const ox = Math.max(0, Math.min(res.sticky.tab.x + res.sticky.tab.w, v.rect.x + v.rect.w) - Math.max(res.sticky.tab.x, v.rect.x)); const oy = Math.max(0, Math.min(res.sticky.tab.y + res.sticky.tab.h, v.rect.y + v.rect.h) - Math.max(res.sticky.tab.y, v.rect.y));
    res.overlapWithMarginDivider = { w: +ox.toFixed(1), h: +oy.toFixed(1), area: +(ox * oy).toFixed(1), divider: v.rect };
    const probes = [];
    for (let k = 0; k < 5; k++) { const y = res.sticky.tab.y + (res.sticky.tab.h * (k + 0.5)) / 5; const x = v.rect.x + v.rect.w / 2; probes.push(await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const sep = e && e.closest('[role=separator]'); return { y: Math.round(y), onDivider: !!sep, tag: e ? e.tagName + ':' + (e.getAttribute('aria-label') || e.textContent || '').trim().slice(0, 24) : null, cursor: e ? getComputedStyle(e).cursor : null }; }, { x, y })); }
    res.probesAtDividerCentre = probes;
  }
  await p.screenshot({ path: `${L.R}/pack/TABDIV-${key}-${wn}-default-light.png` });
  res.pageerrors = s.log.pageerrors;
  L.fs.writeFileSync(`${L.R}/pack/${res.cell}.json`, JSON.stringify(res, null, 1));
  console.log(res.cell, JSON.stringify(res.overlapWithMarginDivider), JSON.stringify(res.probesAtDividerCentre));
  await s.browser.close();
})();
