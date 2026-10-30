const L = require('./lib2.cjs');
(async () => {
  for (const prof of ['nokey', 'key']) {
    const s = prof === 'key' ? await L.openKey('P1', L.W.W1, { settle: 3000 }) : await L.openPaper('P1', L.W.W1, { settle: 3000 });
    const p = s.page; const got = [];
    p.on('response', async r => { if (/\/api\/papers\/report|\/api\/figure$/.test(r.url())) { try { const t = await r.text(); got.push({ u: r.url().replace(L.BASE, '').replace(/upload%3A[0-9a-f]+/, 'upload:ID'), status: r.status(), req: (r.request().postData() || '').length, bytes: t.length, head: t.slice(0, 160).replace(/"[^"]{40,}"/g, '"…"') }); } catch (e) {} } });
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await p.waitForTimeout(12000);
    console.log(prof, JSON.stringify(got, null, 0).slice(0, 900));
    await s.browser.close();
  }
})();
