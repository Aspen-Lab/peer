import { afterEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import type { DigestProvider } from "@/lib/llm/providers/types";
import type { ExtractedDocument, ExtractedSection } from "./html-text";
import { generateDeepReport } from "./deep-report";

// P2-01 (§1g.1, §1g.2, §1g.4; acceptance §3d 10, 11): Pass 1 reads the paper
// by section and answers by section; a bounded question pass (Pass 1q) runs
// only when the reader asked something; every prompt is clipped in its body,
// never in its schema; Pass 1 is cached by the document, Pass 1q by the
// document and the questions. No real model anywhere: a counting stub.

const paper: Paper = {
  id: "openalex:Wpasses",
  title: "Quillwort cathodes crack under fast charging",
  authors: ["A. Researcher"],
  relevanceReason: "",
  venue: "Test Venue",
  source: "other",
  summaryIntro: "We charged quillwort cells fast and opened them.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "Cracking rose with the charge rate.",
  isSaved: false,
};

const PAD = "This sentence pads the section so that the paper is long enough for the first pass. ";

const SENT = {
  intro: "Quillwort cathodes are used in small cells because they store a great deal of charge.",
  methods: "We cycled twelve quillwort cells at three charge rates for one month in a warm room.",
  results: "Cracking along the grain boundaries rose with the charge rate in every cell we opened.",
  discussion: "Slower charging may be the simplest way to keep the cathode whole over many cycles.",
};

/** A document over the Pass 1 trigger (10 000 body characters), unique per `tag`. */
function bigDoc(tag: string, padding = 40): ExtractedDocument {
  return {
    source: "pdf",
    pageCount: 9,
    figureCaptions: [{ ordinal: 1, label: "Figure 1", caption: "Cracks against charge rate.", page: 4 }],
    sections: [
      { id: "s0", heading: "Abstract", canonical: "abstract", text: "We charged quillwort cells fast and opened them." },
      { id: "s1", heading: "1 Introduction", canonical: "introduction", text: `${SENT.intro} ${PAD.repeat(padding)}Tag ${tag}.`, page: 1 },
      { id: "s2", heading: "2 Methods", canonical: "methods", text: `${SENT.methods} ${PAD.repeat(padding)}`, page: 2 },
      { id: "s3", heading: "3 Results", canonical: "results", text: `${SENT.results} ${PAD.repeat(padding)}`, page: 4 },
      { id: "s4", heading: "4 Discussion", canonical: "discussion", text: `${SENT.discussion} ${PAD.repeat(padding)}`, page: 6 },
    ],
  };
}

type Kind = "pass1" | "pass1q" | "pass2";
interface Call {
  kind: Kind;
  tier?: string;
  systemPrompt: string;
  userPrompt: string;
  prompt: Record<string, unknown>;
}

function kindOf(prompt: Record<string, unknown>): Kind {
  const schema = (prompt.outputSchema ?? {}) as Record<string, unknown>;
  if ("questionRelevant" in schema) return "pass1q";
  if ("noveltyClaims" in schema) return "pass1";
  return "pass2";
}

const PASS2_REPLY = JSON.stringify({
  skim: [{ text: "Fast charging cracks quillwort cathodes.", evidence: SENT.results }],
  whatItProposes: { summary: "It charges cells fast and looks for cracks.", methods: [] },
  resultsAndSignificance: { summary: "Cracking rose with the charge rate.", keyResults: [] },
});

/** A provider that counts its calls by pass and answers each with `replies[kind]`. */
function countingProvider(replies: Partial<Record<Kind, string | ((call: Call) => string)>> = {}) {
  const calls: Call[] = [];
  const provider: DigestProvider = {
    id: "gemini",
    generateDigest: async () => ({ bullets: [] }),
    testConnection: async () => ({ ok: true }),
    generateJsonText: async (args) => {
      const prompt = JSON.parse(args.userPrompt) as Record<string, unknown>;
      const call: Call = { kind: kindOf(prompt), tier: args.tier, systemPrompt: args.systemPrompt, userPrompt: args.userPrompt, prompt };
      calls.push(call);
      const reply = replies[call.kind];
      if (typeof reply === "function") return reply(call);
      if (typeof reply === "string") return reply;
      if (call.kind === "pass1") return JSON.stringify({ noveltyClaims: [], keyResults: [SENT.results], methodHighlights: [], priorWorkComparisons: [] });
      if (call.kind === "pass1q") return JSON.stringify({ questionRelevant: {} });
      return PASS2_REPLY;
    },
  };
  const count = (kind: Kind) => calls.filter((call) => call.kind === kind).length;
  const last = (kind: Kind) => [...calls].reverse().find((call) => call.kind === kind);
  return { provider, calls, count, last };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Pass 1 by section (§1g.1, §3d 10)", () => {
  it("receives every non-abstract section as { id, heading, text }, in the paper's order", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("by-section"), provider: stub.provider });

    const sections = stub.last("pass1")?.prompt.sections as Array<{ id: string; heading: string; text: string }>;
    expect(sections.map((section) => section.id)).toEqual(["s1", "s2", "s3", "s4"]);
    expect(sections.map((section) => section.heading)).toEqual(["1 Introduction", "2 Methods", "3 Results", "4 Discussion"]);
    expect(sections[1].text).toContain(SENT.methods);
    expect(stub.last("pass1")?.userPrompt).not.toContain("We charged quillwort cells fast and opened them.");
    expect(stub.last("pass1")?.tier).toBe("small");
  });

  it("gives a section without an id the one `withSectionIds` would (s<index>)", async () => {
    const doc = bigDoc("no-ids");
    // A document read before ids existed (the committed fixtures carry none).
    const sections = doc.sections.map((section) => {
      const copy: Partial<ExtractedSection> = { ...section };
      delete copy.id;
      return copy;
    }) as ExtractedSection[];
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: { ...doc, sections }, provider: stub.provider });

    const sent = stub.last("pass1")?.prompt.sections as Array<{ id: string }>;
    expect(sent.map((section) => section.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("asks for sentences with their sectionId, keeps a bare string, and keeps the sentence but not an unknown id", async () => {
    const stub = countingProvider({
      pass1: JSON.stringify({
        noveltyClaims: [{ text: SENT.intro, sectionId: "s1" }],
        keyResults: [SENT.results, { text: SENT.discussion, sectionId: "s99" }],
        methodHighlights: [{ text: SENT.methods, sectionId: "s2" }],
        priorWorkComparisons: [],
      }),
    });
    await generateDeepReport({ paper, doc: bigDoc("parse"), provider: stub.provider });

    const schema = stub.last("pass1")?.prompt.outputSchema as Record<string, unknown[]>;
    expect(JSON.stringify(schema.noveltyClaims)).toContain("sectionId");
    const body = stub.last("pass2")?.prompt.body as Record<string, unknown>;
    expect(body.noveltyClaims).toEqual([{ text: SENT.intro, sectionId: "s1" }]);
    expect(body.keyResults).toEqual([{ text: SENT.results }, { text: SENT.discussion }]);
    expect(body.methodHighlights).toEqual([{ text: SENT.methods, sectionId: "s2" }]);
    // The ids mean something to Pass 2: the section outline rides along.
    expect(body.sections).toEqual([
      { id: "s1", heading: "1 Introduction" },
      { id: "s2", heading: "2 Methods" },
      { id: "s3", heading: "3 Results" },
      { id: "s4", heading: "4 Discussion" },
    ]);
  });

  it("carries no question text: Pass 1 is the same prompt whatever the reader asked", async () => {
    const a = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("no-question-1"), provider: a.provider, questions: ["Why do quillwort cathodes crack?"] });
    const b = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("no-question-1b"), provider: b.provider });

    expect(a.last("pass1")?.userPrompt).not.toContain("Why do quillwort cathodes crack?");
    expect(a.last("pass1")?.userPrompt.replace("no-question-1", "")).toBe(b.last("pass1")?.userPrompt.replace("no-question-1b", ""));
  });
});

describe("the body is clipped, never the schema (§1g.2, §3d 10)", () => {
  /** A paper over Pass 1's 400 000-character budget: two long sections and a short one. */
  function oversized(): ExtractedDocument {
    return {
      source: "pdf",
      figureCaptions: [],
      sections: [
        { id: "s0", heading: "1 Introduction", canonical: "introduction", text: `${SENT.intro} ${PAD.repeat(3000)}` },
        { id: "s1", heading: "2 Methods", canonical: "methods", text: SENT.methods },
        { id: "s2", heading: "3 Results", canonical: "results", text: `${SENT.results} ${PAD.repeat(2500)}` },
      ],
    };
  }

  it("an oversized paper: the Pass 1 prompt fits, ends with its schema and rules whole, and its body is shorter than the paper", async () => {
    const doc = oversized();
    const docChars = doc.sections.reduce((sum, section) => sum + section.text.length, 0);
    expect(docChars).toBeGreaterThan(400_000);
    const stub = countingProvider();
    await generateDeepReport({ paper, doc, provider: stub.provider });

    const call = stub.last("pass1")!;
    expect(call.userPrompt.length).toBeLessThanOrEqual(400_000);
    const prompt = call.prompt as { sections: Array<{ id: string; text: string }>; outputSchema: unknown; rules: string[] };
    // Parsed whole, so nothing was cut out of the JSON; the schema and the
    // rules are the last two keys, untouched.
    expect(Object.keys(prompt).slice(-2)).toEqual(["outputSchema", "rules"]);
    expect(call.userPrompt.endsWith(`"rules":${JSON.stringify(prompt.rules)}}`)).toBe(true);
    expect(prompt.rules).toContain("Return ONLY valid JSON.");
    const bodyChars = prompt.sections.reduce((sum, section) => sum + section.text.length, 0);
    expect(bodyChars).toBeLessThan(docChars);
    // The longest are cut first: the short section is whole, the two long
    // ones are cut to the same length, each from its start.
    expect(prompt.sections[1].text).toBe(SENT.methods);
    expect(prompt.sections[0].text.length).toBe(prompt.sections[2].text.length);
    expect(doc.sections[0].text.startsWith(prompt.sections[0].text)).toBe(true);
    expect(doc.sections[2].text.startsWith(prompt.sections[2].text)).toBe(true);
  });

  it("a long abstract on a short paper: the Pass 2 prompt fits, ends with its schema and rules whole, the body cut", async () => {
    const doc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [
        { id: "s0", heading: "1 Introduction", canonical: "introduction", text: `${SENT.intro} ${PAD.repeat(60)}` },
        { id: "s1", heading: "2 Results", canonical: "results", text: `${SENT.results} ${PAD.repeat(50)}` },
      ],
    };
    const longAbstract = { ...paper, summaryIntro: `${PAD.repeat(200)}` };
    const stub = countingProvider();
    await generateDeepReport({ paper: longAbstract, doc, provider: stub.provider });

    expect(stub.count("pass1")).toBe(0);
    const call = stub.last("pass2")!;
    expect(call.userPrompt.length).toBeLessThanOrEqual(24_000);
    const prompt = call.prompt as { body: Array<{ text: string }>; outputSchema: Record<string, unknown>; rules: string[] };
    expect(Object.keys(prompt).slice(-2)).toEqual(["outputSchema", "rules"]);
    expect(call.userPrompt.endsWith(`"rules":${JSON.stringify(prompt.rules)}}`)).toBe(true);
    expect(Object.keys(prompt.outputSchema)).toEqual(expect.arrayContaining(["skim", "whatItProposes", "resultsAndSignificance", "limitations", "nextStep"]));
    const bodyChars = prompt.body.reduce((sum, section) => sum + section.text.length, 0);
    expect(bodyChars).toBeLessThan(doc.sections[0].text.length + doc.sections[1].text.length);
  });

  it("a small paper is sent whole: every section's text unchanged", async () => {
    const doc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [
        { id: "s0", heading: "Abstract", canonical: "abstract", text: "We charged quillwort cells fast." },
        { id: "s1", heading: "1 Introduction", canonical: "introduction", text: SENT.intro },
        { id: "s2", heading: "2 Results", canonical: "results", text: SENT.results },
      ],
    };
    const stub = countingProvider();
    await generateDeepReport({ paper, doc, provider: stub.provider });

    expect(stub.last("pass2")?.prompt.body).toEqual([
      { id: "s1", heading: "1 Introduction", text: SENT.intro },
      { id: "s2", heading: "2 Results", text: SENT.results },
    ]);

    const big = bigDoc("whole");
    const stub2 = countingProvider();
    await generateDeepReport({ paper, doc: big, provider: stub2.provider });
    const sent = stub2.last("pass1")?.prompt.sections as Array<{ text: string }>;
    expect(sent.map((section) => section.text)).toEqual(big.sections.slice(1).map((section) => section.text));
  });
});

describe("the question pass, Pass 1q (§1g.1, §3d 10)", () => {
  it("never runs without a question", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("no-q"), provider: stub.provider });
    await generateDeepReport({ paper, doc: bigDoc("no-q"), provider: stub.provider, questions: [" ", ""] });

    expect(stub.count("pass1q")).toBe(0);
    expect(stub.last("pass2")?.prompt).not.toHaveProperty("readerQuestions");
    expect(stub.last("pass2")?.prompt).not.toHaveProperty("questionRelevant");
  });

  it("reads only the sections the Tier 0 route marks for a question, on the small tier, within 60 000 body characters", async () => {
    // ~67 000 characters a section: the one marked section alone is over the budget.
    const doc = bigDoc("route-q", 800);
    const stub = countingProvider();
    await generateDeepReport({ paper, doc, provider: stub.provider, questions: ["Do grain boundaries crack?"] });

    const call = stub.last("pass1q")!;
    expect(call.tier).toBe("small");
    const sections = call.prompt.sections as Array<{ id: string; heading: string; text: string }>;
    // Only the results speak of grain boundaries cracking.
    expect(sections.map((section) => section.id)).toEqual(["s3"]);
    expect(sections[0].heading).toBe("3 Results");
    expect(JSON.stringify(sections).length).toBeLessThanOrEqual(60_000);
    expect(sections[0].text.length).toBeLessThan(doc.sections[3].text.length);
    expect(doc.sections[3].text.startsWith(sections[0].text)).toBe(true);
    expect(call.prompt.questions).toEqual(["Do grain boundaries crack?"]);
    expect(Object.keys(call.prompt).slice(-2)).toEqual(["outputSchema", "rules"]);
  });

  it("reads every section when the route marks none", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("route-none"), provider: stub.provider, questions: ["What is it?"] });

    const sections = stub.last("pass1q")?.prompt.sections as Array<{ id: string }>;
    expect(sections.map((section) => section.id)).toEqual(["s1", "s2", "s3", "s4"]);
  });

  it("keeps only verbatim sentences (≤ 8 per question), corrects a wrong sectionId, and hands them to Pass 2 by the reader's question order", async () => {
    // Sorted, "Alpha…" is question 0 for the model; in the request it is 1.
    const questions = ["Zeta: does cracking rise with the charge rate?", "Alpha: how many cells were cycled?"];
    const many = Array.from({ length: 10 }, () => SENT.results);
    const stub = countingProvider({
      pass1q: JSON.stringify({
        questionRelevant: {
          0: [
            { text: SENT.methods, sectionId: "s3" }, // right sentence, wrong section → s2
            { text: "We cycled a dozen cells at several rates for about a month.", sectionId: "s2" }, // paraphrase → dropped
            SENT.intro, // bare string → located in s1
          ],
          1: [...many.map((text, i) => (i === 0 ? { text, sectionId: "s3" } : `${text}`)), "Cracks."],
          7: [{ text: SENT.discussion, sectionId: "s4" }], // no such question → ignored
        },
      }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await generateDeepReport({ paper, doc: bigDoc("verify-q"), provider: stub.provider, questions });

    const pass1q = stub.last("pass1q")!;
    expect(pass1q.prompt.questions).toEqual([questions[1], questions[0]]);
    const pass2 = stub.last("pass2")!.prompt as { readerQuestions: string[]; questionRelevant: Record<string, Array<{ text: string; sectionId: string }>> };
    expect(pass2.readerQuestions).toEqual(questions);
    expect(pass2.questionRelevant["1"]).toEqual([
      { text: SENT.methods, sectionId: "s2" },
      { text: SENT.intro, sectionId: "s1" },
    ]);
    // Ten copies of one sentence are one sentence; "Cracks." is too short to verify.
    expect(pass2.questionRelevant["0"]).toEqual([{ text: SENT.results, sectionId: "s3" }]);
    expect(Object.keys(pass2.questionRelevant).sort()).toEqual(["0", "1"]);
    // The drops are counted in the log, and the log carries no question.
    const logged = warn.mock.calls.map((args) => args.join(" "));
    expect(logged.some((line) => /question pass dropped 2 sentence/.test(line))).toBe(true);
    for (const line of logged) for (const question of questions) expect(line).not.toContain(question);
  });

  // P2-08b (§1g.16, F1): Pass 1q's `locateSection` holds a sentence to the whole
  // quote as the answers' verifier does. A model sentence whose middle was
  // altered is not the paper's, whatever its first 80 and last 40 characters
  // say; the exact one beside it is kept. (Sentences here are ≤ 90 characters,
  // so the long one joins two of them, as a section would hold them.)
  it("drops and counts a sentence whose middle was altered, and keeps the exact one (P2-08b, §1g.16)", async () => {
    const joined = `${SENT.results} ${SENT.discussion}`;
    const altered = joined.replace("the simplest way", "the surest way");
    expect(joined.indexOf("simplest")).toBeGreaterThan(80);
    expect(joined.length - joined.indexOf("simplest")).toBeGreaterThan(40);
    const doc = bigDoc("altered-middle");
    doc.sections[3] = { ...doc.sections[3], text: `${joined} ${doc.sections[3].text}` };
    const stub = countingProvider({
      pass1q: JSON.stringify({ questionRelevant: { 0: [{ text: joined, sectionId: "s3" }, { text: altered, sectionId: "s3" }] } }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const question = "Does cracking rise with the charge rate?";
    await generateDeepReport({ paper, doc, provider: stub.provider, questions: [question] });

    const relevant = (stub.last("pass2")!.prompt.questionRelevant as Record<string, unknown[]>)["0"];
    expect(relevant).toEqual([{ text: joined, sectionId: "s3" }]);
    const logged = warn.mock.calls.map((args) => args.join(" "));
    expect(logged.some((line) => /question pass dropped 1 sentence/.test(line))).toBe(true);
    for (const line of logged) expect(line).not.toContain(question);
  });

  it("caps a question at eight sentences", async () => {
    const sentences = Array.from({ length: 12 }, (_, i) => `Sentence number ${i + 1} of the long results section is here, verbatim.`);
    const doc = bigDoc("cap-8");
    doc.sections[3] = { ...doc.sections[3], text: `${sentences.join(" ")} ${doc.sections[3].text}` };
    const stub = countingProvider({ pass1q: JSON.stringify({ questionRelevant: { 0: sentences.map((text) => ({ text, sectionId: "s3" })) } }) });
    await generateDeepReport({ paper, doc, provider: stub.provider, questions: ["Does cracking rise with the charge rate?"] });

    const relevant = (stub.last("pass2")!.prompt.questionRelevant as Record<string, unknown[]>)["0"];
    expect(relevant).toHaveLength(8);
    expect(relevant[7]).toEqual({ text: sentences[7], sectionId: "s3" });
  });

  it("caps the questions defensively: at most five, trimmed, empties dropped, 200 characters each", async () => {
    const long = `Why ${"really ".repeat(60)}does it crack?`;
    const stub = countingProvider();
    await generateDeepReport({
      paper,
      doc: bigDoc("cap-q"),
      provider: stub.provider,
      questions: ["  Does it crack?  ", "", "   ", long, "Q3 about charge?", "Q4 about cells?", "Q5 about rooms?", "Q6 about time?"],
    });

    const asked = stub.last("pass2")!.prompt.readerQuestions as string[];
    expect(asked).toHaveLength(5);
    expect(asked[0]).toBe("Does it crack?");
    expect(asked[1]).toHaveLength(200);
    expect(asked).not.toContain("");
    expect(asked).not.toContain("Q6 about time?");
  });

  it("a failed question pass leaves the report to Pass 2, logs no question, and is not cached", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    let fail = true;
    const stub = countingProvider({
      pass1q: () => {
        if (fail) throw new Error("model said no about: Why does the quillwort crack?");
        return JSON.stringify({ questionRelevant: { 0: [SENT.results] } });
      },
    });
    const questions = ["Why does the quillwort crack?"];
    const report = await generateDeepReport({ paper, doc: bigDoc("fail-q"), provider: stub.provider, questions });

    expect(report).not.toBeNull();
    expect(stub.last("pass2")?.prompt.questionRelevant).toEqual({});
    for (const line of [...error.mock.calls, ...warn.mock.calls].map((args) => args.map(String).join(" "))) {
      expect(line).not.toContain("quillwort crack");
    }

    fail = false;
    await generateDeepReport({ paper, doc: bigDoc("fail-q"), provider: stub.provider, questions });
    expect(stub.count("pass1q")).toBe(2);
    expect((stub.last("pass2")?.prompt.questionRelevant as Record<string, unknown>)["0"]).toEqual([{ text: SENT.results, sectionId: "s3" }]);
  });
});

describe("no question in any log line (§1g.4)", () => {
  it("a failed Pass 2 with questions logs the kind of failure, not its message", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const stub = countingProvider({
      pass2: () => {
        throw new TypeError("upstream echoed the prompt: Why does the quillwort crack?");
      },
    });
    const report = await generateDeepReport({ paper, doc: bigDoc("fail-2"), provider: stub.provider, questions: ["Why does the quillwort crack?"] });

    expect(report).toBeNull();
    const lines = error.mock.calls.map((args) => args.map(String).join(" "));
    expect(lines).toEqual(["[papers/deep-report] generation failed: TypeError"]);
  });
});

describe("the caches (§1g.4, §3d 11) — a counting provider", () => {
  it("same paper, two question sets: Pass 1 once, Pass 1q twice, Pass 2 twice", async () => {
    const stub = countingProvider();
    const doc = bigDoc("two-sets");
    await generateDeepReport({ paper, doc, provider: stub.provider, questions: ["Does cracking rise with charge rate?"] });
    await generateDeepReport({ paper, doc: bigDoc("two-sets"), provider: stub.provider, questions: ["How many cells were cycled?"] });

    expect([stub.count("pass1"), stub.count("pass1q"), stub.count("pass2")]).toEqual([1, 2, 2]);
  });

  it("the same question set twice within the hour (in any order): Pass 1 once, Pass 1q once, Pass 2 twice", async () => {
    const stub = countingProvider({ pass1q: JSON.stringify({ questionRelevant: { 0: [SENT.methods], 1: [SENT.results] } }) });
    const doc = bigDoc("same-set");
    const questions = ["How many cells were cycled?", "Does cracking rise with charge rate?"];
    await generateDeepReport({ paper, doc, provider: stub.provider, questions });
    const first = stub.last("pass2")!.prompt.questionRelevant;
    await generateDeepReport({ paper, doc, provider: stub.provider, questions: [questions[1], questions[0]] });
    const second = stub.last("pass2")!.prompt.questionRelevant as Record<string, unknown>;

    expect([stub.count("pass1"), stub.count("pass1q"), stub.count("pass2")]).toEqual([1, 1, 2]);
    // The cached sentences follow their question to its new place.
    expect(second["0"]).toEqual((first as Record<string, unknown>)["1"]);
    expect(second["1"]).toEqual((first as Record<string, unknown>)["0"]);
  });

  it("no questions: Pass 1q is never called, and Pass 1 is still read from the cache", async () => {
    const stub = countingProvider();
    const doc = bigDoc("no-questions");
    await generateDeepReport({ paper, doc, provider: stub.provider });
    await generateDeepReport({ paper, doc, provider: stub.provider });

    expect([stub.count("pass1"), stub.count("pass1q"), stub.count("pass2")]).toEqual([1, 0, 2]);
  });

  it("forgets after an hour", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-05T12:00:00.000Z"));
    const stub = countingProvider();
    const doc = bigDoc("ttl");
    const questions = ["Does cracking rise with charge rate?"];
    await generateDeepReport({ paper, doc, provider: stub.provider, questions });
    vi.setSystemTime(new Date("2026-10-05T12:59:00.000Z"));
    await generateDeepReport({ paper, doc, provider: stub.provider, questions });
    expect([stub.count("pass1"), stub.count("pass1q")]).toEqual([1, 1]);

    vi.setSystemTime(new Date("2026-10-05T13:01:00.000Z"));
    await generateDeepReport({ paper, doc, provider: stub.provider, questions });
    expect([stub.count("pass1"), stub.count("pass1q")]).toEqual([2, 2]);
  });

  it("holds at most 32 papers: the oldest is forgotten first", async () => {
    const stub = countingProvider();
    for (let i = 0; i < 33; i += 1) await generateDeepReport({ paper, doc: bigDoc(`lru-${i}`), provider: stub.provider });
    expect(stub.count("pass1")).toBe(33);

    await generateDeepReport({ paper, doc: bigDoc("lru-32"), provider: stub.provider });
    expect(stub.count("pass1")).toBe(33);
    await generateDeepReport({ paper, doc: bigDoc("lru-0"), provider: stub.provider });
    expect(stub.count("pass1")).toBe(34);
  });

  it("does not keep a Pass 1 answer that was not JSON", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const stub = countingProvider({ pass1: "not json at all" });
    const doc = bigDoc("not-json");
    await generateDeepReport({ paper, doc, provider: stub.provider });
    await generateDeepReport({ paper, doc, provider: stub.provider });

    expect(stub.count("pass1")).toBe(2);
  });
});

// ── P2-02 (§1g.3, §1g.10; acceptance §3d 9, 10) ──────────────────────

/** A paper short enough for Pass 2 to read whole (Pass 1 skipped). */
function shortDoc(): ExtractedDocument {
  return {
    source: "pdf",
    pageCount: 4,
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "Abstract", canonical: "abstract", text: "We charged quillwort cells fast and opened them." },
      { id: "s1", heading: "1 Introduction", canonical: "introduction", text: SENT.intro, page: 1 },
      { id: "s2", heading: "2 Methods", canonical: "methods", text: SENT.methods, page: 2 },
      { id: "s3", heading: "3 Results", canonical: "results", text: SENT.results, page: 4 },
    ],
  };
}

const QUESTION_KEYS = ["forYourQuestions", "terms"];
const QUESTION_WORDS = /forYourQuestions|readNext|terms|readerQuestions|questionRelevant|whole paper is in/;

describe("Pass 2 asks for answers only when the reader asked (§1g.3)", () => {
  it("without questions: no forYourQuestions or terms in the schema, and no rule about them", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: shortDoc(), provider: stub.provider });
    await generateDeepReport({ paper, doc: bigDoc("schema-none"), provider: stub.provider });

    for (const call of stub.calls.filter((c) => c.kind === "pass2")) {
      const prompt = call.prompt as { outputSchema: Record<string, unknown>; rules: string[] };
      for (const key of QUESTION_KEYS) expect(prompt.outputSchema).not.toHaveProperty(key);
      for (const rule of prompt.rules) expect(rule).not.toMatch(QUESTION_WORDS);
    }
  });

  it("with questions: the schema asks for forYourQuestions (verdict, ≤3 answers with evidence and sectionId, ≤4 readNext with kind) and ≤8 terms; the rules say how", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("schema-q"), provider: stub.provider, questions: ["Does cracking rise with the charge rate?"] });

    const prompt = stub.last("pass2")!.prompt as { outputSchema: Record<string, unknown>; rules: string[] };
    const fyq = (prompt.outputSchema.forYourQuestions as Array<Record<string, unknown>>)[0];
    expect(Object.keys(fyq)).toEqual(["question", "verdict", "answers", "readNext"]);
    expect(String(fyq.verdict)).toMatch(/answered.*partly.*not_addressed/);
    expect(Object.keys((fyq.answers as Array<Record<string, unknown>>)[0])).toEqual(["text", "evidence", "sectionId"]);
    expect(Object.keys((fyq.readNext as Array<Record<string, unknown>>)[0])).toEqual(["sectionId", "why", "kind"]);
    expect(JSON.stringify(fyq)).toMatch(/max 3/);
    expect(JSON.stringify(fyq.readNext)).toMatch(/max 4/);
    expect(Object.keys((prompt.outputSchema.terms as Array<Record<string, unknown>>)[0])).toEqual(["term", "definition", "evidence"]);
    expect(JSON.stringify(prompt.outputSchema.terms)).toMatch(/max 8/);
    const rules = prompt.rules.join("\n");
    expect(rules).toMatch(/character-for-character/);
    expect(rules).toMatch(/`sectionId` is the `id` of a section/);
    expect(rules).toMatch(/"background"/);
    expect(rules).toMatch(/Peer's own words/);
    expect(Object.keys(prompt).slice(-2)).toEqual(["outputSchema", "rules"]);
  });

  it("returns the answers with the request's question, verified, placed and paged", async () => {
    const question = "Does cracking rise with the charge rate?";
    const stub = countingProvider({
      pass2: JSON.stringify({
        ...JSON.parse(PASS2_REPLY),
        forYourQuestions: [
          {
            question: "the model's own wording",
            verdict: "answered",
            answers: [
              { text: "Yes, in every cell.", evidence: SENT.results, sectionId: "s2" },
              { text: "Invented.", evidence: "Cracking fell sharply once the charge rate passed a threshold value.", sectionId: "s3" },
            ],
            readNext: [{ sectionId: "s3", why: "The counts per cell.", kind: "answer" }, { sectionId: "s77", why: "Nowhere.", kind: "answer" }],
          },
        ],
        terms: [{ term: "charge rate", definition: "How fast a cell is charged." }],
      }),
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const report = await generateDeepReport({ paper, doc: shortDoc(), provider: stub.provider, questions: [question] });

    expect(report?.forYourQuestions).toEqual([
      {
        question,
        verdict: "answered",
        answers: [{ text: "Yes, in every cell.", evidence: SENT.results, evidenceWhere: "3 Results", sectionId: "s3", page: 4 }],
        readNext: [{ sectionId: "s3", why: "The counts per cell.", kind: "answer" }],
      },
    ]);
    expect(report?.terms).toEqual([{ term: "charge rate", definition: "How fast a cell is charged.", peer: true }]);
    expect(report?.provenance.droppedClaims).toBe(2);
    for (const line of warn.mock.calls.map((args) => args.join(" "))) expect(line).not.toContain(question);
  });
});

describe("the question evidence has its own budget (§1g.10 a)", () => {
  it("five questions with eight long sentences each: the evidence fits 12 000 characters by whole sentences, and the body is no shorter than without questions", async () => {
    // 40 distinct sentences of ~330 characters, all in the paper.
    const sentence = (q: number, i: number) =>
      `Observation ${q}-${i} records that quillwort cell number ${q * 10 + i} cracked along its grain boundaries after charging, ` +
      "and the crack length grew with every further cycle at the faster rate, which the authors measured under the microscope in the same warm room each week, " +
      "always by the same two people.";
    const doc = bigDoc("budget");
    const all = Array.from({ length: 5 }, (_, q) => Array.from({ length: 8 }, (_, i) => sentence(q, i)));
    doc.sections[3] = { ...doc.sections[3], text: `${all.flat().join(" ")} ${doc.sections[3].text}` };
    const questions = ["Q1 about cracks?", "Q2 about cycles?", "Q3 about rates?", "Q4 about rooms?", "Q5 about weeks?"];
    // A long abstract so the body is at Pass 2's edge without questions.
    const longPaper = { ...paper, summaryIntro: PAD.repeat(180) };
    const pass1 = JSON.stringify({
      noveltyClaims: all[0].slice(0, 6),
      keyResults: all[1].slice(0, 6),
      methodHighlights: all[2].slice(0, 6),
      priorWorkComparisons: all[3].slice(0, 6),
    });
    const stub = countingProvider({
      pass1,
      pass1q: JSON.stringify({ questionRelevant: Object.fromEntries(all.map((list, q) => [q, list.map((text) => ({ text, sectionId: "s3" }))])) }),
    });
    await generateDeepReport({ paper: longPaper, doc, provider: stub.provider });
    const without = stub.last("pass2")!.prompt as { body: Record<string, Array<{ text: string }>> };
    await generateDeepReport({ paper: longPaper, doc, provider: stub.provider, questions });
    const withQ = stub.last("pass2")!.prompt as { body: Record<string, Array<{ text: string }>>; questionRelevant: Record<string, Array<{ text: string }>> };

    const bodyChars = (body: Record<string, Array<{ text: string }>>) =>
      ["noveltyClaims", "keyResults", "methodHighlights", "priorWorkComparisons"].reduce((sum, key) => sum + body[key].reduce((s, item) => s + item.text.length, 0), 0);
    // The body was cut to fit even without questions — it is at the edge.
    const signalChars = all.slice(0, 4).reduce((sum, list) => sum + list.slice(0, 6).join("").length, 0);
    expect(bodyChars(without.body)).toBeLessThan(signalChars);
    expect(bodyChars(withQ.body)).toBeGreaterThanOrEqual(bodyChars(without.body));
    expect(withQ.body).toEqual(without.body);

    const evidence = withQ.questionRelevant;
    expect(JSON.stringify(evidence).length).toBeLessThanOrEqual(12_000);
    // Whole sentences only, each the paper's, and every question keeps some.
    const kept = Object.values(evidence).flat();
    expect(kept.length).toBeLessThan(40);
    for (const item of kept) expect(all.flat()).toContain(item.text);
    // Sorted: Q1…Q5 sort as typed, so the model's 0…4 are the request's 0…4.
    const counts = Object.keys(evidence).sort().map((key) => evidence[key].length);
    expect(counts).toHaveLength(5);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
    for (const key of Object.keys(evidence)) {
      const q = Number(key);
      expect(evidence[key].map((item) => item.text)).toEqual(all[q].slice(0, evidence[key].length));
    }
  });
});

describe("no Pass 1q on a short paper (§1g.10 b)", () => {
  it("questions on a short document: Pass 1 0, Pass 1q 0, Pass 2 1; no questionRelevant; the rules say the whole paper is there", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: shortDoc(), provider: stub.provider, questions: ["Does cracking rise with the charge rate?"] });

    expect([stub.count("pass1"), stub.count("pass1q"), stub.count("pass2")]).toEqual([0, 0, 1]);
    const prompt = stub.last("pass2")!.prompt as { readerQuestions: string[]; rules: string[] };
    expect(prompt).not.toHaveProperty("questionRelevant");
    expect(prompt.readerQuestions).toEqual(["Does cracking rise with the charge rate?"]);
    expect(prompt.rules.join("\n")).toMatch(/The whole paper is in `body`; quote from there\./);
  });

  it("a long paper keeps Pass 1q and its evidence", async () => {
    const stub = countingProvider();
    await generateDeepReport({ paper, doc: bigDoc("long-keeps-1q"), provider: stub.provider, questions: ["Does cracking rise with the charge rate?"] });

    expect([stub.count("pass1"), stub.count("pass1q"), stub.count("pass2")]).toEqual([1, 1, 1]);
    expect(stub.last("pass2")!.prompt).toHaveProperty("questionRelevant");
    expect((stub.last("pass2")!.prompt.rules as string[]).join("\n")).not.toMatch(/whole paper is in/);
  });
});
