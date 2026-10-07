import { describe, expect, it } from "vitest";
import { withSectionIds, type DraftSection, type ExtractedDocument } from "./html-text";
import { buildReadingMap, openingOf, readableSections } from "./reading-map";
import {
  GUIDE_CAPS,
  buildParagraphGuidePrompt,
  createParagraphGuideCache,
  gistCandidates,
  gistMaxTokens,
  groundedGist,
  sanitizeParagraphGuide,
  tooManyParagraphs,
  verifyParagraphGuide,
  type GistCandidate,
  type ParagraphGuide,
} from "./paragraph-guide";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import arxivPdfDocJson from "./__fixtures__/arxiv-2609.02113.doc.json";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";

// P3-03 (ruling §1h.6; §1a.8; §3d 5, Tier 2 half): one gist of at most twelve
// words per paragraph, condensed from the paragraph's own opening — and kept
// only when it is grounded in the paragraph. Pure module: no model, no I/O.
// Every text below is invented.

function make(sections: Array<Partial<DraftSection> & { text: string }>): ExtractedDocument {
  return {
    source: "pdf",
    figureCaptions: [],
    sections: withSectionIds(
      sections.map((s, i) => ({ heading: s.heading ?? `Section ${i}`, canonical: s.canonical ?? "body", ...s })),
    ),
  };
}

const INTRO_A = "Hot turbine blades creep slowly under steady load. Over thousands of hours the blade lengthens until a clearance is lost.";
const INTRO_B = "Cast alloys with fewer grain boundaries resist creep better. Single crystal blades remove the boundaries altogether.";
// Every sentence is a field opener, so the map has no opening for it.
const NO_OPENING = "Creep has long been a concern in the field. Cast alloys remain one of the oldest topics.";
const METHODS_A = "Twelve specimens were machined from one casting and heat treated together. Each was loaded to the same stress.";

const doc = make([
  { heading: "Abstract", canonical: "abstract", text: "An abstract about creep that the body does not render." },
  { heading: "1 Introduction", canonical: "introduction", text: `${INTRO_A}\n\n${INTRO_B}\n\n${NO_OPENING}` },
  { heading: "2 Methods", canonical: "methods", text: METHODS_A },
]);

describe("gistCandidates — the paragraphs the pass is asked about", () => {
  it("lists, in reading order, every rendered paragraph that has an opening, with its place and its words", () => {
    const candidates = gistCandidates(doc);

    expect(candidates.map((c) => [c.sectionId, c.sectionIndex, c.paragraphIndex])).toEqual([
      ["s1", 0, 0],
      ["s1", 0, 1],
      ["s2", 1, 0],
    ]);
    expect(candidates[0].paragraph).toBe(INTRO_A);
    expect(candidates[2].paragraph).toBe(METHODS_A);
  });

  it("carries each paragraph's opening exactly as the map holds it", () => {
    for (const candidate of gistCandidates(doc)) {
      expect(candidate.opening).toBe(openingOf(candidate.paragraph));
      expect(candidate.paragraph.includes(candidate.opening)).toBe(true);
    }
  });

  it("leaves out a paragraph with no opening, and the abstract, which the body does not render", () => {
    const candidates = gistCandidates(doc);

    expect(openingOf(NO_OPENING)).toBeNull();
    expect(candidates.some((c) => c.paragraph === NO_OPENING)).toBe(false);
    expect(candidates.some((c) => c.sectionId === "s0")).toBe(false);
  });

  it("clips a long paragraph to 1,200 characters at a word, never mid-word", () => {
    const long = `${INTRO_A} ${"The creep rate depends on temperature and stress together. ".repeat(60)}`;
    const [candidate] = gistCandidates(make([{ canonical: "introduction", text: long }]));

    expect(candidate.paragraph.length).toBeLessThanOrEqual(GUIDE_CAPS.paragraphChars);
    expect(candidate.paragraph.length).toBeGreaterThan(GUIDE_CAPS.paragraphChars - 40);
    expect(long.startsWith(candidate.paragraph)).toBe(true);
    expect(candidate.paragraph.endsWith(" ")).toBe(false);
    // The cut falls on a space of the paragraph: no word is split.
    expect(long[candidate.paragraph.length]).toBe(" ");
    // The opening is still the paper's own words from the start of the paragraph.
    expect(candidate.paragraph.startsWith(candidate.opening)).toBe(true);
  });

  it("agrees with the map: one candidate for every paragraph of the map that has an opening", () => {
    for (const json of [arxivHtmlDocJson, arxivPdfDocJson, zenodoDocJson]) {
      const fixture = { ...(json as unknown as ExtractedDocument), sections: withSectionIds((json as unknown as { sections: DraftSection[] }).sections) };
      const map = buildReadingMap(fixture);
      const expected = map.sections.flatMap((section) =>
        section.paragraphs.filter((p) => p.opening !== null).map((p) => `${section.id}:${p.index}`),
      );

      expect(gistCandidates(fixture).map((c) => `${c.sectionId}:${c.paragraphIndex}`)).toEqual(expected);
    }
  });

  it("names the section by the id the body gives it when the document predates ids", () => {
    const old: ExtractedDocument = { source: "pdf", figureCaptions: [], sections: [{ heading: "Abstract", canonical: "abstract", text: "x" }, { heading: "1 Intro", canonical: "introduction", text: INTRO_A }] } as unknown as ExtractedDocument;

    expect(gistCandidates(old).map((c) => c.sectionId)).toEqual(readableSections(old).map((s) => s.id));
    expect(gistCandidates(old)[0].sectionId).toBe("s1");
  });
});

describe("the three committed fixtures", () => {
  it.each([
    ["arxiv-2609.02697", arxivHtmlDocJson],
    ["arxiv-2609.02113", arxivPdfDocJson],
    ["zenodo-W7208807247", zenodoDocJson],
  ])("%s yields candidates and is not too long for the pass", (_name, json) => {
    const fixture = { ...(json as unknown as ExtractedDocument), sections: withSectionIds((json as unknown as { sections: DraftSection[] }).sections) };

    expect(gistCandidates(fixture).length).toBeGreaterThan(0);
    expect(tooManyParagraphs(fixture)).toBe(false);
  });
});

describe("tooManyParagraphs — the pass is skipped past 120", () => {
  const paragraph = (i: number) => `Specimen batch number ${i} was held at one temperature for a long time under load.`;
  const withParagraphs = (n: number) => make([{ canonical: "methods", text: Array.from({ length: n }, (_, i) => paragraph(i)).join("\n\n") }]);

  it("is false at 120 paragraphs and true at 121", () => {
    expect(GUIDE_CAPS.maxParagraphs).toBe(120);
    expect(gistCandidates(withParagraphs(120))).toHaveLength(120);
    expect(tooManyParagraphs(withParagraphs(120))).toBe(false);
    expect(tooManyParagraphs(withParagraphs(121))).toBe(true);
  });

  it("counts only the paragraphs that would be asked about", () => {
    const text = [...Array.from({ length: 120 }, (_, i) => paragraph(i)), NO_OPENING, NO_OPENING].join("\n\n");

    expect(tooManyParagraphs(make([{ canonical: "methods", text }]))).toBe(false);
  });
});

describe("buildParagraphGuidePrompt", () => {
  const candidates = gistCandidates(doc);
  const { systemPrompt, userPrompt } = buildParagraphGuidePrompt({ paper: { title: "Creep in a cast alloy" }, candidates });
  const parsed = JSON.parse(userPrompt) as {
    paper: { title: string };
    paragraphs: Array<{ sectionId: string; paragraphIndex: number; topicSentence: string; text: string }>;
    outputSchema: unknown;
    rules: string[];
  };

  it("carries the paper's title and every candidate in document order, its opening named as the topic sentence", () => {
    expect(parsed.paper.title).toBe("Creep in a cast alloy");
    expect(parsed.paragraphs.map((p) => [p.sectionId, p.paragraphIndex])).toEqual(candidates.map((c) => [c.sectionId, c.paragraphIndex]));
    parsed.paragraphs.forEach((p, i) => {
      expect(p.topicSentence).toBe(candidates[i].opening);
      expect(p.text).toBe(candidates[i].paragraph);
    });
  });

  it("asks for one gist of at most twelve words per paragraph, condensed from the topic sentence, with the schema", () => {
    const rules = parsed.rules.join(" ");

    expect(rules).toMatch(/12 words/);
    expect(rules).toMatch(/topic sentence/i);
    expect(rules).toMatch(/no new fact/i);
    expect(rules).toMatch(/number/i);
    expect(JSON.stringify(parsed.outputSchema)).toContain("sectionId");
    expect(JSON.stringify(parsed.outputSchema)).toContain("paragraphIndex");
    expect(JSON.stringify(parsed.outputSchema)).toContain("gists");
    expect(systemPrompt).toMatch(/Peer/);
    expect(systemPrompt).toMatch(/JSON/);
  });

  it("is a function of the paper's title and its paragraphs and nothing else: no reader appears in it", () => {
    // The builder's only parameters are the title and the candidates; a call with
    // extra properties smuggled in still serialises none of them.
    const smuggled = buildParagraphGuidePrompt({
      paper: { title: "Creep in a cast alloy", abstract: "ABSTRACT-SENTINEL" } as { title: string },
      candidates,
      profile: { project: "PROFILE-SENTINEL" },
      questions: ["QUESTION-SENTINEL?"],
    } as Parameters<typeof buildParagraphGuidePrompt>[0]);

    expect(smuggled.userPrompt).toBe(userPrompt);
    expect(smuggled.systemPrompt).toBe(systemPrompt);
    for (const sentinel of ["ABSTRACT-SENTINEL", "PROFILE-SENTINEL", "QUESTION-SENTINEL"]) {
      expect(`${smuggled.systemPrompt}${smuggled.userPrompt}`).not.toContain(sentinel);
    }
  });

  it("is bounded: at most 120 paragraphs of at most 1,200 characters, and the schema and rules are never what is cut", () => {
    const many: GistCandidate[] = Array.from({ length: 200 }, (_, i) => ({
      sectionId: "s1",
      sectionIndex: 0,
      paragraphIndex: i,
      opening: "A topic sentence long enough to be an opening.",
      paragraph: `A topic sentence long enough to be an opening. ${"More words follow it here. ".repeat(80)}`,
    }));
    const { userPrompt: big } = buildParagraphGuidePrompt({ paper: { title: "T".repeat(2000) }, candidates: many });
    const bigParsed = JSON.parse(big) as { paper: { title: string }; paragraphs: Array<{ text: string }>; outputSchema: unknown; rules: string[] };

    expect(bigParsed.paragraphs).toHaveLength(120);
    expect(Math.max(...bigParsed.paragraphs.map((p) => p.text.length))).toBeLessThanOrEqual(1200);
    expect(bigParsed.paper.title.length).toBeLessThanOrEqual(300);
    expect(bigParsed.rules.length).toBeGreaterThan(3);
    expect(big.length).toBeLessThan(120 * 1500 + 5000);
  });
});

describe("gistMaxTokens — room for every gist the pass asks for", () => {
  it("grows with the number of paragraphs, within a floor and a ceiling", () => {
    expect(gistMaxTokens(1)).toBeGreaterThanOrEqual(600);
    expect(gistMaxTokens(120)).toBeGreaterThan(gistMaxTokens(30));
    // A gist entry is about forty tokens; 120 of them must fit.
    expect(gistMaxTokens(120)).toBeGreaterThanOrEqual(120 * 40);
    expect(gistMaxTokens(500)).toBeLessThanOrEqual(8000);
  });
});

describe("sanitizeParagraphGuide", () => {
  const candidates = gistCandidates(doc);
  const entry = (sectionId: string, paragraphIndex: number | string, gist: unknown) => ({ sectionId, paragraphIndex, gist });

  it("keeps entries that name a candidate, keyed by section id and paragraph index", () => {
    const out = sanitizeParagraphGuide(
      { gists: [entry("s1", 0, "Blades creep and lengthen under load."), entry("s2", 0, "Twelve specimens loaded to one stress.")] },
      candidates,
    );

    expect(out).toEqual({ s1: { 0: "Blades creep and lengthen under load." }, s2: { 0: "Twelve specimens loaded to one stress." } });
  });

  it("drops an entry for a paragraph that is not a candidate: an unknown section, a paragraph with no opening, a stray index", () => {
    const out = sanitizeParagraphGuide(
      { gists: [entry("s9", 0, "Nothing here."), entry("s1", 2, "Field opener."), entry("s1", 7, "Stray index."), entry("s0", 0, "Abstract words."), entry("s1", 1.5, "Half."), entry("s1", -1, "Negative.")] },
      candidates,
    );

    expect(out).toEqual({});
  });

  it("accepts the index as a digit string, and nothing looser", () => {
    expect(sanitizeParagraphGuide({ gists: [entry("s1", "1", "Fewer boundaries resist creep better.")] }, candidates)).toEqual({
      s1: { 1: "Fewer boundaries resist creep better." },
    });
    expect(sanitizeParagraphGuide({ gists: [entry("s1", "1st", "Words."), entry("s1", " 1", "Words."), entry("s1", "", "Words.")] }, candidates)).toEqual({});
  });

  it("collapses the whitespace of each gist", () => {
    const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, "  Blades   creep\n and\tlengthen  ")] }, candidates);

    expect(out.s1[0]).toBe("Blades creep and lengthen");
  });

  it("keeps a gist of exactly twelve words and drops one of thirteen — dropped, never cut", () => {
    const twelve = "one two three four five six seven eight nine ten eleven twelve";
    const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, twelve), entry("s1", 1, `${twelve} thirteen`)] }, candidates);

    expect(GUIDE_CAPS.gistWords).toBe(12);
    expect(out).toEqual({ s1: { 0: twelve } });
  });

  it("drops a gist over 120 characters even when it is twelve words or fewer", () => {
    const wide = Array.from({ length: 6 }, () => "extraordinarily").join(" "); // 6 words, 95 chars
    const wider = Array.from({ length: 9 }, () => "extraordinarily").join(" "); // 9 words, 143 chars

    expect(sanitizeParagraphGuide({ gists: [entry("s1", 0, wide)] }, candidates)).toEqual({ s1: { 0: wide } });
    expect(sanitizeParagraphGuide({ gists: [entry("s1", 0, wider)] }, candidates)).toEqual({});
  });

  it("drops a gist that is empty, not text, or missing", () => {
    const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, ""), entry("s1", 1, 5), entry("s2", 0, "   "), { sectionId: "s2", paragraphIndex: 0 }] }, candidates);

    expect(out).toEqual({});
  });

  it("keeps the first gist for a paragraph when the model sends two", () => {
    const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, "First gist of the blade."), entry("s1", 0, "Second gist of the blade.")] }, candidates);

    expect(out.s1[0]).toBe("First gist of the blade.");
  });

  // P3-05 (§1h.8 (4), O10): "the first gist for a paragraph wins" was the first CLEAN
  // one, and the verifier then dropped it when it was not grounded — so a grounded
  // second gist for the same paragraph was lost. The first GROUNDED one wins.
  describe("a paragraph named twice: the first grounded gist wins (P3-05, O10)", () => {
    const UNGROUNDED = "Stocks fell after the earnings call.";
    const GROUNDED = "Blades lengthen under steady load.";
    const ALSO_GROUNDED = "Hot turbine blades creep slowly.";

    it("keeps the second when the first is not grounded in the paragraph and the second is", () => {
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, UNGROUNDED), entry("s1", 0, GROUNDED)] }, candidates);

      expect(out).toEqual({ s1: { 0: GROUNDED } });
      expect(verifyParagraphGuide(out, candidates)).toEqual({ s1: { 0: GROUNDED } });
    });

    it("keeps the first when both are grounded", () => {
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, GROUNDED), entry("s1", 0, ALSO_GROUNDED)] }, candidates);

      expect(out).toEqual({ s1: { 0: GROUNDED } });
    });

    it("never lets a later gist displace a grounded first one, grounded or not", () => {
      expect(sanitizeParagraphGuide({ gists: [entry("s1", 0, GROUNDED), entry("s1", 0, UNGROUNDED)] }, candidates)).toEqual({ s1: { 0: GROUNDED } });
      expect(sanitizeParagraphGuide({ gists: [entry("s1", 0, ALSO_GROUNDED), entry("s1", 0, UNGROUNDED), entry("s1", 0, GROUNDED)] }, candidates)).toEqual({ s1: { 0: ALSO_GROUNDED } });
    });

    it("takes the first grounded one past any number of ungrounded ones before it", () => {
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, UNGROUNDED), entry("s1", 0, "Pizza prices rose again."), entry("s1", 0, GROUNDED)] }, candidates);

      expect(out).toEqual({ s1: { 0: GROUNDED } });
    });

    it("grounds each in its own paragraph: a gist for the methods paragraph does not rescue one for the introduction's", () => {
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, UNGROUNDED), entry("s1", 0, "Twelve specimens were machined from one casting.")] }, candidates);

      expect(verifyParagraphGuide(out, candidates)).toEqual({});
    });

    it("leaves a paragraph named twice with nothing grounded to the verifier, which drops it", () => {
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, UNGROUNDED), entry("s1", 0, "Pizza prices rose again.")] }, candidates);

      expect(out).toEqual({ s1: { 0: UNGROUNDED } });
      expect(verifyParagraphGuide(out, candidates)).toEqual({});
    });

    it("applies the other limits before it: an over-long grounded gist is no candidate to win", () => {
      const thirteen = "blades creep under steady load while the hot turbine slowly lengthens during use";
      const out = sanitizeParagraphGuide({ gists: [entry("s1", 0, UNGROUNDED), entry("s1", 0, thirteen)] }, candidates);

      expect(thirteen.split(" ")).toHaveLength(13);
      expect(out).toEqual({ s1: { 0: UNGROUNDED } });
    });
  });

  it("takes anything that is not the schema for no guide at all", () => {
    for (const raw of [null, undefined, "text", 5, [], {}, { gists: "x" }, { gists: {} }, { gists: [null, 3, "x", []] }]) {
      expect(sanitizeParagraphGuide(raw, candidates)).toEqual({});
    }
  });
});

describe("groundedGist — two content words shared with the paragraph", () => {
  it("is true when the gist and the paragraph share two content words", () => {
    expect(groundedGist("Blades lengthen under steady load.", INTRO_A)).toBe(true);
  });

  it("is false with one shared content word, and false with none", () => {
    expect(groundedGist("Blades are cheap to make.", INTRO_A)).toBe(false);
    expect(groundedGist("Stocks fell after the earnings call.", INTRO_A)).toBe(false);
  });

  it("does not count a word the gist repeats as two", () => {
    expect(groundedGist("Blades, blades, blades everywhere.", INTRO_A)).toBe(false);
  });

  it("does not count words under four letters", () => {
    // "hot", "the", "and", "was" appear in the paragraph and are not content words.
    expect(groundedGist("Hot and the one was set.", INTRO_A)).toBe(false);
  });

  it("does not count stopwords, however long they are", () => {
    // "which", "under", "until", "over", "their", "these" are function words.
    expect(groundedGist("These blades which lengthen.", "These which their until thousands blades.")).toBe(false);
    expect(groundedGist("Which these their until", "Which these their until all of them appear here")).toBe(false);
  });

  it("compares the words as the verifier does: case, punctuation and a hyphenated line break do not matter", () => {
    expect(groundedGist("BLADES, STEADY LOAD.", INTRO_A)).toBe(true);
    expect(groundedGist("Blades lengthen", "Hot turbine blades creep slowly; they length-\nen under load.")).toBe(true);
  });

  it("reads a hyphenated compound as the words it is made of, as well as the one word", () => {
    // "turbine-\nblades" folds to one token for the verifier; the gist's two words are in it all the same.
    expect(groundedGist("Turbine blades creep", "Hot turbine-\nblades creep slowly.")).toBe(true);
    expect(groundedGist("Grain boundary sliding", "Sliding at the grain-boundary dominates.")).toBe(true);
    expect(groundedGist("Grain growth stalls", "Sliding at the grain-boundary dominates.")).toBe(false);
  });

  it("is a statement about words, so an empty gist or paragraph is never grounded", () => {
    expect(groundedGist("", INTRO_A)).toBe(false);
    expect(groundedGist("Blades lengthen", "")).toBe(false);
  });
});

describe("verifyParagraphGuide — a gist that is not grounded is dropped", () => {
  const candidates = gistCandidates(doc);

  it("keeps the grounded gists and drops the rest, and a section left with none disappears", () => {
    const verified = verifyParagraphGuide(
      {
        s1: { 0: "Blades lengthen under steady load.", 1: "Stocks fell after the earnings call." },
        s2: { 0: "Cheap pizza near the harbour." },
      },
      candidates,
    );

    expect(verified).toEqual({ s1: { 0: "Blades lengthen under steady load." } });
  });

  it("grounds each gist in its own paragraph, not in another one of the document", () => {
    // These words are the methods paragraph's; the entry claims the introduction's.
    const verified = verifyParagraphGuide({ s1: { 0: "Twelve specimens were machined from one casting." } }, candidates);

    expect(verified).toEqual({});
  });

  it("drops an entry that names no candidate", () => {
    expect(verifyParagraphGuide({ s9: { 0: "Blades lengthen under steady load." } }, candidates)).toEqual({});
  });
});

describe("the sanitise-then-verify chain on a model's answer", () => {
  it("keeps the grounded second gist for a paragraph the model named twice, the first being ungrounded (P3-05, O10)", () => {
    const candidates = gistCandidates(doc);
    const raw = {
      gists: [
        { sectionId: "s1", paragraphIndex: 0, gist: "Stocks fell after the earnings call." },
        { sectionId: "s1", paragraphIndex: 0, gist: "Blades slowly lengthen under steady load." },
        { sectionId: "s2", paragraphIndex: 0, gist: "Twelve specimens loaded to one stress." },
        { sectionId: "s2", paragraphIndex: 0, gist: "Cheap pizza near the harbour." },
      ],
    };

    expect(verifyParagraphGuide(sanitizeParagraphGuide(raw, candidates), candidates)).toEqual({
      s1: { 0: "Blades slowly lengthen under steady load." },
      s2: { 0: "Twelve specimens loaded to one stress." },
    });
  });

  it("ends with only grounded gists of twelve words or fewer", () => {
    const candidates = gistCandidates(doc);
    const raw = {
      gists: [
        { sectionId: "s1", paragraphIndex: 0, gist: "Blades slowly lengthen under steady load." },
        { sectionId: "s1", paragraphIndex: 1, gist: "Stocks fell after the earnings call." },
        { sectionId: "s2", paragraphIndex: 0, gist: "Specimens from one casting, heat treated together, each loaded to equal stress then measured carefully." },
      ],
    };
    const kept = verifyParagraphGuide(sanitizeParagraphGuide(raw, candidates), candidates);

    expect(kept).toEqual({ s1: { 0: "Blades slowly lengthen under steady load." } });
  });
});

describe("the memory of guides", () => {
  const guide = (hash: string): ParagraphGuide => ({ docHash: hash, gists: { s1: { 0: "Blades lengthen under load." } } });

  it("holds a guide by the document's hash and gives it back", () => {
    const cache = createParagraphGuideCache();
    cache.set("hash-a", guide("hash-a"));

    expect(cache.get("hash-a")).toEqual(guide("hash-a"));
    expect(cache.get("hash-b")).toBeUndefined();
  });

  it("keeps at most 32 documents, the oldest forgotten first", () => {
    const cache = createParagraphGuideCache();
    expect(GUIDE_CAPS.cacheEntries).toBe(32);
    for (let i = 0; i < 33; i++) cache.set(`h${i}`, guide(`h${i}`));

    expect(cache.size()).toBe(32);
    expect(cache.get("h0")).toBeUndefined();
    expect(cache.get("h32")).toBeDefined();
  });

  it("forgets a guide after an hour", () => {
    let now = 1_000_000;
    const cache = createParagraphGuideCache({ now: () => now });
    cache.set("h", guide("h"));

    now += 59 * 60 * 1000;
    expect(cache.get("h")).toBeDefined();
    now += 2 * 60 * 1000;
    expect(cache.get("h")).toBeUndefined();
    expect(GUIDE_CAPS.cacheTtlMs).toBe(60 * 60 * 1000);
  });
});
