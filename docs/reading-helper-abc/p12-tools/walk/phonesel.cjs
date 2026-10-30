const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  for (const [wn, prof] of [['W4', 'key'], ['W4', 'nokey'], ['W1', 'key'], ['W1', 'nokey']]) {
    const s = prof === 'key' ? await L.openKey('P1', L.W[wn], {}) : await L.openPaper('P1', L.W[wn], {}); const p = s.page;
    const paras = await C.goodParas(p); const out = [];
    for (const [x1, label] of [[120, 'short'], [250, 'mid'], [330, 'long']]) {
      await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
      const sel = await C.selectPara(p, paras[4], { y: 300, x0: 20, x1, noRetry: false });
      const t = await C.toolbar(p); out.push(label + ':' + (sel ? sel.len : 0) + ':' + (t ? t.buttons.map(b => b.name.split(' ')[0]).join('/') : 'none'));
    }
    console.log(wn, prof, out.join(' | '));
    await s.browser.close();
  }
})();
