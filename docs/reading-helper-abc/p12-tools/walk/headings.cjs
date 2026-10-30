const L = require('./lib2.cjs');
(async () => {
  for (const k of ['P3']) {
    const s = await L.openPaper(k, L.W.W1, {}); const p = s.page;
    const hs = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body h1,#paper-body h2,#paper-body h3,#paper-body h4,#paper-body h5')).map(h => ({ tag: h.tagName, size: getComputedStyle(h).fontSize, family: getComputedStyle(h).fontFamily.slice(0, 18), len: h.textContent.trim().length, weight: getComputedStyle(h).fontWeight, cls: String(h.className).slice(0, 50) })));
    console.log(k, hs.length, JSON.stringify(hs));
    await s.browser.close();
  }
})();
