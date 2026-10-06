import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { sectionParagraphs, openingOf } from "./reading-map";
import {
  EXPLAIN_CAPS,
  buildExplainPrompt,
  buildExplainReplyPrompt,
  clipPassage,
  createExplainCache,
  explainCacheKey,
  explainDocHash,
  explainMapLines,
  locatePassage,
  parseModelJson,
  readThread,
  sanitizeExplainAnswer,
  sanitizeExplainReply,
  verifyExplainAnswer,
  verifyExplainReply,
  type ExplainAnswer,
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

// P3-02c (§1h.4 amendment): `explainDayKey` — the count-only counter's key — is
// gone with the count; the charge replaces it. Its four assertions (the key names
// the reader and the UTC day, rolls over at midnight UTC, differs by reader, is
// stable within the day) are carried over to `explainTenthsKey` in
// `lib/usage/explain-quota.test.ts`, not dropped.

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

  it("clips each message to 400 characters, at a word", () => {
    const long = Array.from({ length: 300 }, (_, i) => `w${i}`).join(" ");
    const read = readThread([{ role: "peer", text: long }, { role: "reader", text: "x".repeat(5000) }]);

    expect(EXPLAIN_CAPS.messageChars).toBe(400);
    expect(read.messages[0].text.length).toBeLessThanOrEqual(400);
    expect(long.startsWith(read.messages[0].text)).toBe(true);
    expect(read.messages[0].text.length).toBeGreaterThan(350);
    expect(read.messages[1].text).toHaveLength(400);
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
