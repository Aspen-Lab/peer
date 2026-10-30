const L = require('./lib.cjs');
(async () => {
  const s = await L.newSession();
  await L.skipSetup(s.page);
  const urls = {};
  for (const k of ['P1','P2']) {
    const t0 = Date.now();
    try { urls[k] = await L.upload(s.page, k); } catch (e) { urls[k] = 'ERR ' + e.message.slice(0,200); }
    await s.page.waitForTimeout(6000);
    const n = await s.page.evaluate(() => document.querySelector('#paper-body') ? document.querySelector('#paper-body').innerText.length : -1);
    console.log(k, urls[k], 'bodylen', n, 'ms', Date.now() - t0);
  }
  await s.ctx.storageState({ path: L.R + '/base-state.json' });
  L.fs.writeFileSync(L.R + '/urls.json', JSON.stringify(urls, null, 1));
  console.log('pageerrors', JSON.stringify(s.log.pageerrors));
  await s.browser.close();
})();
