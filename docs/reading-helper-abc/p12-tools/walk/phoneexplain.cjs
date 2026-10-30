const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const PACK = L.R + '/pack';
(async () => {
  const res = {};
  for (const k of ['P1', 'P2', 'P3']) {
    const s = await L.openKey(k, L.W.W4, {}); const p = s.page; const paras = await C.goodParas(p);
    const sel = await C.selectPara(p, paras[4], { y: 300, x0: 20, x1: 300 });
    const t = await C.toolbar(p);
    await p.getByRole('button', { name: /^Explain this\??$/ }).first().click({ timeout: 20000, noWaitAfter: true });
    await p.waitForTimeout(3000);
    const ci = await C.cardsInfo(p);
    res[k] = { selLen: sel && sel.len, offered: t && t.buttons.map(b => b.name), cards: ci.cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h })), pageerrors: s.log.pageerrors.length };
    await p.screenshot({ path: `${PACK}/B6-explain-${k}-W4-default-light-key.png` });
    await s.browser.close();
  }
  L.fs.writeFileSync(`${PACK}/B6phoneExplain-W4-default-light-key.json`, JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res));
})();
