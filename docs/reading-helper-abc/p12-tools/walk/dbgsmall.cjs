const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openKey('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); console.log('paras', JSON.stringify(paras));
  const out = [];
  await C.closeAll(p);
  const e = await C.openExplain(p, paras[Math.min(paras.length - 1, 3)], { y: 300, wait: 1800 }); out.push(['explain', e && e.len, JSON.stringify((await C.cardsInfo(p)).cards.map(c => c.kind))]);
  for (const k of [5, 7]) {
    const sel = await C.selectPara(p, paras[Math.min(paras.length - 1, k)], { y: 300, noRetry: true });
    const t = await C.toolbar(p);
    out.push(['select para idx ' + paras[Math.min(paras.length - 1, k)], sel && sel.len, sel && sel.toolbarMissing, t && t.buttons.map(b => b.name)]);
    await p.screenshot({ path: L.R + '/probe-small-' + k + '.png' });
  }
  console.log(JSON.stringify(out));
  await s.browser.close();
})();
