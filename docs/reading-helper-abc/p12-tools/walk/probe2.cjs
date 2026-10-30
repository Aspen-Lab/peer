const L = require('./lib2.cjs'); const S = require('./cell_sel.cjs');
(async () => {
  const k = process.argv[2] || 'P1';
  const s = await L.openPaper(k, L.W.W1, {}); const p = s.page;
  await S.openTab(p, 'Summary').catch(e => console.log('tab err', e.message));
  await p.waitForTimeout(2500);
  await p.screenshot({ path: L.R + '/probe-summary-' + k + '.png' });
  const info = await p.evaluate(() => ({
    figs: Array.from(document.querySelectorAll('figure')).map(f => ({ inBody: !!f.closest('#paper-body'), btn: (f.querySelector('button') || {}).getAttribute ? (f.querySelector('button').getAttribute('aria-label')) : null, img: f.querySelector('img') ? f.querySelector('img').src.replace(/^.*figure-image\?/, '').slice(0, 60) : null })),
    btns: Array.from(document.querySelectorAll('button')).map(b => b.getAttribute('aria-label') || '').filter(a => /fig|enlarge/i.test(a)),
    imgs: Array.from(document.querySelectorAll('img')).map(i => ({ src: (i.getAttribute('src') || '').replace(/^.*figure-image\?/, '').slice(0, 60), w: i.naturalWidth, vis: i.getBoundingClientRect().width })),
    panelText: (document.querySelector('[role=tabpanel]') || {}).textContent ? document.querySelector('[role=tabpanel]').textContent.length : null,
  }));
  console.log(JSON.stringify(info, null, 0));
  await s.browser.close();
})();
