const L = require('./lib.cjs');
(async () => {
  const browser = await L.chromium.launch();
  const ctx = await browser.newContext({ storageState: L.R + '/key-profile-pre.json', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  const log = { pageerrors: [] };
  p.on('pageerror', e => log.pageerrors.push(String(e).slice(0, 300)));
  const st = await (async () => { await p.goto(L.BASE + '/', { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(2500); return p.evaluate(() => { const o = {}; for (const k of Object.keys(localStorage)) { const v = localStorage.getItem(k); o[k] = v.length + ':' + (/feedAiProvider":"(\w+)"/.exec(v) || [])[1] + ':hasKey=' + /feedAiApiKey":"[^"]+"/.test(v); } return o; }); })();
  console.log(JSON.stringify(st));
  const urls = {};
  for (const k of ['P1', 'P2', 'P3']) { urls[k] = await L.upload(p, k); await p.waitForTimeout(6000); console.log(k, urls[k]); }
  await ctx.storageState({ path: L.R + '/key-state.json' });
  L.fs.writeFileSync(L.R + '/urls-key.json', JSON.stringify(urls, null, 1));
  console.log('pageerrors', JSON.stringify(log.pageerrors));
  await browser.close();
})();
