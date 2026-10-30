// Phase 4 vs phase 3: compares fields of sealed dumps and the drafts; prints identity flags only, no paper text.
import fs from "node:fs";
const S = "__P12_SCRATCH__/p12/mgr/sealed-c1";
const O3 = "__P12_SCRATCH__/p12/a57/out3";
const O4 = "__P12_SCRATCH__/p12/a57/out4";
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const sig = (rows) => JSON.stringify(rows.map((r) => [r.i, r.level, r.role, r.heading, r.parentId, r.page, r.id, r.paraIds, r.paragraphs]));
const sigNoRole = (rows) => JSON.stringify(rows.map((r) => [r.i, r.level, r.heading, r.parentId, r.page, r.id, r.paraIds, r.paragraphs]));
for (const [T, a, b] of [["P6", "p3run1", "p4run1"], ["P6", "p3run4", "p4run4"], ["P4", "p3run1", "p4run1"]]) {
  const A = rd(`${S}/${T}-${a}.json`), B = rd(`${S}/${T}-${b}.json`);
  const dA = rd(`${O3}/${T}-run${a.slice(-1)}/rows-before.json`), dB = rd(`${O4}/${T}-run${b.slice(-1)}/rows-before.json`);
  console.log(T, a, "vs", b, "| after identical:", sig(A.rows) === sig(B.rows), "| after identical but roles:", sigNoRole(A.rows) === sigNoRole(B.rows), "| drafts identical:", sig(dA.rows) === sig(dB.rows), "| rows", A.rows.length, B.rows.length);
}
