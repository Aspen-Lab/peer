// P12-92 E5 re-check: the fixed "Open your notes" tab beside 1, 2 or 3 open cards, at W1..W3.
// Measures: the tab's face and hit area against the margin divider's strip (gap / overlap), against every card and card header, the masthead,
// the key legend and every paper text rect (at 4 scroll positions); what else stands under the tab's rect; a scan down the strip's whole length
// (col-resize); real drags at the tab's height and clear of it (both directions); the strip's bottom against the legend's top.
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const B = require('./bat_layout.cjs');
const PACK = L.R + '/pack';
const [, , key, wn, ncStr, stepStr] = process.argv; const nc = +ncStr || 1; const stepIdx = stepStr === undefined ? 2 : +stepStr;

const IN_PAGE = `(() => {
  const rr = e => { const b = (e.getBoundingClientRect ? e.getBoundingClientRect() : e); return { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), right: +b.right.toFixed(2), bottom: +b.bottom.toFixed(2) }; };
  const inter = (a, b) => Math.max(0, Math.min(a.right, b.right) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.y, b.y));
  const findTab = () => Array.from(document.querySelectorAll('button')).find(b => /open your notes|take notes on this paper/i.test((b.getAttribute('aria-label') || '') + ' ' + b.textContent) && getComputedStyle(b).position === 'fixed' && b.getBoundingClientRect().height > 30 && b.getBoundingClientRect().width < 140 && b.getBoundingClientRect().x > innerWidth * 0.4);
  window.__r4 = { rr, inter, findTab };
})()`;

async function measure(p, tag, scrollFracs) {
  await p.evaluate(IN_PAGE);
  const out = { tag };
  out.base = await p.evaluate(() => {
    const { rr, inter, findTab } = window.__r4; const tab = findTab(); if (!tab) return { tab: null };
    const t = rr(tab); const midY = t.y + t.h / 2;
    const strip = Array.from(document.querySelectorAll('[data-reader-divider="margin"]'))[0];
    const s = strip ? rr(strip) : null;
    // hit span of the tab at mid-height: the x positions whose topmost element is the tab (or inside it)
    // pixel columns whose centre point resolves to the tab (what a pointer at 100% reports); elementFromPoint has about 1 px of slop at element edges (the same slop puts the strip's first hit column 1 px left of its rect)
    const hitX = []; for (let x = Math.floor(t.x - 12); x <= Math.ceil(t.right + 4); x++) { const e = document.elementFromPoint(x + 0.5, midY); if (e && (e === tab || tab.contains(e))) hitX.push(x); }
    const hit = hitX.length ? { from: hitX[0], to: hitX[hitX.length - 1] + 1, width: hitX.length } : null;
    const stripCols = []; if (s) for (let x = Math.floor(s.x - 6); x <= Math.ceil(s.right); x++) { const e = document.elementFromPoint(x + 0.5, midY); if (e && e.closest('[data-reader-divider]') === strip) stripCols.push(x); }
    const stripHit = stripCols.length ? { from: stripCols[0], to: stripCols[stripCols.length - 1] + 1, width: stripCols.length } : null;
    const hitRect = hit ? { x: hit.from, y: t.y, w: hit.width, h: t.h, right: hit.to, bottom: t.bottom } : t;
    const cards = Array.from(document.querySelectorAll('[data-margin-card]')).map(c => { const hd = c.querySelector('[data-margin-header],[data-figure-header]'); return { kind: c.getAttribute('data-margin-card'), rect: rr(c), header: hd ? rr(hd.closest('div.flex.h-10') || hd) : null }; });
    const mast = document.querySelector('header'); const masthead = mast ? rr(mast) : null;
    const legendEl = Array.from(document.querySelectorAll('body *')).find(e => getComputedStyle(e).position === 'fixed' && /next/i.test(e.textContent) && e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height < 60);
    const legend = legendEl ? rr(legendEl) : null;
    const margin = document.querySelector('[data-reader-margin]'); const centre = document.querySelector('[data-reader-centre]');
    const cs = centre ? getComputedStyle(centre) : null;
    return {
      tab: t, label: tab.getAttribute('aria-label') || tab.textContent.trim().slice(0, 30), hit, strip: s, stripHit, hitGapToStripHit: stripHit && hit ? stripHit.from - hit.to : null, gapFaceToStrip: s ? +(s.x - t.right).toFixed(2) : null,
      gapHitToStrip: s && hit ? +(s.x - hit.to).toFixed(2) : null,
      overlapFaceStrip: s ? +inter(t, s).toFixed(2) : null, overlapHitStrip: s ? +inter(hitRect, s).toFixed(2) : null,
      overlapCards: cards.map(c => ({ kind: c.kind, face: +inter(t, c.rect).toFixed(2), hit: +inter(hitRect, c.rect).toFixed(2), faceHeader: c.header ? +inter(t, c.header).toFixed(2) : 0, hitHeader: c.header ? +inter(hitRect, c.header).toFixed(2) : 0 })),
      cards: cards.map(c => ({ kind: c.kind, rect: c.rect, header: c.header })),
      masthead, overlapMasthead: masthead ? +inter(hitRect, masthead).toFixed(2) : 0, legend, overlapLegend: legend ? +inter(hitRect, legend).toFixed(2) : 0, tabBottomToLegendTop: legend ? +(legend.y - t.bottom).toFixed(2) : null,
      centre: centre ? { rect: rr(centre), paddingLeft: cs.paddingLeft, paddingRight: cs.paddingRight } : null, margin: margin ? rr(margin) : null, vw: innerWidth, vh: innerHeight,
    };
  });
  if (!out.base.tab) return out;
  // what stands under the tab's rect (face and hit span): distinct elements from a grid of elementsFromPoint
  out.under = await p.evaluate(() => {
    const { findTab } = window.__r4; const tab = findTab(); const t = tab.getBoundingClientRect(); const seen = {};
    for (let x = t.x - 4; x <= t.right + 1; x += 1.5) for (let y = t.y + 2; y < t.bottom; y += 12) for (const e of document.elementsFromPoint(x, y)) {
      if (e === tab || tab.contains(e) || e.contains(tab)) continue;
      const k = e.tagName + '.' + (e.getAttribute('data-reader-divider') ? 'divider-' + e.getAttribute('data-reader-divider') : (e.getAttribute('data-margin-card') ? 'card-' + e.getAttribute('data-margin-card') : (e.id || (typeof e.className === 'string' ? e.className : '').split(' ').slice(0, 2).join('.'))));
      seen[k] = (seen[k] || 0) + 1;
    }
    return seen;
  });
  // paper text and paper blocks against the tab's hit span, at several scroll positions
  out.text = [];
  for (const f of scrollFracs) {
    await p.evaluate((f) => { const max = document.documentElement.scrollHeight - innerHeight; window.scrollTo(0, Math.round(max * f)); }, f);
    await L.still(p); await p.waitForTimeout(250);
    out.text.push(await p.evaluate((f) => {
      const { rr, findTab } = window.__r4; const tab = findTab(); if (!tab) return { f, tab: null };
      const t = tab.getBoundingClientRect(); const hit = window.__r4.hitFrom !== undefined ? window.__r4.hitFrom : t.x - 3;
      // the hit area starts 3 px left of the face (the ::before strip); probe the real span at mid height
      let hx = []; const mid = t.y + t.height / 2; for (let x = Math.floor(t.x - 10); x <= Math.ceil(t.right); x++) { const e = document.elementFromPoint(x + 0.5, mid); if (e && (e === tab || tab.contains(e))) hx.push(x); }
      const hitLeft = hx.length ? hx[0] : t.x;
      const body = document.querySelector('#paper-body'); const centre = document.querySelector('[data-reader-centre]');
      let maxRight = -1, nearest = null, nRects = 0; let maxBlockRight = -1, blockKind = null;
      const roots = [centre || body];
      for (const root of roots) {
        const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        while (w.nextNode()) { const n = w.currentNode; if (!n.textContent.trim()) continue; if (n.parentElement && n.parentElement.closest('button, [data-reader-divider]')) continue; const rg = document.createRange(); rg.selectNodeContents(n); for (const r of rg.getClientRects()) { if (r.width === 0) continue; if (r.bottom < t.y || r.top > t.bottom) continue; nRects++; if (r.right > maxRight) { maxRight = r.right; nearest = { x: +r.x.toFixed(1), right: +r.right.toFixed(1), y: +r.y.toFixed(1) }; } } }
        for (const e of root.querySelectorAll('img, svg, canvas, table, figure, pre, [data-figure]')) { const r = e.getBoundingClientRect(); if (r.width === 0 || r.bottom < t.y || r.top > t.bottom) continue; if (r.right > maxBlockRight) { maxBlockRight = r.right; blockKind = e.tagName; } }
      }
      return { f, scrollY: Math.round(scrollY), tabY: +t.y.toFixed(1), hitLeft, textRectsInTabBand: nRects, maxTextRight: +maxRight.toFixed(2), nearestText: nearest, gapTextToHit: maxRight >= 0 ? +(hitLeft - maxRight).toFixed(2) : null, gapTextToFace: maxRight >= 0 ? +(t.x - maxRight).toFixed(2) : null, maxBlockRight: +maxBlockRight.toFixed(2), blockKind, gapBlockToHit: maxBlockRight >= 0 ? +(hitLeft - maxBlockRight).toFixed(2) : null };
    }, f));
  }
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  return out;
}

async function scanStrip(p) {
  return p.evaluate(() => {
    const out = {}; const legendEl = Array.from(document.querySelectorAll('body *')).find(e => getComputedStyle(e).position === 'fixed' && /next/i.test(e.textContent) && e.getBoundingClientRect().width > 200 && e.getBoundingClientRect().height < 60);
    const lg = legendEl ? legendEl.getBoundingClientRect() : null;
    for (const s of document.querySelectorAll('[data-reader-divider]')) {
      const b = s.getBoundingClientRect(); const pane = s.getAttribute('data-reader-divider'); const vh = innerHeight;
      const y0 = Math.max(b.top, 0) + 4, y1 = Math.min(b.bottom, vh) - 4; let total = 0, hit = 0, colresize = 0; const blocked = []; const cursors = {};
      for (let y = y0; y <= y1; y += 20) for (const dx of [0, 0.5, b.width / 2, b.width - 1, b.width - 0.5]) { total++; const el = document.elementFromPoint(b.left + dx, y); const sep = el && el.closest('[data-reader-divider]'); const cur = el ? getComputedStyle(el).cursor : null; cursors[cur] = (cursors[cur] || 0) + 1; if (sep === s) { hit++; if (cur === 'col-resize') colresize++; } else blocked.push({ y: Math.round(y), dx: +dx.toFixed(1), el: el ? el.tagName + ':' + ((el.closest('[aria-label]') || {}).getAttribute ? el.closest('[aria-label]').getAttribute('aria-label') : '') : null, cursor: cur }); }
      out[pane] = { rect: { x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2), bottom: +b.bottom.toFixed(2) }, total, hit, colresize, blocked: blocked.slice(0, 6), nBlocked: blocked.length, cursors, legendTop: lg ? +lg.top.toFixed(2) : null, bottomMinusLegendTop: lg ? +(b.bottom - lg.top).toFixed(2) : null };
    }
    return out;
  });
}

async function dragStrip(p, y, dx, label, res) {
  const sep = await B.sepRect(p, 'margin'); if (!sep) { res[label] = { err: 'no divider' }; return; }
  const before = await B.gridWidths(p); const x = sep.x + sep.w / 2;
  await p.mouse.move(x, y);
  const hover = await p.evaluate(({ x, y }) => { const e = document.elementFromPoint(x, y); return e ? { cursor: getComputedStyle(e).cursor, onDivider: !!e.closest('[data-reader-divider]'), tag: e.tagName, label: (e.getAttribute('aria-label') || '').slice(0, 30) } : null; }, { x, y });
  await p.mouse.down(); await p.mouse.move(x + dx / 2, y, { steps: 5 }); await p.mouse.move(x + dx, y, { steps: 5 }); await p.mouse.up(); await p.waitForTimeout(600);
  const after = await B.gridWidths(p); const notes = await p.evaluate(() => !!document.querySelector('section[aria-label="Your notes"]'));
  const sepAfter = await p.evaluate(() => { const s = document.querySelector('[data-reader-divider="margin"]'); return s ? { now: s.getAttribute('aria-valuenow'), min: s.getAttribute('aria-valuemin'), max: s.getAttribute('aria-valuemax') } : null; });
  res[label] = { y: Math.round(y), dx, hover, marginBefore: before.margin, marginAfter: after.margin, changed: before.margin !== after.margin, notesWindowOpened: notes, aria: sepAfter };
  if (notes) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
}

(async () => {
  const w = L.W[wn];
  const s = nc === 1 ? await L.openPaper(key, w, {}) : await L.openKey(key, w, {}); const p = s.page;
  if (stepIdx !== 2) await L.setStep(p, stepIdx);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx);
  const cell = `R4TAB-${key}-${wn}-n${nc}-${stepName}-light`;
  const res = { cell, input: key, width: wn, viewport: w, step: stepIdx, nCards: nc, profile: nc === 1 ? 'no key' : 'placeholder key (stub)', load: require('os').loadavg()[0], steps: [] };
  const hash0 = await L.bodyHash(p);
  const paras = await C.goodParas(p); const y0 = Math.min(300, Math.round(w[1] * 0.4));
  res.noCard = await measure(p, 'noCard', [0.5]);
  await C.openSticky(p, paras[4], { y: y0 }); res.steps.push('sticky');
  if (nc >= 2) { await C.openExplain(p, paras[8], { y: y0 }); res.steps.push('explain'); }
  if (nc >= 3) { res.figureHow = await C.openFigure(p, 1, { wait: 2500 }); res.steps.push('figure:' + res.figureHow); }
  await p.waitForTimeout(800); await L.still(p);
  const ci = await C.cardsInfo(p); res.cardsOpen = ci.cards.map(c => c.kind); res.cardRects = ci.cards.map(c => ({ kind: c.kind, top: c.rect.top, h: c.rect.h, left: c.rect.left, w: c.rect.w }));
  res.withCards = await measure(p, 'withCards', [0, 0.25, 0.5, 0.75]);
  await p.screenshot({ path: `${PACK}/${cell}.png` });
  const t = res.withCards.base.tab;
  if (t) {
    const sepNow = await B.sepRect(p, 'margin');
    const cx = Math.max(0, Math.round(t.x - 70)); const cw = Math.min(w[0] - cx, 170);
    await p.screenshot({ path: `${PACK}/${cell}-tabzoom.png`, clip: { x: cx, y: Math.max(0, Math.round(t.y - 30)), width: cw, height: Math.min(w[1] - Math.max(0, Math.round(t.y - 30)), Math.round(t.h + 60)) } });
    res.scan = await scanStrip(p);
    // real drags with the cards open: at the tab's height (centre, top end, bottom end), then clear of the tab; each in both directions
    await dragStrip(p, t.y + t.h / 2, -60, 'dragAtTabMid_left', res);
    await dragStrip(p, t.y + t.h / 2, 60, 'dragAtTabMid_right', res);
    await dragStrip(p, t.y + 10, -60, 'dragAtTabTop_left', res);
    await dragStrip(p, t.y + 10, 60, 'dragAtTabTop_right', res);
    await dragStrip(p, t.y + t.h - 10, -60, 'dragAtTabBottom_left', res);
    await dragStrip(p, t.y + t.h - 10, 60, 'dragAtTabBottom_right', res);
    const yClear = (t.y + t.h + 40 < sepNow.y + sepNow.h - 30 && t.y + t.h + 40 < w[1] - 40) ? t.y + t.h + 40 : t.y - 40;
    await dragStrip(p, yClear, -60, 'dragClear_left', res);
    await dragStrip(p, yClear, 60, 'dragClear_right', res);
    // a press on the tab itself still opens the notes window (it must not be lost)
    const tb = await p.evaluate(() => { const { findTab } = window.__r4; const tt = findTab(); const r = tt.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
    await p.mouse.click(tb.x, tb.y); await p.waitForTimeout(900);
    res.tabPress = { notesWindowOpened: await p.evaluate(() => !!document.querySelector('section[aria-label="Your notes"]')) };
    if (res.tabPress.notesWindowOpened) { await p.keyboard.press('Escape'); await p.waitForTimeout(500); }
  }
  try { await C.closeAll(p); } catch (e) { res.closeErr = String(e.message).slice(0, 100); }
  await p.waitForTimeout(500);
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = s.log.pageerrors; res.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/${cell}.json`, JSON.stringify(res, null, 1));
  const b = res.withCards.base;
  console.log(cell, 'cards', JSON.stringify(res.cardsOpen), 'gapFaceToStrip', b.gapFaceToStrip, 'overlapStrip face/hit', b.overlapFaceStrip, b.overlapHitStrip, 'hit', JSON.stringify(b.hit), 'textGap', JSON.stringify(res.withCards.text.map(x => x.gapTextToHit)), 'drag', res.dragAtTabMid_left && res.dragAtTabMid_left.marginBefore + '>' + res.dragAtTabMid_left.marginAfter, 'scan', JSON.stringify(Object.fromEntries(Object.entries(res.scan || {}).map(([k, v]) => [k, v.colresize + '/' + v.total]))));
  await s.browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
