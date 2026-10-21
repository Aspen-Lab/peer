import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { buildExplainPrompt, buildExplainReplyPrompt, explainCacheKey, locatePassage, type LocatedPassage } from "./explain";

type Block = NonNullable<LocatedPassage["block"]>;

// P11-42 (round 2, Theme B readers r1, r2, r3; ruling §1h.139 (b)): the explain route finds a passage that stands in a figure's caption or a section's heading, as it
// finds a paragraph's. The server's half is here: the locator (`locatePassage` with `blocks`), the context the prompts give the model, and the server memory's key.
// A caption and a heading are the blocks of a section beyond its paragraphs, numbered as the page numbers them (`lib/notes/anchor-blocks.ts`): the paragraphs, then the
// heading, then the captions in the order the section's figures stand in. Every text below is invented.

const RAFT_DEF = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const RAFT_USE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const RAFT_SECOND = "Tungsten additions slowed the rafting ratio by about a third in every test.";
const NAMES_FIGURE = "Figure 2 plots the ratio against time for each alloy, with the tungsten alloy lowest throughout.";
const SHARED = "A shared sentence appears in both sections for the hint tests to separate.";
const OPENING = "Specimens were machined from a single casting and heat treated together.";

const CAPTION = "Rafting ratio against creep time for three alloys. The tungsten alloy rafts the slowest.";
const BLADE = "A turbine blade after one thousand hours at load.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 4,
  // The order is the extractor's: Figure 2 is named by the Results (so it stands there, after the paragraph that names it); the table is never placed; Figure 1 is
  // named by nobody and stands at the end of the section where it sat in the document (the Introduction).
  figureCaptions: [
    { ordinal: 1, label: "Figure 2", caption: CAPTION, page: 3, at: 0.8 },
    { ordinal: 2, label: "Table 1", caption: "Alloy compositions in weight percent for every specimen.", page: 2, at: 0.4 },
    { ordinal: 3, label: "Figure 1", caption: BLADE, page: 1, at: 0.1 },
  ],
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
        SHARED,
      ].join("\n\n"),
    },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: [OPENING, RAFT_DEF, SHARED, "Each creep test ran at constant load until the specimen failed."].join("\n\n") },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: [RAFT_USE, NAMES_FIGURE, RAFT_SECOND].join("\n\n") },
  ],
};

const BLOCKS = { blocks: true } as const;

describe("locatePassage with blocks — a caption's words (P11-42 rule 1)", () => {
  // The Results are body section 2 (the abstract is not rendered) with three paragraphs, so its heading is block 3 and its one caption block 4.
  const results = { sectionId: "s3", paragraphIndex: 4 };

  it("finds the caption the selection is in, with the figure's place as the page numbers it and the paragraphs it stands between", () => {
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", results, BLOCKS)).toEqual({
      sectionId: "s3",
      sectionIndex: 2,
      paragraphIndex: 4,
      paragraph: CAPTION,
      before: NAMES_FIGURE,
      after: RAFT_SECOND,
      block: "caption",
      heading: "3 Results",
      label: "Figure 2",
    });
  });

  it("reads the caption as the page draws it: the label, a middle dot and the words — and the page of the PDF where the picture is not drawn", () => {
    for (const passage of ["Figure 2 · Rafting ratio against creep time", "Figure 2", "rafts the slowest. · p.3 of the PDF", "Figure 2 · " + CAPTION + " · p.3 of the PDF"]) {
      expect(locatePassage(doc, passage, results, BLOCKS), passage).toMatchObject({ block: "caption", sectionId: "s3", paragraphIndex: 4, paragraph: CAPTION });
    }
  });

  it("tries the hinted caption before the paragraphs, so \"Figure 2\" selected in the caption is the caption's, not the paragraph that names it", () => {
    expect(locatePassage(doc, "Figure 2", results, BLOCKS)).toMatchObject({ block: "caption", paragraphIndex: 4 });
    // With no hint, or a hint at a paragraph, the paragraph that holds the words is found first, as it always was.
    expect(locatePassage(doc, "Figure 2", {}, BLOCKS)).toMatchObject({ sectionId: "s3", paragraphIndex: 1, paragraph: NAMES_FIGURE });
    expect(locatePassage(doc, "Figure 2", { sectionId: "s3", paragraphIndex: 1 }, BLOCKS)).toMatchObject({ paragraphIndex: 1, paragraph: NAMES_FIGURE });
  });

  it("finds a figure no paragraph names where it stands: at the end of the section where it sat in the document", () => {
    // Figure 1 stands in the Introduction (body section 0, three paragraphs): block 4 is its caption.
    expect(locatePassage(doc, "turbine blade after one thousand hours", { sectionId: "s1", paragraphIndex: 4 }, BLOCKS)).toMatchObject({
      block: "caption",
      sectionId: "s1",
      sectionIndex: 0,
      paragraphIndex: 4,
      paragraph: BLADE,
      label: "Figure 1",
      before: SHARED,
      after: null,
    });
  });

  it("finds it wherever the hint points when the hint is wrong or absent: the hinted section's blocks, then the whole body", () => {
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", { sectionId: "s2", paragraphIndex: 4 }, BLOCKS)).toMatchObject({ block: "caption", sectionId: "s3", paragraphIndex: 4 });
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", { sectionId: "nope", paragraphIndex: 99 }, BLOCKS)).toMatchObject({ block: "caption", sectionId: "s3" });
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", {}, BLOCKS)).toMatchObject({ block: "caption", sectionId: "s3" });
    // A hint that is not a whole number names no block.
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", { sectionId: "s3", paragraphIndex: 4.5 }, BLOCKS)).toMatchObject({ block: "caption", sectionId: "s3" });
  });

  it("a table's caption is not the page's (tables are not placed), and words that stand nowhere are not found: null, as today", () => {
    expect(locatePassage(doc, "Alloy compositions in weight percent", results, BLOCKS)).toBeNull();
    expect(locatePassage(doc, "the cooling rate of the quench bath", results, BLOCKS)).toBeNull();
    expect(locatePassage(doc, "   ", results, BLOCKS)).toBeNull();
  });
});

describe("locatePassage with blocks — a heading's words (P11-42 rule 1)", () => {
  // The Methods are body section 1 with four paragraphs: its heading is block 4.
  const methods = { sectionId: "s2", paragraphIndex: 4 };

  it("finds the heading, with how its section opens as the context after it", () => {
    expect(locatePassage(doc, "2 Methods", methods, BLOCKS)).toEqual({
      sectionId: "s2",
      sectionIndex: 1,
      paragraphIndex: 4,
      paragraph: "2 Methods",
      before: null,
      after: OPENING,
      block: "heading",
      heading: "2 Methods",
    });
  });

  it("finds part of a heading, and a heading with no hint at all or a hint at another section", () => {
    expect(locatePassage(doc, "Methods", methods, BLOCKS)).toMatchObject({ block: "heading", sectionId: "s2" });
    expect(locatePassage(doc, "3 Results", {}, BLOCKS)).toMatchObject({ block: "heading", sectionId: "s3", sectionIndex: 2, paragraphIndex: 3 });
    expect(locatePassage(doc, "3 Results", { sectionId: "s1", paragraphIndex: 3 }, BLOCKS)).toMatchObject({ block: "heading", sectionId: "s3" });
  });

  it("the abstract's heading is not the body's: it is not found", () => {
    expect(locatePassage(doc, "Abstract", { sectionId: "s0", paragraphIndex: 0 }, BLOCKS)).toBeNull();
  });
});

describe("locatePassage — without blocks it is what it was (the plain route's reading)", () => {
  it("does not find a caption's or a heading's words", () => {
    expect(locatePassage(doc, "The tungsten alloy rafts the slowest", { sectionId: "s3", paragraphIndex: 4 })).toBeNull();
    expect(locatePassage(doc, "2 Methods", { sectionId: "s2", paragraphIndex: 4 })).toBeNull();
    expect(locatePassage(doc, "Figure 2 · Rafting ratio against creep time")).toBeNull();
  });
});

describe("locatePassage with blocks — a paragraph's passage is found exactly as before (P11-42 rule 3)", () => {
  const cases: Array<[string, { sectionId?: string; paragraphIndex?: number }]> = [
    ["rafting ratio as the fraction of the gauge length", {}],
    ["rafting ratio as the fraction of the gauge length", { sectionId: "s2", paragraphIndex: 1 }],
    ["shared sentence appears", { sectionId: "s2", paragraphIndex: 2 }],
    ["shared sentence appears", {}],
    ["Each creep test ran at constant load", { sectionId: "s2", paragraphIndex: 0 }],
    ["rose from 0.2 to 0.7", { sectionId: "s1", paragraphIndex: 0 }],
    ["Figure 2 plots the ratio against time", { sectionId: "s3", paragraphIndex: 1 }],
    ["Figure 2 plots the ratio", {}],
    ["Tungsten additions slowed the raft- ing ratio", {}],
    ["the cooling rate of the quench bath", {}],
  ];

  it("returns the same result with blocks on as with them off, and none of it names a block", () => {
    for (const [passage, hint] of cases) {
      const without = locatePassage(doc, passage, hint);
      const withBlocks = locatePassage(doc, passage, hint, BLOCKS);
      expect(withBlocks, passage).toEqual(without);
      if (withBlocks) expect(Object.keys(withBlocks).sort(), passage).toEqual(["after", "before", "paragraph", "paragraphIndex", "sectionId", "sectionIndex"]);
    }
  });
});

// ── The context the model is given ─────────────────────────────────────────────────────────────────────────────────────────────

const base = { paper: { title: "Rafting under creep in a nickel alloy", abstract: "An abstract." }, map: [{ heading: "1 Introduction", opening: null }] };
const caption = locatePassage(doc, "The tungsten alloy rafts the slowest", { sectionId: "s3", paragraphIndex: 4 }, BLOCKS) as LocatedPassage;
const heading = locatePassage(doc, "2 Methods", { sectionId: "s2", paragraphIndex: 4 }, BLOCKS) as LocatedPassage;
const paragraph = locatePassage(doc, "rafting ratio as the fraction", { sectionId: "s2", paragraphIndex: 1 }, BLOCKS) as LocatedPassage;

const contextOf = (userPrompt: string) => (JSON.parse(userPrompt) as { context: Record<string, unknown> }).context;
const rulesOf = (userPrompt: string) => (JSON.parse(userPrompt) as { rules: string[] }).rules;

describe("the prompts — that block and its section, as a paragraph's is (P11-42 rule 1)", () => {
  it("a caption's context says it is a caption, names the figure and its section, and holds the paragraphs it stands between", () => {
    const { userPrompt } = buildExplainPrompt({ ...base, passage: "The tungsten alloy rafts the slowest", located: caption });

    expect(contextOf(userPrompt)).toEqual({ block: "caption", figure: "Figure 2", section: "3 Results", before: NAMES_FIGURE, paragraph: CAPTION, after: RAFT_SECOND });
    expect(rulesOf(userPrompt).filter((rule) => rule.includes("figure's caption"))).toHaveLength(1);
  });

  it("a heading's context says it is a heading and holds how its section opens", () => {
    const { userPrompt } = buildExplainPrompt({ ...base, passage: "2 Methods", located: heading });

    expect(contextOf(userPrompt)).toEqual({ block: "heading", paragraph: "2 Methods", after: OPENING });
    expect(rulesOf(userPrompt).filter((rule) => rule.includes("heading of a section"))).toHaveLength(1);
  });

  it("a reply's prompt carries the same context and the same one rule", () => {
    const thread = [
      { role: "peer" as const, text: "It is a heading." },
      { role: "reader" as const, text: "What does it cover?" },
    ];
    for (const [located, key, rule] of [
      [caption, "caption", "figure's caption"],
      [heading, "heading", "heading of a section"],
    ] as const) {
      const { userPrompt } = buildExplainReplyPrompt({ ...base, passage: "x", located, thread });
      expect(contextOf(userPrompt).block, key).toBe(key);
      expect(rulesOf(userPrompt).filter((text) => text.includes(rule)), key).toHaveLength(1);
    }
  });

  it("a paragraph's prompt has none of it: the context is the three paragraphs, and there is no rule about a block", () => {
    const first = buildExplainPrompt({ ...base, passage: "rafting ratio as the fraction", located: paragraph });
    const reply = buildExplainReplyPrompt({ ...base, passage: "x", located: paragraph, thread: [{ role: "reader", text: "Why?" }] });

    for (const { userPrompt } of [first, reply]) {
      expect(Object.keys(contextOf(userPrompt))).toEqual(["before", "paragraph", "after"]);
      expect(rulesOf(userPrompt).some((rule) => rule.includes("caption") || rule.includes("heading of a section"))).toBe(false);
    }
  });
});

describe("the server's memory — a heading's or a caption's words are not a paragraph's (P11-42)", () => {
  const sha = (text: string) => createHash("sha256").update(text).digest("hex");

  it("a paragraph's key is what it was: nothing is added to it", () => {
    const wanted = sha(`h|rafting ratio|${sha(JSON.stringify([]))}`);
    expect(explainCacheKey("h", "Rafting  ratio", [])).toBe(wanted);
    expect(explainCacheKey("h", "Rafting  ratio", [], false, false, undefined, undefined)).toBe(wanted);
  });

  it("the same words in a heading, in a caption and in a paragraph are three entries", () => {
    const keys = [undefined, "heading", "caption"].map((block) => explainCacheKey("h", "rafting ratio", [], false, false, undefined, block as Block | undefined));
    expect(new Set(keys).size).toBe(3);
  });
});
