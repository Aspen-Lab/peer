// where do the left pane, the two strips and the margin start when the page is scrolled (C P12-89's open point 2: the strip's top)
const L = require('./lib2.cjs'); const PACK = L.R + '/pack';
(async () => {
  const key = process.argv[2]; const s = await L.openPaper(key, L.W.W1, {}); const p = s.page; const res = { cell: `R4TOP-${key}-W1-default-light`, states: {} };
  for (const [lab, f] of [['top', 0], ['mid', 0.5]]) {
    await p.evaluate((f) => window.scrollTo(0, Math.round((document.documentElement.scrollHeight - innerHeight) * f)), f); await L.still(p); await p.waitForTimeout(300);
    res.states[lab] = await p.evaluate(() => { const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) }; }; const mast = document.querySelector('header'); return { scrollY: Math.round(scrollY), masthead: r(mast), left: r(document.querySelector('[data-reader-left]')), leftHeader: r(document.querySelector('[data-reader-left-header]')), stripLeft: r(document.querySelector('[data-reader-divider="left"]')), stripMargin: r(document.querySelector('[data-reader-divider="margin"]')), margin: r(document.querySelector('[data-reader-margin]')) }; });
    await p.screenshot({ path: `${PACK}/${res.cell}-${lab}.png`, clip: { x: 0, y: 0, width: 1440, height: 160 } });
  }
  L.fs.writeFileSync(`${PACK}/${res.cell}.json`, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res.states)); await s.browser.close();
})();
