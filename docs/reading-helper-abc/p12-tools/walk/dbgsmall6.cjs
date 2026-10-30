const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); const idx = paras[5];
  const imgs = () => p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure img')).map(i => [i.complete, Math.round(i.getBoundingClientRect().height), i.loading]));
  console.log('imgs before', JSON.stringify(await imgs()));
  await C.scrollParaTo(p, idx, 300);
  const ys = [];
  for (let i = 0; i < 8; i++) { ys.push(await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; return [Math.round(e.getBoundingClientRect().y * 10) / 10, Math.round(scrollY)]; }, idx)); await p.waitForTimeout(500); }
  console.log('para y / scrollY over 4 s', JSON.stringify(ys));
  console.log('imgs after', JSON.stringify(await imgs()));
  await s.browser.close();
})();
