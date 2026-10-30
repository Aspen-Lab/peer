const L = require('./lib2.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  const st = () => p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); const sh = document.querySelector('[data-reader-shell]'); const r = document.querySelector('[data-reader-rail]'); const rb = r && r.getBoundingClientRect(); return { left: l && l.getAttribute('data-state'), shell: sh && sh.getAttribute('data-left-state'), rail: rb && [Math.round(rb.x), Math.round(rb.y), Math.round(rb.width), Math.round(rb.height)] }; });
  console.log('start', JSON.stringify(await st()));
  await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await p.waitForTimeout(800);
  console.log('collapsed', JSON.stringify(await st()));
  const rail = p.locator('[data-reader-rail]').first();
  const bb = await rail.boundingBox(); console.log('rail box', JSON.stringify(bb));
  await p.mouse.move(700, 400); await p.waitForTimeout(300);
  await p.mouse.move(bb.x + bb.width / 2, bb.y + 40, { steps: 8 });
  const seq = []; for (let i = 0; i < 12; i++) { await p.waitForTimeout(250); seq.push((await st()).left); }
  console.log('hover seq', JSON.stringify(seq));
  await rail.hover(); await p.waitForTimeout(2000); console.log('after locator.hover 2s', JSON.stringify(await st()));
  await s.browser.close();
})();
