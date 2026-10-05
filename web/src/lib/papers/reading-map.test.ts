import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { blockMarker } from "@/lib/text/math";
import { withSectionIds, type DraftSection, type ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import { buildReading } from "./reading";
import { buildReadingMap } from "./reading-map";
import arxivHtmlDocJson from "./__fixtures__/arxiv-2609.02697.doc.json";
import arxivPdfDocJson from "./__fixtures__/arxiv-2609.02113.doc.json";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";

// P1-01 (spec D9 first half, ruling §1f): the reading map — every section the
// body renders, in the body's order, with its role, page, words, minutes and
// one opening line per paragraph. Tier 0: a pure function of the extracted
// document, no model.
//
// The committed fixtures predate section ids (P0-01) and carry none, so they
// are passed through `withSectionIds` first — the same numbering every
// extractor applies — and ids are asserted against that.

const paper: Paper = {
  id: "openalex:W1",
  title: "A Paper",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};

function withIds(json: unknown): ExtractedDocument {
  const doc = json as Omit<ExtractedDocument, "sections"> & { sections: DraftSection[] };
  return { ...doc, sections: withSectionIds(doc.sections) };
}

function okFullText(doc: ExtractedDocument): FullTextResult {
  return { status: "ok", doc, sourceLink: { url: "https://example.org/paper", kind: "html", label: "doi", rank: 1 }, attempts: [] };
}

const FIXTURES: Array<[string, ExtractedDocument]> = [
  ["arxiv-2609.02697 (LaTeXML HTML)", withIds(arxivHtmlDocJson)],
  ["arxiv-2609.02113 (PDF)", withIds(arxivPdfDocJson)],
  ["zenodo-W7208807247 (PDF)", withIds(zenodoDocJson)],
];

const words = (text: string) => text.split(/\s+/).length;

describe("buildReadingMap — the committed fixtures", () => {
  it.each(FIXTURES)("%s: one row per body section, one line per body paragraph, the same indices", (_name, doc) => {
    const map = buildReadingMap(doc);
    const body = buildReading(paper, okFullText(doc)).body;

    expect(map.sections.map((s) => [s.heading, s.canonical])).toEqual(body.map((s) => [s.heading, s.canonical]));
    body.forEach((section, k) => {
      const row = map.sections[k];
      expect(row.paragraphs.map((p) => p.index)).toEqual(section.paragraphs.map((_, i) => i));
      expect(row.words).toBe(section.paragraphs.reduce((n, p) => n + words(p), 0));
      expect(row.minutes).toBe(row.words > 0 ? Math.ceil(row.words / 180) : 0);
    });
    const total = body.reduce((n, s) => n + s.paragraphs.reduce((m, p) => m + words(p), 0), 0);
    expect(map.totalMinutes).toBe(Math.ceil(total / 180));
  });

  it.each(FIXTURES)("%s: every opening is a verbatim piece of its paragraph, 40–160 characters, or null", (_name, doc) => {
    const map = buildReadingMap(doc);
    const body = buildReading(paper, okFullText(doc)).body;
    let openings = 0;

    map.sections.forEach((row, k) => {
      for (const line of row.paragraphs) {
        if (line.opening === null) continue;
        openings += 1;
        expect(body[k].paragraphs[line.index].includes(line.opening)).toBe(true);
        expect(line.opening.length).toBeLessThanOrEqual(160);
        expect(line.opening.length).toBeGreaterThanOrEqual(40);
        expect(line.opening).toBe(line.opening.trim());
      }
    });
    expect(openings).toBeGreaterThan(0);
  });

  it.each(FIXTURES)("%s: ids are the document's own, the abstract is no row, roles come from the bucket", (_name, doc) => {
    const map = buildReadingMap(doc);
    const kept = doc.sections.filter((s) => s.canonical !== "abstract");

    expect(map.sections.map((s) => s.id)).toEqual(kept.map((s) => s.id));
    expect(map.sections.some((s) => s.canonical === "abstract")).toBe(false);
    for (const row of map.sections) {
      expect(["setup", "method", "evidence", "interpretation", "apparatus", "body"]).toContain(row.role);
    }
  });

  it("names the LaTeXML fixture's buckets as the ruling maps them", () => {
    const map = buildReadingMap(FIXTURES[0][1]);
    const roleOf = Object.fromEntries(map.sections.map((s) => [s.canonical, s.role]));

    expect(roleOf).toEqual({
      introduction: "setup",
      related_work: "setup",
      body: "body",
      methods: "method",
      results: "evidence",
      limitations: "interpretation",
      conclusion: "interpretation",
    });
  });
});

/** A document built in the test: sections in order, with ids. */
function doc(sections: Array<Partial<DraftSection> & { text: string }>, extra: Partial<ExtractedDocument> = {}): ExtractedDocument {
  return {
    sections: withSectionIds(sections.map((s, i) => ({ heading: s.heading ?? `Section ${i}`, canonical: s.canonical ?? "body", ...s }))),
    figureCaptions: [],
    source: "pdf",
    ...extra,
  };
}

/** `n` words of filler, as one paragraph. */
const filler = (n: number) => Array.from({ length: n }, (_, i) => `word${i}`).join(" ");

describe("buildReadingMap — openings (§1f.4)", () => {
  it("skips a boilerplate first sentence and takes the next one", () => {
    const map = buildReadingMap(doc([{ canonical: "introduction", text:
      "Protein structure prediction has attracted enormous attention across many fields. " +
      "We show that a graph embedding recovers the fold from sequence alone in most cases." }]));

    expect(map.sections[0].paragraphs[0].opening).toBe(
      "We show that a graph embedding recovers the fold from sequence alone in most cases.",
    );
  });

  it("is null when no sentence is long enough and not boilerplate", () => {
    const map = buildReadingMap(doc([{ text: "Short one. Another short one. In recent years this field has grown faster than anyone expected it would." }]));

    expect(map.sections[0].paragraphs).toEqual([{ index: 0, opening: null }]);
  });

  it("cuts a sentence longer than 160 characters at the last space before 160, without adding anything", () => {
    const long =
      "The encoder maps every residue of the protein chain to a vector in a shared latent space, " +
      "and the decoder then reads the distances between those vectors back into a contact map of the fold.";
    const paragraph = `${long} A second sentence follows here to make sure only the first is taken.`;
    const map = buildReadingMap(doc([{ text: paragraph }]));
    const opening = map.sections[0].paragraphs[0].opening ?? "";

    expect(long.length).toBeGreaterThan(160);
    expect(opening.length).toBeLessThanOrEqual(160);
    expect(paragraph.includes(opening)).toBe(true);
    expect(paragraph.startsWith(opening)).toBe(true);
    // A whole-word cut: the paragraph continues with a space right after it.
    expect(paragraph[opening.length]).toBe(" ");
    expect(opening).toBe(opening.trim());
    expect(opening.endsWith("…")).toBe(false);
  });

  it("keeps the sentence's own punctuation, untouched", () => {
    const sentence = "We measured creep in twelve samples, each at three temperatures (450, 500 and 550 °C).";
    const map = buildReadingMap(doc([{ text: `${sentence} Then more.` }]));

    expect(map.sections[0].paragraphs[0].opening).toBe(sentence);
  });
});

describe("buildReadingMap — sections, roles, words and minutes (§1f.1–3)", () => {
  it("maps every bucket to its role, and an unplaced heading to body", () => {
    const buckets: Array<[string, string]> = [
      ["introduction", "setup"],
      ["related_work", "setup"],
      ["methods", "method"],
      ["results", "evidence"],
      ["discussion", "interpretation"],
      ["conclusion", "interpretation"],
      ["limitations", "interpretation"],
      ["references", "apparatus"],
      ["acknowledgments", "apparatus"],
      ["supplementary", "apparatus"],
      ["body", "body"],
    ];
    const map = buildReadingMap(doc(buckets.map(([canonical]) => ({ canonical, text: `Text of the ${canonical} section.` }))));

    expect(map.sections.map((s) => [s.canonical, s.role])).toEqual(buckets);
  });

  it("leaves the abstract out, and keeps each section's own id and page", () => {
    const map = buildReadingMap(doc([
      { heading: "Abstract", canonical: "abstract", text: "We study creep.", page: 1 },
      { heading: "1 Introduction", canonical: "introduction", text: "Creep limits the life of hot parts.", page: 1 },
      { heading: "2 Methods", canonical: "methods", text: "Samples were held at fixed stress.", page: 3 },
    ]));

    expect(map.sections.map((s) => [s.id, s.heading, s.page])).toEqual([
      ["s1", "1 Introduction", 1],
      ["s2", "2 Methods", 3],
    ]);
  });

  it("has no page for an HTML source", () => {
    const map = buildReadingMap(doc([{ text: "A section from a web page." }], { source: "ar5iv" }));

    expect("page" in map.sections[0]).toBe(false);
  });

  it("does not count an equation marker or a step number as a paragraph or as words", () => {
    const map = buildReadingMap(doc(
      [{ canonical: "methods", text: `We compute the attention as follows.\n\n${blockMarker(0)}\n\n1:\n\nwhere d is the key size.` }],
      { equations: [{ latex: "\\mathrm{softmax}(QK^T)V", number: "(1)" }] },
    ));

    expect(map.sections[0].paragraphs.map((p) => p.index)).toEqual([0, 1]);
    expect(map.sections[0].words).toBe(6 + 6);
  });

  it("keeps a section that holds only an equation, as the body does — no words, no minutes", () => {
    const map = buildReadingMap(doc(
      [{ heading: "A", text: "Words before it, enough to read." }, { heading: "B", text: blockMarker(0) }],
      { equations: [{ text: "L = a + b" }] },
    ));

    expect(map.sections.map((s) => [s.heading, s.paragraphs.length, s.words, s.minutes])).toEqual([
      ["A", 1, 6, 1],
      ["B", 0, 0, 0],
    ]);
  });

  it("drops a section with nothing to read, as the body does", () => {
    const map = buildReadingMap(doc([{ heading: "Empty", text: "   \n\n  " }, { heading: "Kept", text: "Something to read." }]));

    expect(map.sections.map((s) => s.heading)).toEqual(["Kept"]);
  });

  it("counts minutes at 180 words, rounded up, and the total from the total words", () => {
    const map = buildReadingMap(doc([
      { heading: "A", text: filler(180) },
      { heading: "B", text: filler(181) },
      { heading: "C", text: filler(100) },
    ]));

    expect(map.sections.map((s) => [s.words, s.minutes])).toEqual([[180, 1], [181, 2], [100, 1]]);
    // 461 words → 3 minutes, not the 4 the rounded sections add up to.
    expect(map.totalMinutes).toBe(3);
  });

  it("is empty for a document with nothing but an abstract", () => {
    expect(buildReadingMap(doc([{ canonical: "abstract", text: "Only an abstract." }]))).toEqual({ sections: [], totalMinutes: 0 });
  });
});
