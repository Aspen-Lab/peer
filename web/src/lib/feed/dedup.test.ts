import { describe, expect, it } from "vitest";
import { dedupItems } from "./dedup";
import { identityForRawItem } from "./paper-identity";
import type { RawItem, SourceId } from "@/lib/sources/types";

// P2-S1 (Round 3): dedup.ts correctness, per ABC-JEV-INTEGRATION.md §1p.A and
// docs/jev-abc/P2-B-20260924T0345Z.md's F-A-P2-01 guide. Today's `dedupItems`
// keys purely on the first 8 (length>2) title tokens, sorted — it silently
// drops one of two genuinely different papers whenever their titles happen
// to share that truncated token set. This file first reproduces that bug
// (scenario "a", asserted RED against the pre-fix implementation), then
// pins down the full replacement policy.

function item(overrides: Partial<RawItem> & { id: string; source: SourceId; title: string }): RawItem {
  return {
    authors: [],
    url: "https://example.com/paper",
    publishedAt: "",
    metadata: {},
    ...overrides,
  };
}

describe("dedupItems", () => {
  // (a) Two distinct papers — different DOI, year, first author — whose
  // titles collide under today's lossy 8-token key. Title B is Title A's
  // exact words plus more appended, so both share the same first-8-token set.
  it("keeps two distinct papers whose titles collide under the old truncated-token key", () => {
    const a = item({
      id: "openalex:W1",
      source: "openalex",
      title: "Advances In Battery Materials For Energy Storage Systems Design",
      publishedAt: "2019-03-01",
      authors: ["Alice Someone"],
      metadata: { doi: "10.1000/aaa-2019" },
    });
    const b = item({
      id: "semantic_scholar:S2B",
      source: "semantic_scholar",
      title:
        "Advances In Battery Materials For Energy Storage Systems Design Considerations And Future Directions",
      publishedAt: "2024-06-01",
      authors: ["Bob Nobody"],
      metadata: { doi: "10.1500/bbb-2024" },
    });

    const result = dedupItems([a, b]);
    const ids = result.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["openalex:W1", "semantic_scholar:S2B"]));
    expect(result).toHaveLength(2);
  });

  // (b) Same DOI (different formatting/case), two sources -> 1 survivor,
  // higher SOURCE_PRIORITY kept, loser recorded in metadata.mergedFrom.
  it("merges same-DOI items from two sources into the higher-priority survivor, keeping the loser's provenance", () => {
    const openalexItem = item({
      id: "openalex:W2",
      source: "openalex",
      title: "Neural Networks for Climate Modeling: A Survey",
      publishedAt: "2023-01-01",
      authors: ["Carla Lee"],
      metadata: { doi: "10.9999/shared" },
    });
    const s2Item = item({
      id: "semantic_scholar:S2C",
      source: "semantic_scholar",
      title: "Neural networks for climate modeling — a survey (extended version)",
      publishedAt: "2023-01-15",
      authors: ["Carla Lee"],
      metadata: { doi: "10.9999/SHARED" },
    });

    const result = dedupItems([openalexItem, s2Item]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("semantic_scholar"); // SOURCE_PRIORITY: semantic_scholar(5) > openalex(3)
    expect(result[0].metadata.mergedFrom).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "openalex", id: "openalex:W2" })]),
    );
  });

  // (c) Identical title, year gap > 1, different author -> 2 (no false merge).
  it("keeps two items with identical titles apart when the year gap exceeds 1", () => {
    const older = item({
      id: "dblp:x/1",
      source: "dblp",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
      publishedAt: "2015-01-01",
      authors: ["Carol First"],
    });
    const newer = item({
      id: "openalex:W3",
      source: "openalex",
      title: "Comprehensive Review Of Battery Degradation Mechanisms",
      publishedAt: "2023-01-01",
      authors: ["David Second"],
    });

    const result = dedupItems([older, newer]);
    expect(result).toHaveLength(2);
  });

  // (d) Preprint vs published, different DOIs, same title -> 2, documented.
  // §1p.A's accepted cost: this pair survives as two pool entries; P4's
  // delivery exclusion (not dedupe) is what later recognizes them as the
  // same work via the shared title alias, per the deliberately asymmetric
  // isDeliveredIdentity rule in canonical-identity.ts.
  it("keeps a preprint and its published version apart when their DOIs differ, even with the same title/year/author", () => {
    const preprint = item({
      id: "arxiv:2409.11111",
      source: "arxiv",
      title: "Efficient Transformer Architectures For Long Context Reasoning",
      publishedAt: "2024-05-01",
      authors: ["Eve Third"],
      metadata: { doi: "10.48550/arxiv.2409.11111" },
    });
    const published = item({
      id: "openalex:W4",
      source: "openalex",
      title: "Efficient Transformer Architectures For Long Context Reasoning",
      publishedAt: "2024-09-01",
      authors: ["Eve Third"],
      metadata: { doi: "10.1109/tpami.2024.123456" },
    });

    const result = dedupItems([preprint, published]);
    expect(result).toHaveLength(2);
  });

  // (e) Empty/unkeyable title kept unconditionally — never silently dropped.
  it("keeps items with empty or whitespace-only titles unconditionally", () => {
    const empty = item({ id: "web:1", source: "web", title: "" });
    const whitespace = item({ id: "hn:2", source: "hn", title: "   " });

    const result = dedupItems([empty, whitespace]);
    const ids = result.map((r) => r.id);
    expect(ids).toEqual(expect.arrayContaining(["web:1", "hn:2"]));
    expect(result).toHaveLength(2);
  });

  // (f) Malformed DOI falls through to the title tier — never dropped.
  it("never drops an item with a malformed DOI; it falls through to the title tier", () => {
    const malformed = item({
      id: "dblp:y/1",
      source: "dblp",
      title: "Formal Verification Of Distributed Consensus Protocols",
      publishedAt: "2021-01-01",
      authors: ["Frank Fourth"],
      metadata: { doi: "not-a-real-doi-format" },
    });
    const unrelated = item({
      id: "openalex:W5",
      source: "openalex",
      title: "Unrelated Paper About Something Completely Different",
      publishedAt: "2021-01-01",
      authors: ["Grace Other"],
    });

    const result = dedupItems([malformed, unrelated]);
    const ids = result.map((r) => r.id);
    expect(ids).toContain("dblp:y/1");
    expect(result).toHaveLength(2);
  });

  // Positive fallback case: normalized title + year(+-1) + first-author
  // surname DOES merge when neither side has any id-form key at all.
  it("merges via title+year+author fallback when neither item has an id-form key", () => {
    const dblpItem = item({
      id: "dblp:z/1",
      source: "dblp",
      title: "Scalable Graph Neural Networks For Molecular Property Prediction",
      publishedAt: "2022-01-01",
      authors: ["Grace Fifth"],
    });
    const openalexItem = item({
      id: "openalex:W6",
      source: "openalex",
      title: "Scalable Graph Neural Networks For Molecular Property Prediction",
      publishedAt: "2023-01-01",
      authors: ["Grace Fifth"],
    });

    const result = dedupItems([dblpItem, openalexItem]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("openalex"); // SOURCE_PRIORITY: openalex(3) > dblp(2)
    expect(result[0].metadata.mergedFrom).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "dblp", id: "dblp:z/1" })]),
    );
  });

  it("leaves a single unmatched item's metadata byte-identical (no mergedFrom added)", () => {
    const solo = item({
      id: "openalex:W7",
      source: "openalex",
      title: "A Perfectly Ordinary Standalone Paper About Nothing Else",
      publishedAt: "2024-01-01",
      authors: ["Henry Sixth"],
      metadata: { doi: "10.1000/solo" },
    });
    const result = dedupItems([solo]);
    expect(result).toEqual([solo]);
  });

  it("returns an empty array for an empty input without throwing", () => {
    expect(() => dedupItems([])).not.toThrow();
    expect(dedupItems([])).toEqual([]);
  });

  // ---------------------------------------------------------------------
  // P2-S1-FIX (Round 3, §1p.G): reproduction + regression tests for the
  // FAILED_REVIEW transitivity bug (docs/jev-abc/P2-S1-A-20260924T0438Z.md).
  // The 9 cases above were hand-traced against the new clustering algorithm
  // before any implementation code changed, and all 9 still pass unchanged
  // — none of them exercises 3+ items sharing a title/year/author bucket,
  // which is exactly where the old transitive union-find bug lived, so none
  // needed rewriting under the `// P2-S1-FIX (Round 3): ...` convention.
  // ---------------------------------------------------------------------

  // (a) The independent reviewer's exact reproduction (TRANSITIVITY CHECK):
  // two openalex items with different DOIs but identical title/year/author
  // (a real, direct conflict — correctly kept apart pairwise), bridged by a
  // third, ID-less dblp record that title/year/author-matches both. The old
  // union-find silently merged all 3 into 1, discarding one of A/C. Per
  // §1p.G(3): the weak-link component {A,B,C} contains a conflict (A and C
  // both carry a "doi" id-type, with different values) somewhere inside it,
  // so NO weak link in the component applies — all 3 stay separate.
  it("never puts two directly-conflicting DOIs in the same survivor even when a third ID-less record bridges them (the reviewer's A~B~C reproduction)", () => {
    const a = item({
      id: "openalex:WBRIDGE_A",
      source: "openalex",
      title: "Shared Title For Bridge Test Case Example Paper",
      publishedAt: "2020-01-01",
      authors: ["Smith Alpha"],
      metadata: { doi: "10.1111/aaa" },
    });
    const b = item({
      id: "dblp:bridge/1",
      source: "dblp",
      title: "Shared Title For Bridge Test Case Example Paper",
      publishedAt: "2020-01-01",
      authors: ["Smith Alpha"],
    });
    const c = item({
      id: "openalex:WBRIDGE_C",
      source: "openalex",
      title: "Shared Title For Bridge Test Case Example Paper",
      publishedAt: "2020-01-01",
      authors: ["Smith Alpha"],
      metadata: { doi: "10.2222/ccc" },
    });

    const result = dedupItems([a, b, c]);
    expect(result).toHaveLength(3);
    const ids = result.map((r) => r.id);
    expect(ids).toEqual(
      expect.arrayContaining(["openalex:WBRIDGE_A", "dblp:bridge/1", "openalex:WBRIDGE_C"]),
    );
    // No survivor's mergedFrom mixes A and C's ids together.
    for (const r of result) {
      const mergedIds = (r.metadata.mergedFrom ?? []).map((m) => m.id);
      const hasA = r.id === "openalex:WBRIDGE_A" || mergedIds.includes("openalex:WBRIDGE_A");
      const hasC = r.id === "openalex:WBRIDGE_C" || mergedIds.includes("openalex:WBRIDGE_C");
      expect(hasA && hasC).toBe(false);
    }
  });

  // (b) Same A, B, C inputs in every permutation -> identical output (as a
  // set of ids; §1p.G requires group membership be provably order-independent).
  it("produces the same set of survivor ids for every permutation of the A~B~C bridge inputs", () => {
    const a = item({
      id: "openalex:WPERM_A",
      source: "openalex",
      title: "Permutation Invariance Bridge Test Case Paper",
      publishedAt: "2021-01-01",
      authors: ["Nadia Perm"],
      metadata: { doi: "10.3333/perm-a" },
    });
    const b = item({
      id: "dblp:perm/1",
      source: "dblp",
      title: "Permutation Invariance Bridge Test Case Paper",
      publishedAt: "2021-01-01",
      authors: ["Nadia Perm"],
    });
    const c = item({
      id: "openalex:WPERM_C",
      source: "openalex",
      title: "Permutation Invariance Bridge Test Case Paper",
      publishedAt: "2021-01-01",
      authors: ["Nadia Perm"],
      metadata: { doi: "10.4444/perm-c" },
    });

    const orderings = permutations3(a, b, c);
    const signatures = orderings.map((ordered) => {
      const result = dedupItems(ordered);
      return result
        .map((r) => r.id)
        .sort()
        .join("|");
    });
    const distinct = new Set(signatures);
    expect(distinct.size).toBe(1);
    expect(signatures[0].split("|")).toHaveLength(3);
  });

  // (c) Preprint + published sharing an arXiv id but with different DOIs ->
  // 1 survivor (strong link wins, §1p.G(1)), and the survivor's
  // re-derivable identity (via identityForRawItem) includes both DOIs — one
  // as its own key, the other folded in via metadata.mergedAliases.
  it("merges a preprint and published version sharing an arXiv id despite different DOIs, keeping both DOIs re-derivable", () => {
    const preprint = item({
      id: "arxiv:2501.99999",
      source: "arxiv",
      title: "Shared Arxiv Id Bridge Work On Testing Methods",
      publishedAt: "2025-01-01",
      authors: ["Nora Fifth"],
      metadata: { doi: "10.48550/arxiv.2501.99999" },
    });
    const published = item({
      id: "openalex:WARXIVSHARE",
      source: "openalex",
      title: "Shared Arxiv Id Bridge Work On Testing Methods",
      publishedAt: "2025-06-01",
      authors: ["Nora Fifth"],
      metadata: {
        doi: "10.1234/published-version",
        externalIds: { arxivId: "2501.99999" },
      },
    });

    const result = dedupItems([preprint, published]);
    expect(result).toHaveLength(1);

    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(
      expect.arrayContaining(["doi:10.48550/arxiv.2501.99999", "doi:10.1234/published-version"]),
    );
  });

  // (d) Two conflicting DOIs, same title/year/author, no bridge record
  // present at all -> 2 (the simplest, 2-cluster shape of the conflict
  // rule, with no third record's connectivity to reason about).
  it("keeps two directly-conflicting-DOI items apart with no bridge record present", () => {
    const d1 = item({
      id: "openalex:WCONFLICT1",
      source: "openalex",
      title: "Direct Conflict Case Without Any Bridge Record Present",
      publishedAt: "2021-02-01",
      authors: ["Omar Bridge"],
      metadata: { doi: "10.5555/conflict-one" },
    });
    const d2 = item({
      id: "openalex:WCONFLICT2",
      source: "openalex",
      title: "Direct Conflict Case Without Any Bridge Record Present",
      publishedAt: "2021-02-01",
      authors: ["Omar Bridge"],
      metadata: { doi: "10.6666/conflict-two" },
    });

    const result = dedupItems([d1, d2]);
    expect(result).toHaveLength(2);
  });

  // (e) Conflict-free weak component of three (two with no id-form key at
  // all, one with a single DOI) -> 1 survivor. No id-TYPE is shared by any
  // pair in the component, so the merge is safe.
  it("merges a conflict-free weak component of three where only one member carries any id-form key", () => {
    const withDoi = item({
      id: "openalex:WTRIO1",
      source: "openalex",
      title: "Conflict Free Weak Component Of Three Items Case",
      publishedAt: "2022-03-01",
      authors: ["Priya Quinn"],
      metadata: { doi: "10.7777/trio-only-doi" },
    });
    const noId1 = item({
      id: "dblp:trio/1",
      source: "dblp",
      title: "Conflict Free Weak Component Of Three Items Case",
      publishedAt: "2022-03-01",
      authors: ["Priya Quinn"],
    });
    const noId2 = item({
      id: "web:trio2",
      source: "web",
      title: "Conflict Free Weak Component Of Three Items Case",
      publishedAt: "2022-03-01",
      authors: ["Priya Quinn"],
    });

    const result = dedupItems([withDoi, noId1, noId2]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("openalex");
    const mergedIds = (result[0].metadata.mergedFrom ?? []).map((m) => m.id);
    expect(mergedIds).toEqual(expect.arrayContaining(["dblp:trio/1", "web:trio2"]));
  });

  // (f) Survivor alias union: a DOI-triggered merge (not an
  // arXiv-id-triggered one) where the LOSER is arxiv-sourced -> the
  // survivor's re-derived identity (via identityForRawItem) includes the
  // loser's own arxiv:<id> alias, closing F-A-P2S1-02.
  it("folds an arxiv-sourced loser's own arxiv id into the survivor's re-derivable aliases after a DOI-triggered merge", () => {
    const s2Item = item({
      id: "semantic_scholar:S2ALIASF",
      source: "semantic_scholar",
      title: "Doi Shared Merge With Arxiv Sourced Loser Alias Case",
      publishedAt: "2023-02-01",
      authors: ["Yusuf Delta"],
      metadata: { doi: "10.8888/shared-doi-case" },
    });
    const arxivItem = item({
      id: "arxiv:2302.54321",
      source: "arxiv",
      title: "Doi Shared Merge With Arxiv Sourced Loser Alias Case",
      publishedAt: "2023-02-01",
      authors: ["Yusuf Delta"],
      metadata: { doi: "10.8888/shared-doi-case" },
    });

    const result = dedupItems([s2Item, arxivItem]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("semantic_scholar"); // priority 5 > arxiv's 4

    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toContain("arxiv:2302.54321");
  });

  // (g) Same-priority tie (dblp weight 2 vs pubmed weight 2) via a weak
  // (title+year+author) merge -> deterministic survivor regardless of input
  // order, closing F-A-P2S1-04 (the old code kept whichever item appeared
  // first in the array).
  it("picks the same survivor for a same-priority dblp-vs-pubmed tie regardless of input order", () => {
    const pubmedItem = item({
      id: "pubmed:111",
      source: "pubmed",
      title: "Same Priority Order Independence Regression Case Paper",
      publishedAt: "2020-04-01",
      authors: ["Xavier Seventh"],
    });
    const dblpItem = item({
      id: "dblp:222",
      source: "dblp",
      title: "Same Priority Order Independence Regression Case Paper",
      publishedAt: "2020-04-01",
      authors: ["Xavier Seventh"],
    });

    const forward = dedupItems([pubmedItem, dblpItem]);
    const backward = dedupItems([dblpItem, pubmedItem]);

    expect(forward).toHaveLength(1);
    expect(backward).toHaveLength(1);
    expect(forward[0].id).toBe(backward[0].id);
    expect(forward[0].source).toBe("pubmed"); // pubmed carries its own pmid: key; dblp carries none
  });

  // (extra, beyond the manager's lettered list but part of §1p.G(4)): a
  // missing DOI on the survivor itself may be filled from a member only
  // when that member's DOI is the cluster's ONLY distinct DOI.
  it("backfills a missing DOI on the survivor from a member when the cluster carries exactly one distinct DOI", () => {
    const richer = item({
      id: "openalex:WFILL1",
      source: "openalex",
      title: "Doi Backfill From A Single Contributing Member Case Paper",
      publishedAt: "2021-03-01",
      authors: ["Petra Eighth"],
      metadata: { doi: "10.9990/only-doi-in-cluster" },
    });
    const survivorCandidate = item({
      id: "semantic_scholar:S2FILL2",
      source: "semantic_scholar", // higher priority -> wins survivor, but has no doi of its own
      title: "Doi Backfill From A Single Contributing Member Case Paper",
      publishedAt: "2021-03-01",
      authors: ["Petra Eighth"],
    });

    const result = dedupItems([richer, survivorCandidate]);
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("semantic_scholar");
    expect(result[0].metadata.doi).toBe("10.9990/only-doi-in-cluster");
  });

  // P2-S3 (Round 3): F-A-P2-03, ABC-JEV-INTEGRATION.md §1p.A/G — a merge
  // survivor must carry the UNION of every member's admission-channel tags,
  // the same way it already carries the union of their ID-form
  // keys/aliases (`metadata.mergedAliases`, above). Without this, a paper
  // found independently via a literal keyword match AND via the
  // citation-neighborhood channel would keep only whichever single
  // channel belonged to the item dedupe happened to pick as survivor,
  // silently losing the other's provenance.
  it("unions admissionChannels from every merged member onto the survivor", () => {
    const keywordFound = item({
      id: "openalex:union-keyword",
      source: "openalex",
      title: "Union Channel Test Paper",
      publishedAt: "2026-01-01",
      authors: ["Uma Nion"],
      metadata: { doi: "10.7777/union-channel-test" },
      admissionChannels: ["keyword"],
    });
    const citationFound = item({
      id: "semantic_scholar:union-citation",
      source: "semantic_scholar",
      title: "Union Channel Test Paper",
      publishedAt: "2026-01-01",
      authors: ["Uma Nion"],
      metadata: { doi: "10.7777/union-channel-test" },
      admissionChannels: ["citation"],
    });

    const result = dedupItems([keywordFound, citationFound]);
    expect(result).toHaveLength(1);
    expect([...(result[0].admissionChannels ?? [])].sort()).toEqual(["citation", "keyword"]);
  });

  it("leaves admissionChannels unset on a merge where no member carried one", () => {
    const a = item({
      id: "openalex:no-channel-a",
      source: "openalex",
      title: "Plain Merge Without Any Channel Tag",
      publishedAt: "2026-01-01",
      authors: ["Nadia Chan"],
      metadata: { doi: "10.7778/no-channel-test" },
    });
    const b = item({
      id: "semantic_scholar:no-channel-b",
      source: "semantic_scholar",
      title: "Plain Merge Without Any Channel Tag",
      publishedAt: "2026-01-01",
      authors: ["Nadia Chan"],
      metadata: { doi: "10.7778/no-channel-test" },
    });

    const result = dedupItems([a, b]);
    expect(result).toHaveLength(1);
    expect(result[0].admissionChannels).toBeUndefined();
  });
});

function permutations3<T>(a: T, b: T, c: T): T[][] {
  return [
    [a, b, c],
    [a, c, b],
    [b, a, c],
    [b, c, a],
    [c, a, b],
    [c, b, a],
  ];
}
