const L = require('./lib2.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W2, {}); const p = s.page;
  const st = () => p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); const sh = document.querySelector('[data-reader-shell]'); return [l && l.getAttribute('data-state'), sh && sh.getAttribute('data-left-state')].join('/'); });
  console.log('start', await st());
  const rail = p.locator('[data-reader-rail]').first(); await rail.hover(); await p.waitForTimeout(1600); console.log('after hover', await st());
  await p.getByRole('tab', { name: 'Summary' }).click(); await p.mouse.move(700, 400);
  const t0 = Date.now(); const seq = [];
  for (let i = 0; i < 16; i++) { seq.push([Date.now() - t0, await st()]); await p.waitForTimeout(400); }
  console.log(JSON.stringify(seq));
  await p.mouse.move(100, 300); await p.waitForTimeout(500); console.log('mouse over paper area x=100', await st());
  await p.mouse.move(700, 300); await p.waitForTimeout(1500); console.log('mouse away', await st());
  await s.browser.close();
})();
