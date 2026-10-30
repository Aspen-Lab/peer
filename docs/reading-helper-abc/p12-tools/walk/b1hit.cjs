// B1 extra: is every point along the whole length of each pane divider's hit strip really the divider (cursor col-resize)? scans y every 20 px, three x positions
const L = require('./lib2.cjs'); const PACK = L.R + '/pack';
async function run(key, wname) {
  const s = await L.openPaper(key, L.W[wname], {}); const p = s.page;
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p); await p.waitForTimeout(800);
  const out = { cell: `${key}-${wname}-default-light`, input: key, width: wname, viewport: L.W[wname], load: require('os').loadavg()[0], dividers: {} };
  out.dividers = await p.evaluate(() => {
    const res = {};
    for (const s of document.querySelectorAll('[data-reader-divider]')) {
      const b = s.getBoundingClientRect(); const pane = s.getAttribute('data-reader-divider');
      const vh = window.innerHeight; const y0 = Math.max(b.top, 0) + 4, y1 = Math.min(b.bottom, vh) - 4;
      let total = 0, hit = 0; const blocked = []; const cursors = {};
      for (let y = y0; y <= y1; y += 20) for (const dx of [0.5, b.width / 2, b.width - 0.5]) {
        total++; const el = document.elementFromPoint(b.left + dx, y); const sep = el && el.closest('[data-reader-divider]');
        const cur = el ? getComputedStyle(el).cursor : null; cursors[cur] = (cursors[cur] || 0) + 1;
        if (sep === s) hit++; else blocked.push({ y: Math.round(y), dx: +dx.toFixed(1), el: el ? (el.tagName + ':' + ((el.closest('[aria-label]') || {}).getAttribute ? el.closest('[aria-label]').getAttribute('aria-label') : '') + ':' + (el.textContent || '').trim().slice(0, 14)) : null, cursor: cur });
      }
      const ys = Array.from(new Set(blocked.map(x => x.y)));
      res[pane] = { rect: [Math.round(b.x), Math.round(b.y), Math.round(b.width), Math.round(b.height)], total, hit, blockedPoints: blocked.length, blockedYRange: ys.length ? [Math.min(...ys), Math.max(...ys)] : null, blockedBy: Array.from(new Set(blocked.map(x => x.el))).slice(0, 5), cursors };
    }
    return res;
  });
  out.pageerrors = s.log.pageerrors;
  L.fs.writeFileSync(`${PACK}/B1hit-${out.cell}.json`, JSON.stringify(out, null, 1));
  await p.screenshot({ path: `${PACK}/B1hit-${out.cell}.png` });
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3]).then(o => console.log(o.cell, JSON.stringify(Object.fromEntries(Object.entries(o.dividers).map(([k, v]) => [k, v.hit + '/' + v.total + (v.blockedBy.length ? ' blockedBy ' + JSON.stringify(v.blockedBy) + ' y ' + JSON.stringify(v.blockedYRange) : '')]))))).catch(e => { console.error('ERR', e); process.exit(1); });
