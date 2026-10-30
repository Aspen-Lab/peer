// B1 cell: pane dividers (rest, cursor, hover, focus, keys, floors, real drag)
const L = require('./lib2.cjs'); const B = require('./bat_layout.cjs');
const PACK = L.R + '/pack';
async function run(key, wname, stepIdx, dark, profile = 'nokey') {
  const w = L.W[wname];
  const s = profile === 'key' ? await L.openKey(key, w, { dark: false }) : await L.openPaper(key, w);
  const p = s.page;
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx);
  const theme = dark ? 'dark' : 'light';
  const name = `B1-${key}-${wname}-${stepName}-${theme}`;
  if (stepIdx !== 2) await L.setStep(p, stepIdx);
  if (dark) await L.setDark(p);
  await p.evaluate(() => window.scrollTo(0, 0));
  await L.still(p);
  const res = { cell: name, input: key, width: wname, viewport: w, step: stepIdx, scale: L.STEPS[stepIdx], theme, profile, load: require('os').loadavg()[0] };
  const hashBefore = await L.bodyHash(p);
  res.layout = await B.layoutState(p);
  res.rest = await B.dividerRest(p);
  await p.screenshot({ path: `${PACK}/${name}.png` });
  res.panes = {};
  for (const pane of ['left', 'margin']) {
    const rect = await B.sepRect(p, pane);
    if (!rect) { res.panes[pane] = { present: false }; continue; }
    const out = { present: true };
    const cx = rect.x + rect.w / 2, cy = Math.min(rect.y + 300, 600);
    // hover
    await p.mouse.move(cx, cy); await p.waitForTimeout(250);
    out.hover = await B.pseudoOf(p, pane);
    await p.screenshot({ path: `${PACK}/${name}-hover-${pane}.png`, clip: { x: Math.max(0, cx - 40), y: Math.max(0, cy - 60), width: 80, height: 120 } });
    await p.mouse.move(cx, 5); // away
    // keyboard focus (Tab focus => focus-visible); use focus() after a keypress to emulate keyboard modality
    await p.keyboard.press('Shift'); 
    await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').focus({ preventScroll: true }), pane);
    await p.waitForTimeout(250);
    out.focus = await B.pseudoOf(p, pane);
    await p.screenshot({ path: `${PACK}/${name}-focus-${pane}.png`, clip: { x: Math.max(0, cx - 40), y: Math.max(0, cy - 60), width: 80, height: 120 } });
    // keys
    const val = async () => Number(await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('aria-valuenow'), pane));
    const g0 = await B.gridWidths(p); const v0 = await val();
    const grow = pane === 'left' ? 'ArrowRight' : 'ArrowLeft', shrink = pane === 'left' ? 'ArrowLeft' : 'ArrowRight';
    const k = {};
    await p.keyboard.press(grow); await p.waitForTimeout(250); k.grow1 = { v: await val(), grid: await B.gridWidths(p) };
    await p.keyboard.press('Shift+' + grow); await p.waitForTimeout(250); k.growShift = { v: await val(), grid: await B.gridWidths(p) };
    await p.keyboard.press(shrink); await p.waitForTimeout(250); k.shrink1 = { v: await val() };
    await p.keyboard.press('End'); await p.waitForTimeout(300); k.end = { v: await val(), grid: await B.gridWidths(p), attr: await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('aria-valuemax'), pane) };
    await p.keyboard.press('Home'); await p.waitForTimeout(300); k.home = { v: await val(), grid: await B.gridWidths(p), attr: await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('aria-valuemin'), pane) };
    await p.keyboard.press('Enter'); await p.waitForTimeout(300); k.enter = { v: await val(), grid: await B.gridWidths(p) };
    out.keys = { start: v0, startGrid: g0, ...k };
    // real mouse drag (grow the pane by moving toward the paper centre / away)
    const r2 = await B.sepRect(p, pane); const dx = pane === 'left' ? 70 : -70;
    const d0 = await val(); const gd0 = await B.gridWidths(p);
    await p.mouse.move(r2.x + r2.w / 2, cy); await p.mouse.down(); await p.mouse.move(r2.x + r2.w / 2 + dx / 2, cy, { steps: 6 }); await p.mouse.move(r2.x + r2.w / 2 + dx, cy, { steps: 6 });
    out.dragDuring = { dragging: await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').getAttribute('data-dragging'), pane), grid: await B.gridWidths(p) };
    await p.mouse.up(); await p.waitForTimeout(400);
    out.drag = { dx, before: d0, after: await val(), gridBefore: gd0, gridAfter: await B.gridWidths(p) };
    // restore by Enter
    await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').focus({ preventScroll: true }), pane);
    await p.keyboard.press('Enter'); await p.waitForTimeout(300);
    res.panes[pane] = out;
  }
  res.hashBefore = hashBefore; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = s.log.pageerrors; res.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/${name}.json`, JSON.stringify(res, null, 1));
  await s.browser.close();
  return res;
}
module.exports = { run };
if (require.main === module) {
  const [key, wname, step, dark] = process.argv.slice(2);
  run(key, wname, Number(step), dark === 'dark').then(r => { console.log(r.cell, JSON.stringify(r.panes.left && r.panes.left.drag), JSON.stringify(r.panes.margin && r.panes.margin.drag)); });
}
