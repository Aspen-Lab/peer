const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
async function trial(label, waitBefore, hitFirst) {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); const idx = paras[5];
  await C.scrollParaTo(p, idx, 300);
  const box = await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }, idx);
  if (waitBefore) await p.waitForTimeout(waitBefore);
  const out = [];
  for (const dy of [10, 18, 40]) {
    const y = box.y + dy;
    if (hitFirst) await p.evaluate(({ x, y }) => document.elementFromPoint(x, y) && 1, { x: box.x + 30, y });
    await p.mouse.move(box.x + 30, y); await p.mouse.down(); await p.mouse.move(box.x + 160, y, { steps: 5 }); await p.mouse.move(box.x + 330, y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(900);
    out.push(`@${dy}:${await p.evaluate(() => getSelection().toString().length)}`);
    await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
  }
  console.log(label, 'wait', waitBefore, out.join(' '));
  await s.browser.close();
}
(async () => { await trial('A', 0, false); await trial('B', 0, false); await trial('C', 700, false); await trial('D', 0, true); })();
