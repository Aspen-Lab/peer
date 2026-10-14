const { chromium } = require("/opt/node-tools/node_modules/playwright");
const fs = require("fs");
const SHOTS = __dirname + "/shots";
const T = "Seaweed mulch and soil water";
const now = "2026-10-14T00:00:00.000Z";
const anchor = (n) => ({ paperId: "openalex:W9", paragraphId: "paper-section-1-p2", quote: "Moisture probes sat in each plot.", n });
const blocks = [
  { id: "tt1", type: "h1", text: T },
  { id: "own1", type: "text", text: "My own line about mulch depth" },
  { id: "sh1", type: "h3", text: "Note 1", anchor: anchor(1) },
  { id: "st1", type: "text", text: "Probes in each plot look sparse" },
  { id: "sh2", type: "h3", text: "Note 2", anchor: { ...anchor(2), paragraphId: "paper-section-2-p1" } },
  { id: "st2", type: "text", text: "Compare with the earlier trials" },
];
const note = { id: "n1", title: T, blocks, sources: { }, paperId: "openalex:W9", stickyCount: 2, createdAt: now, updatedAt: now };
const stored = async (page) => page.evaluate(() => JSON.parse(localStorage.getItem("peer-notes")).state.notes.n1.blocks.map((b) => [b.id, b.type, b.text]));
const active = (page) => page.evaluate(() => { const a = document.activeElement; const r = a && a.closest && a.closest("[data-row]"); return { tag: a && a.tagName, row: r ? r.getAttribute("data-row") : null, aria: a && a.getAttribute && a.getAttribute("aria-label") }; });
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ["peer-notes", JSON.stringify({ state: { notes: { n1: note } }, version: 1 })]);
  const page = await ctx.newPage();
  const out = {};
  await page.goto("http://localhost:4036/notes/n1", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-row="own1"]', { timeout: 60000 });
  out.hiddenVisible = await page.evaluate(() => getComputedStyle(document.querySelector('[data-row="tt1"]')).display);
  const footer = async () => (await page.locator("text=/\\d+ words?/").first().innerText()).trim();
  out.footer = await footer();
  const expectedAll = blocks.map((b) => b.text).join(" ").split(/\s+/).filter(Boolean).length;
  const expectedVisible = blocks.slice(1).map((b) => b.text).join(" ").split(/\s+/).filter(Boolean).length;
  out.expected = { all: expectedAll, visible: expectedVisible };
  await page.screenshot({ path: SHOTS + "/01-page.png" });
  const before = await stored(page);

  // 1. Enter in the title field
  const title = page.locator("textarea").first();
  await title.click();
  out.titleValue = await title.inputValue();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  out.afterEnter = await active(page);
  await page.screenshot({ path: SHOTS + "/02-enter-in-title.png" });

  // ArrowDown in the title field (same route)
  await title.click();
  await page.keyboard.press("End");
  await page.keyboard.press("ArrowDown");
  await page.waitForTimeout(300);
  out.afterTitleDown = await active(page);

  // 2. ArrowUp from the first visible block's first line
  await page.locator('[data-row="own1"]').click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Home");
  out.beforeUp = await active(page);
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(300);
  out.afterUp = await active(page);
  await page.screenshot({ path: SHOTS + "/03-arrowup.png" });
  out.titleAfterUp = await title.inputValue();

  // 3. Backspace at the start of the first visible block
  await page.locator('[data-row="own1"]').click();
  await page.waitForTimeout(200);
  await page.keyboard.press("Home");
  await page.keyboard.press("Backspace");
  await page.waitForTimeout(300);
  out.afterBackspace = await active(page);
  out.ownRowTextAfterBackspace = await page.locator('[data-row="own1"]').innerText();
  out.rowsAfterBackspace = await page.evaluate(() => [...document.querySelectorAll("[data-row]")].map((r) => r.getAttribute("data-row")));
  await page.screenshot({ path: SHOTS + "/04-backspace.png" });
  // Delete at end of the block before... (the hidden block is first, so only a moved-block case); ArrowLeft at start -> title
  await page.keyboard.press("Home");
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(300);
  out.afterArrowLeft = await active(page);

  await page.waitForTimeout(2500);
  const after = await stored(page);
  out.storedUnchanged = JSON.stringify(before) === JSON.stringify(after);
  out.storedHidden = after[0];
  out.footerAfter = await footer();
  fs.writeFileSync(SHOTS + "/measure.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
