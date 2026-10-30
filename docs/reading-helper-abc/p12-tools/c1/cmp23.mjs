// Phase-2 dump vs phase-3 dump of one paper: row-field differences by row number only; no paper text printed.
import fs from "node:fs";
const dir = process.argv[2];
const rd = (f) => JSON.parse(fs.readFileSync(`${dir}/${f}`, "utf8"));
for (const [T, p2, p3] of [["P6", [1, 2, 3, 4, 5], [1, 2, 3, 4, 5]], ["P4", [1], [1, 2, 3]], ["P3", [1, 2, 3, 4, 5], [1, 2, 3]]]) {
  const ref = rd(`${T}-run1.json`);
  for (const k of p2.slice(1)) { /* phase-2 internal already reported */ }
  for (const k of p3) {
    const b = rd(`${T}-p3run${k}.json`);
    const d = [];
    if (ref.rows.length !== b.rows.length) d.push(`rowcount ${ref.rows.length} vs ${b.rows.length}`);
    for (let i = 0; i < Math.min(ref.rows.length, b.rows.length); i++) {
      const f = [];
      for (const key of ["level", "role", "parentId", "page", "id", "heading"]) if (ref.rows[i][key] !== b.rows[i][key]) f.push(key);
      if (JSON.stringify(ref.rows[i].paragraphs) !== JSON.stringify(b.rows[i].paragraphs)) f.push("paragraphs");
      if (f.length) d.push(`row ${i + 1}: ${f.join("+")}`);
    }
    console.log(`${T} p3run${k} vs phase-2 run1: ${d.length ? d.join(" | ") : "identical"}`);
  }
}
