// P12-57 — the keyed harness (round P12, Theme C1). Drives the real UI with the owner's Gemini test key:
//   Profile -> provider Gemini, key filled from the environment, Deep report on  ->  upload a paper by path  ->
//   the reading page  ->  dump the reading map's rows as the page shows them  ->  record every /api/ answer
//   (status, time, shape; never a request body, never paper text)  ->  probe the structure route.
//
// Usage: PORT=4244 PEER_TEST_PDF=<pdf> OUT_DIR=<dir> TAG=P1 node keyed.mjs
//   optional: PROFILE_ONLY=0|1 (default 0), WAIT_GUIDE_MS (default 180000), WAIT_REPORT_MS (default 300000),
//             REUSE_PAPER_URL=<url> (open an already-uploaded paper instead of uploading; same fresh profile steps)
//
// The key: read ONLY as process.env.PEER_TEST_GEMINI_API_KEY, in `page.fill` and in `scrub` (which redacts any
// echo of it from everything this script writes and counts the echoes). It is never printed, logged, written,
// screenshotted; no storage state is saved (it would hold the key); no screenshot is taken of the Profile.
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 4244);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT_DIR;
const PDF = process.env.PEER_TEST_PDF;
const TAG = process.env.TAG || "paper";
const WAIT_GUIDE_MS = Number(process.env.WAIT_GUIDE_MS || 180000);
const WAIT_REPORT_MS = Number(process.env.WAIT_REPORT_MS || 300000);
const REUSE_PAPER_URL = process.env.REUSE_PAPER_URL || "";
if (!OUT) { console.error("OUT_DIR is required"); process.exit(2); }
if (!PDF && !REUSE_PAPER_URL) { console.error("PEER_TEST_PDF (a PDF path) is required"); process.exit(2); }
const KEY = process.env.PEER_TEST_GEMINI_API_KEY || "";
if (!KEY) { console.error("PEER_TEST_GEMINI_API_KEY is not set"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

// ---- scrubbing: nothing leaves this process with the key in it; the echoes are counted (count only) ----
let echoes = 0;
function scrub(s) {
  if (typeof s !== "string") return s;
  if (!s.includes(KEY)) return s;
  const parts = s.split(KEY);
  echoes += parts.length - 1;
  return parts.join("[KEY]");
}
const cap = (s, n) => scrub(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, n);

const notes = [];
const note = (s) => { const t = cap(s, 300); notes.push(t); console.error("[note] " + t); };
const consoleLines = [];
const blockedHosts = new Set();
let keyToNonLocal = 0; // requests to a non-local host that carried the key in the URL or in a header (count only)
let stopReason = null; // set when Google answers 429 / quota / billing / permission: stop at once
const QUOTA_RE = /\b429\b|RESOURCE_EXHAUSTED|PERMISSION_DENIED|quota|billing/i;

const t0wall = Date.now();
let tUpload = null; // the "Upload PDF" click
const since = () => (tUpload == null ? null : Date.now() - tUpload);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light", acceptDownloads: true });
await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, async (route) => {
  const req = route.request();
  const u = req.url();
  if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return route.continue();
  try {
    const hdrs = Object.values(req.headers()).join("\n");
    if (u.includes(KEY) || hdrs.includes(KEY) || decodeURIComponent(u).includes(KEY)) keyToNonLocal++;
    blockedHosts.add(new URL(u).hostname);
  } catch {}
  return route.abort();
});
const page = await ctx.newPage();
page.on("pageerror", (e) => note("pageerror: " + e.message));
page.on("console", (m) => {
  const line = `${m.type()}: ${cap(m.text(), 240)}`;
  consoleLines.push(line);
  if (m.type() === "error") note("console.error: " + m.text());
});

// ---- the /api/ ledger: method, normalised path, status, start/end offsets, shape. No request bodies. ----
const api = [];
const reqStart = new Map();
const normPath = (u) => {
  try {
    return new URL(u).pathname
      .replace(/\/papers\/(?!report(\/|$)|upload(\/|$)|upload-availability(\/|$)|search(\/|$))[^/]+/, "/papers/<id>")
      .replace(/\/papers\/upload\/[^/]+/, "/papers/upload/<id>");
  } catch { return "?"; }
};
const MODEL_ROUTE = /\/api\/papers\/(report|[^/]+\/(paragraph-guide|structure|explain|plain))(\?|$)/;
const inflight = new Set();
let lastModelEventAt = 0;
const seenKinds = new Set();
page.on("request", (r) => {
  if (!/\/api\//.test(r.url())) return;
  reqStart.set(r, Date.now());
  if (r.method() === "POST" && MODEL_ROUTE.test(new URL(r.url()).pathname + new URL(r.url()).search)) { inflight.add(r); lastModelEventAt = Date.now(); seenKinds.add(normPath(r.url()).split("/").pop()); }
});
const entryOf = new Map();
const settleReq = (r) => {
  if (inflight.delete(r)) lastModelEventAt = Date.now();
  const e = entryOf.get(r);
  if (e && e.finishedMs == null) { e.finishedMs = Date.now() - (reqStart.get(r) ?? Date.now()); if (e.durMs == null) e.durMs = e.finishedMs; }
};
page.on("requestfinished", settleReq);
page.on("requestfailed", (r) => { settleReq(r); if (/\/api\//.test(r.url())) api.push({ method: r.method(), path: normPath(r.url()), failed: cap(r.failure()?.errorText, 80) }); });
page.on("response", async (resp) => {
  const url = resp.url();
  if (!/\/api\//.test(url)) return;
  const r = resp.request();
  const startedAt = reqStart.get(r) ?? Date.now();
  const entry = { method: r.method(), path: normPath(url), status: resp.status(), tStartMs: tUpload == null ? null : startedAt - tUpload, durMs: null, shape: null };
  api.push(entry);
  entryOf.set(r, entry);
  const p = entry.path;
  const interesting = /\/(paragraph-guide|report|structure|reading|explain|plain)$/.test(p);
  if (!interesting && resp.status() < 400) return;
  try {
    const text = await resp.text();
    entry.durMs = Date.now() - startedAt;
    entry.bytes = text.length;
    if (QUOTA_RE.test(text) && resp.status() >= 400) { stopReason = `${p} answered ${resp.status()} with a quota / permission / billing marker`; }
    if (/\/api\/papers\/report$/.test(url)) {
      // NDJSON stream: record events' types, stage ids, errors; never the report's text.
      const events = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const rep = events.find((e) => e.type === "report")?.report;
      entry.shape = {
        events: events.map((e) => e.type).join(","),
        aiMode: events.find((e) => e.type === "mode")?.aiMode ?? null,
        stages: events.filter((e) => e.type === "stage").map((e) => `${e.stage}:${e.pct}`).join(","),
        errors: events.filter((e) => e.type === "error").map((e) => cap(e.message, 200)),
        reportKeys: rep ? Object.keys(rep).sort().join(",") : null,
      };
      if (events.some((e) => e.type === "error" && QUOTA_RE.test(String(e.message)))) stopReason = "the report stream carried an error with a quota / permission / billing marker";
      if (QUOTA_RE.test(text) && !stopReason && /RESOURCE_EXHAUSTED|PERMISSION_DENIED/.test(text)) stopReason = "the report stream mentions RESOURCE_EXHAUSTED / PERMISSION_DENIED";
    } else {
      let j = null;
      try { j = JSON.parse(text); } catch {}
      if (j && typeof j === "object") {
        const shape = { keys: Object.keys(j).sort().join(",") };
        if (j.error) shape.error = cap(typeof j.error === "string" ? j.error : JSON.stringify(j.error), 200);
        if (j.skipped != null) shape.skipped = cap(JSON.stringify(j.skipped), 80);
        const g = j.guide;
        if (g && typeof g === "object") {
          const gists = g.gists && typeof g.gists === "object" ? g.gists : {};
          shape.guide = {
            gistSections: Object.keys(gists).length,
            gistCount: Object.values(gists).reduce((n, s) => n + (s && typeof s === "object" ? Object.keys(s).length : 0), 0),
            hasPartition: !!g.partition,
            partitionParts: Array.isArray(g.partition?.parts) ? g.partition.parts.length : Array.isArray(g.partition) ? g.partition.length : null,
          };
        }
        entry.shape = shape;
        if (QUOTA_RE.test(text) && resp.status() >= 400) stopReason = `${p} answered ${resp.status()} (${cap(shape.error, 100)})`;
      } else {
        entry.shape = { nonJson: cap(text, 120) };
      }
    }
  } catch (e) {
    entry.shape = { readError: cap(e.message, 100) };
  }
});

const navTrace = [];
page.on("framenavigated", (f) => { if (f === page.mainFrame()) { try { navTrace.push({ tMs: tUpload == null ? null : Date.now() - tUpload, path: new URL(f.url()).pathname.replace(/\/papers\/[^/]+/, "/papers/<id>") }); } catch {} } });
const profileSteps = {};
let paperUrl = null;
const timing = {};
const mark = (k) => { timing[k] = since(); };

try {
  // ---- 1. first visit: skip the walkthrough ----
  await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
  for (let i = 0; i < 300; i++) {
    if (/\/welcome/.test(page.url())) break;
    if (await page.locator("button[aria-label='Upload a paper PDF']").count()) break;
    await page.waitForTimeout(100);
  }
  if (/\/welcome/.test(page.url())) {
    const skip = page.getByText("Skip setup").first();
    await skip.waitFor({ timeout: 60000 });
    await skip.click();
    await page.waitForURL((u) => !/\/welcome/.test(u.pathname), { timeout: 60000 });
  }

  // ---- 2. Profile -> Edit: Gemini, the key (from the environment), Deep report on, Done ----
  await page.goto(BASE + "/profile", { waitUntil: "domcontentloaded", timeout: 240000 });
  // the page may reload once while the dev server compiles; click Edit until the provider select is there
  {
    let seen = false;
    for (let attempt = 0; attempt < 30 && !seen; attempt++) {
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      if (await edit.count()) { try { await edit.click({ timeout: 20000 }); } catch {} }
      try { await page.waitForSelector("#profile-ai-provider", { timeout: 15000 }); seen = true; } catch {}
    }
    if (!seen) throw new Error("the Profile edit form (provider select) never appeared");
  }
  await page.selectOption("#profile-ai-provider", "gemini", { timeout: 120000 });
  await page.waitForSelector("#profile-ai-key", { timeout: 120000 });
  await page.fill("#profile-ai-key", KEY, { timeout: 120000 });
  const sw = page.getByRole("switch", { name: "Deep report" });
  await sw.waitFor({ timeout: 120000 });
  // the switch is disabled until the sign-in check answers (a local copy with no sign-in is "unconfigured": allowed)
  for (let i = 0; i < 1200 && (await sw.isDisabled()); i++) await page.waitForTimeout(100);
  profileSteps.switchEnabled = !(await sw.isDisabled());
  if (profileSteps.switchEnabled && (await sw.getAttribute("aria-checked")) !== "true") await sw.click();
  profileSteps.switchOn = (await sw.getAttribute("aria-checked")) === "true";
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await page.waitForTimeout(800);
  const view = await page.evaluate((k) => {
    const body = document.body.innerText || "";
    let st = {};
    try { const o = JSON.parse(localStorage.getItem("peer-profile") || "{}"); st = (o.state || {}).profile || {}; } catch {}
    const lines = body.split("\n").filter((l) => /key saved on this device|Gemini/i.test(l)).map((l) => l.trim().slice(0, 120));
    return {
      lines,
      bodyHasKey: k ? body.includes(k) : false,
      storedProvider: st.feedAiProvider ?? null,
      storedKeyPresent: typeof st.feedAiApiKey === "string" && st.feedAiApiKey.length > 0,
      storedKeyEqualsEnv: typeof st.feedAiApiKey === "string" && st.feedAiApiKey === k,
      storedDeepReport: st.deepReportEnabled ?? null,
    };
  }, KEY);
  profileSteps.viewLine = view.lines.map((l) => cap(l, 120));
  profileSteps.storedProvider = view.storedProvider;
  profileSteps.storedKeyPresent = view.storedKeyPresent;
  profileSteps.storedKeyEqualsEnv = view.storedKeyEqualsEnv;
  profileSteps.storedDeepReport = view.storedDeepReport;
  profileSteps.keyInVisibleText = view.bodyHasKey; // must be false (the view prints no part of the key)
  if (view.bodyHasKey) echoes++;

  // ---- 3. the paper: upload by path through the real UI ----
  if (REUSE_PAPER_URL) {
    tUpload = Date.now();
    await page.goto(REUSE_PAPER_URL, { waitUntil: "domcontentloaded", timeout: 240000 });
    paperUrl = page.url();
  } else {
    await page.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 240000 });
    await page.waitForSelector("button[aria-label='Upload a paper PDF']", { timeout: 90000 });
    await page.waitForTimeout(1500);
    const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("button[aria-label='Upload a paper PDF']")]);
    await chooser.setFiles(PDF);
    await page.waitForSelector("dialog[open]", { timeout: 15000 });
    await page.locator("dialog[open] label input[type=checkbox]").first().check();
    await page.getByRole("button", { name: "Upload PDF" }).click();
    tUpload = Date.now();
    for (let i = 0; i < 960; i++) { await page.waitForTimeout(250); if (/\/papers\//.test(page.url())) break; if (stopReason) break; }
    paperUrl = page.url();
    mark("navigatedToPaperMs");
    if (!/\/papers\//.test(paperUrl)) {
      note("upload never navigated to a paper page");
      const alert = await page.evaluate(() => document.querySelector("[role=alert]")?.textContent ?? null);
      if (alert) note("alert after upload: " + alert);
    }
  }
  {
    const hb = setInterval(async () => {
      try {
        const st = await page.evaluate(() => ({ url: location.pathname.replace(/\/papers\/[^/]+/, "/papers/<id>"), body: !!document.getElementById("paper-body"), tabs: document.querySelectorAll("[role=tab]").length, h1: (document.querySelector("h1")?.textContent || "").slice(0, 40).length }));
        console.error("[hb]", since(), JSON.stringify(st), "api:" + api.length);
      } catch {}
    }, 30000);
    try { await page.waitForSelector("#paper-body", { timeout: 300000 }); } finally { clearInterval(hb); }
  }
  mark("bodyMs");
  await page.addStyleTag({ content: ".katex-mathml{display:none!important}" });
  await page.waitForTimeout(2500);

  // the reading map's rows, as the page shows them
  const dumpRows = () => page.evaluate(() => {
    const T = (e) => (e ? (e.innerText ?? e.textContent ?? "") : "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    const mapSec = document.querySelector("section[aria-label='Map']");
    const body = document.getElementById("paper-body");
    const rows = mapSec ? [...mapSec.querySelectorAll(":scope > div > ol > li")].map((li, i) => {
      const head = li.querySelector(":scope > div");
      const a = head.querySelector("a");
      const part = (n) => { const e = li.querySelector(":scope > div [data-meta-part='" + n + "']"); return e ? T(e) : null; };
      const role = part("role"), page = part("page"), words = part("words"), minutes = part("minutes");
      const href = a?.getAttribute("href") || null;
      const sec = href && body ? body.querySelector(href.replace(/^#/, "#")) : null;
      // the section's paragraphs in the body, as the reader sees them (Tier-0 ordinals): a <p> inside a host paper-section-<k>-p<n>
      const paras = sec ? [...sec.querySelectorAll("[id^='" + sec.id + "-p']")].filter((h) => /^paper-section-\d+-p\d+$/.test(h.id)) : [];
      const first = paras[0] ? T(paras[0].querySelector("p") || paras[0]) : null;
      return {
        i: i + 1,
        heading: T(a),
        role,
        level: Number(li.getAttribute("data-level")) || null,
        firstParagraph60: first ? first.slice(0, 60) : null,
        secondParagraph60: paras[1] ? T(paras[1].querySelector("p") || paras[1]).slice(0, 60) : null,
        bodyHeading: sec ? T(sec.querySelector(":scope > h3")).slice(0, 60) : null,
        paragraphs: paras.length,
        page, words, minutes,
        href,
        route: head.getAttribute("data-route"),
        foldable: !!head.querySelector("button"),
      };
    }) : [];
    const allParas = body ? [...body.querySelectorAll("[id]")].filter((h) => /^paper-section-\d+-p\d+$/.test(h.id)).length : 0;
    return { summaryLine: mapSec ? T(mapSec.querySelector("p.annotation span")) : null, rows, totalParagraphs: allParas, partitionTag: mapSec ? [...mapSec.querySelectorAll("*")].filter((e) => e.children.length === 0 && /Peer's reading/.test(e.textContent || "")).length : 0 };
  });
  const rowsInitial = await dumpRows();
  fs.writeFileSync(`${OUT}/rows-initial.json`, JSON.stringify(rowsInitial, null, 1));
  mark("rowsInitialMs");

  // ---- 4. wait for the keyed calls to settle: the gist call, the report stream ----
  const has = (re) => api.find((a) => re.test(a.path) && a.method === "POST");
  const bodyAt = Date.now();
  const endAll = bodyAt + Math.max(WAIT_GUIDE_MS, WAIT_REPORT_MS);
  // settled: the gist call and the report were both seen (or 90 s passed since the body), nothing model-backed is in flight,
  // and 8 s went by since the last such event (so the page had time to draw what came back)
  for (;;) {
    if (stopReason) break;
    const now = Date.now();
    if (now > endAll) break;
    const bothSeen = seenKinds.has("paragraph-guide") && seenKinds.has("report");
    if (inflight.size === 0 && (bothSeen || now > bodyAt + 90000) && now - lastModelEventAt > 8000 && now > bodyAt + 15000) break;
    await page.waitForTimeout(1000);
  }
  const g = has(/\/paragraph-guide$/), r = has(/\/api\/papers\/report$/);
  if (g?.durMs != null) timing.guideAnsweredMs = g.tStartMs + g.durMs;
  if (r?.durMs != null) timing.reportDoneMs = r.tStartMs + r.durMs;
  await page.waitForTimeout(3000); // let the page draw the gists / the model's blocks
  mark("settledMs");

  const rowsFinal = await dumpRows();
  // expand every foldable row; count the gist lines the map draws (model text; counted, not stored)
  const gistsOnPage = await page.evaluate(async () => {
    const lis = [...document.querySelectorAll("section[aria-label='Map'] > div > ol > li")];
    for (const li of lis) { const b = li.querySelector(":scope > div > button[aria-expanded]"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); }
    await new Promise((r) => setTimeout(r, 800));
    const per = lis.map((li) => { const first = li.querySelector(":scope > ol > li > a"); return { lines: li.querySelectorAll(":scope > ol > li").length, gists: li.querySelectorAll(":scope > ol > li [role=note]").length, firstLine60: first ? (first.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60) : null }; });
    return { perRow: per, rowsWithGist: per.filter((p) => p.gists > 0).length, gistLines: per.reduce((n, p) => n + p.gists, 0), paragraphLines: per.reduce((n, p) => n + p.lines, 0), legend: !!document.querySelector("section[aria-label='Map'] p.annotation.mt-1") };
  });
  rowsFinal.rows.forEach((row, i) => { const m = gistsOnPage.perRow?.[i]; if (m) { row.mapLines = m.lines; row.mapGists = m.gists; row.mapFirstLine60 = m.firstLine60; } });
  fs.writeFileSync(`${OUT}/rows-final.json`, JSON.stringify(rowsFinal, null, 1));
  const rowsChanged = JSON.stringify(rowsInitial.rows.map((x) => [x.heading, x.role, x.level, x.firstParagraph60])) !== JSON.stringify(rowsFinal.rows.map((x) => [x.heading, x.role, x.level, x.firstParagraph60]));
  await page.evaluate(() => { for (const b of document.querySelectorAll("section[aria-label='Map'] > div > ol > li > div > button[aria-expanded='true']")) b.click(); });

  // ---- 5. the Summary tab: bands, banners, the decision block ----
  await page.getByRole("tab", { name: "Summary" }).click();
  await page.waitForTimeout(2500);
  const summary = await page.evaluate(() => {
    const T = (e) => (e ? (e.innerText ?? "") : "").replace(/\s+/g, " ").trim();
    const panel = document.getElementById("reader-tabpanel");
    const bands = panel ? [...panel.querySelectorAll("section")].filter((s) => !s.closest("section section")).map((s) => (s.getAttribute("aria-label") || T(s.querySelector(".eyebrow, h2")) || "").slice(0, 60)) : [];
    const alerts = [...document.querySelectorAll("[role=alert]")].map((a) => T(a).slice(0, 200));
    const tabs = [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim() + ":" + t.getAttribute("aria-selected"));
    const common = document.getElementById("reader-common");
    return { bands, alerts, tabs, decision: T(common).slice(0, 400), panelChars: T(panel).length };
  });
  summary.alerts = summary.alerts.map((a) => cap(a, 200));
  summary.decision = cap(summary.decision, 400);
  await page.getByRole("tab", { name: "Paper digestion" }).click().catch(() => {});

  // ---- 6. the structure route (the Tier-1 review): probe with an empty body (no key); the page itself calls it when it exists ----
  let structure = { probe: null };
  if (paperUrl) {
    const id = decodeURIComponent((paperUrl.match(/\/papers\/([^/?#]+)/) || [])[1] || "");
    try {
      const resp = await page.request.post(`${BASE}/api/papers/${encodeURIComponent(id)}/structure`, { data: {}, headers: { "Content-Type": "application/json" }, timeout: 30000 });
      structure = { probe: resp.status(), answer: resp.status() === 404 ? "absent" : "present (status " + resp.status() + ")", contentType: resp.headers()["content-type"] || null };
    } catch (e) { structure = { probe: "error", answer: cap(e.message, 100) }; }
  }
  const structureCalledByPage = api.filter((a) => /\/structure$/.test(a.path) && a.method === "POST" && a.status !== 404).length;

  const result = {
    tag: TAG,
    base: BASE,
    wallTotalMs: Date.now() - t0wall,
    timing,
    profile: profileSteps,
    paper: { url: paperUrl ? paperUrl.replace(/\/papers\/[^/?#]+/, "/papers/<id>") : null, rows: rowsFinal.rows.length, rowsInitial: rowsInitial.rows.length, rowsChangedBetweenDumps: rowsChanged, totalParagraphs: rowsFinal.totalParagraphs, summaryLine: cap(rowsFinal.summaryLine, 160), partitionTagCount: rowsFinal.partitionTag },
    gistsOnPage: { ...gistsOnPage, perRow: undefined },
    summary,
    structure: { ...structure, calledByPage: structureCalledByPage },
    api: api.map((a) => ({ ...a })),
    blockedHosts: [...blockedHosts],
    keyToNonLocalRequests: keyToNonLocal,
    stopReason,
    echoesOfKeyScrubbed: echoes,
    notes,
    navTrace,
  };
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 1));
  fs.writeFileSync(`${OUT}/console.log`, consoleLines.join("\n") + "\n");
  console.log(JSON.stringify({ ...result, api: result.api.map((a) => `${a.method} ${a.path} ${a.status ?? a.failed} t=${a.tStartMs} dur=${a.durMs}`) }, null, 1));
} catch (e) {
  note("harness error: " + e.message);
  try {
    // a snapshot of where the page stood (only on a paper page; never the Profile): text head, tabs, storage key NAMES
    if (!/\/profile/.test(page.url())) {
      const st = await page.evaluate(() => ({
        text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 700),
        tabs: [...document.querySelectorAll("[role=tab]")].map((t) => t.textContent.trim() + ":" + t.getAttribute("aria-selected")),
        statuses: [...document.querySelectorAll("[role=status],[role=alert],[aria-busy=true]")].map((x) => (x.innerText || "").replace(/\s+/g, " ").slice(0, 160)),
        storageNames: Object.keys(localStorage), url: location.pathname.replace(/\/papers\/[^/]+/, "/papers/<id>"),
        hasBody: !!document.getElementById("paper-body"),
      }));
      st.text = cap(st.text, 700); st.statuses = st.statuses.map((x) => cap(x, 160));
      fs.writeFileSync(`${OUT}/fail-state.json`, JSON.stringify(st, null, 1));
      await page.screenshot({ path: `${OUT}/fail.png` });
    }
  } catch {}
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ tag: TAG, error: cap(e.message, 300), timing, profile: profileSteps, api, notes, stopReason, echoesOfKeyScrubbed: echoes, keyToNonLocalRequests: keyToNonLocal, navTrace }, null, 1));
  fs.writeFileSync(`${OUT}/console.log`, consoleLines.join("\n") + "\n");
  console.error("FAILED: " + cap(e.message, 300));
  process.exitCode = 1;
} finally {
  await browser.close();
}
