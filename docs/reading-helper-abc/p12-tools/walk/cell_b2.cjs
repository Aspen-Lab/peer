// B2: the breakpoint rule (sweep), the narrow page's actions, and W1 -> W3 -> W1 (and -> W4 -> W1) with Explain + sticky open
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./bat_layout.cjs'); const S = require('./cell_sel.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
const modeAt = async (p, w, h) => { await p.setViewportSize({ width: w, height: h }); await sleep(p, 700); return p.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, mode: document.querySelector('[data-reader-shell]') ? 'panes' : 'one-column', left: (document.querySelector('[data-reader-shell]') || {}).getAttribute ? document.querySelector('[data-reader-shell]').getAttribute('data-left-state') : null })); };
async function sweep(p, stepIdx) {
  const pred = Math.ceil(476 * L.STEPS[stepIdx] + 24) + 48 + 280 + 24;
  let lo = 600, hi = 1300; // find the smallest width with panes
  const probe = async (w) => (await modeAt(p, w, 800)).mode === 'panes';
  while (hi - lo > 1) { const mid = Math.floor((lo + hi) / 2); if (await probe(mid)) hi = mid; else lo = mid; }
  return { step: L.STEPS[stepIdx], predictedMinimum: pred, measuredMinimum: hi, justBelow: (await modeAt(p, hi - 1, 800)).mode, atMinimum: (await modeAt(p, hi, 800)).mode };
}
async function firstVisible(p) { return C.refPara(p); }
async function run(key) {
  const out = { input: key, load: require('os').loadavg()[0] };
  // 1. no-key profile: sweep + narrow actions
  let s = await L.openPaper(key, L.W.W1, {}); let p = s.page;
  out.sweep = {};
  for (const idx of [0, 2, 7]) { await p.setViewportSize({ width: L.W.W1[0], height: L.W.W1[1] }); await sleep(p, 1200); await L.setStep(p, idx); out.sweep[L.STEPFILE[idx]] = await sweep(p, idx); }
  await p.setViewportSize({ width: L.W.W1[0], height: L.W.W1[1] }); await sleep(p, 1200); await L.setStep(p, 2); await sleep(p, 600);
  out.narrow = {};
  const paras = await C.goodParas(p);
  for (const wn of ['W3', 'W4']) {
    await p.setViewportSize({ width: L.W[wn][0], height: L.W[wn][1] }); await sleep(p, 1200);
    const rec = { layout: await B.layoutState(p) };
    const sel = await S.selInPara(p, paras); rec.selection = sel.sel; rec.toolbar = await C.toolbar(p);
    await p.screenshot({ path: `${PACK}/B2-${key}-${wn}-default-light-selection.png` });
    if (rec.toolbar && rec.toolbar.buttons.some(b => b.name === 'Highlight')) { await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 900); rec.highlightMarks = (await S.marksInfo(p)).marks; await S.removeHighlight(p); }
    if (rec.toolbar && rec.toolbar.buttons.some(b => b.name === 'Take notes')) { const s2 = await S.selInPara(p, paras); await p.getByRole('button', { name: 'Take notes' }).click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1200); rec.sticky = (await C.cardsInfo(p)).cards.map(c => c.kind); await C.closeAll(p); }
    // notes window / notes entry
    const nb = p.getByRole('button', { name: 'Notes' }); rec.notesButton = await nb.count(); if (rec.notesButton) { await nb.first().click().catch(() => {}); await sleep(p, 1200); rec.notesWindow = await p.locator('section[aria-label="Your notes"]').count(); await p.screenshot({ path: `${PACK}/B2-${key}-${wn}-default-light-notes.png` }); const close = p.getByRole('button', { name: 'Close your notes' }); if (await close.count()) await close.first().click().catch(() => {}); }
    out.narrow[wn] = rec;
  }
  out.hash1 = await L.bodyHash(p); await s.browser.close();
  // 2. key profile: Explain + sticky across W1 -> W3 -> W1 and W1 -> W4 -> W1
  s = await L.openKey(key, L.W.W1, {}); p = s.page;
  const paras2 = await C.goodParas(p);
  await C.openSticky(p, paras2[4], { y: 300 }); await C.openExplain(p, paras2[6], { y: 300 });
  // type a draft into the sticky and a follow-up into Explain's field
  const row = await p.locator('[data-margin-card=sticky] [data-row]').first().boundingBox(); await p.mouse.click(row.x + row.width * 0.6, row.y + row.height / 2); await sleep(p, 800);
  await p.keyboard.type('invented draft line'); await sleep(p, 600);
  const ta = p.locator('[data-margin-card=explain] textarea').first(); await ta.scrollIntoViewIfNeeded().catch(() => {}); await ta.fill('invented follow-up draft').catch(() => {}); await sleep(p, 400);
  await p.evaluate(() => { document.querySelectorAll('[data-margin-card]').forEach(c => { c.dataset.p12tag = 'kept'; }); });
  const snap = async (tag) => { const ci = await C.cardsInfo(p); const ref = await firstVisible(p); const drafts = await p.evaluate(() => ({ stickyHasDraft: /invented draft line/.test((document.querySelector('[data-margin-card=sticky]') || {}).textContent || ''), explainField: (document.querySelector('[data-margin-card=explain] textarea') || {}).value || null, sameNodes: Array.from(document.querySelectorAll('[data-margin-card]')).every(c => c.dataset.p12tag === 'kept') })); return { tag, vp: p.viewportSize(), kinds: ci.cards.map(c => c.kind), h: ci.cards.map(c => Math.round(c.rect.h)), ref, drafts }; };
  out.keepPlace = { W1_start: await snap('W1-start') };
  await p.screenshot({ path: `${PACK}/B2-${key}-W1-start-cards.png` });
  for (const mid of ['W3', 'W4']) {
    await p.setViewportSize({ width: L.W[mid][0], height: L.W[mid][1] }); await sleep(p, 2000); await L.still(p);
    out.keepPlace[mid] = await snap(mid); await p.screenshot({ path: `${PACK}/B2-${key}-${mid}-cards.png` });
    await p.setViewportSize({ width: L.W.W1[0], height: L.W.W1[1] }); await sleep(p, 2000); await L.still(p);
    out.keepPlace['back_from_' + mid] = await snap('back-from-' + mid);
  }
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B2-${key}-default-light.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(o => console.log(o.input, JSON.stringify(Object.fromEntries(Object.entries(o.sweep).map(([k, v]) => [k, v.measuredMinimum + '/' + v.predictedMinimum]))))).catch(e => { console.error('ERR', e); process.exit(1); });
