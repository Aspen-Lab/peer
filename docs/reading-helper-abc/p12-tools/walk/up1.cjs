// entry: upload P1, P2, P3 through the UI in a fresh no-key profile; measure the body's arrival with no reload (C P12-58)
const L = require('./lib2.cjs');
(async () => {
  const s = await L.newSession();
  const urls = {}; const timeline = {};
  await L.skipSetup(s.page);
  for (const k of ['P1', 'P2', 'P3']) {
    const t0 = Date.now();
    let url;
    try { url = await L.upload(s.page, k); } catch (e) { url = 'ERR ' + e.message.slice(0, 200); }
    urls[k] = url;
    const tl = []; let navCount = 0;
    s.page.on('framenavigated', f => { if (f === s.page.mainFrame()) navCount++; });
    const reqStart = s.log.requests.length;
    for (let i = 0; i < 120; i++) {
      const n = await s.page.evaluate(() => { const b = document.querySelector('#paper-body'); return b ? b.textContent.length : -1; }).catch(() => -2);
      tl.push([Date.now() - t0, n]);
      if (n > 2000 && tl.length > 3 && tl[tl.length - 2][1] === n && tl[tl.length - 3][1] === n) break;
      await s.page.waitForTimeout(1000);
    }
    const reqs = s.log.requests.slice(reqStart).map(r => r.m + ' ' + r.u.replace(/\?.*/, ''));
    const counts = {}; reqs.forEach(r => counts[r] = (counts[r] || 0) + 1);
    timeline[k] = { uploadedUrl: url.replace(L.BASE, ''), firstBodyLenSamples: tl.slice(0, 12), final: tl[tl.length - 1], secondsToStableBody: tl.length ? tl[tl.length - 1][0] / 1000 : null, navigationsAfterUpload: navCount, requestCounts: counts, load: require('os').loadavg()[0] };
    console.log(k, url, JSON.stringify(timeline[k].final), 'navs', navCount);
  }
  await s.ctx.storageState({ path: L.R + '/base-state.json' });
  L.fs.writeFileSync(L.R + '/urls.json', JSON.stringify(urls, null, 1));
  L.fs.writeFileSync(L.R + '/pack/ENTRY-upload-timeline.json', JSON.stringify({ timeline, pageerrors: s.log.pageerrors, console: s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]/.test(c.text)) }, null, 1));
  console.log('pageerrors', JSON.stringify(s.log.pageerrors));
  await s.browser.close();
})();
