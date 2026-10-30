const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  const s = await L.openPaper('P2', L.W.W1); const p = s.page; const paras = await C.goodParas(p);
  for (const [name, fn] of [['inPara', () => S.selInPara(p, paras)], ['across', () => S.selAcross(p, paras)], ['heading', () => S.selHeading(p)], ['caption', () => S.selCaption(p)], ['summary', () => S.selSummary(p)]]) {
    const r = await fn(); const names = await S.toolbarNames(p);
    console.log(name, JSON.stringify(r), JSON.stringify(names));
    if (names && names.includes('Highlight')) { await p.getByRole('button', { name: 'Highlight' }).first().click(); await p.waitForTimeout(900); console.log('  marks', JSON.stringify(await S.marksInfo(p)), 'strip', JSON.stringify(await S.strip(p))); await S.removeHighlight(p); console.log('  after remove', JSON.stringify(await S.marksInfo(p))); }
    await S.clearSel(p);
  }
  await s.browser.close();
})();
