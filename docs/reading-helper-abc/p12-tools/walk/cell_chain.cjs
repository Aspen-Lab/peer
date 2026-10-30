// B6 chain + P11 B6/B7/B8 lines: cross-paragraph highlight -> one note row; colour from the margin strip and from the notes row; presets contrast light/dark; reload; exports; remove
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs'); const crypto = require('crypto');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
const norm = (t) => String(t).replace(/\s+/g, ' ').trim();
const sha = (t) => crypto.createHash('sha256').update(String(t)).digest('hex').slice(0, 12);
const marks = (p) => p.evaluate(() => Array.from(document.querySelectorAll('mark[data-highlight]')).filter(e => !e.closest('section[aria-label="Your notes"]')).map(e => ({ t: e.textContent, bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color })));
const notes = (p) => p.evaluate(() => { const w = document.querySelector('section[aria-label="Your notes"]'); if (!w) return null; return { rows: w.querySelectorAll('[data-row]').length, removeButtons: w.querySelectorAll('button[aria-label="Remove highlight"]').length, goTo: w.querySelectorAll('button[aria-label="Go to the passage"]').length }; });
async function openNotes(p) { if (!(await p.locator('section[aria-label="Your notes"]').count())) { await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200); } }
async function contrast(p, dark) { await L.injectHelpers(p); return p.evaluate(() => { const P = window.__p12; const m = Array.from(document.querySelectorAll('mark[data-highlight]')).find(e => !e.closest('section[aria-label="Your notes"]')); if (!m) return null; const cs = getComputedStyle(m); const page = P.bgOf(m.parentElement); const bg = P.over(P.parse(cs.backgroundColor), page); const fg = P.over(P.parse(cs.color), bg); return { bg: P.rgb(bg), fg: P.rgb(fg), ratio: +P.ratio(fg, bg).toFixed(2) }; }); }
async function pickColour(p, name) { // through the notes row's colour control
  const rowBtn = p.locator('section[aria-label="Your notes"] button').filter({ hasText: /^(Yellow|Green|Blue|Pink|Orange|Ink)/ }).first();
  const grp = p.locator('section[aria-label="Your notes"] [role=radiogroup]');
  if (!(await grp.count())) { await rowBtn.click({ timeout: 10000 }); await sleep(p, 500); }
  await p.locator('section[aria-label="Your notes"] [role=radiogroup] [role=radio]').filter({ has: p.locator(':scope') }).first().waitFor({ timeout: 5000 }).catch(() => {});
  const radio = p.locator('section[aria-label="Your notes"] [role=radiogroup]').getByRole('radio', { name, exact: true }).first();
  await radio.click({ timeout: 8000 }); await sleep(p, 600);
}
async function run(key, wname) {
  const w = L.W[wname]; const s = await L.openPaper(key, w, {}); const p = s.page; const cell = `${key}-${wname}-default-light`;
  const out = { cell, input: key, width: wname, viewport: w, profile: 'no key (Tier 0)', load: require('os').loadavg()[0], steps: {} };
  const paras = await C.goodParas(p); const hash0 = await L.bodyHash(p);
  const st = out.steps;
  const r = await S.selAcross(p, paras); st.selection = r.sel; st.selMeta = { idx: r.idx, reason: r.reason };
  st.offered = await S.toolbarNames(p);
  await p.screenshot({ path: `${PACK}/B6-chain-selection-${cell}.png` });
  await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1200);
  const m0 = await marks(p); st.created = { markCount: m0.length, perParagraph: await p.evaluate(() => { const g = new Map(); document.querySelectorAll('mark[data-highlight]').forEach(m => { if (m.closest('section[aria-label="Your notes"]')) return; const q = m.closest('p,h1,h2,h3,h4,li,figcaption,blockquote') || m.parentElement; g.set(q, (g.get(q) || 0) + 1); }); return Array.from(g.values()); }), bg: m0[0] && m0[0].bg, fg: m0[0] && m0[0].fg, textSha: sha(m0.map(x => x.t).join('|')), chars: m0.reduce((a, x) => a + x.t.length, 0), stripButtons: (await S.strip(p)) && (await S.strip(p)).buttons };
  await p.screenshot({ path: `${PACK}/B6-chain-created-${cell}.png` });
  // colour from the margin strip
  await p.getByRole('radio', { name: 'Green', exact: true }).first().click({ timeout: 8000 }).catch(() => {}); await sleep(p, 700);
  const m1 = await marks(p); st.stripGreen = { allSame: new Set(m1.map(x => x.bg)).size === 1, bg: m1[0] && m1[0].bg, changed: !!m1[0] && m1[0].bg !== m0[0].bg };
  // notes window
  await openNotes(p); st.notes = await notes(p);
  await p.screenshot({ path: `${PACK}/B6-chain-notes-${cell}.png` });
  // colour from the notes row, and the six presets (light)
  st.presetsLight = {};
  for (const col of ['Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Ink']) { try { await pickColour(p, col); st.presetsLight[col] = await contrast(p); } catch (e) { st.presetsLight[col] = { error: String(e.message).slice(0, 80) }; } }
  await pickColour(p, 'Blue').catch(() => {}); const m2 = await marks(p); st.rowBlue = { allSame: new Set(m2.map(x => x.bg)).size === 1, bg: m2[0] && m2[0].bg };
  // dark theme presets
  await L.setDark(p); await sleep(p, 800);
  st.presetsDark = {};
  for (const col of ['Yellow', 'Green', 'Blue', 'Pink', 'Orange', 'Ink']) { try { await pickColour(p, col); st.presetsDark[col] = await contrast(p, true); } catch (e) { st.presetsDark[col] = { error: String(e.message).slice(0, 80) }; } }
  await p.screenshot({ path: `${PACK}/B6-chain-dark-${cell}.png` });
  // back to light and a colour to keep
  await p.getByRole('button', { name: /Follow the system/ }).click().catch(() => {}); await sleep(p, 1500);
  await pickColour(p, 'Pink').catch(() => {}); const mPink = await marks(p);
  // reload
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1500);
  const m3 = await marks(p); st.reload = { markCount: m3.length, textSha: sha(m3.map(x => x.t).join('|')), sameText: sha(m3.map(x => x.t).join('|')) === st.created.textSha, bg: m3[0] && m3[0].bg, colourKept: !!m3[0] && !!mPink[0] && m3[0].bg === mPink[0].bg };
  // exports
  await openNotes(p); await sleep(p, 800); st.notesAfterReload = await notes(p);
  const wanted = m3.map(x => norm(x.t)).filter(t => t.length > 3);
  st.exports = {};
  await p.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin: L.BASE }).catch(() => {});
  await p.evaluate(() => { window.__printed = 0; window.print = () => { window.__printed++; }; window.__frames = []; const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc'); Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', { configurable: true, set(v) { window.__frames.push(String(v)); d.set.call(this, v); }, get() { return d.get.call(this); } }); });
  for (const [label, kind] of [['Text (.txt)', 'txt'], ['Markdown (.md)', 'md'], ['Word (.doc)', 'doc'], ['Copy', 'copy'], ['PDF (print)', 'pdf']]) {
    try {
      await p.locator('section[aria-label="Your notes"] button:has-text("Export")').first().click({ timeout: 20000 }); await sleep(p, 500);
      const item = p.locator('[role=menuitem]').filter({ hasText: label.split(' (')[0] === 'Copy' ? /^Copy/ : label }).first();
      if (kind === 'copy') { await item.click(); await sleep(p, 800); const t = await p.evaluate(() => navigator.clipboard.readText().catch(() => null)); st.exports[kind] = t === null ? { note: 'clipboard unreadable' } : { len: t.length, containsCount: wanted.filter(x => norm(t).includes(x)).length, of: wanted.length }; }
      else if (kind === 'pdf') { await item.click(); await sleep(p, 1500); const ft0 = await p.evaluate(() => (window.__frames || []).join(' ')); const ft = ft0.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'); st.exports[kind] = { printCalled: await p.evaluate(() => window.__printed), printFrames: await p.evaluate(() => (window.__frames || []).length), printFrameChars: ft.length, containsCount: wanted.filter(x => norm(ft).includes(x)).length, of: wanted.length }; await p.evaluate(() => document.querySelectorAll('iframe[aria-hidden=true]').forEach(f => f.remove())); }
      else { const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }), item.click()]); const txt = require('fs').readFileSync(await dl.path(), 'utf8'); const plain = norm(txt.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')); st.exports[kind] = { ext: dl.suggestedFilename().split('.').pop(), bytes: txt.length, containsCount: wanted.filter(x => plain.includes(x)).length, of: wanted.length }; }
    } catch (e) { st.exports[kind] = { error: String(e.message).slice(0, 140) }; }
    await sleep(p, 500);
  }
  // remove
  await p.locator('section[aria-label="Your notes"] button[aria-label="Remove highlight"]').first().click({ timeout: 15000 }).catch(() => {}); await sleep(p, 900);
  const m4 = await marks(p); st.removed = { marks: m4.length, notes: await notes(p) };
  out.hashBefore = hash0; out.hashAfter = await L.bodyHash(p);
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B6chain-${cell}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) { const [key, wname] = process.argv.slice(2); run(key, wname).then(o => console.log(o.cell, JSON.stringify(o.steps.created && o.steps.created.perParagraph), JSON.stringify(o.steps.exports && Object.fromEntries(Object.entries(o.steps.exports).map(([k, v]) => [k, v.containsCount !== undefined ? v.containsCount + '/' + v.of : (v.printCalled !== undefined ? 'print' + v.printCalled : v.error || v.note)])))) ).catch(e => { console.error('ERR', e); process.exit(1); }); }
