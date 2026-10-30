// private probe values (stay in scratch; the privacy grep prints counts only)
const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const probes = { 'the placeholder key': 'sk-placeholder-p12-' + 'a38-0000000000000000', "a note's first five words": 'invented line 1 of note', "a note draft (sticky)": 'invented draft line', "a follow-up draft in the Explain card": 'invented follow-up draft', "question 1": 'What temperature does the process run at?', "question 2": 'How hot does it run?', "question 3": 'What is the main finding?' };
  for (const k of ['P1', 'P2', 'P3']) {
    const s = await L.openPaper(k, L.W.W1, {}); const p = s.page; const paras = await C.goodParas(p);
    const t = await p.evaluate((i) => document.querySelectorAll('#paper-body p')[i].textContent.replace(/\s+/g, ' ').trim(), paras[Math.min(4, paras.length - 1)]);
    const words = t.split(' '); probes[`a highlighted passage of ${k} (five words from a selected paragraph)`] = words.slice(3, 8).join(' ');
    probes[`a second passage of ${k} (five words from another paragraph)`] = (await p.evaluate((i) => document.querySelectorAll('#paper-body p')[i].textContent.replace(/\s+/g, ' ').trim(), paras[Math.min(6, paras.length - 1)])).split(' ').slice(4, 9).join(' ');
    await s.browser.close();
  }
  L.fs.writeFileSync(L.R + '/probes.private.json', JSON.stringify(probes, null, 1));
  console.log('probes:', Object.keys(probes).length);
})();
