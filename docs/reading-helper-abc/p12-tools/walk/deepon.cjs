const L = require('./lib2.cjs');
(async () => {
  const browser = await L.chromium.launch();
  const ctx = await browser.newContext({ storageState: L.R + '/key-state.json', viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(L.BASE + '/profile', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(3500);
  await p.getByRole('button', { name: 'Edit' }).first().click(); await p.waitForTimeout(1200);
  const t = p.locator('[aria-label="Deep report"]').first();
  console.log('before', await t.getAttribute('aria-checked'));
  await t.click(); await p.waitForTimeout(700);
  console.log('after', await t.getAttribute('aria-checked'));
  await p.getByRole('button', { name: 'Done' }).first().click(); await p.waitForTimeout(800);
  const v = await p.evaluate(() => /deepReportEnabled":true/.test(localStorage.getItem('peer-profile') || ''));
  console.log('stored deepReportEnabled', v);
  await ctx.storageState({ path: L.R + '/key-state.json' });
  await browser.close();
})();
