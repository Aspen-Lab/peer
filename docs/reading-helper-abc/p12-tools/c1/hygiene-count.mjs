// Prints COUNTS only: occurrences of the key's value (from the environment) in the files given. Never prints the key or any line.
import fs from "node:fs";
import path from "node:path";
const KEY = process.env.PEER_TEST_GEMINI_API_KEY || "";
if (!KEY) { console.log("key not set"); process.exit(2); }
const skipDirs = new Set(["node_modules", ".git"]);
let files = 0, bytes = 0, hits = 0; const hitFiles = [];
function scan(p) {
  let st; try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) { if (skipDirs.has(path.basename(p))) return; for (const n of fs.readdirSync(p)) scan(path.join(p, n)); return; }
  if (!st.isFile() || st.size > 300e6) return;
  files++; bytes += st.size;
  const buf = fs.readFileSync(p);
  let i = 0, n = 0; const needle = Buffer.from(KEY);
  while ((i = buf.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  if (n) { hits += n; hitFiles.push(path.basename(p)); }
}
for (const p of process.argv.slice(2)) scan(p);
console.log(JSON.stringify({ filesScanned: files, MB: Math.round(bytes / 1e6), keyOccurrences: hits, filesWithHits: hitFiles.length }));
