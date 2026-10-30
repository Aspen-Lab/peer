// Counts only. Reads the key from the environment; prints occurrence counts per directory, never the key.
import fs from "node:fs";
import path from "node:path";
const KEY = process.env.PEER_TEST_GEMINI_API_KEY || "";
if (!KEY) { console.log("no key in the environment"); process.exit(2); }
const needle = Buffer.from(KEY, "utf8");
const needle16 = Buffer.from(KEY, "utf16le");
const enc = Buffer.from(encodeURIComponent(KEY), "utf8");
function count(buf) {
  let n = 0;
  const forms = [needle, needle16];
  if (!enc.equals(needle)) forms.push(enc); // the URL-encoded spelling, when it differs
  for (const nd of forms) {
    let i = 0;
    while ((i = buf.indexOf(nd, i)) !== -1) { n++; i += nd.length; }
  }
  return n;
}
function walk(dir, acc) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of ents) {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) walk(p, acc);
    else if (e.isFile()) {
      let st; try { st = fs.statSync(p); } catch { continue; }
      acc.files++;
      acc.bytes += st.size;
      try { const n = count(fs.readFileSync(p)); if (n) { acc.hits += n; acc.filesWithHits++; } } catch { acc.unreadable++; }
    }
  }
  return acc;
}
for (const label_dir of process.argv.slice(2)) {
  const [label, dir] = label_dir.split("=");
  const acc = walk(dir, { files: 0, bytes: 0, hits: 0, filesWithHits: 0, unreadable: 0 });
  console.log(`${label}: files=${acc.files} bytes=${acc.bytes} occurrences=${acc.hits} filesWithOccurrences=${acc.filesWithHits} unreadable=${acc.unreadable}`);
}
