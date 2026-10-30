// B12 entry + Tier 0 completeness: a fresh no-key profile; the paper enters through the file chooser and the consent; then the model-free reader is exercised
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs'); const CY = require('./cell_cycles.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
async function run(key) {
  const s = await L.newSession(); const p = s.page; const cell = `${key}-W1-default-light`;
  const out = { cell, input: key, profile: 'no key (Tier 0), fresh browser profile', load: require('os').loadavg()[0], steps: {} }; const st = out.steps;
  await L.skipSetup(p);
  const t0 = Date.now(); const url = await L.upload(p, key); st.upload = { ms: Date.now() - t0, url: url.replace(L.BASE, '').slice(0, 40) };
  let navsAfterUpload = 0; p.on('framenavigated', f => { if (f === p.mainFrame()) navsAfterUpload++; });
  const bodyTl = []; { const tb = Date.now(); for (let i = 0; i < 90; i++) { const n = await p.evaluate(() => { const b = document.querySelector('#paper-body'); return b ? b.textContent.length : -1; }).catch(() => -2); bodyTl.push([Date.now() - tb, n]); if (n > 2000 && bodyTl.length > 3 && bodyTl[bodyTl.length - 2][1] === n && bodyTl[bodyTl.length - 3][1] === n) break; await sleep(p, 1000); } }
  st.bodyArrival = { samples: bodyTl.filter((x, i) => i < 6 || i === bodyTl.length - 1), secondsToStable: bodyTl[bodyTl.length - 1][0] / 1000, finalLen: bodyTl[bodyTl.length - 1][1] };
  await p.waitForSelector('#paper-body', { timeout: 120000 }); const len = await L.settleBody(p); st.readerReadyMs = Date.now() - t0;
  const paras = await C.goodParas(p); const hash0 = await L.bodyHash(p);
  st.page = await p.evaluate(() => ({ title: !!document.querySelector('h1'), tabs: Array.from(document.querySelectorAll('[role=tab]')).map(t => t.textContent.trim()), mapHeader: (document.querySelector('[data-reader-left-scroll]') || { innerText: '' }).innerText.slice(0, 80).replace(/\s+/g, ' '), paragraphs: document.querySelectorAll('#paper-body p').length, headings: document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4').length, figures: document.querySelectorAll('#paper-body figure').length, figureButtons: document.querySelectorAll('button[aria-label^="Open Fig"]').length, bodyChars: document.querySelector('#paper-body').textContent.length }));
  await p.screenshot({ path: `${PACK}/B12-entry-${cell}.png` });
  const modelReq = () => s.log.requests.filter(r => /\/api\/(papers\/report|explain|plain|gist|paragraph-guide)|paragraph-guide|\/report\b/.test(r.u) && r.m === 'POST').length;
  st.modelRequestsAtEntry = modelReq();
  // Tier 0 reader: selection actions (no Explain without a key), Highlight, Take notes, notes window + export, question bar, a figure
  const sel = await C.selectPara(p, paras[3], { y: 300 }); st.selection = { names: await S.toolbarNames(p) };
  await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 900); st.highlight = { marks: (await S.marksInfo(p)).marks }; await S.removeHighlight(p);
  await C.selectPara(p, paras[4], { y: 300 }); await p.getByRole('button', { name: 'Take notes' }).click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 1200); st.sticky = (await C.cardsInfo(p)).cards.map(c => c.kind); await C.closeAll(p);
  await p.getByRole('button', { name: 'Notes' }).click(); await sleep(p, 1200); st.notesWindow = await p.locator('section[aria-label="Your notes"]').count();
  await p.locator('section[aria-label="Your notes"] button:has-text("Export")').first().click().catch(() => {}); await sleep(p, 500);
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 60000 }).catch(() => null), p.locator('[role=menuitem]').filter({ hasText: 'Text (.txt)' }).first().click().catch(() => {})]); st.exportTxt = !!dl;
  await p.getByRole('button', { name: 'Close your notes' }).click().catch(() => {}); await sleep(p, 500);
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const bar = p.getByPlaceholder(/What should this paper answer/i).first(); await bar.click(); await bar.fill('What is the main finding?'); await sleep(p, 300); await p.getByRole('button', { name: /^Submit$/ }).first().click(); await sleep(p, 2500);
  st.question = await p.evaluate(() => ({ submitLabel: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim()).filter(t => /^Submit(ted)?$/.test(t)), mapMentions: (document.querySelector('[data-reader-left-scroll]') || { innerText: '' }).innerText.match(/mentions/g) ? (document.querySelector('[data-reader-left-scroll]').innerText.match(/mentions/g) || []).length : 0 }));
  st.figure = await C.openFigure(p, 1, { wait: 2500 }); st.figureCards = (await C.cardsInfo(p)).cards.map(c => c.kind); await C.closeAll(p);
  st.modelRequestsAtEnd = modelReq();
  out.requests = { total: s.log.requests.length, api: s.log.requests.filter(r => /\/api\//.test(r.u)).map(r => r.m + ' ' + r.u.replace(/upload%3A[0-9a-f]+/, 'upload:ID').replace(/\?.*$/, '')).reduce((a, x) => (a[x] = (a[x] || 0) + 1, a), {}) };
  out.overlay = await CY.overlay(p);
  st.navsAfterUpload = navsAfterUpload; st.structureRequests = s.log.requests.filter(r => /structure/i.test(r.u)).length;
  out.hashBefore = hash0; out.hashAfter = await L.bodyHash(p);
  out.pageerrors = s.log.pageerrors; out.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B12entry-${cell}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run };
if (require.main === module) run(process.argv[2]).then(o => console.log(o.cell, JSON.stringify(o.steps.page && [o.steps.page.paragraphs, o.steps.page.figures]), 'model req', o.steps.modelRequestsAtEnd, 'pageerrors', o.pageerrors.length)).catch(e => { console.error('ERR', e); process.exit(1); });
