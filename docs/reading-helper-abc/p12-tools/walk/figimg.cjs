// save each inline figure image of a paper as the app serves it (private pack), with its page and fig numbers from the src; plus the Summary plate's
const L = require('./lib2.cjs');
(async () => {
  const key = process.argv[2];
  const s = await L.openPaper(key, L.W.W1, { settle: 6000 }); const p = s.page;
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 900; y += 450) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(250); }
  await p.waitForTimeout(2500);
  const imgs = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure img')).map(i => i.getAttribute('src')));
  L.fs.mkdirSync(L.R + '/pack/figimg', { recursive: true });
  const out = [];
  for (const src of imgs) {
    const m = /page=(\d+)&fig=(\d+)/.exec(src || ''); const name = m ? `${key}-fig${m[2]}-p${m[1]}` : `${key}-img${out.length}`;
    const r = await p.request.get(L.BASE + src); const buf = await r.body();
    L.fs.writeFileSync(`${L.R}/pack/figimg/${name}.png`, buf); out.push({ name, status: r.status(), bytes: buf.length, ct: r.headers()['content-type'] });
  }
  console.log(key, JSON.stringify(out));
  await s.browser.close();
})();
