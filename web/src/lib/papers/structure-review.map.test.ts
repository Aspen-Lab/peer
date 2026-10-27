import { describe, expect, it } from "vitest";
import { FIVE_PARTS, inventedPaper } from "@/test-support/structure-fixtures";
import { partitionedMap, partOf, type GuidePartition } from "./reading-partition";
import { applyStructureReview, draftOf, reviewedParts, type Correction } from "./structure-review";

// P12-53 (ruling §1h.424 (a), §1h.428; B P12-42 §8.5): the review laid over the displayed map. A row's role
// changes only where the review changed it; no row is added, removed or reordered and no id changes (the scroll
// position cannot move); a changed row carries no mark; and without a review the map is the very object it was.
// Every paper below is invented.

const FIVE = inventedPaper(FIVE_PARTS);
const draft = draftOf(FIVE.input)!;
const review = (corrections: Correction[], over: { draftDigest?: string } = {}) => ({ corrections, unsure: [], draftDigest: over.draftDigest ?? draft.digest });

// The canonical case: the draft's evidence part starts two early and its fourth part is `method` for what is evidence.
const FIX: Correction[] = [
  { op: "move_start", part: 2, toParagraph: 11 },
  { op: "set_role", part: 3, role: "evidence" },
];

describe("applyStructureReview — the review over the map's rows", () => {
  it("changes the role of the row the review changed, and no other", () => {
    const shown = applyStructureReview(FIVE.map, draft, review(FIX));

    expect(FIVE.map.sections.map((row) => row.role)).toEqual(["setup", "method", "evidence", "method", "interpretation", "apparatus"]);
    expect(shown.sections.map((row) => row.role)).toEqual(["setup", "method", "evidence", "evidence", "interpretation", "apparatus"]);
  });

  it("keeps every id, the order and the totals: no row is added, removed or moved, so the scroll position cannot move", () => {
    const shown = applyStructureReview(FIVE.map, draft, review(FIX));

    expect(shown.sections.map((row) => row.id)).toEqual(FIVE.map.sections.map((row) => row.id));
    expect(shown.sections).toHaveLength(FIVE.map.sections.length);
    expect(shown.totalMinutes).toBe(FIVE.map.totalMinutes);
    shown.sections.forEach((row, k) => {
      expect(row.paragraphs).toBe(FIVE.map.sections[k].paragraphs);
      expect(row.words).toBe(FIVE.map.sections[k].words);
      expect(row.heading).toBe(FIVE.map.sections[k].heading);
    });
  });

  it("leaves the rows it did not change as the very objects they were", () => {
    const shown = applyStructureReview(FIVE.map, draft, review(FIX));

    [0, 1, 2, 4, 5].forEach((k) => expect(shown.sections[k]).toBe(FIVE.map.sections[k]));
    expect(shown.sections[3]).not.toBe(FIVE.map.sections[3]);
  });

  it("puts no mark on a corrected role: the row has the keys it had, and a role is a role", () => {
    const shown = applyStructureReview(FIVE.map, draft, review(FIX));

    expect(Object.keys(shown.sections[3]).sort()).toEqual(Object.keys(FIVE.map.sections[3]).sort());
    expect({ ...shown.sections[3], role: "method" }).toEqual(FIVE.map.sections[3]);
    expect(JSON.stringify(shown)).not.toMatch(/infer|review|corrected|guess/i);
  });

  it("shows a row the role most of its paragraphs have: a boundary inside a row is not a row the map can draw", () => {
    // Results holds two method paragraphs and seven of evidence: moving the evidence part's start does not make it a method row.
    const shown = applyStructureReview(FIVE.map, draft, review([{ op: "move_start", part: 2, toParagraph: 11 }]));

    expect(shown).toBe(FIVE.map);
  });

  it("is the map itself for no review, for a review of another draft, and for one that changes no row", () => {
    expect(applyStructureReview(FIVE.map, draft, undefined)).toBe(FIVE.map);
    expect(applyStructureReview(FIVE.map, draft, null)).toBe(FIVE.map);
    expect(applyStructureReview(FIVE.map, draft, review(FIX, { draftDigest: "0".repeat(14) }))).toBe(FIVE.map);
    expect(applyStructureReview(FIVE.map, draft, review([]))).toBe(FIVE.map);
  });

  it("is the map itself for a review that does not fit the draft: out of range, unknown roles, nothing usable", () => {
    const hostile = review([
      { op: "set_role", part: 99, role: "method" },
      { op: "move_start", part: 2, toParagraph: 9999 },
      { op: "set_role", part: 3, role: "banana" as never },
    ]);

    expect(applyStructureReview(FIVE.map, draft, hostile)).toBe(FIVE.map);
    expect(reviewedParts(draft, hostile)).toBeNull();
  });

  it("does not lay a review over another draft than the one it was made against", () => {
    const other = draftOf(inventedPaper(FIVE_PARTS.slice(0, 5)).input)!;

    expect(other.digest).not.toBe(draft.digest);
    expect(reviewedParts(other, review(FIX))).toBeNull();
  });
});

describe("applyStructureReview — sub-rows, group rows and the partition's rows", () => {
  const NESTED = inventedPaper([
    { heading: "1. Introduction", canonical: "introduction", truth: [["setup", 3]] },
    { heading: "2. Methods", canonical: "methods", truth: [["method", 2]] },
    { heading: "2.1 Discussion of the samples", canonical: "discussion", truth: [["method", 2]] },
    { heading: "2.2 Probes", canonical: "body", truth: [["method", 2]] },
    { heading: "3. EXPERIMENTAL SECTION", canonical: "methods", truth: [] },
    { heading: "3.1 Materials", canonical: "body", truth: [["method", 3]] },
    { heading: "4. Results", canonical: "results", truth: [["evidence", 3]] },
  ]);
  const nestedDraft = draftOf(NESTED.input)!;
  const nestedReview = {
    // The experimental part (paragraphs 3-11, one run of method) is evidence, says the review.
    corrections: [{ op: "set_role", part: 1, role: "evidence" }] as Correction[],
    unsure: [],
    draftDigest: nestedDraft.digest,
  };

  it("gives a top-level row, a group heading and a sub-row that names no role the part's new role", () => {
    const shown = applyStructureReview(NESTED.map, nestedDraft, nestedReview);
    const roles = Object.fromEntries(shown.sections.map((row) => [row.heading.slice(0, 3), row.role]));

    expect(roles["2. "]).toBe("evidence");
    expect(roles["2.2"]).toBe("evidence");
    expect(roles["3. "]).toBe("evidence");
    expect(roles["3.1"]).toBe("evidence");
    expect(roles["4. "]).toBe("evidence");
  });

  it("keeps the role a sub-row's own heading names", () => {
    const shown = applyStructureReview(NESTED.map, nestedDraft, nestedReview);

    expect(NESTED.map.sections[2].role).toBe("interpretation");
    expect(shown.sections[2]).toBe(NESTED.map.sections[2]);
  });

  it("keeps the ids of the rows the partition made, and changes their roles like any row's", () => {
    const paper = inventedPaper([
      { heading: "A Survey of Shore Ecology", canonical: "body", truth: [["setup", 6], ["evidence", 14], ["interpretation", 7], ["interpretation", 3]] },
      { heading: "Methods", canonical: "methods", truth: [["method", 4]] },
    ]);
    const partition: GuidePartition = {
      sectionId: "s1",
      parts: [
        { role: "introduction", fromParagraph: 0, toParagraph: 5 },
        { role: "results", fromParagraph: 6, toParagraph: 19 },
        { role: "discussion", fromParagraph: 20, toParagraph: 26 },
        { role: "conclusion", fromParagraph: 27, toParagraph: 29 },
      ],
    };
    const body = paper.doc.sections.map((s) => ({ id: s.id, canonical: s.canonical, paragraphs: s.text.split("\n\n") }));
    const overlay = partitionedMap(paper.map, body, partition);
    const d = draftOf(paper.input)!;

    expect(overlay.sections.map((row) => row.id)).toEqual(["s1~0", "s1~1", "s1~2", "s1~3", "s2"]);
    // The rules' draft is one unsure part for the whole unheaded text; the review says the whole of it is evidence.
    expect(d.parts[0]).toMatchObject({ from: 0, to: 29, role: "setup", conf: "low" });
    const shown = applyStructureReview(overlay, d, { corrections: [{ op: "set_role", part: 0, role: "evidence" }], unsure: [], draftDigest: d.digest });

    expect(shown.sections.map((row) => row.id)).toEqual(["s1~0", "s1~1", "s1~2", "s1~3", "s2"]);
    expect(shown.sections.map((row) => row.role)).toEqual(["evidence", "evidence", "evidence", "evidence", "method"]);
    // The group rows keep their record of where they stand, and the row the review left alone is the same object.
    expect(partOf(shown.sections[0])).toEqual(partOf(overlay.sections[0]));
    expect(shown.sections[4]).toBe(overlay.sections[4]);
  });
});
