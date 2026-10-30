// private dump of each paper's displayed words (kept in scratch/private; never in the pack or the worktree)
const L = require('./lib2.cjs');
(async () => {
  for (const k of ['P1', 'P2', 'P3']) {
    const s = await L.openPaper(k, L.W.W1, {}); const p = s.page;
    const t = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body p, #paper-body h1, #paper-body h2, #paper-body h3, #paper-body h4, #paper-body li')).filter(e => !e.closest('figure')).map(e => e.textContent.replace(/\s+/g, ' ').trim()).join('\n'));
    L.fs.writeFileSync(L.R + '/private/body-' + k + '.txt', t); console.log(k, t.length);
    await s.browser.close();
  }
})();
