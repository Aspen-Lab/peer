// does a long selection (several hundred to several thousand characters, across 2-4 blocks) offer Highlight? real click + shift-click, body and Summary, W1 and W3 (no key)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  const out = { cell: 'LONGSEL', runs: [] };
  for (const [key, wn] of [['P3', 'W1'], ['P3', 'W3'], ['P1', 'W1'], ['P2', 'W3']]) {
    const s = await L.openPaper(key, L.W[wn], {}); const p = s.page; const paras = await C.goodParas(p);
    for (const span of [1, 2, 3, 4]) {
      await S.openTab(p, 'Paper digestion').catch(() => {}); await p.waitForTimeout(400);
      const a = paras[4], b = paras[4 + span];
      await C.scrollParaTo(p, a, 220);
      const st = await p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; const r = e.getBoundingClientRect(); return { x: r.x + 40, y: r.y + 14 }; }, a);
      await p.mouse.click(st.x, st.y); await p.waitForTimeout(200);
      await C.scrollParaTo(p, b, 300);
      const en = await p.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; const r = e.getBoundingClientRect(); return { x: r.x + 200, y: r.y + 14 }; }, b);
      await p.keyboard.down('Shift'); await p.mouse.click(en.x, en.y); await p.keyboard.up('Shift');
      let tb = null; for (let i = 0; i < 14; i++) { await p.waitForTimeout(350); tb = await C.toolbar(p); if (tb) break; }
      const len = await p.evaluate(() => { const s = getSelection(); return s && !s.isCollapsed ? s.toString().length : 0; });
      out.runs.push({ key, wn, area: 'body', spanParagraphs: span, selLen: len, offered: tb && tb.buttons.map(b => b.name) });
      await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(300);
    }
    await s.browser.close();
  }
  L.fs.writeFileSync(`${L.R}/pack/LONGSEL.json`, JSON.stringify(out, null, 1));
  for (const r of out.runs) console.log(r.key, r.wn, r.area, 'span', r.spanParagraphs, 'len', r.selLen, 'offered', JSON.stringify(r.offered));
})().catch(e => { console.error('ERR', e); process.exit(1); });
