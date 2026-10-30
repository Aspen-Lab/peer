// B7 cell: every visible figure opened with a real left click; zoom / pan / Fit, caption, focus, Escape, close; image identity vs the PDF page
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
const cp = require('child_process');
const PACK = L.R + '/pack';
const sleep = (p, ms) => p.waitForTimeout(ms);
const PDF = { P1: L.INPUTS.P1, P2: L.INPUTS.P2, P3: L.INPUTS.P3 };

async function scrollAll(p) {
  const h = await p.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < h + 900; y += 450) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(200); }
  await p.waitForTimeout(2500); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
}
async function targets(p) {
  return p.evaluate(() => {
    const out = [];
    document.querySelectorAll('#paper-body figure').forEach((f, i) => {
      const btn = f.querySelector('button[aria-label^="Open Fig"]'); const img = f.querySelector('img'); const cap = f.querySelector('figcaption');
      const q = img ? (img.getAttribute('src') || '').replace(/^.*figure-image\?/, '') : null;
      const m = q ? /page=(\d+)&fig=(\d+)/.exec(q) : null;
      const capHead = cap ? (/^\s*(Fig(?:ure)?\.?\s*\d+[a-z]?)/i.exec(cap.textContent) || [])[1] || null : null;
      out.push({ kind: 'body', i, label: btn ? btn.getAttribute('aria-label') : null, hasButton: !!btn, imgNat: img ? img.naturalWidth + 'x' + img.naturalHeight : null, imgComplete: img ? img.complete : null, page: m ? Number(m[1]) : null, fig: m ? Number(m[2]) : null, capLabel: capHead, hasCaption: !!cap, bodyCapLen: cap ? cap.textContent.trim().length : 0 });
    });
    document.querySelectorAll('button[aria-label="Enlarge figure"]').forEach((b, i) => { const r = b.getBoundingClientRect(); out.push({ kind: b.closest('[data-reader-left]') ? 'plate-left' : b.closest('[role=tabpanel]') ? 'summary-or-inline' : 'plate-other', i, label: 'Enlarge figure', hasButton: true, box: [Math.round(r.width), Math.round(r.height)], visible: r.width > 0 && r.height > 0 }); });
    return out;
  });
}
async function cardState(p) {
  return p.evaluate(() => { const c = document.querySelector('[data-margin-card=figure]'); if (!c) return null; const cv = c.querySelector('[data-figure-canvas]'); const im = c.querySelector('img'); const cap = c.querySelector('[data-figure-caption]'); const ld = c.querySelector('[data-figure-loading]'); const rd = c.querySelector('[data-figure-readout]'); const box = c.querySelector('[data-figure-box]'); const surf = c.querySelector('button[aria-label*="figure"]'); const r = c.getBoundingClientRect(); return { label: c.getAttribute('aria-label'), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], canvas: cv ? cv.width + 'x' + cv.height : null, img: im ? im.naturalWidth + 'x' + im.naturalHeight : null, loading: ld ? ld.textContent.trim().slice(0, 40) : null, readout: rd ? rd.textContent.trim() : null, captionLen: cap ? cap.textContent.trim().length : 0, capHead: cap ? cap.textContent.trim().slice(0, 14) : null, headerText: (() => { const h = c.querySelector('[data-figure-header],[data-margin-header]'); return h ? h.textContent.trim().slice(0, 40) : null; })(), capClientH: cap ? cap.clientHeight : null, capScrollH: cap ? cap.scrollHeight : null, capOverflowY: cap ? getComputedStyle(cap).overflowY : null, capMaxH: cap ? getComputedStyle(cap).maxHeight : null, transform: surf ? getComputedStyle(surf).transform : null, boxRect: box ? (() => { const b = box.getBoundingClientRect(); return [Math.round(b.width), Math.round(b.height)]; })() : null, focusIn: c.contains(document.activeElement), activeTag: document.activeElement ? document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') || '').slice(0, 30) : null }; });
}
async function waitCard(p, ms = 14000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { const st = await cardState(p); if (st && (st.canvas || st.img || /could not/i.test(st.loading || ''))) return { st, ms: Date.now() - t0 }; await sleep(p, 200); } return { st: await cardState(p), ms: Date.now() - t0, timeout: true }; }

async function clickTarget(p, t) {
  // scroll the target into view, wait for lazy image, real mouse click at its centre
  let sel;
  if (t.kind === 'body') sel = `#paper-body figure >> nth=${t.i}`; else sel = `button[aria-label="Enlarge figure"] >> nth=${t.i}`;
  const loc = p.locator(sel);
  if (t.kind === 'plate-left') {
    let vis = await loc.isVisible().catch(() => false);
    if (!vis) { const rail = p.locator('[data-reader-rail]').first(); if (await rail.count()) { await rail.hover(); await sleep(p, 1000); vis = await loc.isVisible().catch(() => false); } }
    if (vis) await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  } else await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
  await sleep(p, 1200); await L.still(p);
  let box = null;
  const getBox = async () => {
    if (t.kind === 'body') { const b = p.locator(`#paper-body figure >> nth=${t.i} >> button[aria-label^="Open Fig"]`); return b.boundingBox({ timeout: 2500 }).catch(() => null); }
    return loc.boundingBox({ timeout: 2500 }).catch(() => null);
  };
  for (let i = 0; i < 12; i++) { box = await getBox(); if (box && box.width > 5) break; await sleep(p, 1000); if (t.kind === 'body') await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); }
  if (!box || box.width < 5) return { clicked: false, reason: 'no box (image absent or not rendered)' };
  // a point of the target that is really on screen: inside the viewport band between the masthead (48) and the key legend (~40 from the foot)
  const vh = p.viewportSize().height; const top = Math.max(box.y, 56), bottom = Math.min(box.y + box.height, vh - 44);
  if (bottom - top < 10) { await loc.scrollIntoViewIfNeeded({ timeout: 3000 }).catch(() => {}); await sleep(p, 700); box = await getBox(); }
  const top2 = Math.max(box.y, 56), bottom2 = Math.min(box.y + box.height, vh - 44);
  const cx = box.x + box.width / 2, cy = (top2 + bottom2) / 2;
  // hit test: is the target the element under the pointer?
  const hit = await p.evaluate(({ x, y, t }) => { const e = document.elementFromPoint(x, y); if (!e) return { ok: false, tag: null }; const b = e.closest('button'); return { ok: !!b && /Open Fig|Enlarge figure/.test(b.getAttribute('aria-label') || ''), tag: e.tagName + ':' + ((b && b.getAttribute('aria-label')) || '').slice(0, 24) }; }, { x: cx, y: cy, t });
  await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.up();
  return { clicked: true, hit };
}
function innerHeightGuard(box) { return Math.min(box.height / 2, 200); }

async function exercise(p, cell, name) {
  const out = {};
  const open = await waitCard(p, 30000); out.open = open;
  if (!open.st) return out;
  out.focusAfterOpen = open.st.focusIn;
  // screenshot of the opened image box for the comparison
  const b = open.st.boxRect;
  await sleep(p, 500);
  await p.locator('[data-margin-card=figure] [data-figure-box]').screenshot({ path: `${PACK}/B7-${cell}-${name}-open.png` }).catch(() => {});
  // zoom controls
  const rd = async () => (await cardState(p)).readout;
  const r0 = await rd();
  await p.getByRole('button', { name: 'Zoom in' }).first().click().catch(() => {}); await sleep(p, 400); const rIn = await rd();
  await p.getByRole('button', { name: 'Zoom in' }).first().click().catch(() => {}); await sleep(p, 400); const rIn2 = await rd();
  const t1 = (await cardState(p)).transform;
  // pan: drag on the zoomed figure
  const sb = await p.locator('[data-margin-card=figure] [data-figure-box]').boundingBox();
  if (sb) { await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.down(); await p.mouse.move(sb.x + sb.width / 2 + 40, sb.y + sb.height / 2 + 25, { steps: 5 }); await p.mouse.up(); await sleep(p, 300); }
  const t2 = (await cardState(p)).transform;
  await p.getByRole('button', { name: 'Zoom out' }).first().click().catch(() => {}); await sleep(p, 400); const rOut = await rd();
  await p.getByRole('button', { name: 'Fit', exact: true }).first().click().catch(() => {}); await sleep(p, 500); const rFit = await rd(); const t3 = (await cardState(p)).transform;
  // wheel zoom
  if (sb) { await p.mouse.move(sb.x + sb.width / 2, sb.y + sb.height / 2); await p.mouse.wheel(0, -300); await sleep(p, 400); } const rWheel = await rd();
  await p.getByRole('button', { name: 'Fit', exact: true }).first().click().catch(() => {}); await sleep(p, 400);
  out.zoom = { start: r0, zoomIn: rIn, zoomIn2: rIn2, zoomOut: rOut, fit: rFit, wheel: rWheel, panMoved: t1 !== t2, fitResetsTransform: t3 };
  // Escape
  await p.keyboard.press('Escape'); await sleep(p, 600);
  const afterEsc = await cardState(p); out.escapeClosed = afterEsc === null;
  if (afterEsc) { // close control
    await p.locator('[data-margin-card=figure] button[aria-label^="Close"]').first().click().catch(() => {}); await sleep(p, 500); out.closeControlClosed = (await cardState(p)) === null; out.closedBy = 'close-control (Escape did not close)';
  }
  out.pageScrollY = await p.evaluate(() => Math.round(scrollY));
  return out;
}

async function run(key, wname, stepIdx, which) {
  const w = L.W[wname];
  const s = await L.openPaper(key, w, { settle: 8000 });
  const p = s.page;
  const figResp = [];
  p.on('response', r => { const u = r.url(); if (/figure-image|\/api\/figure/.test(u)) figResp.push({ u: u.replace(L.BASE, '').replace(/^.*?\/figure-image/, 'figure-image').slice(0, 90), status: r.status() }); });
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx); const cell = `${key}-${wname}-${stepName}-light`;
  const res = { cell, input: key, width: wname, viewport: w, load: require('os').loadavg()[0], targets: [] };
  const hash0 = await L.bodyHash(p);
  await scrollAll(p);
  const inv = await targets(p);
  res.inventory = inv.map(t => ({ ...t }));
  res.figureResponses = figResp.slice();
  // which targets to exercise
  let list = inv.filter(t => t.kind === 'body' ? t.hasButton : true);
  const captionOnly = inv.filter(t => t.kind === 'body' && !t.hasButton);
  if (which === 'three') list = list.slice(0, 3);
  for (const t of list) {
    const rec = { target: t.kind + ':' + (t.label || t.i), page: t.page, fig: t.fig };
    const name = `${t.kind === 'body' ? 'fig' + (t.fig ?? t.i) : t.kind}`;
    const respBefore = figResp.length;
    try {
      const pre = await clickTarget(p, t); rec.click = pre;
      if (pre.clicked) { rec.ex = await exercise(p, cell, name); }
      rec.opened = !!(rec.ex && rec.ex.open && rec.ex.open.st && (rec.ex.open.st.canvas || rec.ex.open.st.img));
    } catch (e) { rec.error = String(e.message).slice(0, 200); }
    rec.figureImageRequests = figResp.slice(respBefore).map(r => r.status + ' ' + r.u.replace(/^figure-image/, ''));
    // make sure no card is left open
    await C.closeAll(p).catch(() => {});
    res.targets.push(rec);
    await p.evaluate(() => window.scrollTo(0, 0)); await sleep(p, 200);
  }

  // ---- Summary tab: every "Enlarge figure" thumbnail, real click; margin card or lightbox? ----
  res.summary = { targets: [] };
  try {
    await S.openTab(p, 'Summary'); await sleep(p, 2000);
    const cnt = () => p.evaluate(() => Array.from(document.querySelectorAll('button[aria-label="Enlarge figure"]')).filter(b => { const r = b.getBoundingClientRect(); return r.width > 0 && r.height > 0 && r.right > 4 && r.left < innerWidth - 4; }).length);
    let n = await cnt(); res.summary.visibleWithoutPeek = n;
    if (n === 0) { const rail = p.locator('[data-reader-rail]').first(); if (await rail.count()) { const bb = await rail.boundingBox(); await p.mouse.move(700, 300); await p.mouse.move(bb.x + bb.width / 2, bb.y + 20, { steps: 8 }); await sleep(p, 1300); n = await cnt(); res.summary.viaPeek = true; res.summary.visibleInPeek = n; } }
    res.summary.visibleEnlargeButtons = n;
    for (let i = 0; i < n; i++) {
      const rec = { i }; const rb = figResp.length;
      const loc = p.locator('button[aria-label="Enlarge figure"]').filter({ visible: true }).nth(i);
      await loc.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); await sleep(p, 900); await L.still(p);
      const box = await loc.boundingBox({ timeout: 3000 }).catch(() => null);
      if (!box) { rec.clicked = false; res.summary.targets.push(rec); continue; }
      const vh = p.viewportSize().height; const top = Math.max(box.y, 56), bottom = Math.min(box.y + box.height, vh - 44);
      const cx = box.x + box.width / 2, cy = (top + bottom) / 2;
      rec.box = [Math.round(box.width), Math.round(box.height)];
      rec.where = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); const b = e && e.closest('button'); return { hitIsEnlarge: !!b && (b.getAttribute('aria-label') === 'Enlarge figure'), inLeft: !!(e && e.closest('[data-reader-left]')), inTabpanel: !!(e && e.closest('[role=tabpanel]')) }; }, { x: cx, y: cy });
      await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.up(); rec.clicked = true;
      await sleep(p, 1200);
      const o = await waitCard(p, 12000);
      const dlg = await p.evaluate(() => { const d = document.querySelector('dialog[open], [role=dialog], [data-lightbox]'); return d ? (d.tagName + ':' + (d.getAttribute('aria-label') || '').slice(0, 30)) : null; });
      rec.openedInMargin = !!(o.st && (o.st.canvas || o.st.img)); rec.lightbox = dlg; rec.card = o.st && { rect: o.st.rect, canvas: o.st.canvas, img: o.st.img, label: o.st.label, captionLen: o.st.captionLen };
      if (o.st) await p.locator('[data-margin-card=figure] [data-figure-box]').screenshot({ path: `${PACK}/B7-${cell}-summary${i}-open.png` }).catch(() => {});
      else await p.screenshot({ path: `${PACK}/B7-${cell}-summary${i}-open.png` });
      rec.figureImageRequests = figResp.slice(rb).map(r => r.status + ' ' + r.u.replace(/^figure-image/, ''));
      await p.keyboard.press('Escape'); await sleep(p, 500);
      rec.escapeClosed = (await cardState(p)) === null; await C.closeAll(p).catch(() => {});
      res.summary.targets.push(rec);
    }
    await S.openTab(p, 'Paper digestion'); await sleep(p, 1200);
  } catch (e) { res.summary.error = String(e.message).slice(0, 200); }
  // ---- a second view of the first figure that opened (C P12-61): the image requests of the second view ----
  try {
    const firstOk = res.targets.find(t => t.opened && t.target && t.target.startsWith('body:'));
    if (firstOk) {
      const t = inv.find(x => x.kind === 'body' && x.label && ('body:' + x.label) === firstOk.target);
      if (t) { const rb = figResp.length; const pre = await clickTarget(p, t); const o = await waitCard(p, 15000); res.secondView = { target: firstOk.target, clicked: pre.clicked, opened: !!(o.st && (o.st.canvas || o.st.img)), ms: o.ms, figureImageRequests: figResp.slice(rb).map(r => r.status + ' ' + r.u.replace(/^figure-image/, '')) }; await C.closeAll(p).catch(() => {}); }
    }
  } catch (e) { res.secondView = { error: String(e.message).slice(0, 200) }; }
  // supplementary / extended-data mentions: any control named for them?
  res.supplementaryControls = await p.evaluate(() => Array.from(document.querySelectorAll('button,a,[role=button]')).map(b => (b.getAttribute('aria-label') || b.textContent || '').trim()).filter(t => /supplement|extended data/i.test(t)).slice(0, 20));
  res.extendedDataInventory = inv.filter(t => /extended/i.test(t.label || '') || /extended/i.test(t.capLabel || '')).map(t => ({ label: t.label, cap: t.capLabel }));
  res.captionOnly = captionOnly.map(t => ({ i: t.i, capLabel: t.capLabel, page: t.page, fig: t.fig }));
  res.figureResponsesAfter = figResp.slice();
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = s.log.pageerrors; res.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B7-${cell}.json`, JSON.stringify(res, null, 1));
  await s.browser.close();
  return res;
}
module.exports = { run };
if (require.main === module) {
  const [key, wname, step, which] = process.argv.slice(2);
  run(key, wname, Number(step), which).then(r => console.log(r.cell, 'targets', r.targets.length, 'opened', r.targets.filter(t => t.opened).length, 'captionOnly', r.captionOnly.length, 'pageerrors', r.pageerrors.length)).catch(e => { console.error('ERR', e); process.exit(1); });
}
