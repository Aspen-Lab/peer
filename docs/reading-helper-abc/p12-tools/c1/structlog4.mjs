// Counts only: the route's [papers/structure] debug blocks of a dev.log (the 'unusable' line of P12-86: cause, read,
// rejected, refusedByOp, refusedByReason are numbers and names from closed sets). Prints each block whitespace-collapsed
// after checking it holds only the closed-set characters; anything else is reported as "block-with-other-text" and not printed.
import fs from "node:fs";
const f = process.argv[2];
const text = fs.existsSync(f) ? fs.readFileSync(f, "latin1") : "";
const lines = text.split("\n");
const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\[papers\/structure\] (\S+)(.*)$/);
  if (!m) continue;
  let body = m[2];
  if (/\{\s*$/.test(body) || (body.includes("{") && !body.includes("}"))) {
    let depth = (body.match(/\{/g) || []).length - (body.match(/\}/g) || []).length;
    let j = i;
    while (depth > 0 && j + 1 < lines.length) { j++; body += " " + lines[j].trim(); depth += (lines[j].match(/\{/g) || []).length - (lines[j].match(/\}/g) || []).length; }
    i = j;
  }
  blocks.push({ kind: m[1], body: body.replace(/\s+/g, " ").trim() });
}
const SAFE = /^[\w\s{}:,'"\-\[\].]*$/;
const out = blocks.map((b) => ({ kind: b.kind, line: SAFE.test(b.body) && b.body.length < 2000 ? b.body : "block-with-other-text" }));
const errs = lines.filter((l) => /^\[papers\/structure\] (model call|second look)/.test(l)).length;
console.log(JSON.stringify({ blocks: out, errorLines: errs }));
