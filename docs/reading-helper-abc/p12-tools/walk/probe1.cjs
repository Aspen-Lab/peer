const L = require('./lib2.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W1, {}); const p = s.page;
  await p.screenshot({ path: L.R + '/p1-nokey-w1.png' });
  const info = await p.evaluate(() => ({
    ta: !!document.querySelector('textarea'), placeholder: document.querySelector('textarea') && document.querySelector('textarea').placeholder,
    tabs: Array.from(document.querySelectorAll('[role=tab]')).map(t => t.textContent.trim().slice(0, 30)),
    buttons: Array.from(document.querySelectorAll('button')).map(b => (b.getAttribute('aria-label') || b.textContent.trim()).slice(0, 40)).filter(Boolean).slice(0, 70),
  }));
  console.log(JSON.stringify(info));
  console.log(JSON.stringify(s.log.pageerrors), JSON.stringify(s.log.console.slice(0, 6)));
  await s.browser.close();
})();
