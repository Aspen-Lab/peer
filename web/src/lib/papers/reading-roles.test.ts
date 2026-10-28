import { describe, expect, it } from "vitest";
import { MAP } from "@/components/reader/copy";
import { canonicalizeHeading, withInheritedBuckets, withSectionIds, type ExtractedDocument } from "./html-text";
import { buildReadingMap, gistRoute, readableSections, roleOf, type ReadingMapSection } from "./reading-map";
import { INTRODUCTION_LABEL, inferRoles, unheadedTrunk } from "./reading-roles";

// P12-48 (Theme C, rubric §1h.423–§1h.426): the roles Peer works out for the parts whose heading names none.
// Every text below is invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF. The
// papers are built the way the extractors hand them over — a section with no heading carries the placeholder
// "Body" (`pdf-text.ts` `normalize`), a heading's bucket is `canonicalizeHeading`'s.

const TOPICS = ["snail density", "shell thickness", "crab predation", "wave exposure", "storm scouring", "algal cover"];

/** `n` invented paragraphs, each its own sentence about one of six shore topics. */
function paragraphs(n: number, seed = 0): string {
  return Array.from({ length: n }, (_, k) => {
    const topic = TOPICS[(k + seed) % TOPICS.length];
    return `The survey logged ${10 + k + seed} counts of ${topic} on the rocky shore.`;
  }).join("\n\n");
}

/** A paper from its headings, in order: `[heading, paragraphs]`. "Body" is the no-heading placeholder. A numbered
 *  sub-heading takes its parent's bucket, as the outline's inheritor gives it (`withInheritedBuckets`). */
function paper(rows: ReadonlyArray<readonly [string, number]>): ExtractedDocument {
  return {
    sections: withSectionIds(
      withInheritedBuckets(
        rows.map(([heading, count], seed) => ({
          heading,
          canonical: canonicalizeHeading(heading),
          text: paragraphs(count, seed),
        })),
      ),
    ),
    figureCaptions: [],
    source: "pdf",
  };
}

const rolesOf = (doc: ExtractedDocument) => buildReadingMap(doc).sections.map((row) => [row.heading, row.role]);

describe("the label of an unheaded introduction", () => {
  it("is the label the model partition's rows already use", () => {
    expect(INTRODUCTION_LABEL).toBe(MAP.parts.labels.introduction);
  });
});

describe("A1 — the front text of a paper that names no introduction is the introduction", () => {
  // A Nature-style paper: text above the first heading, then descriptive headings, then the methods and the references.
  const nature = () =>
    paper([
      ["Body", 3],
      ["Snail density rises with wave exposure", 4],
      ["Shell thickness follows crab predation", 4],
      ["Methods", 3],
      ["References", 2],
    ]);

  it("is setup, under the role's own label, and keeps its text, id, words and lines", () => {
    const doc = nature();
    const before = readableSections(doc)[0];
    const row = buildReadingMap(doc).sections[0];

    expect(row.heading).toBe(MAP.parts.labels.introduction);
    expect(row.canonical).toBe("introduction");
    expect(row.role).toBe("setup");
    expect(row.id).toBe(before.id);
    expect(row.words).toBe(before.paragraphs.join(" ").split(/\s+/).length);
    expect(row.paragraphs.map((line) => line.index)).toEqual([0, 1, 2]);
    expect(row.level).toBe(1);
  });

  it("is the role the gist tiers read too: the front text is no longer an untagged row the gist passes over", () => {
    const map = buildReadingMap(nature());
    const tiers = gistRoute(map).byQuestion[0].sections;

    expect(tiers[map.sections[0].id].tier).toBe("faint"); // setup; as an untagged `body` row it was "none"
  });

  it("reads the empty heading the same way as the placeholder", () => {
    const rows: ReadingMapSection[] = [
      { id: "a", heading: "", canonical: "body", role: "body", words: 30, minutes: 1, paragraphs: [{ index: 0, opening: "x" }], level: 1 },
      { id: "b", heading: "Methods", canonical: "methods", role: "method", words: 30, minutes: 1, paragraphs: [{ index: 0, opening: "y" }], level: 1 },
    ];

    expect(inferRoles(rows, null)[0]).toMatchObject({ heading: INTRODUCTION_LABEL, role: "setup" });
  });

  it("is not done in a paper that names its introduction: the text above it stays body", () => {
    const doc = paper([
      ["Body", 3],
      ["1 Introduction", 4],
      ["2 Methods", 3],
      ["References", 2],
    ]);

    expect(rolesOf(doc)).toEqual([
      ["Body", "body"],
      ["1 Introduction", "setup"],
      ["2 Methods", "method"],
      ["References", "apparatus"],
    ]);
  });

  it("is not done in a paper that is one large unheaded section", () => {
    // Nothing else in it: the only section.
    expect(rolesOf(paper([["Body", 14]]))).toEqual([["Body", "body"]]);
    // The model partition's case: a trunk of 14 paragraphs with the methods and the references beside it.
    const unheaded = paper([
      ["Body", 14],
      ["Methods", 2],
      ["References", 2],
    ]);
    expect(unheadedTrunk(readableSections(unheaded).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs })))).not.toBeNull();
    expect(rolesOf(unheaded)).toEqual([
      ["Body", "body"],
      ["Methods", "method"],
      ["References", "apparatus"],
    ]);
  });

  it("is not done when only end matter stands under it", () => {
    expect(rolesOf(paper([["Body", 3], ["References", 2]]))).toEqual([
      ["Body", "body"],
      ["References", "apparatus"],
    ]);
  });

  it("is not done to a first section that has a heading of its own, however descriptive", () => {
    const doc = paper([
      ["Snail density rises with wave exposure", 4],
      ["Shell thickness follows crab predation", 4],
      ["Methods", 3],
    ]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["body", "body", "method"]);
  });

  it("is not done to a first section with no text", () => {
    const rows: ReadingMapSection[] = [
      { id: "a", heading: "Body", canonical: "body", role: "body", words: 0, minutes: 0, paragraphs: [], level: 1 },
      { id: "b", heading: "Methods", canonical: "methods", role: "method", words: 30, minutes: 1, paragraphs: [{ index: 0, opening: "y" }], level: 1 },
    ];

    expect(inferRoles(rows, null)[0].role).toBe("body");
  });
});

// Descriptive headings: none of them names a role, so each is `body` to `canonicalizeHeading`.
const SNAILS = "Snail density rises with wave exposure";
const SHELLS = "Shell thickness follows crab predation";
const STORMS = "Recovery after storm scouring";

describe("A2 — the unnamed parts between the introduction and the first named later part are evidence", () => {
  it("reads three descriptive results under a front text, up to the methods", () => {
    const doc = paper([["Body", 3], [SNAILS, 4], [SHELLS, 4], [STORMS, 3], ["Methods", 3], ["References", 2]]);

    expect(rolesOf(doc)).toEqual([
      ["Introduction", "setup"],
      [SNAILS, "evidence"],
      [SHELLS, "evidence"],
      [STORMS, "evidence"],
      ["Methods", "method"],
      ["References", "apparatus"],
    ]);
  });

  it("keeps the heading the paper printed and its bucket: only the role is worked out", () => {
    const row = buildReadingMap(paper([["1 Introduction", 3], [SNAILS, 4], ["Methods", 3]])).sections[1];

    expect(row).toMatchObject({ heading: SNAILS, canonical: "body", role: "evidence" });
  });

  it("starts at a named introduction, and leaves what stands above it", () => {
    const doc = paper([["Notes on the survey", 1], ["1 Introduction", 3], [SNAILS, 4], ["Methods", 3]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["body", "setup", "evidence", "method"]);
  });

  it.each([
    ["a named method row", "2 Methods", "method"],
    ["a named discussion row", "Discussion", "interpretation"],
    ["a named conclusion row", "Conclusions", "interpretation"],
    ["a named limitations row", "Limitations", "interpretation"],
    ["a named acknowledgements row", "Acknowledgements", "apparatus"],
  ])("ends at %s", (_name, heading, role) => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], [SHELLS, 4], [heading, 2]]);

    expect(rolesOf(doc).map(([, r]) => r)).toEqual(["setup", "evidence", "evidence", role]);
  });

  it("ends at the first back-matter row: a part two rows after it is not evidence", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Acknowledgements", 1], ["Notes on the survey", 1], [STORMS, 2]]);

    // The part right after the acknowledgements continues them (A3); the one after that is untagged.
    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "apparatus", "apparatus", "body"]);
  });

  it("does not go on past a named discussion: the parts that follow it stay untagged (A3 continues only methods and back matter)", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Discussion", 3], [SHELLS, 4], ["Methods", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "interpretation", "body", "method"]);
  });

  it("runs to the paper's end when it names no later part", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], [SHELLS, 4]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence"]);
  });

  it("reads an unnamed part directly before a references row as back matter", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], [SHELLS, 4], ["Notes on the survey", 1], ["References", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "apparatus", "apparatus"]);
  });

  it("reads an unnamed part directly before the references as back matter even after a named discussion", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Discussion", 3], ["Notes on the survey", 1], ["References", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "interpretation", "apparatus", "apparatus"]);
  });

  it("never overrides a named part, and counts only the unnamed ones", () => {
    const doc = paper([
      ["1 Introduction", 3],
      ["Related work", 2],
      [SNAILS, 4],
      ["Results", 3],
      [SHELLS, 4],
      ["Methods", 2],
    ]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "setup", "evidence", "evidence", "evidence", "method"]);
  });

  // P12-63 (rule 5), RE-AIMED (§1c): the part held ONE named sub-heading ("2.1 Methods used on the shore"), and a part whose named sub-headings all name one
  // role now takes it (A5: the part is method, see its own tests). The claim here - a named sub-heading does not end the run - is kept with a part whose two
  // named sub-headings name two roles, so that A5 does not fire and A2 reads the part.
  it("looks at top-level parts only: a named sub-heading does not end the run", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 4], ["2.1 Methods used on the shore", 2], ["2.2 Limitations", 1], ["3 " + SHELLS, 3], ["4 Discussion", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", "interpretation", "evidence", "interpretation"]);
  });

  it("(d) is not done in a paper with no introduction to stand on: a descriptive heading stays untagged", () => {
    const doc = paper([[SNAILS, 4], [SHELLS, 4], ["Methods", 3], ["References", 2]]);

    expect(rolesOf(doc)).toEqual([
      [SNAILS, "body"],
      [SHELLS, "body"],
      ["Methods", "method"],
      ["References", "apparatus"],
    ]);
  });

  it("is the role the gist tiers read: an evidence part is read first, where an untagged one was passed over", () => {
    const map = buildReadingMap(paper([["1 Introduction", 3], [SNAILS, 4], ["Methods", 3]]));
    const tiers = gistRoute(map).byQuestion[0].sections;

    expect(tiers[map.sections[1].id].tier).toBe("strong");
  });
});

describe("A3 — the unnamed parts after the references are back matter, and a part right after a named method or back-matter part continues it", () => {
  it("reads the unnamed parts after a references row as back matter, however many follow", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Discussion", 3], ["References", 2], ["Notes on the survey", 1], [STORMS, 1], [SHELLS, 1]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "interpretation", "apparatus", "apparatus", "apparatus", "apparatus"]);
  });

  it("(a) Nature-style: the Methods after the references stays method, and the unnamed part right after it continues it", () => {
    const doc = paper([
      ["Body", 3],
      [SNAILS, 4],
      [SHELLS, 4],
      [STORMS, 3],
      ["References", 3],
      ["Methods", 3],
      ["Field sampling", 2],
      ["Data availability", 1],
      ["Notes on the survey", 1],
    ]);

    expect(rolesOf(doc)).toEqual([
      ["Introduction", "setup"],
      [SNAILS, "evidence"],
      [SHELLS, "evidence"],
      [STORMS, "apparatus"], // directly before the references (A2)
      ["References", "apparatus"],
      ["Methods", "method"],
      ["Field sampling", "method"],
      ["Data availability", "apparatus"],
      ["Notes on the survey", "apparatus"],
    ]);
  });

  it("continues a named method row by one part: the row right after it, not every row after that", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Methods", 3], ["Field sampling", 2], ["Lab work", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", "method", "body"]);
  });

  it("continues a named back-matter row: a part right after the acknowledgements is back matter, with no references in the paper", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Discussion", 3], ["Acknowledgements", 1], ["Notes on the survey", 1]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "interpretation", "apparatus", "apparatus"]);
  });

  it("continues the method role before it reads the part as the one before the references", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Methods", 3], ["Field sampling", 2], ["References", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", "method", "apparatus"]);
  });

  it("does not hand on a discussion, a conclusion or a results role: the part after one is untagged", () => {
    for (const heading of ["Discussion", "Conclusions", "Results"]) {
      const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["Methods", 2], [heading, 3], ["Notes on the survey", 1]]);

      expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", roleOf(canonicalizeHeading(heading)), "body"]);
    }
  });

  it("never overrides a named part after the references", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 4], ["References", 2], ["Methods", 3], ["Results", 2], ["Conclusions", 1]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "apparatus", "apparatus", "method", "evidence", "interpretation"]);
  });

  it("is not done before the introduction: a part above it stays untagged whatever follows the references", () => {
    const doc = paper([["Notes on the survey", 1], ["1 Introduction", 3], [SNAILS, 4], ["References", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["body", "setup", "apparatus", "apparatus"]);
  });

  it("(d) is not done in a paper with no introduction to stand on", () => {
    const doc = paper([[SNAILS, 4], ["References", 2], ["Notes on the survey", 1]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["body", "apparatus", "body"]);
  });
});

describe("A4 — a sub-row takes its part's role", () => {
  it("gives the sub-headings of an unnamed part the role the part was given", () => {
    const doc = paper([
      ["1 Introduction", 3],
      ["2 " + SNAILS, 3],
      ["2.1 Counts by site", 2],
      ["2.2 Counts by season", 2],
      ["3 " + SHELLS, 3],
      ["3.1 Counts by size", 2],
      ["4 Methods", 2],
    ]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "evidence", "evidence", "evidence", "method"]);
  });

  it("follows the part into the back matter", () => {
    const doc = paper([["1 Introduction", 3], ["2 Discussion", 2], ["References", 2], ["3 Notes on the survey", 1], ["3.1 Counts by site", 1]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "interpretation", "apparatus", "apparatus", "apparatus"]);
  });

  it("takes the role of the nearest row above, through a sub-sub-heading", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 2], ["2.1 Counts by site", 2], ["2.1.1 Counts by tide", 2], ["3 Methods", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "evidence", "method"]);
  });

  // P12-63 (rule 5), RE-AIMED (§1c): the part held ONE named sub-heading ("2.2 Limitations"), and a part whose named sub-headings all name one role now takes it
  // (A5: the part is interpretation, see its own tests). The claim here - a sub-heading that names a role is never overridden, and its unnamed sibling takes
  // the part's role - is kept with a part whose two named sub-headings name two roles, so that A5 does not fire and A2 reads the part.
  it("never overrides a sub-heading that names a role", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 2], ["2.1 Counts by site", 2], ["2.2 Limitations", 2], ["2.3 Methods used on the shore", 2], ["3 Methods", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "interpretation", "method", "method"]);
  });

  it("leaves a sub-row alone where its part has no role", () => {
    // Above the introduction: the part is untagged, so is its sub-row.
    const above = paper([["1 Notes on the survey", 1], ["1.1 Counts by site", 1], ["2 Introduction", 3], ["3 Methods", 2]]);
    expect(rolesOf(above).map(([, role]) => role)).toEqual(["body", "body", "setup", "method"]);
    // No introduction to stand on at all.
    const none = paper([["1 " + SNAILS, 3], ["1.1 Counts by site", 2], ["2 Methods", 2]]);
    expect(rolesOf(none).map(([, role]) => role)).toEqual(["body", "body", "method"]);
  });

  it("leaves the sub-headings of a part that names its role to the extractors' bucket inheritance", () => {
    const row = (id: string, heading: string, canonical: string, role: ReadingMapSection["role"], extra: Partial<ReadingMapSection> = {}): ReadingMapSection => ({
      id,
      heading,
      canonical,
      role,
      words: 30,
      minutes: 1,
      paragraphs: [{ index: 0, opening: "x" }],
      level: 1,
      ...extra,
    });
    // A map read before the inheritor existed (the committed fixtures): a named part, an untagged sub-heading.
    const rows = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "2 Methods", "methods", "method"),
      row("c", "2.1 Field work", "body", "body", { level: 2, parentId: "b" }),
    ];

    expect(inferRoles(rows, null).every((r, k) => r === rows[k])).toBe(true);
  });

  it("gives a sub-row the role of a part worked out above, however it was worked out", () => {
    const row = (id: string, heading: string, canonical: string, role: ReadingMapSection["role"], extra: Partial<ReadingMapSection> = {}): ReadingMapSection => ({
      id,
      heading,
      canonical,
      role,
      words: 30,
      minutes: 1,
      paragraphs: [{ index: 0, opening: "x" }],
      level: 1,
      ...extra,
    });
    const rows = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "2 Counts by site", "body", "body"),
      row("c", "2.1 Rocky shore", "body", "body", { level: 2, parentId: "b" }),
      row("d", "2.1.1 Low tide", "body", "body", { level: 3, parentId: "c" }),
      row("e", "3 Methods", "methods", "method"),
    ];

    expect(inferRoles(rows, null).map((r) => r.role)).toEqual(["setup", "evidence", "evidence", "evidence", "method"]);
    // Without an introduction to stand on, nothing is inferred.
    expect(inferRoles(rows.slice(1), null).map((r) => r.role)).toEqual(["body", "body", "body", "method"]);
  });
});

// P12-63 (rule 5; ruling §1h.436 (c)): an unnamed part whose named sub-headings all name one role has that role. The LaTeXML-style case C P12-48 reported
// (§7 point 5): "3 Causal Explanations and Counterfactual Generation" between a named introduction and a named conclusion, over "3.2 Our Solution", a
// method; A2 called the part evidence and its own sub-heading contradicted it.
describe("A5 - an unnamed part whose named sub-headings all name one role takes that role", () => {
  const row = (id: string, heading: string, canonical: string, role: ReadingMapSection["role"], extra: Partial<ReadingMapSection> = {}): ReadingMapSection => ({
    id,
    heading,
    canonical,
    role,
    words: 30,
    minutes: 1,
    paragraphs: [{ index: 0, opening: "x" }],
    level: 1,
    ...extra,
  });

  it("(d) takes method over two named method sub-headings - evidence before, method after", () => {
    const doc = paper([
      ["1 Introduction", 3],
      ["2 How the shore was surveyed", 3],
      ["2.1 Methods", 2],
      ["2.2 Experimental procedures", 2],
      ["3 " + SNAILS, 4],
      ["4 Discussion", 2],
    ]);
    const map = buildReadingMap(doc);

    expect(map.sections.map((r) => [r.heading, r.canonical])).toEqual([
      ["1 Introduction", "introduction"],
      ["2 How the shore was surveyed", "body"],
      ["2.1 Methods", "methods"],
      ["2.2 Experimental procedures", "methods"],
      ["3 " + SNAILS, "body"],
      ["4 Discussion", "discussion"],
    ]);
    // A2 alone (the part's own sub-rows not read) would call the part evidence, as the part after it is.
    expect(map.sections.map((r) => r.role)).toEqual(["setup", "method", "method", "method", "evidence", "interpretation"]);
  });

  it("keeps the heading and the bucket the paper printed: only the role is worked out", () => {
    const part = buildReadingMap(paper([["1 Introduction", 3], ["2 How the shore was surveyed", 3], ["2.1 Methods", 2], ["3 Discussion", 2]])).sections[1];

    expect(part).toMatchObject({ heading: "2 How the shore was surveyed", canonical: "body", role: "method" });
  });

  it("takes the role of ONE named sub-heading, the unnamed ones not counting: the sub-heading's role, and its unnamed sibling the part's (A4)", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 3], ["2.1 Counts by site", 2], ["2.2 Limitations", 2], ["3 Methods", 2]]);

    // The original A4 fixture, before A5: the part was evidence; its only named sub-heading says interpretation.
    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "interpretation", "interpretation", "interpretation", "method"]);
    const methods = paper([["1 Introduction", 3], ["2 " + SNAILS, 4], ["2.1 Methods used on the shore", 2], ["3 " + SHELLS, 3], ["4 Discussion", 2]]);

    expect(rolesOf(methods).map(([, role]) => role)).toEqual(["setup", "method", "method", "evidence", "interpretation"]);
  });

  it("is not done where the named sub-headings name two roles: A2 reads the part", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 3], ["2.1 Methods used on the shore", 2], ["2.2 Limitations", 2], ["3 Discussion", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", "interpretation", "interpretation"]);
  });

  it("is not done where no sub-heading names a role", () => {
    const doc = paper([["1 Introduction", 3], ["2 " + SNAILS, 3], ["2.1 Counts by site", 2], ["2.2 Counts by season", 2], ["3 Discussion", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "evidence", "interpretation"]);
  });

  it("never overrides a part that names its role", () => {
    // Through the extractors, the sub-headings of a named part take its bucket (`withInheritedBuckets`), so the part keeps its role...
    const doc = paper([["1 Introduction", 3], ["2 Results", 3], ["2.1 Methods used on the shore", 2], ["3 Discussion", 2]]);
    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "evidence", "interpretation"]);
    // ...and in a map read before the inheritor existed, where a sub-row names another role, the part is still the one its heading names.
    const rows = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "2 Results", "results", "evidence"),
      row("c", "2.1 Methods used on the shore", "methods", "method", { level: 2, parentId: "b" }),
      row("d", "3 Discussion", "discussion", "interpretation"),
    ];

    expect(inferRoles(rows, null).every((r, k) => r === rows[k])).toBe(true);
  });

  it("reads before the continuation of A3: a part right after a named method part has the role its sub-headings name", () => {
    const doc = paper([["1 Introduction", 3], ["2 Methods", 2], ["3 How the counts were read", 3], ["3.1 Results", 2], ["4 Discussion", 2]]);

    // Without A5 the part right after the methods continues them (A3).
    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "method", "evidence", "evidence", "interpretation"]);
  });

  it("reads before the back matter of A2: a part directly before the references has the role its sub-headings name", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 3], ["2 How the shore was surveyed", 2], ["2.1 Methods", 2], ["References", 2]]);

    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "method", "method", "apparatus"]);
  });

  it("reads before the back matter of A3: a part after the references has the role its sub-headings name", () => {
    const doc = paper([["1 Introduction", 3], [SNAILS, 3], ["Discussion", 2], ["References", 2], ["5 Survey details", 2], ["5.1 Experimental procedures", 2]]);

    // Without A5 the part after the references is back matter (A3).
    expect(rolesOf(doc).map(([, role]) => role)).toEqual(["setup", "evidence", "interpretation", "apparatus", "method", "method"]);
  });

  it("takes the one role of its named sub-rows, however the map was made (hand-built rows)", () => {
    const rows = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "3 Causal Explanations and Counterfactual Generation", "body", "body"),
      row("c", "3.1 Setting", "body", "body", { level: 2, parentId: "b" }),
      row("d", "3.2 Our Solution", "methods", "method", { level: 2, parentId: "b" }),
      row("e", "4 Conclusion", "conclusion", "interpretation"),
    ];

    expect(inferRoles(rows, null).map((r) => r.role)).toEqual(["setup", "method", "method", "method", "interpretation"]);
  });

  it("is a top-level part's alone, and only where there is an introduction to stand on", () => {
    const rows = [
      row("b", "3 Causal Explanations", "body", "body"),
      row("d", "3.2 Our Solution", "methods", "method", { level: 2, parentId: "b" }),
      row("e", "4 Conclusion", "conclusion", "interpretation"),
    ];
    // No introduction anywhere: nothing is worked out.
    expect(inferRoles(rows, null).map((r) => r.role)).toEqual(["body", "method", "interpretation"]);
    // Above the introduction: left alone.
    const above = [row("z", "0 Notes", "body", "body"), row("y", "0.1 Experimental procedures", "methods", "method", { level: 2, parentId: "z" }), row("a", "1 Introduction", "introduction", "setup")];
    expect(inferRoles(above, null).map((r) => r.role)).toEqual(["body", "method", "setup"]);
    // A sub-part that has sub-parts of its own is not read for them: only the top-level part's direct sub-rows say its role.
    const deep = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "2 Counts", "body", "body"),
      row("c", "2.1 Sites", "body", "body", { level: 2, parentId: "b" }),
      row("d", "2.1.1 Experimental procedures", "methods", "method", { level: 3, parentId: "c" }),
    ];
    expect(inferRoles(deep, null).map((r) => r.role)).toEqual(["setup", "evidence", "evidence", "method"]);
  });

  it("leaves a paper that names every part as it is, and changes no row it does not read", () => {
    const rows = [
      row("a", "1 Introduction", "introduction", "setup"),
      row("b", "2 Methods", "methods", "method"),
      row("c", "2.1 Field work", "methods", "method", { level: 2, parentId: "b" }),
    ];

    expect(inferRoles(rows, null).every((r, k) => r === rows[k])).toBe(true);
  });
});

describe("a paper that names every part is not touched", () => {
  it("(b) numbered: every row keeps the role its heading gave it, and is the very row it was", () => {
    const doc = paper([
      ["1. Introduction", 3],
      ["2. Experimental methods", 3],
      ["2.1 Sample preparation", 2],
      ["3. Results and discussion", 4],
      ["3.1 Snail density", 2],
      ["4. Conclusions", 2],
      ["Acknowledgements", 1],
      ["References", 2],
    ]);
    const map = buildReadingMap(doc);

    expect(map.sections.map((row) => row.role)).toEqual(
      ["setup", "method", "method", "evidence", "evidence", "interpretation", "apparatus", "apparatus"],
    );
    expect(map.sections.map((row) => row.role)).toEqual(map.sections.map((row) => roleOf(row.canonical)));
    expect(inferRoles(map.sections, null).every((row, k) => row === map.sections[k])).toBe(true);
  });
});
