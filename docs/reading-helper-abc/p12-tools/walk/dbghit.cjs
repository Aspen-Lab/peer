const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const wn = process.argv[3] || 'W2'; const s = await L.openPaper(process.argv[2] || 'P1', L.W[wn], {}); const p = s.page; const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: 200 }); await p.waitForTimeout(800); await L.still(p);
  const r = await p.evaluate(() => {
    const tab = Array.from(document.querySelectorAll('button')).find(b => /open your notes/i.test((b.getAttribute('aria-label') || '') + b.textContent) && getComputedStyle(b).position === 'fixed');
    const t = tab.getBoundingClientRect(); const y = Math.round(t.y + t.height / 2);
    const strip = document.querySelector('[data-reader-divider="margin"]').getBoundingClientRect();
    const para = Array.from(document.querySelectorAll('#paper-body p')).filter(q => q.getBoundingClientRect().top < y && q.getBoundingClientRect().bottom > y && q.textContent.length > 200)[0];
    const pr = para ? para.getBoundingClientRect() : null;
    const out = { tab: [t.x, t.right], strip: [strip.x, strip.right], para: pr && [pr.x, pr.right] };
    const row = (step, off) => { const a = []; for (let x = Math.floor(t.x - 8); x <= Math.ceil(t.right + 4); x += step) { const e = document.elementFromPoint(x + off, y); a.push([x + off, e ? (e === tab || tab.contains(e) ? 'TAB' : e.closest('[data-reader-divider]') ? 'DIV' : e.closest('#paper-body') ? 'TEXT' : e.tagName) : null]); } return a; };
    out.ints = row(1, 0); out.centres = row(1, 0.5);
    const rg = document.createRange(); const w = document.createTreeWalker(para || document.body, NodeFilter.SHOW_TEXT); let maxR = -1; while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (q.bottom > t.y && q.top < t.bottom && q.right > maxR) maxR = q.right; } out.maxTextRight = maxR;
    return out;
  });
  console.log(JSON.stringify({ tab: r.tab, strip: r.strip, para: r.para, maxTextRight: r.maxTextRight }));
  console.log('ints   ', r.ints.map(a => a[0] + ':' + a[1]).join(' '));
  console.log('centres', r.centres.map(a => a[0] + ':' + a[1]).join(' '));
  await s.browser.close();
})();
