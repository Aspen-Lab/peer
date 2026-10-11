// A P6-02 server-side stub. Replaces globalThis.fetch in the Next server process: api.openai.com chat
// completions are answered from the prompt itself (no model, no network); any other non-local host is
// refused with 503. The log holds lengths and booleans only.
const fs = require("node:fs");
const D = process.env.P602_DIR;
const LOG = D + "/stub.log";
function control() { try { return JSON.parse(fs.readFileSync(D + "/stub-control.json", "utf8")); } catch { return {}; } }
function log(o) { try { fs.appendFileSync(LOG, JSON.stringify({ t: Date.now(), ...o }) + "\n"); } catch {} }
function sentencesOf(text) {
  const t = String(text || "").replace(/\s+/g, " ").trim();
  return t.split(/(?<=[.!?])\s+(?=[A-Z"'(\[])/).map((x) => x.trim()).filter((x) => x.length >= 25 && /[.!?]$/.test(x));
}
function kindOf(user) {
  const o = user.outputSchema || {};
  if (o.questionRelevant) return "pass1q";
  if (o.noveltyClaims) return "pass1";
  if (o.skim || o.whatItProposes) return "pass2";
  if (o.meaning) return "explain_first";
  if (o.reply) return "explain_reply";
  if (o.plain) return "plain";
  if (o.gists) return "gist";
  if (o.confidence) return "figbind";
  return "other";
}
function poolOf(user) {
  const pool = [];
  const add = (text, id) => { for (const s of sentencesOf(text)) pool.push({ s, id }); };
  const body = user.body;
  if (Array.isArray(body)) for (const sec of body) add(sec.text, sec.id);
  else if (body && typeof body === "object") for (const g of ["noveltyClaims", "keyResults", "methodHighlights", "priorWorkComparisons"]) for (const it of body[g] || []) add(it.text, it.sectionId);
  for (const sec of user.sections || []) add(sec.text, sec.id);
  return pool;
}
function hash(str) { let h = 7; for (const c of String(str)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return h; }
// P7-03 A: the canned fragments belong to another paper; when one is absent, fall back to a stable sentence of the pool
// (60..300 chars) so the stub's evidence is always a verbatim sentence of this paper.
const pick = (pool, frag) => {
  const hit = pool.find((p) => p.s.includes(frag));
  if (hit) return hit;
  const ok = pool.filter((p) => p.s.length >= 60 && p.s.length <= 300);
  return ok.length ? ok[hash(frag) % ok.length] : undefined;
};
function answer(kind, user) {
  if (kind === "pass1") {
    const pool = poolOf(user);
    const f = (frag) => { const p = pick(pool, frag); return p ? [{ text: p.s, sectionId: p.id }] : []; };
    return { noveltyClaims: f("We test whether"), keyResults: f("The water holding index was"), methodHighlights: f("Moisture probes sat"), priorWorkComparisons: f("Earlier trials used") };
  }
  if (kind === "pass1q") {
    const pool = poolOf(user);
    const out = {};
    (user.questions || []).forEach((q, i) => { const p = pick(pool, i === 0 ? "kept the most soil water" : "Runoff loss from"); out[String(i)] = p ? [{ text: p.s, sectionId: p.id }] : []; });
    return { questionRelevant: out };
  }
  if (kind === "pass2") {
    const pool = poolOf(user);
    const res = pick(pool, "The water holding index was"), met = pick(pool, "Moisture probes sat"), lim = pick(pool, "A limitation is");
    const def = pick(pool, "water holding index (WHI)");
    const rep = {
      skim: [res && { text: "Deeper seaweed layers held more soil water.", evidence: res.s }].filter(Boolean),
      whatItProposes: { summary: "It lays seaweed on terrace soil and logs soil water.", methods: [met && { text: "Probes log soil water.", evidence: met.s }].filter(Boolean), newHere: ["A cheap local mulch."] },
      resultsAndSignificance: { summary: "Soil water stayed higher.", keyResults: [res && { title: "Water kept", detail: "The index rose with depth.", evidence: res.s, novelty: "Three depths were compared." }].filter(Boolean) },
      limitations: [lim && { text: "One orchard was tested.", evidence: lim.s }].filter(Boolean),
    };
    // P7-03 A (rich run): the optional bands, so the column's full order can be seen.
    if (control().rich) {
      rep.nextStep = met ? { text: "Check cracking after more cycles.", evidence: met.s } : undefined;
      if (user.readerProject) rep.relationToYourWork = { basedOn: String(user.readerProject), items: [res && { text: "It bears on thick film cathodes.", evidence: res.s }].filter(Boolean) };
    }
    const qs = user.readerQuestions || [];
    if (qs.length) {
      const methods = (user.sections || []).find((s) => /Methods/.test(s.heading || "")) || (Array.isArray(user.body) ? user.body.find((s) => /Methods/.test(s.heading || "")) : null);
      const methodsId = methods ? methods.id : "s2";
      rep.forYourQuestions = qs.map((q, i) => i >= 2
        ? { question: q, verdict: "not_addressed", answers: [], readNext: [] }
        : {
        question: q,
        verdict: i === 0 ? "answered" : "partly",
        answers: res ? [{ text: "The index was higher under thicker layers.", evidence: res.s, sectionId: res.id }] : [],
        readNext: [{ sectionId: methodsId, why: "How the plots and layers were set out.", kind: "background" }],
      });
      rep.terms = [
        def && { term: "water holding index", definition: "The share of water kept after a dry spell.", evidence: def.s },
        { term: "runoff loss", definition: "Water that leaves a terrace over its lip." },
      ].filter(Boolean);
      const extra = control().terms | 0;
      for (let i = 0; i < extra; i++) rep.terms.push({ term: ["terrace", "orchard", "mulch layer", "straw", "bare soil", "probe", "oven core", "bank", "crust", "storm", "plot", "dry spell"][i % 12], definition: "A plain one-line note number " + (i + 1) + "." });
    }
    return rep;
  }
  if (kind === "gist") return { gists: (user.paragraphs || []).map((p) => ({ sectionId: p.sectionId, paragraphIndex: p.paragraphIndex, gist: String(p.topicSentence || p.text || "").split(/\s+/).slice(0, 8).join(" ") })) };
  if (kind === "figbind") {
    // P7-03 A: bind the report to this paper's "Figure 4" (what the owner's printout shows on the plate) when it is offered.
    const caps = user.captions || [];
    const c = caps.find((x) => /\b4\b/.test(String(x.label || ""))) || null;
    return c ? { ordinal: c.ordinal, confidence: "high", reason: "stub" } : { ordinal: -1, confidence: "low", reason: "none fits" };
  }
  if (kind === "explain_first") {
    const ctx = user.context || {};
    const first = sentencesOf(ctx.paragraph)[0] || "";
    const passage = String(user.passage || "");
    const words = [...new Set(passage.split(/[^A-Za-z]+/).filter((w) => w.length >= 5))].slice(0, 3);
    const out = { meaning: "In general, this names a measure of how much water soil keeps.", here: { text: "Here the author uses it to compare mulch layers." } };
    if (first) out.here.evidence = first;
    if (words.length >= 2) out.items = words.map((w) => ({ term: w, here: "What it means here", read: "Higher is better" }));
    return out;
  }
  if (kind === "explain_reply") {
    const ctx = user.context || {};
    const first = sentencesOf(ctx.paragraph)[0] || "";
    const detail = /at most eight sentences/.test(String(user.outputSchema.reply || ""));
    const reply = detail
      ? "The author compares three layers. Each layer is tested in the same way. The thick layer holds more water. The thin layer holds less. Bare soil holds the least. The gap grows after the fourth day."
      : "The author compares three layers. The thick layer holds more water.";
    return { reply, ...(first ? { evidence: first } : {}) };
  }
  if (kind === "plain") {
    const para = String(user.paragraph || "");
    const lvl = String(user.level || "undergrad");
    const sub = lvl === "highschool" ? "the team" : lvl === "graduate" ? "the study" : "the authors";
    const out = para.replace(/\bWe\b/, sub).replace(/\bwe\b/, sub);
    return { plain: out === para ? "In short, " + para : out };
  }
  return {};
}
const realFetch = globalThis.fetch;
globalThis.fetch = async function stubFetch(input, init) {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  let u; try { u = new URL(url); } catch { return realFetch(input, init); }
  if (["localhost", "127.0.0.1", "::1", "[::1]"].includes(u.hostname)) return realFetch(input, init);
  if (u.hostname === "api.openai.com" && u.pathname === "/v1/chat/completions") {
    let req = {}; try { req = JSON.parse(init && typeof init.body === "string" ? init.body : "{}"); } catch {}
    const sys = (req.messages && req.messages[0] && req.messages[0].content) || "";
    const usr = (req.messages && req.messages[1] && req.messages[1].content) || "";
    let user = {}; try { user = JSON.parse(usr); } catch {}
    const kind = kindOf(user);
    const headers = init && init.headers ? init.headers : {};
    const auth = headers.Authorization || headers.authorization || "";
    const base = { kind, userLen: usr.length, sysLen: sys.length, authBearer: /^Bearer /.test(auth), authLen: auth.length, nQuestions: Array.isArray(user.questions) ? user.questions.length : Array.isArray(user.readerQuestions) ? user.readerQuestions.length : 0 };
    let content; try { content = answer(kind, user); } catch (e) { log({ ...base, stubError: String(e && e.message).slice(0, 60) }); content = {}; }
    log(base);
    const text = JSON.stringify(content);
    return new Response(JSON.stringify({ choices: [{ message: { content: text } }], usage: { prompt_tokens: Math.ceil(usr.length / 4), completion_tokens: Math.ceil(text.length / 4) } }), { status: 200, headers: { "content-type": "application/json" } });
  }
  log({ refused: true, host: u.hostname });
  return new Response("blocked by the A's stub", { status: 503 });
};

// P7-17 A: count the reads of an upload's bytes (`<hash16>.pdf`) and of its extracted-text sidecar (`<hash16>.doc.json`) in
// this server process, so "a second open runs no second extraction" can be read as a number. Logs only the kind, never a path or text.
try {
  const fsp = require("node:fs/promises");
  const realRead = fsp.readFile.bind(fsp);
  const note = (p) => { const s = String(p); if (/[\\/]uploads[\\/][0-9a-f]{16}\.pdf$/.test(s)) log({ upload: "pdf-bytes-read" }); else if (/[\\/]uploads[\\/][0-9a-f]{16}\.doc\.json$/.test(s)) log({ upload: "doc-sidecar-read" }); };
  fsp.readFile = function (p, ...rest) { try { note(p); } catch {} return realRead(p, ...rest); };
  const fsm = require("node:fs");
  const realReadFile = fsm.promises.readFile;
  fsm.promises.readFile = fsp.readFile;
  const realWrite = fsp.writeFile.bind(fsp);
  fsp.writeFile = function (p, ...rest) { try { if (/[\\/]uploads[\\/][0-9a-f]{16}\.doc\.json$/.test(String(p))) log({ upload: "doc-sidecar-written" }); } catch {} return realWrite(p, ...rest); };
  fsm.promises.writeFile = fsp.writeFile;
} catch {}
log({ boot: true });
