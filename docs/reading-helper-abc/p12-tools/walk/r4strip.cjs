// P12-92: the pane dividers' strips against the key legend (C P12-89 rule 2): strip top / bottom, the legend's top, at scroll 0 / middle / end,
// with no card and with a sticky open; optionally under Fit's zoom and at another step. Usage: node r4strip.cjs P1 W1 [fit] [stepIdx]
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
const PACK = L.R + '/pack';
const [, , key, wn, fitArg, stepArg] = process.argv; const fit = fitArg === "fit"; const stepIdx = stepArg === undefined ? 2 : +stepArg;

const probe = (p) => p.evaluate(() => {
  const legendEl = Array.from(document.querySelectorAll('body *')).find(e => getComputedStyle(e).position === 'fixed' && /next/i.test(e.textContent) && e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height < 60);
  const lg = legendEl ? legendEl.getBoundingClientRect() : null;
  const mast = document.querySelector('header'); const mr = mast ? mast.getBoundingClientRect() : null;
  const zoomRoot = document.querySelector('[data-zoom-root]');
  const out = { vw: innerWidth, vh: innerHeight, scrollY: Math.round(scrollY), maxScroll: document.documentElement.scrollHeight - innerHeight, pageZoom: zoomRoot ? getComputedStyle(zoomRoot).getPropertyValue('--page-zoom') || null : null, cssZoom: zoomRoot ? getComputedStyle(zoomRoot).zoom : null, legend: lg ? { top: +lg.top.toFixed(2), bottom: +lg.bottom.toFixed(2), h: +lg.height.toFixed(2) } : null, mastheadBottom: mr ? +mr.bottom.toFixed(2) : null, dividers: {} };
  for (const s of document.querySelectorAll('[data-reader-divider]')) {
    const b = s.getBoundingClientRect(); const pane = s.getAttribute('data-reader-divider');
    // last y whose point is the divider, scanning down from the strip's top in 1 px steps at the strip's centre x (window px)
    let first = null, last = null; const x = b.left + b.width / 2;
    for (let y = Math.max(0, Math.floor(b.top) - 2); y < innerHeight; y += 0.5) { const e = document.elementFromPoint(x, y); const hit = e && e.closest('[data-reader-divider]') === s; if (hit) { if (first === null) first = y; last = y; } }
    const cs = getComputedStyle(s);
    // the visible rule: ::before
    out.dividers[pane] = { top: +b.top.toFixed(2), bottom: +b.bottom.toFixed(2), h: +b.height.toFixed(2), w: +b.width.toFixed(2), x: +b.x.toFixed(2), bottomMinusLegendTop: lg ? +(b.bottom - lg.top).toFixed(2) : null, topMinusMastheadBottom: mr ? +(b.top - mr.bottom).toFixed(2) : null, firstHitY: first, lastHitY: last, lastHitMinusLegendTop: lg && last !== null ? +(last - lg.top).toFixed(2) : null, position: cs.position, maxHeight: cs.maxHeight };
  }
  return out;
});

(async () => {
  const w = /^\d+x\d+$/.test(wn) ? wn.split('x').map(Number) : L.W[wn];
  const s = await L.openPaper(key, w, {}); const p = s.page;
  if (stepIdx !== 2) await L.setStep(p, stepIdx);
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx);
  const cell = `R4STRIP-${key}-${wn}-${stepName}${fit ? '-fit' : ''}-light`;
  const res = { cell, input: key, width: wn, viewport: w, step: stepIdx, fit, load: require('os').loadavg()[0], states: {} };
  if (fit) {
    const btn = p.getByRole('button', { name: 'Fit to screen' });
    if (await btn.count()) { await btn.first().click(); await p.waitForTimeout(1500); } else res.fitButton = 'absent';
  }
  const hash0 = await L.bodyHash(p);
  const at = async (name) => {
    const max = await p.evaluate(() => document.documentElement.scrollHeight - innerHeight);
    res.states[name] = {};
    for (const [lab, f] of [['top', 0], ['mid', 0.5], ['end', 1]]) {
      await p.evaluate((y) => window.scrollTo(0, y), Math.round(max * f)); await L.still(p); await p.waitForTimeout(250);
      res.states[name][lab] = await probe(p);
      await p.screenshot({ path: `${PACK}/${cell}-${name}-${lab}.png`, clip: { x: 0, y: Math.max(0, w[1] - 120), width: w[0], height: 120 } });
    }
    await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  };
  await at('noCard');
  const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(w[1] * 0.4)) }); await p.waitForTimeout(700); await L.still(p);
  await at('sticky');
  await C.closeAll(p);
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = s.log.pageerrors;
  L.fs.writeFileSync(`${PACK}/${cell}.json`, JSON.stringify(res, null, 1));
  const sum = {}; for (const [st, v] of Object.entries(res.states)) for (const [lab, o] of Object.entries(v)) for (const [pane, d] of Object.entries(o.dividers)) sum[`${st}/${lab}/${pane}`] = `bot-legendTop ${d.bottomMinusLegendTop} lastHit-legendTop ${d.lastHitMinusLegendTop} top ${d.top} (mast ${d.topMinusMastheadBottom})`;
  console.log(cell, 'zoom', res.states.noCard.top.pageZoom, res.states.noCard.top.cssZoom, JSON.stringify(sum, null, 0));
  await s.browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
