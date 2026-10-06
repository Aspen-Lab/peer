import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { sectionParagraphs, openingOf } from "./reading-map";
import {
  EXPLAIN_CAPS,
  buildExplainPrompt,
  clipPassage,
  createExplainCache,
  explainCacheKey,
  explainDayKey,
  explainDocHash,
  explainMapLines,
  locatePassage,
  parseModelJson,
  sanitizeExplainAnswer,
  verifyExplainAnswer,
  type ExplainAnswer,
} from "./explain";

// P3-02 (ruling §1h.2; §3d 14): the pure half of "Explain this?" — the
// passage clipped and found in the paper, the prompt, the two-part answer
// sanitised and its quote verified, and the server's one-hour memory. All
// text below is invented; nothing here is a reader's or a private PDF's.

const RAFT_DEF = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const RAFT_USE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const RAFT_SECOND = "Tungsten additions slowed the rafting ratio by about a third in every test.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 4,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "The abstract names the rafting ratio and tungsten additions in one long sentence." },
    {
      id: "s1",
      heading: "1 Introduction",
      canonical: "introduction",
      page: 1,
      text: [
        "Hot turbine blades creep slowly under load and lose their shape over many hours.",
        "Rafting describes how precipitates join into plates under stress and heat.",
        "A shared sentence appears in both sections for the hint tests to separate.",
      ].join("\n\n"),
    },
    {
      id: "s2",
      heading: "2 Methods",
      canonical: "methods",
      page: 2,
      text: [
        "Specimens were machined from a single casting and heat treated together.",
        RAFT_DEF,
        "A shared sentence appears in both sections for the hint tests to separate.",
        "Each creep test ran at constant load until the specimen failed.",
      ].join("\n\n"),
    },
    {
      id: "s3",
      heading: "3 Results",
      canonical: "results",
      page: 3,
      text: [RAFT_USE, RAFT_SECOND].join("\n\n"),
    },
  ],
};

const SHARED = "A shared sentence appears in both sections for the hint tests to separate.";

describe("clipPassage", () => {
  it("trims and collapses every run of whitespace", () => {
    expect(clipPassage("  The   rafting\n\tratio  rose.  ")).toBe("The rafting ratio rose.");
  });

  it("leaves a passage within the cap as it is", () => {
    const passage = "word ".repeat(100).trim();
    expect(clipPassage(passage)).toBe(passage);
    expect(EXPLAIN_CAPS.passageChars).toBe(1200);
  });

  it("cuts a longer one at a word boundary, within 1,200 characters", () => {
    const passage = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
    const clipped = clipPassage(passage);

    expect(clipped.length).toBeLessThanOrEqual(1200);
    expect(clipped.length).toBeGreaterThan(1100);
    expect(passage.startsWith(clipped)).toBe(true);
    // The next character in the source is a space, so no word was cut in half.
    expect(passage[clipped.length]).toBe(" ");
  });

  it("hard-cuts an unbroken run, still within the cap", () => {
    expect(clipPassage("x".repeat(3000))).toHaveLength(1200);
  });

  it("is empty for nothing", () => {
    expect(clipPassage("")).toBe("");
    expect(clipPassage(" \n\t ")).toBe("");
  });
});

describe("locatePassage", () => {
  it("finds the paragraph that holds the passage, with its place in the body", () => {
    const found = locatePassage(doc, "rafting ratio as the fraction of the gauge length");

    expect(found).toMatchObject({ sectionId: "s2", paragraphIndex: 1, paragraph: RAFT_DEF });
    // The abstract is not rendered, so the Methods section is body section 1.
    expect(found?.sectionIndex).toBe(1);
  });

  it("matches the way the verifier does: case, whitespace and hyphen breaks fold", () => {
    expect(locatePassage(doc, "RAFTING   ratio\nas the fraction")?.sectionId).toBe("s2");
    expect(locatePassage(doc, "Tungsten additions slowed the raft- ing ratio")?.sectionId).toBe("s3");
  });

  it("tries the hinted paragraph first, even when an earlier one holds the same words", () => {
    const hinted = locatePassage(doc, "shared sentence appears", { sectionId: "s2", paragraphIndex: 2 });
    const unhinted = locatePassage(doc, "shared sentence appears");

    expect(hinted).toMatchObject({ sectionId: "s2", paragraphIndex: 2 });
    expect(unhinted).toMatchObject({ sectionId: "s1", paragraphIndex: 2 });
  });

  it("then the hinted section, when the hinted paragraph does not hold it", () => {
    const found = locatePassage(doc, "Each creep test ran at constant load", { sectionId: "s2", paragraphIndex: 0 });

    expect(found).toMatchObject({ sectionId: "s2", paragraphIndex: 3 });
  });

  it("then the whole document, when the hint names the wrong section or nothing", () => {
    expect(locatePassage(doc, "rose from 0.2 to 0.7", { sectionId: "s1", paragraphIndex: 0 })).toMatchObject({ sectionId: "s3", paragraphIndex: 0 });
    expect(locatePassage(doc, "rose from 0.2 to 0.7", { sectionId: "nope", paragraphIndex: 9 })).toMatchObject({ sectionId: "s3" });
    expect(locatePassage(doc, "rose from 0.2 to 0.7", {})).toMatchObject({ sectionId: "s3" });
  });

  it("is null when the words are nowhere in the body — the selection was not the paper's text", () => {
    expect(locatePassage(doc, "a sentence the paper never wrote")).toBeNull();
    expect(locatePassage(doc, "")).toBeNull();
    expect(locatePassage(doc, "   ")).toBeNull();
  });

  it("does not look in the abstract: the body is what a reader selects from", () => {
    expect(locatePassage(doc, "names the rafting ratio and tungsten additions in one long sentence")).toBeNull();
  });

  it("gives the paragraph before and after, within the section", () => {
    const middle = locatePassage(doc, "fraction of the gauge length");
    const first = locatePassage(doc, "Specimens were machined from a single casting");
    const last = locatePassage(doc, "Each creep test ran at constant load");

    expect(middle?.before).toBe("Specimens were machined from a single casting and heat treated together.");
    expect(middle?.after).toBe(SHARED);
    expect(first?.before).toBeNull();
    expect(first?.after).toBe(RAFT_DEF);
    expect(last?.after).toBeNull();
    expect(last?.before).toBe(SHARED);
    // The section's first paragraph does not borrow the previous section's last.
    expect(locatePassage(doc, RAFT_USE, { sectionId: "s3", paragraphIndex: 0 })?.before).toBeNull();
  });

  it("counts paragraphs the way the body does: debris and equation markers are not paragraphs", () => {
    const withDebris: ExtractedDocument = {
      ...doc,
      sections: [
        doc.sections[1],
        { id: "s2", heading: "2 Methods", canonical: "methods", text: ["1:", "Plain paragraph one has the words needed here.", "Plain paragraph two follows the first one."].join("\n\n") },
      ],
    };
    const found = locatePassage(withDebris, "Plain paragraph two follows");

    expect(found?.paragraphIndex).toBe(1);
    expect(found?.paragraph).toBe(sectionParagraphs(withDebris.sections[1], []).paragraphs[1]);
  });
});

describe("explainMapLines", () => {
  it("is one line per rendered section: its heading and how its first paragraph opens", () => {
    const lines = explainMapLines(doc);

    expect(lines.map((line) => line.heading)).toEqual(["1 Introduction", "2 Methods", "3 Results"]);
    expect(lines[1].opening).toBe(openingOf("Specimens were machined from a single casting and heat treated together."));
    expect(lines[1].opening).not.toBeNull();
  });
});

describe("buildExplainPrompt", () => {
  const located = locatePassage(doc, "fraction of the gauge length")!;
  const built = buildExplainPrompt({
    paper: { title: "Rafting under creep in a nickel alloy", abstract: "The abstract says why rafting matters for turbine blades." },
    map: explainMapLines(doc),
    located,
    passage: "fraction of the gauge length",
  });
  const user = JSON.parse(built.userPrompt) as Record<string, unknown>;

  it("speaks in Peer's voice and asks for JSON only", () => {
    expect(built.systemPrompt).toMatch(/Peer/);
    expect(built.systemPrompt).toMatch(/valid JSON/i);
  });

  it("carries the title, the abstract, the map's lines, the paragraph and its neighbours, and the passage", () => {
    expect(built.userPrompt).toContain("Rafting under creep in a nickel alloy");
    expect(built.userPrompt).toContain("The abstract says why rafting matters for turbine blades.");
    expect(built.userPrompt).toContain("1 Introduction");
    expect(built.userPrompt).toContain("3 Results");
    expect(built.userPrompt).toContain("Specimens were machined from a single casting and heat treated together.");
    expect(built.userPrompt).toContain(RAFT_DEF);
    expect(built.userPrompt).toContain(SHARED);
    expect(user.passage).toBe("fraction of the gauge length");
  });

  it("has exactly these parts and nothing about the reader", () => {
    expect(Object.keys(user)).toEqual(["task", "paper", "sections", "context", "passage", "outputSchema", "rules"]);
    expect(Object.keys(user.paper as object)).toEqual(["title", "abstract"]);
    expect(built.userPrompt).not.toMatch(/profile|project|question|challenge|readerProject/i);
  });

  it("names the two parts and asks for one verbatim sentence", () => {
    const schema = user.outputSchema as { meaning: string; here: { text: string; evidence: string } };
    expect(schema.meaning).toMatch(/two sentences/i);
    expect(schema.here.text).toMatch(/why/i);
    expect(schema.here.evidence).toMatch(/character-for-character/);
    expect((user.rules as string[]).join(" ")).toMatch(/Omit `evidence`/);
  });

  it("leaves out a neighbour that does not exist", () => {
    const first = locatePassage(doc, "Specimens were machined from a single casting")!;
    const prompt = JSON.parse(
      buildExplainPrompt({ paper: { title: "T", abstract: "A" }, map: [], located: first, passage: "Specimens were machined" }).userPrompt,
    ) as { context: Record<string, unknown> };

    expect(Object.keys(prompt.context)).toEqual(["paragraph", "after"]);
  });

  it("bounds what it sends: a huge abstract, paragraph and map are cut", () => {
    const huge = "word ".repeat(5000);
    const big = buildExplainPrompt({
      paper: { title: "t".repeat(2000), abstract: huge },
      map: Array.from({ length: 300 }, (_, i) => ({ heading: `Section ${i}`, opening: huge })),
      located: { ...located, paragraph: huge, before: huge, after: huge },
      passage: "x".repeat(5000),
    });
    const parsed = JSON.parse(big.userPrompt) as {
      paper: { title: string; abstract: string };
      sections: { heading: string; opening: string | null }[];
      context: { paragraph: string; before: string; after: string };
      passage: string;
    };

    expect(parsed.paper.title.length).toBeLessThanOrEqual(EXPLAIN_CAPS.titleChars);
    expect(parsed.paper.abstract.length).toBeLessThanOrEqual(EXPLAIN_CAPS.abstractChars);
    expect(parsed.sections.length).toBeLessThanOrEqual(EXPLAIN_CAPS.mapLines);
    for (const line of parsed.sections) expect((line.opening ?? "").length).toBeLessThanOrEqual(EXPLAIN_CAPS.openingChars);
    expect(parsed.context.paragraph.length).toBeLessThanOrEqual(EXPLAIN_CAPS.paragraphChars);
    expect(parsed.context.before.length).toBeLessThanOrEqual(EXPLAIN_CAPS.neighbourChars);
    expect(parsed.context.after.length).toBeLessThanOrEqual(EXPLAIN_CAPS.neighbourChars);
    expect(parsed.passage.length).toBeLessThanOrEqual(EXPLAIN_CAPS.passageChars);
    // The schema and the rules are never what gets cut.
    expect(parsed).toHaveProperty("outputSchema");
    expect(Array.isArray((JSON.parse(big.userPrompt) as { rules: unknown }).rules)).toBe(true);
  });
});

describe("parseModelJson", () => {
  it("reads the model's text however it was wrapped", () => {
    const object = { meaning: "m", here: { text: "t" } };
    const json = JSON.stringify(object);

    expect(parseModelJson(json)).toEqual(object);
    expect(parseModelJson(`  ${json}\n`)).toEqual(object);
    expect(parseModelJson("```json\n" + json + "\n```")).toEqual(object);
    expect(parseModelJson(`Here is the answer: ${json} Hope that helps.`)).toEqual(object);
  });

  it("is null for text with no object in it", () => {
    expect(parseModelJson("no json here")).toBeNull();
    expect(parseModelJson("")).toBeNull();
    expect(parseModelJson("{ not: valid }")).toBeNull();
  });
});

describe("explainDocHash", () => {
  it("is the document's: the same for the same document, different for a changed one", () => {
    expect(explainDocHash(doc)).toMatch(/^[0-9a-f]{64}$/);
    expect(explainDocHash(doc)).toBe(explainDocHash(JSON.parse(JSON.stringify(doc)) as ExtractedDocument));
    expect(explainDocHash({ ...doc, sections: doc.sections.slice(1) })).not.toBe(explainDocHash(doc));
  });
});

describe("sanitizeExplainAnswer", () => {
  const good = {
    meaning: "A rafting ratio measures how much of a sample has turned into plates.",
    here: { text: "The authors use it to compare alloys fairly.", evidence: RAFT_DEF },
  };

  it("keeps a well-formed answer, trimmed", () => {
    const answer = sanitizeExplainAnswer({ meaning: `  ${good.meaning}  `, here: { text: ` ${good.here.text} `, evidence: ` ${RAFT_DEF} ` } });

    expect(answer).toEqual({ meaning: good.meaning, here: { text: good.here.text, evidence: RAFT_DEF } });
  });

  it("clips each part to two sentences", () => {
    const answer = sanitizeExplainAnswer({
      meaning: "One is plain. Two is plain too. Three must go. Four must go.",
      here: { text: "First reason. Second reason. Third reason.", evidence: RAFT_DEF },
    });

    expect(answer?.meaning).toBe("One is plain. Two is plain too.");
    expect(answer?.here.text).toBe("First reason. Second reason.");
  });

  it("caps a part's length", () => {
    const long = `${"word ".repeat(300)}.`;
    const answer = sanitizeExplainAnswer({ meaning: long, here: { text: long } });

    expect(answer?.meaning.length).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
    expect(answer?.here.text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
  });

  it("keeps no key it was not asked for, and trusts no place or label the model claims", () => {
    const answer = sanitizeExplainAnswer({
      meaning: good.meaning,
      extra: "x",
      here: { text: good.here.text, evidence: RAFT_DEF, evidenceWhere: "Everything", sectionId: "s99", page: 7, peer: true, other: 1 },
    });

    expect(answer).toEqual({ meaning: good.meaning, here: { text: good.here.text, evidence: RAFT_DEF } });
  });

  it("caps the quote it will try to verify", () => {
    const answer = sanitizeExplainAnswer({ meaning: good.meaning, here: { text: good.here.text, evidence: "q".repeat(2000) } });

    expect(answer?.here.evidence?.length).toBeLessThanOrEqual(EXPLAIN_CAPS.evidenceChars);
  });

  it("drops an evidence that is not a string or is empty", () => {
    expect(sanitizeExplainAnswer({ meaning: good.meaning, here: { text: good.here.text, evidence: 5 } })?.here).toEqual({ text: good.here.text });
    expect(sanitizeExplainAnswer({ meaning: good.meaning, here: { text: good.here.text, evidence: "  " } })?.here).toEqual({ text: good.here.text });
  });

  it("is null unless both parts have words", () => {
    expect(sanitizeExplainAnswer(null)).toBeNull();
    expect(sanitizeExplainAnswer("a string")).toBeNull();
    expect(sanitizeExplainAnswer([good])).toBeNull();
    expect(sanitizeExplainAnswer({})).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: "", here: { text: "x" } })).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: "x", here: { text: " " } })).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: "x" })).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: "x", here: "text" })).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: 4, here: { text: "x" } })).toBeNull();
  });
});

describe("verifyExplainAnswer", () => {
  const answer: ExplainAnswer = { meaning: "A measure of plate coverage.", here: { text: "It compares alloys.", evidence: RAFT_DEF } };

  it("sets the section, its heading and its page on a quote the paper holds", () => {
    const verified = verifyExplainAnswer(answer, doc);

    expect(verified.here).toEqual({ text: "It compares alloys.", evidence: RAFT_DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 });
    expect(verified.here.peer).toBeUndefined();
    expect(verified.meaning).toBe(answer.meaning);
  });

  it("tries the section it was told to prefer first", () => {
    const twice: ExtractedDocument = {
      ...doc,
      sections: [...doc.sections, { id: "s4", heading: "4 Discussion", canonical: "discussion", page: 4, text: RAFT_DEF }],
    };

    expect(verifyExplainAnswer(answer, twice, "s4").here).toMatchObject({ sectionId: "s4", evidenceWhere: "4 Discussion", page: 4 });
    expect(verifyExplainAnswer(answer, twice, "s2").here).toMatchObject({ sectionId: "s2" });
    expect(verifyExplainAnswer(answer, twice).here).toMatchObject({ sectionId: "s2" });
  });

  it("leaves out the page for a source that has none", () => {
    const html: ExtractedDocument = {
      ...doc,
      sections: doc.sections.map((section) => {
        const bare = { ...section };
        delete bare.page;
        return bare;
      }),
    };
    const verified = verifyExplainAnswer(answer, html);

    expect(verified.here.sectionId).toBe("s2");
    expect("page" in verified.here).toBe(false);
  });

  it("removes a quote the paper does not hold and labels the prose as Peer's own", () => {
    const invented = verifyExplainAnswer(
      { meaning: answer.meaning, here: { text: "It compares alloys.", evidence: "We define the rafting ratio as the share of every plate that covered a crack.", evidenceWhere: "2 Methods", sectionId: "s2", page: 2 } },
      doc,
    );

    expect(invented.here).toEqual({ text: "It compares alloys.", peer: true });
  });

  it("holds the whole quote, not its start: a changed ending is dropped", () => {
    const changed = verifyExplainAnswer(
      { meaning: answer.meaning, here: { text: "x", evidence: `${RAFT_DEF.slice(0, -12)} by the failed zones.` } },
      doc,
    );

    expect(changed.here).toEqual({ text: "x", peer: true });
  });

  it("drops a quote too short to say anything", () => {
    expect(verifyExplainAnswer({ meaning: "m", here: { text: "x", evidence: "rafting ratio" } }, doc).here).toEqual({ text: "x", peer: true });
  });

  it("labels an answer with no quote as Peer's own", () => {
    expect(verifyExplainAnswer({ meaning: "m", here: { text: "x" } }, doc).here).toEqual({ text: "x", peer: true });
  });

  it("changes nothing in the answer it was given", () => {
    const given: ExplainAnswer = { meaning: "m", here: { text: "x", evidence: "not in the paper at all, not a word of it, ever" } };
    const copy = JSON.parse(JSON.stringify(given)) as ExplainAnswer;
    verifyExplainAnswer(given, doc);

    expect(given).toEqual(copy);
  });
});

describe("explainCacheKey", () => {
  const base = explainCacheKey("doc-hash", "The rafting ratio", []);

  it("is a sha256 that carries none of the passage", () => {
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the same for the same document, passage and thread — however the passage is spaced or cased", () => {
    expect(explainCacheKey("doc-hash", "  the  RAFTING\nratio ", [])).toBe(base);
  });

  it("changes with the document, the passage and the thread", () => {
    expect(explainCacheKey("other-doc", "The rafting ratio", [])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting", [])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", ["a reply"])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", ["a reply"])).not.toBe(explainCacheKey("doc-hash", "The rafting ratio", ["another"]));
  });
});

describe("explainDayKey", () => {
  it("names the reader and the UTC day, so it rolls over at midnight UTC", () => {
    const key = explainDayKey("user-1", new Date("2026-10-06T23:59:59.000Z"));

    expect(key).toContain("user-1");
    expect(key).toContain("2026-10-06");
    expect(explainDayKey("user-1", new Date("2026-10-07T00:00:01.000Z"))).not.toBe(key);
    expect(explainDayKey("user-2", new Date("2026-10-06T10:00:00.000Z"))).not.toBe(key);
    expect(explainDayKey("user-1", new Date("2026-10-06T00:00:01.000Z"))).toBe(key);
  });
});

describe("the explain cache", () => {
  const answer = (n: number): ExplainAnswer => ({ meaning: `m${n}`, here: { text: `h${n}`, peer: true } });

  it("returns what was set, and nothing for a key it never saw", () => {
    const cache = createExplainCache();
    cache.set("k", answer(1));

    expect(cache.get("k")).toEqual(answer(1));
    expect(cache.get("other")).toBeUndefined();
  });

  it("forgets an answer after an hour", () => {
    let now = 1_000_000;
    const cache = createExplainCache({ now: () => now });
    cache.set("k", answer(1));
    now += 60 * 60 * 1000 - 1;
    expect(cache.get("k")).toEqual(answer(1));
    now += 2;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("keeps at most 64, the oldest forgotten first", () => {
    const cache = createExplainCache();
    for (let i = 0; i < 70; i += 1) cache.set(`k${i}`, answer(i));

    expect(cache.size()).toBe(64);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k5")).toBeUndefined();
    expect(cache.get("k6")).toEqual(answer(6));
    expect(cache.get("k69")).toEqual(answer(69));
  });

  it("setting a key again makes it the newest", () => {
    const cache = createExplainCache({ max: 2 });
    cache.set("a", answer(1));
    cache.set("b", answer(2));
    cache.set("a", answer(3));
    cache.set("c", answer(4));

    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toEqual(answer(3));
    expect(cache.get("c")).toEqual(answer(4));
  });

  it("is a memory of answers: the module's default holds 64 for an hour", () => {
    expect(EXPLAIN_CAPS.cacheEntries).toBe(64);
    expect(EXPLAIN_CAPS.cacheTtlMs).toBe(60 * 60 * 1000);
  });
});
