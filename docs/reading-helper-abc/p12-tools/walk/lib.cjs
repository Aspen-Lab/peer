const { chromium } = require('playwright');
const fs = require('fs');
const R = '__P12_SCRATCH__/p12/r2/a92';
const I = '__P12_SCRATCH__/p12/inputs';
const INPUTS = {
  P1: '__P12_PDF_DIR__/P1.pdf',
  P2: '__P12_PDF_DIR__/P2.pdf',
  P3: '__P12_PDF_DIR__/P3.pdf',
};
const BASE = 'http://localhost:4247';
const W = { W1: [1440, 900], W2: [1024, 576], W3: [853, 480], W4: [390, 844] };

async function newSession(opts = {}) {
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage();
  const log = { console: [], pageerrors: [], requests: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.console.push({ t: m.type(), text: m.text().slice(0, 300), url: page.url() }); });
  page.on('pageerror', e => log.pageerrors.push({ text: String(e).slice(0, 400), at: Date.now(), phase: log.phase || null, url: page.url() }));
  page.on('request', r => log.requests.push({ m: r.method(), u: r.url().replace(BASE, '').slice(0, 160) }));
  page.on('response', r => { if (r.status() >= 400) log.console.push({ t: 'http' + r.status(), text: r.url().replace(BASE, '').slice(0, 160), url: page.url() }); });
  return { browser, ctx, page, log };
}
async function skipSetup(page) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2500);
  const skip = page.getByText('Skip setup', { exact: false }).first();
  if (await skip.count()) { await skip.click(); await page.waitForTimeout(1500); }
}
async function upload(page, key) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);
  const btn = page.getByRole('button', { name: 'Upload a paper PDF' });
  await btn.waitFor({ timeout: 30000 });
  const [fc] = await Promise.all([page.waitForEvent('filechooser'), btn.click()]);
  await fc.setFiles(INPUTS[key]);
  const dlg = page.locator('dialog[open]');
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('input[type=checkbox]').check();
  await dlg.getByRole('button', { name: 'Upload PDF' }).click();
  await page.waitForURL(/\/papers\//, { timeout: 90000 });
  await page.waitForTimeout(1500);
  return page.url();
}
async function still(page, ms = 300) {
  // wait for 300 ms of still scroll
  let last = await page.evaluate(() => [scrollX, scrollY, ...Array.from(document.querySelectorAll('[data-scroll-probe]')).map(e=>e.scrollTop)].join());
  let since = Date.now();
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(60);
    const now = await page.evaluate(() => [scrollX, scrollY, ...Array.from(document.querySelectorAll('[data-scroll-probe]')).map(e=>e.scrollTop)].join());
    if (now !== last) { last = now; since = Date.now(); }
    if (Date.now() - since >= ms) return;
  }
}
module.exports = { chromium, fs, R, I, INPUTS, BASE, W, newSession, skipSetup, upload, still };


async function settleBody(page, quietMs = 3500, maxMs = 60000) {
  const t0 = Date.now(); let last = -1, since = Date.now();
  while (Date.now() - t0 < maxMs) {
    const len = await page.evaluate(() => { const b = document.querySelector('#paper-body'); return b ? b.textContent.length : -1; }).catch(() => -1);
    if (len !== last) { last = len; since = Date.now(); }
    if (Date.now() - since >= quietMs && len > 0) return len;
    await page.waitForTimeout(400);
  }
  return last;
}

// open a session from the saved base state at a given width
async function openPaper(key, w, opts = {}) {
  const urls = JSON.parse(fs.readFileSync(R + '/urls.json'));
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ storageState: opts.state || (R + '/base-state.json'), viewport: { width: w[0], height: w[1] }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light', hasTouch: !!opts.touch, isMobile: !!opts.touch });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000); page.setDefaultNavigationTimeout(600000);
  const log = { console: [], pageerrors: [], requests: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.console.push({ t: m.type(), text: m.text().slice(0, 300), url: page.url().replace(BASE, '') }); });
  page.on('pageerror', e => log.pageerrors.push({ text: String(e).slice(0, 400), at: Date.now(), phase: log.phase || null, url: page.url().replace(BASE, '') }));
  page.on('request', r => log.requests.push({ m: r.method(), u: r.url().replace(BASE, '').slice(0, 200), post: (r.method() === 'POST' ? (r.postData() || '').length : 0) }));
  page.on('response', r => { if (r.status() >= 400) log.console.push({ t: 'http' + r.status(), text: r.url().replace(BASE, '').slice(0, 200), url: page.url().replace(BASE, '') }); });
  await page.goto(urls[key], { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#paper-body', { timeout: 600000 });
  await page.waitForTimeout(opts.settle || 5000);
  await settleBody(page);
  return { browser, ctx, page, log, url: urls[key] };
}
module.exports.openPaper = openPaper;
module.exports.settleBody = settleBody;

async function openKey(key, w, opts = {}) {
  const urls = JSON.parse(fs.readFileSync(R + '/urls-key.json'));
  const browser = await chromium.launch({ args: ['--disable-dev-shm-usage', '--disable-gpu'] });
  const ctx = await browser.newContext({ storageState: R + '/key-state.json', viewport: { width: w[0], height: w[1] }, deviceScaleFactor: 1, colorScheme: opts.dark ? 'dark' : 'light' });
  const page = await ctx.newPage(); page.setDefaultTimeout(180000); page.setDefaultNavigationTimeout(600000);
  const log = { console: [], pageerrors: [], requests: [] };
  page.on('console', m => { if (['error', 'warning'].includes(m.type())) log.console.push({ t: m.type(), text: m.text().slice(0, 300), url: page.url().replace(BASE, '') }); });
  page.on('pageerror', e => log.pageerrors.push({ text: String(e).slice(0, 400), at: Date.now(), phase: log.phase || null, url: page.url().replace(BASE, '') }));
  page.on('request', r => log.requests.push({ m: r.method(), u: r.url().replace(BASE, '').slice(0, 200) }));
  page.on('response', r => { if (r.status() >= 400) log.console.push({ t: 'http' + r.status(), text: r.url().replace(BASE, '').slice(0, 200), url: page.url().replace(BASE, '') }); });
  await page.goto(urls[key], { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#paper-body', { timeout: 600000 });
  await page.waitForTimeout(opts.settle || 5000);
  await settleBody(page);
  return { browser, ctx, page, log, url: urls[key] };
}
module.exports.openKey = openKey;
