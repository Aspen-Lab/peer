const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  const w = process.argv[2] || 'W2'; const key = process.argv[3] || 'P1';
  const s = await L.openPaper(key, L.W[w], {}); const p = s.page;
  const paras = await C.goodParas(p);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const sel = await C.selectPara(p, paras[3], { y: 250, noRetry: true });
  console.log('sel', JSON.stringify(sel));
  await p.waitForTimeout(1500);
  const info = await p.evaluate(() => {
    const sels = getSelection(); const rc = sels.rangeCount ? sels.getRangeAt(0).getBoundingClientRect() : null;
    const tbs = Array.from(document.querySelectorAll('[role=toolbar]')).map(t => ({ label: t.getAttribute('aria-label'), r: (() => { const b = t.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; })(), btn: Array.from(t.querySelectorAll('button')).map(b => b.textContent.trim()) }));
    const btns = Array.from(document.querySelectorAll('button')).filter(b => /^(Explain this|Take notes|Highlight)$/.test(b.textContent.trim())).map(b => ({ t: b.textContent.trim(), r: (() => { const q = b.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; })(), vis: b.getBoundingClientRect().width > 0 }));
    return { selText: sels.toString().length, selRect: rc && [Math.round(rc.x), Math.round(rc.y), Math.round(rc.width), Math.round(rc.height)], toolbars: tbs, btns, vw: innerWidth, vh: innerHeight };
  });
  console.log(JSON.stringify(info));
  await p.screenshot({ path: L.R + `/probe-sel-${key}-${w}.png` });
  await s.browser.close();
})();
