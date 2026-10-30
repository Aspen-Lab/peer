// Counts and identity checks only. Prints no paper text.
import fs from "node:fs";
import crypto from "node:crypto";
const R = "__P12_SCRATCH__/p12/a57/out2";
const SEALED = "__P12_SCRATCH__/p12/mgr/sealed-c1";
const h = (x) => crypto.createHash("sha256").update(JSON.stringify(x)).digest("hex").slice(0, 8);
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const out = {};
for (const T of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
  const runs = [];
  for (let k = 1; k <= 5; k++) {
    const d = `${R}/${T}-run${k}`;
    const res = rd(`${d}/result.json`), llm = rd(`${d}/llm.json`), sealed = rd(`${SEALED}/${T}-run${k}.json`), before = rd(`${d}/rows-before.json`), after = rd(`${d}/rows-after.json`);
    if (!res) continue;
    const rowsSig = (rows) => rows && rows.map((r) => [r.i, r.level, r.role, r.heading, r.parentId, r.page, r.id, r.paraIds]);
    const rowsOnly = (rows) => rows && rows.map((r) => [r.i, r.level, r.role, r.heading, r.parentId, r.page]);
    const s = res.structure || {};
    runs.push({
      k, error: res.error || null, stop: res.stopReason || null,
      status: s.status ?? null, fellBack: s.fellBack ?? null, corrections: s.corrections ?? null, unsure: s.unsure ?? null, looks: s.secondLooks ?? null, structReq: res.structureRequests,
      calls: llm?.calls ?? null, err: llm?.err ?? null, tIn: llm?.tokensIn ?? null, tOut: llm?.tokensOut ?? null,
      perCall: (llm?.perCall || []).map((c) => `${c.model}:${c.in}/${c.out}:${c.ms}ms:${c.ok ? "ok" : "ERR"}`),
      structureDebug: llm?.structureLogLines || [],
      wallMs: res.wallTotalMs ?? null, structMs: res.timing?.structureAnsweredMs ?? null, structDur: s.durMs ?? null,
      rowsBefore: before?.rows?.length ?? null, rowsAfter: after?.rows?.length ?? null, changed: res.map?.rowsChangedByReview ?? null, partRows: res.map?.partRows ?? null,
      sigBefore: before ? h(rowsSig(before.rows)) : null, sigAfter: after ? h(rowsSig(after.rows)) : null, sigAfterRowsOnly: after ? h(rowsOnly(after.rows)) : null,
      entrySig: s.entry ? h([s.entry.corrections, s.entry.unsure]) : null,
      sealed: !!sealed, keyNonLocal: res.keyToNonLocalRequests ?? null, echoes: res.echoesOfKeyScrubbed ?? null, model: s.model ?? null,
    });
  }
  out[T] = runs;
}
if (process.argv[2] === "json") { console.log(JSON.stringify(out, null, 1)); process.exit(0); }
for (const [T, runs] of Object.entries(out)) {
  console.log(`== ${T}: ${runs.length} runs`);
  for (const r of runs) console.log(`  run${r.k}: ${r.status}${r.fellBack ? "/" + r.fellBack : ""} corr=${r.corrections} unsure=${r.unsure} looks=${r.looks} req=${r.structReq} calls=${r.calls}(err ${r.err}) tok=${r.tIn}/${r.tOut} rows ${r.rowsBefore}->${r.rowsAfter} changed=${r.changed} wall=${r.wallMs} structAt=${r.structMs} structDur=${r.structDur} before#${r.sigBefore} after#${r.sigAfter} entry#${r.entrySig}${r.error ? " ERROR=" + r.error : ""}`);
  const uniq = (key) => new Set(runs.map((r) => r[key])).size;
  console.log(`  distinct: before ${uniq("sigBefore")}, after ${uniq("sigAfter")}, afterRowsOnly ${uniq("sigAfterRowsOnly")}, entry ${uniq("entrySig")}`);
}
