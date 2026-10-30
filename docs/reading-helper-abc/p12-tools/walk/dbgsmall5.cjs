const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p); const idx = paras[5];
  await C.scrollParaTo(p, idx, 300);
  const info = await p.evaluate((idx) => {
    const e = document.querySelectorAll('#paper-body p')[idx]; const r = e.getBoundingClientRect();
    const rects = []; const rg = document.createRange(); rg.selectNodeContents(e); const cr = Array.from(rg.getClientRects()).slice(0, 4).map(q => [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]);
    const prev = e.previousElementSibling; const pr = prev && prev.getBoundingClientRect();
    return { p: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], firstRects: cr, prev: prev && [prev.tagName, Math.round(pr.y), Math.round(pr.height)], html: e.innerHTML.slice(0, 120).replace(/[A-Za-z]{5,}/g, 'w') };
  }, idx);
  console.log(JSON.stringify(info));
  const r = info.p;
  for (const [x0, x1, dy] of [[30, 330, 10], [100, 330, 10], [30, 330, 12], [200, 500, 10], [30, 530, 10]]) {
    const y = r[1] + dy;
    const hit = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? e.tagName : null; }, { x: r[0] + x0, y });
    await p.mouse.move(r[0] + x0, y); await p.mouse.down(); await p.mouse.move(r[0] + (x0 + x1) / 2, y, { steps: 5 }); await p.mouse.move(r[0] + x1, y, { steps: 5 });
    const during = await p.evaluate(() => getSelection().toString().length);
    await p.mouse.up(); await p.waitForTimeout(900);
    const after = await p.evaluate(() => getSelection().toString().length);
    console.log('x0', x0, 'x1', x1, 'dy', dy, 'startHit', hit, 'selection during drag', during, 'after mouseup', after);
    await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
  }
  await s.browser.close();
})();
