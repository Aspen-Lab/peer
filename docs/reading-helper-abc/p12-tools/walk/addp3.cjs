const L = require('./lib.cjs');
(async () => {
  for (const [state, urlsFile] of [['key-state.json', 'urls-key.json']]) {
    const browser = await L.chromium.launch();
    const ctx = await browser.newContext({ storageState: L.R + '/' + state, viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', e => errs.push(String(e).slice(0, 200)));
    const url = await L.upload(p, 'P3'); await p.waitForTimeout(6000);
    await ctx.storageState({ path: L.R + '/' + state });
    const urls = JSON.parse(L.fs.readFileSync(L.R + '/' + urlsFile)); urls.P3 = url;
    L.fs.writeFileSync(L.R + '/' + urlsFile, JSON.stringify(urls, null, 1));
    console.log(state, url, 'pageerrors', errs.length);
    await browser.close();
  }
})();
