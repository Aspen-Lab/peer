// P12-92: characters per full line of body paragraphs at W1..W3 (default and largest step) after C P12-89's 20 px right padding.
// Two selections: "first4" = the first four paragraphs over 400 characters (the selection of round 3's layoutState) and "all" = every body paragraph over 300 characters outside figures.
// Usage: node r4cpl.cjs P1 W3 [stepIdx]
const L = require('./lib2.cjs');
const PACK = L.R + '/pack';
const [, , key, wn, stepArg] = process.argv; const stepIdx = stepArg === undefined ? 2 : +stepArg;

(async () => {
  const w = L.W[wn];
  // the Larger / Smaller text buttons live in the left pane, which is the rail at W2 and W3: choose the step at W1, then narrow the window (the preference is the page's own store)
  const s = await L.openPaper(key, stepIdx !== 2 ? L.W.W1 : w, {}); const p = s.page;
  if (stepIdx !== 2) { await L.setStep(p, stepIdx); if (wn !== 'W1') { await p.setViewportSize({ width: w[0], height: w[1] }); await p.waitForTimeout(2500); await L.settleBody(p); } }
  const stepName = L.STEPFILE[stepIdx] || String(stepIdx);
  const cell = `R4CPL-${key}-${wn}-${stepName}-light`;
  await p.evaluate(() => window.scrollTo(0, 0)); await L.still(p); await p.waitForTimeout(500);
  const measureFn = () => {
    const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1) }; };
    const lines = (p) => {
      const walker = document.createTreeWalker(p, NodeFilter.SHOW_TEXT); const out = []; let curTop = null, n = 0;
      while (walker.nextNode()) {
        const t = walker.currentNode; const txt = t.textContent;
        for (let i = 0; i < txt.length; i++) {
          if (/\s/.test(txt[i]) && curTop === null) continue;
          const rg = document.createRange(); rg.setStart(t, i); rg.setEnd(t, i + 1);
          const rc = rg.getClientRects()[0]; if (!rc || rc.width === 0) { n++; continue; }
          const top = Math.round(rc.top / 4);
          if (curTop === null) { curTop = top; n = 0; }
          if (Math.abs(top - curTop) > 1) { out.push(n); curTop = top; n = 0; }
          n++;
        }
      }
      out.pop(); return out.filter(x => x > 10);
    };
    const stats = (a) => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); const sum = b.reduce((x, y) => x + y, 0); return { n: b.length, min: b[0], p10: b[Math.floor(b.length * 0.1)], median: b[Math.floor(b.length / 2)], mean: +(sum / b.length).toFixed(2), max: b[b.length - 1], below58: b.filter(x => x < 58).length, below55: b.filter(x => x < 55).length }; };
    const shell = document.querySelector('[data-reader-shell]'); const one = document.querySelector('[data-reader-one-column]');
    const all = Array.from(document.querySelectorAll('#paper-body p')).filter(q => q.textContent.length > 300 && !q.closest('figure,[data-figure]') && q.getBoundingClientRect().width > 150);
    const first4 = Array.from(document.querySelectorAll('#paper-body p')).filter(q => q.textContent.length > 400).slice(0, 4);
    const perAll = []; for (const q of all) perAll.push(...lines(q));
    const perFirst4 = []; for (const q of first4) perFirst4.push(...lines(q));
    const centre = document.querySelector('[data-reader-centre]'); const inner = document.querySelector('[data-reader-centre-inner]');
    const q0 = all[0]; const cs = centre ? getComputedStyle(centre) : null;
    return { vw: innerWidth, mode: shell ? 'panes' : one ? 'one-column' : 'unknown', centre: r(centre), centreInner: r(inner), paddingLeft: cs && cs.paddingLeft, paddingRight: cs && cs.paddingRight, paragraph: r(q0), bodyFont: q0 ? getComputedStyle(q0).fontSize : null, nParagraphs: all.length, first4: stats(perFirst4), all: stats(perAll), hOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth + 1, scrollWidth: document.documentElement.scrollWidth };
  };
  const res = await p.evaluate(measureFn);
  // the round-3 geometry on the same page and the same paragraphs: the centre's right padding put back to 12 px by an injected style (a measurement aid, not a product change)
  await p.addStyleTag({ content: '.reader-centre{padding-inline:12px !important}' }); await p.waitForTimeout(700); await L.still(p);
  res.emulatedPad12 = await p.evaluate(measureFn);
  await p.screenshot({ path: `${PACK}/${cell}-pad12emu.png` });
  res.cell = cell; res.input = key; res.width = wn; res.viewport = w; res.step = stepIdx; res.load = require('os').loadavg()[0]; res.pageerrors = s.log.pageerrors;
  await p.screenshot({ path: `${PACK}/${cell}.png` });
  L.fs.writeFileSync(`${PACK}/${cell}.json`, JSON.stringify(res, null, 1));
  const q = (o) => o && ({ para: o.paragraph && o.paragraph.w, first4: o.first4 && [o.first4.median, o.first4.mean], all: o.all && [o.all.n, o.all.min, o.all.median, o.all.mean, o.all.max, o.all.below58] });
  console.log(cell, res.mode, 'centre', res.centre && res.centre.w, 'font', res.bodyFont, 'pad20', JSON.stringify(q(res)), 'pad12emu', JSON.stringify(q(res.emulatedPad12)));
  await s.browser.close();
})().catch(e => { console.error('ERR', e); process.exit(1); });
