import { describe, expect, it } from "vitest";
import { clusterCanonicalWorks, identityForRawItem } from "./paper-identity";
import { canonicalPaperKey, type WorkMatchInput } from "@/lib/utils/canonical-identity";
import type { RawItem, SourceId } from "@/lib/sources/types";

// P2-S1-FIX (Round 3), per ABC-JEV-INTEGRATION.md §1p.G and the manager's
// mid-task addition: direct tests for both exports of this file, independent
// of dedup.ts's own RawItem-specific plumbing (survivor selection, mergedFrom,
// DOI backfill — covered in dedup.test.ts instead).

function item(overrides: Partial<RawItem> & { id: string; source: SourceId; title: string }): RawItem {
  return {
    authors: [],
    url: "https://example.com/paper",
    publishedAt: "",
    metadata: {},
    ...overrides,
  };
}

describe("identityForRawItem", () => {
  it("equals canonicalPaperKey's own output for a plain, never-merged item", () => {
    const plain = item({
      id: "openalex:WPI1",
      source: "openalex",
      title: "A Perfectly Ordinary Paper With No Merge History At All",
      metadata: { doi: "10.1000/plain-item-case" },
    });
    const expected = canonicalPaperKey({
      source: plain.source,
      id: plain.id,
      doi: plain.metadata?.doi,
      title: plain.title,
      externalIds: plain.metadata?.externalIds,
    });
    expect(identityForRawItem(plain)).toEqual(expected);
  });

  it("folds metadata.mergedAliases into the returned aliases, deduplicated and excluding the item's own key", () => {
    const merged = item({
      id: "semantic_scholar:S2PI",
      source: "semantic_scholar",
      title: "A Merged Survivor Carrying Aliases From Its Losers",
      metadata: {
        doi: "10.2000/survivor-doi",
        mergedAliases: [
          "doi:10.2000/survivor-doi", // duplicate of its own key -> must not double up
          "arxiv:2410.00001",
          "openalex:WLOSER",
        ],
      },
    });
    const identity = identityForRawItem(merged);
    expect(identity.key).toBe("doi:10.2000/survivor-doi");
    expect(identity.aliases).toEqual(expect.arrayContaining(["arxiv:2410.00001", "openalex:WLOSER"]));
    expect(identity.aliases.filter((a) => a === "doi:10.2000/survivor-doi")).toHaveLength(0);
  });

  it("returns an identity equivalent to canonicalPaperKey's own output when metadata.mergedAliases is absent or empty", () => {
    const noAliases = item({
      id: "arxiv:2410.99999",
      source: "arxiv",
      title: "No Merge Aliases Present On This Item At All",
    });
    const withEmpty = item({
      ...noAliases,
      metadata: { ...noAliases.metadata, mergedAliases: [] },
    });
    expect(identityForRawItem(noAliases)).toEqual(identityForRawItem(withEmpty));
    expect(identityForRawItem(noAliases)).toEqual(
      canonicalPaperKey({
        source: noAliases.source,
        id: noAliases.id,
        doi: noAliases.metadata?.doi,
        title: noAliases.title,
        externalIds: noAliases.metadata?.externalIds,
      }),
    );
  });
});

describe("clusterCanonicalWorks", () => {
  function work(
    input: Parameters<typeof canonicalPaperKey>[0],
    publishedYear: number,
    firstAuthorSurname: string,
  ): WorkMatchInput {
    return {
      identity: canonicalPaperKey(input),
      publishedYear,
      firstAuthorSurname,
    };
  }

  // Manager's mid-task addition: a direct test for the exported clustering
  // function, mirroring dedup.test.ts's own bridge reproduction but calling
  // clusterCanonicalWorks directly (no RawItem/dedup.ts plumbing at all).
  it("keeps a conflicting bridge component split into 3 singleton groups (the reviewer's A~B~C reproduction, called directly)", () => {
    const a = work(
      { source: "openalex", id: "openalex:CWA", doi: "10.1111/aaa", title: "Shared Title For Bridge Test Case Example" },
      2020,
      "alpha",
    );
    const b = work(
      { source: "dblp", id: "dblp:cw-bridge", title: "Shared Title For Bridge Test Case Example" },
      2020,
      "alpha",
    );
    const c = work(
      { source: "openalex", id: "openalex:CWC", doi: "10.2222/ccc", title: "Shared Title For Bridge Test Case Example" },
      2020,
      "alpha",
    );

    const groups = clusterCanonicalWorks([a, b, c]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 1]);
    // Every index appears in exactly one group.
    const flat = groups.flat().sort();
    expect(flat).toEqual([0, 1, 2]);
  });

  // Manager's mid-task addition: direct permutation-invariance test.
  it("produces the same partition (as sets of canonical keys) for every permutation of the bridge inputs", () => {
    const a = work(
      { source: "openalex", id: "openalex:CWA2", doi: "10.3333/aaa2", title: "Permutation Invariance Bridge Test Case Two" },
      2021,
      "beta",
    );
    const b = work(
      { source: "dblp", id: "dblp:cw-bridge-2", title: "Permutation Invariance Bridge Test Case Two" },
      2021,
      "beta",
    );
    const c = work(
      { source: "openalex", id: "openalex:CWC2", doi: "10.4444/ccc2", title: "Permutation Invariance Bridge Test Case Two" },
      2021,
      "beta",
    );

    const inputs = [a, b, c];
    const orderIndexes: [number, number, number][] = [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ];
    const signatures = orderIndexes.map((order) => {
      const permuted = order.map((i) => inputs[i]);
      const groups = clusterCanonicalWorks(permuted);
      const asKeySets = groups
        .map((g) => g.map((idx) => permuted[idx].identity.key).sort().join(","))
        .sort();
      return JSON.stringify(asKeySets);
    });
    const distinct = new Set(signatures);
    expect(distinct.size).toBe(1);
  });

  it("collapses a conflict-free weak-linked component into one group", () => {
    const withDoi = work(
      { source: "openalex", id: "openalex:CWTRIO1", doi: "10.7777/trio-only-doi", title: "Conflict Free Weak Component Direct Case" },
      2022,
      "quinn",
    );
    const noId1 = work({ source: "dblp", id: "dblp:cwtrio/1", title: "Conflict Free Weak Component Direct Case" }, 2022, "quinn");
    const noId2 = work({ source: "web", id: "web:cwtrio2", title: "Conflict Free Weak Component Direct Case" }, 2022, "quinn");

    const groups = clusterCanonicalWorks([withDoi, noId1, noId2]);
    expect(groups).toHaveLength(1);
    expect(groups[0].sort()).toEqual([0, 1, 2]);
  });

  it("returns an empty array for empty input without throwing", () => {
    expect(() => clusterCanonicalWorks([])).not.toThrow();
    expect(clusterCanonicalWorks([])).toEqual([]);
  });
});
