// The reading loop's render worker (round P9): upload a PDF through the real UI (no key, Tier 0) and dump the
// digested paper exactly as the DOM renders it. Writes only under OUT_DIR. Prints no paper text.
// Usage: PORT=3907 PEER_TEST_PDF=<pdf> OUT_DIR=<dir> node render-digestion.mjs  (Playwright from /opt/node-tools, Chromium at /opt/pw-browsers)
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire("/opt/node-tools/node_modules/");
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 3907);
const BASE = `http://localhost:${PORT}`;
const R = process.env.OUT_DIR || "/tmp/peer-render";
const PDF = process.env.PEER_TEST_PDF; if (!PDF) { console.error("PEER_TEST_PDF (a PDF path) is required"); process.exit(2); }
const notes = [];
const note = (s) => { notes.push(s); console.error("[note] " + s); };
const blocked = new Set();

async function launch(size, touch = false) {
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
  const ctx = await browser.newContext({ viewport: size, colorScheme: "light", hasTouch: touch, isMobile: touch, acceptDownloads: true });
  await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (route) => {
    const u = route.request().url();
    if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return route.continue();
    try { blocked.add(new URL(u).hostname); } catch {}
    return route.abort();
  });
  return { browser, ctx };
}
function watch(page, tag) {
  page.on("pageerror", (e) => note(`${tag}: pageerror: ${String(e.message).slice(0, 140)}`));
  page.on("console", (m) => { if (m.type() === "error") note(`${tag}: console.error: ${m.text().replace(/\s+/g, " ").slice(0, 160)}`); });
}

// REUSE=1: the paper was already uploaded by an earlier run of this script (state.json + paper-url.txt);
// reopen it in a fresh context with that storage instead of uploading a second time.
const REUSE = process.env.REUSE === "1" && fs.existsSync(R + "/paper-url.txt") && fs.existsSync(R + "/state.json");
let uploadMs = null;
const { browser, ctx } = REUSE
  ? await (async () => {
      const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
      const c = await b.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", acceptDownloads: true, storageState: R + "/state.json" });
      await c.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (route) => { const u = route.request().url(); if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return route.continue(); try { blocked.add(new URL(u).hostname); } catch {} return route.abort(); });
      return { browser: b, ctx: c };
    })()
  : await launch({ width: 1440, height: 1000 });
const page = await ctx.newPage();
watch(page, "desk");

if (REUSE) {
  note("REUSE=1: reopened the paper uploaded by the first run (no second upload)");
  await page.goto(fs.readFileSync(R + "/paper-url.txt", "utf8").trim(), { waitUntil: "domcontentloaded", timeout: 240000 });
} else {
// 1. first visit: / → /welcome → Skip setup →
await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
let onWelcome = false;
for (let i = 0; i < 300; i++) {
  if (/\/welcome/.test(page.url())) { onWelcome = true; break; }
  if (await page.locator("button[aria-label='Upload a paper PDF']").count()) break;
  await page.waitForTimeout(100);
}
if (onWelcome) {
  const skip = page.getByText("Skip setup").first();
  await skip.waitFor({ timeout: 60000 });
  await skip.click();
  await page.waitForURL((u) => !/\/welcome/.test(u.pathname), { timeout: 60000 });
} else {
  note("first visit did not land on /welcome (no walkthrough to skip)");
}
await page.waitForSelector("button[aria-label='Upload a paper PDF']", { timeout: 90000 });
await page.waitForTimeout(1500);

// 2. the upload through the real UI
const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("button[aria-label='Upload a paper PDF']")]);
await chooser.setFiles(PDF);
await page.waitForSelector("dialog[open]", { timeout: 15000 });
await page.locator("dialog[open] label input[type=checkbox]").first().check();
await page.getByRole("button", { name: "Upload PDF" }).click();
const t0 = Date.now();
for (let i = 0; i < 960; i++) { await page.waitForTimeout(250); if (/\/papers\//.test(page.url())) break; }
uploadMs = Date.now() - t0;
if (!/\/papers\//.test(page.url())) note("upload never navigated to a paper page");
const alert = await page.evaluate(() => document.querySelector("[role=alert]")?.textContent ?? null);
if (alert) note("alert after upload: " + alert.slice(0, 120));
}
await page.waitForSelector("#paper-body", { timeout: 240000 });
try { await page.waitForLoadState("networkidle", { timeout: 30000 }); } catch { note("network did not go idle within 30s after the body appeared"); }
await page.waitForTimeout(5000);
const paperUrl = page.url();
fs.writeFileSync(R + "/paper-url.txt", paperUrl);
await ctx.storageState({ path: R + "/state.json" });

// KaTeX's hidden MathML copy would double every formula in innerText; hide it (no word changes).
await page.addStyleTag({ content: ".katex-mathml{display:none!important}" });

const tabs = await page.evaluate(() => [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim() + ":" + t.getAttribute("aria-selected")));
if (!tabs.some((t) => /Paper digestion:true/.test(t))) note("default tab is not Paper digestion: " + tabs.join(" | "));
const keyLen = await page.evaluate(() => { try { const o = JSON.parse(localStorage.getItem("peer-profile") || "{}"); return ((o.state || {}).profile || {}).feedAiApiKey?.length || 0; } catch { return -1; } });
if (keyLen) note("a key is set in the profile (len " + keyLen + "); Tier 0 was asked for");

// 3. the Paper digestion tab: the map and the body
const dump = await page.evaluate(() => {
  const T = (e) => (e ? (e.innerText ?? e.textContent ?? "") : "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  const one = (e) => T(e).replace(/\s+/g, " ").trim();
  // the map
  const mapSec = document.querySelector("section[aria-label='Map']");
  const summaryLine = mapSec ? one(mapSec.querySelector("p.annotation span")) : null;
  const rows = mapSec ? [...mapSec.querySelectorAll(":scope > div > ol > li")].map((li) => {
    const head = li.querySelector(":scope > div");
    const a = head.querySelector("a");
    const spans = [...head.querySelectorAll(":scope > span")].map((s) => one(s)).filter(Boolean);
    const btn = head.querySelector("button");
    const fact = li.querySelector(":scope > p.annotation");
    let role = "-", pg = "-", min = "-";
    for (const s of spans) { if (/^p\.\d+$/.test(s)) pg = s; else if (/^\d+ min$/.test(s)) min = s; else role = s; }
    return { href: a?.getAttribute("href"), heading: one(a), role, page: pg, minutes: min, foldable: !!btn, fold: btn ? one(btn) : "", title: head.getAttribute("title"), route: head.getAttribute("data-route"), fact: fact ? one(fact) : null, rendered: one(head), indent: li.style.paddingLeft };
  }) : [];
  const byHref = new Map(rows.map((r) => [r.href, r]));
  // the body
  const body = document.getElementById("paper-body");
  const bandLabel = body ? one(body.querySelector("h2")) : null;
  // Only the paper's sections (`paper-section-<k>`): the Band around the body is a <section> too.
  const sections = [...body.querySelectorAll(":scope section")].filter((sec) => /^paper-section-\d+$/.test(sec.id)).map((sec) => {
    const h = sec.querySelector(":scope > h3");
    const row = byHref.get("#" + sec.id);
    const blocks = [];
    for (const el of sec.querySelectorAll("p, .group\\/eq, figure")) {
      if (el.closest(".group\\/eq") && !el.classList.contains("group/eq")) continue;
      if (el.closest("figure") && el.tagName !== "FIGURE") continue;
      if (el.tagName === "P") {
        const host = el.parentElement;
        if (!host || !/^paper-section-\d+-p\d+$/.test(host.id)) { blocks.push({ kind: "other-p", text: T(el) }); continue; }
        blocks.push({ kind: "para", id: host.id, text: T(el) });
      } else if (el.classList.contains("group/eq")) {
        const main = el.querySelector(":scope > div");
        const num = el.querySelector(".annotation");
        blocks.push({ kind: "eq", text: one(main), number: num ? one(num) : null, hasTex: !!el.querySelector("button") });
      } else if (el.tagName === "FIGURE") {
        blocks.push({ kind: "fig", text: one(el.querySelector("figcaption")), hasImage: !!el.querySelector("img") });
      }
    }
    return { id: sec.id, heading: one(h), route: h?.getAttribute("data-route") || null, role: row?.role ?? "?", page: row?.page ?? "?", blocks };
  });
  return { summaryLine, rows, bandLabel, sections, mapRowCount: rows.length, katex: document.querySelectorAll(".katex").length, gistLegend: !!mapSec?.querySelector("p.annotation.mt-1") };
});

// whole.txt
const W = [];
W.push(dump.summaryLine ?? "(no map summary line)");
W.push("");
let nPara = 0, nEq = 0, nCap = 0, nOther = 0;
const sectionStarts = []; // [charOffsetOfHeadingLine, heading]
for (const s of dump.sections) {
  sectionStarts.push({ at: W.join("\n").length + (W.length ? 1 : 0), heading: s.heading });
  W.push(`## ${s.heading} [role: ${s.role}, page ${s.page.replace(/^p\./, "")}]`);
  W.push("");
  for (const b of s.blocks) {
    if (b.kind === "para") { W.push(b.text); nPara++; }
    else if (b.kind === "eq") { W.push(`[EQUATION] ${b.text}${b.number ? "   (" + b.number + ")" : ""}`); nEq++; }
    else if (b.kind === "fig") { W.push(`[CAPTION] ${b.text}`); nCap++; }
    else { W.push(`[OTHER] ${b.text}`); nOther++; }
    W.push("");
  }
}
const whole = W.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
fs.writeFileSync(R + "/whole.txt", whole);
if (nOther) note(`${nOther} <p> in the body are not paragraph blocks (marked [OTHER] in whole.txt)`);
if (!dump.sections.some((s) => s.role !== "?")) note("no body section matched a map row (roles unknown)");

// slices: four pieces of roughly equal characters. A cut lands on a section boundary when one is near
// (within 8% of the whole); otherwise on the nearest block boundary (between paragraphs — never inside
// one), and the slice's header then says which section continues across the cut.
{
  const total = whole.length;
  // block starts, from the final text: each block is separated by a blank line
  const blocks = [];
  let off = 0;
  let section = null;
  for (const blk of whole.split("\n\n")) {
    const isSection = /^## /.test(blk);
    if (isSection) section = blk.replace(/^## /, "").replace(/ \[role:.*$/, "").trim();
    blocks.push({ at: off, isSection, section });
    off += blk.length + 2;
  }
  const near = Math.round(total * 0.08);
  const cuts = [0];
  for (let k = 1; k <= 3; k++) {
    const target = Math.round((total * k) / 4);
    const after = blocks.filter((b) => b.at > cuts[cuts.length - 1] && b.at < total);
    const bestSec = after.filter((b) => b.isSection).reduce((best, b) => (best === null || Math.abs(b.at - target) < Math.abs(best.at - target) ? b : best), null);
    const bestAny = after.reduce((best, b) => (best === null || Math.abs(b.at - target) < Math.abs(best.at - target) ? b : best), null);
    const pick = bestSec && Math.abs(bestSec.at - target) <= near ? bestSec : bestAny;
    cuts.push(pick ? pick.at : total);
  }
  cuts.push(total);
  for (let i = 0; i < 4; i++) {
    const from = cuts[i], to = cuts[i + 1];
    const text = whole.slice(from, to);
    const inside = blocks.filter((b) => b.at >= from && b.at < to);
    const heads = [];
    const startsMid = inside.length && !inside[0].isSection && inside[0].section !== null;
    if (startsMid) heads.push(`(cont.) ${inside[0].section}`);
    for (const b of inside) if (b.isSection) heads.push(b.section);
    const endsMid = to < total && !blocks.find((b) => b.at === to)?.isSection;
    if (endsMid && heads.length) heads[heads.length - 1] += " (continues in the next slice)";
    fs.writeFileSync(`${R}/slice-${i + 1}.txt`, `SLICE ${i + 1} of 4 — sections: ${heads.join(" | ") || "(preamble only)"}\n\n${text}`);
  }
}

// map.txt (as rendered, collapsed), then each row expanded
const M = [];
M.push("READING MAP — as rendered on the Paper digestion tab, 1440x1000, no key (Tier 0)");
M.push(`summary line: ${dump.summaryLine}`);
M.push(`gist legend shown: ${dump.gistLegend}`);
M.push("");
M.push("rows (collapsed, as first rendered): heading | role tag | page | minutes | fold control | the line under it");
dump.rows.forEach((r, i) => {
  M.push(`${String(i + 1).padStart(2)}. ${r.heading} | role: ${r.role} | ${r.page} | ${r.minutes} | ${r.foldable ? "[" + r.fold + "]" : "(no fold)"}${r.indent ? " | indent " + r.indent : ""}${r.route ? " | route " + r.route : ""}${r.title ? " | title " + r.title : ""}`);
  M.push(`    rendered: ${r.rendered}`);
  M.push(`    line under it: ${r.fact ?? "(none)"}`);
});
M.push("");
M.push("note: a row shows minutes only; no per-row word count is rendered (the words appear once, in the summary line).");
// expand every foldable row and read its paragraph lines
const expanded = await page.evaluate(async () => {
  const one = (e) => (e?.innerText ?? "").replace(/\s+/g, " ").trim();
  const lis = [...document.querySelectorAll("section[aria-label='Map'] > div > ol > li")];
  const out = [];
  for (const li of lis) {
    const btn = li.querySelector(":scope > div > button[aria-expanded]");
    if (btn && btn.getAttribute("aria-expanded") !== "true") btn.click();
  }
  await new Promise((r) => setTimeout(r, 800));
  for (const li of lis) {
    const btn = li.querySelector(":scope > div > button[aria-expanded]");
    const evidence = li.querySelector(":scope > p.italic");
    const lines = [...li.querySelectorAll(":scope > ol > li")].map((l) => ({ href: l.querySelector("a")?.getAttribute("href"), opening: one(l.querySelector("a")), gist: one(l.querySelector("[role=note]")) || null }));
    out.push({ heading: one(li.querySelector(":scope > div > a")), expanded: btn ? btn.getAttribute("aria-expanded") : null, label: btn ? btn.getAttribute("aria-label") : null, evidence: evidence ? one(evidence) : null, lines });
  }
  return out;
});
M.push("");
M.push("--- every row expanded (each '+' clicked): the paragraph-opening lines under the row ---");
expanded.forEach((r, i) => {
  M.push(`${String(i + 1).padStart(2)}. ${r.heading}${r.expanded === null ? " (not foldable)" : ` [aria-expanded=${r.expanded}; aria-label: ${r.label}]`}`);
  if (r.evidence) M.push(`    evidence: ${r.evidence}`);
  r.lines.forEach((l) => M.push(`      - (${l.href}) ${l.opening}${l.gist ? "   «gist» " + l.gist : ""}`));
});
fs.writeFileSync(R + "/map.txt", M.join("\n") + "\n");
// fold them back
await page.evaluate(() => { for (const b of document.querySelectorAll("section[aria-label='Map'] > div > ol > li > div > button[aria-expanded='true']")) b.click(); });
await page.waitForTimeout(500);

// 4. the top: the panel above the tabs (plate, title, decision block, DOI, private-PDF line)
const top = await page.evaluate(() => {
  const T = (e) => (e ? (e.innerText ?? "") : "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
  const one = (e) => T(e).replace(/\s+/g, " ").trim();
  const panel = document.querySelector("[data-reader-panel]");
  const header = panel?.querySelector("header");
  const plate = panel?.querySelector("figure");
  const decision = header?.nextElementSibling;
  const tablist = panel?.querySelector("[role=tablist]");
  const between = [];
  for (let e = header?.nextElementSibling; e && e !== tablist; e = e.nextElementSibling) between.push(e);
  const commands = decision ? [...decision.querySelectorAll("button, a")].filter((b) => !b.closest("[role=tablist]")).map((b) => ({ tag: b.tagName, text: one(b), aria: b.getAttribute("aria-label"), title: b.getAttribute("title"), href: b.getAttribute("href"), disabled: b.disabled ?? false, kbd: b.querySelector("kbd") ? one(b.querySelector("kbd")) : null })) : [];
  const sentence = decision ? [...decision.querySelectorAll("p")].map((p) => one(p)) : [];
  const doi = decision?.querySelector("a[href^='https://doi.org/']");
  const priv = [...(decision?.querySelectorAll("p") || [])].find((p) => /Private PDF/.test(p.textContent || ""));
  return {
    panelFound: !!panel,
    plate: plate ? { text: T(plate), caption: one(plate.querySelector("figcaption")), hasImg: !!plate.querySelector("img") } : null,
    header: { text: T(header), meta: one(header?.querySelector("p.annotation")), title: one(header?.querySelector("h1")), authorsLine: one(header?.querySelector("h1 + div p")), authorsButton: header?.querySelector("button") ? one(header.querySelector("button")) : null, affiliation: one(header?.querySelector("h1 + div p + p")) },
    decision: { text: T(decision), commands, paragraphs: sentence, doi: doi ? { text: one(doi), href: doi.getAttribute("href") } : null, privatePdf: priv ? one(priv.parentElement) : null },
    betweenCount: between.length,
    tabs: [...document.querySelectorAll("[role=tab]")].map((t) => one(t) + " (selected=" + t.getAttribute("aria-selected") + ")"),
    terms: (() => { const s = [...document.querySelectorAll("section")].find((x) => /Terms to know/.test(x.querySelector(".eyebrow, h2, p")?.textContent || "") && panel?.contains(x)); return s ? T(s) : null; })(),
  };
});
if (!top.panelFound) note("no [data-reader-panel] at 1440 (the spread did not apply)");
// the authors, opened
let authorsOpened = null;
if (top.header.authorsButton) {
  await page.locator("[data-reader-panel] header button").first().click();
  await page.waitForTimeout(400);
  authorsOpened = await page.evaluate(() => (document.querySelector("[data-reader-panel] header h1 + div p")?.innerText || "").replace(/\s+/g, " ").trim());
  await page.locator("[data-reader-panel] header button").first().click();
  await page.waitForTimeout(300);
}
await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(500);
await page.screenshot({ path: R + "/shots/digestion-1440.png", fullPage: true });

// 5. the Summary tab: the abstract band (expanded) and the whole panel
await page.getByRole("tab", { name: "Summary" }).click();
await page.waitForTimeout(2000);
const abstractBtn = page.locator("#reader-tabpanel button[aria-controls='abstract-panel']").first();
let abstractOut = null;
if (await abstractBtn.count()) {
  const before = await abstractBtn.getAttribute("aria-expanded");
  if (before !== "true") await abstractBtn.click();
  await page.waitForTimeout(800);
  abstractOut = await page.evaluate(() => {
    const T = (e) => (e ? (e.innerText ?? "") : "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{2,}/g, "\n").trim();
    const btn = document.querySelector("#reader-tabpanel button[aria-controls='abstract-panel']");
    const sec = btn?.closest("section");
    const panel = document.getElementById("abstract-panel");
    const lead = sec?.previousElementSibling;
    return { label: T(btn), expanded: btn?.getAttribute("aria-expanded"), panel: T(panel), paragraphs: [...(panel?.querySelectorAll("p") || [])].map((p) => T(p)), inked: [...(panel?.querySelectorAll("mark") || [])].map((m) => T(m)), lead: lead ? T(lead) : null, leadTag: lead?.tagName };
  });
} else note("no Abstract toggle found on the Summary tab");
const summaryText = await page.evaluate(() => {
  const T = (e) => (e ? (e.innerText ?? "") : "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  const common = document.getElementById("reader-common");
  const panel = document.getElementById("reader-tabpanel");
  const col = panel?.parentElement;
  const next = col ? [...col.children].filter((c) => c !== common && c !== panel).map((c) => T(c)).filter(Boolean) : [];
  const bands = panel ? [...panel.querySelectorAll("section")].filter((s) => !s.closest("section section")).map((s) => ({ label: s.getAttribute("aria-label") || (s.querySelector(".eyebrow, h2")?.textContent || "").trim().slice(0, 60), h: Math.round(s.getBoundingClientRect().height) })) : [];
  return { common: T(common), panel: T(panel), after: next, bands, tabs: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim() + ":" + t.getAttribute("aria-selected")) };
});
await page.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
await page.waitForTimeout(500);
await page.screenshot({ path: R + "/shots/summary-1440.png", fullPage: true });
// the common block as seen on the digestion tab too (same node); read it once more there
await page.getByRole("tab", { name: "Paper digestion" }).click();
await page.waitForTimeout(800);

// top.txt
const TP = [];
TP.push("TOP OF THE PAGE — everything above the tabs, as rendered at 1440x1000, no key (Tier 0). Source: the DOM's innerText.");
TP.push("");
TP.push("[PLATE]" + (top.plate ? (top.plate.hasImg ? " (image plate)" : " (typographic plate, no image)") : " (none)"));
if (top.plate) { TP.push(top.plate.text); if (top.plate.caption) TP.push("caption: " + top.plate.caption); }
TP.push("");
TP.push("[TITLE BLOCK]");
TP.push("meta line: " + (top.header.meta || "(none)"));
TP.push("title: " + top.header.title);
TP.push("authors line (as first rendered): " + (top.header.authorsLine || "(none)") + (top.header.authorsButton ? `   [button: ${top.header.authorsButton}]` : ""));
if (authorsOpened !== null) TP.push("authors line (button clicked): " + authorsOpened);
TP.push("affiliation line: " + (top.header.affiliation || "(none)"));
TP.push("header innerText verbatim:");
TP.push(top.header.text);
TP.push("");
TP.push("[DECISION BLOCK]");
TP.push("commands row (buttons/links in order): " + top.decision.commands.map((c) => `${c.tag.toLowerCase()}«${c.text}»${c.kbd ? "" : ""}${c.aria ? ` aria-label="${c.aria}"` : ""}${c.title ? ` title="${c.title}"` : ""}${c.href ? ` href=${c.href.replace(/\/papers\/[^/]+/, "/papers/<id>")}` : ""}${c.disabled ? " DISABLED" : ""}`).join("  ·  "));
top.decision.paragraphs.forEach((p, i) => TP.push(`paragraph ${i + 1}: ${p}`));
TP.push("DOI line: " + (top.decision.doi ? `${top.decision.doi.text}  → ${top.decision.doi.href}` : "(no DOI link rendered)"));
TP.push("private-PDF line: " + (top.decision.privatePdf || "(none)"));
TP.push("decision block innerText verbatim:");
TP.push(top.decision.text);
TP.push("");
TP.push("[TABS] " + top.tabs.join(" | "));
TP.push("");
TP.push("[ABSTRACT BAND] — on this build the abstract band is NOT above the tabs: it renders on the Summary tab (the Paper digestion tab has the map and the body instead). Read there, with the band clicked open.");
if (abstractOut) {
  if (abstractOut.lead) TP.push(`above the band (${abstractOut.leadTag?.toLowerCase()}): ${abstractOut.lead}`);
  TP.push(`band label: ${abstractOut.label}   (aria-expanded after click: ${abstractOut.expanded})`);
  TP.push("band contents, expanded:");
  abstractOut.paragraphs.forEach((p, i) => TP.push(`  paragraph ${i + 1}: ${p}`));
  TP.push("  footer / rest: " + abstractOut.panel.split("\n").filter((l) => !abstractOut.paragraphs.some((p) => p.includes(l.trim()) && l.trim().length > 20)).join(" ⏎ "));
  TP.push("  sentences set in ink (<mark>): " + (abstractOut.inked.length ? abstractOut.inked.map((m) => `«${m}»`).join("  ") : "(none)"));
}
TP.push("");
TP.push("[BELOW THE TABS, still in the left panel — Terms to know] (for context only; not asked for)");
TP.push(top.terms || "(none)");
fs.writeFileSync(R + "/top.txt", TP.join("\n") + "\n");

// summary.txt
const S = [];
S.push("SUMMARY TAB — NOT TO BE JUDGED FOR WORDING. Whatever model text a report would carry is the stub's canned text, tuned for another paper; and on this run NO key is set, so no model ran at all: the tab shows Tier 0 only (the paper's abstract and Peer's no-model blocks). Judge layout/presence only, never the sentences.");
S.push("");
S.push("tabs: " + summaryText.tabs.join(" | "));
S.push("bands in the tabpanel (label | height px): " + summaryText.bands.map((b) => `${b.label} | ${b.h}`).join("  ·  "));
S.push("");
S.push("[#reader-common — the blocks both tabs share, above the tabpanel]");
S.push(summaryText.common || "(none)");
S.push("");
S.push("[#reader-tabpanel — the Summary tab's blocks, abstract band expanded]");
S.push(summaryText.panel || "(empty)");
S.push("");
S.push("[after the tabpanel in the column]");
S.push(summaryText.after.join("\n---\n") || "(none)");
fs.writeFileSync(R + "/summary.txt", S.join("\n") + "\n");

// 6. the phone: a fresh context with the same storage, the paper page, full-page screenshot
await browser.close();
{
  const { browser: b2, ctx: c2 } = await (async () => {
    const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium", args: ["--no-sandbox"] });
    const c = await b.newContext({ viewport: { width: 390, height: 844 }, colorScheme: "light", hasTouch: true, isMobile: true, storageState: R + "/state.json" });
    await c.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, (route) => { const u = route.request().url(); if (u.startsWith("data:") || u.startsWith("blob:")) return route.continue(); try { blocked.add(new URL(u).hostname); } catch {} return route.abort(); });
    return { browser: b, ctx: c };
  })();
  const p2 = await c2.newPage();
  watch(p2, "phone");
  await p2.goto(paperUrl, { waitUntil: "domcontentloaded", timeout: 180000 });
  await p2.waitForSelector("#paper-body", { timeout: 180000 });
  try { await p2.waitForLoadState("networkidle", { timeout: 20000 }); } catch {}
  await p2.waitForTimeout(3000);
  const phone = await p2.evaluate(() => ({ tabs: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim() + ":" + t.getAttribute("aria-selected")), hScroll: document.documentElement.scrollWidth > innerWidth, scrollWidth: document.documentElement.scrollWidth, sections: document.querySelectorAll("#paper-body section").length, mapShown: (() => { const s = document.querySelector("section[aria-label='Map']"); const b = s && [...s.querySelectorAll("button")].find((x) => /show map|hide map/i.test(x.textContent)); return b ? b.textContent.trim() : null; })() }));
  if (phone.hScroll) note(`phone: horizontal page scroll (scrollWidth ${phone.scrollWidth} > 390)`);
  if (!phone.tabs.some((t) => /Paper digestion:true/.test(t))) note("phone: default tab is not Paper digestion: " + phone.tabs.join(" | "));
  await p2.evaluate(() => scrollTo({ top: 0, behavior: "instant" }));
  await p2.waitForTimeout(400);
  await p2.screenshot({ path: R + "/shots/digestion-390.png", fullPage: true });
  await b2.close();
  fs.writeFileSync(R + "/phone.json", JSON.stringify(phone));
}

const counts = { sections: dump.sections.length, paragraphs: nPara, equations: nEq, captions: nCap, mapRows: dump.mapRowCount, chars: whole.length };
const result = { uploadMs, counts, katexSpans: dump.katex, bandLabel: dump.bandLabel, tabs, blockedHosts: [...blocked], notes, abstractExpanded: abstractOut?.expanded ?? null, abstractParas: abstractOut?.paragraphs.length ?? 0, summaryBands: summaryText.bands.map((b) => b.label), commandCount: top.decision.commands.length, doiRendered: !!top.decision.doi, privateLine: !!top.decision.privatePdf, sectionsWithRole: dump.sections.filter((s) => s.role !== "?").length, equationsWithNumber: dump.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "eq" && b.number).length, figuresWithImage: dump.sections.flatMap((s) => s.blocks).filter((b) => b.kind === "fig" && b.hasImage).length };
fs.writeFileSync(R + "/result.json", JSON.stringify(result, null, 1));
console.log(JSON.stringify(result, null, 1));
