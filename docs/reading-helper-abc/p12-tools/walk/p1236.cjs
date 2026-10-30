// P12-36's case on the page: the same note in the sticky card and in the notes window, edits in alternation, Save, reload
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
async function run(key, wname) {
  const s = await L.openPaper(key, L.W[wname], {}); const p = s.page;
  const res = { cell: `${key}-${wname}-default-light`, input: key, width: wname, viewport: L.W[wname], load: require('os').loadavg()[0], steps: [] };
  const paras = await C.goodParas(p);
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(L.W[wname][1] * 0.4)) });
  const card = '[data-margin-card=sticky]';
  const edCard = () => p.locator(card + ' [contenteditable=true]').first();
  await p.locator(card + ' [data-row]').first().click({ position: { x: 40, y: 8 } }).catch(() => {}); await sleep(p, 500);
  await edCard().click({ timeout: 8000 }); await p.keyboard.type('base words', { delay: 8 }); await sleep(p, 700);
  // open the notes window
  await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200);
  const win = 'section[aria-label="Your notes"]';
  const rowOf = async () => { const rows = p.locator(win + ' [data-row]'); const n = await rows.count(); for (let i = 0; i < n; i++) { const t = await rows.nth(i).innerText(); if (/base words/.test(t)) return rows.nth(i); } return null; };
  const snap = async (label) => { const w = await rowOf(); const wt = w ? (await w.innerText()).replace(/\s+/g, ' ').trim() : null; const sc = (await p.locator(card).count()) ? (await p.locator(card + ' [data-row]').allInnerTexts()).join(' / ').replace(/\s+/g, ' ') : null; const stored = await p.evaluate(() => { try { const v = JSON.parse(localStorage.getItem('peer-notes')); const notes = (v.state && v.state.notes) || v.notes || {}; const all = Array.isArray(notes) ? notes : Object.values(notes); let out = []; for (const n of all) for (const b of (n.blocks || [])) out.push(b.text); return out.join(' / '); } catch (e) { return null; } }); res.steps.push({ label, window: wt, sticky: sc, storedLen: stored && stored.length, storedHasBase: stored && /base words/.test(stored) }); };
  const typeSticky = async (w) => { if (!(await p.locator(card).count())) return false; const r = p.locator(card + ' [data-row]').first(); const bb = await r.boundingBox(); await p.mouse.click(bb.x + bb.width * 0.6, bb.y + bb.height / 2); await sleep(p, 500); await p.keyboard.press('Control+End'); await p.keyboard.type(w, { delay: 6 }); await sleep(p, 1300); return true; };
  const typeWindow = async (w) => { const r = await rowOf(); if (!r) return false; await r.evaluate(el => el.scrollIntoView({ block: 'center' })).catch(() => {}); await sleep(p, 300); const bb = await r.boundingBox(); await p.mouse.click(bb.x + 60, bb.y + bb.height / 2); await sleep(p, 500); await p.keyboard.press('Control+End'); await p.keyboard.type(w, { delay: 6 }); await sleep(p, 1300); return true; };
  await snap('start');
  res.ok = [];
  res.ok.push(await typeSticky(' s1')); await snap('sticky s1');
  res.ok.push(await typeWindow(' w1')); await snap('window w1');
  res.ok.push(await typeSticky(' s2')); await snap('sticky s2');
  res.ok.push(await typeWindow(' w2')); await snap('window w2');
  await sleep(p, 800); await snap('settled');
  if (await p.locator(card).count()) { await p.locator(card).getByRole('button', { name: /^Save note/ }).click(); await sleep(p, 900); }
  await snap('after Save');
  res.ok.push(await typeWindow(' w3')); await snap('window w3 (card closed)');
  await sleep(p, 900);
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForSelector('#paper-body'); await L.settleBody(p); await sleep(p, 1500);
  await p.getByRole('button', { name: 'Notes' }).click().catch(() => {}); await sleep(p, 1200);
  const fw = await rowOf(); const finalW = fw ? (await fw.innerText()).replace(/\s+/g, ' ').trim() : null;
  res.final = { window: finalW };
  const want = ['base', 'words', 's1', 'w1', 's2', 'w2', 'w3'];
  res.verdict = { missing: want.filter(w => !new RegExp('\\b' + w + '\\b').test(finalW || '')), duplicated: want.filter(w => ((finalW || '').match(new RegExp('\\b' + w + '\\b', 'g')) || []).length > 1), allTyped: res.ok.every(Boolean) };
  res.pageerrors = s.log.pageerrors; res.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  await p.screenshot({ path: `${PACK}/P1236-${res.cell}.png` });
  L.fs.writeFileSync(`${PACK}/P1236-${res.cell}.json`, JSON.stringify(res, null, 1));
  await s.browser.close(); return res;
}
module.exports = { run };
if (require.main === module) run(process.argv[2], process.argv[3]).then(r => console.log(r.cell, JSON.stringify(r.verdict), JSON.stringify(r.final))).catch(e => { console.error('ERR', e); process.exit(1); });
