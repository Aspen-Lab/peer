import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { briefingTileLines, resolvePaperTileSummary } from "./tile-lines";

const paper = {
  summaryIntro:
    "First abstract sentence. Second abstract sentence. Third abstract sentence.",
  summaryResultDiscussion: "",
};

describe("resolvePaperTileSummary", () => {
  it("prefers the stored digest sentence", () => {
    expect(
      resolvePaperTileSummary(paper, "Digest sentence for this paper."),
    ).toBe("Digest sentence for this paper.");
  });

  it("reads the whole abstract, not just its opening", () => {
    // The card used to render `summaryIntro` alone — the first one or two
    // sentences, which in an academic abstract is the motivation. Everything
    // that distinguished one paper from another sat unused in
    // `summaryResultDiscussion`.
    const summary = resolvePaperTileSummary({
      summaryIntro:
        "Protein structure prediction remains a grand challenge in computational biology.",
      summaryResultDiscussion:
        "We propose a graph neural network for inter-residue contacts. It reaches 94% precision on CASP14.",
    });

    expect(summary).not.toContain("grand challenge");
    expect(summary).toContain("We propose a graph neural network");
  });

  it("keeps a plain abstract readable when nothing looks like a claim", () => {
    expect(resolvePaperTileSummary(paper)).toBe(
      "First abstract sentence. Second abstract sentence.",
    );
  });

  it("says nothing when there is no abstract", () => {
    // It used to fall through to `relevanceReason`, which for a one-topic
    // reader is the same sentence on every paper of the day, and then to
    // "Open this paper for details.", which describes the link the reader is
    // already looking at.
    expect(
      resolvePaperTileSummary({ summaryIntro: " ", summaryResultDiscussion: "" }),
    ).toBeNull();
    expect(
      resolvePaperTileSummary({ summaryIntro: "", summaryResultDiscussion: "" }),
    ).toBeNull();
  });
});

function withLine(id: string, line: string): Paper {
  return {
    id,
    title: id,
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: line,
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    isSaved: false,
  } as Paper;
}

describe("briefingTileLines", () => {
  it("suppresses a sentence more than half the board is carrying", () => {
    // The live case: a one-topic reader, and the records with no abstract all
    // fell through to the same sentence. It is suppressed on EVERY card that
    // carries it — the first of three identical sentences is no more
    // informative than the third.
    const shared = "Matches your interest in machine learning.";
    const papers = [
      withLine("a", shared),
      withLine("b", shared),
      withLine("c", shared),
      withLine("d", "We reach 94% precision on CASP14."),
    ];
    const lines = briefingTileLines(papers, {});
    expect(lines.a).toBeNull();
    expect(lines.b).toBeNull();
    expect(lines.c).toBeNull();
    expect(lines.d).toContain("94% precision");
  });

  it("folds a trailing date clause, so the same sentence still matches", () => {
    // Go through the digest slot so the fixture is the exact string being
    // compared; the skim picker would otherwise re-split these first.
    const papers = ["a", "b", "c"].map((id) => withLine(id, ""));
    const lines = briefingTileLines(papers, {
      a: "Matches your interest in machine learning. today.",
      b: "Matches your interest in machine learning. 1 week ago.",
      c: "Matches your interest in machine learning. 10 days ago.",
    });
    expect([lines.a, lines.b, lines.c]).toEqual([null, null, null]);
  });

  it("leaves a two-topic board alone", () => {
    // Two clusters of five is the reason the threshold is half the board and
    // not "more than one" — a `> 1` rule would blank everything.
    const papers = [
      ...["a", "b", "c"].map((id) => withLine(id, "A sentence about batteries.")),
      ...["d", "e", "f"].map((id) => withLine(id, "A sentence about proteins.")),
    ];
    const lines = briefingTileLines(papers, {});
    expect(Object.values(lines).every((l) => l !== null)).toBe(true);
  });
});
