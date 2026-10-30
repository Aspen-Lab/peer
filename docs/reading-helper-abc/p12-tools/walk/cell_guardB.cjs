// P11 guard lines B1, B2, B3, B4, B6 (notes page), B12 (keys, phone thumb bar) + A9/A10 (notes page, way back) at W1 default light, key profile
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
async function run(key) {
  const s = await L.openKey(key, L.W.W1, {}); const p = s.page; const cell = `${key}-W1-default-light`;
  const out = { cell, input: key, profile: 'placeholder-key (stub)', load: require('os').loadavg()[0], lines: {} }; const ln = out.lines;
  const ev = async (id, fn) => { try { ln[id] = await fn(); } catch (e) { ln[id] = { error: String(e.message).slice(0, 220) }; } };
  const paras = await C.goodParas(p); const hash0 = await L.bodyHash(p);
  await ev('B1', async () => { await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p); return p.evaluate(() => { const m = document.querySelector('[data-reader-margin]'); const r = m.getBoundingClientRect(); return { marginRect: [Math.round(r.x), Math.round(r.y), Math.round(r.width)], text: m.innerText.length, visibleChildren: Array.from(m.children).filter(c => c.getBoundingClientRect().height > 0).length, cards: document.querySelectorAll('[data-margin-card]').length, bottomRoom: (document.querySelector('[data-reader-bottom-room]') || { style: { height: null } }).style.height, selectionToolbar: !!document.querySelector('[role=toolbar][aria-label="Selection actions"]') }; }); });
  await ev('B2', async () => {
    const r = {}; const sel = await C.selectPara(p, paras[4], { y: 300 }); r.sel = sel; const tb = await C.toolbar(p); r.toolbar = tb;
    r.names = tb && tb.buttons.map(b => b.name); r.deltaTop = tb && sel ? +(tb.y - sel.firstLineTop).toFixed(1) : null;
    r.inMargin = tb ? tb.x >= (await p.evaluate(() => document.querySelector('[data-reader-margin]').getBoundingClientRect().left)) : null;
    await p.screenshot({ path: `${PACK}/GB2-${cell}.png` });
    // goes when the selection goes
    await p.mouse.click(700, 120); await sleep(p, 800); r.afterClearToolbar = !!(await C.toolbar(p));
    return r;
  });
  await ev('B3', async () => {
    const r = {}; const sel = await C.openExplain(p, paras[5], { y: 300, wait: 2000 }); const ci = await C.cardsInfo(p); r.at2s = ci.cards[0] && +(ci.cards[0].rect.top - sel.firstLineTop).toFixed(1);
    await sleep(p, 5000); const ci2 = await C.cardsInfo(p); r.at7s = ci2.cards[0] && +(ci2.cards[0].rect.top - sel.firstLineTop).toFixed(1); r.insideMargin = ci2.cards[0] && ci2.cards[0].rect.left >= 1070 && ci2.cards[0].rect.left + ci2.cards[0].rect.w <= 1440;
    await p.screenshot({ path: `${PACK}/GB3-${cell}.png` }); await C.closeAll(p); return r;
  });
  await ev('B4', async () => {
    const r = {}; const sel = await C.openSticky(p, paras[6], { y: 300 }); const ci = await C.cardsInfo(p); r.stickyDelta = ci.cards[0] && +(ci.cards[0].rect.top - sel.firstLineTop).toFixed(1);
    r.tagsInPaper = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body *')).filter(e => e.children.length === 0 && /^\[\d+\]$/.test(e.textContent.trim())).map(e => e.tagName + ':' + e.textContent.trim()).slice(0, 5));
    r.markNear = await p.evaluate(() => document.querySelectorAll('#paper-body mark, #paper-body [data-sticky], #paper-body [data-note-mark]').length);
    // the note is a row of the paper's overall note
    await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200); r.notesWindowRows = await p.evaluate(() => { const w = document.querySelector('section[aria-label="Your notes"]'); return w ? w.querySelectorAll('[data-row]').length : null; });
    await p.getByRole('button', { name: 'Close your notes' }).click().catch(() => {}); await sleep(p, 500);
    await p.screenshot({ path: `${PACK}/GB4-${cell}.png` }); await C.closeAll(p); return r;
  });
  await ev('B12', async () => {
    const r = {}; await p.evaluate(() => { getSelection().removeAllRanges(); }); await sleep(p, 300);
    const counts = async () => ({ marks: (await S.marksInfo(p)).marks, cards: (await C.cardsInfo(p)).cards.map(c => c.kind) });
    r.nothingSelected = {}; for (const k of ['h', 'n', 'e']) { await p.keyboard.press(k); await sleep(p, 700); r.nothingSelected[k] = await counts(); }
    await C.closeAll(p);
    await C.selectPara(p, paras[4], { y: 300 }); await p.keyboard.press('h'); await sleep(p, 900); r.h = await counts(); await S.removeHighlight(p);
    await C.selectPara(p, paras[5], { y: 300 }); await p.keyboard.press('n'); await sleep(p, 1200); r.n = await counts(); await C.closeAll(p);
    await C.selectPara(p, paras[6], { y: 300 }); await p.keyboard.press('e'); await sleep(p, 2500); r.e = await counts(); await C.closeAll(p);
    return r;
  });
  await ev('B6notesPage', async () => {
    const r = {}; await C.selectPara(p, paras[4], { y: 300 }); await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1000);
    const words = (await p.evaluate(() => Array.from(document.querySelectorAll('mark[data-highlight]')).map(m => m.textContent))).map(t => t.replace(/\s+/g, ' ').trim());
    await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200);
    const link = p.getByRole('link', { name: /Open as page/ }).first(); r.pageHref = (await link.getAttribute('href')) || null;
    r.mark = { bg: (await S.marksInfo(p)).bg };
    const urlBefore = p.url(); await link.click(); await p.waitForURL(/\/notes\//, { timeout: 30000 }).catch(() => {}); await sleep(p, 2500);
    r.notesUrl = p.url().replace(L.BASE, '').slice(0, 40); r.notesPageHasWords = await p.evaluate((words) => { const t = document.body.innerText.replace(/\s+/g, ' '); return words.every(w => t.includes(w)); }, words);
    r.backLabel = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('a,button')).find(e => /back to paper|^saved$/i.test(e.textContent.trim())); return b ? b.textContent.trim() : null; });
    await p.screenshot({ path: `${PACK}/GB6-notes-page-${cell}.png` });
    r.A9 = {}; const back = p.getByText(/Back to paper/i).first(); if (await back.count()) { await back.click(); await p.waitForURL(/\/papers\//, { timeout: 30000 }).catch(() => {}); await p.waitForSelector('#paper-body', { timeout: 60000 }).catch(() => {}); await sleep(p, 2500); r.A9.returnedTo = p.url().replace(L.BASE, '').slice(0, 40); r.A9.sameAsStart = p.url() === urlBefore; r.A9.tabSelected = await p.evaluate(() => Array.from(document.querySelectorAll('[role=tab]')).filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.textContent.trim())); }
    await S.removeHighlight(p); return r;
  });
  await ev('A10', async () => {
    const r = {}; for (const tab of ['Paper digestion', 'Summary']) {
      await p.getByRole('tab', { name: tab }).click().catch(() => {}); await sleep(p, 1200);
      await p.evaluate(() => window.scrollTo(0, 0)); await sleep(p, 300); await p.evaluate(() => window.scrollBy(0, 2600)); await L.still(p);
      const first = await C.refPara(p); const firstY = await p.evaluate(() => { const els = Array.from(document.querySelectorAll('[role=tabpanel] p, #paper-body p')); for (const e of els) { const rr = e.getBoundingClientRect(); if (rr.bottom > 70 && rr.height > 0) return { idx: els.indexOf(e), top: Math.round(rr.top) }; } return null; });
      const scrollY0 = await p.evaluate(() => Math.round(scrollY));
      await p.getByRole('button', { name: 'Notes' }).click().catch(() => {}); await sleep(p, 1000);
      const link = p.getByRole('link', { name: /Open as page/ }).first(); await link.click(); await p.waitForURL(/\/notes\//, { timeout: 30000 }).catch(() => {}); await sleep(p, 2500);
      await p.getByText(/Back to paper/i).first().click(); await p.waitForURL(/\/papers\//, { timeout: 30000 }).catch(() => {}); await p.waitForSelector('#paper-body', { timeout: 60000 }).catch(() => {}); await L.settleBody(p); await sleep(p, 2500); await L.still(p);
      const firstY1 = await p.evaluate(() => { const els = Array.from(document.querySelectorAll('[role=tabpanel] p, #paper-body p')); for (const e of els) { const rr = e.getBoundingClientRect(); if (rr.bottom > 70 && rr.height > 0) return { idx: els.indexOf(e), top: Math.round(rr.top) }; } return null; });
      r[tab] = { scrollYBefore: scrollY0, scrollYAfter: await p.evaluate(() => Math.round(scrollY)), firstParaBefore: firstY, firstParaAfter: firstY1, tabAfter: await p.evaluate(() => Array.from(document.querySelectorAll('[role=tab]')).filter(t => t.getAttribute('aria-selected') === 'true').map(t => t.textContent.trim())) };
    }
    return r;
  });
  await ev('B12phone', async () => {
    await S.openTab(p, 'Paper digestion').catch(() => {}); await sleep(p, 1200); await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
    await p.setViewportSize({ width: 390, height: 844 }); await sleep(p, 1500); const r = {};
    const sel = await C.selectPara(p, paras[4], { y: 300 }); r.sel = sel; r.toolbar = await C.toolbar(p); r.names = r.toolbar && r.toolbar.buttons.map(b => b.name);
    await p.screenshot({ path: `${PACK}/GB12-phone-${cell}.png` }); await p.setViewportSize({ width: 1440, height: 900 }); await sleep(p, 1000); return r;
  });
  await S.openTab(p, 'Paper digestion').catch(() => {}); await sleep(p, 1200);
  out.hashBefore = hash0; out.hashAfter = await L.bodyHash(p);
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/GB-${cell}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(o => console.log(o.cell, Object.entries(o.lines).map(([k, v]) => k + (v && v.error ? ':ERR' : ':ok')).join(' '))).catch(e => { console.error('ERR', e); process.exit(1); });
