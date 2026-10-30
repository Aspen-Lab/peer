const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
async function trial(label, step, openCard, key) {
  const s = key ? await L.openKey('P1', L.W.W1, {}) : await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  if (step !== 2) await L.setStep(p, step); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p);
  if (openCard) await C.openExplain(p, paras[3], { y: 300, wait: 1800 });
  const out = [];
  for (const k of [5, 4]) {
    const idx = paras[k];
    await C.scrollParaTo(p, idx, 300);
    const box = await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }, idx);
    for (const dy of [10, 18, 40]) {
      const y = box.y + dy;
      await p.mouse.move(box.x + 30, y); await p.mouse.down(); await p.mouse.move(box.x + 160, y, { steps: 5 }); await p.mouse.move(box.x + 330, y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(900);
      out.push(`p${k}@${dy}:${await p.evaluate(() => getSelection().toString().length)}`);
      await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
    }
  }
  console.log(label, out.join(' '));
  await s.browser.close();
}
(async () => {
  await trial('nokey smallest nocard', 0, false, false);
  await trial('nokey default nocard', 2, false, false);
  await trial('key smallest nocard', 0, false, true);
  await trial('key default card', 2, true, true);
  await trial('key smallest card', 0, true, true);
})();
