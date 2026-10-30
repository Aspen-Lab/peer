// Counts only: the [llm] lines of a dev.log (calls, tokens, models, latency, ok/ERR) and quota markers.
import fs from "node:fs";
const f = process.argv[2];
const text = fs.existsSync(f) ? fs.readFileSync(f, "latin1") : "";
const calls = [];
for (const line of text.split("\n")) {
  const m = line.match(/^\[llm\] (\S+)\/(\S+) path=(\S+)(?: in=(\d+))?(?: out=(\d+))?(?: think=(\d+))? (\d+)ms (ok|ERR)/);
  if (m) calls.push({ provider: m[1], model: m[2], path: m[3], in: m[4] ? +m[4] : null, out: m[5] ? +m[5] : null, think: m[6] ? +m[6] : null, ms: +m[7], ok: m[8] === "ok" });
  else if (line.startsWith("[llm]")) calls.push({ raw: "unparsed" });
}
const count = (re) => (text.match(re) || []).length;
const out = {
  calls: calls.length, ok: calls.filter((c) => c.ok).length, err: calls.filter((c) => c.ok === false).length,
  tokensIn: calls.reduce((n, c) => n + (c.in || 0), 0), tokensOut: calls.reduce((n, c) => n + (c.out || 0), 0), tokensThink: calls.reduce((n, c) => n + (c.think || 0), 0),
  perCall: calls,
  markers: { "429": count(/\b429\b/g), RESOURCE_EXHAUSTED: count(/RESOURCE_EXHAUSTED/g), PERMISSION_DENIED: count(/PERMISSION_DENIED/g), quota: count(/quota/gi), billing: count(/billing/gi) },
  structureLogLines: text.split("\n").filter((l) => /\[papers\/structure\]/.test(l)).map((l) => l.slice(0, 200)),
};
console.log(JSON.stringify(out));
