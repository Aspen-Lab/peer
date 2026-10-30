// B1 stress extra: at the largest step (W1) and at W3, drags in BOTH directions on each divider (which direction has room)
const L = require('./lib2.cjs'); const B = require('./bat_layout.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
async function run(key, wname, stepIdx) {
  const s = await L.openPaper(key, L.W[wname], {}); const p = s.page; const cell = `${key}-${wname}-${L.STEPFILE[stepIdx]}-light`;
  if (stepIdx !== 2) await L.setStep(p, stepIdx);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const out = { cell, input: key, width: wname, step: stepIdx, panes: {} };
  for (const pane of ['left', 'margin']) {
    const rect = await B.sepRect(p, pane); if (!rect) { out.panes[pane] = { present: false }; continue; }
    const rec = { present: true, start: await B.gridWidths(p) };
    for (const [name, dx] of [['outward', pane === 'left' ? 70 : -70], ['inward', pane === 'left' ? -70 : 70]]) {
      const r = await B.sepRect(p, pane); const before = await B.gridWidths(p); const val0 = await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('aria-valuenow'), pane);
      await p.mouse.move(r.x + 6, 400); await p.mouse.down(); await p.mouse.move(r.x + 6 + dx / 2, 400, { steps: 5 }); await p.mouse.move(r.x + 6 + dx, 400, { steps: 5 }); await p.mouse.up(); await sleep(p, 500);
      rec[name] = { dx, before, after: await B.gridWidths(p), valueBefore: val0, valueAfter: await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('aria-valuenow'), pane) };
    }
    out.panes[pane] = rec;
  }
  await p.screenshot({ path: `${PACK}/B1x-${cell}.png` });
  out.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${PACK}/B1x-${cell}.json`, JSON.stringify(out, null, 1)); await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3], Number(process.argv[4])).then(o => console.log(o.cell, JSON.stringify(o.panes.left && [o.panes.left.outward.after.left, o.panes.left.inward.after.left]), JSON.stringify(o.panes.margin && [o.panes.margin.outward.after.margin, o.panes.margin.inward.after.margin]))).catch(e => { console.error('ERR', e); process.exit(1); });
