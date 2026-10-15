// P10-28 measurement (Chromium, port 4042, the stub loaded; the notes page needs no model; an invented paper's note). Run: SHOTS=<dir> node P10-28-measure.cjs
const { chromium } = require("/opt/node-tools/node_modules/playwright");
const SHOTS = process.env.SHOTS;
const T = "Seaweed mulch and soil water";
const now = "2026-10-14T00:00:00.000Z";
const anchor = (n, p) => ({ paperId: "openalex:W9", paragraphId: p, quote: "Moisture probes sat in each plot.", n });
const blocks = [
  { id: "tt1", type: "h1", text: T },
  { id: "own1", type: "text", text: "My own line about mulch depth" },
  { id: "sh1", type: "h3", text: "Note 1", anchor: anchor(1, "paper-section-1-p2") },
  { id: "st1", type: "text", text: "Probes in each plot look sparse" },
  { id: "sh2", type: "h3", text: "Note 2", anchor: anchor(2, "paper-section-2-p1") },
  { id: "st2", type: "text", text: "Compare with the earlier trials" },
  { id: "bx", type: "text", text: "alpha **beta** gamma" },
  { id: "ux", type: "text", text: "alpha __beta__ gamma" },
  { id: "hx", type: "text", text: "alpha ==beta== gamma" },
  { id: "jn1", type: "bullet", text: "first half", indent: 1 },
  { id: "jn2", type: "todo", text: "second half", checked: true, indent: 2 },
  // an old Backspace left this sticky heading as text
  { id: "sh3", type: "text", text: "Note 3", anchor: anchor(3, "paper-section-3-p1") },
  { id: "st3", type: "text", text: "tail" },
  { id: "jt1", type: "text", text: "one " },
  { id: "jt2", type: "text", text: "two" },
];
const note = { id: "n1", title: T, blocks, sources: {}, paperId: "openalex:W9", stickyCount: 3, createdAt: now, updatedAt: now };
const stored = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("peer-notes")).state.notes.n1.blocks.map((b) => ({ id: b.id, type: b.type, text: b.text, anchor: b.anchor ? b.anchor.n : undefined, checked: b.checked, indent: b.indent })));
const sel = (page) => page.evaluate(() => String(window.getSelection()));
(async () => {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(([k, v]) => { if (!localStorage.getItem(k)) localStorage.setItem(k, v); }, ["peer-notes", JSON.stringify({ state: { notes: { n1: note } }, version: 1 })]);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  const out = { errors };
  const settle = () => page.waitForTimeout(700);
  const row = (id) => page.locator(`[data-row="${id}"]`);
  const edit = async (id, at) => { await row(id).locator("[contenteditable], [data-typeset]").first().click({ position: at }).catch(() => row(id).click()); };
  await page.goto("http://localhost:4042/notes/n1", { waitUntil: "networkidle", timeout: 120000 });
  await page.waitForSelector('[data-row="own1"]', { timeout: 60000 });
  await settle();
  const original = await stored(page);
  out.loadRepair = (await stored(page)).find((b) => b.id === "sh3"); // after the 500 ms save
  await page.screenshot({ path: SHOTS + "/01-loaded.png" });

  // 1. Delete at the end of the block above "Note 2"
  await row("st1").click(); await page.keyboard.press("End"); await page.keyboard.press("Delete"); await settle();
  out.deleteAbove = (await stored(page)).filter((b) => ["st1", "sh2"].includes(b.id));

  // 2. Delete at the end of the heading "Note 2"
  await row("sh2").click(); await page.keyboard.press("End"); await page.keyboard.press("Delete"); await settle();
  out.deleteInHeading = (await stored(page)).filter((b) => ["sh2", "st2"].includes(b.id));

  // 4. the toolbar while the caret is in the heading, and in a text block
  const tb = () => page.evaluate(() => Array.from(document.querySelectorAll('[role="toolbar"] button')).map((b) => [b.getAttribute("aria-label"), b.getAttribute("aria-disabled"), b.disabled, getComputedStyle(b).opacity]));
  await row("sh2").click(); await settle();
  out.toolbarInHeading = await tb();
  await page.screenshot({ path: SHOTS + "/02-toolbar-in-heading.png" });
  await page.getByRole("button", { name: "Bulleted list" }).click({ force: true }); await settle();
  out.afterBulletClick = (await stored(page)).find((b) => b.id === "sh2");
  await row("st2").click(); await settle();
  out.toolbarInText = await tb();

  // 3. Duplicate on "Note 2"
  await row("sh2").hover();
  await row("sh2").getByRole("button", { name: "Move this block, or open its menu" }).click(); await settle();
  await page.screenshot({ path: SHOTS + "/03-block-menu.png" });
  await page.getByRole("menuitem", { name: "Duplicate" }).click(); await settle();
  const afterDup = await stored(page);
  out.duplicate = { anchored: afterDup.filter((b) => b.anchor !== undefined).map((b) => [b.id.slice(0, 5), b.anchor]), heads: afterDup.filter((b) => b.type === "h3").map((b) => [b.text, b.anchor]) };
  await page.screenshot({ path: SHOTS + "/04-duplicated.png" });

  // 5. two marks in a row on one selection
  await row("st2").click(); await page.keyboard.press("Home");
  for (let i = 0; i < 7; i++) await page.keyboard.press("Shift+ArrowRight");
  out.sel0 = await sel(page);
  await page.keyboard.press("Control+b"); await settle();
  out.sel1 = await sel(page);
  await page.keyboard.press("Control+i"); await settle();
  out.sel2 = await sel(page);
  out.twoMarks = (await stored(page)).find((b) => b.id === "st2").text;
  await page.keyboard.press("Control+Shift+h"); await settle();
  out.sel3 = await sel(page);
  out.threeMarks = (await stored(page)).find((b) => b.id === "st2").text;
  await page.screenshot({ path: SHOTS + "/05-marks.png" });

  // 6. Enter in the middle of a block, then Ctrl+Z
  await row("own1").click(); await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter"); await settle();
  const split = (await stored(page)).filter((b) => ["own1"].includes(b.id) || b.text === " line about mulch depth" || b.text === "line about mulch depth");
  out.split = (await stored(page)).slice(1, 4).map((b) => b.text);
  await page.screenshot({ path: SHOTS + "/06-split.png" });
  await page.keyboard.press("Control+z"); await settle();
  out.splitUndone = (await stored(page)).slice(1, 3).map((b) => [b.id, b.text]);
  out.splitUndoneCaretRow = await page.evaluate(() => { const a = document.activeElement; const r = a && a.closest && a.closest("[data-row]"); return r && r.getAttribute("data-row"); });
  await page.keyboard.press("Control+y"); await settle();
  out.splitRedone = (await stored(page)).slice(1, 4).map((b) => b.text);
  await page.keyboard.press("Control+z"); await settle();

  // Delete joining a bullet and the checked, indented to-do under it, then Ctrl+Z (type, checked, indent come back)
  await row("jn1").click(); await page.keyboard.press("End"); await page.keyboard.press("Delete"); await settle();
  out.deleteJoined = (await stored(page)).filter((b) => b.id.startsWith("jn")).map((b) => [b.id, b.type, b.text, b.indent]);
  await page.screenshot({ path: SHOTS + "/07-joined.png" });
  await page.keyboard.press("Control+z"); await settle();
  out.deleteJoinUndone = (await stored(page)).filter((b) => b.id.startsWith("jn")).map((b) => [b.id, b.type, b.text, b.checked, b.indent]);
  await page.keyboard.press("Control+y"); await settle();
  out.deleteJoinRedone = (await stored(page)).filter((b) => b.id.startsWith("jn")).map((b) => [b.id, b.type, b.text]);
  await page.keyboard.press("Control+z"); await settle();
  // Backspace joining two text blocks, then Ctrl+Z
  await row("jt2").click(); await page.keyboard.press("Home"); await page.keyboard.press("Backspace"); await settle();
  out.backspaceJoined = (await stored(page)).filter((b) => b.id.startsWith("jt")).map((b) => [b.id, b.type, b.text]);
  await page.keyboard.press("Control+z"); await settle();
  out.backspaceJoinUndone = (await stored(page)).filter((b) => b.id.startsWith("jt")).map((b) => [b.id, b.type, b.text, b.indent]);
  out.undoCaretRow = await page.evaluate(() => { const a = document.activeElement; const r = a && a.closest && a.closest("[data-row]"); return r && r.getAttribute("data-row"); });
  // typing after a split is undone first, then the split
  await row("own1").click(); await page.keyboard.press("Home");
  for (let i = 0; i < 6; i++) await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter"); await page.keyboard.type("XYZ"); await settle();
  await page.keyboard.press("Control+z"); await settle();
  out.typedAfterSplit1 = (await stored(page)).slice(1, 3).map((b) => b.text);
  await page.keyboard.press("Control+z"); await settle();
  out.typedAfterSplit2 = (await stored(page)).slice(1, 3).map((b) => b.text);

  // 7. a literal mark character inside its own mark
  for (const [id, ch, key] of [["bx", "*", "bold"], ["ux", "_", "underline"], ["hx", "=", "highlight"]]) {
    await row(id).click(); await page.keyboard.press("Home");
    for (let i = 0; i < 8; i++) await page.keyboard.press("ArrowRight");
    await page.keyboard.type(ch); await settle();
    out["literal_" + key] = { source: (await stored(page)).find((b) => b.id === id).text, shown: await row(id).innerText(), html: await row(id).locator("[contenteditable]").first().innerHTML().catch(() => null) };
  }
  await page.screenshot({ path: SHOTS + "/08-literal.png" });
  await page.keyboard.press("Escape");
  await page.evaluate(() => document.activeElement && document.activeElement.blur()); await settle();
  out.shownReading = await page.evaluate(() => ["bx", "ux", "hx"].map((id) => document.querySelector(`[data-row="${id}"]`).innerText));
  await page.screenshot({ path: SHOTS + "/09-reading.png" });
  out.final = await stored(page);
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})();
