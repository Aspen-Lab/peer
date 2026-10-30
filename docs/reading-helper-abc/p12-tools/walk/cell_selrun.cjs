// B6 cell runner
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
const PACK = L.R + '/pack';
const sleep = (p, ms) => p.waitForTimeout(ms);
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();

async function markTexts(p) { return p.evaluate(() => Array.from(document.querySelectorAll('mark[data-highlight]')).filter(e => !e.closest('section[aria-label="Your notes"]')).map(e => e.textContent)); }
async function openNotes(p) { const w = p.locator('section[aria-label="Your notes"]'); if (!(await w.count())) { await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1000); } }
async function notesState(p) { return p.evaluate(() => { const w = document.querySelector('section[aria-label="Your notes"]'); if (!w) return null; return { rows: w.querySelectorAll('[data-row]').length, hlButtons: w.querySelectorAll('button[aria-label="Remove highlight"]').length, colourLabels: Array.from(w.querySelectorAll('button')).filter(b => /^(Yellow|Green|Blue|Pink|Orange|Ink)/.test(b.textContent.trim())).map(b => b.textContent.trim()), goTo: w.querySelectorAll('button[aria-label="Go to the passage"]').length }; }); }
async function contrastOfMarks(p) { await L.injectHelpers(p); return p.evaluate(() => { const P = window.__p12; const m = document.querySelector('mark[data-highlight]'); if (!m) return null; const cs = getComputedStyle(m); const bg = P.parse(cs.backgroundColor); const fg = P.parse(cs.color); const page = P.bgOf(m.parentElement); const bgOver = P.over(bg, page); return { bg: P.rgb(bgOver), fg: P.rgb(fg), ratio: +P.ratio(fg, bgOver).toFixed(2) }; }); }

async function kindRun(p, name, selFn, cell, prof, opts) {
  const rec = { kind: name };
  const sel = await selFn(); rec.sel = sel && (sel.sel === undefined ? sel : sel.sel); rec.selMeta = sel && { idx: sel.idx, reason: sel.reason, blocks: sel.blocks, tag: sel.tag, note: sel.note };
  const names = await S.toolbarNames(p); rec.offered = names; rec.tb = await C.toolbar(p);
  if (!names) { rec.note = 'no selection actions offered'; await p.screenshot({ path: `${PACK}/B6-${name}-${cell}-${prof}.png` }); return rec; }
  await p.screenshot({ path: `${PACK}/B6-${name}-${cell}-${prof}.png` });
  rec.paragraphs = sel && sel.sel && sel.sel.paragraphs;
  const reselect = async () => { await S.clearSel(p); const x = await selFn(); return x; };
  // Highlight
  if (names.includes('Highlight')) {
    const m0 = (await S.marksInfo(p)).marks;
    await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1000);
    const mi = await S.marksInfo(p); rec.highlight = { marksBefore: m0, marksAfter: mi.marks, blocks: mi.blocks, bg: mi.bg, strip: await S.strip(p), ok: mi.marks > m0, contrast: await contrastOfMarks(p) };
    // marks grouped by nearest paragraph
    rec.highlight.perParagraph = await p.evaluate(() => { const g = new Map(); document.querySelectorAll('mark[data-highlight]').forEach(m => { if (m.closest('section[aria-label="Your notes"]')) return; const q = m.closest('p,h1,h2,h3,h4,li,figcaption,blockquote') || m.parentElement; g.set(q, (g.get(q) || 0) + 1); }); return Array.from(g.values()); });
    if (opts.chain && name === 'across') rec.chain = await chain(p, cell, prof);
    else { await S.removeHighlight(p); rec.highlight.afterRemove = (await S.marksInfo(p)).marks; }
  }
  // Take notes
  if (names.includes('Take notes')) {
    const x = await reselect(); const nm = await S.toolbarNames(p);
    if (nm && nm.includes('Take notes')) { await p.getByRole('button', { name: 'Take notes' }).click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1200); const ci = await C.cardsInfo(p); rec.takeNotes = { sticky: ci.cards.some(c => c.kind === 'sticky'), cards: ci.cards.map(c => c.kind) }; await C.closeAll(p); } else rec.takeNotes = { note: 'not re-offered after reselect', names: nm };
  }
  // Explain
  if (names.includes('Explain this')) {
    const x = await reselect(); const nm = await S.toolbarNames(p);
    if (nm && nm.includes('Explain this')) { await p.getByRole('button', { name: 'Explain this' }).click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 2500); const ci = await C.cardsInfo(p); rec.explain = { card: ci.cards.some(c => c.kind === 'explain'), h: ci.cards.find(c => c.kind === 'explain') && ci.cards.find(c => c.kind === 'explain').rect.h }; await C.closeAll(p); } else rec.explain = { note: 'not re-offered after reselect', names: nm };
  }
  await S.clearSel(p);
  return rec;
}

async function chain(p, cell, prof) {
  const out = {};
  const texts0 = await markTexts(p); out.markCount = texts0.length; out.markChars = texts0.reduce((a, t) => a + t.length, 0);
  out.paragraphsWithMarks = (await p.evaluate(() => { const g = new Set(); document.querySelectorAll('mark[data-highlight]').forEach(m => { if (!m.closest('section[aria-label="Your notes"]')) g.add(m.closest('p,li,blockquote,h1,h2,h3,h4') || m.parentElement); }); return g.size; }));
  await openNotes(p); await sleep(p, 600);
  out.notes1 = await notesState(p);
  await p.screenshot({ path: `${PACK}/B6-chain-notes-${cell}-${prof}.png` });
  // colour change from the margin strip
  const before = await contrastOfMarks(p);
  const strip = p.getByRole('radio', { name: 'Green' }).or(p.getByRole('button', { name: 'Green' })).first();
  await strip.click({ timeout: 8000 }).catch(() => {}); await sleep(p, 800);
  const afterGreen = await p.evaluate(() => Array.from(document.querySelectorAll('mark[data-highlight]')).filter(m => !m.closest('section[aria-label="Your notes"]')).map(m => getComputedStyle(m).backgroundColor));
  out.colourFromStrip = { before: before && before.bg, afterAll: Array.from(new Set(afterGreen)), allMarksChanged: afterGreen.every(c => c === afterGreen[0]) && afterGreen[0] !== (before && `rgb(${before.bg.slice(4, -1)})`) };
  // colour from the notes row: open its colour menu
  const rowBtn = p.locator('section[aria-label="Your notes"] button').filter({ hasText: /^(Yellow|Green|Blue|Pink|Orange|Ink)/ }).first();
  if (await rowBtn.count()) { await rowBtn.click({ timeout: 8000 }).catch(() => {}); await sleep(p, 500); const opts = await p.evaluate(() => Array.from(document.querySelectorAll('[role=menu] [role=menuitem], [role=listbox] [role=option], [role=menuitemradio]')).map(e => e.textContent.trim())); out.rowColourMenu = opts; const blue = p.getByRole('menuitem', { name: /Blue/ }).or(p.getByRole('option', { name: /Blue/ })).or(p.getByRole('menuitemradio', { name: /Blue/ })).first(); if (await blue.count()) { await blue.click().catch(() => {}); await sleep(p, 700); } out.colourFromNotes = await p.evaluate(() => Array.from(new Set(Array.from(document.querySelectorAll('mark[data-highlight]')).filter(m => !m.closest('section[aria-label="Your notes"]')).map(m => getComputedStyle(m).backgroundColor)))); }
  // contrast of every preset (light theme or dark per profile theme)
  out.presets = {};
  for (const col of ['Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Ink']) {
    const b = p.getByRole('radio', { name: col }).or(p.getByRole('button', { name: col })).first();
    await b.click({ timeout: 6000 }).catch(() => {}); await sleep(p, 500);
    out.presets[col] = await contrastOfMarks(p);
  }
  // reload: marks persist
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1500);
  const afterReload = await markTexts(p); out.afterReload = { markCount: afterReload.length, sameChars: afterReload.reduce((a, t) => a + t.length, 0) === out.markChars };
  // exports
  await openNotes(p); await sleep(p, 800);
  out.notes2 = await notesState(p);
  const wanted = texts0.map(norm).filter(t => t.length > 3);
  out.exports = {};
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: L.BASE }).catch(() => {});
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; });
  for (const [label, kind] of [['Text (.txt)', 'txt'], ['Markdown (.md)', 'md'], ['Word (.doc)', 'doc'], ['Copy', 'copy'], ['PDF (print)', 'pdf']]) {
    try {
      await p.locator('section[aria-label="Your notes"] button:has-text("Export")').first().click(); await sleep(p, 400);
      const item = p.locator('[role=menuitem], [role=menu] button').filter({ hasText: label.split(' ')[0] }).first();
      if (kind === 'copy') { await item.click(); await sleep(p, 600); const t = await p.evaluate(() => navigator.clipboard.readText().catch(() => null)); out.exports[kind] = t === null ? { note: 'clipboard unreadable' } : { len: t.length, containsAllHighlightedWords: wanted.every(w => norm(t).includes(w)), containsCount: wanted.filter(w => norm(t).includes(w)).length, of: wanted.length }; }
      else if (kind === 'pdf') { await item.click(); await sleep(p, 900); out.exports[kind] = { printCalled: await p.evaluate(() => window.__printed) }; }
      else { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), item.click()]); const path = await dl.path(); const txt = require('fs').readFileSync(path, 'utf8'); out.exports[kind] = { file: dl.suggestedFilename().replace(/[^\w.]+/g, '_').slice(-30), bytes: txt.length, containsAllHighlightedWords: wanted.every(w => norm(txt.replace(/<[^>]+>/g, ' ')).includes(w)), containsCount: wanted.filter(w => norm(txt.replace(/<[^>]+>/g, ' ')).includes(w)).length, of: wanted.length }; }
    } catch (e) { out.exports[kind] = { error: String(e.message).slice(0, 120) }; }
    await p.keyboard.press('Escape').catch(() => {}); await sleep(p, 300);
  }
  // remove
  await S.removeHighlight(p); await sleep(p, 700);
  out.afterRemove = { marks: (await markTexts(p)).length, notes: await notesState(p) };
  return out;
}

async function run(key, wname, prof, opts = {}) {
  const w = L.W[wname];
  const opener = () => (prof === 'key' ? L.openKey(key, w, {}) : L.openPaper(key, w, {}));
  let s = await opener(); let p = s.page; const cell = `${key}-${wname}-default-light`; const prior = { pageerrors: [], console: [] };
  const res = { cell, input: key, width: wname, viewport: w, profile: prof === 'key' ? 'placeholder-key (stub)' : 'no key (Tier 0)', load: require('os').loadavg()[0], kinds: [] };
  const paras = await C.goodParas(p);
  const hash0 = await L.bodyHash(p);
  const plan = wname === 'W4' ? ['inPara'] : prof === 'key' ? ['inPara', 'across', 'heading', 'caption', 'summary', 'answer'] : ['inPara', 'across', 'heading', 'caption', 'summary'];
  for (const k of plan) {
    await S.openTab(p, 'Paper digestion').catch(() => {}); await sleep(p, 600);
    const fn = { inPara: () => S.selInPara(p, paras), across: () => S.selAcross(p, paras), heading: () => S.selHeading(p), caption: () => S.selCaption(p), summary: () => S.selSummary(p), answer: () => S.selAnswer(p, 'How hot does it run?') }[k];
    s.log.phase = k;
    try { res.kinds.push(await kindRun(p, k, fn, cell, prof, { chain: opts.chain && wname === 'W1' })); } catch (e) { res.kinds.push({ kind: k, error: String(e.message).slice(0, 300), reopened: true }); prior.pageerrors.push(...s.log.pageerrors); prior.console.push(...s.log.console); try { await s.browser.close(); } catch (e2) {} s = await opener(); p = s.page; }
    await C.closeAll(p).catch(() => {});
  }
  await S.openTab(p, 'Paper digestion').catch(() => {}); await sleep(p, 800);
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = [...prior.pageerrors, ...s.log.pageerrors]; res.console = [...prior.console, ...s.log.console].filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B6-${cell}-${prof}.json`, JSON.stringify(res, null, 1));
  await s.browser.close();
  return res;
}
module.exports = { run };
if (require.main === module) {
  const [key, wname, prof, chain] = process.argv.slice(2);
  run(key, wname, prof, { chain: chain === 'chain' }).then(r => console.log(r.cell, prof, r.kinds.map(k => k.kind + ':' + (k.offered ? k.offered.join('/') : 'none')).join(' ; '))).catch(e => { console.error('ERR', e); process.exit(1); });
}
