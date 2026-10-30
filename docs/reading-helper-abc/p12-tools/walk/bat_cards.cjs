const L = require('./lib2.cjs');

// ---- selection + opening cards ----
async function goodParas(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#paper-body p')).map((p, i) => ({ i, len: p.textContent.length, fig: !!p.closest('figure,[data-figure]'), w: p.getBoundingClientRect().width })).filter(x => x.len > 350 && !x.fig && x.w > 200).map(x => x.i));
}
async function scrollParaTo(page, idx, y = 260) {
  await page.evaluate(({ idx, y }) => { const p = document.querySelectorAll('#paper-body p')[idx]; const r = p.getBoundingClientRect(); window.scrollBy(0, r.top - y); }, { idx, y });
  await L.still(page);
}
async function selectPara(page, idx, o = {}) {
  const vh = page.viewportSize().height; const yy = Math.min(o.y || 260, Math.round(vh * 0.42));
  let result = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    await scrollParaTo(page, idx, yy);
    const box = await page.evaluate((idx) => { const p = document.querySelectorAll('#paper-body p')[idx]; const r = p.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(p).lineHeight) || 28; return { x: r.x, y: r.y, w: r.width, h: r.height, lh }; }, idx);
    const y = box.y + box.lh * (o.line || 0) + box.lh / 2;
    const x0 = box.x + (o.x0 ?? 30), x1 = box.x + (o.x1 ?? Math.min(box.w - 40, 300));
    await page.mouse.move(x0, y); await page.mouse.down(); await page.mouse.move((x0 + x1) / 2, y, { steps: 5 }); await page.mouse.move(x1, y, { steps: 5 }); await page.mouse.up();
    // the group of actions follows a settled selection; under load it can come later than 600 ms
    for (let i = 0; i < 16; i++) { await page.waitForTimeout(400); if (await toolbar(page)) break; }
    result = await page.evaluate(() => { const s = getSelection(); if (!s || s.isCollapsed) return null; const rc = s.getRangeAt(0).getClientRects(); return { firstLineTop: +rc[0].top.toFixed(1), firstLineBottom: +rc[0].bottom.toFixed(1), len: s.toString().length }; });
    if (result && await toolbar(page)) { if (attempt) result.retries = attempt; return result; }
    if (!o.noRetry) { await page.evaluate(() => getSelection().removeAllRanges()); await page.waitForTimeout(500); } else break;
  }
  if (result) result.toolbarMissing = true;
  return result;
}
async function toolbar(page) {
  return page.evaluate(() => {
    const NAMES = ['Explain this', 'Explain this?', 'Take notes', 'Highlight'];
    let t = document.querySelector('[role=toolbar][aria-label="Selection actions"]');
    let buttons = t ? Array.from(t.querySelectorAll('button')) : [];
    let phone = false;
    if (!t) { // the phone's thumb bar: three plain buttons at the foot of the window
      buttons = Array.from(document.querySelectorAll('button')).filter(b => NAMES.includes(b.textContent.trim()) && b.getBoundingClientRect().width > 0 && !b.closest('[data-margin-card]') && !b.closest('section[aria-label="Your notes"]'));
      if (!buttons.length) return null; phone = true;
    }
    const r0 = t ? t.getBoundingClientRect() : (() => { const rs = buttons.map(b => b.getBoundingClientRect()); const x = Math.min(...rs.map(r => r.x)), y = Math.min(...rs.map(r => r.y)); return { x, y, width: Math.max(...rs.map(r => r.right)) - x, height: Math.max(...rs.map(r => r.bottom)) - y }; })();
    return { phone, x: +r0.x.toFixed(1), y: +r0.y.toFixed(1), w: +r0.width.toFixed(1), h: +r0.height.toFixed(1), buttons: buttons.map(b => ({ name: b.textContent.trim(), disabled: b.disabled, rect: (() => { const q = b.getBoundingClientRect(); return [Math.round(q.x), Math.round(q.y), Math.round(q.width), Math.round(q.height)]; })() })) };
  });
}
async function topOf(page, i) { return page.evaluate((i) => { const e = document.querySelectorAll('#paper-body p')[i]; if (!e) return null; const r = e.getBoundingClientRect(); return { top: +r.top.toFixed(1), left: +r.left.toFixed(1), w: +r.width.toFixed(1), scrollY: Math.round(scrollY) }; }, i); }
async function openExplain(page, idx, o = {}) {
  const sel = await selectPara(page, idx, o);
  const before = await topOf(page, idx);
  await page.getByRole('button', { name: 'Explain this' }).click({ timeout: 60000, noWaitAfter: true });
  await page.waitForTimeout(o.wait || 2500);
  const after = await topOf(page, idx);
  if (sel) sel.paperMove = { idx, before, after, dTop: before && after ? +(after.top - before.top).toFixed(1) : null, dLeft: before && after ? +(after.left - before.left).toFixed(1) : null, dW: before && after ? +(after.w - before.w).toFixed(1) : null };
  return sel;
}
async function openSticky(page, idx, o = {}) {
  const sel = await selectPara(page, idx, o);
  const before = await topOf(page, idx);
  await page.getByRole('button', { name: 'Take notes' }).click({ timeout: 60000, noWaitAfter: true });
  await page.waitForTimeout(o.wait || 1200);
  const after = await topOf(page, idx);
  if (sel) sel.paperMove = { idx, before, after, dTop: before && after ? +(after.top - before.top).toFixed(1) : null, dLeft: before && after ? +(after.left - before.left).toFixed(1) : null, dW: before && after ? +(after.w - before.w).toFixed(1) : null };
  return sel;
}
async function openFigure(page, n, o = {}) {
  // the first body figure that has an image (its button has a box once the lazy image has loaded), else the left plate
  let how = null;
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll('button[aria-label^="Open Fig"]')).map(b => b.getAttribute('aria-label')));
  for (const label of labels) {
    try {
      const b = page.getByRole('button', { name: label, exact: true }).first();
      await b.scrollIntoViewIfNeeded({ timeout: 3000 }); await page.waitForTimeout(900);
      const bb = await b.boundingBox({ timeout: 2000 });
      if (bb && bb.width > 20 && bb.height > 20) { await b.click({ timeout: 5000 }); how = 'body:' + label; break; }
    } catch (e) { /* the button vanished (its image failed) or never had a box: next one */ }
  }
  if (how === null) {
    const plate = page.getByRole('button', { name: 'Enlarge figure' }).first();
    let vis = await plate.isVisible().catch(() => false);
    if (!vis) { // the left pane is the rail here: hover it to peek, then press the plate
      const rail = page.locator('[data-reader-rail]').first();
      if (await rail.count()) { await rail.hover(); await page.waitForTimeout(900); vis = await plate.isVisible().catch(() => false); }
    }
    if (!vis) return 'none-reachable';
    await plate.click({ timeout: 8000 }); how = 'plate';
  }
  await page.waitForTimeout(o.wait || 2500);
  return how;
}
async function cardsInfo(page) {
  return page.evaluate(() => {
    const rr = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), left: +b.left.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const cards = Array.from(document.querySelectorAll('[data-margin-card]')).map(c => {
      const hd = c.querySelector('[data-margin-header],[data-figure-header]'); const body = c.querySelector('[data-margin-body]') || c.querySelector('[data-figure-box]');
      const cap = c.querySelector('[data-figure-caption]');
      return { kind: c.getAttribute('data-margin-card'), id: c.getAttribute('data-margin-id'), rect: rr(c), header: rr(hd && (hd.closest('div.flex.h-10') || hd)), body: body ? { rect: rr(body), clientH: body.clientHeight, scrollH: body.scrollHeight, scrollTop: body.scrollTop, overflowY: getComputedStyle(body).overflowY } : null, caption: cap ? { clientH: cap.clientHeight, scrollH: cap.scrollHeight } : null };
    }).sort((a, b) => a.rect.top - b.rect.top);
    const divs = Array.from(document.querySelectorAll('[data-card-divider]')).map(d => ({ rect: rr(d), now: d.getAttribute('aria-valuenow'), min: d.getAttribute('aria-valuemin'), max: d.getAttribute('aria-valuemax'), controls: d.getAttribute('aria-controls') })).sort((a, b) => a.rect.top - b.rect.top);
    const track = document.querySelector('[data-split]');
    const trackInfo = track ? { split: track.dataset.split, role: track.getAttribute('role'), label: track.getAttribute('aria-label'), clientH: track.clientHeight, scrollH: track.scrollHeight, scrollTop: track.scrollTop, rect: rr(track), overflowY: getComputedStyle(track).overflowY, cssText: track.style.cssText.slice(0, 200) } : null;
    return { scrollY: Math.round(window.scrollY), cards, divs, track: trackInfo };
  });
}
async function refPara(page) { // first paragraph whose top is within the viewport, by index and top
  return page.evaluate(() => { const ps = Array.from(document.querySelectorAll('#paper-body p')); for (let i = 0; i < ps.length; i++) { const r = ps[i].getBoundingClientRect(); if (r.bottom > 70 && r.height > 0) return { i, top: +r.top.toFixed(1), left: +r.left.toFixed(1), w: +r.width.toFixed(1), scrollY: Math.round(scrollY) }; } return null; });
}
async function closeKind(page, kind) {
  if (kind === 'explain') await page.locator('[data-margin-card=explain] button[aria-label=Close]').first().click({ timeout: 60000, noWaitAfter: true });
  else if (kind === 'sticky') await page.locator('[data-margin-card=sticky] button[aria-label^="Delete note"]').first().click({ timeout: 60000, noWaitAfter: true });
  else if (kind === 'figure') await page.locator('[data-margin-card=figure] button[aria-label^="Close"]').first().click({ timeout: 60000, noWaitAfter: true });
  await page.waitForTimeout(700);
}
async function closeAll(page) {
  for (let i = 0; i < 8; i++) {
    const kinds = await page.evaluate(() => Array.from(document.querySelectorAll('[data-margin-card]')).map(c => c.getAttribute('data-margin-card')));
    if (!kinds.length) break;
    try { await closeKind(page, kinds[0]); } catch (e) { break; }
  }
  await page.waitForTimeout(500);
}
module.exports = { topOf, goodParas, scrollParaTo, selectPara, toolbar, openExplain, openSticky, openFigure, cardsInfo, refPara, closeKind, closeAll };
