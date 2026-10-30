const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const key = process.argv[2]; const s = await L.openKey(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
  const res = { cell: `LONE-${key}-W1-default-light` };
  await C.closeAll(p);
  await C.openFigure(p, 1, { wait: 2000 }); res.figureAlone = (await C.cardsInfo(p)).cards.map(c => [c.kind, Math.round(c.rect.h), Math.round(c.rect.top)]);
  await p.screenshot({ path: `${L.R}/pack/LONE-${key}-W1-figure-alone.png` });
  await C.openSticky(p, paras[4], { y: 300, wait: 1000 }); res.figurePlusSticky = (await C.cardsInfo(p)).cards.map(c => [c.kind, Math.round(c.rect.h), Math.round(c.rect.top)]);
  await C.closeKind(p, 'sticky'); await p.waitForTimeout(800); await L.still(p); res.figureAfterStickyClosed = (await C.cardsInfo(p)).cards.map(c => [c.kind, Math.round(c.rect.h), Math.round(c.rect.top), c.body && Math.round(c.body.rect.h)]);
  await p.screenshot({ path: `${L.R}/pack/LONE-${key}-W1-figure-after-sticky-closed.png` });
  res.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${L.R}/pack/${res.cell}.json`, JSON.stringify(res, null, 1)); console.log(JSON.stringify(res));
  await s.browser.close();
})();
