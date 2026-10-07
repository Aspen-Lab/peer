import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { sectionParagraphs, openingOf } from "./reading-map";
import {
  EXPLAIN_BREVITY_RULES,
  EXPLAIN_CAPS,
  asksForDetail,
  buildExplainPrompt,
  buildExplainReplyPrompt,
  clipPassage,
  createExplainCache,
  explainCacheKey,
  explainDocHash,
  explainMapLines,
  groundExplainItems,
  locatePassage,
  parseModelJson,
  readThread,
  sanitizeExplainAnswer,
  sanitizeExplainReply,
  verifyExplainAnswer,
  verifyExplainReply,
  type ExplainAnswer,
  type ExplainItem,
  type ExplainMessage,
  type ExplainReplyTurn,
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

// P3-02c (§1h.4 amendment): `explainDayKey` — the count-only counter's key — went
// with the count, and (P4-00) its replacement, the charge and its per-reader day
// key, went with the allowance. The four assertions that were about those keys (the
// key names the reader and the UTC day, rolls over at midnight UTC, differs by
// reader, is stable within the day) went with their subject.

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

// ── P3-02b (ruling §1h.3): the thread ───────────────────────────────────
// What the server reads of a thread, the prompt for a reply, the reply's
// sanitiser and verifier, and the memory's key with the thread in it. As above,
// every text is invented.

const FIRST: ExplainMessage = { role: "peer", text: "A rafting ratio says how much of a sample has turned into plates. The authors use it to compare alloys." };
const ASKED: ExplainMessage = { role: "reader", text: "Why does a bigger ratio matter for the blade?" };
const REPLIED: ExplainMessage = { role: "peer", text: "A bigger share of plates changes how the metal carries load." };
const ASKED_AGAIN: ExplainMessage = { role: "reader", text: "And at a lower temperature?" };

describe("readThread (P3-02b)", () => {
  it("keeps a well-formed thread in order, roles and words as sent", () => {
    const read = readThread([FIRST, ASKED]);

    expect(read.messages).toEqual([FIRST, ASKED]);
    expect(read.readers).toBe(1);
  });

  it("collapses whitespace in each message and keeps only role and text", () => {
    const read = readThread([{ role: "peer", text: "  Plates   form\nunder load.  ", extra: "x", evidence: "y" }, { role: "reader", text: "Why?\n\nWhy not?" }]);

    expect(read.messages).toEqual([{ role: "peer", text: "Plates form under load." }, { role: "reader", text: "Why? Why not?" }]);
  });

  it("treats anything malformed as no thread at all: not an array, not objects, a bad role, no text, empty text", () => {
    for (const bad of [undefined, null, "a thread", 5, {}, [1, 2], [null], [[]], [{ role: "robot", text: "x" }], [{ text: "x" }], [{ role: "reader" }], [{ role: "reader", text: 7 }], [{ role: "reader", text: "   " }], [FIRST, { role: "reader" }]]) {
      expect(readThread(bad)).toEqual({ messages: [], readers: 0 });
    }
  });

  // P3-05 (§1h.8 (3), O8): this test said "each message to 400 characters" and read
  // the thread's FIRST message (the first answer, both parts joined, up to about 841
  // characters) with the cap that belongs to the later ones — a follow-up's model
  // never saw "Why it is here". Rewritten to the new contract: the later messages stay
  // at 400; the first message has its own cap (the tests after it).
  it("clips each message after the first to 400 characters, at a word", () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const read = readThread([FIRST, { role: "reader", text: long }, { role: "peer", text: "x".repeat(5000) }]);

    expect(EXPLAIN_CAPS.messageChars).toBe(400);
    expect(read.messages[1].text.length).toBeLessThanOrEqual(400);
    expect(long.startsWith(read.messages[1].text)).toBe(true);
    expect(read.messages[1].text.length).toBeGreaterThan(350);
    expect(read.messages[2].text).toHaveLength(400);
  });

  // The first answer is both of its parts joined, each at most 420 characters
  // (`partChars`) and one space between them, so the first message of a thread is read whole up to 841.
  describe("the first message, which carries the whole first answer (P3-05, O8)", () => {
    const run = (length: number) => "abcd ".repeat(Math.ceil(length / 5)).slice(0, length).trim();

    it("has a cap of its own, 841 characters (P4-00c: both parts and the space between), above the later messages' 400", () => {
      expect(EXPLAIN_CAPS.firstAnswerChars).toBe(841);
      expect(EXPLAIN_CAPS.firstAnswerChars).toBeGreaterThan(EXPLAIN_CAPS.messageChars);
      expect(EXPLAIN_CAPS.threadMessages).toBe(17);
    });

    it("reads a first message of 800 characters whole, and a later message of 800 cut to 400 at a word", () => {
      const eight = run(799); // single spaces, no edge spaces: what `collapse` leaves unchanged
      const read = readThread([{ role: "peer", text: eight }, ASKED, { role: "peer", text: eight }, ASKED_AGAIN]);

      expect(eight).toHaveLength(799);
      expect(read.messages[0].text).toBe(eight);
      expect(read.messages[2].text.length).toBeLessThanOrEqual(400);
      expect(read.messages[2].text.length).toBeGreaterThan(350);
      expect(eight.startsWith(read.messages[2].text)).toBe(true);
      expect(eight[read.messages[2].text.length]).toBe(" ");
    });

    it("clips a first message over 841 characters at a word, and keeps one of exactly 841", () => {
      const exact = run(841); // exactly 841: no edge space (the run ends on a letter)
      const over = Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ");
      const read = readThread([{ role: "peer", text: exact }, ASKED]);
      const cut = readThread([{ role: "peer", text: over }, ASKED]);

      expect(read.messages[0].text).toBe(exact);
      expect(exact).toHaveLength(841);
      expect(cut.messages[0].text.length).toBeLessThanOrEqual(841);
      expect(cut.messages[0].text.length).toBeGreaterThan(780);
      expect(over.startsWith(cut.messages[0].text)).toBe(true);
      expect(over[cut.messages[0].text.length]).toBe(" ");
    });

    it("gives the cap to the thread's first message and to no other, whatever its role", () => {
      const long = run(799);
      const read = readThread([{ role: "reader", text: long }, { role: "peer", text: long }, { role: "reader", text: long }]);

      expect(read.messages[0].text).toBe(long);
      expect(read.messages[1].text.length).toBeLessThanOrEqual(400);
      expect(read.messages[2].text.length).toBeLessThanOrEqual(400);
    });

    // P4-00c (A's P3-06b O-2, C's P3-05 item 5): the cap was 840, which is 2 * 420 and
    // nothing for the space `firstAnswerMessage` puts between the parts, so a first answer
    // with both parts at their cap (841) lost its last word. A measurement through the box
    // and the route: parts 420 + 420, sent 841, read 828; the model never saw the end of
    // "Why it is here". The cap is now both parts and the one space: 2 * partChars + 1.
    describe("the 841 edge: both parts at their cap reach the model whole (P4-00c)", () => {
      const meaning = `${"alpha ".repeat(69)}ends-meaning.`.slice(-EXPLAIN_CAPS.partChars); // exactly 420
      const here = `${"gamma ".repeat(69)}ends-here.`.slice(-EXPLAIN_CAPS.partChars); // exactly 420
      const answer = `${meaning} ${here}`;

      it("is built of two parts at the cap and the space between, 841 characters", () => {
        expect(meaning).toHaveLength(EXPLAIN_CAPS.partChars);
        expect(here).toHaveLength(EXPLAIN_CAPS.partChars);
        expect(answer).toHaveLength(841);
        // And these are parts the sanitiser keeps at their cap, not strings only this test calls parts.
        const kept = sanitizeExplainAnswer({ meaning, here: { text: here } });
        expect(kept?.meaning).toHaveLength(EXPLAIN_CAPS.partChars);
        expect(kept?.here.text).toHaveLength(EXPLAIN_CAPS.partChars);
      });

      it("has a cap that is both parts and the space between them", () => {
        expect(EXPLAIN_CAPS.firstAnswerChars).toBe(2 * EXPLAIN_CAPS.partChars + 1);
        expect(EXPLAIN_CAPS.firstAnswerChars).toBe(841);
      });

      it("reads it whole, the last word of 'Why it is here' included", () => {
        const read = readThread([{ role: "peer", text: answer }, ASKED]);

        expect(read.messages[0].text).toBe(answer);
        expect(read.messages[0].text.endsWith("ends-here.")).toBe(true);
      });
    });

    it("leaves the 17-message cap as it was", () => {
      const seventeen = Array.from({ length: 17 }, (_, i) => ({ role: i % 2 === 0 ? "peer" : "reader", text: run(799) }));

      expect(readThread(seventeen).messages).toHaveLength(17);
      expect(readThread([...seventeen, { role: "peer", text: "one more" }]).messages).toEqual([]);
    });
  });

  it("counts the reader's messages", () => {
    expect(readThread([FIRST, ASKED, REPLIED, ASKED_AGAIN]).readers).toBe(2);
    expect(readThread([FIRST]).readers).toBe(0);
    expect(readThread([]).readers).toBe(0);
  });

  it("reads at most 17 messages: a longer thread with 8 or fewer reader messages is no thread", () => {
    const many = Array.from({ length: 18 }, (_, i) => ({ role: i % 2 === 0 ? "peer" : "reader", text: `message ${i}` }));
    const read = readThread(many);

    expect(EXPLAIN_CAPS.threadMessages).toBe(17);
    expect(read.messages).toEqual([]);
    expect(read.readers).toBe(9);
    // Seventeen are read in full.
    expect(readThread(many.slice(0, 17)).messages).toHaveLength(17);
    const peers = Array.from({ length: 18 }, (_, i) => ({ role: "peer", text: `message ${i}` }));
    expect(readThread(peers)).toEqual({ messages: [], readers: 0 });
  });

  it("reports more reader messages than the cap, so the route can say the thread is full", () => {
    const nine = Array.from({ length: 9 }, (_, i) => ({ role: "reader", text: `message ${i}` }));

    expect(EXPLAIN_CAPS.threadReaderMessages).toBe(8);
    expect(readThread(nine).readers).toBe(9);
    expect(readThread(nine.slice(0, 8)).readers).toBe(8);
  });
});

describe("buildExplainReplyPrompt (P3-02b)", () => {
  const located = locatePassage(doc, "fraction of the gauge length")!;
  const base = {
    paper: { title: "Rafting under creep in a nickel alloy", abstract: "The abstract says why rafting matters for turbine blades." },
    map: explainMapLines(doc),
    located,
    passage: "fraction of the gauge length",
  };
  const built = buildExplainReplyPrompt({ ...base, thread: [FIRST, ASKED] });
  const user = JSON.parse(built.userPrompt) as Record<string, unknown>;

  it("speaks in Peer's voice, asks for JSON only, and is its own prompt, not the first message's", () => {
    expect(built.systemPrompt).toMatch(/Peer/);
    expect(built.systemPrompt).toMatch(/valid JSON/i);
    expect(built.systemPrompt).not.toBe(buildExplainPrompt(base).systemPrompt);
  });

  it("carries P3-02's context: the title, the abstract, the map's lines, the paragraph and its neighbours, the passage", () => {
    expect(built.userPrompt).toContain("Rafting under creep in a nickel alloy");
    expect(built.userPrompt).toContain("The abstract says why rafting matters for turbine blades.");
    expect(built.userPrompt).toContain("1 Introduction");
    expect(built.userPrompt).toContain("3 Results");
    expect(built.userPrompt).toContain("Specimens were machined from a single casting and heat treated together.");
    expect(built.userPrompt).toContain(RAFT_DEF);
    expect(built.userPrompt).toContain(SHARED);
    expect(user.passage).toBe("fraction of the gauge length");
  });

  it("has exactly these parts, the thread among them, and nothing about the reader's profile", () => {
    expect(Object.keys(user)).toEqual(["task", "paper", "sections", "context", "passage", "thread", "lastReaderMessage", "outputSchema", "rules"]);
    expect(Object.keys(user.paper as object)).toEqual(["title", "abstract"]);
    expect(built.userPrompt).not.toMatch(/profile|project|challenge|readerProject/i);
  });

  it("gives the thread in order, each message labelled by its role", () => {
    const thread = [FIRST, ASKED, REPLIED, ASKED_AGAIN];
    const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread }).userPrompt) as { thread: Array<{ role: string; text: string }> };

    expect(parsed.thread).toEqual(thread);
    expect(parsed.thread.map((message) => message.role)).toEqual(["peer", "reader", "peer", "reader"]);
  });

  it("names the reader's last message as the one to answer, in the schema's words and in a field of its own", () => {
    const thread = [FIRST, ASKED, REPLIED, ASKED_AGAIN];
    const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread }).userPrompt) as { lastReaderMessage: string; task: string; rules: string[] };

    expect(parsed.lastReaderMessage).toBe(ASKED_AGAIN.text);
    expect(parsed.task).toMatch(/last message/i);
    expect(parsed.rules.join(" ")).toMatch(/lastReaderMessage/);
  });

  it("asks for a reply of at most three sentences, plain words, about this passage", () => {
    const rules = (user.rules as string[]).join(" ");
    const schema = user.outputSchema as { reply: string; evidence: string };

    expect(rules).toMatch(/three sentences/i);
    expect(rules).toMatch(/plain/i);
    expect(schema.reply).toMatch(/three sentences/i);
    expect(schema.evidence).toMatch(/character-for-character/);
  });

  it("asks for evidence only when the reply rests on the paper, copied from the context", () => {
    const rules = (user.rules as string[]).join(" ");

    expect(rules).toMatch(/context\.before/);
    expect(rules).toMatch(/context\.paragraph/);
    expect(rules).toMatch(/context\.after/);
    expect(rules).toMatch(/Omit `evidence`/);
    expect(rules).toMatch(/rests on something the paper says|when the reply rests on/i);
  });

  it("says no web, no advice and no verdict on reading on", () => {
    const rules = (user.rules as string[]).join(" ");

    expect(rules).toMatch(/web/i);
    expect(rules).toMatch(/no advice/i);
    expect(rules).toMatch(/verdict/i);
  });

  it("bounds what it sends: a long thread of long messages is cut to 17 messages of 400 characters, the last kept", () => {
    const huge = "word ".repeat(5000);
    const thread: ExplainMessage[] = Array.from({ length: 40 }, (_, i) => ({ role: i % 2 === 0 ? "peer" : "reader", text: i === 39 ? "The very last message ends here." : huge }));
    const big = buildExplainReplyPrompt({ ...base, thread });
    const parsed = JSON.parse(big.userPrompt) as { thread: ExplainMessage[]; lastReaderMessage: string; outputSchema: unknown; rules: unknown };

    expect(parsed.thread.length).toBeLessThanOrEqual(EXPLAIN_CAPS.threadMessages);
    for (const message of parsed.thread) expect(message.text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.messageChars);
    expect(parsed.thread[parsed.thread.length - 1].text).toBe("The very last message ends here.");
    expect(parsed.lastReaderMessage).toBe("The very last message ends here.");
    // The schema and the rules are never what gets cut.
    expect(parsed).toHaveProperty("outputSchema");
    expect(Array.isArray(parsed.rules)).toBe(true);
  });

  // P3-05 (§1h.8 (3), O8): the first answer travels as the thread's first `peer`
  // message, "What it means" and "Why it is here" joined. At the old 400-character cap
  // a follow-up's model saw 398 characters of two parts of 417 — none of the second.
  describe("the first answer, whole (P3-05, O8)", () => {
    const meaning = `${"alpha ".repeat(67)}ends-meaning.`; // 415 characters
    const here = `${"gamma ".repeat(68)}ends-here.`; // 418 characters
    const answer: ExplainMessage = { role: "peer", text: `${meaning} ${here}` };
    const wordy = "abcd ".repeat(160).trim();

    it("carries the first message whole: both parts, the second's last words included", () => {
      const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread: [answer, ASKED] }).userPrompt) as { thread: ExplainMessage[] };

      expect(answer.text).toHaveLength(834);
      expect(parsed.thread[0].text).toBe(answer.text);
      expect(buildExplainReplyPrompt({ ...base, thread: [answer, ASKED] }).userPrompt).toContain("ends-here.");
    });

    it("cuts a later message of the same length to 400, at a word", () => {
      const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread: [answer, ASKED, { role: "peer", text: wordy }, ASKED_AGAIN] }).userPrompt) as { thread: ExplainMessage[] };

      expect(parsed.thread[0].text).toBe(answer.text);
      expect(parsed.thread[2].text.length).toBeLessThanOrEqual(400);
      expect(parsed.thread[2].text.length).toBeGreaterThan(350);
      expect(wordy.startsWith(parsed.thread[2].text)).toBe(true);
    });

    // P4-00c: the 841 edge through the prompt — both parts at their cap, the space between,
    // the whole of it in front of the model; a later message of that length still cut to 400.
    it("puts a first answer of both parts at their cap (841) whole in the prompt, the last word of the second included", () => {
      const atCap = `${`${"alpha ".repeat(69)}ends-meaning.`.slice(-EXPLAIN_CAPS.partChars)} ${`${"gamma ".repeat(69)}ends-here.`.slice(-EXPLAIN_CAPS.partChars)}`;
      const parsed = JSON.parse(
        buildExplainReplyPrompt({ ...base, thread: [{ role: "peer", text: atCap }, ASKED, { role: "peer", text: atCap }, ASKED_AGAIN] }).userPrompt,
      ) as { thread: ExplainMessage[] };

      expect(atCap).toHaveLength(2 * EXPLAIN_CAPS.partChars + 1);
      expect(parsed.thread[0].text).toBe(atCap);
      expect(parsed.thread[0].text.endsWith("ends-here.")).toBe(true);
      expect(parsed.thread[2].text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.messageChars);
    });

    it("cuts a first message over 841 characters at a word", () => {
      const huge = { role: "peer" as const, text: Array.from({ length: 400 }, (_, i) => `w${i}`).join(" ") };
      const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread: [huge, ASKED] }).userPrompt) as { thread: ExplainMessage[] };

      expect(parsed.thread[0].text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.firstAnswerChars);
      expect(parsed.thread[0].text.length).toBeGreaterThan(780);
      expect(huge.text.startsWith(parsed.thread[0].text)).toBe(true);
    });

    it("keeps the first answer's cap with the first answer: once the oldest messages are dropped, no later message is read at 841", () => {
      const long = { role: "peer" as const, text: wordy };
      const thread: ExplainMessage[] = Array.from({ length: 20 }, (_, i) => (i % 2 === 0 ? long : { role: "reader" as const, text: wordy }));
      const parsed = JSON.parse(buildExplainReplyPrompt({ ...base, thread }).userPrompt) as { thread: ExplainMessage[] };

      expect(parsed.thread).toHaveLength(EXPLAIN_CAPS.threadMessages);
      for (const message of parsed.thread) expect(message.text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.messageChars);
    });
  });

  it("bounds the context as the first message's prompt does", () => {
    const huge = "word ".repeat(5000);
    const big = buildExplainReplyPrompt({
      paper: { title: "t".repeat(2000), abstract: huge },
      map: Array.from({ length: 300 }, (_, i) => ({ heading: `Section ${i}`, opening: huge })),
      located: { ...located, paragraph: huge, before: huge, after: huge },
      passage: "x".repeat(5000),
      thread: [FIRST, ASKED],
    });
    const parsed = JSON.parse(big.userPrompt) as { paper: { title: string; abstract: string }; sections: unknown[]; context: { paragraph: string }; passage: string };

    expect(parsed.paper.title.length).toBeLessThanOrEqual(EXPLAIN_CAPS.titleChars);
    expect(parsed.paper.abstract.length).toBeLessThanOrEqual(EXPLAIN_CAPS.abstractChars);
    expect(parsed.sections.length).toBeLessThanOrEqual(EXPLAIN_CAPS.mapLines);
    expect(parsed.context.paragraph.length).toBeLessThanOrEqual(EXPLAIN_CAPS.paragraphChars);
    expect(parsed.passage.length).toBeLessThanOrEqual(EXPLAIN_CAPS.passageChars);
  });
});

describe("sanitizeExplainReply (P3-02b)", () => {
  const good = { reply: "A bigger share of plates changes how the metal carries load.", evidence: RAFT_DEF };

  it("keeps a well-formed reply, trimmed", () => {
    expect(sanitizeExplainReply({ reply: `  ${good.reply}  `, evidence: ` ${RAFT_DEF} ` })).toEqual(good);
  });

  it("keeps a reply with no evidence as it is", () => {
    expect(sanitizeExplainReply({ reply: good.reply })).toEqual({ reply: good.reply });
  });

  it("clips the reply to three sentences and 560 characters", () => {
    const four = sanitizeExplainReply({ reply: "One is plain. Two is plain too. Three is the last. Four must go." });
    const long = sanitizeExplainReply({ reply: `${"word ".repeat(300)}.` });

    expect(four?.reply).toBe("One is plain. Two is plain too. Three is the last.");
    expect(EXPLAIN_CAPS.replyChars).toBe(560);
    expect(long?.reply.length).toBeLessThanOrEqual(560);
  });

  it("caps the quote it will try to verify at 400 characters, and drops one that is not text or is empty", () => {
    expect(sanitizeExplainReply({ reply: good.reply, evidence: "q".repeat(2000) })?.evidence?.length).toBeLessThanOrEqual(EXPLAIN_CAPS.evidenceChars);
    expect(sanitizeExplainReply({ reply: good.reply, evidence: 5 })).toEqual({ reply: good.reply });
    expect(sanitizeExplainReply({ reply: good.reply, evidence: "  " })).toEqual({ reply: good.reply });
  });

  it("drops everything else the model said: a place, a page, a section, a peer flag, a role", () => {
    const clean = sanitizeExplainReply({ reply: good.reply, evidence: RAFT_DEF, evidenceWhere: "Everything", sectionId: "s99", page: 7, peer: true, role: "reader", extra: 1 });

    expect(clean).toEqual(good);
  });

  it("is null without words to say", () => {
    for (const bad of [null, "text", [good], {}, { reply: "" }, { reply: "   " }, { reply: 4 }, { evidence: RAFT_DEF }]) {
      expect(sanitizeExplainReply(bad)).toBeNull();
    }
  });
});

describe("verifyExplainReply (P3-02b)", () => {
  const reply = { reply: "It compares alloys.", evidence: RAFT_DEF };

  it("sets the section, its heading and its page on a quote the paper holds", () => {
    const turn = verifyExplainReply(reply, doc);

    expect(turn).toEqual({ role: "peer", text: "It compares alloys.", evidence: RAFT_DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 });
    expect(turn.peer).toBeUndefined();
  });

  it("tries the section it was told to prefer first", () => {
    const twice: ExtractedDocument = { ...doc, sections: [...doc.sections, { id: "s4", heading: "4 Discussion", canonical: "discussion", page: 4, text: RAFT_DEF }] };

    expect(verifyExplainReply(reply, twice, "s4")).toMatchObject({ sectionId: "s4", evidenceWhere: "4 Discussion", page: 4 });
    expect(verifyExplainReply(reply, twice, "s2")).toMatchObject({ sectionId: "s2" });
  });

  it("leaves out the page for a source that has none", () => {
    const html: ExtractedDocument = { ...doc, sections: doc.sections.map((section) => { const bare = { ...section }; delete bare.page; return bare; }) };
    const turn = verifyExplainReply(reply, html);

    expect(turn.sectionId).toBe("s2");
    expect("page" in turn).toBe(false);
  });

  it("removes a quote the paper does not hold and labels the reply as Peer's own", () => {
    const invented: ExplainReplyTurn = verifyExplainReply({ reply: "It compares alloys.", evidence: "We define the rafting ratio as the share of every plate that covered a crack." }, doc);

    expect(invented).toEqual({ role: "peer", text: "It compares alloys.", peer: true });
  });

  it("holds the whole quote, not its start", () => {
    const changed = verifyExplainReply({ reply: "x", evidence: `${RAFT_DEF.slice(0, -12)} by the failed zones.` }, doc);

    expect(changed).toEqual({ role: "peer", text: "x", peer: true });
  });

  it("labels a reply with no quote as Peer's own", () => {
    expect(verifyExplainReply({ reply: "A plain answer." }, doc)).toEqual({ role: "peer", text: "A plain answer.", peer: true });
  });

  it("changes nothing in the reply it was given", () => {
    const given = { reply: "x", evidence: "not in the paper at all, not a word of it, ever" };
    const copy = JSON.parse(JSON.stringify(given)) as typeof given;
    verifyExplainReply(given, doc);

    expect(given).toEqual(copy);
  });
});

describe("explainCacheKey with a thread (P3-02b)", () => {
  const texts = [FIRST.text, ASKED.text];
  const base = explainCacheKey("doc-hash", "The rafting ratio", texts);

  it("changes with every message of the thread, and with their order", () => {
    expect(explainCacheKey("doc-hash", "The rafting ratio", [])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", [FIRST.text])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", [...texts, REPLIED.text, ASKED_AGAIN.text])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", [ASKED.text, FIRST.text])).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", [FIRST.text, "Another question?"])).not.toBe(base);
  });

  it("is the same for the same thread, and carries none of its words", () => {
    expect(explainCacheKey("doc-hash", "The rafting ratio", [...texts])).toBe(base);
    expect(base).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("the memory holds a reply turn as it holds an answer (P3-02b)", () => {
  it("remembers one verified reply under its key, counted in the same 64", () => {
    const cache = createExplainCache({ max: 2 });
    const turn: ExplainReplyTurn = { role: "peer", text: "A reply.", peer: true };
    cache.set("a", turn);
    cache.set("b", { meaning: "m", here: { text: "h", peer: true } });
    cache.set("c", turn);

    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("c")).toEqual(turn);
    expect(cache.size()).toBe(2);
  });
});

// ── P3-02c (ruling §1h.4 amendment): web search in a reply ────────────────

describe("buildExplainReplyPrompt with search (P3-02c)", () => {
  const located = locatePassage(doc, "fraction of the gauge length")!;
  const base = {
    paper: { title: "Rafting under creep in a nickel alloy", abstract: "The abstract says why rafting matters for turbine blades." },
    map: explainMapLines(doc),
    located,
    passage: "fraction of the gauge length",
    thread: [FIRST, ASKED],
  };
  const plain = buildExplainReplyPrompt(base);
  const searched = buildExplainReplyPrompt({ ...base, search: true });
  const rulesOf = (prompt: { userPrompt: string }) => (JSON.parse(prompt.userPrompt) as { rules: string[] }).rules.join(" ");

  it("without search it is byte-for-byte what it was: the rule says do not search the web", () => {
    expect(buildExplainReplyPrompt({ ...base, search: false })).toEqual(plain);
    expect(rulesOf(plain)).toContain("Do not search the web or rely on anything outside the text supplied.");
    expect(rulesOf(plain)).not.toMatch(/may use web search/i);
  });

  it("with search the rule lets the model use web search for general background — and says no URL and no source by name", () => {
    const rules = rulesOf(searched);

    expect(rules).toContain("You may use web search for general background.");
    expect(rules).toContain("Name no URL and no source by name.");
    expect(rules).not.toContain("Do not search the web");
  });

  it("with search the paper's own words still come only from the context, and the evidence is still one copied sentence", () => {
    const rules = rulesOf(searched);

    expect(rules).toMatch(/paper's own words still come only from `context`/);
    expect(rules).toMatch(/`evidence` is still one sentence copied from it/);
    // The evidence rules of the plain prompt are all still there.
    for (const needle of ["context.before", "context.paragraph", "context.after", "Omit `evidence`"]) expect(rules).toContain(needle);
    // And so is the rule against advice and verdicts.
    expect(rules).toMatch(/no advice/i);
    expect(rules).toMatch(/verdict/i);
  });

  it("changes nothing else: the same parts, the same schema, the same context and thread", () => {
    const a = JSON.parse(plain.userPrompt) as Record<string, unknown>;
    const b = JSON.parse(searched.userPrompt) as Record<string, unknown>;

    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const key of Object.keys(a)) if (key !== "rules") expect(b[key]).toEqual(a[key]);
    expect(searched.systemPrompt).toBe(plain.systemPrompt);
  });

  it("the first message's prompt has no search at all: it takes no such argument", () => {
    const first = buildExplainPrompt({ paper: base.paper, map: base.map, located, passage: base.passage });

    expect(first.userPrompt).not.toMatch(/web search/i);
  });
});

describe("explainCacheKey with search (P3-02c)", () => {
  const texts = [FIRST.text, ASKED.text];
  const base = explainCacheKey("doc-hash", "The rafting ratio", texts);

  it("keeps a searched reply apart from the same thread answered without search", () => {
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, true)).not.toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, true)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is the unsearched key, unchanged, when search is false or left out", () => {
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, false)).toBe(base);
    expect(explainCacheKey("doc-hash", "The rafting ratio", [])).toBe(explainCacheKey("doc-hash", "The rafting ratio", [], false));
  });

  it("is stable for the same searched thread, and still names no reader", () => {
    expect(explainCacheKey("doc-hash", "  the  RAFTING ratio ", texts, true)).toBe(explainCacheKey("doc-hash", "The rafting ratio", texts, true));
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, true)).not.toBe(explainCacheKey("other-doc", "The rafting ratio", texts, true));
  });
});

describe("sanitizeExplainReply drops web addresses (P3-02c)", () => {
  const reply = (text: string) => sanitizeExplainReply({ reply: text })?.reply;

  it("takes out an address with a scheme, or one that begins www., and keeps the sentence", () => {
    expect(reply("Plates form under load (see https://example.org/guide/rafting for more). They carry load.")).toBe("Plates form under load (see for more). They carry load.");
    expect(reply("Plates form under load, as www.example.com/alloys says. They carry load.")).toBe("Plates form under load, as says. They carry load.");
  });

  it("keeps the closing punctuation an address had swallowed", () => {
    expect(reply("It is described at https://example.org/x.")).toBe("It is described at.");
    expect(reply("Two sources agree: https://a.example.org/x, https://b.example.org/y; so it holds.")).toBe("Two sources agree:,; so it holds.");
  });

  it("leaves a reply with no address exactly as it was", () => {
    expect(reply("A bigger share of plates changes how the metal carries load.")).toBe("A bigger share of plates changes how the metal carries load.");
    expect(reply("The ratio rose from 0.2 to 0.7 at 1100 C (about 3.5 times).")).toBe("The ratio rose from 0.2 to 0.7 at 1100 C (about 3.5 times).");
  });

  it("is no reply at all when nothing but an address was said", () => {
    expect(sanitizeExplainReply({ reply: "https://example.org/only-this" })).toBeNull();
    expect(sanitizeExplainReply({ reply: "(https://example.org/only-this)" })).toBeNull();
  });

  it("does not touch the quote: a sentence of the paper that holds an address is the paper's, verified or dropped on its own", () => {
    const code = "The code is available at https://example.org/code for every figure.";

    expect(sanitizeExplainReply({ reply: "It is shared.", evidence: code })).toEqual({ reply: "It is shared.", evidence: code });
  });
});

// ── P3-07 (ruling §1h.9; user decision §1a.14): short and exact ──────────
// The explain box answers in the fewest words that are exact: the rules the
// prompts carry, the detector that tells when the reader asked for more, the hard
// caps the sanitizers enforce whatever the model wrote (a reply is three
// sentences by default and eight only on request, cut after a whole sentence), the
// term table's shape and its grounding, the memory's key with the long form in it,
// and a harness that runs over-long canned answers through the sanitizers. As
// everywhere in this file, every text below is invented.

describe("the brevity rules in the prompts (P3-07)", () => {
  const located = locatePassage(doc, "fraction of the gauge length")!;
  const base = {
    paper: { title: "Rafting under creep in a nickel alloy", abstract: "The abstract says why rafting matters for turbine blades." },
    map: explainMapLines(doc),
    located,
    passage: "fraction of the gauge length",
  };
  const first = buildExplainPrompt(base);
  const reply = buildExplainReplyPrompt({ ...base, thread: [FIRST, ASKED] });
  const longer = buildExplainReplyPrompt({ ...base, thread: [FIRST, ASKED], detail: true });
  const userOf = (prompt: { userPrompt: string }) => JSON.parse(prompt.userPrompt) as { outputSchema: Record<string, unknown>; rules: string[] } & Record<string, unknown>;

  it("names the rules, word for word", () => {
    expect([...EXPLAIN_BREVITY_RULES]).toEqual([
      "Answer in the fewest words that are still exact.",
      "No preamble.",
      "Never restate the question or say where the passage sits; the reader's box already shows the passage with its section and page.",
      "Give no general background beyond what the passage needs.",
      "One idea per sentence.",
      "When the meaning turns on the author's own phrase, quote that phrase exactly as the text supplied has it.",
      "Write in the reader's language; the paper's own sentences stay as they are.",
    ]);
  });

  it("puts every rule sentence in the system prompt of the first answer, of a reply and of a longer reply", () => {
    for (const built of [first, reply, longer]) {
      for (const rule of EXPLAIN_BREVITY_RULES) expect(built.systemPrompt).toContain(rule);
    }
  });

  it("keeps what the system prompts already said: Peer's voice, copied words only, nothing invented, JSON only", () => {
    for (const built of [first, reply, longer]) {
      expect(built.systemPrompt).toMatch(/Peer/);
      expect(built.systemPrompt).toContain("Do not fabricate numbers, citations or experimental details.");
      expect(built.systemPrompt).toContain("Return only valid JSON.");
      expect(built.systemPrompt).toMatch(/copied character-for-character/);
    }
  });

  it("a reply's prompt names the default cap — three sentences and 560 characters — and never the long one", () => {
    const user = userOf(reply);
    const text = `${user.outputSchema.reply as string} ${user.rules.join(" ")}`;

    expect(text).toMatch(/three sentences/i);
    expect(text).toMatch(/560 characters/);
    expect(text).not.toMatch(/eight sentences|1,400/);
  });

  it("a reply's prompt with detail names the long cap — eight sentences and 1,400 characters — and says the reader asked for more", () => {
    const user = userOf(longer);
    const text = `${user.outputSchema.reply as string} ${user.rules.join(" ")}`;

    expect(text).toMatch(/eight sentences/i);
    expect(text).toMatch(/1,400 characters/);
    expect(text).toMatch(/asked for more/i);
    expect(text).not.toMatch(/three sentences|560/);
  });

  it("detail changes the cap and nothing else: the same parts, the same context and thread, the same system prompt", () => {
    const a = userOf(reply);
    const b = userOf(longer);

    expect(Object.keys(b)).toEqual(Object.keys(a));
    for (const key of ["task", "paper", "sections", "context", "passage", "thread", "lastReaderMessage"]) expect(b[key]).toEqual(a[key]);
    expect(Object.keys(b.outputSchema)).toEqual(Object.keys(a.outputSchema));
    expect(longer.systemPrompt).toBe(reply.systemPrompt);
    expect(buildExplainReplyPrompt({ ...base, thread: [FIRST, ASKED], detail: false })).toEqual(reply);
  });

  it("a reply's schema offers an optional table — at most four rows of term, here, read, a dozen words a cell — and the rules keep it to two sentences of prose", () => {
    const user = userOf(reply);
    const items = user.outputSchema.items as string;

    expect(Object.keys(user.outputSchema)).toEqual(["reply", "evidence", "items"]);
    expect(items).toMatch(/optional|leave this key out/i);
    expect(items).toMatch(/term/);
    expect(items).toMatch(/here/);
    expect(items).toMatch(/read/);
    expect(items).toMatch(/four rows|4 rows/i);
    expect(items).toMatch(/twelve words|12 words/i);
    expect(user.rules.join(" ")).toMatch(/with `items`, `reply` is at most two sentences/i);
  });

  // P4-00c (§1h.11 (a), A's P7-14): this test said "unchanged in its schema: two parts and no
  // table", the P3-07 ruling that the first answer never carries one. The owner's standard — a
  // placing sentence that quotes the author's phrase, then the compact table — applies to the
  // first answer too, so the first answer's schema offers the same optional `items`. Rewritten to
  // the new ruling: two parts and an optional table, one sentence a part when there is one.
  it("the first message's prompt offers the same optional table: two parts, and `items` for a passage with two or more terms or quantities worth a row", () => {
    const user = userOf(first);
    const items = user.outputSchema.items as string;
    const replyItems = userOf(reply).outputSchema.items as string;

    expect(Object.keys(user.outputSchema)).toEqual(["meaning", "here", "items"]);
    expect(items).toMatch(/optional|leave this key out/i);
    expect(items).toMatch(/two or more terms or quantities/i);
    expect(items).toMatch(/term/);
    expect(items).toMatch(/here/);
    expect(items).toMatch(/read/);
    expect(items).toMatch(/four rows|4 rows/i);
    expect(items).toMatch(/twelve words|12 words/i);
    // The same table as a reply's: its cells are described in the same words.
    for (const phrase of ["{ term, here, read }", "at most four rows", "at most twelve words"]) {
      expect(items).toContain(phrase);
      expect(replyItems).toContain(phrase);
    }
  });

  it("the first message's prompt keeps each part to one sentence with a table, quotes the author's phrase where the meaning turns on it, and still allows two without one", () => {
    const user = userOf(first);
    const schema = user.outputSchema as { meaning: string; here: { text: string } };
    const rules = user.rules.join(" ");

    expect(rules).toMatch(/with `items`, `meaning` and `here\.text` are one sentence each/i);
    expect(rules).toMatch(/`meaning` quotes the author's own phrase when the meaning turns on it/i);
    expect(rules).toMatch(/leave the terms to the table/i);
    expect(schema.meaning).toMatch(/at most two sentences/i);
    expect(schema.meaning).toMatch(/one sentence when `items` is present/i);
    expect(schema.here.text).toMatch(/one sentence when `items` is present/i);
  });

  it("the first answer's system prompt asks for the table when the passage holds two or more terms or quantities worth a row, and for none otherwise", () => {
    expect(first.systemPrompt).toMatch(/two or more terms or quantities worth a row/i);
    expect(first.systemPrompt).toMatch(/give no table/i);
    // A reply's system prompt is its own, and does not carry the first answer's ask.
    expect(reply.systemPrompt).not.toMatch(/two or more terms or quantities/i);
  });

  it("a reply's prompt is what it was: the table is offered there as before", () => {
    expect(Object.keys(userOf(reply).outputSchema)).toEqual(["reply", "evidence", "items"]);
    expect(userOf(reply).rules.join(" ")).toMatch(/with `items`, `reply` is at most two sentences/i);
  });
});

describe("asksForDetail (P3-07)", () => {
  it("is true when the reader asks for detail in English: detail, detailed, in depth, elaborate, expand, step by step", () => {
    for (const message of [
      "Explain that in detail.",
      "Can you give a DETAILED answer?",
      "Go into more detail, please",
      "I want this in depth",
      "in-depth please",
      "Could you elaborate?",
      "Please expand on that.",
      "Walk me through it step by step",
      "Step-by-step?",
    ]) {
      expect(asksForDetail(message), message).toBe(true);
    }
  });

  it("is true for “more” only as “tell me more”, “say more” or “more detail”, in any case", () => {
    for (const message of ["Tell me more", "tell me more about the second column", "Can you say more?", "SAY MORE", "more detail?"]) {
      expect(asksForDetail(message), message).toBe(true);
    }
  });

  it("is false for “more” on its own and for a question that only mentions more of something", () => {
    for (const message of ["Are there more papers like this one?", "more", "I need more coffee", "Does a higher ratio mean more plates?", "What more can be said about 0.5?", "Say it more simply"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  // P4-00c (§1h.11 (c), A's P3-06b O-4): the plural. "give me the details" and "details please" are
  // the most natural English request for more, and were not matches (only the singular was).
  it("is true for the plural too: more details, give me the details, details please", () => {
    for (const message of ["more details", "Can you give me more details?", "give me the details", "Give me the DETAILS", "details please", "Details, please.", "What are the details of the setup?"]) {
      expect(asksForDetail(message), message).toBe(true);
    }
  });

  it("does not count a hyphen as a word boundary: a word joined to detail or details by one is not a request", () => {
    for (const message of ["detail-free", "mortgage detail-free", "a detail-oriented author", "the non-detailed tables", "the details-only view", "pre-details", "detail‑free", "an over-detailed figure"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  it("keeps the hyphen inside a phrase the list names: in-depth and step-by-step are still requests, and a hyphen is no boundary next to them either", () => {
    for (const message of ["in-depth please", "Step-by-step?", "Could you go step-by-step through it", "an in-depth answer"]) {
      expect(asksForDetail(message), message).toBe(true);
    }
    for (const message of ["a non-expand setting", "the step-by-step-guide figure", "re-elaborate-free"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  it("still takes more papers, more of something and more on its own for what they are: not a request", () => {
    for (const message of ["Are there more papers like this one?", "more papers", "more", "more coffee", "papers with more details-free abstracts"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  it("matches whole words only: a longer word that holds one is not the word", () => {
    for (const message of ["What is the thermal expansion here?", "Who is the retailer?", "The detailing of the specimen is odd", "Is it elaborately made?", "What does a fastidious step mean?"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  it("is true when the reader asks for detail in Chinese: 详细, 展开, 具体, 深入, 多说, 讲讲", () => {
    for (const message of ["请详细解释一下", "能展开说说吗", "具体是怎么回事", "再深入一点", "能多说一点吗", "再讲讲这个比值"]) {
      expect(asksForDetail(message), message).toBe(true);
    }
  });

  it("is false for an ordinary Chinese question", () => {
    for (const message of ["这个比值是什么意思", "它为什么重要", "作者怎么定义的"]) {
      expect(asksForDetail(message), message).toBe(false);
    }
  });

  it("is false for nothing, for blank text and for anything that is not text", () => {
    for (const message of ["", "   ", "\n"]) expect(asksForDetail(message)).toBe(false);
    for (const message of [undefined, null, 5, {}, ["detail"]]) expect(asksForDetail(message as unknown as string)).toBe(false);
  });
});

/** A sentence of about `chars` characters, invented, ending in a full stop. */
function sized(label: string, chars: number): string {
  let text = `Note ${label} says that`;
  while (text.length < chars - 1) text += " plates keep growing";
  return `${text}.`;
}
/** `count` short invented sentences. */
function sentences(count: number, label = "x"): string {
  return Array.from({ length: count }, (_, i) => `Point ${label}${i + 1} is plain and short.`).join(" ");
}
/** `count` short invented Chinese sentences. */
function sentencesZh(count: number): string {
  return Array.from({ length: count }, (_, i) => `第${i + 1}点说明片状析出物在载荷下缓慢长大。`).join("");
}
/** One long invented Chinese sentence of about `chars` characters. */
function sizedZh(n: number, chars: number): string {
  return `第${n}点：${"片状析出物在载荷下缓慢长大，".repeat(Math.ceil(chars / 13))}。`.slice(0, chars - 1) + "。";
}
const TERMINAL = /[.!?。！？]["”’'」』)）]*$/;
/** How many sentences a text has, counting a full stop followed by a space and the Chinese enders. */
const countSentences = (text: string): number => text.split(/(?<=[。！？])|(?<=[.!?])\s+/).map((piece) => piece.trim()).filter(Boolean).length;
/** The text is a whole-sentence cut of `source`: a prefix of it that ends where a sentence of it ends.
 *  (The page's cleaner has turned the full-width punctuation and the curly quotes of the source into
 *  plain ones, so the source is read the same way.) */
function wholeCut(source: string, out: string): boolean {
  const flat = source.replace(/\s+/g, " ").trim().normalize("NFKC").replace(/[“”]/g, '"');
  const atBreak = out.length === flat.length || /[。！？][”’'」』)）]*$/.test(out) || /\s/.test(flat[out.length]);
  return flat.startsWith(out) && TERMINAL.test(out) && atBreak;
}

describe("the reply caps (P3-07)", () => {
  it("has the default caps — three sentences, 560 characters — and the detail caps — eight sentences, 1,400 characters", () => {
    expect(EXPLAIN_CAPS.replySentences).toBe(3);
    expect(EXPLAIN_CAPS.replyChars).toBe(560);
    expect(EXPLAIN_CAPS.replyDetailSentences).toBe(8);
    expect(EXPLAIN_CAPS.replyDetailChars).toBe(1400);
  });

  it("by default keeps the first three whole sentences of a longer reply, and nothing of the rest", () => {
    const reply = sanitizeExplainReply({ reply: sentences(9) })?.reply as string;

    expect(reply).toBe(sentences(3));
    expect(sanitizeExplainReply({ reply: sentences(9) }, { detail: false })?.reply).toBe(sentences(3));
    expect(sanitizeExplainReply({ reply: sentences(9) }, {})?.reply).toBe(sentences(3));
  });

  it("with detail keeps up to eight whole sentences, and no more", () => {
    expect(sanitizeExplainReply({ reply: sentences(5) }, { detail: true })?.reply).toBe(sentences(5));
    expect(sanitizeExplainReply({ reply: sentences(12) }, { detail: true })?.reply).toBe(sentences(8));
  });

  it("cuts after the last whole sentence that fits the characters, never inside one — by default", () => {
    // Three sentences of about 250 characters: 3 × 250 is over 560, 2 × 250 is not.
    const long = [sized("a", 250), sized("b", 250), sized("c", 250)].join(" ");
    const reply = sanitizeExplainReply({ reply: long })?.reply as string;

    expect(reply).toBe([sized("a", 250), sized("b", 250)].join(" "));
    expect(reply.length).toBeLessThanOrEqual(560);
    expect(wholeCut(long, reply)).toBe(true);
  });

  it("cuts after the last whole sentence that fits the characters — with detail", () => {
    const long = Array.from({ length: 8 }, (_, i) => sized(String(i), 300)).join(" ");
    const reply = sanitizeExplainReply({ reply: long }, { detail: true })?.reply as string;

    expect(reply.length).toBeLessThanOrEqual(1400);
    expect(reply.length).toBeGreaterThan(1000);
    expect(wholeCut(long, reply)).toBe(true);
    expect(countSentences(reply)).toBeLessThan(8);
  });

  it("keeps a reply that is within the cap exactly as it was", () => {
    const within = `${sized("a", 200)} ${sized("b", 200)}`;

    expect(sanitizeExplainReply({ reply: within })?.reply).toBe(within);
    expect(sanitizeExplainReply({ reply: within }, { detail: true })?.reply).toBe(within);
  });

  it("counts sentences in Chinese too: three by default, eight with detail", () => {
    expect(sanitizeExplainReply({ reply: sentencesZh(9) })?.reply).toBe(sentencesZh(3));
    expect(sanitizeExplainReply({ reply: sentencesZh(12) }, { detail: true })?.reply).toBe(sentencesZh(8));
  });

  it("counts a Chinese sentence that ends in ！ or ？ too, though the cleaner has made those plain ! and ?", () => {
    const reply = sanitizeExplainReply({ reply: "第一点说明比值！第二点说明单元分数？第三点说明晶粒比。第四点必须去掉！" })?.reply as string;

    expect(reply).toBe("第一点说明比值！第二点说明单元分数？第三点说明晶粒比。".normalize("NFKC"));
    expect(sanitizeExplainReply({ reply: "第一点说明比值！？第二点说明单元分数。第三点。第四点。" })?.reply).toBe("第一点说明比值!?第二点说明单元分数。第三点。");
  });

  it("never cuts inside a quotation: the two sentences of a phrase the author wrote with a full stop in it go together", () => {
    // To a splitter “Grain 0.4. Cell 0.57” is two sentences; to a reader it is one phrase, quoted.
    const quoted = "The authors report “Grain 0.4. Cell 0.57” for the first sample.";
    const reply = sanitizeExplainReply({ reply: `${quoted} It is the small one. Another point. A third point.` })?.reply as string;

    // Three sentences by the splitter's count (the quotation is two of them): the quotation whole, then one more.
    // (The cleaner makes the curly quotes plain ones.)
    expect(reply).toBe(`${quoted} It is the small one.`.replace(/[“”]/g, '"'));
    expect((reply.match(/"/g) ?? []).length % 2).toBe(0);
  });

  it("leaves a quotation out together when its sentences do not all fit, rather than cut it in two", () => {
    const filler = sized("q", 500);
    const opens = "The note reads “First half.";
    const closes = "Second half” and stops here and goes on a little longer still.";
    // The precondition that makes this the test it says it is: the first half fits on its own, the two halves do not.
    expect(filler.length + 1 + opens.length).toBeLessThanOrEqual(560);
    expect(filler.length + 1 + opens.length + 1 + closes.length).toBeGreaterThan(560);
    const reply = sanitizeExplainReply({ reply: `${filler} ${opens} ${closes} Last.` })?.reply as string;

    expect(reply).toBe(filler);
    expect(reply).not.toContain("“");
  });

  it("holds a quotation the text never closes to nothing: its sentence is an ordinary one", () => {
    const reply = sanitizeExplainReply({ reply: "The sample is 5\" wide. It is small. It is flat. It is cold." })?.reply as string;

    expect(reply).toBe("The sample is 5\" wide. It is small. It is flat.");
  });

  it("keeps the author's own underscore: `f_cell` is not `fcell`", () => {
    const reply = sanitizeExplainReply({ reply: "The authors report grain ratio 0.4, f_cell = 0.57 for the first sample." })?.reply;

    expect(reply).toBe("The authors report grain ratio 0.4, f_cell = 0.57 for the first sample.");
    expect(sanitizeExplainAnswer({ meaning: "A share f_cell of the cells.", here: { text: "T_g marks the change." } })).toEqual({ meaning: "A share f_cell of the cells.", here: { text: "T_g marks the change." } });
  });

  it("marks the cut, and only then, when a single sentence is over the cap: a word boundary and an ellipsis, within the cap", () => {
    const runaway = `${"plates grow slowly ".repeat(80)}and that is all.`;
    const reply = sanitizeExplainReply({ reply: runaway })?.reply as string;
    const detailed = sanitizeExplainReply({ reply: runaway }, { detail: true })?.reply as string;

    for (const [out, cap] of [[reply, 560], [detailed, 1400]] as const) {
      expect(out.length).toBeLessThanOrEqual(cap);
      expect(out.endsWith("…")).toBe(true);
      expect(out.slice(0, -1).trimEnd().endsWith("plates") || out.slice(0, -1).trimEnd().endsWith("grow") || out.slice(0, -1).trimEnd().endsWith("slowly")).toBe(true);
    }
    expect(detailed.length).toBeGreaterThan(reply.length);
  });

  // P4-00c (§1h.11 (b), A's P3-06b P7-16, accepted, no code change): "a lone sentence longer than the
  // cap is cut at a word boundary and marked \"…\"; every other cut is at a sentence boundary." The test
  // above pins the first half for a reply; this one pins the whole rule in one place, for a reply and for a
  // part of the first answer — the lone sentence is the only text that ends inside a sentence, it ends
  // at a word and says so, and nothing else Peer cuts carries a mark or ends inside a sentence.
  it("pins the amended cut rule: only a lone sentence over the cap is cut inside the sentence, at a word and marked; every other cut is after a sentence, unmarked", () => {
    // Capitalised: a full stop followed by a lower-case word is no sentence break to the splitter.
    const lone = `${"Plates grow slowly ".repeat(80)}and that is all.`;
    const fits = sized("a", 200);
    const cases: Array<[string, (text: string) => string, number]> = [
      ["a reply", (text) => sanitizeExplainReply({ reply: text })?.reply as string, EXPLAIN_CAPS.replyChars],
      ["a long reply", (text) => sanitizeExplainReply({ reply: text }, { detail: true })?.reply as string, EXPLAIN_CAPS.replyDetailChars],
      ["a part of the first answer", (text) => sanitizeExplainAnswer({ meaning: text, here: { text: "Fine." } })?.meaning as string, EXPLAIN_CAPS.partChars],
    ];

    for (const [name, run, cap] of cases) {
      // The lone sentence: cut at a word boundary, marked, within the cap.
      const cut = run(lone);
      const kept = cut.slice(0, -1);
      expect(cut.endsWith("…"), name).toBe(true);
      expect(cut.length, name).toBeLessThanOrEqual(cap);
      expect(lone.startsWith(kept), name).toBe(true);
      expect(/\s/.test(lone[kept.length]), name).toBe(true);
      // A sentence that fits, then a lone one that does not: cut after the first, whole and unmarked.
      expect(run(`${fits} ${lone}`), name).toBe(fits);
      // Whole sentences over the cap: cut after the last one that fits, unmarked, a prefix ending a sentence.
      const many = Array.from({ length: 12 }, (_, i) => sized(`s${i}`, 230)).join(" ");
      const out = run(many);
      expect(out.endsWith("…"), name).toBe(false);
      expect(wholeCut(many, out), name).toBe(true);
    }
  });

  it("leaves the quote alone: the sentence cap is on the prose, and the paper's sentence is verified or dropped whole by the next step", () => {
    const out = sanitizeExplainReply({ reply: sentences(9), evidence: RAFT_DEF });

    expect(out).toEqual({ reply: sentences(3), evidence: RAFT_DEF });
    expect(sanitizeExplainReply({ reply: sentences(9), evidence: RAFT_DEF }, { detail: true })?.evidence).toBe(RAFT_DEF);
  });
});

describe("the first answer is cut after a whole sentence too (P3-07)", () => {
  it("keeps each part to two whole sentences within 420 characters: a second sentence that does not fit is dropped, not cut", () => {
    const answer = sanitizeExplainAnswer({ meaning: `${sized("m", 300)} ${sized("n", 300)}`, here: { text: `${sized("h", 200)} ${sized("i", 200)} ${sized("j", 200)}` } });

    expect(answer?.meaning).toBe(sized("m", 300));
    expect(answer?.here.text).toBe(`${sized("h", 200)} ${sized("i", 200)}`.length <= 420 ? `${sized("h", 200)} ${sized("i", 200)}` : sized("h", 200));
    for (const text of [answer?.meaning as string, answer?.here.text as string]) {
      expect(text.length).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
      expect(TERMINAL.test(text)).toBe(true);
    }
  });

  it("counts Chinese sentences in a part: two at most", () => {
    expect(sanitizeExplainAnswer({ meaning: sentencesZh(5), here: { text: sentencesZh(4) } })).toEqual({ meaning: sentencesZh(2), here: { text: sentencesZh(2) } });
  });
});

describe("the term table's shape (P3-07)", () => {
  const row = (term: string, here = "what it means in this paper", read = "how a reader should take it"): Record<string, string> => ({ term, here, read });
  const items = (raw: unknown, over: Record<string, unknown> = {}) => sanitizeExplainReply({ reply: "The authors report two values.", items: raw, ...over });

  it("keeps well-formed rows in order, trimmed, with only term, here and read", () => {
    const out = items([{ term: "  grain ratio ", here: " the width over the length ", read: " 0.4 is a narrow sample ", extra: "x" }, row("f_cell")]);

    expect(out?.items).toEqual([
      { term: "grain ratio", here: "the width over the length", read: "0.4 is a narrow sample" },
      { term: "f_cell", here: "what it means in this paper", read: "how a reader should take it" },
    ]);
  });

  it("has no items key at all for no table, an empty one and anything that is not a list of rows", () => {
    for (const raw of [undefined, null, [], "table", 5, {}, [1, "x", null], [{ term: "a" }], [{ term: "a", here: "b" }], [{ term: "a", here: "b", read: 3 }], [{ term: " ", here: "b", read: "c" }]]) {
      expect(items(raw)).toEqual({ reply: "The authors report two values." });
    }
  });

  it("keeps at most four rows, the first four that are fit", () => {
    const out = items(["one", "two", "three", "four", "five", "six"].map((term) => row(term)));

    expect(EXPLAIN_CAPS.itemRows).toBe(4);
    expect(out?.items?.map((item) => item.term)).toEqual(["one", "two", "three", "four"]);
  });

  it("drops a row with a cell over twelve words, and does not cut it", () => {
    const thirteen = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const twelve = "one two three four five six seven eight nine ten eleven twelve";
    const out = items([row("a", thirteen), row("b", twelve), row("c", "fine", thirteen), row(thirteen)]);

    expect(EXPLAIN_CAPS.itemWords).toBe(12);
    expect(out?.items).toEqual([{ term: "b", here: twelve, read: "how a reader should take it" }]);
  });

  it("drops a row with a cell over eighty characters, and does not cut it", () => {
    const over = "x".repeat(81);
    const exact = "y".repeat(80);
    const out = items([row("a", over), row("b", exact), row("c", "ok", over)]);

    expect(EXPLAIN_CAPS.itemChars).toBe(80);
    expect(out?.items).toEqual([{ term: "b", here: exact, read: "how a reader should take it" }]);
  });

  it("counts a Chinese cell by its characters, two to a word, so a dozen words is about twenty-four characters", () => {
    const ok = "片状析出物占试样的比例"; // 11 characters
    const wordy = "片状析出物在载荷下缓慢长大并最终连成一片完整的板状结构"; // over 24 characters
    const out = items([row("比值", ok), row("单元分数", wordy), row("a", "b", ok)]);

    expect(out?.items?.map((item) => item.term)).toEqual(["比值", "a"]);
  });

  it("says each term once: a second row for the same term, in any case, is dropped", () => {
    const out = items([row("Grain ratio"), row("grain  RATIO"), row("f_cell")]);

    expect(out?.items?.map((item) => item.term)).toEqual(["Grain ratio", "f_cell"]);
  });

  it("takes a web address out of a cell, and drops the row when nothing else was in it", () => {
    const out = items([row("a", "see https://example.org/x for the value"), row("b", "https://example.org/only", "c")]);

    expect(JSON.stringify(out?.items)).not.toMatch(/https?:|example\.org/);
    expect(out?.items?.map((item) => item.term)).toEqual(["a"]);
  });

  it("holds the prose to two sentences when there is a table, and to the usual three or eight when there is none", () => {
    const prose = sentences(6);

    expect(items([row("a")], { reply: prose })?.reply).toBe(sentences(2));
    expect(items([row("a")], { reply: prose }) && sanitizeExplainReply({ reply: prose, items: [row("a")] }, { detail: true })?.reply).toBe(sentences(2));
    expect(sanitizeExplainReply({ reply: prose, items: [] })?.reply).toBe(sentences(3));
    expect(sanitizeExplainReply({ reply: prose, items: [{ term: "a" }] })?.reply).toBe(sentences(3));
    expect(sanitizeExplainReply({ reply: prose, items: [] }, { detail: true })?.reply).toBe(prose);
    expect(EXPLAIN_CAPS.itemsReplySentences).toBe(2);
  });

  it("is still no reply without prose, whatever the table holds", () => {
    expect(sanitizeExplainReply({ reply: "", items: [row("a")] })).toBeNull();
    expect(sanitizeExplainReply({ items: [row("a")] })).toBeNull();
  });
});

describe("the term table's grounding (P3-07)", () => {
  const located = locatePassage(doc, "fraction of the gauge length")!;
  const scope = { passage: "fraction of the gauge length", located };
  const row = (term: string): ExplainItem => ({ term, here: "means this here", read: "read it so" });
  const terms = (list: ExplainItem[], over: Parameters<typeof groundExplainItems>[2] = scope) => groundExplainItems(list, doc, over).map((item) => item.term);

  it("keeps a term that occurs in the passage, in its paragraph, in a neighbour, or in the section the passage sits in", () => {
    expect(terms([row("gauge length")])).toEqual(["gauge length"]);
    expect(terms([row("rafting ratio")])).toEqual(["rafting ratio"]);
    // The paragraph before the passage's, and the one after it.
    expect(terms([row("single casting")])).toEqual(["single casting"]);
    expect(terms([row("hint tests")])).toEqual(["hint tests"]);
    // Four paragraphs on, still in the same section.
    expect(terms([row("constant load")])).toEqual(["constant load"]);
  });

  it("drops a term that occurs nowhere there — including one the rest of the paper holds", () => {
    expect(terms([row("tungsten additions"), row("spline interpolation"), row("gauge length")])).toEqual(["gauge length"]);
  });

  it("matches the way the verifier does: case and runs of white space do not matter", () => {
    expect(terms([row("RAFTING   Ratio")])).toEqual(["RAFTING   Ratio"]);
  });

  it("holds a term to whole words: it is not found inside a longer word or a longer number", () => {
    expect(terms([row("auge")])).toEqual([]);
    expect(terms([row("0.2")])).toEqual([]);
    expect(groundExplainItems([row("0.5")], doc, { passage: "a ratio of 10.55 and 0.5, then more", located: { ...located, paragraph: "a ratio of 10.55 and 0.5, then more", before: null, after: null } }).map((item) => item.term)).toEqual(["0.5"]);
    expect(groundExplainItems([row("0.5")], doc, { passage: "a ratio of 10.55", located: { ...located, paragraph: "a ratio of 10.55", before: null, after: null, sectionId: "s0" } })).toEqual([]);
  });

  it("looks in the located section only: a term in another section is not grounded", () => {
    expect(terms([row("tungsten additions")], { passage: scope.passage, located: { ...located, sectionId: "s3" } })).toEqual(["tungsten additions"]);
    expect(terms([row("tungsten additions")])).toEqual([]);
  });

  it("drops a blank term, and keeps the order of what stays", () => {
    expect(terms([row("   "), row("rafting ratio"), row("nowhere at all"), row("gauge length")])).toEqual(["rafting ratio", "gauge length"]);
  });

  it("verifyExplainReply keeps the grounded rows on the turn and drops the rest, with the quote verified as before", () => {
    const turn = verifyExplainReply({ reply: "Two values.", evidence: RAFT_DEF, items: [row("rafting ratio"), row("tungsten additions")] }, doc, "s2", scope);

    expect(turn).toEqual({ role: "peer", text: "Two values.", evidence: RAFT_DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, items: [row("rafting ratio")] });
  });

  it("verifyExplainReply has no items key when none is grounded, and none at all without the scope to ground them in", () => {
    expect(verifyExplainReply({ reply: "x", items: [row("tungsten additions")] }, doc, "s2", scope)).toEqual({ role: "peer", text: "x", peer: true });
    expect(verifyExplainReply({ reply: "x", items: [row("rafting ratio")] }, doc, "s2")).toEqual({ role: "peer", text: "x", peer: true });
    expect(verifyExplainReply({ reply: "x" }, doc, "s2", scope)).toEqual({ role: "peer", text: "x", peer: true });
  });

  it("changes nothing in the reply it was given", () => {
    const given = { reply: "x", items: [row("rafting ratio"), row("nowhere at all")] };
    const copy = JSON.parse(JSON.stringify(given)) as typeof given;
    verifyExplainReply(given, doc, "s2", scope);

    expect(given).toEqual(copy);
  });
});

// ── P4-00c (§1h.11 (d), A's P3-06b O-6): the displayed quote keeps the paper's notation ──
// The verified quote turned the author's `f_cell` into `fcell` on the page, because the cleaner
// strips an underscore as a LaTeX subscript, while the prose and the table cells kept it. A quote
// that claims to be the paper's own words must show the paper's characters. MATCHING stays on the
// cleaned forms (the verifier normalises both sides, so a quote that lost its underscore, or its
// case, still verifies); DISPLAY is the paper's own characters: the model's copy when it is verbatim
// in the located section, else the paper's words found by aligning the normalised words with the
// section's, else — only when neither can be done — the model's words cleaned with the underscore kept.

describe("the displayed quote keeps the paper's notation (P4-00c)", () => {
  const F_SENTENCE = "The ratio f_cell was 0.4 across every cell of the specimen, and f_cell stayed flat.";
  const ALPHA_SENTENCE = "The slope α_1 stayed near 0.2 in every cell of the specimen under load.";
  const notationDoc: ExtractedDocument = {
    source: "pdf",
    pageCount: 1,
    figureCaptions: [],
    sections: [
      { id: "s1", heading: "2 Results", canonical: "results", page: 1, text: `Cells were counted twice by two people.\n\n${F_SENTENCE}\n\n${ALPHA_SENTENCE}\n\nNothing else changed during the run.` },
    ],
  };
  // The real path: the model's JSON through the sanitizer, then the verifier — what the route does.
  const turn = (evidence: string, doc: ExtractedDocument = notationDoc) => verifyExplainReply(sanitizeExplainReply({ reply: "Peer's words.", evidence }) as NonNullable<ReturnType<typeof sanitizeExplainReply>>, doc, "s1");
  const answerOf = (evidence: string, doc: ExtractedDocument = notationDoc) => verifyExplainAnswer(sanitizeExplainAnswer({ meaning: "m", here: { text: "t", evidence } }) as ExplainAnswer, doc, "s1");

  it("keeps `f_cell` and `α_1` through the sanitizer: the quote it will try to verify is not cleaned", () => {
    expect(sanitizeExplainAnswer({ meaning: "m", here: { text: "t", evidence: F_SENTENCE } })?.here.evidence).toBe(F_SENTENCE);
    expect(sanitizeExplainAnswer({ meaning: "m", here: { text: "t", evidence: ALPHA_SENTENCE } })?.here.evidence).toBe(ALPHA_SENTENCE);
    expect(sanitizeExplainReply({ reply: "r", evidence: F_SENTENCE })?.evidence).toBe(F_SENTENCE);
    expect(sanitizeExplainReply({ reply: "r", evidence: ALPHA_SENTENCE })?.evidence).toBe(ALPHA_SENTENCE);
  });

  it("collapses white space in the quote as it always did, and caps it at 400 characters", () => {
    expect(sanitizeExplainReply({ reply: "r", evidence: `  The ratio f_cell was 0.4\n across   every cell.  ` })?.evidence).toBe("The ratio f_cell was 0.4 across every cell.");
    expect(sanitizeExplainReply({ reply: "r", evidence: `f_cell ${"x".repeat(2000)}` })?.evidence?.length).toBeLessThanOrEqual(EXPLAIN_CAPS.evidenceChars);
  });

  it("shows the paper's `f_cell` in the verified quote of a first answer and of a reply", () => {
    expect(answerOf(F_SENTENCE).here).toMatchObject({ evidence: F_SENTENCE, evidenceWhere: "2 Results", sectionId: "s1", page: 1 });
    expect(turn(F_SENTENCE)).toMatchObject({ evidence: F_SENTENCE, evidenceWhere: "2 Results", sectionId: "s1" });
    expect(answerOf(F_SENTENCE).here.peer).toBeUndefined();
  });

  it("shows the paper's `α_1` too", () => {
    expect(answerOf(ALPHA_SENTENCE).here.evidence).toBe(ALPHA_SENTENCE);
    expect(turn(ALPHA_SENTENCE).evidence).toBe(ALPHA_SENTENCE);
  });

  it("matches on the cleaned forms and still displays the paper's characters: a quote that lost the underscore, or changed case, verifies and shows the paper's own", () => {
    const lost = F_SENTENCE.replace(/f_cell/g, "fcell");
    // (Not all capitals: the cleaner reads "WAS 0.4" as a formula and joins it, which is the cleaner's, and not this item's.)
    const shouting = F_SENTENCE.replace("The ratio", "the RATIO").replace("f_cell was", "F_CELL was");

    expect(answerOf(lost).here).toMatchObject({ evidence: F_SENTENCE, evidenceWhere: "2 Results" });
    expect(turn(lost).evidence).toBe(F_SENTENCE);
    expect(answerOf(shouting).here.evidence).toBe(F_SENTENCE);
    expect(turn(ALPHA_SENTENCE.replace("α_1", "α1")).evidence).toBe(ALPHA_SENTENCE);
  });

  it("shows a fragment of a sentence as the paper has it, not the sentence", () => {
    const fragment = "across every cell of the specimen, and f_cell stayed flat.";

    expect(answerOf(fragment).here.evidence).toBe(fragment);
    expect(turn(fragment.replace("f_cell", "fcell")).evidence).toBe(fragment);
  });

  it("is always the paper's own text: whatever it shows is a stretch of the located section, with its white space collapsed", () => {
    const section = notationDoc.sections[0].text.replace(/\s+/g, " ");
    for (const evidence of [F_SENTENCE, F_SENTENCE.replace(/f_cell/g, "fcell"), F_SENTENCE.replace("The ratio", "the RATIO").replace("f_cell was", "F_CELL was"), ALPHA_SENTENCE, ALPHA_SENTENCE.replace("α_1", "α1"), `  ${F_SENTENCE.replace(" ", "   ")}  `]) {
      const shown = answerOf(evidence.replace(/\s+/g, " ").trim()).here.evidence as string;
      expect(section.includes(shown), evidence).toBe(true);
    }
  });

  it("is the paper's curly quotes, symbols and dashes, not the cleaner's: what the body shows is what the quote shows", () => {
    const raw = "The specimen “Cell A” held 1100 °C for 10 h with a drift of ≤ 0.2 µm – no more than that.";
    const special: ExtractedDocument = { ...notationDoc, sections: [{ id: "s1", heading: "2 Results", canonical: "results", page: 1, text: `Intro words here.\n\n${raw}\n\nNothing else.` }] };
    const shown = turn(raw, special).evidence;

    expect(shown).toBe(raw);
  });

  it("still cleans a quote the paper does not hold verbatim and cannot be aligned: the model's words cleaned, the underscore kept", () => {
    // The section has an author-year citation inside the sentence that the quote leaves out: the cleaned forms
    // match (the matcher drops the citation from the whole text), but one word at a time they do not line up, so
    // the model's own words are shown — cleaned (an entity decoded) and with the author's underscore kept.
    const cited: ExtractedDocument = { ...notationDoc, sections: [{ id: "s1", heading: "2 Results", canonical: "results", text: "Intro words here.\n\nThe ratio f_cell was 0.4 across (Smith et al., 2020) every cell of the specimen & nothing else.\n\nEnd." }] };
    const shown = turn("The ratio f_cell was 0.4 across every cell of the specimen &amp; nothing else", cited);

    expect(shown).toMatchObject({ evidence: "The ratio f_cell was 0.4 across every cell of the specimen & nothing else", evidenceWhere: "2 Results", sectionId: "s1" });
    expect(shown.peer).toBeUndefined();
  });

  it("shows Chinese text as the paper has it", () => {
    const zh = "我们把片状析出物占试样的比例定义为 f_cell，并在每个试样上测量了两次以确认结果。";
    const doc2: ExtractedDocument = { ...notationDoc, sections: [{ id: "s1", heading: "2 结果", canonical: "results", text: `前言。\n\n${zh}\n\n结束。` }] };

    expect(turn(zh, doc2).evidence).toBe(zh);
  });

  it("drops a quote the paper does not hold, exactly as before: no quote, the prose is Peer's", () => {
    const invented = "The ratio f_cell was 0.9 across every cell of the specimen, and f_cell stayed flat.";

    expect(answerOf(invented).here).toEqual({ text: "t", peer: true });
    expect(turn(invented)).toEqual({ role: "peer", text: "Peer's words.", peer: true });
    // And the quote is not smuggled back in by the sanitiser's not cleaning it: nothing unverified is shown.
    expect(JSON.stringify(turn(invented))).not.toContain("0.9");
  });
});

// ── P4-00c (§1h.11 (a), A's P3-06b P7-14): the first answer may carry the term table ──
// The owner's standard — a placing sentence that quotes the author's phrase, then the
// compact table — applies to the first answer too, not only to a reply. The first
// answer's schema gains the same optional `items`; the rows go through the reply's own
// sanitizer and grounding (`sanitizeItems`, `groundExplainItems`: shared, not copied);
// with a table each of the two parts is one sentence, without one the two-sentence cap
// stands.

describe("the first answer's term table (P4-00c)", () => {
  const row = (term: string, here = "what it means in this paper", read = "how a reader should take it"): Record<string, string> => ({ term, here, read });
  const parts = { meaning: "The ratio is the share of the gauge length that plates cover. Plates are what precipitates become.", here: { text: "The authors use it to compare alloys fairly. It rose with heat.", evidence: RAFT_DEF } };
  const withItems = (raw: unknown, over: Record<string, unknown> = {}) => sanitizeExplainAnswer({ ...parts, items: raw, ...over });

  it("keeps well-formed rows in order, trimmed, with only term, here and read", () => {
    const out = withItems([{ term: "  grain ratio ", here: " the width over the length ", read: " 0.4 is a narrow sample ", extra: "x" }, row("f_cell")]);

    expect(out?.items).toEqual([
      { term: "grain ratio", here: "the width over the length", read: "0.4 is a narrow sample" },
      { term: "f_cell", here: "what it means in this paper", read: "how a reader should take it" },
    ]);
  });

  it("is shared with the reply's sanitizer, not copied: the same raw table gives the same rows in both", () => {
    const thirteen = "one two three four five six seven eight nine ten eleven twelve thirteen";
    const raw = [
      row("a", thirteen), row("Grain ratio"), row("grain  RATIO"), row("x".repeat(81)), row("see", "see https://example.org/x for it"),
      row("b", "y".repeat(80)), row("c"), row("d"), row("e"), { term: "no cells" }, "text", null,
    ];

    expect(withItems(raw)?.items).toEqual(sanitizeExplainReply({ reply: "Two values.", items: raw })?.items);
    expect(withItems(raw)?.items?.length).toBe(EXPLAIN_CAPS.itemRows);
  });

  it("has no items key at all for no table, an empty one and anything that is not a list of rows — and the answer is then what it was", () => {
    const without = sanitizeExplainAnswer(parts);

    expect(without).toEqual({ meaning: "The ratio is the share of the gauge length that plates cover. Plates are what precipitates become.", here: { text: "The authors use it to compare alloys fairly. It rose with heat.", evidence: RAFT_DEF } });
    for (const raw of [undefined, null, [], "table", 5, {}, [1, "x", null], [{ term: "a" }], [{ term: "a", here: "b" }], [{ term: "a", here: "b", read: 3 }], [{ term: " ", here: "b", read: "c" }]]) {
      expect(withItems(raw), JSON.stringify(raw)).toEqual(without);
    }
  });

  it("holds each part to one sentence when there is a table, and to the usual two when there is none", () => {
    const longParts = { meaning: "One is plain. Two is plain too. Three must go.", here: { text: "First reason. Second reason. Third reason." } };
    const table = sanitizeExplainAnswer({ ...longParts, items: [row("a")] });

    expect(table?.meaning).toBe("One is plain.");
    expect(table?.here.text).toBe("First reason.");
    expect(sanitizeExplainAnswer(longParts)?.meaning).toBe("One is plain. Two is plain too.");
    expect(sanitizeExplainAnswer(longParts)?.here.text).toBe("First reason. Second reason.");
    // A table the shape sanitiser empties is no table: the parts keep their two sentences.
    expect(sanitizeExplainAnswer({ ...longParts, items: [{ term: "a" }] })?.meaning).toBe("One is plain. Two is plain too.");
    expect(EXPLAIN_CAPS.itemsPartSentences).toBe(1);
    expect(EXPLAIN_CAPS.partSentences).toBe(2);
  });

  it("still caps a part at 420 characters with a table, and a lone sentence over it is cut at a word and marked", () => {
    const out = sanitizeExplainAnswer({ meaning: `${"plates grow slowly ".repeat(60)}and that is all.`, here: { text: sized("h", 300) }, items: [row("a")] });

    expect(out?.meaning.length).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
    expect(out?.meaning.endsWith("…")).toBe(true);
    expect(out?.here.text).toBe(sized("h", 300));
  });

  it("counts Chinese sentences too: one a part with a table, two without", () => {
    expect(sanitizeExplainAnswer({ meaning: sentencesZh(5), here: { text: sentencesZh(4) }, items: [row("比值", "占比", "越大越好")] })).toEqual({
      meaning: sentencesZh(1), here: { text: sentencesZh(1) }, items: [{ term: "比值", here: "占比", read: "越大越好" }],
    });
    expect(sanitizeExplainAnswer({ meaning: sentencesZh(5), here: { text: sentencesZh(4) } })).toEqual({ meaning: sentencesZh(2), here: { text: sentencesZh(2) } });
  });

  it("is still no answer unless both parts have words, whatever the table holds", () => {
    expect(sanitizeExplainAnswer({ meaning: "", here: { text: "x" }, items: [row("a")] })).toBeNull();
    expect(sanitizeExplainAnswer({ meaning: "x", here: { text: " " }, items: [row("a")] })).toBeNull();
    expect(sanitizeExplainAnswer({ items: [row("a")] })).toBeNull();
  });

  it("keeps the quote it will try to verify as it did, and nothing else the model said", () => {
    const out = sanitizeExplainAnswer({ ...parts, items: [row("a")], extra: "x", here: { ...parts.here, peer: true, page: 7 } });

    expect(out?.here).toEqual({ text: "The authors use it to compare alloys fairly.", evidence: RAFT_DEF });
    expect(Object.keys(out ?? {})).toEqual(["meaning", "here", "items"]);
  });

  describe("verifyExplainAnswer holds the rows to the paper", () => {
    const located = locatePassage(doc, "fraction of the gauge length")!;
    const scope = { passage: "fraction of the gauge length", located };
    const answer: ExplainAnswer = {
      meaning: "A measure of plate coverage.",
      here: { text: "It compares alloys.", evidence: RAFT_DEF },
      items: [
        { term: "gauge length", here: "the measured stretch", read: "longer is a bigger sample" },
        { term: "spline interpolation", here: "a method nobody used", read: "ignore it" },
        { term: "rafting ratio", here: "the plate share", read: "higher is more plates" },
        { term: "tungsten additions", here: "in another section", read: "not here" },
      ],
    };

    it("keeps the grounded rows in order and drops the ungrounded ones, whole — including a term the rest of the paper holds", () => {
      const out = verifyExplainAnswer(answer, doc, located.sectionId, scope);

      expect(out.items?.map((item) => item.term)).toEqual(["gauge length", "rafting ratio"]);
      expect(out.items?.[0]).toEqual(answer.items?.[0]);
    });

    it("is the same grounding the reply uses: the same rows kept for the same scope", () => {
      const turn = verifyExplainReply({ reply: "Two values.", items: answer.items }, doc, located.sectionId, scope);

      expect(verifyExplainAnswer(answer, doc, located.sectionId, scope).items).toEqual(turn.items);
    });

    it("verifies the quote exactly as before, with the table beside it", () => {
      const out = verifyExplainAnswer(answer, doc, located.sectionId, scope);

      expect(out.here).toMatchObject({ text: "It compares alloys.", evidence: RAFT_DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 });
      expect(out.here.peer).toBeUndefined();
      const noQuote = verifyExplainAnswer({ ...answer, here: { text: "It compares alloys." } }, doc, located.sectionId, scope);
      expect(noQuote.here).toEqual({ text: "It compares alloys.", peer: true });
      expect(noQuote.items?.length).toBe(2);
    });

    it("has no items key when no row is grounded, and none at all without the scope to ground them in", () => {
      const ungrounded = { ...answer, items: [answer.items![1], answer.items![3]] };

      expect("items" in verifyExplainAnswer(ungrounded, doc, located.sectionId, scope)).toBe(false);
      expect("items" in verifyExplainAnswer(answer, doc, located.sectionId)).toBe(false);
      expect("items" in verifyExplainAnswer({ meaning: "m", here: { text: "t" } }, doc, located.sectionId, scope)).toBe(false);
    });

    it("changes nothing in the answer it was given", () => {
      const before = JSON.stringify(answer);
      verifyExplainAnswer(answer, doc, located.sectionId, scope);

      expect(JSON.stringify(answer)).toBe(before);
    });
  });
});

describe("explainCacheKey with the long form (P3-07)", () => {
  const texts = [FIRST.text, ASKED.text];

  it("keeps a short and a long reply to the same message apart", () => {
    const short = explainCacheKey("doc-hash", "The rafting ratio", texts);
    const long = explainCacheKey("doc-hash", "The rafting ratio", texts, false, true);

    expect(long).not.toBe(short);
    expect(long).toMatch(/^[0-9a-f]{64}$/);
  });

  it("is what it was when the long form is off, searched or not", () => {
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, false, false)).toBe(explainCacheKey("doc-hash", "The rafting ratio", texts));
    expect(explainCacheKey("doc-hash", "The rafting ratio", texts, true, false)).toBe(explainCacheKey("doc-hash", "The rafting ratio", texts, true));
  });

  it("keeps a searched long reply apart from a searched short one and from an unsearched long one", () => {
    const keys = new Set([
      explainCacheKey("d", "p", texts, false, false),
      explainCacheKey("d", "p", texts, true, false),
      explainCacheKey("d", "p", texts, false, true),
      explainCacheKey("d", "p", texts, true, true),
    ]);

    expect(keys.size).toBe(4);
  });
});

// ── The harness (§1h.9 (4)): over-long canned answers, both languages, with and
// without the long form, through the sanitizers; every output is within the caps
// and every sentence in it whole. A fixture is what a model could write when it
// does not follow the rules: a lecture, a table with a paragraph of cells, a
// sentence that never stops.

describe("brevity harness", () => {
  interface ReplyCase {
    name: string;
    language: "en" | "zh";
    detail: boolean;
    text: string;
    /** The one case where a single sentence is itself over the cap: the cut is marked. */
    runaway?: true;
  }
  const replyCases: ReplyCase[] = [
    { name: "a lecture of nine short sentences", language: "en", detail: false, text: sentences(9, "a") },
    { name: "the same lecture, asked for in detail", language: "en", detail: true, text: sentences(14, "b") },
    { name: "four sentences of 300 characters", language: "en", detail: false, text: [1, 2, 3, 4].map((n) => sized(`c${n}`, 300)).join(" ") },
    { name: "twelve sentences of 200 characters, asked for in detail", language: "en", detail: true, text: Array.from({ length: 12 }, (_, i) => sized(`d${i}`, 200)).join(" ") },
    { name: "a lecture of nine short sentences in Chinese", language: "zh", detail: false, text: sentencesZh(9) },
    { name: "a Chinese lecture asked for in detail", language: "zh", detail: true, text: sentencesZh(14) },
    { name: "three Chinese sentences of 250 characters", language: "zh", detail: false, text: [1, 2, 3].map((n) => sizedZh(n, 250)).join("") },
    { name: "ten Chinese sentences of 200 characters, asked for in detail", language: "zh", detail: true, text: Array.from({ length: 10 }, (_, i) => sizedZh(i + 1, 200)).join("") },
    { name: "a quoted phrase with full stops in it, then a lecture", language: "en", detail: false, text: `The authors report “Grain 0.4. Cell 0.57” for the sample. ${sentences(8, "e")}` },
    { name: "a sentence that never stops", language: "en", detail: false, text: `${"plates grow slowly ".repeat(90)}and that is all.`, runaway: true },
    { name: "a Chinese sentence that never stops", language: "zh", detail: true, text: `${"片状析出物在载荷下缓慢长大，".repeat(150)}这就是全部。`, runaway: true },
  ];

  it("has at least eight over-long answers, in both languages, with and without the long form", () => {
    expect(replyCases.length).toBeGreaterThanOrEqual(8);
    expect(new Set(replyCases.map((c) => c.language))).toEqual(new Set(["en", "zh"]));
    expect(new Set(replyCases.map((c) => c.detail))).toEqual(new Set([true, false]));
    for (const c of replyCases) expect(c.text.length, c.name).toBeGreaterThan(c.detail ? 200 : 100);
  });

  it.each(replyCases)("a reply — $name — comes out within the caps, in whole sentences", ({ name, detail, text, runaway }) => {
    const out = sanitizeExplainReply({ reply: text }, { detail })?.reply as string;
    const sentenceCap = detail ? 8 : 3;
    const charCap = detail ? 1400 : 560;

    expect(out, name).toBeTruthy();
    expect(out.length, name).toBeLessThanOrEqual(charCap);
    if (runaway) {
      // Not a whole sentence, and it says so.
      expect(out.endsWith("…"), name).toBe(true);
      return;
    }
    expect(countSentences(out.replace(/"[^"]*"/g, "QUOTE")), name).toBeLessThanOrEqual(sentenceCap);
    expect(wholeCut(text, out), name).toBe(true);
    expect((out.match(/"/g) ?? []).length % 2, name).toBe(0);
  });

  it("a reply that was asked for in detail is never shorter than the same reply by default", () => {
    for (const { text } of replyCases) {
      const short = sanitizeExplainReply({ reply: text })?.reply as string;
      const long = sanitizeExplainReply({ reply: text }, { detail: true })?.reply as string;

      expect(long.length).toBeGreaterThanOrEqual(short.length);
    }
  });

  interface AnswerCase { name: string; meaning: string; here: string }
  const answerCases: AnswerCase[] = [
    { name: "a first answer of three long sentences a part", meaning: [1, 2, 3].map((n) => sized(`m${n}`, 250)).join(" "), here: [1, 2, 3].map((n) => sized(`h${n}`, 250)).join(" ") },
    { name: "a first answer of five short sentences a part", meaning: sentences(5, "m"), here: sentences(5, "h") },
    { name: "a first answer in Chinese, five sentences a part", meaning: sentencesZh(5), here: sentencesZh(5) },
    { name: "a first answer in Chinese of 300-character sentences", meaning: [1, 2].map((n) => sizedZh(n, 300)).join(""), here: [1, 2].map((n) => sizedZh(n + 2, 300)).join("") },
  ];

  it.each(answerCases)("a first answer — $name — comes out as two parts of at most two whole sentences and 420 characters", ({ name, meaning, here }) => {
    const answer = sanitizeExplainAnswer({ meaning, here: { text: here } });

    expect(answer, name).not.toBeNull();
    for (const [part, source] of [[answer?.meaning as string, meaning], [answer?.here.text as string, here]] as const) {
      expect(part.length, name).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
      expect(countSentences(part), name).toBeLessThanOrEqual(2);
      expect(part.endsWith("…") || wholeCut(source, part), name).toBe(true);
    }
  });

  // P4-00c (§1h.11 (a)): the first answer carries a table too, so the harness runs first answers
  // with over-long parts and over-long rows, both languages. With a table each part is one whole
  // sentence; a row over a cap is dropped whole; at most four rows survive.
  interface AnswerTableCase { name: string; language: "en" | "zh"; meaning: string; here: string; rows: Record<string, string>[] }
  const longCell = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const answerTableCases: AnswerTableCase[] = [
    {
      name: "three long sentences a part under seven rows, three of them paragraphs",
      language: "en",
      meaning: [1, 2, 3].map((n) => sized(`m${n}`, 250)).join(" "),
      here: [1, 2, 3].map((n) => sized(`h${n}`, 250)).join(" "),
      rows: [
        { term: "a", here: longCell(5), read: longCell(5) },
        { term: "b", here: longCell(40), read: longCell(5) },
        { term: "c", here: longCell(5), read: longCell(5) },
        { term: "d", here: longCell(5), read: longCell(200) },
        { term: "e", here: longCell(5), read: longCell(5) },
        { term: "f", here: longCell(13), read: longCell(5) },
        { term: "g", here: longCell(5), read: longCell(5) },
      ],
    },
    {
      name: "a part that is one sentence that never stops, under rows of 81-character cells",
      language: "en",
      meaning: `${"plates grow slowly ".repeat(60)}and that is all.`,
      here: sentences(5, "h"),
      rows: [
        { term: "a", here: "x".repeat(81), read: "fine" },
        { term: "b", here: "short", read: "also short" },
        { term: "c", here: "short", read: "y".repeat(81) },
        { term: "d", here: "short", read: "also short" },
      ],
    },
    {
      name: "a Chinese answer of five sentences a part under a Chinese table with long cells",
      language: "zh",
      meaning: sentencesZh(5),
      here: sentencesZh(5),
      rows: [
        { term: "比值", here: "片状析出物占试样的比例", read: "越大说明连片越多" },
        { term: "单元分数", here: "片状析出物在载荷下缓慢长大并最终连成一片完整的板状结构", read: "越大越好" },
        { term: "晶粒比", here: "宽度与高度之比", read: "0.4 表示偏窄" },
        { term: "密度", here: "单位体积的质量", read: "越大越重" },
        { term: "模量", here: "抵抗变形的能力", read: "越大越硬" },
        { term: "硬度", here: "抵抗压入的能力", read: "越大越硬" },
      ],
    },
    {
      name: "a Chinese answer of 300-character sentences under a table of paragraphs",
      language: "zh",
      meaning: [1, 2].map((n) => sizedZh(n, 300)).join(""),
      here: [1, 2].map((n) => sizedZh(n + 2, 300)).join(""),
      rows: Array.from({ length: 5 }, (_, i) => ({ term: `项${i}`, here: sizedZh(i + 1, 60), read: "越大越好" })).concat([{ term: "项ok", here: "占比", read: "越大越好" }]),
    },
  ];

  it("has at least three first answers with over-long parts and rows, in both languages", () => {
    expect(answerTableCases.length).toBeGreaterThanOrEqual(3);
    expect(new Set(answerTableCases.map((c) => c.language))).toEqual(new Set(["en", "zh"]));
    for (const c of answerTableCases) {
      expect(c.rows.length, c.name).toBeGreaterThan(3);
      // Over-long: more than the one sentence a part may have with a table, or longer than a part may be.
      expect(countSentences(c.meaning) > 1 || c.meaning.length > EXPLAIN_CAPS.partChars, c.name).toBe(true);
      expect(countSentences(c.here) > 1 || c.here.length > EXPLAIN_CAPS.partChars, c.name).toBe(true);
    }
  });

  it.each(answerTableCases)("a first answer with a table — $name — comes out as two parts of one whole sentence and at most four rows within the cell caps", ({ name, meaning, here, rows }) => {
    const out = sanitizeExplainAnswer({ meaning, here: { text: here }, items: rows });
    const words = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).length / 2 + (text.replace(/\p{Script=Han}/gu, " ").match(/\S+/g) ?? []).length;

    expect(out, name).not.toBeNull();
    for (const [part, source] of [[out?.meaning as string, meaning], [out?.here.text as string, here]] as const) {
      expect(part.length, name).toBeLessThanOrEqual(EXPLAIN_CAPS.partChars);
      expect(countSentences(part), name).toBeLessThanOrEqual(1);
      expect(part.endsWith("…") || wholeCut(source, part), name).toBe(true);
    }
    expect(out?.items?.length ?? 0, name).toBeGreaterThan(0);
    expect(out?.items?.length ?? 0, name).toBeLessThanOrEqual(4);
    for (const item of out?.items ?? []) {
      for (const text of [item.term, item.here, item.read]) {
        expect(text.length, name).toBeLessThanOrEqual(80);
        expect(words(text), name).toBeLessThanOrEqual(12);
      }
    }
  });

  it("a first answer whose whole table is over the caps is the two-part answer it was: no table, two sentences a part", () => {
    const out = sanitizeExplainAnswer({ meaning: sentences(5, "m"), here: { text: sentences(5, "h") }, items: Array.from({ length: 6 }, (_, i) => ({ term: `t${i}`, here: longCell(30), read: longCell(4) })) });

    expect(out).toEqual({ meaning: sentences(2, "m"), here: { text: sentences(2, "h") } });
  });

  interface TableCase { name: string; rows: Record<string, string>[]; prose: string }
  const cell = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(" ");
  const tableCases: TableCase[] = [
    {
      name: "seven rows, three with a cell of a paragraph, under four sentences of prose",
      prose: sentences(4, "t"),
      rows: [
        { term: "a", here: cell(5), read: cell(5) },
        { term: "b", here: cell(40), read: cell(5) },
        { term: "c", here: cell(5), read: cell(5) },
        { term: "d", here: cell(5), read: cell(200) },
        { term: "e", here: cell(5), read: cell(5) },
        { term: "f", here: cell(13), read: cell(5) },
        { term: "g", here: cell(5), read: cell(5) },
      ],
    },
    {
      name: "a Chinese table with long cells under a Chinese lecture",
      prose: sentencesZh(6),
      rows: [
        { term: "比值", here: "片状析出物占试样的比例", read: "越大说明连片越多" },
        { term: "单元分数", here: "片状析出物在载荷下缓慢长大并最终连成一片完整的板状结构", read: "越大越好" },
        { term: "晶粒比", here: "宽度与高度之比", read: "0.4 表示偏窄" },
        { term: "密度", here: "单位体积的质量", read: "越大越重" },
        { term: "模量", here: "抵抗变形的能力", read: "越大越硬" },
      ],
    },
  ];

  it.each(tableCases)("a table — $name — comes out with at most four rows, each cell a dozen words, the prose two sentences", ({ name, rows, prose }) => {
    const out = sanitizeExplainReply({ reply: prose, items: rows }, { detail: false });
    const words = (text: string) => (text.match(/\p{Script=Han}/gu) ?? []).length / 2 + (text.replace(/\p{Script=Han}/gu, " ").match(/\S+/g) ?? []).length;

    expect(out, name).not.toBeNull();
    expect(out?.items?.length ?? 0, name).toBeGreaterThan(0);
    expect(out?.items?.length ?? 0, name).toBeLessThanOrEqual(4);
    for (const item of out?.items ?? []) {
      for (const text of [item.term, item.here, item.read]) {
        expect(text.length, name).toBeLessThanOrEqual(80);
        expect(words(text), name).toBeLessThanOrEqual(12);
      }
    }
    expect(countSentences(out?.reply as string), name).toBeLessThanOrEqual(2);
    expect(wholeCut(prose, out?.reply as string), name).toBe(true);
  });

  it("holds when a model that ignores every rule answers: lecture, long quote, table of paragraphs, all at once", () => {
    const rows = Array.from({ length: 12 }, (_, i) => ({ term: `t${i}`, here: cell(i < 6 ? 30 : 4), read: cell(4) }));
    const out = sanitizeExplainReply({ reply: sentences(30), evidence: RAFT_DEF, items: rows });

    expect(out?.reply).toBe(sentences(2));
    expect(out?.evidence).toBe(RAFT_DEF);
    expect(out?.items?.map((item) => item.term)).toEqual(["t6", "t7", "t8", "t9"]);
    // A table of paragraphs, every cell over the cap, is no table, and the prose is then the usual three.
    const none = sanitizeExplainReply({ reply: sentences(30), items: rows.slice(0, 6) });
    expect(none).toEqual({ reply: sentences(3) });
  });
});
