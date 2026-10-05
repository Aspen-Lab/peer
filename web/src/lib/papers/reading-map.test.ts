import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { blockMarker } from "@/lib/text/math";
import { withSectionIds, type DraftSection, type ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import { buildReading } from "./reading";
import { buildReadingMap, routeByQuestions, type ReadingMap } from "./reading-map";
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

// ── P1-02: the Tier 0 route (spec D9 second half, rulings §1f.6–8) ─────
//
// Per question and section: read / skim / not mentioned, from counts a reader
// can check — which of the question's specific terms the section mentions,
// how often, and in how many sentences — with one verbatim sentence as
// evidence. Pure and in the browser: the questions never leave the function.

// §1f.6 (amended): the route takes the rendered body — what the browser holds
// (`PaperReading.body`) — index-aligned with the map.
const bodyOf = (paperDoc: ExtractedDocument) => buildReading(paper, okFullText(paperDoc)).body;
const route = (paperDoc: ExtractedDocument, questions: string[]) =>
  routeByQuestions(buildReadingMap(paperDoc), bodyOf(paperDoc), questions);

describe("routeByQuestions — specific terms and vague questions (§1f.6)", () => {
  const paperDoc = doc([{ heading: "1 Introduction", canonical: "introduction", text: "The LCO cathode cracks after cycling. The cathode swells as LCO loses lithium." }]);
  const map = buildReadingMap(paperDoc);

  it("calls a question with one specific term vague, with no sections", () => {
    const result = routeByQuestions(map, bodyOf(paperDoc), ["LCO?"]);

    expect(result.byQuestion).toEqual([{ question: "LCO?", vague: true, sections: {} }]);
    expect(result.vague).toBe(true);
  });

  it("calls a question of generic words only vague", () => {
    const result = routeByQuestions(map, bodyOf(paperDoc), ["the energy of materials and data"]);

    expect(result.byQuestion[0].vague).toBe(true);
    expect(result.byQuestion[0].sections).toEqual({});
  });

  it("is vague at the top only when every question is, and not for no questions", () => {
    expect(routeByQuestions(map, bodyOf(paperDoc), ["LCO?", "LCO cathode"]).vague).toBe(false);
    expect(routeByQuestions(map, bodyOf(paperDoc), ["LCO?", "energy data"]).vague).toBe(true);
    expect(routeByQuestions(map, bodyOf(paperDoc), [])).toEqual({ byQuestion: [], vague: false });
  });

  it("counts a term the question repeats once, and reports it as the reader typed it, lower-cased", () => {
    const result = routeByQuestions(map, bodyOf(paperDoc), ["LCO lco Cathode"]);
    const section = result.byQuestion[0].sections.s0;

    expect(result.byQuestion[0].vague).toBe(false);
    expect(section.hits).toEqual([{ term: "cathode", count: 2 }, { term: "lco", count: 2 }]);
  });
});

describe("routeByQuestions — tiers, hits and evidence (§1f.7)", () => {
  it("expands an abbreviation: the question's short form finds the section's long form, and counts it", () => {
    // `ABBREVIATION_GROUPS`: ["lco", "lithium cobalt oxide", "licoo2"].
    const paperDoc = doc([{ canonical: "results", text:
      "Lithium cobalt oxide loses capacity above 4.5 volts. The degradation of lithium cobalt oxide starts at the surface." }]);
    const result = route(paperDoc, ["LCO degradation"]);
    const section = result.byQuestion[0].sections.s0;

    expect(section.hits).toEqual([{ term: "lco", count: 2 }, { term: "degradation", count: 1 }]);
    expect(section.tier).toBe("read");
  });

  it("is skim with two terms in only one sentence", () => {
    const paperDoc = doc([{ text: "The LCO cathode cracks under load. Nothing else in this section bears on it at all." }]);
    const section = route(paperDoc, ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section.hits.map((h) => h.term)).toEqual(["cathode", "lco"]);
    expect(section.tier).toBe("skim");
  });

  it("is skim with one term in five sentences", () => {
    const paperDoc = doc([{ text: "LCO is layered. LCO is common. LCO is stable. LCO is costly. LCO is studied." }]);
    const section = route(paperDoc, ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section.hits).toEqual([{ term: "lco", count: 5 }]);
    expect(section.tier).toBe("skim");
  });

  it("is read with two terms in two sentences", () => {
    const paperDoc = doc([{ text: "The LCO layer cracks first. Then the cathode swells." }]);
    const section = route(paperDoc, ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section.tier).toBe("read");
  });

  it("calls a section that mentions none of the terms not mentioned, with no evidence", () => {
    const paperDoc = doc([{ text: "Samples were annealed at 900 K for two hours in argon." }]);
    const section = route(paperDoc, ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section).toEqual({ tier: "none", hits: [], paragraphs: [] });
    expect("evidence" in section).toBe(false);
  });

  it("lists the paragraphs that mention a term, by the map's indices", () => {
    const paperDoc = doc([{ text: "The LCO layer cracks.\n\nNothing here.\n\nThe cathode swells under load." }]);
    const map = buildReadingMap(paperDoc);
    const section = routeByQuestions(map, bodyOf(paperDoc), ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section.paragraphs).toEqual([0, 2]);
    expect(map.sections[0].paragraphs.map((p) => p.index)).toEqual([0, 1, 2]);
  });

  it("quotes the matching sentence that says most, verbatim, and the earlier one on a tie", () => {
    const claim = "We show that the LCO cathode keeps 92% of its capacity after 500 cycles.";
    const paperDoc = doc([{ text: `The cathode was made from LCO powder. ${claim} The LCO cathode is also cheap.` }]);
    const section = route(paperDoc, ["LCO cathode"]).byQuestion[0].sections.s0;

    expect(section.evidence).toBe(claim);

    const tie = doc([{ text: "The LCO cathode is grey. The LCO cathode is hard." }]);
    expect(route(tie, ["LCO cathode"]).byQuestion[0].sections.s0.evidence)
      .toBe("The LCO cathode is grey.");
  });

  it("keeps each question's own entry: a section can be read for one and not mentioned for another", () => {
    const paperDoc = doc([
      { heading: "A", text: "The LCO layer cracks first. Then the cathode swells." },
      { heading: "B", text: "Grain boundaries set the creep rate. Creep slows as grain boundaries thin." },
    ]);
    const result = route(paperDoc, ["LCO cathode", "grain boundaries creep"]);

    expect(result.byQuestion.map((q) => q.question)).toEqual(["LCO cathode", "grain boundaries creep"]);
    expect(result.byQuestion[0].sections.s0.tier).toBe("read");
    expect(result.byQuestion[0].sections.s1.tier).toBe("none");
    expect(result.byQuestion[1].sections.s0.tier).toBe("none");
    expect(result.byQuestion[1].sections.s1.tier).toBe("read");
  });

  it("reads the body it is given, aligned with the map — a hand-built one will do", () => {
    const map: ReadingMap = {
      sections: [{ id: "s3", heading: "Results", canonical: "results", role: "evidence", words: 9, minutes: 1, paragraphs: [{ index: 0, opening: null }, { index: 1, opening: null }] }],
      totalMinutes: 1,
    };
    const result = routeByQuestions(map, [{ paragraphs: ["The LCO layer cracks first.", "Then the cathode swells."] }], ["LCO cathode"]);

    expect(result.byQuestion[0].sections).toEqual({
      s3: {
        tier: "read",
        hits: [{ term: "cathode", count: 1 }, { term: "lco", count: 1 }],
        evidence: "The LCO layer cracks first.",
        paragraphs: [0, 1],
      },
    });
  });

  it("gives every map section an entry, keyed by the section's id", () => {
    const paperDoc = doc([
      { heading: "Abstract", canonical: "abstract", text: "We study LCO cathodes." },
      { heading: "1 Introduction", text: "The LCO cathode cracks." },
      { heading: "2 Methods", text: "Samples were annealed." },
    ]);
    const result = route(paperDoc, ["LCO cathode"]);

    expect(Object.keys(result.byQuestion[0].sections)).toEqual(["s1", "s2"]);
  });

  it("is a pure function: the same input twice gives the same result, and nothing it is given changes", () => {
    const paperDoc = withIds(zenodoDocJson);
    const map = buildReadingMap(paperDoc);
    const body = bodyOf(paperDoc);
    const questions = ["graph embeddings protein structure", "LCO?"];
    const before = JSON.stringify([map, body, questions]);

    const first = routeByQuestions(map, body, questions);
    const second = routeByQuestions(map, body, questions);

    expect(second).toEqual(first);
    expect(JSON.stringify([map, body, questions])).toBe(before);
  });
});

describe("routeByQuestions — the committed fixtures", () => {
  const QUESTIONS: Record<string, string> = {
    "arxiv-2609.02697 (LaTeXML HTML)": "medical image counterfactuals causal explanations",
    "arxiv-2609.02113 (PDF)": "variational quantum eigensolver protein lattice",
    "zenodo-W7208807247 (PDF)": "graph embeddings protein structure",
  };

  it.each(FIXTURES)("%s: tiers follow the counts, paragraphs are the map's, evidence is a sentence of the section", (name, paperDoc) => {
    const map = buildReadingMap(paperDoc);
    const body = buildReading(paper, okFullText(paperDoc)).body;
    const result = routeByQuestions(map, body, [QUESTIONS[name]]);
    const entry = result.byQuestion[0];

    expect(entry.vague).toBe(false);
    expect(Object.keys(entry.sections)).toEqual(map.sections.map((s) => s.id));
    map.sections.forEach((row, k) => {
      const section = entry.sections[row.id];
      const indices = row.paragraphs.map((p) => p.index);
      expect(section.paragraphs.every((i) => indices.includes(i))).toBe(true);
      if (section.hits.length === 0) {
        expect(section.tier).toBe("none");
        expect(section.evidence).toBeUndefined();
      } else {
        expect(section.tier === "read" ? section.hits.length >= 2 : true).toBe(true);
        expect(section.tier).not.toBe("none");
      }
      if (section.evidence !== undefined) {
        expect(body[k].paragraphs.some((p) => p.includes(section.evidence!))).toBe(true);
      }
      const counts = section.hits.map((h) => h.count);
      expect(counts).toEqual([...counts].sort((a, b) => b - a));
    });
    // The question finds something in its own paper.
    expect(Object.values(entry.sections).some((s) => s.tier !== "none")).toBe(true);
  });
});
