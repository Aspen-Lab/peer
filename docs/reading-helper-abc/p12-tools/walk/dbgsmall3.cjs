const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openKey('P1', L.W.W1, {}); const p = s.page;
  await L.setStep(p, 0); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const paras = await C.goodParas(p);
  await C.openExplain(p, paras[3], { y: 300, wait: 1800 });
  const idx = paras[5];
  await C.scrollParaTo(p, idx, 300);
  const box = await p.evaluate((idx) => { const e = document.querySelectorAll('#paper-body p')[idx]; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { x: r.x, y: r.y, w: r.width, h: r.height, lh: cs.lineHeight, fs: cs.fontSize, us: cs.userSelect, pe: cs.pointerEvents }; }, idx);
  console.log('box', JSON.stringify(box));
  for (const dy of [8, 14, 20, 40, 60]) {
    const y = box.y + dy; const el = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? e.tagName + '.' + String(e.className).slice(0, 40) + (e.closest('#paper-body p') ? ' in-p' : '') : null; }, { x: box.x + 60, y });
    await p.mouse.move(box.x + 30, y); await p.mouse.down(); await p.mouse.move(box.x + 160, y, { steps: 5 }); await p.mouse.move(box.x + 330, y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(900);
    const sel = await p.evaluate(() => getSelection().toString().length);
    console.log('dy', dy, 'y', Math.round(y), 'element', el, 'selection chars', sel, 'toolbar', !!(await C.toolbar(p)));
    await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
  }
  await s.browser.close();
})();
