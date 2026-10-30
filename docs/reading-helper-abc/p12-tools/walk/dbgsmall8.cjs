const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
async function trial(label, intCoords, evalDuring, dy0) {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); const idx = paras[5];
  await C.scrollParaTo(p, idx, 300);
  const box = await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y }; }, idx);
  const out = [];
  for (const dy of [dy0]) {
    let y = box.y + dy, x = box.x + 30; if (intCoords) { y = Math.round(y); x = Math.round(x); }
    await p.mouse.move(x, y); await p.mouse.down(); await p.mouse.move(x + 130, y, { steps: 5 }); await p.mouse.move(x + 300, y, { steps: 5 });
    if (evalDuring) out.push('during:' + await p.evaluate(() => getSelection().toString().length));
    await p.mouse.up(); await p.waitForTimeout(900);
    out.push(`after:${await p.evaluate(() => getSelection().toString().length)}`);
  }
  console.log(label, 'y=', box.y + dy0, out.join(' '));
  await s.browser.close();
}
(async () => { await trial('frac', false, false, 10); await trial('int', true, false, 10); await trial('frac+evalDuring', false, true, 10); await trial('frac dy 14', false, false, 14); await trial('frac dy 28', false, false, 28); })();
