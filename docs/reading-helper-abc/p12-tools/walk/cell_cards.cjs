// B3 / B4 / B5 cell (key profile: Explain needs the stub-model profile)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./bat_layout.cjs');
const PACK = L.R + '/pack';
const ORDERS = [['E','S','F'],['E','F','S'],['S','E','F'],['S','F','E'],['F','E','S'],['F','S','E']];
const KIND = { E: 'explain', S: 'sticky', F: 'figure' };
const CLOSEORD = [['E','S','F'],['S','F','E'],['F','E','S'],['F','S','E'],['E','F','S'],['S','E','F']]; // rotated so that every closing permutation is used once
const sleep = (p, ms) => p.waitForTimeout(ms);

async function overlap(page) { // selection group vs open cards
  return page.evaluate(() => {
    const t = document.querySelector('[role=toolbar][aria-label="Selection actions"]'); if (!t) return null;
    const tr = t.getBoundingClientRect();
    const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
    const res = { toolbar: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)], cards: [], cardRects: Array.from(document.querySelectorAll('[data-margin-card]')).map(c => { const r = c.getBoundingClientRect(); return { kind: c.getAttribute('data-margin-card'), top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width) }; }) };
    for (const c of document.querySelectorAll('[data-margin-card]')) {
      const kind = c.getAttribute('data-margin-card'); const cr = c.getBoundingClientRect();
      const hd = c.querySelector('[data-margin-header],[data-figure-header]'); const hr = hd ? (hd.closest('div.flex.h-10') || hd).getBoundingClientRect() : null;
      const over = inter(tr, cr); if (!over) continue;
      // words: any text node rect in the card intersecting the toolbar
      let words = 0, headerWords = 0; const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
      while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (inter(tr, r) > 0) { words++; if (hr && inter(hr, r) > 0) headerWords++; } } }
      res.cards.push({ kind, overlapPx2: Math.round(over), overHeader: hr ? Math.round(inter(tr, hr)) : 0, textRectsUnderGroup: words, headerTextRectsUnderGroup: headerWords });
    }
    // the group must be clickable: its buttons' centre hit-test
    res.hit = Array.from(t.querySelectorAll('button')).map(b => { const r = b.getBoundingClientRect(); const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { name: b.textContent.trim(), hit: e === b || b.contains(e) }; });
    return res;
  });
}
async function tally(page, paras, ys) { // selection group over the open card(s): several selections at different heights
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    const idx = paras[(i * 3 + 1) % paras.length];
    const sel = await C.selectPara(page, idx, { y: ys[i] });
    const ov = sel ? await overlap(page) : null;
    out.push({ y: ys[i], para: idx, sel: !!sel, toolbar: ov && ov.toolbar, overCards: ov ? ov.cards : null, cardRects: ov && ov.cardRects, hit: ov && ov.hit });
    await page.waitForTimeout(200);
  }
  return out;
}

async function stripTally(page, paras, ys) { // the colour strip (after Highlight) over the open card's words
  const out = [];
  for (let i = 0; i < ys.length; i++) {
    const idx = paras[(i * 3 + 2) % paras.length];
    const sel = await C.selectPara(page, idx, { y: ys[i] });
    const names = await page.evaluate(() => { const t = document.querySelector('[role=toolbar][aria-label="Selection actions"]'); return t ? Array.from(t.querySelectorAll('button')).map(b => b.textContent.trim()) : null; });
    if (!sel || !names || !names.includes('Highlight')) { out.push({ y: ys[i], sel: !!sel, offered: names }); continue; }
    await page.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true });
    for (let i = 0; i < 16; i++) { await page.waitForTimeout(400); if (await page.evaluate(() => !!document.querySelector('[role=toolbar][aria-label="Highlight"]'))) break; }
    const r = await page.evaluate(() => {
      const t = document.querySelector('[role=toolbar][aria-label="Highlight"]'); if (!t) return null; const tr = t.getBoundingClientRect();
      const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top));
      const cards = [];
      for (const c of document.querySelectorAll('[data-margin-card]')) { const cr = c.getBoundingClientRect(); if (!inter(tr, cr)) continue; let words = 0; const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT); while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const q of rg.getClientRects()) if (inter(tr, q) > 0) words++; } const hd = c.querySelector('[data-margin-header],[data-figure-header]'); const hr = hd ? (hd.closest('div.flex.h-10') || hd).getBoundingClientRect() : null; cards.push({ kind: c.getAttribute('data-margin-card'), textRectsUnderStrip: words, overHeaderPx2: hr ? Math.round(inter(tr, hr)) : 0 }); }
      return { strip: [Math.round(tr.x), Math.round(tr.y), Math.round(tr.width), Math.round(tr.height)], cards };
    });
    out.push({ y: ys[i], strip: r });
    await page.getByRole('button', { name: 'Remove highlight' }).first().click({ timeout: 20000 }).catch(() => {}); await page.waitForTimeout(500);
  }
  return out;
}

async function bodyScrollTest(page, kind) {
  // find the card's real scroller: the element (card itself or a descendant) with overflow auto/scroll and the most hidden content
  await page.evaluate((kind) => {
    const card = document.querySelector('[data-margin-card=' + kind + ']'); if (!card) return;
    document.querySelectorAll('[data-p12-scroller]').forEach(e => e.removeAttribute('data-p12-scroller'));
    let best = null, bestHidden = -1;
    for (const e of [card, ...card.querySelectorAll('*')]) {
      const oy = getComputedStyle(e).overflowY; if (!/auto|scroll/.test(oy) || e.clientHeight < 20) continue;
      const hidden = e.scrollHeight - e.clientHeight; if (hidden > bestHidden || (hidden === bestHidden && best && e.clientHeight > best.clientHeight)) { best = e; bestHidden = hidden; }
    }
    if (best) best.setAttribute('data-p12-scroller', kind);
  }, kind);
  const sel = '[data-p12-scroller=' + kind + ']';
  const before = await page.evaluate((sel) => { const e = document.querySelector(sel); if (!e) return null; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { cx: r.x + r.width / 2, cy: r.y + r.height / 2, clientH: e.clientHeight, scrollH: e.scrollHeight, top: e.scrollTop, scrollY: Math.round(scrollY), overscroll: cs.overscrollBehaviorY, overflowY: cs.overflowY, tag: e.tagName + '.' + String(e.className).split(' ').slice(0, 3).join('.') }; }, sel);
  if (!before) return { present: false };
  const ref0 = await C.refPara(page);
  const hidden = before.scrollH - before.clientH;
  await page.mouse.move(before.cx, before.cy);
  // phase A: wheel inside the card's own range (80 % of its hidden content)
  let sent = 0; const target = Math.max(0, Math.floor(hidden * 0.8));
  while (sent < target) { const d = Math.min(100, target - sent); await page.mouse.wheel(0, d); sent += d; await page.waitForTimeout(30); }
  await page.waitForTimeout(400);
  const mid = await page.evaluate((sel) => { const e = document.querySelector(sel); return { top: e.scrollTop, scrollY: Math.round(scrollY) }; }, sel);
  const refMid = await C.refPara(page);
  // phase B: keep wheeling well past the end of the card's content
  for (let i = 0; i < 10; i++) { await page.mouse.wheel(0, 300); await page.waitForTimeout(30); }
  await page.waitForTimeout(500);
  const after = await page.evaluate((sel) => { const e = document.querySelector(sel); return { top: e.scrollTop, scrollY: Math.round(scrollY) }; }, sel);
  const ref1 = await C.refPara(page);
  // restore the page position and the card's scroll
  await page.evaluate(({ sel, y }) => { window.scrollTo(0, y); const e = document.querySelector(sel); if (e) e.scrollTop = 0; }, { sel, y: before.scrollY });
  await L.still(page);
  return { present: true, scroller: before.tag, overflowY: before.overflowY, overscrollBehavior: before.overscroll, clientH: before.clientH, scrollH: before.scrollH, hiddenPx: hidden, scrollTopBefore: before.top, phaseA: { sentPx: sent, scrollTop: mid.top, scrollYBefore: before.scrollY, scrollYAfter: mid.scrollY, refBefore: ref0, refAfter: refMid }, phaseB: { sentPx: 3000, scrollTop: after.top, scrollYAfter: after.scrollY, pageMovedPx: after.scrollY - before.scrollY, refAfter: ref1 } };
}
async function fillSticky(page, lines) {
  let ed = page.locator('[data-margin-card=sticky] [contenteditable=true]').first();
  if (!(await ed.count())) {
    // an unfocused sticky shows its text as reading prose: press its text row to edit
    const b = await page.locator('[data-margin-card=sticky] [data-row]').first().boundingBox();
    await page.mouse.click(b.x + b.width * 0.6, b.y + b.height / 2); await page.waitForTimeout(900);
    ed = page.locator('[data-margin-card=sticky] [contenteditable=true]').first();
  }
  await ed.click({ timeout: 8000 }); await page.waitForTimeout(200);
  for (let i = 0; i < lines; i++) { await page.keyboard.type('invented line ' + (i + 1) + ' of note text'); await page.keyboard.press('Enter'); }
  await page.waitForTimeout(500);
}

async function run(key, wname, stepIdx, dark, opts = {}) {
  const w = L.W[wname];
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx); const theme = dark ? 'dark' : 'light';
  const cell = `${key}-${wname}-${stepName}-${theme}`;
  let s = null, p = null; const allErrors = [], allPageErrors = [], allConsole = [];
  const open = async () => {
    s = await L.openKey(key, w, { dark: false }); p = s.page;
    if (stepIdx !== 2) await L.setStep(p, stepIdx);
    if (dark) await L.setDark(p);
    await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  };
  const recover = async () => { try { allPageErrors.push(...s.log.pageerrors); allConsole.push(...s.log.console); await s.browser.close(); } catch (e) { /* already gone */ } await open(); };
  await open();
  const res = { cell, input: key, width: wname, viewport: w, step: stepIdx, theme, profile: 'placeholder-key (stub)', load: require('os').loadavg()[0], errors: allErrors, browserReopened: 0 };
  const paras = await C.goodParas(p); res.nParas = paras.length;
  const pick = (k) => paras[Math.min(paras.length - 1, k)];
  const hash0 = await L.bodyHash(p);
  const shot = async (n) => { await sleep(p, 300); await p.screenshot({ path: `${PACK}/${n}-${cell}.png` }); };
  const ysFor = (fs) => fs.map(f => Math.round(f * w[1]));
  const save = (partial) => L.fs.writeFileSync(`${PACK}/B345-${cell}.json`, JSON.stringify({ ...res, partial }, null, 1));
  const ONLY = process.env.PHASES ? process.env.PHASES.split(',') : null;
  const phase = async (name, fn) => {
    if (ONLY && !ONLY.some(o => name.startsWith(o))) return true;
    for (let attempt = 0; attempt < 3; attempt++) {
      try { s.log.phase = name; await fn(); save(true); return true; }
      catch (e) { allErrors.push({ phase: name, attempt, msg: String(e.message).slice(0, 160) }); res.browserReopened++; try { await recover(); } catch (e2) { allErrors.push({ phase: name, recover: String(e2.message).slice(0, 120) }); return false; } }
    }
    return false;
  };
  if (ONLY) { // re-run of some phases only: keep what the earlier run measured
    let prev = {}; try { prev = JSON.parse(L.fs.readFileSync(`${PACK}/B345-${cell}.json`, 'utf8')); } catch (e) { /* none */ }
    for (const k of ['P1', 'P2', 'P2b', 'B3', 'B4', 'B5']) res[k] = prev[k] || (k === 'B5' ? { orders: [] } : {});
    if (ONLY.some(o => o.startsWith('B5'))) res.B5 = { orders: (prev.B5 && prev.B5.orders || []).filter(r => !ONLY.some(o => o === 'B5-order-' + r.order)) };
    res.priorRunPageErrors = prev.pageerrors || []; res.priorRunErrors = prev.errors || []; res.rerunPhases = ONLY;
  } else { res.P1 = {}; res.P2 = {}; res.P2b = {}; res.B3 = {}; res.B4 = {}; res.B5 = { orders: [] }; }
  await phase('P1-explain', async () => {
    await C.closeAll(p);
    const sel1 = await C.openExplain(p, pick(4), { y: 300 });
    const ci1 = await C.cardsInfo(p);
    res.P1.explain = { sel: sel1, cards: ci1.cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h, left: c.rect.left, w: c.rect.w })), alignDelta: ci1.cards[0] && sel1 ? +(ci1.cards[0].rect.top - sel1.firstLineTop).toFixed(1) : null, margin: await p.evaluate(() => { const m = document.querySelector('[data-reader-margin]'); const b = m && m.getBoundingClientRect(); return b ? { left: b.left, right: b.right } : null; }) };
    await shot('B3-single-explain');
    if (opts.tally) { res.P1.tallyExplain = await tally(p, paras, ysFor([0.18, 0.36, 0.55, 0.74])); res.P1.stripExplain = await stripTally(p, paras, ysFor([0.22, 0.5])); }
    await C.closeAll(p);
  });
  await phase('P2-sticky', async () => {
    await C.closeAll(p);
    const sel2 = await C.openSticky(p, pick(6), { y: 300 });
    const ci2 = await C.cardsInfo(p);
    res.P2.sticky = { sel: sel2, cards: ci2.cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h })), alignDelta: ci2.cards[0] && sel2 ? +(ci2.cards[0].rect.top - sel2.firstLineTop).toFixed(1) : null };
    await shot('B3-single-sticky');
    if (opts.tally) { res.P2.tallySticky = await tally(p, paras, ysFor([0.18, 0.36, 0.55, 0.74])); res.P2.stripSticky = await stripTally(p, paras, ysFor([0.22, 0.5])); }
    await C.closeAll(p);
  });
  await phase('P2b-figure', async () => {
    await C.closeAll(p);
    res.P2b.how = await C.openFigure(p, 1, { wait: 2500 });
    const cif = await C.cardsInfo(p); res.P2b.cards = cif.cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h, left: c.rect.left, w: c.rect.w }));
    await shot('B3-single-figure');
    if (opts.tally) { res.P2b.tallyFigure = await tally(p, paras, ysFor([0.18, 0.36, 0.55, 0.74])); res.P2b.stripFigure = await stripTally(p, paras, ysFor([0.22, 0.5])); }
    await C.closeAll(p);
  });
  const twoCards = async () => { await C.closeAll(p); await C.openSticky(p, pick(6), { y: 300 }); const refBefore = await C.refPara(p); const exSel = await C.openExplain(p, pick(8), { y: 300 }); await sleep(p, 600); return { refBefore, exSel }; };
  await phase('B3-two', async () => {
    const { refBefore, exSel } = await twoCards();
    const ci3 = await C.cardsInfo(p); const refAfter = await C.refPara(p);
    res.B3 = { two: ci3, secondCardPaperMove: exSel && exSel.paperMove, refBefore, refAfter, heightDelta: ci3.cards.length === 2 ? +Math.abs(ci3.cards[0].rect.h - ci3.cards[1].rect.h).toFixed(1) : null, order: ci3.cards.map(c => c.kind), scroll: {} };
    await shot('B3-two');
    res.B3.scroll.explain = await bodyScrollTest(p, 'explain');
    await fillSticky(p, 14);
    res.B3.minimums = await minInfo(p);
    res.B3.scroll.sticky = await bodyScrollTest(p, 'sticky');
    res.B3.paperAfter = await C.refPara(p);
    res.B3.hash = await L.bodyHash(p);
  });
  await phase('B4', async () => { await twoCards(); res.B4 = await dividerBattery(p, cell, paras); });
  const nOrders = opts.lite ? 1 : ORDERS.length;
  for (let oi = 0; oi < nOrders; oi++) await phase('B5-order-' + ORDERS[oi].join(''), async () => { const rec = await oneOrder(p, paras, cell, shot, oi); res.B5.orders.push(rec); await C.closeAll(p); });
  try { await C.closeAll(p); } catch (e) { /* ignore */ }
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p).catch(() => ({ len: -1, sha: null }));
  res.pageerrors = [...allPageErrors, ...s.log.pageerrors]; res.console = [...allConsole, ...s.log.console].filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  save(false);
  await s.browser.close();
  return res;
}

async function dividerBattery(p, cell, paras) {
  const out = {};
  await L.injectHelpers(p);
  const d = () => p.evaluate(() => { const e = document.querySelector('[data-card-divider]'); if (!e) return null; const r = e.getBoundingClientRect(); const line = e.querySelector('span'); const P = window.__p12; const cs = getComputedStyle(e); const lb = getComputedStyle(line); const grip = e.querySelectorAll('span')[1]; const gr = grip.getBoundingClientRect();
    const lineCol = P.parse(lb.backgroundColor); const above = document.elementFromPoint(r.x + r.width / 2, r.top - 3), below = document.elementFromPoint(r.x + r.width / 2, r.bottom + 3);
    const bgS = P.bgOf(e); const lineRgb = P.over(lineCol, bgS);
    return { rect: { x: +r.x.toFixed(1), y: +r.y.toFixed(1), w: +r.width.toFixed(1), h: +r.height.toFixed(1) }, cursor: cs.cursor, lineH: lb.height, lineBg: lb.backgroundColor, lineRgb: P.rgb(lineRgb), bgDivider: P.rgb(bgS), bgAbove: P.rgb(P.bgOf(above)), bgBelow: P.rgb(P.bgOf(below)), contrastDivider: +P.ratio(lineRgb, bgS).toFixed(2), contrastAbove: +P.ratio(lineRgb, P.bgOf(above)).toFixed(2), contrastBelow: +P.ratio(lineRgb, P.bgOf(below)).toFixed(2), grip: { w: +gr.width.toFixed(1), h: +gr.height.toFixed(1), border: getComputedStyle(grip).borderTopWidth + ' ' + getComputedStyle(grip).borderTopColor, gripRgb: P.rgb(P.parse(getComputedStyle(grip).borderTopColor)) }, now: e.getAttribute('aria-valuenow'), min: e.getAttribute('aria-valuemin'), max: e.getAttribute('aria-valuemax'), role: e.getAttribute('role'), orient: e.getAttribute('aria-orientation'), label: e.getAttribute('aria-label'), tab: e.tabIndex };
  });
  out.rest = await d();
  if (!out.rest) return out;
  const geom = async () => { const ci = await C.cardsInfo(p); return { h: ci.cards.map(c => c.rect.h), top: ci.cards.map(c => c.rect.top), now: ci.divs[0] && ci.divs[0].now, kinds: ci.cards.map(c => c.kind), hdr: ci.cards.map(c => c.header && c.header.h), bodyClient: ci.cards.map(c => c.body && c.body.clientH) }; };
  // cursor probes
  out.cursorProbes = await p.evaluate(() => { const e = document.querySelector('[data-card-divider]'); const r = e.getBoundingClientRect(); const pts = []; for (const fx of [2, 0.5, -2]) for (const fy of [0.5, 0.5 + 5.5, -0.5]) { const x = fx > 0 && fx < 1 ? r.x + r.width * fx : fx > 1 ? r.x + fx : r.right + fx; const y = fy < 1 && fy > 0 ? r.y + fy : fy > 1 ? r.y + fy : r.bottom + fy; const el = document.elementFromPoint(x, y); const sep = el && el.closest('[data-card-divider]'); pts.push({ x: Math.round(x), y: +y.toFixed(1), hit: !!sep, cursor: el ? getComputedStyle(el).cursor : null }); } return pts; });
  const rect = out.rest; const cx = rect.rect.x + rect.rect.w / 2, cy = rect.rect.y + rect.rect.h / 2;
  // hover / focus visual
  const vis = () => p.evaluate(() => { const e = document.querySelector('[data-card-divider]'); const P = window.__p12; const line = e.querySelector('span'); const lb = getComputedStyle(line); const cs = getComputedStyle(e); return { lineBg: P.rgb(P.parse(lb.backgroundColor)), lineH: lb.height, bg: P.rgb(P.parse(cs.backgroundColor)), boxShadow: cs.boxShadow.slice(0, 80), focusVisible: e.matches(':focus-visible'), hover: e.matches(':hover') }; });
  await p.mouse.move(cx, cy); await sleep(p, 250); out.hover = await vis();
  await p.screenshot({ path: `${PACK}/B4-hover-${cell}.png`, clip: { x: rect.rect.x - 10, y: rect.rect.y - 40, width: rect.rect.w + 20, height: 90 } });
  await p.mouse.move(5, 5); await p.keyboard.press('Shift');
  await p.evaluate(() => document.querySelector('[data-card-divider]').focus({ preventScroll: true })); await sleep(p, 250); out.focus = await vis();
  await p.screenshot({ path: `${PACK}/B4-focus-${cell}.png`, clip: { x: rect.rect.x - 10, y: rect.rect.y - 40, width: rect.rect.w + 20, height: 90 } });
  // keys
  out.keys = { start: await geom() };
  const k = async (name, key) => { await p.keyboard.press(key); await sleep(p, 300); out.keys[name] = await geom(); };
  await k('down1', 'ArrowDown'); await k('shiftDown', 'Shift+ArrowDown'); await k('up1', 'ArrowUp'); await k('end', 'End'); await k('home', 'Home'); await k('enter', 'Enter');
  // real drag down by 60
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 30, { steps: 5 }); await p.mouse.move(cx, cy + 60, { steps: 5 });
  out.dragMid = await geom();
  await p.mouse.up(); await sleep(p, 400); out.drag60 = await geom();
  await p.screenshot({ path: `${PACK}/B4-drag-${cell}.png` });
  // drag far down => lower card at minimum
  const r1 = (await d()).rect; const y1 = r1.y + r1.h / 2;
  await p.mouse.move(cx, y1); await p.mouse.down(); await p.mouse.move(cx, y1 + 100, { steps: 6 }); await p.mouse.move(cx, y1 + 700, { steps: 10 }); await p.mouse.up(); await sleep(p, 400);
  out.dragFarDown = await geom();
  out.minInfoDown = await minInfo(p);
  await p.screenshot({ path: `${PACK}/B4-min-lower-${cell}.png` });
  const r2 = (await d()).rect; const y2 = r2.y + r2.h / 2;
  await p.mouse.move(cx, y2); await p.mouse.down(); await p.mouse.move(cx, y2 - 100, { steps: 6 }); await p.mouse.move(cx, y2 - 900, { steps: 12 }); await p.mouse.up(); await sleep(p, 400);
  out.dragFarUp = await geom();
  out.minInfoUp = await minInfo(p);
  await p.screenshot({ path: `${PACK}/B4-min-upper-${cell}.png` });
  // set a ratio, then session survival
  await p.evaluate(() => document.querySelector('[data-card-divider]').focus({ preventScroll: true })); await p.keyboard.press('Enter'); await sleep(p, 300);
  await p.keyboard.press('Shift+ArrowDown'); await p.keyboard.press('Shift+ArrowDown'); await sleep(p, 300);
  out.session = { ratioSet: await geom() };
  // (a) raise the other card by clicking its header; (b) resize to another width and back; (c) close+reopen each kind
  const first = out.session.ratioSet;
  const hdrSel = '[data-margin-card=' + first.kinds[0] + '] [data-margin-header]';
  await p.locator('[data-margin-card=' + first.kinds[1] + '] [data-margin-header]').first().click().catch(() => {}); await sleep(p, 500);
  out.session.afterRaise = await geom();
  const vp = p.viewportSize(); await p.setViewportSize({ width: 1200, height: vp.height }); await sleep(p, 900); out.session.at1200 = await geom();
  await p.setViewportSize(vp); await sleep(p, 900); out.session.backWide = await geom();
  L.fs.existsSync; 
  // close the lower card and reopen it: ratio?
  const lowerKind = first.kinds[1];
  await C.closeKind(p, lowerKind); out.session.afterCloseLower = await geom();
  if (lowerKind === 'explain') await C.openExplain(p, paras[Math.min(paras.length - 1, 9)], { y: 300 }); else if (lowerKind === 'sticky') await C.openSticky(p, paras[Math.min(paras.length - 1, 9)], { y: 300 });
  await sleep(p, 700); out.session.afterReopenLower = await geom();
  return out;
}
async function minInfo(p) {
  return p.evaluate(() => Array.from(document.querySelectorAll('[data-margin-card]')).map(c => {
    const cr = c.getBoundingClientRect();
    const closeBtn = c.querySelector('button[aria-label=Close], button[aria-label^="Save note"], button[aria-label^="Close Figure"], button[aria-label^="Close Fig"]');
    const hdrEl = closeBtn ? closeBtn.closest('div.flex') : null; const hr = hdrEl ? hdrEl.getBoundingClientRect() : null;
    const headerBottom = hr ? hr.bottom : cr.top;
    // distinct visible text lines below the header, inside the card
    const lines = new Set(); const w = document.createTreeWalker(c, NodeFilter.SHOW_TEXT);
    while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (r.height > 0 && r.top >= headerBottom - 1 && r.bottom <= cr.bottom + 1 && r.top >= cr.top) lines.add(Math.round(r.top / 4)); } }
    const scr = c.querySelector('[data-p12-scroller]');
    return { kind: c.getAttribute('data-margin-card'), cardH: +cr.height.toFixed(1), headerH: hr ? +hr.height.toFixed(1) : null, headerInsideCard: hr ? (hr.top >= cr.top - 1 && hr.bottom <= cr.bottom + 1) : null, bodyBelowHeaderPx: +(cr.bottom - headerBottom).toFixed(1), visibleTextLinesBelowHeader: lines.size };
  }));
}
async function oneOrder(p, paras, cell, shot, oi) {
  {
    const order = ORDERS[oi], closing = CLOSEORD[oi];
    await C.closeAll(p);
    const rec = { order: order.join(''), closing: closing.join(''), steps: [] };
    let pi = 3 + (Number(process.env.PARA_OFFSET) || 0);
    for (const k of order) {
      if (k === 'E') await C.openExplain(p, paras[Math.min(paras.length - 1, pi)], { y: 300, wait: 1800 });
      else if (k === 'S') await C.openSticky(p, paras[Math.min(paras.length - 1, pi)], { y: 300, wait: 900 });
      else rec.figureHow = await C.openFigure(p, 1, { wait: 1800 });
      pi += 2;
      const ci = await C.cardsInfo(p);
      rec.steps.push({ opened: k, kinds: ci.cards.map(c => c.kind), h: ci.cards.map(c => c.rect.h), top: ci.cards.map(c => c.rect.top), divs: ci.divs.length, track: ci.track && { split: ci.track.split, clientH: ci.track.clientH, scrollH: ci.track.scrollH, overflowY: ci.track.overflowY } });
    }
    await sleep(p, 500);
    const ci = await C.cardsInfo(p);
    rec.three = { kinds: ci.cards.map(c => c.kind), h: ci.cards.map(c => c.rect.h), top: ci.cards.map(c => c.rect.top), bottom: ci.cards.map(c => c.rect.bottom), hdr: ci.cards.map(c => c.header && c.header.h), divs: ci.divs.map(d => ({ y: d.rect.top, h: d.rect.h, now: d.now, min: d.min, max: d.max })), track: ci.track, vh: p.viewportSize().height };
    rec.min = await minInfo(p);
    // controls reachable: every card's header and its controls hit-test
    rec.controls = await p.evaluate(() => Array.from(document.querySelectorAll('[data-margin-card]')).map(c => { const kind = c.getAttribute('data-margin-card'); const btns = Array.from(c.querySelectorAll('button,[role=toolbar] button')).filter(b => b.getBoundingClientRect().width > 0); const hits = btns.map(b => { const r = b.getBoundingClientRect(); const x = r.x + r.width / 2, y = r.y + r.height / 2; const inView = y >= 0 && y <= innerHeight && x >= 0 && x <= innerWidth; const e = inView ? document.elementFromPoint(x, y) : null; return { name: (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 30), inView, hit: inView ? (e === b || b.contains(e)) : null }; }); return { kind, n: btns.length, notHit: hits.filter(h => h.inView && !h.hit).map(h => h.name), offscreen: hits.filter(h => !h.inView).map(h => h.name), hits }; }));
    if (oi === 0 || oi === 5) await shot('B5-' + order.join(''));
    // divider drag in three cards: drag first divider down by 40, then check heights and the other divider
    const dv = ci.divs;
    if (dv.length === 2) {
      const cx = ci.cards[0].rect.left + ci.cards[0].rect.w / 2, cy = dv[0].rect.top + dv[0].rect.h / 2;
      if (cy < p.viewportSize().height - 20) {
        await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 20, { steps: 4 }); await p.mouse.move(cx, cy + 50, { steps: 4 }); await p.mouse.up(); await sleep(p, 400);
        const c2 = await C.cardsInfo(p); rec.afterDrag = { h: c2.cards.map(c => c.rect.h), sum: +c2.cards.reduce((a, c) => a + c.rect.h, 0).toFixed(1), kinds: c2.cards.map(c => c.kind) };
      }
    }
    // closing in the prescribed order
    rec.closeSteps = [];
    for (const k of closing) {
      await C.closeKind(p, KIND[k]);
      const c3 = await C.cardsInfo(p);
      rec.closeSteps.push({ closed: k, kinds: c3.cards.map(c => c.kind), h: c3.cards.map(c => c.rect.h), divs: c3.divs.length });
    }
    return rec;
  }
}
module.exports = { run, oneOrder, overlap, tally, bodyScrollTest, fillSticky, dividerBattery, minInfo };
if (require.main === module) {
  const [key, wname, step, dark, flag] = process.argv.slice(2);
  run(key, wname, Number(step), dark === 'dark', { tally: flag === 'tally', lite: flag === 'lite' }).then(r => { console.log(r.cell, 'two-card heights', JSON.stringify(r.B3.two && r.B3.two.cards.map(c => c.rect.h)), 'delta', r.B3.heightDelta, 'phase errors', r.errors.length, 'reopened', r.browserReopened, 'pageerrors', r.pageerrors.length); if (r.errors.length > 3) process.exit(2); }).catch(e => { console.error('ERR', e); process.exit(1); });
}
