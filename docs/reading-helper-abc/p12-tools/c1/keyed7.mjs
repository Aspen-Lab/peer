// P12-57 phase 7 (§1h.482) — keyed2.mjs unchanged except the sealed dump name: <P>-p7run<k>.json. One run = one fresh context, one upload, one structure review.
//
// Usage: PORT=4244 PEER_TEST_PDF=<pdf> OUT_DIR=<dir> TAG=P1 RUN=1 [DEEP=0|1] [NOKEY=1] [SEALED_DIR=<dir>] node keyed2.mjs
//
// A run: first visit (skip the walkthrough) -> Profile: provider Gemini, the key filled from the environment
// (process.env.PEER_TEST_GEMINI_API_KEY, in page.fill and in `scrub` only), the Deep report switch left as the DEEP
// variable says (default 0: the review runs whenever a key is set, §1h.428 (a)) -> upload the PDF through the UI ->
// the reading page -> dump the map's rows as first drawn (the rules' draft) -> wait for the page to ask for the
// structure review (POST /api/papers/<id>/structure) and for its answer -> wait for the answer to be laid over the map
// -> expand every fold -> dump the map's rows as the page shows them (the reviewed structure).
//
// Never stored: the key, a request body, a screenshot of the Profile, a storage state. The dump holds 80-character
// openings of the paper's paragraphs (scratch only: never committed, never quoted).
import { createRequire } from "node:module";
import fs from "node:fs";
const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const PORT = Number(process.env.PORT || 4244);
const BASE = `http://localhost:${PORT}`;
const OUT = process.env.OUT_DIR;
const PDF = process.env.PEER_TEST_PDF;
const TAG = process.env.TAG || "P?";
const RUN = process.env.RUN || "1";
const DEEP = process.env.DEEP === "1";
const NOKEY = process.env.NOKEY === "1";
const BLOCK_REPORT = process.env.BLOCK_REPORT === "1"; // abort the browser's own POST /api/papers/report (a ceiling measure; the map does not read it)
const SEALED = process.env.SEALED_DIR || "";
const WAIT_STRUCT_MS = Number(process.env.WAIT_STRUCT_MS || 240000);
if (!OUT || !PDF) { console.error("OUT_DIR and PEER_TEST_PDF are required"); process.exit(2); }
const KEY = process.env.PEER_TEST_GEMINI_API_KEY || "";
if (!KEY && !NOKEY) { console.error("PEER_TEST_GEMINI_API_KEY is not set"); process.exit(2); }
fs.mkdirSync(OUT, { recursive: true });

let echoes = 0;
function scrub(s) {
  if (typeof s !== "string" || !KEY || !s.includes(KEY)) return s;
  const parts = s.split(KEY);
  echoes += parts.length - 1;
  return parts.join("[KEY]");
}
const cap = (s, n) => scrub(String(s ?? "")).replace(/\s+/g, " ").trim().slice(0, n);
const notes = [];
const note = (s) => { const t = cap(s, 300); notes.push(t); console.error("[note] " + t); };
const consoleLines = [];
const blockedHosts = new Set();
let keyToNonLocal = 0;
let stopReason = null;
const QUOTA_RE = /\b429\b|RESOURCE_EXHAUSTED|PERMISSION_DENIED|quota|billing/i;

const t0wall = Date.now();
let tUpload = null;
const since = () => (tUpload == null ? null : Date.now() - tUpload);

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: "light" });
await ctx.route(/^(?!https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/).*/, async (route) => {
  const req = route.request();
  const u = req.url();
  if (u.startsWith("data:") || u.startsWith("blob:") || u.startsWith("about:")) return route.continue();
  try {
    const hdrs = Object.values(req.headers()).join("\n");
    if (KEY && (u.includes(KEY) || hdrs.includes(KEY) || decodeURIComponent(u).includes(KEY))) keyToNonLocal++;
    blockedHosts.add(new URL(u).hostname);
  } catch {}
  return route.abort();
});
if (BLOCK_REPORT) await ctx.route(/\/api\/papers\/report(\?|$)/, (route) => route.abort());
const page = await ctx.newPage();
page.on("pageerror", (e) => note("pageerror: " + e.message));
page.on("console", (m) => {
  consoleLines.push(`${m.type()}: ${cap(m.text(), 240)}`);
  if (m.type() === "error") note("console.error: " + m.text());
});

// ---- the /api/ ledger (no request bodies, no paper text) ----
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
let structRequests = 0;
let structure = null; // the /structure answer, reduced to its shape
let structureAnsweredAt = null;
const seenKinds = new Set();
page.on("request", (r) => {
  if (!/\/api\//.test(r.url())) return;
  reqStart.set(r, Date.now());
  const u = new URL(r.url());
  if (r.method() === "POST" && MODEL_ROUTE.test(u.pathname + u.search)) {
    inflight.add(r); lastModelEventAt = Date.now(); seenKinds.add(normPath(r.url()).split("/").pop());
    if (/\/structure$/.test(u.pathname)) structRequests++;
  }
});
const settleReq = (r) => { if (inflight.delete(r)) lastModelEventAt = Date.now(); };
page.on("requestfinished", settleReq);
page.on("requestfailed", (r) => {
  settleReq(r);
  if (/\/api\//.test(r.url())) api.push({ method: r.method(), path: normPath(r.url()), failed: cap(r.failure()?.errorText, 80) });
  if (/\/structure$/.test(r.url()) && structure == null) { structure = { status: "request-failed", fellBack: null, corrections: null, error: cap(r.failure()?.errorText, 80) }; structureAnsweredAt = Date.now(); }
});
page.on("response", async (resp) => {
  const url = resp.url();
  if (!/\/api\//.test(url)) return;
  const r = resp.request();
  const startedAt = reqStart.get(r) ?? Date.now();
  const entry = { method: r.method(), path: normPath(url), status: resp.status(), tStartMs: tUpload == null ? null : startedAt - tUpload, durMs: null, shape: null };
  api.push(entry);
  const p = entry.path;
  const interesting = /\/(paragraph-guide|report|structure|reading|explain|plain)$/.test(p);
  if (!interesting && resp.status() < 400) return;
  try {
    const text = await resp.text();
    entry.durMs = Date.now() - startedAt;
    entry.bytes = text.length;
    if (QUOTA_RE.test(text) && resp.status() >= 400) stopReason = `${p} answered ${resp.status()} with a quota / permission / billing marker`;
    if (/\/api\/papers\/report$/.test(url)) {
      const events = text.split("\n").map((l) => l.trim()).filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      entry.shape = { events: events.map((e) => e.type).join(","), errors: events.filter((e) => e.type === "error").map((e) => cap(e.message, 200)) };
      if (events.some((e) => e.type === "error" && QUOTA_RE.test(String(e.message)))) stopReason = "the report stream carried an error with a quota / permission / billing marker";
    } else {
      let j = null;
      try { j = JSON.parse(text); } catch {}
      if (j && typeof j === "object") {
        const shape = { keys: Object.keys(j).sort().join(",") };
        if (j.error) shape.error = cap(typeof j.error === "string" ? j.error : JSON.stringify(j.error), 200);
        if (/\/structure$/.test(p)) {
          const rev = j.review && typeof j.review === "object" ? j.review : null;
          structure = {
            status: resp.status() !== 200 ? `http-${resp.status()}` : rev ? "reviewed" : typeof j.fellBack === "string" ? "fellBack" : j.unavailable ? "unavailable" : "unknown",
            fellBack: typeof j.fellBack === "string" ? j.fellBack : null,
            corrections: rev && Array.isArray(rev.corrections) ? rev.corrections.length : (typeof j.fellBack === "string" || j.unavailable ? 0 : null),
            unsure: rev && Array.isArray(rev.unsure) ? rev.unsure.length : null,
            secondLooks: rev && Array.isArray(rev.secondLooks) ? rev.secondLooks.length : null,
            cached: typeof j.cached === "boolean" ? j.cached : null,
            model: rev && typeof rev.model === "string" ? rev.model : null,
            httpStatus: resp.status(),
            durMs: entry.durMs,
            entry: rev ? { corrections: rev.corrections, unsure: rev.unsure, secondLooks: rev.secondLooks, draftDigest: rev.draftDigest, rulesVersion: rev.rulesVersion, promptVersion: rev.promptVersion } : null,
            error: j.error ? cap(typeof j.error === "string" ? j.error : JSON.stringify(j.error), 200) : null,
          };
          structureAnsweredAt = Date.now();
          shape.structure = { status: structure.status, fellBack: structure.fellBack, corrections: structure.corrections };
        }
        entry.shape = shape;
        if (QUOTA_RE.test(text) && resp.status() >= 400) stopReason = `${p} answered ${resp.status()} (${cap(shape.error, 100)})`;
      } else {
        entry.shape = { nonJson: cap(text, 120) };
        if (/\/structure$/.test(p) && structure == null) { structure = { status: `http-${resp.status()}`, fellBack: null, corrections: null, error: cap(text, 120) }; structureAnsweredAt = Date.now(); }
      }
    }
  } catch (e) {
    entry.shape = { readError: cap(e.message, 100) };
  }
});

const profileSteps = {};
const timing = {};
const mark = (k) => { timing[k] = since(); };
let paperUrl = null;

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

  // ---- 2. Profile: Gemini + the key (from the environment); the Deep report switch as DEEP says ----
  if (!NOKEY) {
    await page.goto(BASE + "/profile", { waitUntil: "domcontentloaded", timeout: 240000 });
    let seen = false;
    for (let attempt = 0; attempt < 30 && !seen; attempt++) {
      const edit = page.getByRole("button", { name: "Edit", exact: true });
      if (await edit.count()) { try { await edit.click({ timeout: 20000 }); } catch {} }
      try { await page.waitForSelector("#profile-ai-provider", { timeout: 15000 }); seen = true; } catch {}
    }
    if (!seen) throw new Error("the Profile edit form (provider select) never appeared");
    await page.selectOption("#profile-ai-provider", "gemini", { timeout: 120000 });
    await page.waitForSelector("#profile-ai-key", { timeout: 120000 });
    await page.fill("#profile-ai-key", KEY, { timeout: 120000 });
    const sw = page.getByRole("switch", { name: "Deep report" });
    await sw.waitFor({ timeout: 120000 });
    for (let i = 0; i < 1200 && (await sw.isDisabled()); i++) await page.waitForTimeout(100);
    profileSteps.switchEnabled = !(await sw.isDisabled());
    const isOn = (await sw.getAttribute("aria-checked")) === "true";
    if (profileSteps.switchEnabled && isOn !== DEEP) await sw.click();
    profileSteps.switchOn = (await sw.getAttribute("aria-checked")) === "true";
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.waitForTimeout(800);
    const view = await page.evaluate((k) => {
      const body = document.body.innerText || "";
      let st = {};
      try { const o = JSON.parse(localStorage.getItem("peer-profile") || "{}"); st = (o.state || {}).profile || {}; } catch {}
      return {
        bodyHasKey: k ? body.includes(k) : false,
        storedProvider: st.feedAiProvider ?? null,
        storedKeyPresent: typeof st.feedAiApiKey === "string" && st.feedAiApiKey.length > 0,
        storedKeyEqualsEnv: typeof st.feedAiApiKey === "string" && st.feedAiApiKey === k,
        storedDeepReport: st.deepReportEnabled ?? null,
      };
    }, KEY);
    Object.assign(profileSteps, { storedProvider: view.storedProvider, storedKeyPresent: view.storedKeyPresent, storedKeyEqualsEnv: view.storedKeyEqualsEnv, storedDeepReport: view.storedDeepReport, keyInVisibleText: view.bodyHasKey });
    if (view.bodyHasKey) echoes++;
  }

  // ---- 3. upload by path through the real UI ----
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
  if (!/\/papers\//.test(paperUrl)) throw new Error("upload never navigated to a paper page");
  await page.waitForSelector("#paper-body", { timeout: 300000 });
  mark("bodyMs");
  await page.addStyleTag({ content: ".katex-mathml{display:none!important}" });
  await page.waitForTimeout(1500);

  // The map's rows as the page shows them: row, level, role tag, page, heading, parent, and each paragraph its fold lists.
  const dumpRows = (expand) => page.evaluate(async (expand) => {
    const T = (e) => (e ? (e.innerText ?? e.textContent ?? "") : "").replace(/ /g, " ").replace(/\s+/g, " ").trim();
    const mapSec = document.querySelector("section[aria-label='Map']");
    const body = document.getElementById("paper-body");
    if (!mapSec) return { rows: [], summaryLine: null, totalHosts: 0 };
    const lis = [...mapSec.querySelectorAll(":scope > div > ol > li")];
    if (expand) {
      for (const li of lis) { const b = li.querySelector(":scope > div > button[aria-expanded]"); if (b && b.getAttribute("aria-expanded") !== "true") b.click(); }
      await new Promise((r) => setTimeout(r, 900));
    }
    const hostRe = /^paper-section-\d+-p\d+$/;
    const rows = lis.map((li, k) => {
      const head = li.querySelector(":scope > div");
      const a = head.querySelector("a");
      const part = (n) => { const e = li.querySelector(":scope > div [data-meta-part='" + n + "']"); return e ? T(e) : null; };
      const pageText = part("page");
      const pm = pageText ? pageText.match(/(\d+)/) : null;
      const href = a?.getAttribute("href") || null;
      const level = Number(li.getAttribute("data-level")) || null;
      const lines = [...li.querySelectorAll(":scope > ol > li > a")];
      const paraIds = lines.map((l) => (l.getAttribute("href") || "").replace(/^#/, ""));
      const paragraphs = lines.map((l, j) => {
        const host = body ? body.querySelector("#" + CSS.escape(paraIds[j])) : null;
        const text = host ? T(host.querySelector("p") || host) : T(l);
        return text.slice(0, 80);
      });
      const secEl = href && !/-p\d+$/.test(href) && body ? body.querySelector(href) : null;
      const bodyHostIds = secEl ? [...secEl.querySelectorAll("[id]")].filter((h) => hostRe.test(h.id)).map((h) => h.id) : null;
      return {
        i: k + 1,
        level,
        role: part("role"),
        heading: T(a),
        id: href ? href.replace(/^#/, "") : null,
        parentId: null,
        page: pm ? Number(pm[1]) : null,
        pageText,
        words: part("words"),
        minutes: part("minutes"),
        isPart: !!href && /-p\d+$/.test(href),
        foldable: !!head.querySelector("button"),
        paragraphs,
        paraIds,
        bodyHostIds,
      };
    });
    // the parent: the nearest earlier row with a lower level
    for (let k = 0; k < rows.length; k++) {
      for (let j = k - 1; j >= 0; j--) { if ((rows[j].level ?? 1) < (rows[k].level ?? 1)) { rows[k].parentId = rows[j].id; break; } }
    }
    const totalHosts = body ? [...body.querySelectorAll("[id]")].filter((h) => hostRe.test(h.id)).length : 0;
    return { summaryLine: T(mapSec.querySelector("p.annotation span")), rows, totalHosts };
  }, expand);
  const sig = (d) => JSON.stringify(d.rows.map((x) => [x.heading, x.role, x.level, x.id, x.parentId, x.paraIds]));

  // The rules' draft, as first drawn (before the review can be laid over it).
  const before = await dumpRows(true);
  fs.writeFileSync(`${OUT}/rows-before.json`, JSON.stringify(before, null, 1));
  mark("rowsBeforeMs");

  // ---- 4. the page asks for the structure review, and applies it ----
  if (NOKEY) {
    await page.waitForTimeout(6000);
  } else {
    const endAt = Date.now() + WAIT_STRUCT_MS;
    while (!stopReason && Date.now() < endAt && structure == null) await page.waitForTimeout(500);
    mark("structureAnsweredMs");
    if (structure == null) note(`the page never asked for / got an answer from /structure within ${WAIT_STRUCT_MS} ms (requests seen: ${structRequests})`);
    if (structure && structure.status === "reviewed" && (structure.corrections ?? 0) > 0) {
      // applied: the rows differ from the draft (give the page up to 15 s to lay it over)
      const lim = Date.now() + 15000;
      let now1 = await dumpRows(true);
      while (sig(now1) === sig(before) && Date.now() < lim) { await page.waitForTimeout(500); now1 = await dumpRows(true); }
      mark("appliedMs");
    }
    // settled: nothing model-backed in flight and 4 s of quiet
    for (let i = 0; i < 120 && !stopReason; i++) {
      if (inflight.size === 0 && Date.now() - Math.max(lastModelEventAt, structureAnsweredAt ?? 0) > 4000) break;
      await page.waitForTimeout(500);
    }
  }
  mark("settledMs");
  const after = await dumpRows(true);
  const kept = await page.evaluate(() => {
    try {
      const o = JSON.parse(localStorage.getItem("peer-structure-review-v1") || "{}");
      return Object.values(o).map((e) => ({ kind: e && e.review ? "review" : e && e.failed ? "failed" : "other", corrections: e && e.review && Array.isArray(e.review.corrections) ? e.review.corrections.length : null }));
    } catch { return "unreadable"; }
  });
  const changed = sig(after) !== sig(before);
  fs.writeFileSync(`${OUT}/rows-after.json`, JSON.stringify(after, null, 1));

  const base = { ok: !stopReason && (NOKEY || (structure != null && structure.status !== "request-failed")), tag: TAG, run: Number(RUN), rows: after.rows, structure: structure ? { status: structure.status, fellBack: structure.fellBack, corrections: structure.corrections, unsure: structure.unsure ?? null, secondLooks: structure.secondLooks ?? null, cached: structure.cached ?? null, model: structure.model ?? null, durMs: structure.durMs ?? null, requests: structRequests, rowsChangedByReview: changed, entry: structure.entry ?? null } : { status: NOKEY ? "not-asked (no key)" : "no-answer", fellBack: null, corrections: null, requests: structRequests, rowsChangedByReview: changed } };
  if (SEALED) { fs.mkdirSync(SEALED, { recursive: true }); fs.writeFileSync(`${SEALED}/${TAG}-p7run${RUN}.json`, scrub(JSON.stringify(base, null, 1))); }

  const result = {
    tag: TAG, run: Number(RUN), base: BASE, deep: DEEP, wallTotalMs: Date.now() - t0wall, timing, profile: profileSteps,
    structure, structureRequests: structRequests, keptInBrowser: kept,
    map: { rowsBefore: before.rows.length, rowsAfter: after.rows.length, rowsChangedByReview: changed, totalHosts: after.totalHosts, summaryLine: cap(after.summaryLine, 160), partRows: after.rows.filter((r) => r.isPart).length },
    modelRoutesSeen: [...seenKinds],
    api: api.map((a) => ({ ...a })),
    blockedHosts: [...blockedHosts], keyToNonLocalRequests: keyToNonLocal, stopReason, echoesOfKeyScrubbed: echoes, notes,
  };
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(result, null, 1));
  fs.writeFileSync(`${OUT}/console.log`, consoleLines.join("\n") + "\n");
  console.log(JSON.stringify({ tag: TAG, run: RUN, structure: result.structure && { ...result.structure, entry: undefined }, map: result.map, timing, modelRoutesSeen: result.modelRoutesSeen, stopReason, echoes, keyToNonLocal }, null, 1));
} catch (e) {
  note("harness error: " + e.message);
  try {
    if (!/\/profile/.test(page.url())) {
      const st = await page.evaluate(() => ({
        text: (document.body.innerText || "").replace(/\s+/g, " ").slice(0, 500),
        url: location.pathname.replace(/\/papers\/[^/]+/, "/papers/<id>"),
        hasBody: !!document.getElementById("paper-body"),
      }));
      st.text = cap(st.text, 500);
      fs.writeFileSync(`${OUT}/fail-state.json`, JSON.stringify(st, null, 1));
    }
  } catch {}
  fs.writeFileSync(`${OUT}/result.json`, JSON.stringify({ tag: TAG, run: Number(RUN), error: cap(e.message, 300), timing, profile: profileSteps, structure, structureRequests: structRequests, api, notes, stopReason, echoesOfKeyScrubbed: echoes, keyToNonLocalRequests: keyToNonLocal }, null, 1));
  fs.writeFileSync(`${OUT}/console.log`, consoleLines.join("\n") + "\n");
  console.error("FAILED: " + cap(e.message, 300));
  process.exitCode = 1;
} finally {
  await browser.close();
}
