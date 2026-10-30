import fs from "node:fs";
const S = "__P12_SCRATCH__/p12/mgr/sealed-c1";
const rd = (f) => JSON.parse(fs.readFileSync(f, "utf8"));
const sig = (rows) => JSON.stringify(rows.map((r) => [r.i, r.level, r.role, r.heading, r.parentId, r.page, r.id, r.paraIds, r.paragraphs]));
const ref = { P6: rd(`${S}/P6-p4run1.json`), P4: rd(`${S}/P4-p4run1.json`) };
for (const [T, n] of [["P6", 5], ["P4", 1]]) for (let k = 1; k <= n; k++) {
  const d = rd(`${S}/${T}-p5run${k}.json`);
  console.log(T, "p5run" + k, "equals phase-4 run 1 map (the rules' draft, fully):", sig(d.rows) === sig(ref[T].rows), "rows", d.rows.length, "status", d.structure.status, d.structure.fellBack ?? "");
}
