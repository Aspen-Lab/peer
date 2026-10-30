// B12: 30 action cycles at W1 and at W3 (key profile: Explain needs the placeholder key); page errors, console, overlay counted
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
const PACK = L.R + '/pack'; const sleep = (p, ms) => p.waitForTimeout(ms);
async function overlay(p) { return p.evaluate(() => { const portal = document.querySelector('nextjs-portal'); const sh = portal && portal.shadowRoot; const dialog = sh ? !!sh.querySelector('[data-nextjs-dialog], [role=dialog]') : false; const t = document.body.innerText; return { portal: !!portal, dialog, snag: /This view hit a snag/i.test(t), maxDepth: /Maximum update depth/i.test(t) }; }); }
async function run(key, wname, cycles = 30) {
  const w = L.W[wname]; let s = await L.openKey(key, w, {}); let p = s.page; const cell = `${key}-${wname}-default-light`; const priorLogs = { pageerrors: [], console: [] }; let reopened = 0;
  const out = { cell, input: key, width: wname, viewport: w, profile: 'placeholder-key (stub)', cyclesPlanned: cycles, load0: require('os').loadavg()[0], cycles: [] };
  const paras = await C.goodParas(p); const hash0 = await L.bodyHash(p);
  const err0 = () => s.log.pageerrors.length; const con0 = () => s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500|http404.*figure-image|status of 404/.test(c.text)).length;
  for (let i = 0; i < cycles; i++) {
    const healthy = await p.evaluate(() => 1).then(() => true, () => false);
    if (!healthy) { priorLogs.pageerrors.push(...s.log.pageerrors); priorLogs.console.push(...s.log.console); try { await s.browser.close(); } catch (e) {} s = await L.openKey(key, w, {}); p = s.page; reopened++; }
    const rec = { i: i + 1, steps: {}, reopenedBefore: !healthy }; const t0 = Date.now(); const e0 = err0(), c0 = con0();
    const step = async (name, fn) => { s.log.phase = 'cycle' + (i + 1) + ':' + name; try { rec.steps[name] = await fn(); } catch (e) { rec.steps[name] = { error: String(e.message).slice(0, 120) }; } };
    const pick = (k) => paras[(i * 3 + k) % paras.length];
    await step('select', async () => { const sel = await C.selectPara(p, pick(0), { y: 300 }); return !!sel; });
    await step('highlight', async () => { const names = await S.toolbarNames(p); if (!names || !names.includes('Highlight')) return { offered: names }; await p.getByRole('button', { name: 'Highlight' }).first().click({ timeout: 60000, noWaitAfter: true }); await sleep(p, 600); return { marks: (await S.marksInfo(p)).marks }; });
    await step('explain', async () => { await C.openExplain(p, pick(1), { y: 300, wait: 1200 }); return (await C.cardsInfo(p)).cards.map(c => c.kind); });
    await step('sticky', async () => { await C.openSticky(p, pick(2), { y: 300, wait: 700 }); return (await C.cardsInfo(p)).cards.map(c => c.kind); });
    await step('figure', async () => { const how = await C.openFigure(p, 1, { wait: 1000 }); return { how, cards: (await C.cardsInfo(p)).cards.map(c => c.kind) }; });
    await step('dragDivider', async () => { const ci = await C.cardsInfo(p); if (ci.divs.length) { const d = ci.divs[0]; const cx = ci.cards[0].rect.left + ci.cards[0].rect.w / 2, cy = d.rect.top + d.rect.h / 2; const before = ci.cards.map(c => Math.round(c.rect.h)); await p.mouse.move(cx, cy); await p.mouse.down(); await p.mouse.move(cx, cy + 20, { steps: 4 }); await p.mouse.move(cx, cy + 45, { steps: 4 }); await p.mouse.up(); await sleep(p, 300); const after = (await C.cardsInfo(p)).cards.map(c => Math.round(c.rect.h)); return { kind: 'card-divider', before, after, changed: before.join() !== after.join() }; } const sepRect = await p.evaluate(() => { const e = document.querySelector('[data-reader-divider=margin]'); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, w: r.width }; }); if (!sepRect) return { kind: 'none' }; const g0 = await p.evaluate(() => document.querySelector('[data-reader-margin]').getBoundingClientRect().width); await p.mouse.move(sepRect.x + 6, 300); await p.mouse.down(); await p.mouse.move(sepRect.x + 6 - 20, 300, { steps: 4 }); await p.mouse.move(sepRect.x + 6 - 40, 300, { steps: 4 }); await p.mouse.up(); await sleep(p, 300); const g1 = await p.evaluate(() => document.querySelector('[data-reader-margin]').getBoundingClientRect().width); return { kind: 'pane-divider', before: g0, after: g1 }; });
    await step('closeAll', async () => { await C.closeAll(p); return (await C.cardsInfo(p)).cards.length; });
    if (i % 2 === 1) await step('removeHighlight', async () => { await S.removeHighlight(p); return (await S.marksInfo(p)).marks; });
    rec.ms = Date.now() - t0; rec.pageErrorsNew = err0() - e0; rec.consoleNew = con0() - c0; rec.overlay = await overlay(p); rec.load = require('os').loadavg()[0];
    out.cycles.push(rec);
    if (i % 5 === 4) L.fs.writeFileSync(`${PACK}/B12cycles-${cell}.json`, JSON.stringify({ ...out, partial: true }, null, 1));
  }
  await p.screenshot({ path: `${PACK}/B12-cycles-end-${cell}.png` });
  out.hashBefore = hash0; out.hashAfter = await L.bodyHash(p);
  out.browserReopened = reopened; out.pageerrors = [...priorLogs.pageerrors, ...s.log.pageerrors]; out.consoleErrors = [...priorLogs.console, ...s.log.console].filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  out.maxUpdateDepthInConsole = [...priorLogs.console, ...s.log.console].filter(c => /Maximum update depth/i.test(c.text)).length;
  out.finalOverlay = await overlay(p);
  L.fs.writeFileSync(`${PACK}/B12cycles-${cell}.json`, JSON.stringify(out, null, 1));
  await s.browser.close(); return out;
}
module.exports = { run, overlay };
if (require.main === module) { const [key, wname, n] = process.argv.slice(2); run(key, wname, Number(n || 30)).then(o => console.log(o.cell, 'cycles', o.cycles.length, 'pageerrors', o.pageerrors.length, 'maxDepth', o.maxUpdateDepthInConsole)).catch(e => { console.error('ERR', e); process.exit(1); }); }
