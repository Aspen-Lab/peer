// Diff of the sealed dumps of one paper: fields compared, no paper text printed (headings and paragraphs are compared, never printed).
import fs from "node:fs";
const dir = process.argv[2], tag = process.argv[3], names = process.argv.slice(4);
const rd = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
const runs = names.map((n) => rd(`${tag}-${n}.json`));
const base = runs[0];
runs.slice(1).forEach((r, idx) => {
  const a = base.rows, b = r.rows, d = [];
  if (a.length !== b.length) d.push(`rowcount ${a.length} vs ${b.length}`);
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const f = [];
    for (const key of ["level", "role", "parentId", "page", "id"]) if (a[i][key] !== b[i][key]) f.push(`${key}: ${a[i][key]} -> ${b[i][key]}`);
    if (JSON.stringify(a[i].paragraphs) !== JSON.stringify(b[i].paragraphs)) f.push(`paragraph list differs (${a[i].paragraphs.length} vs ${b[i].paragraphs.length})`);
    if (a[i].heading !== b[i].heading) f.push("heading differs");
    if (f.length) d.push(`row ${i + 1}: ` + f.join("; "));
  }
  console.log(`${names[idx + 1]} vs ${names[0]}:`, d.length ? d.join(" | ") : "identical");
});
for (const [i, r] of runs.entries()) {
  const e = r.structure && r.structure.entry;
  console.log(`${names[i]}: roles ${r.rows.map((x) => x.role ?? "-").join(",")} | corrections ${e ? JSON.stringify(e.corrections) : "-"} | unsure ${e ? JSON.stringify(e.unsure) : "-"} | looks ${e ? JSON.stringify(e.secondLooks) : "-"}`);
}
