const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  for (const [key, withCards] of [['P2', true], ['P2', false], ['P1', true], ['P3', true]]) {
    const s = await L.openPaper(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
    if (withCards) { await C.openSticky(p, paras[4], { y: 300 }); await C.openExplain(p, paras[6], { y: 300 }).catch(() => {}); }
    await C.scrollParaTo(p, paras[8], 82); await L.still(p);
    const snap = async () => p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; return { y: Math.round(scrollY), top: +e.getBoundingClientRect().top.toFixed(1) }; }, paras[8]);
    const a = await snap(); const out = { W1: a };
    for (const [n, vp] of [['W3', L.W.W3], ['W1b', L.W.W1], ['W4', L.W.W4], ['W1c', L.W.W1]]) { await p.setViewportSize({ width: vp[0], height: vp[1] }); await p.waitForTimeout(1200); await L.still(p); out[n] = await snap(); }
    console.log(key, withCards ? 'cards' : 'nocards', JSON.stringify(out)); L.fs.writeFileSync(L.R + '/pack/PLACE-' + key + '-' + (withCards ? 'cards' : 'nocards') + '-W1-default-light.json', JSON.stringify({ cell: 'PLACE-' + key + '-' + (withCards ? 'cards' : 'nocards'), note: 'the paragraph reading at the masthead, scrollY and its top at W1, W3, W1, W4, W1; sticky + Explain open when cards', snapshots: out, pageerrors: s.log.pageerrors }, null, 1));
    await s.browser.close();
  }
})();
