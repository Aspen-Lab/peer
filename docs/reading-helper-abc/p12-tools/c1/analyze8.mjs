// Phase 8 analysis. Counts, shapes and identity checks only. Prints no paper text.
import fs from "node:fs";
import crypto from "node:crypto";
const R = "__P12_SCRATCH__/p12/a57/out8";
const SEALED = "__P12_SCRATCH__/p12/mgr/sealed-c1";
const h = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 8);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const plan = { P5: 5 };
const out = {};
let totalCalls = 0, totalIn = 0, totalOut = 0;
for (const [T, n] of Object.entries(plan)) {
  const runs = [];
  for (let k = 1; k <= n; k++) {
    const d = `${R}/${T}-run${k}`;
    const res = rd(`${d}/result.json`), llm = rd(`${d}/llm.json`), sl = rd(`${d}/structlog.json`), sealed = rd(`${SEALED}/${T}-p8run${k}.json`), before = rd(`${d}/rows-before.json`);
    if (!res) continue;
    const s = res.structure || {};
    const rowsSig = (rows) => rows && rows.map((r) => [r.i, r.level, r.role, r.heading, r.parentId, r.page, r.id, r.paraIds, r.paragraphs]);
    const rowsRoles = (rows) => rows && rows.map((r) => r.role);
    const unusable = (sl?.blocks || []).filter((b) => b.kind === "unusable").map((b) => b.line);
    const reviewLine = (sl?.blocks || []).filter((b) => b.kind === "review").map((b) => b.line);
    totalCalls += llm?.calls || 0; totalIn += llm?.tokensIn || 0; totalOut += llm?.tokensOut || 0;
    runs.push({
      k, error: res.error || null, stop: res.stopReason || null,
      status: s.status ?? null, fellBack: s.fellBack ?? null, corrections: s.corrections ?? null, unsure: s.unsure ?? null, looks: s.secondLooks ?? null, cached: s.cached ?? null, structReq: res.structureRequests,
      calls: llm?.calls ?? null, err: llm?.err ?? null, tIn: llm?.tokensIn ?? null, tOut: llm?.tokensOut ?? null, think: llm?.tokensThink ?? null,
      perCall: (llm?.perCall || []).map((c) => `${c.model}:${c.in}/${c.out}:${c.ms}ms:${c.ok ? "ok" : "ERR"}`),
      unusable, reviewLine, errorLines: sl?.errorLines ?? null,
      wallMs: res.wallTotalMs ?? null, structMs: res.timing?.structureAnsweredMs ?? null, structDur: s.durMs ?? null,
      rowsBefore: before?.rows?.length ?? null, rowsAfter: res.map?.rowsAfter ?? null, changed: res.map?.rowsChangedByReview ?? null,
      sigBefore: before ? h(rowsSig(before.rows)) : null, sigAfter: sealed ? h(rowsSig(sealed.rows)) : null, rolesAfter: sealed ? h(rowsRoles(sealed.rows)) : null,
      rolesList: sealed ? rowsRoles(sealed.rows).map((r) => r ?? "-").join(",") : null,
      entrySig: s.entry ? h([s.entry.corrections, s.entry.unsure]) : null,
      sealed: !!sealed, keyNonLocal: res.keyToNonLocalRequests ?? null, echoes: res.echoesOfKeyScrubbed ?? null, model: s.model ?? null,
      keptInBrowser: res.keptInBrowser ?? null, profile: res.profile ? { p: res.profile.storedProvider, key: res.profile.storedKeyPresent, deep: res.profile.storedDeepReport, vis: res.profile.keyInVisibleText } : null,
      modelRoutes: res.modelRoutesSeen, notes: (res.notes || []).filter((x) => !/console\.error/.test(x)).length,
    });
  }
  out[T] = runs;
}
if (process.argv[2] === "json") { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
for (const [T, runs] of Object.entries(out)) {
  console.log(`== ${T}: ${runs.length} runs`);
  for (const r of runs) {
    console.log(`  run${r.k}: ${r.status}${r.fellBack ? "/" + r.fellBack : ""} corr=${r.corrections} unsure=${r.unsure} looks=${r.looks} cached=${r.cached} req=${r.structReq} calls=${r.calls}(err ${r.err}) tok=${r.tIn}/${r.tOut}/think${r.think} rows ${r.rowsBefore}->${r.rowsAfter} changed=${r.changed} wall=${r.wallMs} structAt=${r.structMs} structDur=${r.structDur} before#${r.sigBefore} after#${r.sigAfter} roles#${r.rolesAfter} entry#${r.entrySig}${r.error ? " ERROR=" + r.error : ""}`);
    for (const u of r.unusable) console.log(`     unusable: ${u}`);
    for (const u of r.reviewLine) console.log(`     review: ${u}`);
    if (r.errorLines) console.log(`     errorLines: ${r.errorLines}`);
    console.log(`     perCall: ${r.perCall.join(" | ")}`);
  }
  const uniq = (key) => new Set(runs.map((r) => r[key])).size;
  console.log(`  distinct: before ${uniq("sigBefore")}, after(full rows + paragraphs) ${uniq("sigAfter")}, roles ${uniq("rolesAfter")}, entry ${uniq("entrySig")}`);
}
console.log(`TOTAL calls=${totalCalls} in=${totalIn} out=${totalOut}`);
