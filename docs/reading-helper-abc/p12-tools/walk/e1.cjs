// E1 probe: the fixed "Open your notes" tab against the fixed key legend and the viewport (no card, and with a sticky card open), W1..W3
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const PACK = L.R + '/pack';
async function fixedInfo(p) {
  return p.evaluate(() => {
    const out = []; const vh = innerHeight, vw = innerWidth;
    for (const e of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(e); if (cs.position !== 'fixed') continue; const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) continue;
      const t = (e.getAttribute('aria-label') || e.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 30);
      out.push({ tag: e.tagName, label: t, x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1), bottom: +r.bottom.toFixed(1), right: +r.right.toFixed(1), belowViewport: +Math.max(0, r.bottom - vh).toFixed(1), rightOverflow: +Math.max(0, r.right - vw).toFixed(1) });
    }
    return { vw, vh, fixed: out };
  });
}
async function run(key, wname) {
  const s = await L.openPaper(key, L.W[wname], {}); const p = s.page;
  const res = { cell: `${key}-${wname}-default-light`, input: key, width: wname, viewport: L.W[wname], load: require('os').loadavg()[0] };
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const one = async (tag) => {
    const info = await fixedInfo(p);
    const tab = info.fixed.find(f => /notes/i.test(f.label) && f.h > 30 && f.w < 140 && f.x > info.vw * 0.5);
    const legend = info.fixed.find(f => /next.*prev|j next|esc/i.test(f.label) && f.w > 200);
    let overlap = null;
    if (tab && legend) { const ox = Math.max(0, Math.min(tab.right, legend.x + legend.w) - Math.max(tab.x, legend.x)), oy = Math.max(0, Math.min(tab.bottom, legend.bottom) - Math.max(tab.y, legend.y)); overlap = { w: +ox.toFixed(1), h: +oy.toFixed(1), area: +(ox * oy).toFixed(1) }; }
    // legend words under the tab: text rects of the legend intersecting the tab
    const words = await p.evaluate(({ tab }) => { if (!tab) return null; const lg = Array.from(document.querySelectorAll('body *')).filter(e => getComputedStyle(e).position === 'fixed' && /next/i.test(e.textContent) && e.getBoundingClientRect().width > 200)[0]; if (!lg) return null; let n = 0; const w = document.createTreeWalker(lg, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const nd = w.currentNode; if (!nd.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(nd); for (const r of rg.getClientRects()) { const ox = Math.max(0, Math.min(tab.right, r.right) - Math.max(tab.x, r.left)), oy = Math.max(0, Math.min(tab.bottom, r.bottom) - Math.max(tab.y, r.top)); if (ox * oy > 0) n++; } } return n; }, { tab });
    res[tag] = { tab, legend, overlap, legendTextRectsUnderTab: words, fixedCount: info.fixed.length };
    return info;
  };
  await one('noCard');
  await p.screenshot({ path: `${PACK}/E1-${res.cell}-nocard.png`, clip: { x: 0, y: Math.max(0, L.W[wname][1] - 200), width: L.W[wname][0], height: 200 } });
  const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(L.W[wname][1] * 0.4)) });
  await p.waitForTimeout(800); await L.still(p);
  await one('stickyOpen');
  await p.screenshot({ path: `${PACK}/E1-${res.cell}-sticky.png`, clip: { x: 0, y: Math.max(0, L.W[wname][1] - 200), width: L.W[wname][0], height: 200 } });
  await C.closeAll(p);
  res.pageerrors = s.log.pageerrors;
  L.fs.writeFileSync(`${PACK}/E1-${res.cell}.json`, JSON.stringify(res, null, 1));
  await s.browser.close(); return res;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3]).then(r => console.log(r.cell, 'noCard', JSON.stringify([r.noCard.tab, r.noCard.legend, r.noCard.overlap, r.noCard.legendTextRectsUnderTab]), 'sticky', JSON.stringify([r.stickyOpen.tab && [r.stickyOpen.tab.x, r.stickyOpen.tab.y, r.stickyOpen.tab.belowViewport], r.stickyOpen.overlap, r.stickyOpen.legendTextRectsUnderTab]))).catch(e => { console.error('ERR', e); process.exit(1); });
