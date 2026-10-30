// shared measurement helpers (private scratch; never committed)
const crypto = require('crypto');
const L = require('./lib.cjs');
const fs = L.fs;
const STEPS = [0.85, 0.925, 1, 1.1, 1.2, 1.32, 1.45, 1.6];
const STEPNAME = ['0.85', '0.925', 'default', '1.1', '1.2', '1.32', '1.45', 'largest'];
// smallest = 0.85, default = 1 (index 2), largest = 1.6 (index 7)
const STEPLABEL = { smallest: 0, default: 2, largest: 7 };
const STEPFILE = { 0: 'smallest', 2: 'default', 7: 'largest' };

async function getStep(page) {
  return page.evaluate(() => { try { return JSON.parse(localStorage.getItem('peer-reading-prefs')).state.scaleIndex; } catch { return null; } });
}
async function setStep(page, idx) {
  for (let i = 0; i < 12; i++) {
    const cur = await getStep(page);
    const eff = cur === null ? 2 : cur;
    if (eff === idx) break;
    const name = eff < idx ? 'Larger text' : 'Smaller text';
    await page.getByRole('button', { name }).click();
    await page.waitForTimeout(450);
  }
  await page.waitForTimeout(500);
  return getStep(page);
}
async function setDark(page) {
  await page.getByRole('button', { name: 'Night reading mode' }).click();
  await page.waitForTimeout(1600);
  return page.evaluate(() => ({ cls: document.documentElement.className.slice(0, 80), theme: document.documentElement.getAttribute('data-theme'), bg: getComputedStyle(document.body).backgroundColor }));
}
async function bodyHash(page) {
  // the paper's own words: paragraphs, headings and list items of the body, outside figure blocks (figure blocks carry the app's own page hint)
  const t = await page.evaluate(() => { const b = document.querySelector('#paper-body'); if (!b) return null; return Array.from(b.querySelectorAll('p, h1, h2, h3, h4, h5, li')).filter(e => !e.closest('figure')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('\n'); });
  if (t === null) return { len: -1, sha: null };
  return { len: t.length, sha: crypto.createHash('sha256').update(t).digest('hex').slice(0, 16) };
}
// in-page helpers injected as a string
const PAGE_HELPERS = `
window.__p12 = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1; const cx = cv.getContext('2d', { willReadFrequently: true });
  function parse(c) { cx.clearRect(0,0,1,1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0,0,1,1); const d = cx.getImageData(0,0,1,1).data; return [d[0], d[1], d[2], d[3] / 255]; }
  function over(top, bot) { const a = top[3]; return [top[0]*a + bot[0]*(1-a), top[1]*a + bot[1]*(1-a), top[2]*a + bot[2]*(1-a), 1]; }
  function bgOf(el) {
    const chain = []; let e = el;
    while (e && e.nodeType === 1) { const c = parse(getComputedStyle(e).backgroundColor); chain.push(c); if (c[3] >= 0.999) break; e = e.parentElement; }
    let base = [255,255,255,1]; if (chain.length && chain[chain.length-1][3] < 0.999) base = parse(getComputedStyle(document.documentElement).backgroundColor); if (base[3] < 0.999) base = over(base, [255,255,255,1]);
    for (let i = chain.length - 1; i >= 0; i--) base = over(chain[i], base);
    return base;
  }
  function lum(c) { const f = v => { v /= 255; return v <= 0.03928 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); }; return 0.2126*f(c[0]) + 0.7152*f(c[1]) + 0.0722*f(c[2]); }
  function ratio(a, b) { const la = lum(a), lb = lum(b); const hi = Math.max(la, lb), lo = Math.min(la, lb); return (hi + 0.05) / (lo + 0.05); }
  function textContrast(el) { const bg = bgOf(el); const fg = over(parse(getComputedStyle(el).color), bg); return { fg: fg.slice(0,3).map(Math.round), bg: bg.slice(0,3).map(Math.round), ratio: +ratio(fg, bg).toFixed(2) }; }
  const rgb = c => 'rgb(' + c.slice(0,3).map(Math.round).join(',') + ')';
  return { parse, over, bgOf, ratio, textContrast, rgb, lum };
})();`;
async function injectHelpers(page) { await page.evaluate(PAGE_HELPERS); }

module.exports = Object.assign({}, L, { STEPS, STEPNAME, STEPLABEL, STEPFILE, getStep, setStep, setDark, bodyHash, injectHelpers, PAGE_HELPERS, crypto });
