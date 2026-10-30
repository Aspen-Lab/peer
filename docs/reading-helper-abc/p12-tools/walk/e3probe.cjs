// E3 (C P12-83): acronym case on every surface that shows the paper's words: figure cards, inline captions, Summary, map rows, body headings, body.
// The pack keeps counts and single damaged tokens only; the text stays in private/.
const L = require('./lib2.cjs'); const S = require('./cell_sel.cjs'); const cp = require('child_process');
const PACK = L.R + '/pack';
function pdfForms(key) {
  const raw = cp.execSync(`pdftotext -q "${L.INPUTS[key]}" - 2>/dev/null`, { maxBuffer: 1 << 27 }).toString();
  const forms = new Map(); // lower -> Map(form -> count)
  for (const m of raw.matchAll(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-?/g)) {
    const f = m[0]; const k = f.toLowerCase(); if (!forms.has(k)) forms.set(k, new Map()); forms.get(k).set(f, (forms.get(k).get(f) || 0) + 1);
  }
  return { raw, forms };
}
function flagTokens(text, forms) {
  const out = new Map();
  for (const m of text.matchAll(/[A-Za-z][A-Za-z0-9]*(?:-[A-Za-z0-9]+)*-?/g)) {
    const f = m[0]; const k = f.toLowerCase(); const pf = forms.get(k); if (!pf) continue; // not in the PDF text at all (extraction differences): not a case question
    if (pf.has(f)) continue;
    // the app's form differs in case from every form the PDF prints
    out.set(f, (out.get(f) || 0) + 1);
  }
  return out;
}
const TARGETS = ['SE', 'LCO', 'DFT', 'LYC', 'Li-'];
function countTargets(text) {
  const o = {};
  for (const t of TARGETS) {
    if (t === 'Li-') { o['Li-'] = (text.match(/Li-/g) || []).length; o['li-(lower)'] = (text.match(/(?<![A-Za-z])li-/g) || []).length; continue; }
    const re = new RegExp('(?<![A-Za-z])' + t + '(?![A-Za-z])', 'g'); const low = new RegExp('(?<![A-Za-z])(?!' + t + ')' + t.split('').map(c => '[' + c.toLowerCase() + c + ']').join('') + '(?![A-Za-z])', 'g');
    o[t] = (text.match(re) || []).length; o[t + '(other case)'] = (text.match(low) || []).length;
  }
  return o;
}
async function run(key) {
  const s = await L.openPaper(key, L.W.W1, { settle: 6000 }); const p = s.page;
  const { raw, forms } = pdfForms(key);
  const res = { cell: `E3-${key}-W1-default-light`, input: key, load: require('os').loadavg()[0], surfaces: {} };
  const surf = {};
  surf.body = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body p, #paper-body li')).filter(e => !e.closest('figure')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('\n'));
  surf.headings = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4,#paper-body h5')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('\n'));
  surf.mapRows = await p.evaluate(() => { const left = document.querySelector('[data-reader-left]'); return left ? Array.from(left.querySelectorAll('li[data-level] a')).map(a => a.textContent.replace(/\s+/g, ' ').trim()).join('\n') : ''; });
  surf.inlineCaptions = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure figcaption')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('\n'));
  // the figure cards: open each, read the card's caption
  const labels = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure button[aria-label^="Open Fig"]')).map(b => b.getAttribute('aria-label')));
  const cardCaps = [];
  for (const label of labels) {
    const b = p.getByRole('button', { name: label, exact: true }).first();
    await b.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {}); await p.waitForTimeout(900);
    await b.click({ timeout: 8000 }).catch(() => {}); await p.waitForTimeout(1800);
    const t = await p.evaluate(() => { const c = document.querySelector('[data-margin-card=figure] [data-figure-caption]'); const h = document.querySelector('[data-margin-card=figure] [data-figure-header]'); return { cap: c ? c.textContent.replace(/\s+/g, ' ').trim() : null, head: h ? h.textContent.replace(/\s+/g, ' ').trim() : null }; });
    cardCaps.push(t);
    await p.keyboard.press('Escape'); await p.waitForTimeout(500);
  }
  surf.cardCaptions = cardCaps.map(c => (c.head || '') + ' || ' + (c.cap || '')).join('\n');
  // the Summary tab
  try { await S.openTab(p, 'Summary'); await p.waitForTimeout(2500); surf.summary = await p.evaluate(() => { const t = document.querySelector('[role=tabpanel]'); return t ? t.textContent.replace(/\s+/g, ' ').trim() : ''; }); } catch (e) { surf.summary = ''; res.summaryError = String(e.message).slice(0, 100); }
  L.fs.mkdirSync(L.R + '/private', { recursive: true });
  for (const [name, text] of Object.entries(surf)) {
    L.fs.writeFileSync(`${L.R}/private/e3-${key}-${name}.txt`, text);
    const fl = flagTokens(text, forms);
    const flagged = Array.from(fl.entries()).sort((a, b) => b[1] - a[1]);
    // the acronym-shaped / lower-first damaged tokens only (single tokens; never a run of words)
    const shaped = flagged.filter(([f]) => /^[a-z]+[A-Z]/.test(f) || /^[A-Z]{2,}[a-z]$/.test(f) || /^[a-z]{1,3}-/.test(f) || /^[A-Z]+[a-z]?[A-Z]/.test(f));
    res.surfaces[name] = { chars: text.length, flaggedDistinct: flagged.length, flaggedTotal: flagged.reduce((a, [, n]) => a + n, 0), shapedFlags: shaped.slice(0, 30).map(([f, n]) => f + 'x' + n), targets: countTargets(text) };
  }
  res.pdfTargets = countTargets(raw);
  // first-letter case of every figure caption's first word (card caption) against the PDF
  res.cardCaptionFirstLower = cardCaps.map((c, i) => ({ i, firstCharLower: !!(c.cap && /^[a-z]/.test(c.cap)) }));
  // the words the PDF prints in one case only that the app prints in the other: totals over body+headings+captions+map
  res.pageerrors = s.log.pageerrors;
  L.fs.writeFileSync(`${PACK}/${res.cell}.json`, JSON.stringify(res, null, 1));
  await s.browser.close();
  return res;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(r => { console.log(r.cell); for (const [n, v] of Object.entries(r.surfaces)) console.log(' ', n, 'chars', v.chars, 'flaggedDistinct', v.flaggedDistinct, 'total', v.flaggedTotal, 'shaped', JSON.stringify(v.shapedFlags), JSON.stringify(v.targets)); console.log('  pdf', JSON.stringify(r.pdfTargets)); console.log('  firstLower', JSON.stringify(r.cardCaptionFirstLower.filter(x => x.firstCharLower))); }).catch(e => { console.error('ERR', e); process.exit(1); });
