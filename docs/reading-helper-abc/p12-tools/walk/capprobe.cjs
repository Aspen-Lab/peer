const L = require('./lib2.cjs'); const C = require('./bat_cards.cjs');
(async () => {
  const s = await L.openPaper('P3', L.W.W1, {}); const p = s.page;
  const caps = await p.evaluate(() => Array.from(document.querySelectorAll('#paper-body figure')).map(f => { const c = f.querySelector('figcaption'); return c ? c.textContent.trim().slice(0, 60) : null; }));
  console.log('inline captions', JSON.stringify(caps));
  const how = await C.openFigure(p, 1, { wait: 2500 });
  const card = await p.evaluate(() => { const c = document.querySelector('[data-figure-caption]'); const h = document.querySelector('[data-margin-card=figure] [data-figure-header]'); return { cap: c ? c.textContent.trim().slice(0, 80) : null, head: h ? h.textContent.trim().slice(0, 80) : null }; });
  console.log('card', JSON.stringify(card), how);
  await p.screenshot({ path: L.R + '/probe-p3-fig1-card.png' });
  await s.browser.close();
})();
