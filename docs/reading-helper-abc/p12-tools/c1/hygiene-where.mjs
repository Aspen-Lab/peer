// Prints, for each file containing the key's value: the relative path, the count and the byte offset class — never the key or surrounding text.
import fs from "node:fs"; import path from "node:path";
const KEY = process.env.PEER_TEST_GEMINI_API_KEY || ""; if (!KEY) process.exit(2);
const root = process.argv[2]; const needle = Buffer.from(KEY);
function scan(p) {
  let st; try { st = fs.lstatSync(p); } catch { return; }
  if (st.isSymbolicLink()) return;
  if (st.isDirectory()) { if (["node_modules", ".git"].includes(path.basename(p))) return; for (const n of fs.readdirSync(p)) scan(path.join(p, n)); return; }
  if (!st.isFile() || st.size > 300e6) return;
  const buf = fs.readFileSync(p); let i = 0, n = 0; while ((i = buf.indexOf(needle, i)) !== -1) { n++; i += needle.length; }
  if (n) console.log(n, st.size + "B", path.relative(root, p));
}
scan(root);
