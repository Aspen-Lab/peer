import { describe, expect, it } from "vitest";
import { canonicalizeHeading, withInheritedBuckets, withSectionIds, type ExtractedDocument } from "./html-text";
import { buildReadingMap, readableSections } from "./reading-map";
import { closingPartition, type GuidePartition } from "./reading-partition";

// P12-63 (rule 2; ruling §1h.436 (c)): the closing split's echo test uses the abstract when the reading has one, else the last paragraph of the
// setup part - the paper's own announcement of what it shows; neither, no split. A Nature-style article prints no abstract in its text, and its
// introduction ends on "here we show ...". Every text is invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF.

const SNAILS = "Snail density rises with wave exposure";
const SHELLS = "Shell thickness follows crab predation";
const STORMS = "Recovery after storm scouring";
/** The paper's own announcement, the last paragraph of its introduction. Long words (7+): exposure, density, predation, thickens. */
const ANNOUNCE = "Here we show that wave exposure raises snail density and that crab predation thickens shells.";
/** The closing: cue "taken together" / "we show", no figure; long words together, exposure, density, predation, thickens - four of five in ANNOUNCE. */
const SUMMARY = "Taken together, we show that wave exposure raises snail density and that crab predation thickens the shells.";
/** A closing paragraph that is outlook (no cue). */
const OUTLOOK = "Future surveys could follow the recovery of algal cover after storm scouring across more shores.";
/** An abstract (and an introduction's last paragraph) about something else: no long word of SUMMARY in it. */
const ELSEWHERE = "Kelp forests recede under warming oceans and urchin grazing.";
/** An abstract the closing restates. */
const ABSTRACT = "Snail density rises with wave exposure while shell thickness follows crab predation, and storm scouring resets algal cover on the shore.";

/** `n` plain results paragraphs: no cue, no figure, no long word of SUMMARY. */
const plain = (n: number, seed = 0): string[] =>
  Array.from({ length: n }, (_, k) => `The survey logged ${10 + k + seed} counts of ${["limpets", "barnacles", "periwinkles"][(k + seed) % 3]} on the rocky shore.`);

/** A paper from `[heading, paragraphs[]]`, built the way the extractors hand it over. */
function shore(rows: ReadonlyArray<readonly [string, readonly string[]]>): ExtractedDocument {
  return {
    sections: withSectionIds(withInheritedBuckets(rows.map(([heading, paragraphs]) => ({ heading, canonical: canonicalizeHeading(heading), text: paragraphs.join("\n\n") })))),
    figureCaptions: [],
    source: "pdf",
  };
}

const bodyOf = (doc: ExtractedDocument) => readableSections(doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));

/** The closing split of `doc` against `abstract` (none by default: the reading has no abstract). */
function splitOf(doc: ExtractedDocument, abstract: string | null | undefined = undefined): GuidePartition | null {
  return closingPartition(buildReadingMap(doc), bodyOf(doc), abstract);
}

/** The Nature-style paper: front text ending on the announcement, three descriptive parts, the last ending on the closing, then the back matter. */
function nature(intro: readonly string[] = [...plain(2), ANNOUNCE], last: readonly string[] = [...plain(3), SUMMARY, OUTLOOK]): ExtractedDocument {
  return shore([
    ["Body", intro],
    [SNAILS, plain(4, 1)],
    [SHELLS, plain(4, 2)],
    [STORMS, last],
    ["Online content", plain(1)],
    ["References", plain(3)],
    ["Methods", plain(3)],
  ]);
}

const SPLIT = (sectionId: string): GuidePartition => ({
  sectionId,
  closing: true,
  parts: [
    { role: "results", fromParagraph: 0, toParagraph: 2 },
    { role: "conclusion", fromParagraph: 3, toParagraph: 4 },
  ],
});

describe("closingPartition - a paper with no abstract takes the echo from the last paragraph of its setup part (P12-63, rule 2)", () => {
  it("(a) splits a Nature-style paper that prints no abstract, on its announcing last introduction paragraph", () => {
    const doc = nature();
    const storms = buildReadingMap(doc).sections.find((row) => row.heading === STORMS)!;

    expect(splitOf(doc)).toEqual(SPLIT(storms.id));
    // Each form of "the reading has no abstract" reads the same way.
    expect(splitOf(doc, null)).toEqual(SPLIT(storms.id));
    expect(splitOf(doc, "")).toEqual(SPLIT(storms.id));
  });

  it("reads a named introduction the same way as the front text", () => {
    const doc = shore([
      ["1 Introduction", [...plain(2), ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(doc)?.sectionId).toBe("s2");
  });

  it("takes the LAST paragraph of the setup part, not another", () => {
    // The announcement first, an unrelated paragraph last: the last is the echo, and the closing does not restate it.
    expect(splitOf(nature([ANNOUNCE, ...plain(1), ELSEWHERE]))).toBeNull();
    // The announcement last: the same paper splits.
    expect(splitOf(nature([ELSEWHERE, ...plain(1), ANNOUNCE]))?.parts[1].fromParagraph).toBe(3);
  });

  it("holds the closing to the 20 % share against that paragraph, as against an abstract", () => {
    // One long word of five (20 %) passes; none (0 %) does not.
    const oneOfFive = "Dense colonies persist where predation is low and shelter is common.";
    const noneOfFive = "Dense colonies persist where shelter is common and tides are gentle.";

    expect(splitOf(nature([...plain(1), oneOfFive]))).not.toBeNull();
    expect(splitOf(nature([...plain(1), noneOfFive]))).toBeNull();
  });

  it("takes the last introduction row that holds a paragraph, sub-heading or not", () => {
    const doc = shore([
      ["1 Introduction", plain(2)],
      ["1.1 What this survey adds", [ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(doc)?.sectionId).toBe("s3");
  });

  it("reads the introduction, not a related-work part that stands after it", () => {
    const related = shore([
      ["1 Introduction", [...plain(1), ANNOUNCE]],
      ["2 Related work", [...plain(1), ELSEWHERE]],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);

    expect(splitOf(related)?.sectionId).toBe("s2");
  });

  it("reads the last setup row when the paper names no introduction", () => {
    const doc = shore([
      ["Related work", [...plain(1), ANNOUNCE]],
      ["Results", [...plain(3), SUMMARY, OUTLOOK]],
      ["Methods", plain(2)],
    ]);

    expect(buildReadingMap(doc).sections.map((row) => row.role)).toEqual(["setup", "evidence", "method"]);
    expect(splitOf(doc)?.sectionId).toBe("s1");
  });

  it("reads only a setup part that stands before the row it divides", () => {
    // The announcing related-work part stands after the results: it is not the paper's announcement.
    const after = shore([
      ["Results", [...plain(3), SUMMARY, OUTLOOK]],
      ["Related work", [...plain(1), ANNOUNCE]],
      ["Methods", plain(2)],
    ]);

    expect(splitOf(after)).toBeNull();
  });

  it("passes over a group heading that holds no paragraph of its own", () => {
    const group = shore([
      ["1 Introduction", []],
      ["1.1 What this survey adds", [...plain(1), ANNOUNCE]],
      ["2 " + SNAILS, plain(3)],
      ["3 " + STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["4 Methods", plain(2)],
    ]);
    const map = buildReadingMap(group);

    expect(map.sections.slice(0, 2).map((row) => [row.canonical, row.paragraphs.length])).toEqual([["introduction", 0], ["introduction", 2]]);
    expect(splitOf(group)?.sectionId).toBe("s3");
  });

  it("has no split where the setup part holds no paragraph, or there is none: neither an abstract nor an announcement", () => {
    const doc = nature();
    const map = buildReadingMap(doc);
    const body = bodyOf(doc);
    const none = shore([["Results", [...plain(3), SUMMARY, OUTLOOK]], ["Methods", plain(2)], ["References", plain(2)]]);

    // The only setup row is empty in the body the split is handed: no word to echo, and no error.
    expect(closingPartition(map, body.map((section, k) => (k === 0 ? { ...section, paragraphs: [] } : section)), undefined)).toBeNull();
    expect(splitOf(none)).toBeNull();
    // The abstract, where there is one, still splits the paper that has no setup part.
    expect(splitOf(none, ABSTRACT)?.sectionId).toBe("s0");
  });

  it("(b) uses the abstract when the reading has one: the setup paragraph is then not looked at", () => {
    // An abstract the closing restates splits the paper whose announcement is about something else...
    expect(splitOf(nature([...plain(1), ELSEWHERE]), ABSTRACT)?.parts[1].fromParagraph).toBe(3);
    // ...and an abstract about something else leaves the paper whole although the announcement matches.
    expect(splitOf(nature(), ELSEWHERE)).toBeNull();
  });

  it("falls back to the setup paragraph when the abstract has no long word", () => {
    expect(splitOf(nature(), "Snails on a shore.")?.parts[1].fromParagraph).toBe(3);
  });

  it("keeps the rules that do not depend on the echo", () => {
    // A named conclusion, no cue, and a figure cited: no split whatever the echo is.
    const named = shore([
      ["Body", [...plain(2), ANNOUNCE]],
      [SNAILS, plain(3)],
      [STORMS, [...plain(3), SUMMARY, OUTLOOK]],
      ["Conclusions", plain(2)],
      ["Methods", plain(2)],
    ]);
    const noCue = nature(undefined, [...plain(3), "Wave exposure raises snail density and crab predation thickens the shells of the snails.", OUTLOOK]);
    const figure = nature(undefined, [...plain(3), "Taken together (Fig. 3), we show that wave exposure raises snail density and crab predation thickens shells.", OUTLOOK]);

    expect(splitOf(named)).toBeNull();
    expect(splitOf(noCue)).toBeNull();
    expect(splitOf(figure)).toBeNull();
  });
});
