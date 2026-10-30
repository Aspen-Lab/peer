// private probe values (stay in scratch; the privacy grep prints counts only): the passages the walk selects, by purpose
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  const probes = {
    "the placeholder key": 'sk-placeholder-p12-' + 'a38-0000000000000000',
    "a question's first five words (typed in the question bar)": 'How hot does it run',
    "a second question's first five words": 'What is the main finding',
    "a long question's first five words": 'A long question that wraps over',
    "a note's first five words (sticky)": 'invented line 1 of note',
    "a sticky draft": 'invented draft line',
    "a follow-up draft in the Explain card": 'invented follow-up draft',
  };
  for (const k of ['P1', 'P2', 'P3']) {
    const s = await L.openPaper(k, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
    const kinds = { inPara: () => S.selInPara(p, paras), across: () => S.selAcross(p, paras), heading: () => S.selHeading(p), caption: () => S.selCaption(p), summary: () => S.selSummary(p) };
    for (const [name, fn] of Object.entries(kinds)) {
      try {
        await S.openTab(p, 'Paper digestion').catch(() => {}); await p.waitForTimeout(500);
        await fn(); await p.waitForTimeout(500);
        const t = await p.evaluate(() => getSelection().toString().replace(/\s+/g, ' ').trim());
        if (t.length > 8) { probes[`a highlighted passage of ${k}, ${name} (first five words)`] = t.split(' ').slice(0, 5).join(' '); probes[`a highlighted passage of ${k}, ${name} (whole)`] = t; }
        await S.clearSel(p);
      } catch (e) { console.log(k, name, 'ERR', String(e.message).slice(0, 80)); }
    }
    // paragraph windows (five words from paragraphs the walk selects around)
    for (const idx of [3, 4, 6, 8, 10]) { const t = await p.evaluate((i) => (document.querySelectorAll('#paper-body p')[i] || { textContent: '' }).textContent.replace(/\s+/g, ' ').trim(), paras[Math.min(idx, paras.length - 1)]); if (t) probes[`five words from a paragraph the walk selects in ${k} (#${idx})`] = t.split(' ').slice(3, 8).join(' '); }
    await s.browser.close();
  }
  L.fs.writeFileSync(L.R + '/probes.private.json', JSON.stringify(probes, null, 1));
  console.log('probes:', Object.keys(probes).length);
})();
