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

  // DEDUP-FIX (version rule, ABC-JEV-INTEGRATION.md §4 Round 3 "manager
  // smoke check... version rule ruled", 2026-09-24T20:30:13Z, revising
  // §1p.A(1)/§1p.G(2)) — a direct test for the exported clustering function,
  // mirroring dedup.test.ts's own bridge reproduction but calling
  // clusterCanonicalWorks directly (no RawItem/dedup.ts plumbing at all).
  // This test used to assert 3 singleton groups: A and C's differing DOIs
  // (both real id-form keys of type "doi") were a genuine conflict that
  // blocked the whole weak-linked component from merging. Per the version
  // rule, a DOI mismatch alone is no longer a conflict once
  // title+alias+author+year already match: A, B and C are versions of one
  // work and collapse into a single group.
  it("collapses a same-title/year/author bridge component with two different DOIs into ONE group (version rule; the reviewer's A~B~C case, called directly)", () => {
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
    expect(groups).toHaveLength(1);
    // Every index appears in exactly the one group.
    const flat = groups[0].slice().sort();
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

  // ---------------------------------------------------------------------
  // DEDUP-FIX2 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh
  // A: FAILED_REVIEW... narrowed conflict rule ruled", 2026-09-24T21:21:36Z)
  // — direct clusterCanonicalWorks-level mirrors of dedup.test.ts's own
  // chain/hub reproductions, independent of dedup.ts's RawItem/survivor
  // plumbing. See dedup.test.ts for the full reasoning.
  //
  // DEDUP-FIX3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2 fresh
  // A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole stop;
  // structural pairwise rule ruled; DEDUP-FIX3 C assigned", 2026-09-24T22:
  // 06:02Z) replaced the id-type-based `pairConflicts`/`clustersConflict`
  // this comment used to describe with an ids-play-no-part pairwise rule: a
  // weak-linked component collapses only if EVERY pair of records drawn
  // from different pass-1 clusters directly satisfies `weakPairMatch`. The
  // two tests below keep their DEDUP-FIX2 titles (same shapes, same
  // asserted outcome) but their body comments now describe the actual
  // mechanism; new DEDUP-FIX3-tagged tests further below cover the shapes
  // (zero-id, mixed-id-type) the id-type mechanism could not see, plus a
  // false-split guard and a permutation check.
  // ---------------------------------------------------------------------

  it("does NOT collapse a transitive-only chain whose two ID-bearing ends are more than 1 year apart (DEDUP-FIX2; direct)", () => {
    const a = work(
      { source: "openalex", id: "openalex:CWCHAIN_A", doi: "10.9110/chain-x", title: "Direct Chain Reproduction Case For The Narrowed Conflict Rule" },
      2020,
      "reviewer",
    );
    const b = work(
      { source: "dblp", id: "dblp:cwchain/1", title: "Direct Chain Reproduction Case For The Narrowed Conflict Rule" },
      2021,
      "reviewer",
    );
    const c = work(
      { source: "openalex", id: "openalex:CWCHAIN_C", doi: "10.9110/chain-z", title: "Direct Chain Reproduction Case For The Narrowed Conflict Rule" },
      2022,
      "reviewer",
    );

    const groups = clusterCanonicalWorks([a, b, c]);
    expect(groups).toHaveLength(3);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 1]);
  });

  it("keeps an unrelated record separate from a strong-link cluster it only matches through one member (DEDUP-FIX2; hub fixture, direct)", () => {
    const p1 = work(
      { source: "openalex", id: "openalex:CWHUB_P1", doi: "10.9210/hub-shared", title: "Direct Hub Hazard Case One For The Narrowed Conflict Rule" },
      2023,
      "match",
    );
    const p2 = work(
      { source: "openalex", id: "openalex:CWHUB_P2", doi: "10.9210/hub-shared", title: "Completely Unrelated Retitled Direct Hub Paper" },
      2023,
      "other",
    );
    const z = work(
      { source: "openalex", id: "openalex:CWHUB_Z", doi: "10.9210/hub-independent-z", title: "Direct Hub Hazard Case One For The Narrowed Conflict Rule" },
      2023,
      "match",
    );

    const groups = clusterCanonicalWorks([p1, p2, z]);
    expect(groups).toHaveLength(2);
    const groupSizes = groups.map((g) => g.length).sort();
    expect(groupSizes).toEqual([1, 2]);
    // The size-2 group is exactly {p1, p2} (indices 0, 1); z (index 2) is alone.
    const pairGroup = groups.find((g) => g.length === 2)!;
    expect(pairGroup.slice().sort()).toEqual([0, 1]);
    const soloGroup = groups.find((g) => g.length === 1)!;
    expect(soloGroup).toEqual([2]);
  });

  // ---------------------------------------------------------------------
  // DEDUP-FIX3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2
  // fresh A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole
  // stop; structural pairwise rule ruled; DEDUP-FIX3 C assigned",
  // 2026-09-24T22:06:02Z) — direct clusterCanonicalWorks-level mirrors of
  // dedup.test.ts's own DEDUP-FIX3 shapes (zero-id chain, zero-id hub,
  // mixed-id-type hub, false-split guard), independent of dedup.ts's
  // RawItem/survivor plumbing. See dedup.test.ts for the full reasoning.
  // ---------------------------------------------------------------------

  it("does NOT collapse a 5-hop chain spanning more than 1 total year when NO member carries any id-form key at all (DEDUP-FIX3; probe 2b, direct)", () => {
    const years = [2020, 2021, 2022, 2023, 2024];
    const versions = years.map((year) =>
      work(
        { source: "web", id: `web:idless-direct-${year}`, title: "Id Less Direct Five Hop Chain Case For The Pairwise Rule" },
        year,
        "directreviewer",
      ),
    );

    const groups = clusterCanonicalWorks(versions);
    expect(groups).toHaveLength(5);
    expect(groups.map((g) => g.length).sort()).toEqual([1, 1, 1, 1, 1]);
  });

  it("keeps an unrelated cluster separate from a strong-link cluster it only matches through one member, when that cluster carries NO id and when it carries a DIFFERENT id type (DEDUP-FIX3; probes 3b/3c, direct)", () => {
    const p1 = work(
      { source: "openalex", id: "openalex:CWMIXHUB_P1", doi: "10.9260/direct-hub-shared", title: "Direct Mixed Hub Hazard Case For The Pairwise Rule" },
      2023,
      "directmatch",
    );
    const p2 = work(
      { source: "openalex", id: "openalex:CWMIXHUB_P2", doi: "10.9260/direct-hub-shared", title: "Completely Unrelated Direct Hub Paper Title" },
      2023,
      "directother",
    );
    // noIdZ: no id-form key at all (probe 3b).
    const noIdZ = work({ source: "web", id: "web:direct-hub-noid-z", title: "Direct Mixed Hub Hazard Case For The Pairwise Rule" }, 2023, "directmatch");
    // mixedIdZ: a real id, but of a DIFFERENT type (arxiv) than p1/p2's shared "doi" (probe 3c).
    const mixedIdZ = work(
      { source: "arxiv", id: "arxiv:9999.00001", title: "Direct Mixed Hub Hazard Case For The Pairwise Rule" },
      2023,
      "directmatch",
    );

    for (const z of [noIdZ, mixedIdZ]) {
      const groups = clusterCanonicalWorks([p1, p2, z]);
      expect(groups).toHaveLength(2);
      const groupSizes = groups.map((g) => g.length).sort();
      expect(groupSizes).toEqual([1, 2]);
      const pairGroup = groups.find((g) => g.length === 2)!;
      expect(pairGroup.slice().sort()).toEqual([0, 1]);
      const soloGroup = groups.find((g) => g.length === 1)!;
      expect(soloGroup).toEqual([2]);
    }
  });

  it("collapses a strong-link cluster into a weak-linked version when EVERY member of the cluster directly matches it (DEDUP-FIX3; false-split guard, direct)", () => {
    const p1 = work(
      { source: "openalex", id: "openalex:CWGUARD_P1", doi: "10.9270/direct-guard-shared", title: "Direct Consistent Multi Member Match Guard Case" },
      2023,
      "guardauthor",
    );
    const p2 = work(
      { source: "dblp", id: "dblp:direct-guard-p2", doi: "10.9270/direct-guard-shared", title: "Direct Consistent Multi Member Match Guard Case" },
      2023,
      "guardauthor",
    );
    const z = work(
      { source: "openalex", id: "openalex:CWGUARD_Z", doi: "10.9271/direct-guard-independent-z", title: "Direct Consistent Multi Member Match Guard Case" },
      2023,
      "guardauthor",
    );

    const groups = clusterCanonicalWorks([p1, p2, z]);
    expect(groups).toHaveLength(1);
    expect(groups[0].slice().sort()).toEqual([0, 1, 2]);
  });

  it("produces the same partition for every permutation of the zero-id 5-hop chain (DEDUP-FIX3; direct)", () => {
    const years = [2020, 2021, 2022, 2023, 2024];
    const inputs = years.map((year) =>
      work(
        { source: "web", id: `web:idless-perm-${year}`, title: "Id Less Direct Permutation Chain Case For The Pairwise Rule" },
        year,
        "permreviewer",
      ),
    );
    const orderings = [
      inputs,
      inputs.slice().reverse(),
      [inputs[2], inputs[0], inputs[4], inputs[1], inputs[3]],
      [inputs[4], inputs[3], inputs[2], inputs[1], inputs[0]],
    ];
    const signatures = orderings.map((order) => {
      const groups = clusterCanonicalWorks(order);
      const sizes = groups.map((g) => g.length).sort();
      return JSON.stringify(sizes);
    });
    // Every ordering must partition into 5 singleton groups.
    for (const sig of signatures) expect(sig).toBe(JSON.stringify([1, 1, 1, 1, 1]));
  });
});
