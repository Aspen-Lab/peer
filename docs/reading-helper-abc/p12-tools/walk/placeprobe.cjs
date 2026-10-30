// is the P2 W1 -> W4 -> W1 reading-place shift of B2's keep-place cell tied to the open cards or the typed drafts? top and scrollY of paragraph 9 (and 8), 2 s and 8 s after each resize
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
const key = process.argv[2] || 'P2';
async function snap(p) { return p.evaluate(() => { const ps = document.querySelectorAll('#paper-body p'); const r = (i) => { const b = ps[i] && ps[i].getBoundingClientRect(); return b ? { top: +b.top.toFixed(1), h: +b.height.toFixed(1) } : null; }; return { scrollY: Math.round(scrollY), p8: r(8), p9: r(9), p10: r(10) }; }); }
(async () => {
  const out = { cell: `PLACEPROBE-${key}`, variants: {} };
  for (const v of ['nocards', 'cards', 'cards+drafts']) {
    const s = v === 'nocards' ? await L.openPaper(key, L.W.W1, {}) : await L.openKey(key, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
    if (v !== 'nocards') { await C.openSticky(p, paras[4], { y: 300 }); await C.openExplain(p, paras[6], { y: 300 }); }
    if (v === 'cards+drafts') {
      const row = await p.locator('[data-margin-card=sticky] [data-row]').first().boundingBox(); await p.mouse.click(row.x + row.width * 0.6, row.y + row.height / 2); await p.waitForTimeout(800); await p.keyboard.type('invented draft line'); await p.waitForTimeout(600);
      const ta = p.locator('[data-margin-card=explain] textarea').first(); await ta.scrollIntoViewIfNeeded().catch(() => {}); await ta.fill('invented follow-up draft').catch(() => {}); await p.waitForTimeout(400);
    }
    // put paragraph 9 at the masthead
    await p.evaluate(() => { const e = document.querySelectorAll('#paper-body p')[9]; window.scrollBy(0, e.getBoundingClientRect().top - 82); }); await L.still(p);
    const rec = { start: await snap(p) };
    await p.setViewportSize({ width: 390, height: 844 }); await p.waitForTimeout(2000); await L.still(p); rec.atW4 = await snap(p);
    await p.setViewportSize({ width: 1440, height: 900 }); await p.waitForTimeout(2000); await L.still(p); rec.back2s = await snap(p);
    await p.waitForTimeout(6000); await L.still(p); rec.back8s = await snap(p);
    out.variants[v] = rec; await s.browser.close();
  }
  L.fs.writeFileSync(`${L.R}/pack/${out.cell}.json`, JSON.stringify(out, null, 1));
  for (const [k, r] of Object.entries(out.variants)) console.log(k, 'start', JSON.stringify(r.start.p9), r.start.scrollY, '| back2s', JSON.stringify(r.back2s.p9), r.back2s.scrollY, '| back8s', JSON.stringify(r.back8s.p9), r.back8s.scrollY);
})();
