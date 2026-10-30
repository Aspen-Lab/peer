const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const sleep = (p, ms) => p.waitForTimeout(ms);
(async () => {
  const s = await L.openPaper('P1', L.W.W3, {}); const p = s.page;
  const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: 190 });
  const card = '[data-margin-card=sticky]';
  const bb0 = await p.locator(card + ' [data-row]').first().boundingBox(); await p.mouse.click(bb0.x + bb0.width * 0.6, bb0.y + bb0.height / 2); await sleep(p, 500);
  await p.keyboard.type('base words', { delay: 8 }); await sleep(p, 700);
  await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200);
  const info = await p.evaluate(() => {
    const win = document.querySelector('section[aria-label="Your notes"]'); const sc = document.querySelector('[data-margin-card=sticky]');
    const rr = e => { if (!e) return null; const b = e.getBoundingClientRect(); return [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)]; };
    const rows = Array.from(win.querySelectorAll('[data-row]')).map(r => ({ t: r.innerText.slice(0, 20), r: rr(r) }));
    const z = e => { const cs = getComputedStyle(e); return cs.zIndex + '/' + cs.position; };
    return { win: rr(win), winZ: z(win), card: rr(sc), cardZ: sc && z(sc), cardParentZ: sc && sc.parentElement && z(sc.parentElement), rows };
  });
  console.log(JSON.stringify(info));
  await p.screenshot({ path: L.R + '/probe-1236-w3.png' });
  await s.browser.close();
})();
