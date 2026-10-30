const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./cell_cards.cjs');
(async () => {
  const key = process.argv[2]; const s = await L.openKey(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
  const res = { cell: `LONE2-${key}-W1-default-light`, runs: [] };
  const info = async () => (await C.cardsInfo(p)).cards.map(c => [c.kind, Math.round(c.rect.h), Math.round(c.rect.top)]);
  for (const drag of [false, true]) {
    await C.closeAll(p); const run = { drag, steps: [] };
    await C.openExplain(p, paras[3], { y: 300, wait: 1800 }); await C.openSticky(p, paras[5], { y: 300, wait: 900 }); await C.openFigure(p, 1, { wait: 1800 });
    run.three = await info();
    if (drag) { const ci = await C.cardsInfo(p); const dv = ci.divs[0]; const cx = ci.cards[0].rect.left + ci.cards[0].rect.w / 2, cy = dv.rect.top + dv.rect.h / 2; await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 25, { steps: 4 }); await p.mouse.move(cx, cy + 50, { steps: 4 }); await p.mouse.up(); await p.waitForTimeout(500); run.afterDrag = await info(); }
    await C.closeKind(p, 'explain'); await p.waitForTimeout(600); run.steps.push(['closed explain', await info()]);
    await C.closeKind(p, 'sticky'); await p.waitForTimeout(900); await L.still(p); run.steps.push(['closed sticky', await info()]);
    const cs = await p.evaluate(() => { const c = document.querySelector('[data-margin-card=figure]'); const m = document.querySelector('[data-reader-margin]'); return { card: c && Math.round(c.getBoundingClientRect().height), margin: m && Math.round(m.getBoundingClientRect().height), track: (document.querySelector('[data-split]') || {}).dataset ? document.querySelector('[data-split]').dataset.split : null }; });
    run.final = cs; await p.screenshot({ path: `${L.R}/pack/LONE2-${key}-W1-drag${drag}.png` });
    res.runs.push(run);
  }
  res.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${L.R}/pack/${res.cell}.json`, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res.runs));
  await s.browser.close();
})();
