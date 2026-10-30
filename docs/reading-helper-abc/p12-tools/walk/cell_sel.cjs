// B6 cell: five selection kinds (+ the chain for the cross-paragraph highlight at W1)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
const PACK = L.R + '/pack';
const crypto = require('crypto');
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 12);

const marksInfo = (p) => p.evaluate(() => { const m = Array.from(document.querySelectorAll('mark[data-highlight]')).filter(e => !e.closest('section[aria-label="Your notes"]')); const par = new Set(m.map(e => { const q = e.closest('p,h1,h2,h3,h4,h5,li,figcaption,div'); return q ? Array.prototype.indexOf.call(document.querySelectorAll('*'), q) : -1; })); return { marks: m.length, blocks: par.size, bg: m[0] ? getComputedStyle(m[0]).backgroundColor : null, words: m.reduce((a, e) => a + e.textContent.length, 0), textHash: null }; });
const toolbarNames = async (p) => { const t = await C.toolbar(p); return t ? t.buttons.map(b => b.name) : null; };
const selText = (p) => p.evaluate(() => getSelection().toString());
const clearSel = async (p) => { await p.evaluate(() => getSelection().removeAllRanges()); await p.waitForTimeout(200); };
async function strip(p) { return p.evaluate(() => { const t = document.querySelector('[role=toolbar][aria-label="Highlight"]'); if (!t) return null; const r = t.getBoundingClientRect(); return { rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], buttons: Array.from(t.querySelectorAll('button')).map(b => b.getAttribute('aria-label') || b.textContent.trim()) }; }); }
async function removeHighlight(p) { const b = p.getByRole('button', { name: 'Remove highlight' }).first(); if (await b.count()) { await b.click(); await p.waitForTimeout(700); } }
async function notesRows(p) { // rows of highlight entries in the notes window
  return p.evaluate(() => { const w = document.querySelector('section[aria-label="Your notes"]'); if (!w) return null; return { rows: w.querySelectorAll('[data-row]').length, swatches: w.querySelectorAll('[data-highlight-row], [data-hl-row]').length, marksInRows: w.querySelectorAll('mark, [style*="background"]').length, text: w.innerText.length }; });
}

// drag-select helpers -------------------------------------------------------------------------------------
async function dragSelect(p, x0, y0, x1, y1) { await p.mouse.move(x0, y0); await p.mouse.down(); await p.mouse.move((x0 + x1) / 2, (y0 + y1) / 2, { steps: 6 }); await p.mouse.move(x1, y1, { steps: 6 }); await p.mouse.up(); await p.waitForTimeout(700); }
async function selInPara(p, paras) {
  const idx = paras[Math.min(paras.length - 1, 4)];
  const sel = await C.selectPara(p, idx, { y: 260 }); return { idx, sel };
}
async function selAcross(p, paras) {
  // last line of paragraph A to the first line of the next paragraph B in DOM order
  const info = await p.evaluate(() => { const ps = Array.from(document.querySelectorAll('#paper-body p')); let seen = 0; for (let i = 3; i < ps.length - 1; i++) { const a = ps[i], b = ps[i + 1]; if (a.textContent.length > 120 && b.textContent.length > 120 && !a.closest('figure') && !b.closest('figure')) { const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect(); if (rb.top - ra.bottom < 120 && rb.top > ra.bottom) { if (++seen >= 2) return i; } } } return null; });
  if (info === null) return { idx: null, sel: null };
  await p.evaluate((i) => { const a = document.querySelectorAll('#paper-body p')[i]; const r = a.getBoundingClientRect(); window.scrollBy(0, r.bottom - innerHeight * 0.55); }, info); await L.still(p);
  const g = await p.evaluate((i) => { const ps = document.querySelectorAll('#paper-body p'); const a = ps[i].getBoundingClientRect(), b = ps[i + 1].getBoundingClientRect(); const lh = parseFloat(getComputedStyle(ps[i]).lineHeight) || 28; return { ax: a.x, ay: a.bottom - lh / 2, aw: a.width, bx: b.x, by: b.top + lh / 2, bw: b.width, vh: innerHeight }; }, info);
  if (g.by > g.vh - 20) return { idx: info, sel: null, reason: 'second paragraph below the fold' };
  await dragSelect(p, g.ax + 60, g.ay, g.bx + 260, g.by);
  const sel = await p.evaluate(() => { const s = getSelection(); if (!s || s.isCollapsed) return null; return { len: s.toString().length, paragraphs: Array.from(document.querySelectorAll('#paper-body p')).filter(q => s.containsNode(q, true)).length }; });
  return { idx: info, sel };
}
async function selHeading(p) {
  const h = await p.evaluate(() => { const hs = Array.from(document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4')).filter(e => e.textContent.trim().length > 10 && e.getBoundingClientRect().width > 100); return hs.length ? Array.prototype.indexOf.call(document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4'), hs[Math.min(2, hs.length - 1)]) : null; });
  if (h === null) return { idx: null, sel: null };
  await p.evaluate((h) => { const e = document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4')[h]; window.scrollBy(0, e.getBoundingClientRect().top - 260); }, h); await L.still(p);
  const b = await p.evaluate((h) => { const e = document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4')[h]; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, w: r.width }; }, h);
  await dragSelect(p, b.x + 6, b.y, b.x + Math.min(b.w - 6, 160), b.y);
  const sel = await p.evaluate(() => { const s = getSelection(); return s && !s.isCollapsed ? { len: s.toString().length } : null; });
  return { idx: h, sel, kind: 'heading' };
}
async function selCaption(p) {
  const c = await p.evaluate(() => { const cs = Array.from(document.querySelectorAll('#paper-body figcaption')).filter(e => e.getBoundingClientRect().width > 100); return cs.length ? Array.prototype.indexOf.call(document.querySelectorAll('#paper-body figcaption'), cs[0]) : null; });
  if (c === null) return { idx: null, sel: null, kind: 'caption' };
  await p.evaluate((c) => { const e = document.querySelectorAll('#paper-body figcaption')[c]; window.scrollBy(0, e.getBoundingClientRect().top - 260); }, c); await L.still(p);
  const b = await p.evaluate((c) => { const e = document.querySelectorAll('#paper-body figcaption')[c]; const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 18; return { x: r.x, y: r.y + lh / 2, w: r.width }; }, c);
  await dragSelect(p, b.x + 6, b.y, b.x + Math.min(b.w - 10, 260), b.y);
  const sel = await p.evaluate(() => { const s = getSelection(); return s && !s.isCollapsed ? { len: s.toString().length } : null; });
  return { idx: c, sel, kind: 'caption' };
}
async function openTab(p, name) {
  const tab = p.getByRole('tab', { name });
  if (!(await tab.isVisible().catch(() => false))) { const rail = p.locator('[data-reader-rail]').first(); if (await rail.count()) { await rail.hover(); await p.waitForTimeout(1600); } }
  await tab.click({ timeout: 20000 }); await p.mouse.move(700, 400); await p.waitForTimeout(500);
  { const st = await p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); return l && l.getAttribute('data-state'); }); if (st === 'peek') { await p.keyboard.press('Escape'); await p.waitForTimeout(600); } }
}
async function selSummary(p) {
  await openTab(p, 'Summary'); await p.waitForTimeout(1500);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const tgt = await p.evaluate(() => { const panel = document.querySelector('[role=tabpanel]'); if (!panel) return null; const els = Array.from(panel.querySelectorAll('p, li, blockquote')).filter(e => e.textContent.trim().length > 60 && e.getBoundingClientRect().width > 150); if (!els.length) return { n: 0 }; const e = els[0]; return { n: els.length, i: Array.prototype.indexOf.call(panel.querySelectorAll('p, li, blockquote'), e) }; });
  if (!tgt || !tgt.n) return { idx: null, sel: null, kind: 'summary', panel: !!tgt };
  await p.evaluate((i) => { const panel = document.querySelector('[role=tabpanel]'); const e = panel.querySelectorAll('p, li, blockquote')[i]; window.scrollBy(0, e.getBoundingClientRect().top - 260); }, tgt.i); await L.still(p);
  const b = await p.evaluate((i) => { const panel = document.querySelector('[role=tabpanel]'); const e = panel.querySelectorAll('p, li, blockquote')[i]; const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 24; return { x: r.x, y: r.y + lh / 2, w: r.width, tag: e.tagName }; }, tgt.i);
  await dragSelect(p, b.x + 20, b.y, b.x + Math.min(b.w - 20, 240), b.y);
  const sel = await p.evaluate(() => { const s = getSelection(); return s && !s.isCollapsed ? { len: s.toString().length } : null; });
  return { idx: tgt.i, sel, kind: 'summary', blocks: tgt.n, tag: b.tag };
}
async function selAnswer(p, question) {
  await openTab(p, 'Paper digestion').catch(() => {}); await p.waitForTimeout(600);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const bar = p.getByPlaceholder(/What should this paper answer/i).first();
  const cur = await bar.inputValue();
  if (cur !== question) { await bar.click(); await bar.fill(question); await p.waitForTimeout(500); }
  const sb = p.getByRole('button', { name: /^Submit(ted)?$/ }).first(); if (((await sb.textContent()) || '').trim() === 'Submit') await sb.click();
  let ctl = null; for (let i = 0; i < 90 && !ctl; i++) { await p.waitForTimeout(1000); ctl = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)); return b ? b.getAttribute('aria-expanded') : null; }); }
  if (ctl === null) return { idx: null, sel: null, kind: 'answer', note: 'the answers control never appeared' };
  if (ctl !== 'true') { await p.evaluate(() => Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)).click()); await p.waitForTimeout(1200); }
  const tgt = await p.evaluate(() => { const pn = document.getElementById('ask-answers-panel'); if (!pn) return { n: 0 }; const els = Array.from(pn.querySelectorAll('p, li, span, div')).filter(e => e.children.length === 0 && e.textContent.trim().length > 40 && e.getBoundingClientRect().width > 150); return { n: els.length, i: els.length ? Array.prototype.indexOf.call(pn.querySelectorAll('p, li, span, div'), els[0]) : null }; });
  if (!tgt.n) return { idx: null, sel: null, kind: 'answer', note: 'panel open but no answer text', tgt };
  await p.evaluate((i) => { const pn = document.getElementById('ask-answers-panel'); const e = pn.querySelectorAll('p, li, span, div')[i]; window.scrollBy(0, e.getBoundingClientRect().top - 260); }, tgt.i); await L.still(p);
  const b = await p.evaluate((i) => { const pn = document.getElementById('ask-answers-panel'); const e = pn.querySelectorAll('p, li, span, div')[i]; const r = e.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(e).lineHeight) || 22; return { x: r.x, y: r.y + lh / 2, w: r.width }; }, tgt.i);
  await dragSelect(p, b.x + 10, b.y, b.x + Math.min(b.w - 10, 220), b.y);
  const sel = await p.evaluate(() => { const s = getSelection(); return s && !s.isCollapsed ? { len: s.toString().length } : null; });
  return { idx: tgt.i, sel, kind: 'answer', tgt };
}
module.exports = { openTab, marksInfo, toolbarNames, selText, clearSel, strip, removeHighlight, notesRows, dragSelect, selInPara, selAcross, selHeading, selCaption, selSummary, selAnswer, sha };
