const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openKey('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); console.log('paras', paras.length, paras.slice(0, 12).join(','));
  await C.openExplain(p, paras[3], { y: 300, wait: 1800 });
  console.log('cards', JSON.stringify((await C.cardsInfo(p)).cards.map(c => c.kind)));
  for (const k of [5, 7, 6, 4]) {
    const idx = paras[k];
    const info = await p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; const r = e.getBoundingClientRect(); return { len: e.textContent.length, w: Math.round(r.width), h: Math.round(r.height), childTags: Array.from(e.children).map(c => c.tagName).slice(0, 6).join(',') }; }, idx);
    const sel = await C.selectPara(p, idx, { y: 300, noRetry: false });
    const tb = await C.toolbar(p);
    console.log('para', k, JSON.stringify(info), 'sel', JSON.stringify(sel), 'toolbar', tb && tb.buttons.map(b => b.name).join('|'));
    await p.screenshot({ path: L.R + '/probe-small2-' + k + '.png' });
    await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(400);
  }
  await s.browser.close();
})();
