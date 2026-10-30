// P11 guard lines A1-A12 (one evidence line each) at W1 default light, no-key profile (Theme A of P11: the panes and the way back)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./bat_layout.cjs'); const S = require('./cell_sel.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
const leftState = (p) => p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); const sh = document.querySelector('[data-reader-shell]'); return { state: l && l.getAttribute('data-state'), shellState: sh && sh.getAttribute('data-left-state'), w: l && Math.round(l.getBoundingClientRect().width) }; });
const bodyFont = (p) => p.evaluate(() => { const e = document.querySelector('#paper-body p'); return e ? getComputedStyle(e).fontSize : null; });
const centreBox = (p) => p.evaluate(() => { const e = document.querySelector('#paper-body p'); const r = e.getBoundingClientRect(); return { x: Math.round(r.x * 10) / 10, w: Math.round(r.width * 10) / 10 }; });
const storeKeys = (p) => p.evaluate(() => Object.keys(localStorage).filter(k => /pane|reader/i.test(k)).map(k => k + ':' + localStorage.getItem(k).slice(0, 120)));
async function run(key) {
  const s = await L.openPaper(key, L.W.W1, {}); const p = s.page; const cell = `${key}-W1-default-light`;
  const out = { cell, input: key, profile: 'no key (Tier 0)', load: require('os').loadavg()[0], lines: {} };
  const ln = out.lines; const hash0 = await L.bodyHash(p);
  const ev = async (id, fn) => { try { ln[id] = await fn(); } catch (e) { ln[id] = { error: String(e.message).slice(0, 200) }; } };
  // A1
  await ev('A1', async () => { const l1 = await B.layoutState(p); await p.setViewportSize({ width: 1024, height: 576 }); await sleep(p, 900); const l2 = await B.layoutState(p); await p.setViewportSize({ width: 853, height: 480 }); await sleep(p, 900); const l3 = await B.layoutState(p); await p.setViewportSize({ width: 390, height: 844 }); await sleep(p, 900); const l4 = await B.layoutState(p); await p.setViewportSize({ width: 1440, height: 900 }); await sleep(p, 900); return { W1: [l1.mode, l1.leftState, l1.left.w, l1.centre.w, l1.margin.w], W2: [l2.mode, l2.leftState], W3: [l3.mode, l3.leftState], W4: [l4.mode], note: 'P11 A1 (1024 breakpoint) is superseded by the width contract (pane-layout.ts railMinimumWidth)' }; });
  // A2
  await ev('A2', async () => {
    const r = {}; r.start = await leftState(p);
    await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await sleep(p, 700); r.afterCollapse = await leftState(p);
    await p.locator('[data-reader-rail]').hover(); await sleep(p, 1800); r.afterHover = await leftState(p);
    const bx = await centreBox(p); r.centreDuringPeek = bx;
    await p.mouse.move(700, 400); await sleep(p, 900); r.afterLeave = await leftState(p);
    await p.locator('[data-reader-rail]').click(); await sleep(p, 700); r.afterPress = await leftState(p);
    // persistence of the choice: collapse again then reload
    await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click().catch(() => {}); await sleep(p, 500);
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1200); r.afterReloadWhileCollapsed = await leftState(p);
    await p.locator('[data-reader-rail]').click().catch(() => {}); await sleep(p, 600);
    await p.locator('[data-reader-left-header] button[aria-label="Pin sidebar"]').click().catch(() => {}); await sleep(p, 600); r.afterRepin = await leftState(p);
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1200); r.afterReloadPinned = await leftState(p);
    return r;
  });
  // A3 / A4 (drag + reload persistence)
  for (const [id, pane, dx] of [['A3', 'left', 60], ['A4', 'margin', -60]]) await ev(id, async () => {
    const r = {}; const g0 = await B.gridWidths(p); const rect = await B.sepRect(p, pane); const cy = 400;
    await p.mouse.move(rect.x + 6, cy); await p.mouse.down(); await p.mouse.move(rect.x + 6 + dx / 2, cy, { steps: 5 }); await p.mouse.move(rect.x + 6 + dx, cy, { steps: 5 }); await p.mouse.up(); await sleep(p, 500);
    r.before = g0; r.afterDrag = await B.gridWidths(p);
    // far drag: floors and ceilings
    const rect2 = await B.sepRect(p, pane); await p.mouse.move(rect2.x + 6, cy); await p.mouse.down(); await p.mouse.move(rect2.x + 6 + (dx > 0 ? 900 : -900), cy, { steps: 12 }); await p.mouse.up(); await sleep(p, 500); r.farDragOne = await B.gridWidths(p);
    const rect3 = await B.sepRect(p, pane); await p.mouse.move(rect3.x + 6, cy); await p.mouse.down(); await p.mouse.move(rect3.x + 6 + (dx > 0 ? -900 : 900), cy, { steps: 12 }); await p.mouse.up(); await sleep(p, 500); r.farDragOther = await B.gridWidths(p);
    // set a distinctive width and reload
    const rect4 = await B.sepRect(p, pane); await p.mouse.move(rect4.x + 6, cy); await p.mouse.down(); await p.mouse.move(rect4.x + 6 + (dx > 0 ? 90 : -90), cy, { steps: 8 }); await p.mouse.up(); await sleep(p, 500); r.beforeReload = await B.gridWidths(p);
    await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1200); r.afterReload = await B.gridWidths(p);
    const rect5 = await B.sepRect(p, pane); await p.evaluate((pane) => document.querySelector('[data-reader-divider="' + pane + '"]').focus(), pane); await p.keyboard.press('Enter'); await sleep(p, 500); r.afterEnterDefault = await B.gridWidths(p);
    return r;
  });
  // A5
  await ev('A5', async () => {
    const r = {}; r.fontStart = await bodyFont(p); const rect = await B.sepRect(p, 'left');
    await p.mouse.move(rect.x + 6, 400); await p.mouse.down(); await p.mouse.move(rect.x + 90, 400, { steps: 6 }); await p.mouse.up(); await sleep(p, 500); r.fontAfterDrag = await bodyFont(p);
    await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await sleep(p, 700); r.fontAfterCollapse = await bodyFont(p);
    await p.locator('[data-reader-rail]').click(); await sleep(p, 600); r.fontAfterPin = await bodyFont(p);
    r.hOverflow = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
    // Fit: zoom unchanged by a drag
    await p.getByRole('button', { name: 'Fit to screen' }).click(); await sleep(p, 1200); r.fitOn = await p.evaluate(() => getComputedStyle(document.querySelector('[data-zoom-root]')).getPropertyValue('--page-zoom') + '|' + getComputedStyle(document.querySelector('[data-zoom-root]')).zoom);
    const r2 = await B.sepRect(p, 'margin'); await p.mouse.move(r2.x + 4, 400); await p.mouse.down(); await p.mouse.move(r2.x - 40, 400, { steps: 6 }); await p.mouse.up(); await sleep(p, 600);
    r.fitAfterDrag = await p.evaluate(() => getComputedStyle(document.querySelector('[data-zoom-root]')).getPropertyValue('--page-zoom') + '|' + getComputedStyle(document.querySelector('[data-zoom-root]')).zoom);
    await p.getByRole('button', { name: 'Fit to screen' }).click().catch(() => {}); await sleep(p, 800);
    return r;
  });
  // A6
  await ev('A6', async () => {
    await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
    const r = {};
    r.map = await p.evaluate(() => { const m = Array.from(document.querySelectorAll('[data-reader-left-scroll] a[href^="#"], [data-reader-left-scroll] a')).filter(a => a.getBoundingClientRect().height > 0); const first = m[0]; const sc = document.querySelector('[data-reader-left-scroll]'); const sr = sc.getBoundingClientRect(); return { rows: m.length, firstRowTop: first ? Math.round(first.getBoundingClientRect().top) : null, vh: innerHeight, scrollerTop: Math.round(sr.top), scrollerH: Math.round(sr.height), scrollerScrollH: sc.scrollHeight, scrolls: sc.scrollHeight > sc.clientHeight }; });
    await p.evaluate(() => window.scrollTo(0, 3000)); await L.still(p);
    r.afterCentreScroll = await p.evaluate(() => { const sc = document.querySelector('[data-reader-left-scroll]'); const r = sc.getBoundingClientRect(); const t = document.querySelector('[data-reader-left-fixed]').getBoundingClientRect(); return { scrollerTop: Math.round(r.top), fixedTop: Math.round(t.top), fixedBottom: Math.round(t.bottom) }; });
    // a row press lands its heading at y 80
    const link = p.locator('[data-reader-left-scroll] a').nth(3); const href = await link.getAttribute('href'); r.rowHref = href && href.slice(0, 40);
    await link.click(); await sleep(p, 1500); await L.still(p);
    r.afterRowPress = await p.evaluate(() => { const hash = decodeURIComponent((location.hash || '').slice(1)); const t = hash ? document.getElementById(hash) : null; return { hash: hash.slice(0, 30), target: !!t, headingTop: t ? Math.round(t.getBoundingClientRect().top) : null }; });
    return r;
  });
  // A7
  await ev('A7', async () => {
    const r = {}; await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
    const bar = p.getByPlaceholder(/What should this paper answer/i).first(); await bar.click(); await bar.fill('typed text survives'); await sleep(p, 300);
    await p.evaluate(() => { const b = document.querySelector('textarea'); b.dataset.p12id = 'q'; const m = document.querySelector('[data-reader-left-scroll]'); m.dataset.p12id = 'map'; });
    const toggle = p.locator('[data-reader-left-scroll] button[aria-label^="Show how the paragraphs"]').first(); await toggle.click(); await sleep(p, 500);
    r.openBefore = await p.evaluate(() => { const sc = document.querySelector('[data-reader-left-scroll]'); const b = sc.querySelector('button[aria-label^="Show how"]'); return { textLen: sc.innerText.length, attrs: Array.from(b.attributes).map(a => a.name + '=' + a.value).join(' ').slice(0, 160) }; });
    const check = async (tag) => { r[tag] = await p.evaluate(() => ({ q: (document.querySelector('textarea[data-p12id=q]') || {}).value || null, sameField: !!document.querySelector('textarea[data-p12id=q]'), sameMap: !!document.querySelector('[data-reader-left-scroll][data-p12id=map]'), textLen: document.querySelector('[data-reader-left-scroll]').innerText.length })); };
    await p.getByRole('tab', { name: 'Summary' }).click().catch(() => {}); await sleep(p, 900); await check('afterSummaryTab');
    await p.getByRole('tab', { name: 'Paper digestion' }).click().catch(() => {}); await sleep(p, 900); await check('afterBackTab');
    await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await sleep(p, 700); await check('afterCollapse');
    await p.locator('[data-reader-rail]').click(); await sleep(p, 700); await check('afterPin');
    const rr = await B.sepRect(p, 'left'); await p.mouse.move(rr.x + 6, 400); await p.mouse.down(); await p.mouse.move(rr.x + 56, 400, { steps: 5 }); await p.mouse.up(); await sleep(p, 500); await check('afterDrag');
    // title/commands/strip stay in view while the centre scrolls
    await p.evaluate(() => window.scrollTo(0, 4000)); await L.still(p);
    r.fixedZoneAfterScroll = await p.evaluate(() => { const t = document.querySelector('[data-reader-left-fixed]').getBoundingClientRect(); return { top: Math.round(t.top), bottom: Math.round(t.bottom), inView: t.top >= 40 && t.bottom <= innerHeight }; });
    await bar.fill('').catch(() => {});
    return r;
  });
  // A8
  await ev('A8', async () => {
    const r = {}; r.before = await centreBox(p); const ps = await C.goodParas(p);
    await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
    await C.openSticky(p, ps[3], { y: 300 }); r.firstOpen = await centreBox(p); await C.closeAll(p); r.afterClose = await centreBox(p);
    r.noKeyToolbar = await S.toolbarNames(p);
    await C.openFigure(p, 1, { wait: 2000 }).then(h => { r.figureHow = h; }); r.figureOpen = await centreBox(p); await C.closeAll(p);
    r.afterAll = await centreBox(p); return r;
  });
  // A11
  await ev('A11', async () => {
    const r = {};
    r.separators = await p.evaluate(() => Array.from(document.querySelectorAll('[role=separator]')).map(s => ({ label: s.getAttribute('aria-label'), now: s.getAttribute('aria-valuenow'), min: s.getAttribute('aria-valuemin'), max: s.getAttribute('aria-valuemax'), tab: s.tabIndex, orient: s.getAttribute('aria-orientation') })));
    r.railLabel = await p.evaluate(() => { const e = document.querySelector('[data-reader-rail]'); return e ? e.getAttribute('aria-label') : null; }); r.pinLabel = await p.evaluate(() => document.querySelector('[data-reader-left-header] button[aria-label]').getAttribute('aria-label'));
    // Tab reachability: tab from the body start until a separator is focused
    await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(0, 0); }); const reached = new Set(); for (let i = 0; i < 80 && reached.size < 2; i++) { await p.keyboard.press('Tab'); const a = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute('role') === 'separator' ? document.activeElement.getAttribute('aria-label') : null); if (a) reached.add(a); } r.reachedByTab = Array.from(reached);
    // DOM order vs visual order
    r.domOrder = await p.evaluate(() => { const q = (s) => document.querySelector(s); const pos = (e) => e.getBoundingClientRect().x; const a = [['left', q('[data-reader-left]')], ['centre', q('[data-reader-centre]')], ['margin', q('[data-reader-margin]')]]; const dom = a.slice().sort((x, y) => (x[1].compareDocumentPosition(y[1]) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1).map(x => x[0]); const vis = a.slice().sort((x, y) => pos(x[1]) - pos(y[1])).map(x => x[0]); return { dom, vis, same: dom.join() === vis.join() }; });
    // Escape closes a peek
    await p.locator('[data-reader-left-header] button[aria-label="Collapse sidebar"]').click(); await sleep(p, 600); await p.locator('[data-reader-rail]').hover(); await sleep(p, 1800); r.peek = await leftState(p); if (r.peek && r.peek.state === 'peek') { await p.keyboard.press('Escape'); await sleep(p, 700); r.afterEscape = await leftState(p); } else { r.afterEscape = 'peek did not open: Escape not pressed (it would go back a page)'; }
    await p.locator('[data-reader-rail]').click().catch(() => {}); await sleep(p, 600);
    return r;
  });
  // A12 screenshots light/dark
  await ev('A12', async () => { await p.mouse.move(700, 400); { const sb = p.getByRole('button', { name: 'Show sidebar' }); if (await sb.count() && await sb.first().isVisible().catch(() => false)) { await sb.first().click(); await sleep(p, 900); await p.mouse.move(700, 400); } } await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p); await p.screenshot({ path: `${PACK}/GA12-${cell}.png` }); await L.setDark(p); await p.screenshot({ path: `${PACK}/GA12-${key}-W1-default-dark.png` }); const r = await p.evaluate(() => ({ bg: getComputedStyle(document.body).backgroundColor })); await p.getByRole('button', { name: /Follow the system/ }).click().catch(() => {}); await sleep(p, 1500); return r; });
  await S.openTab(p, 'Paper digestion').catch(() => {}); await sleep(p, 1200);
  out.hashBefore = hash0; out.hashAfter = await L.bodyHash(p);
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/GA-${cell}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(o => console.log(o.cell, Object.entries(o.lines).map(([k, v]) => k + (v && v.error ? ':ERR' : ':ok')).join(' '))).catch(e => { console.error('ERR', e); process.exit(1); });
