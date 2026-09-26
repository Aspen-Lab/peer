import { describe, expect, it } from "vitest";
import type { WorkEntry } from "@/lib/scoring/channel-comparison";
import {
  buildBlindedSheet,
  ingestLabels,
  computeChannelMetrics,
  type WorkDetails,
} from "./blinded-sheet";

const KNOWN_CHANNEL_NAMES = [
  "s2-keyword",
  "openalex-keyword",
  "openalex-semantic",
  "openalex-topic",
  "s2-seed",
  "openalex-seed-similarity",
  "openalex-citations",
];

function work(key: string, channels: string[], rank = 1): WorkEntry {
  return {
    key,
    channels,
    contributions: channels.map((c) => ({ channel: c, rank })),
  };
}

function fixtureWorks(): WorkEntry[] {
  const works: WorkEntry[] = [];
  for (let i = 0; i < 6; i++) works.push(work(`doi:10.1/s2-only-${i}`, ["s2-keyword"]));
  for (let i = 0; i < 6; i++) works.push(work(`doi:10.2/oa-only-${i}`, ["openalex-keyword"]));
  for (let i = 0; i < 6; i++)
    works.push(work(`doi:10.3/both-${i}`, ["openalex-keyword", "s2-keyword"]));
  for (let i = 0; i < 4; i++) works.push(work(`doi:10.4/semantic-${i}`, ["openalex-semantic"]));
  return works;
}

// Deliberately channel-agnostic titles: the fixture itself must not mention
// a channel/provider name anywhere, or the "no leak" test below would be
// checking its own fixture text instead of `buildBlindedSheet`'s actual
// output contract (SheetRow has no `channels` field at all).
function fixtureDetails(works: readonly WorkEntry[]): Map<string, WorkDetails> {
  const details = new Map<string, WorkDetails>();
  works.forEach((w, i) => {
    details.set(w.key, {
      title: `A study of test fixture behavior, part ${i}`,
      year: 2020 + (i % 5),
      venue: "Journal of Testing",
      doi: w.key.startsWith("doi:") ? w.key.slice(4) : undefined,
    });
  });
  return details;
}

describe("buildBlindedSheet", () => {
  it("never leaks a channel/provider name anywhere in the sheet's rows", () => {
    const works = fixtureWorks();
    const details = fixtureDetails(works);
    const { rows } = buildBlindedSheet(works, details, { seed: 42, sampleSize: 40 });

    const serialized = JSON.stringify(rows).toLowerCase();
    for (const name of KNOWN_CHANNEL_NAMES) {
      expect(serialized).not.toContain(name.toLowerCase());
    }
    // No abstracts either — rows only ever carry title/year/venue/doiUrl.
    for (const row of rows) {
      expect(Object.keys(row).sort()).toEqual(
        ["doiUrl", "itemId", "title", "venue", "year"].sort(),
      );
    }
  });

  it("produces byte-identical output for the same (works, details, seed)", () => {
    const works = fixtureWorks();
    const details = fixtureDetails(works);
    const first = buildBlindedSheet(works, details, { seed: 7, sampleSize: 10 });
    const second = buildBlindedSheet(works, details, { seed: 7, sampleSize: 10 });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("produces a different order for a different seed", () => {
    const works = fixtureWorks();
    const details = fixtureDetails(works);
    const a = buildBlindedSheet(works, details, { seed: 1, sampleSize: 22 });
    const b = buildBlindedSheet(works, details, { seed: 2, sampleSize: 22 });
    expect(JSON.stringify(a.rows.map((r) => r.title))).not.toBe(
      JSON.stringify(b.rows.map((r) => r.title)),
    );
  });

  it("samples across every channel bucket rather than letting one prolific channel dominate", () => {
    const works = fixtureWorks(); // 6 s2-only + 6 oa-only + 6 both + 4 semantic = 22
    const details = fixtureDetails(works);
    const { rows, keyByItemId } = buildBlindedSheet(works, details, {
      seed: 3,
      sampleSize: 22,
    });
    expect(rows).toHaveLength(22);
    // Every distinct bucket contributed at least one item to the sample.
    const sampledKeys = new Set(Object.values(keyByItemId));
    const s2OnlyCount = works.filter(
      (w) => w.channels.length === 1 && w.channels[0] === "s2-keyword" && sampledKeys.has(w.key),
    ).length;
    const semanticCount = works.filter(
      (w) => w.channels[0] === "openalex-semantic" && sampledKeys.has(w.key),
    ).length;
    expect(s2OnlyCount).toBeGreaterThan(0);
    expect(semanticCount).toBeGreaterThan(0);
  });

  it("caps the sample at sampleSize even with a larger candidate pool", () => {
    const works = fixtureWorks();
    const details = fixtureDetails(works);
    const { rows } = buildBlindedSheet(works, details, { seed: 5, sampleSize: 5 });
    expect(rows).toHaveLength(5);
  });
});

// LIVE-EVAL-4-FIX (ABC-JEV-INTEGRATION.md §1w AMENDMENT) — the live run found
// every OpenAlex-sourced work's doiUrl double-prefixed
// ("https://doi.org/https://doi.org/10...."), because OpenAlex's own `doi`
// field is already a full URL while S2's is a bare DOI, and the old row
// builder assumed the latter unconditionally. These fixtures use REAL DOI
// shapes (unlike `fixtureDetails` above, whose short fake DOIs are only
// meant to be unique keys, not valid CrossRef shapes) so they exercise the
// same normalization `normalizeDoi` applies everywhere else in this
// codebase.
describe("buildBlindedSheet doiUrl normalization (LIVE-EVAL-4-FIX)", () => {
  function singleWorkSheet(doi: string | undefined) {
    const w = work("doi:10.1000/only", ["s2-keyword"]);
    const details = new Map<string, WorkDetails>([
      [w.key, { title: "A DOI-normalization fixture", year: 2021, venue: "Journal of Testing", doi }],
    ]);
    return buildBlindedSheet([w], details, { seed: 1, sampleSize: 1 });
  }

  it("strips OpenAlex's own full-URL DOI form (https://doi.org/...) down to https://doi.org/<bare doi>, not double-prefixed", () => {
    const { rows } = singleWorkSheet("https://doi.org/10.1038/s41586-020-2649-2");
    expect(rows[0].doiUrl).toBe("https://doi.org/10.1038/s41586-020-2649-2");
  });

  it("leaves an already-bare DOI (S2's own shape) as https://doi.org/<bare doi>", () => {
    const { rows } = singleWorkSheet("10.1038/nature12373");
    expect(rows[0].doiUrl).toBe("https://doi.org/10.1038/nature12373");
  });

  it("strips an http://dx.doi.org/ DOI down to https://doi.org/<bare doi>", () => {
    const { rows } = singleWorkSheet("http://dx.doi.org/10.1021/cm901452z");
    expect(rows[0].doiUrl).toBe("https://doi.org/10.1021/cm901452z");
  });

  it("strips a doi.org prefix case-insensitively", () => {
    const { rows } = singleWorkSheet("HTTPS://DOI.ORG/10.1038/s41586-020-2649-2");
    expect(rows[0].doiUrl).toBe("https://doi.org/10.1038/s41586-020-2649-2");
  });

  it("produces no link at all when there is no DOI", () => {
    const { rows } = singleWorkSheet(undefined);
    expect(rows[0].doiUrl).toBeUndefined();
  });
});

describe("ingestLabels", () => {
  const keyByItemId = {
    "item-01": "doi:10.1/a",
    "item-02": "doi:10.1/b",
    "item-03": "doi:10.1/c",
    "item-04": "doi:10.1/d",
  };

  it("builds a RelevanceLabelMap and a graded Map<string, 0|1> from one yes/no answer", () => {
    const result = ingestLabels(keyByItemId, {
      "item-01": "relevant",
      "item-02": "not_relevant",
      "item-03": undefined,
      // item-04 intentionally missing from the filled sheet.
    });

    expect(result.relevanceLabelMap).toEqual({
      "doi:10.1/a": true,
      "doi:10.1/b": false,
    });
    expect(result.gradedLabels).toEqual(
      new Map([
        ["doi:10.1/a", 1],
        ["doi:10.1/b", 0],
      ]),
    );
    expect(result.unlabeledItemIds.sort()).toEqual(["item-03", "item-04"]);
  });

  it("treats 'unsure' as unlabeled, never as a silent 'not relevant'", () => {
    const result = ingestLabels(keyByItemId, {
      "item-01": "unsure",
    });
    expect(result.relevanceLabelMap["doi:10.1/a"]).toBeUndefined();
    expect(result.gradedLabels.has("doi:10.1/a")).toBe(false);
    expect(result.unlabeledItemIds).toContain("item-01");
  });

  it("a completely empty filled sheet marks every item unlabeled", () => {
    const result = ingestLabels(keyByItemId, {});
    expect(result.relevanceLabelMap).toEqual({});
    expect(result.gradedLabels.size).toBe(0);
    expect(result.unlabeledItemIds).toHaveLength(4);
  });
});

describe("computeChannelMetrics", () => {
  it("computes precision@10 and recall-in-judged-set per channel from hand-computable fixtures", () => {
    const rankedKeysByChannel = new Map<string, string[]>([
      ["s2-keyword", ["a", "b", "x", "y", "c"]],
      ["openalex-keyword", ["a", "x", "b", "y", "y2"]],
    ]);
    // 3 judged-relevant total: a, b, c. x/y/y2 are judged not-relevant or unjudged.
    const gradedLabels = new Map<string, 0 | 1>([
      ["a", 1],
      ["b", 1],
      ["c", 1],
      ["x", 0],
    ]);

    const rows = computeChannelMetrics(rankedKeysByChannel, gradedLabels, 5);
    expect(rows.map((r) => r.channel)).toEqual(["openalex-keyword", "s2-keyword"]);

    const s2 = rows.find((r) => r.channel === "s2-keyword")!;
    // top-5 of s2-keyword: a(rel) b(rel) x(not) y(unjudged) c(rel) -> 3 relevant / 5
    expect(s2.precision.relevantCount).toBe(3);
    expect(s2.precision.precision).toBeCloseTo(3 / 5);
    expect(s2.precision.unjudgedCount).toBe(1); // "y"
    // recall denominator = 3 judged-relevant (a,b,c); s2-keyword retrieves all 3 somewhere in its ranking.
    expect(s2.recall.status).toBe("ok");
    if (s2.recall.status === "ok") {
      expect(s2.recall.totalJudgedRelevant).toBe(3);
      expect(s2.recall.relevantRetrieved).toBe(3);
      expect(s2.recall.recall).toBeCloseTo(1);
    }

    const oa = rows.find((r) => r.channel === "openalex-keyword")!;
    // top-5 of openalex-keyword: a(rel) x(not) b(rel) y(unjudged) y2(unjudged) -> 2 relevant / 5; never retrieves "c".
    expect(oa.precision.relevantCount).toBe(2);
    if (oa.recall.status === "ok") {
      expect(oa.recall.relevantRetrieved).toBe(2);
      expect(oa.recall.recall).toBeCloseTo(2 / 3);
    }
  });

  it("never returns an nDCG field — only precision and recall (§1w P5)", () => {
    const rows = computeChannelMetrics(
      new Map([["s2-keyword", ["a"]]]),
      new Map([["a", 1]]),
    );
    expect(Object.keys(rows[0]).sort()).toEqual(["channel", "precision", "recall"]);
  });
});
