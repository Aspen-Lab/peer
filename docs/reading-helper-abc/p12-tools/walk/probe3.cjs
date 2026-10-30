const L = require('./lib2.cjs');
(async () => {
  const k = process.argv[2] || 'P3';
  const s = await L.openPaper(k, L.W.W1, {}); const p = s.page;
  const info = await p.evaluate(() => {
    const left = document.querySelector('[data-reader-left]');
    const lis = Array.from(left.querySelectorAll('li')).slice(0, 4).map(li => li.outerHTML.slice(0, 700));
    const body = document.querySelector('#paper-body');
    const kids = Array.from(body.children).slice(0, 6).map(c => c.tagName + '|' + (c.id || '') + '|' + c.className.toString().slice(0, 40) + '|' + c.textContent.slice(0, 30));
    return { lis, kids, nMapLis: left.querySelectorAll('li').length };
  });
  console.log(JSON.stringify(info, null, 1));
  await s.browser.close();
})();
