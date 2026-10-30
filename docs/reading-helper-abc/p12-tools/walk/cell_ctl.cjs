// B8 / B9 / B10 cell: the answers control, the Submit control, colours (key profile = placeholder key + deep report, stub answers)
const L = require('./lib2.cjs');
const PACK = L.R + '/pack';
const sleep = (p, ms) => p.waitForTimeout(ms);

async function submitState(p) {
  await L.injectHelpers(p);
  return p.evaluate(() => {
    const P = window.__p12;
    const sec = Array.from(document.querySelectorAll('section')).find(s => /learn about this paper/i.test(s.textContent) && s.querySelector('textarea'));
    if (!sec) return { found: false };
    const btn = Array.from(sec.querySelectorAll('button')).find(b => /^(Submit|Submitted)$/.test(b.textContent.trim()));
    const ta = sec.querySelector('textarea');
    const bar = ta.closest('div');
    if (!btn) return { found: false, hasTextarea: true };
    const cs = getComputedStyle(btn); const bgb = P.bgOf(btn); const fg = P.over(P.parse(cs.color), bgb);
    const barBg = P.bgOf(btn.parentElement);
    const r = btn.getBoundingClientRect(); const tr = ta.getBoundingClientRect(); const lh = parseFloat(getComputedStyle(ta).lineHeight) || 20;
    return { found: true, label: btn.textContent.trim(), disabled: btn.disabled, ariaDisabled: btn.getAttribute('aria-disabled'), bg: P.rgb(bgb), fg: P.rgb(fg), textRatio: +P.ratio(fg, bgb).toFixed(2), boundaryVsBar: +P.ratio(bgb, barBg).toFixed(2), font: cs.fontSize, rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], taRows: Math.round(tr.height / lh * 10) / 10, taH: Math.round(tr.height), valueLen: ta.value.length, cursor: cs.cursor };
  });
}
const apiReqs = (log) => log.requests.filter(r => /\/api\//.test(r.u) && !/figure-image|\/api\/figure|\/api\/read\b|upload\//.test(r.u));

async function b9(p, s, cell, short) {
  const out = { steps: [] };
  const bar = p.getByPlaceholder(/What should this paper answer/i).first();
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const mark = (name, extra = {}) => submitState(p).then(st => { out.steps.push({ name, state: st, apiReqsTotal: apiReqs(s.log).length, ...extra }); return st; });
  await mark('initial-empty');
  await bar.click(); await bar.type('How hot does it run?', { delay: 15 }); await sleep(p, 100); await mark('typed-immediately');
  await sleep(p, 500); await mark('typed-after-500ms');
  await p.screenshot({ path: `${PACK}/B9-typed-${cell}.png`, clip: { x: 340, y: 60, width: 700, height: 110 } });
  const r0 = apiReqs(s.log).length;
  await p.getByRole('button', { name: /^Submit$/ }).first().click(); await sleep(p, 1500); const sub = await mark('after-click-submit', { newApi: apiReqs(s.log).length - r0 });
  await p.screenshot({ path: `${PACK}/B9-submitted-${cell}.png`, clip: { x: 340, y: 60, width: 700, height: 110 } });
  const r1 = apiReqs(s.log).length;
  await p.getByRole('button', { name: /^Submitted$/ }).first().click({ force: true }).catch(() => {}); await sleep(p, 1200); await mark('repeat-click', { newApi: apiReqs(s.log).length - r1 });
  const r2 = apiReqs(s.log).length;
  await bar.click(); await p.keyboard.press('Enter'); await sleep(p, 1200); await mark('repeat-enter', { newApi: apiReqs(s.log).length - r2 });
  await p.keyboard.type('x'); await sleep(p, 80); await mark('edit-immediate'); await sleep(p, 500); await mark('edit-after-500ms');
  await p.screenshot({ path: `${PACK}/B9-edited-${cell}.png`, clip: { x: 340, y: 60, width: 700, height: 110 } });
  await p.keyboard.press('Backspace'); await sleep(p, 80); await mark('revert-immediate'); await sleep(p, 600); await mark('revert-after-600ms');
  if (short) { await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); await sleep(p, 600); await mark('cleared'); return out; }
  // new text then Enter submits (different text)
  await p.keyboard.type(' now'); await sleep(p, 600); await mark('edit2');
  const r3 = apiReqs(s.log).length; await p.keyboard.press('Enter'); await sleep(p, 1500); await mark('enter-submits-new', { newApi: apiReqs(s.log).length - r3 });
  // clear: empty bar's one row
  await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); await sleep(p, 600); await mark('cleared');
  // long text: refit
  await p.keyboard.insertText('A long question that wraps over several lines of the bar so that the field must grow to show the whole of it, because a reader who types a long question must read it whole. '.repeat(2)); await sleep(p, 600); await mark('long-typed');
  await p.screenshot({ path: `${PACK}/B9-long-${cell}.png`, clip: { x: 340, y: 60, width: 700, height: 200 } });
  await p.keyboard.press('Control+a'); await p.keyboard.press('Delete'); await sleep(p, 500); await mark('cleared-again');
  return out;
}

async function b8(p, s, cell) {
  const out = {};
  await L.injectHelpers(p);
  // make sure the answers exist: settle a question, then wait for the control
  const bar = p.getByPlaceholder(/What should this paper answer/i).first();
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const cur = await bar.inputValue(); if (!cur) { await bar.click(); await bar.fill('How hot does it run?'); await sleep(p, 600); const sb = p.getByRole('button', { name: /^Submit(ted)?$/ }).first(); if (((await sb.textContent()) || '').trim() === 'Submit') await sb.click(); }
  let ctl = null;
  for (let i = 0; i < 30 && !ctl; i++) { await sleep(p, 700); ctl = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)); return b ? true : null; }); }
  out.present = !!ctl;
  if (!ctl) return out;
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p);
  const measure = () => p.evaluate(() => {
    const P = window.__p12; const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent));
    const cs = getComputedStyle(b); const bg = P.bgOf(b); const fg = P.over(P.parse(cs.color), bg);
    const h = Array.from(document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3')).find(e => /introduction/i.test(e.textContent) && e.textContent.trim().length < 40) || document.querySelector('#paper-body h3.text-title, #paper-body h3');
    const r = b.getBoundingClientRect();
    const outline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 ? { w: cs.outlineWidth, style: cs.outlineStyle, color: P.rgb(P.parse(cs.outlineColor)), offset: cs.outlineOffset, ratioVsPage: +P.ratio(P.parse(cs.outlineColor), P.bgOf(b.parentElement)).toFixed(2) } : null;
    const bs = cs.boxShadow;
    return { text: b.textContent.trim().slice(0, 12) + '…', tag: b.tagName, expanded: b.getAttribute('aria-expanded'), controls: b.getAttribute('aria-controls'), font: cs.fontSize, fontFamily: cs.fontFamily.slice(0, 30), weight: cs.fontWeight, headingFont: h ? getComputedStyle(h).fontSize : null, headingTag: h ? h.tagName : null, headingFamily: h ? getComputedStyle(h).fontFamily.slice(0, 30) : null, bg: P.rgb(bg), fg: P.rgb(fg), textRatio: +P.ratio(fg, bg).toFixed(2), rect: [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)], outline, boxShadow: bs === 'none' ? null : bs.slice(0, 90), pageBg: P.rgb(P.bgOf(b.parentElement)), boundaryVsPage: +P.ratio(bg, P.bgOf(b.parentElement)).toFixed(2), hasTriangle: /▸|▾|►|▼/.test(b.textContent) || !!b.querySelector('svg') };
  });
  out.rest = await measure();
  await p.screenshot({ path: `${PACK}/B8-closed-${cell}.png`, clip: { x: 340, y: 60, width: 720, height: 200 } });
  const box = await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)); const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; });
  await p.mouse.move(box.x, box.y); await sleep(p, 350); out.hover = await measure();
  await p.screenshot({ path: `${PACK}/B8-hover-${cell}.png`, clip: { x: 340, y: 60, width: 720, height: 200 } });
  await p.mouse.move(5, 5);
  await p.keyboard.press('Shift'); await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)); b.focus(); }); await sleep(p, 350);
  out.focus = await measure(); out.focus.focusVisible = await p.evaluate(() => document.activeElement && document.activeElement.matches(':focus-visible'));
  await p.screenshot({ path: `${PACK}/B8-focus-${cell}.png`, clip: { x: 340, y: 60, width: 720, height: 200 } });
  // open / close
  await p.mouse.click(box.x, box.y); await sleep(p, 900); out.opened = await measure();
  out.panel = await p.evaluate(() => { const pn = document.getElementById('ask-answers-panel'); if (!pn) return null; const r = pn.getBoundingClientRect(); return { h: Math.round(r.height), visible: r.height > 0, text: pn.innerText.length }; });
  await p.screenshot({ path: `${PACK}/B8-open-${cell}.png`, clip: { x: 340, y: 60, width: 720, height: 420 } });
  await p.mouse.click(box.x, box.y); await sleep(p, 700); out.closedAgain = await measure();
  // keyboard: Enter / Space toggle
  await p.evaluate(() => { const b = Array.from(document.querySelectorAll('button, summary')).find(x => /answers generated by ai/i.test(x.textContent)); b.focus(); });
  await p.keyboard.press('Enter'); await sleep(p, 600); out.afterEnter = (await measure()).expanded;
  await p.keyboard.press('Space'); await sleep(p, 600); out.afterSpace = (await measure()).expanded;
  return out;
}

async function run(key, wname, stepIdx, dark, opts = {}) {
  const w = L.W[wname];
  const s = await L.openKey(key, w, { dark: false });
  const p = s.page;
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx); const theme = dark ? 'dark' : 'light';
  const cell = `${key}-${wname}-${stepName}-${theme}`;
  if (stepIdx !== 2) await L.setStep(p, stepIdx);
  if (dark) await L.setDark(p);
  const res = { cell, input: key, width: wname, viewport: w, step: stepIdx, scale: L.STEPS[stepIdx], theme, profile: 'placeholder-key + deep report (stub)', load: require('os').loadavg()[0] };
  const hash0 = await L.bodyHash(p);
  res.B9 = await b9(p, s, cell, opts.short);
  res.B8 = await b8(p, s, cell);
  res.hashBefore = hash0; res.hashAfter = await L.bodyHash(p);
  res.pageerrors = s.log.pageerrors; res.console = s.log.console.filter(c => !/ERR_TUNNEL|\[feed\]|api\/read|status of 500/.test(c.text));
  L.fs.writeFileSync(`${PACK}/B89-${cell}.json`, JSON.stringify(res, null, 1));
  await s.browser.close();
  return res;
}
module.exports = { run };
if (require.main === module) {
  const [key, wname, step, dark, short] = process.argv.slice(2);
  run(key, wname, Number(step), dark === 'dark', { short: short === 'short' }).then(r => console.log(r.cell, 'B8 present', r.B8.present, 'pageerrors', r.pageerrors.length)).catch(e => { console.error('ERR', e); process.exit(1); });
}
