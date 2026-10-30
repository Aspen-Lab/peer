const L = require('./lib2.cjs');
(async () => {
  const s = await L.openPaper('P1', L.W.W2, {}); const p = s.page;
  const st = () => p.evaluate(() => { const l = document.querySelector('[data-reader-left]'); return l && l.getAttribute('data-state') + '|focusIn=' + l.contains(document.activeElement) + '|active=' + (document.activeElement ? document.activeElement.tagName + ':' + (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').slice(0, 20) : ''); });
  const open = async () => { await p.locator('[data-reader-rail]').first().hover(); await p.waitForTimeout(1600); await p.getByRole('tab', { name: 'Summary' }).click(); await p.mouse.move(800, 300); await p.waitForTimeout(800); };
  await open(); console.log('A after tab press + mouse away:', await st());
  await p.mouse.click(800, 300); await p.waitForTimeout(600); console.log('A after click in empty margin:', await st());
  await open(); await p.keyboard.press('Escape'); await p.waitForTimeout(600); console.log('B after Escape:', await st(), 'url', p.url().slice(-30));
  await open(); await p.mouse.click(500, 300); await p.waitForTimeout(600); console.log('C after click on the paper text area x=500:', await st());
  await open(); await p.mouse.click(150, 300); await p.waitForTimeout(600); console.log('D after click at x=150 (under peek):', await st());
  await s.browser.close();
})();
