const L = require('./lib2.cjs');
(async () => {
  const urls = JSON.parse(L.fs.readFileSync(L.R + '/urls.json'));
  const browser = await L.chromium.launch();
  const ctx = await browser.newContext({ storageState: L.R + '/base-state.json' });
  for (const [k, pg, fig] of [['P1', 2, 1], ['P1', 5, 3], ['P1', 8, 6], ['P2', 2, 1], ['P3', 4, 8], ['P3', 2, 1]]) {
    const id = urls[k].split('/papers/')[1];
    const r = await ctx.request.get(L.BASE + '/api/papers/' + id + '/figure-image?page=' + pg + '&fig=' + fig + '&v=3');
    const h = r.headers(); const b = (await r.body());
    console.log(k, pg, fig, r.status(), 'len', b.length, 'ct', h['content-type'], Object.keys(h).filter(x => /figure|engine|x-/.test(x)).map(x => x + '=' + h[x]).join(' '), r.status() !== 200 ? b.toString().slice(0, 160) : '');
  }
  await browser.close();
})();
