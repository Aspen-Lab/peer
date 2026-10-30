import fs from "node:fs";
const R = "__P12_SCRATCH__/p12/a57/out5";
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
let allIn = 0, allOut = 0, calls = 0, route = { report: 0, review: 0, looks: 0 }, rin = 0, rout = 0;
for (const [T, n] of [["P6", 5], ["P4", 1]]) {
  for (let k = 1; k <= n; k++) {
    const d = `${R}/${T}-run${k}`;
    const res = rd(`${d}/result.json`), llm = rd(`${d}/llm.json`), sl = rd(`${d}/structlog.json`);
    const pc = llm.perCall;
    const first = pc[0];
    const sIn = llm.tokensIn - first.in, sOut = llm.tokensOut - first.out;
    allIn += llm.tokensIn; allOut += llm.tokensOut; calls += llm.calls; rin += sIn; rout += sOut;
    route.report += 1; route.review += 1; route.looks += llm.calls - 2;
    const s = res.structure;
    const unusable = (sl.blocks || []).find((b) => b.kind === "unusable");
    const api = res.api.filter((a) => /structure$/.test(a.path));
    console.log([`${T} run${k}`, s.status + (s.fellBack ? "/" + s.fellBack : ""), `corr=${s.corrections}`, `looks=${s.secondLooks ?? "-"}`, `calls=${llm.calls}`, `tok all ${llm.tokensIn}/${llm.tokensOut}`, `route-only ${sIn}/${sOut}`, `req ${(s.durMs/1000).toFixed(1)}s`, `click->answer ${(res.timing.structureAnsweredMs/1000).toFixed(1)}s`, `whole ${(res.wallTotalMs/1000).toFixed(1)}s`, `stat ${api.map(a=>a.status).join(",")}`, `model ${s.model ?? llm.perCall.map(c=>c.model).filter((v,i,a)=>a.indexOf(v)===i).join("+")}`, `profile ${res.profile.storedProvider}/key ${res.profile.storedKeyPresent}/deep ${res.profile.storedDeepReport}/vis ${res.profile.keyInVisibleText}`, `kept ${JSON.stringify(res.keptInBrowser)}`, `nonLocalKey ${res.keyToNonLocalRequests}`, `echo ${res.echoesOfKeyScrubbed}`, `routes ${res.modelRoutesSeen.join("+")}`, `notes ${res.notes.length}`].join(" ; "));
    if (unusable) console.log("     " + unusable.line);
  }
}
console.log({ calls, allIn, allOut, route, routeOnlyIn: rin, routeOnlyOut: rout });
