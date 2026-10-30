// Phase 6: markdown rows and per-paper stats from out6 + sealed-c1. Counts, numbers, role names only. Prints no paper text.
import fs from "node:fs";
const R = "__P12_SCRATCH__/p12/a57/out6";
const S = "__P12_SCRATCH__/p12/mgr/sealed-c1";
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const n = (x) => x.toLocaleString("en-US");
const sec = (ms) => (ms / 1000).toFixed(1);
const med = (a) => { const b = [...a].sort((x, y) => x - y); const m = b.length >> 1; return b.length % 2 ? b[m] : (b[m - 1] + b[m]) / 2; };
const num = (line, key) => { const m = line.match(new RegExp(`${key}: (\\d+)`)); return m ? +m[1] : null; };
const rows = [], per = {};
let allIn = 0, allOut = 0, calls = 0, rIn = 0, rOut = 0, report = 0, review = 0, looks = 0;
for (const T of ["P1", "P2", "P3", "P4", "P5", "P6"]) {
  per[T] = { calls: 0, in: 0, out: 0, rin: 0, rout: 0, req: [], click: [], whole: [], status: [], corr: [], changedRuns: 0 };
  for (let k = 1; k <= 5; k++) {
    const d = `${R}/${T}-run${k}`;
    const res = rd(`${d}/result.json`), llm = rd(`${d}/llm.json`), sl = rd(`${d}/structlog.json`), sealed = rd(`${S}/${T}-p6run${k}.json`);
    const s = res.structure, first = llm.perCall[0];
    const unus = (sl.blocks || []).find((b) => b.kind === "unusable"), rev = (sl.blocks || []).find((b) => b.kind === "review");
    const ent = s.entry || {}, lk = (ent.secondLooks || []).map((x) => x.verdict).join("+") || "–";
    const status = s.status + (s.fellBack ? ` \`${s.fellBack}\`` : "");
    const cause = unus ? `**${unus.line.match(/cause: '([^']+)'/)[1]}** · read ${num(unus.line, "read")} · rejected ${num(unus.line, "rejected")}` : `– · (not logged) · ${num(rev.line, "rejected")}`;
    const rIn1 = llm.tokensIn - first.in, rOut1 = llm.tokensOut - first.out;
    rows.push(`| ${T} run ${k} | ${status} | ${cause} | ${s.corrections ?? 0} | ${lk} | ${llm.calls} | ${n(llm.tokensIn)} / ${n(llm.tokensOut)} | ${n(rIn1)} / ${n(rOut1)} | ${sec(s.durMs)} s | ${sec(res.timing.structureAnsweredMs)} s | ${sec(res.wallTotalMs)} s |`);
    const p = per[T]; p.calls += llm.calls; p.in += llm.tokensIn; p.out += llm.tokensOut; p.rin += rIn1; p.rout += rOut1;
    p.req.push(s.durMs); p.click.push(res.timing.structureAnsweredMs); p.whole.push(res.wallTotalMs); p.status.push(s.fellBack ? "F" : "R"); p.corr.push(s.corrections ?? 0); if (res.map.rowsChangedByReview) p.changedRuns++;
    allIn += llm.tokensIn; allOut += llm.tokensOut; calls += llm.calls; rIn += rIn1; rOut += rOut1; report++; review++; looks += llm.calls - 2;
  }
}
console.log(rows.join("\n"));
console.log("\nPER PAPER");
for (const [T, p] of Object.entries(per)) {
  console.log(`${T}: reviewed ${p.status.filter((x) => x === "R").length} / fellBack ${p.status.filter((x) => x === "F").length}; corr ${p.corr.join(" · ")}; calls ${p.calls}; tok all ${n(p.in)}/${n(p.out)}; route ${n(p.rin)}/${n(p.rout)}; req ${sec(Math.min(...p.req))}/${sec(med(p.req))}/${sec(Math.max(...p.req))}; click ${sec(Math.min(...p.click))}/${sec(med(p.click))}/${sec(Math.max(...p.click))}; whole sum ${sec(p.whole.reduce((a, b) => a + b, 0))}; changedRuns ${p.changedRuns}`);
}
console.log(`TOTAL calls ${calls} (report ${report}, review ${review}, looks ${looks}); tokens ${n(allIn)}/${n(allOut)}; route ${n(rIn)}/${n(rOut)}`);
