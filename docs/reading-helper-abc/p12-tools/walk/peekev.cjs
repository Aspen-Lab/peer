// A2 / A11 supplement: the rail's peek with a real mouse movement (W1 after Collapse; W2 as forced rail), leave, Escape, a tab press inside the peek
const L = require('./lib2.cjs'); const PACK = L.R + '/pack';
async function run(key) {
  const out = { cell: `${key}-default-light`, input: key, load: require('os').loadavg()[0] };
  for (const wn of ['W1', 'W2']) {
    const s = await L.openPaper(key, L.W[wn], {}); const p = s.page; const r = {};
    const st = () => p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); const c = document.querySelector('#paper-body p'); const cb = c && c.getBoundingClientRect(); return { left: l && l.getAttribute('data-state'), focusIn: !!(l && l.contains(document.activeElement)), centreX: cb && Math.round(cb.x), url: location.pathname.slice(0, 12) }; });
    if (wn === 'W1') { await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await p.waitForTimeout(900); }
    r.collapsed = await st();
    await p.mouse.move(700, 400); await p.waitForTimeout(300);
    const bb = await p.locator('[data-reader-rail]').first().boundingBox();
    const t0 = Date.now(); await p.mouse.move(bb.x + bb.width / 2, bb.y + 20, { steps: 8 });
    let tPeek = null; for (let i = 0; i < 30; i++) { const x = await st(); if (x.left === 'peek') { tPeek = Date.now() - t0; break; } await p.waitForTimeout(100); }
    r.peekAfterMs = tPeek; r.duringPeek = await st();
    await p.screenshot({ path: `${PACK}/A2peek-${key}-${wn}-default-light.png` });
    await p.mouse.move(900, 400, { steps: 6 }); await p.waitForTimeout(1500); r.afterLeave = await st();
    // a tab press inside the peek leaves the peek open (focus inside); Escape closes it
    await p.mouse.move(bb.x + bb.width / 2, bb.y + 20, { steps: 6 }); await p.waitForTimeout(900);
    await p.getByRole('tab', { name: 'Summary' }).click(); await p.mouse.move(900, 400, { steps: 4 }); await p.waitForTimeout(1200); r.afterTabPressAndLeave = await st();
    await p.keyboard.press('Escape'); await p.waitForTimeout(700); r.afterEscape = await st();
    r.pageerrors = s.log.pageerrors; out[wn] = r; await s.browser.close();
  }
  L.fs.writeFileSync(`${PACK}/A2peek-${out.cell}.json`, JSON.stringify(out, null, 1)); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(o => console.log(o.cell, JSON.stringify({ W1: [o.W1.peekAfterMs, o.W1.afterLeave.left, o.W1.afterTabPressAndLeave.left, o.W1.afterEscape.left], W2: [o.W2.peekAfterMs, o.W2.afterLeave.left, o.W2.afterTabPressAndLeave.left, o.W2.afterEscape.left] }))).catch(e => { console.error('ERR', e); process.exit(1); });
