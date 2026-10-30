// the notes tab as a control (§1h.478 item 2: its 18 px hit area is measured "like any other control"): accessible name, label contrast, border contrast, hover, keyboard focus ring, Enter, hit size
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
const key = process.argv[2], wn = process.argv[3], theme = process.argv[4] || 'light';
(async () => {
  const s = await L.openPaper(key, L.W[wn], {}); const p = s.page; const paras = await C.goodParas(p);
  if (theme === 'dark') await L.setDark(p);
  await L.injectHelpers(p);
  await C.openSticky(p, paras[4], { y: Math.min(300, Math.round(L.W[wn][1] * 0.4)) }); await p.waitForTimeout(900); await L.still(p);
  const res = { cell: `TABCTL-${key}-${wn}-${theme}`, theme };
  const measure = (tag) => p.evaluate((tag) => {
    const P = window.__p12; const tab = Array.from(document.querySelectorAll('button')).find(b => /open your notes/i.test((b.getAttribute('aria-label') || '') + ' ' + b.textContent) && getComputedStyle(b).position === 'fixed');
    if (!tab) return { tag, found: false };
    const cs = getComputedStyle(tab); const r = tab.getBoundingClientRect(); const bg = P.bgOf(tab); const lab = P.textContrast(tab);
    const bcol = P.parse(cs.borderLeftColor); const outside = P.bgOf(document.elementFromPoint(r.left - 8, r.top + r.height / 2) || document.body);
    const focus = document.activeElement === tab; const fv = tab.matches(':focus-visible');
    return { tag, found: true, accessibleName: tab.getAttribute('aria-label') || null, text: tab.textContent.trim(), rect: [r.x, r.y, r.width, r.height].map(v => +v.toFixed(1)), label: lab, fillRgb: P.rgb(bg), borderRgb: P.rgb(P.over(bcol, bg)), borderVsOutside: +P.ratio(P.over(bcol, bg), outside).toFixed(2), fillVsOutside: +P.ratio(bg, outside).toFixed(2), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, outlineOffset: cs.outlineOffset, boxShadow: cs.boxShadow.slice(0, 80), focus, focusVisible: fv, tabIndex: tab.tabIndex, cursor: cs.cursor, writingMode: cs.writingMode };
  }, tag);
  res.rest = await measure('rest');
  const t = res.rest.rect; await p.mouse.move(t[0] + t[2] / 2, t[1] + t[3] / 2); await p.waitForTimeout(500); res.hover = await measure('hover'); await p.mouse.move(40, 40); await p.waitForTimeout(300);
  // keyboard: Tab from the page until the tab button is focused (at most 80 presses), then Enter
  await p.evaluate(() => { document.activeElement && document.activeElement.blur(); window.scrollTo(window.scrollX, window.scrollY); });
  let presses = 0; let got = false;
  for (let i = 0; i < 90; i++) { await p.keyboard.press('Tab'); presses++; const isTab = await p.evaluate(() => { const a = document.activeElement; return !!a && /open your notes/i.test((a.getAttribute('aria-label') || '') + ' ' + a.textContent) && getComputedStyle(a).position === 'fixed'; }); if (isTab) { got = true; break; } }
  res.keyboard = { reached: got, tabPresses: presses }; if (got) { res.focused = await measure('focused'); await p.screenshot({ path: `${L.R}/pack/${res.cell}-focused.png`, clip: { x: Math.max(0, t[0] - 120), y: Math.max(0, t[1] - 20), width: 260, height: Math.min(L.W[wn][1] - Math.max(0, t[1] - 20), t[3] + 40) } }); await p.keyboard.press('Enter'); await p.waitForTimeout(900); res.enterOpensNotes = await p.evaluate(() => !!document.querySelector('section[aria-label="Your notes"]')); }
  res.pageerrors = s.log.pageerrors; L.fs.writeFileSync(`${L.R}/pack/${res.cell}.json`, JSON.stringify(res, null, 1));
  console.log(res.cell, JSON.stringify({ name: res.rest.accessibleName, text: res.rest.text, rect: res.rest.rect, label: res.rest.label, borderVsOutside: res.rest.borderVsOutside, hover: res.hover.label, kb: res.keyboard, focusVisible: res.focused && res.focused.focusVisible, outline: res.focused && res.focused.outline, enter: res.enterOpensNotes }));
  await s.browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
