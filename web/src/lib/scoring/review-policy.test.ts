import { describe, expect, it } from "vitest";
import { isDirectProjectOrChallengeMatch, isReviewLike, shouldPushReviewPaper } from "./review-policy";
import type { RawItem } from "@/lib/sources/types";

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
// docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): `metadata.workType`
// was a dead field for every OpenAlex item Peer has ever fetched (every
// adapter fetched only the legacy `type_crossref`, which came back absent on
// every live-probed work), so `isReviewLike`'s `workType`-based branch
// (review-policy.ts) had never actually fired for an OpenAlex-sourced item in
// production — only its independent title/abstract/tag text-pattern branch
// ever ran. No dedicated test file existed for this module before now. These
// tests cover the revived `workType` branch directly (a `workType` containing
// "review" is detected; "article" is not) and pin the pre-existing
// text-pattern branch so both paths stay independently correct.

function item(overrides: Partial<RawItem> & { title: string }): RawItem {
  return {
    id: "openalex:W1",
    source: "openalex",
    authors: [],
    url: "https://example.com/paper",
    publishedAt: "",
    metadata: {},
    ...overrides,
  };
}

describe("isReviewLike — workType detection (DATASET-RECORDS, revived field)", () => {
  it('detects a "review"-typed item even with a bland title/abstract that matches no text pattern', () => {
    const paper = item({
      title: "Halide Solid Electrolytes For All-Solid-State Batteries",
      abstract: "We report new results on ionic transport in halide compounds.",
      metadata: { workType: "review" },
    });
    expect(isReviewLike(paper)).toBe(true);
  });

  it('does NOT detect an "article"-typed item with the same bland title/abstract', () => {
    const paper = item({
      title: "Halide Solid Electrolytes For All-Solid-State Batteries",
      abstract: "We report new results on ionic transport in halide compounds.",
      metadata: { workType: "article" },
    });
    expect(isReviewLike(paper)).toBe(false);
  });

  it('detects "systematic review" and other compound workType values via substring match, case-insensitively', () => {
    expect(
      isReviewLike(
        item({ title: "A Bland Title", metadata: { workType: "Systematic Review" } }),
      ),
    ).toBe(true);
    expect(
      isReviewLike(item({ title: "A Bland Title", metadata: { workType: "REVIEW" } })),
    ).toBe(true);
  });

  it("a workType with no relation to review (e.g. preprint, dataset, book-chapter) is not itself review-flagging", () => {
    for (const workType of ["preprint", "dataset", "book-chapter", "conference-paper"]) {
      expect(
        isReviewLike(item({ title: "A Bland Title With No Signal Words At All", metadata: { workType } })),
      ).toBe(false);
    }
  });

  it("falls back to the pre-existing text-pattern check when workType is absent (unchanged, protective)", () => {
    expect(
      isReviewLike(item({ title: "A Systematic Review of Battery Cathode Materials" })),
    ).toBe(true);
    expect(
      isReviewLike(item({ title: "A Bland Title With No Signal Words At All" })),
    ).toBe(false);
  });

  it("workType and text-pattern are independent — either alone is enough", () => {
    // workType says review, text does not.
    expect(
      isReviewLike(item({ title: "A Bland Title", metadata: { workType: "review" } })),
    ).toBe(true);
    // text says review, workType says article (workType never overrides a
    // genuine text match toward "not a review").
    expect(
      isReviewLike(
        item({ title: "A Survey of Recent Progress", metadata: { workType: "article" } }),
      ),
    ).toBe(true);
  });
});

describe("shouldPushReviewPaper — unaffected by the workType revival (policy unchanged: reviews still demoted, not excluded)", () => {
  it("a review-workType item without a matching project/challenge seed is still pushed down (not excluded outright)", () => {
    const paper = item({ title: "A Bland Title", metadata: { workType: "review" } });
    expect(shouldPushReviewPaper(paper, undefined)).toBe(false);
  });

  it("a review-workType item that directly matches the reader's own project text is still surfaced in full", () => {
    const seed = "solid-state battery electrolyte interface degradation mechanisms";
    const paper = item({
      title: "A Bland Title",
      abstract: seed,
      metadata: { workType: "review" },
    });
    expect(isDirectProjectOrChallengeMatch(paper, [seed])).toBe(true);
    expect(shouldPushReviewPaper(paper, [seed])).toBe(true);
  });

  it("a non-review item is always pushed regardless of seeds", () => {
    const paper = item({ title: "A Bland Title", metadata: { workType: "article" } });
    expect(shouldPushReviewPaper(paper, undefined)).toBe(true);
  });
});
