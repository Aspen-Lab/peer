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
//
// DEDUP-FIX (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "manager smoke
// check... version rule ruled", 2026-09-24T20:30:13Z, revising §1p.A(1)/
// §1p.G(2)): a production smoke check found real duplicate feed items —
// e.g. two Zenodo records of the same paper, one DOI per version. The
// ruling: two records with equal normalized full titles, a qualifying
// (>=4-token) title alias, the same first-author surname, and published
// years within +-1 are VERSIONS of one work and now merge even when their
// DOIs/native ids differ — a DOI/id mismatch alone is no longer a conflict.
// Tests below tagged `DEDUP-FIX` either rewrite a case that used to assert
// the old "DOI mismatch => keep both" outcome, or are new cases pinning the
// rule's boundaries (different author / short title / no authors still keep
// both; a version chain merges; shuffled order is unaffected).

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

  // (d) DEDUP-FIX (version rule): this test used to assert that a preprint
  // and its published version stayed 2 separate items whenever their DOIs
  // differed, even with the same title/year/author — the exact shape of the
  // production regression the ruling reproduces (repositories like Zenodo
  // mint a new DOI per version). Per the version rule, a DOI mismatch alone
  // is no longer a conflict once title+alias+author+year already match:
  // this pair is now a VERSION of one work and merges, with the survivor
  // carrying BOTH DOIs as re-derivable aliases (via identityForRawItem, the
  // same helper P4's delivery-exclusion path uses).
  it("merges a preprint and its published version sharing title/year/author despite different DOIs (version rule)", () => {
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
    expect(result).toHaveLength(1);
    expect(result[0].source).toBe("arxiv"); // SOURCE_PRIORITY: arxiv(4) > openalex(3)

    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(
      expect.arrayContaining(["doi:10.48550/arxiv.2409.11111", "doi:10.1109/tpami.2024.123456"]),
    );
  });

  // DEDUP-FIX (version rule) boundary case: same title/year, DIFFERENT
  // first-author surname, different DOIs -> stays 2. The version rule's
  // "same first-author surname" condition is not met, so this never reaches
  // even the now-conflict-free weak-link merge path.
  it("keeps two same-title/year items with different DOIs apart when the first-author surname differs (version rule boundary)", () => {
    const a = item({
      id: "openalex:WAUTHORDIFF1",
      source: "openalex",
      title: "Divergent Authorship Boundary Case For The Version Rule",
      publishedAt: "2022-05-01",
      authors: ["Irene First"],
      metadata: { doi: "10.7000/author-diff-one" },
    });
    const b = item({
      id: "openalex:WAUTHORDIFF2",
      source: "openalex",
      title: "Divergent Authorship Boundary Case For The Version Rule",
      publishedAt: "2022-05-01",
      authors: ["Jonas Second"],
      metadata: { doi: "10.7001/author-diff-two" },
    });

    const result = dedupItems([a, b]);
    expect(result).toHaveLength(2);
  });

  // DEDUP-FIX (version rule) boundary case: a short/generic title (no
  // qualifying title alias) never weak-links at all, so two different DOIs
  // stay 2 even with the same author/year — the ruling's own named
  // "short/generic title" exception.
  it("keeps two same-year/author items with different DOIs apart when the shared title is too short/generic to alias (version rule boundary)", () => {
    const a = item({
      id: "dblp:editorial1",
      source: "dblp",
      title: "Editorial",
      publishedAt: "2023-01-01",
      authors: ["Kim Editor"],
      metadata: { doi: "10.7100/editorial-one" },
    });
    const b = item({
      id: "openalex:WEDITORIAL2",
      source: "openalex",
      title: "Editorial",
      publishedAt: "2023-01-01",
      authors: ["Kim Editor"],
      metadata: { doi: "10.7101/editorial-two" },
    });

    const result = dedupItems([a, b]);
    expect(result).toHaveLength(2);
  });

  // DEDUP-FIX (version rule) boundary case: one side has NO authors at all
  // -> no first-author surname to match, so it never weak-links regardless
  // of title/year/DOI.
  it("keeps two same-title/year items with different DOIs apart when one side has no authors at all (version rule boundary)", () => {
    const withAuthor = item({
      id: "openalex:WNOAUTHOR1",
      source: "openalex",
      title: "Missing Author Boundary Case For The Version Rule Test",
      publishedAt: "2022-08-01",
      authors: ["Lena Third"],
      metadata: { doi: "10.7200/no-author-one" },
    });
    const noAuthor = item({
      id: "openalex:WNOAUTHOR2",
      source: "openalex",
      title: "Missing Author Boundary Case For The Version Rule Test",
      publishedAt: "2022-08-01",
      authors: [],
      metadata: { doi: "10.7201/no-author-two" },
    });

    const result = dedupItems([withAuthor, noAuthor]);
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
  // Several of the cases below WERE later rewritten under DEDUP-FIX (Round
  // 3, version rule) — see each one's own comment.
  // ---------------------------------------------------------------------

  // (a) DEDUP-FIX (version rule): the independent reviewer's original bridge
  // reproduction (TRANSITIVITY CHECK) — two openalex items with different
  // DOIs but identical title/year/author, bridged by a third, ID-less dblp
  // record that title/year/author-matches both. Before this fix, A and C's
  // differing DOIs were a genuine conflict that blocked the WHOLE
  // weak-linked component {A,B,C} from merging (all 3 kept separate — this
  // test used to assert exactly that). Per the version rule, a DOI mismatch
  // alone is no longer a conflict once title+alias+author+year already
  // match: A, B and C are all versions of the SAME work and merge into one
  // survivor, which carries every member's DOI as a re-derivable alias.
  it("merges two same-title/year/author items with different DOIs, plus their ID-less bridge record, into one survivor (version rule; the reviewer's A~B~C case)", () => {
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
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openalex:WBRIDGE_A"); // tie-break: same priority/idFormKeys count as C, smaller id wins
    const mergedIds = (result[0].metadata.mergedFrom ?? []).map((m) => m.id);
    expect(mergedIds).toEqual(expect.arrayContaining(["dblp:bridge/1", "openalex:WBRIDGE_C"]));

    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(expect.arrayContaining(["doi:10.1111/aaa", "doi:10.2222/ccc"]));
  });

  // (b) DEDUP-FIX (version rule): same A, B, C shape as above, in every
  // permutation -> now ONE merged survivor (not three separate items), and
  // that outcome is identical regardless of input order (§1p.G's
  // order-independence guarantee still holds after the version-rule fix).
  it("merges the A~B~C version trio into the same single survivor for every permutation of the inputs", () => {
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
    expect(signatures[0].split("|")).toHaveLength(1);
    expect(signatures[0]).toBe("openalex:WPERM_A");
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

  // (d) DEDUP-FIX (version rule): two items with the same title/year/author
  // but different DOIs, with NO bridge record present at all — the
  // simplest 2-cluster shape, and the closest direct reproduction of the
  // production regression (two Zenodo-style records, same title/author/
  // year, different DOIs AND different native/OpenAlex ids). This test used
  // to assert the old "DOI mismatch = conflict, keep both" rule; per the
  // version rule a DOI mismatch alone is no longer a conflict once
  // title+alias+author+year already match, so this pair merges into one
  // survivor carrying both DOIs as aliases.
  it("merges two same-title/year/author items with different DOIs and no bridge record (version rule; direct production-regression reproduction)", () => {
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
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("openalex:WCONFLICT1");
    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(
      expect.arrayContaining(["doi:10.5555/conflict-one", "doi:10.6666/conflict-two"]),
    );
  });

  // DEDUP-FIX (version rule): a three-version chain — v1, v2, v3 all share
  // the same title/first-author, each with its OWN distinct DOI (no
  // ID-less bridge record involved this time) -> 1 survivor carrying all
  // three DOIs as aliases, for every permutation of the input order.
  it("merges a three-version chain (v1/v2/v3, each with its own distinct DOI) into one survivor carrying all three DOIs, regardless of input order", () => {
    const v1 = item({
      id: "openalex:VCHAIN1",
      source: "openalex",
      title: "Three Version Chain Case For The Dedup Fix Version Rule",
      publishedAt: "2020-01-01",
      authors: ["Marco Chain"],
      metadata: { doi: "10.7300/chain-v1" },
    });
    const v2 = item({
      id: "openalex:VCHAIN2",
      source: "openalex",
      title: "Three Version Chain Case For The Dedup Fix Version Rule",
      publishedAt: "2020-06-01",
      authors: ["Marco Chain"],
      metadata: { doi: "10.7301/chain-v2" },
    });
    const v3 = item({
      id: "openalex:VCHAIN3",
      source: "openalex",
      title: "Three Version Chain Case For The Dedup Fix Version Rule",
      publishedAt: "2021-01-01",
      authors: ["Marco Chain"],
      metadata: { doi: "10.7302/chain-v3" },
    });

    for (const ordered of permutations3(v1, v2, v3)) {
      const result = dedupItems(ordered);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe("openalex:VCHAIN1"); // deterministic: same priority/idFormKeys count, smallest id wins
      const identity = identityForRawItem(result[0]);
      const allForms = [identity.key, ...identity.aliases];
      expect(allForms).toEqual(
        expect.arrayContaining(["doi:10.7300/chain-v1", "doi:10.7301/chain-v2", "doi:10.7302/chain-v3"]),
      );
    }
  });

  // ---------------------------------------------------------------------
  // DEDUP-FIX2 (Round 3, superseded by DEDUP-FIX3 below — kept for history,
  // ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh A: FAILED_REVIEW
  // (scoped...); narrowed conflict rule ruled; DEDUP-FIX2 C (+ R3-CLEANUP-3)
  // assigned", 2026-09-24T21:21:36Z): a fresh independent review of
  // DEDUP-FIX (docs/jev-abc/DEDUP-FIX-A-20260924T205613Z.md) found its full
  // removal of the id-type conflict check went wider than the version rule
  // intended, and narrowed it back in: two pass-1 clusters conflicted only
  // when some member-pair between them shared a real id-form TYPE with
  // differing values AND that SPECIFIC pair did not itself directly satisfy
  // the version rule (weakPairMatch).
  //
  // DEDUP-FIX3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2 fresh
  // A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole stop;
  // structural pairwise rule ruled; DEDUP-FIX3 C assigned", 2026-09-24T22:
  // 06:02Z): a SECOND fresh independent review
  // (docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md) found DEDUP-FIX2's
  // id-TYPE-comparison mechanism itself had a blind spot: it can only detect
  // a conflict when BOTH sides of the disputed pair carry a real id of the
  // SAME type. A record that only ever weak-links on title (no id at all,
  // or an id of a different type than the cluster it's disputing) got NO
  // protection — exactly the ordinary shape for something that only ever
  // matches by title in the first place. Two consecutive per-instance
  // patches for the same slot is this project's own stop signal for
  // whack-a-mole fixing, so the manager ruled a STRUCTURAL replacement
  // instead, independent of ids entirely: a weak-linked component of pass-1
  // clusters collapses into one group ONLY IF every pair of records drawn
  // from DIFFERENT pass-1 clusters in that component directly satisfies
  // `weakPairMatch` — checked over the FULL member cross-product of every
  // pair of clusters in the component (not just the pair that happened to
  // create a link). If even one cross-cluster pair fails, NO weak link in
  // the component is applied — every pass-1 cluster in it stays its own
  // separate group. Ids play no part in the decision at all (a DOI/id
  // mismatch between two records that themselves directly satisfy
  // `weakPairMatch` is still allowed — that's a genuine version pair).
  //
  // The four tests immediately below are still tagged DEDUP-FIX2 in their
  // titles because they reproduce DEDUP-FIX2-A's own named shapes and their
  // ASSERTED OUTCOME is unchanged by DEDUP-FIX3 (every fixture here happens
  // to give its conflicting/disputed member a real, same-type id, which is
  // exactly the coincidence DEDUP-FIX2-A's review caught — the new pairwise
  // rule reaches the identical verdict without ever consulting that id).
  // Their body comments below are rewritten to explain why under the actual
  // (ids-play-no-part) mechanism, not the superseded id-type one. The new
  // DEDUP-FIX3 section further below adds the shapes that DEDUP-FIX2 could
  // NOT see (zero-id chain, zero-id hub, mixed-id-type hub) plus
  // permutation and false-split-guard coverage.
  // ---------------------------------------------------------------------

  // DEDUP-FIX2/DEDUP-FIX3: the reviewer's own transitivity-chain
  // reproduction. A(2020) and C(2022) are the chain's two ends — 2 years
  // apart, so A and C do NOT themselves satisfy `weakPairMatch` (title+alias
  // +author match, but the year gap exceeds +-1), even though each is
  // exactly 1 year from the bridge B(2021). Under DEDUP-FIX3's pairwise
  // rule: the component {A, B, C} collapses only if EVERY cross-cluster
  // pair directly satisfies weakPairMatch — A-B and B-C do, but A-C does
  // not, so the whole component stays uncollapsed and A, B, C all stay
  // separate (the accepted "ambiguous weak component" cost, §1p.G(3)). This
  // holds regardless of whether A/C carry ids at all — see the zero-id
  // variant of this same shape in the DEDUP-FIX3 section below, which
  // DEDUP-FIX2's id-type mechanism could NOT catch but this one does.
  it("does NOT merge a transitive-only chain whose two ID-bearing ends are more than 1 year apart (DEDUP-FIX2; the reviewer's A~B~C chain)", () => {
    const a = item({
      id: "openalex:CHAINFAIL_A",
      source: "openalex",
      title: "Reviewer Chain Reproduction Case For The Narrowed Conflict Rule",
      publishedAt: "2020-01-01",
      authors: ["Chain Reviewer"],
      metadata: { doi: "10.9100/chain-x" },
    });
    const b = item({
      id: "dblp:chainfail/1",
      source: "dblp",
      title: "Reviewer Chain Reproduction Case For The Narrowed Conflict Rule",
      publishedAt: "2021-01-01",
      authors: ["Chain Reviewer"],
    });
    const c = item({
      id: "openalex:CHAINFAIL_C",
      source: "openalex",
      title: "Reviewer Chain Reproduction Case For The Narrowed Conflict Rule",
      publishedAt: "2022-01-01",
      authors: ["Chain Reviewer"],
      metadata: { doi: "10.9100/chain-z" },
    });

    const result = dedupItems([a, b, c]);
    expect(result).toHaveLength(3);
    expect(result.map((r) => r.id).sort()).toEqual([
      "dblp:chainfail/1",
      "openalex:CHAINFAIL_A",
      "openalex:CHAINFAIL_C",
    ]);
  });

  // DEDUP-FIX2/DEDUP-FIX3: a longer, 5-hop version of the same shape
  // (2020..2024, each ADJACENT pair exactly 1 year apart, but every
  // non-adjacent pair further apart), each with its own distinct DOI. Under
  // DEDUP-FIX3's pairwise rule, every non-adjacent cross-cluster pair (e.g.
  // v1-v3, v1-v5, v2-v5, ...) fails `weakPairMatch` on the year gap alone,
  // so the whole 5-cluster component never collapses and stays 5 separate
  // items — the DOIs here are along for the ride; see the zero-id variant
  // of this exact shape in the DEDUP-FIX3 section below, which fails
  // differently (silently merges to 1) under DEDUP-FIX2's superseded
  // id-type mechanism precisely because it has no ids to compare.
  it("does NOT merge a longer 5-hop chain spanning more than 1 total year, even though every adjacent pair is within 1 year (DEDUP-FIX2)", () => {
    const years = [2020, 2021, 2022, 2023, 2024];
    const versions = years.map((year, i) =>
      item({
        id: `openalex:HOP${i + 1}`,
        source: "openalex",
        title: "Five Hop Chain Reproduction Case For The Narrowed Conflict Rule",
        publishedAt: `${year}-01-01`,
        authors: ["Hop Reviewer"],
        metadata: { doi: `10.9101/hop-${i + 1}` },
      }),
    );

    const result = dedupItems(versions);
    expect(result).toHaveLength(5);
  });

  // DEDUP-FIX2/DEDUP-FIX3: the reviewer's own hub-cluster reproduction. P1
  // and P2 share one exact DOI (a metadata anomaly, but the clustering code
  // must still handle it safely) despite having completely unrelated
  // titles — pass 1 unions on exact id-form keys only, never title. Z
  // shares P1's title/year/author exactly (a weak link) but carries its OWN
  // different DOI and has nothing to do with P2's unrelated title. Under
  // DEDUP-FIX3's pairwise rule, the component {P1,P2}~Z has exactly one
  // cross-cluster cluster-pair to check ({P1,P2} vs {Z}), and that check
  // requires EVERY member pair to satisfy weakPairMatch: P1-Z does, but
  // P2-Z does not (different titles) — one failing pair is enough to block
  // the whole component, so {P1, P2} stay merged with each other (their own
  // strong DOI link, from pass 1, is unaffected by anything found in pass
  // 2) while Z stays its own separate item. Nothing about this reasoning
  // touches ids — see the zero-id and mismatched-id-type variants of this
  // exact shape in the DEDUP-FIX3 section below, which DEDUP-FIX2's
  // id-type mechanism could NOT catch but this one does, and the
  // false-split guard further below, which confirms the same mechanism
  // correctly ALLOWS the merge when P2 (not just P1) also matches Z.
  it("keeps an unrelated record separate from a strong-link cluster it only matches through one member (DEDUP-FIX2; hub fixture)", () => {
    const p1 = item({
      id: "openalex:HUB_P1",
      source: "openalex",
      title: "Hub Hazard Hidden Beneath A Shared Identifier Case One",
      publishedAt: "2023-01-01",
      authors: ["Hub Match"],
      metadata: { doi: "10.9200/hub-shared" },
    });
    const p2 = item({
      id: "openalex:HUB_P2",
      source: "openalex",
      title: "Completely Unrelated Retitled Paper About Something Else Entirely",
      publishedAt: "2023-01-01",
      authors: ["Someone Else"],
      metadata: { doi: "10.9200/hub-shared" }, // SAME DOI as p1 -> strong pass-1 link
    });
    const z = item({
      id: "openalex:HUB_Z",
      source: "openalex",
      title: "Hub Hazard Hidden Beneath A Shared Identifier Case One", // matches p1 only
      publishedAt: "2023-06-01",
      authors: ["Hub Match"],
      metadata: { doi: "10.9200/hub-independent-z" }, // its OWN, different DOI
    });

    const result = dedupItems([p1, p2, z]);
    expect(result).toHaveLength(2);

    const mergedSurvivor = result.find((r) => r.id === "openalex:HUB_P1");
    expect(mergedSurvivor).toBeDefined();
    const mergedIds = (mergedSurvivor!.metadata.mergedFrom ?? []).map((m) => m.id);
    expect(mergedIds).toContain("openalex:HUB_P2");
    expect(mergedIds).not.toContain("openalex:HUB_Z");

    const zStandalone = result.find((r) => r.id === "openalex:HUB_Z");
    expect(zStandalone).toBeDefined();
  });

  // DEDUP-FIX2/DEDUP-FIX3: pins the ruling's explicitly ACCEPTED COST (the
  // "recurring-title series" escape-clause candidate DEDUP-FIX-A's NEW
  // FINDING 3 raised) at its exact boundary — a direct 2-cluster pair (no
  // bridge record) with different DOIs, ONE YEAR apart (not the same year,
  // unlike every other direct-pair test above). Two distinct annual works
  // by the same author with an identical long title would ALSO match this
  // shape and be swept together; both the DEDUP-FIX2 and DEDUP-FIX3 rulings
  // explicitly accepted that cost rather than require a real disambiguating
  // signal (venue/DOI prefix), because with only 2 pass-1 clusters in the
  // component, "every cross-cluster pair" is just this one direct pair,
  // which already satisfies weakPairMatch by construction — DEDUP-FIX3's
  // own restated accepted cost: "same-author consecutive-year recurring
  // titles still merge (a direct pair)".
  it("merges a direct (no-bridge) pair one year apart with different DOIs — the accepted 'recurring annual work' cost, pinned at the +-1 boundary (DEDUP-FIX2)", () => {
    const x = item({
      id: "openalex:RECURRING_X",
      source: "openalex",
      title: "Annual Status Report On A Recurring Long Running Research Program",
      publishedAt: "2021-01-01",
      authors: ["Regular Author"],
      metadata: { doi: "10.9300/recurring-2021" },
    });
    const y = item({
      id: "openalex:RECURRING_Y",
      source: "openalex",
      title: "Annual Status Report On A Recurring Long Running Research Program",
      publishedAt: "2022-01-01",
      authors: ["Regular Author"],
      metadata: { doi: "10.9300/recurring-2022" },
    });

    const result = dedupItems([x, y]);
    expect(result).toHaveLength(1);
    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(
      expect.arrayContaining(["doi:10.9300/recurring-2021", "doi:10.9300/recurring-2022"]),
    );
  });

  // ---------------------------------------------------------------------
  // DEDUP-FIX3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2
  // fresh A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole
  // stop; structural pairwise rule ruled; DEDUP-FIX3 C assigned",
  // 2026-09-24T22:06:02Z): DEDUP-FIX2-A's own review
  // (docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md) found 3 concrete shapes
  // its id-type mechanism could not catch, all reproduced directly below:
  // a chain/hub whose disputed member carries no id at all, and a hub whose
  // disputed member carries an id of a DIFFERENT type than the cluster it's
  // disputing. The fix replaces id-type comparison entirely: a weak-linked
  // component collapses only if EVERY pair of records drawn from different
  // pass-1 clusters in it directly satisfies `weakPairMatch` — checked over
  // the full member cross-product of every pair of clusters in the
  // component. One failing cross-cluster pair blocks the WHOLE component.
  // ---------------------------------------------------------------------

  // DEDUP-FIX3 (probe 2b): the exact same 5-hop chain shape as the "5-hop
  // chain" test above, but with ZERO id-form keys anywhere — no source in
  // this fixture resolves a DOI/S2/OpenAlex/arXiv/PMID id at all, only a
  // shared title/author. DEDUP-FIX2's `pairConflicts` required BOTH sides
  // of a compared pair to carry a real id of the SAME type before it could
  // even ask whether they satisfied `weakPairMatch`; with zero ids
  // anywhere, every pair short-circuited to "no conflict," so the whole
  // chain collapsed to 1 survivor spanning 2020-2024 — silently merging 5
  // distinct papers. DEDUP-FIX3 never looks at ids: the non-adjacent pairs
  // (v1-v3, v1-v4, v1-v5, v2-v4, v2-v5, v3-v5) still fail `weakPairMatch` on
  // the year gap alone, so the chain correctly stays 5 separate items, id
  // or no id.
  it("does NOT merge a 5-hop chain spanning more than 1 total year when NO member carries any id-form key at all (DEDUP-FIX3; probe 2b)", () => {
    const years = [2020, 2021, 2022, 2023, 2024];
    const versions = years.map((year, i) =>
      item({
        id: `web:idless-hop-${i + 1}`,
        source: "web",
        title: "Id Less Five Hop Chain Reproduction Case For The Pairwise Rule",
        publishedAt: `${year}-01-01`,
        authors: ["Idless Reviewer"],
        // Deliberately no metadata.doi/externalIds anywhere in this fixture.
      }),
    );

    const result = dedupItems(versions);
    expect(result).toHaveLength(5);
    expect(new Set(result.map((r) => r.id)).size).toBe(5);
  });

  // DEDUP-FIX3 (probe 3b): the same hub shape as the "hub fixture" test
  // above (P1 and P2 share one exact DOI despite unrelated titles; Z
  // matches P1 only, by title/year/author), but Z carries NO id-form key AT
  // ALL. Under DEDUP-FIX2, `pairConflicts` returned false immediately
  // whenever either side had zero id-form types (`aTypes.size === 0`), so
  // P2-Z was never even evaluated as a conflict and all three swept into
  // one survivor. Under DEDUP-FIX3, the {P1,P2} vs {Z} cluster-pair check
  // still requires P2-Z to satisfy weakPairMatch (it does not — different
  // titles), so the component correctly stays split: {P1,P2} merged, Z
  // alone.
  it("keeps an unrelated record separate from a strong-link cluster it only matches through one member, when that record carries NO id at all (DEDUP-FIX3; probe 3b)", () => {
    const p1 = item({
      id: "openalex:IDLESSHUB_P1",
      source: "openalex",
      title: "Id Less Hub Hazard Case For The Pairwise Rule",
      publishedAt: "2023-01-01",
      authors: ["Hub Match"],
      metadata: { doi: "10.9220/idless-hub-shared" },
    });
    const p2 = item({
      id: "openalex:IDLESSHUB_P2",
      source: "openalex",
      title: "Completely Unrelated Retitled Paper Sharing Only A Doi",
      publishedAt: "2023-01-01",
      authors: ["Someone Else"],
      metadata: { doi: "10.9220/idless-hub-shared" }, // SAME DOI as p1 -> strong pass-1 link
    });
    const z = item({
      id: "web:idless-hub-z",
      source: "web",
      title: "Id Less Hub Hazard Case For The Pairwise Rule", // matches p1 only
      publishedAt: "2023-06-01",
      authors: ["Hub Match"],
      // Deliberately no metadata.doi/externalIds at all.
    });

    const result = dedupItems([p1, p2, z]);
    expect(result).toHaveLength(2);

    const mergedSurvivor = result.find((r) => r.id === "openalex:IDLESSHUB_P1");
    expect(mergedSurvivor).toBeDefined();
    const mergedIds = (mergedSurvivor!.metadata.mergedFrom ?? []).map((m) => m.id);
    expect(mergedIds).toContain("openalex:IDLESSHUB_P2");
    expect(mergedIds).not.toContain("web:idless-hub-z");

    const zStandalone = result.find((r) => r.id === "web:idless-hub-z");
    expect(zStandalone).toBeDefined();
  });

  // DEDUP-FIX3 (probe 3c): the same hub shape again, but Z now carries a
  // REAL id-form key of a DIFFERENT type (arXiv) than {P1,P2}'s shared type
  // (DOI). Under DEDUP-FIX2, `pairConflicts` required the SAME type on both
  // sides to fire at all (`sharesType` check) — an arXiv-vs-DOI pair never
  // shared a type, so P2-Z was never flagged as conflicting and all three
  // swept into one survivor despite Z demonstrably having its own,
  // independent, verifiable identity. Under DEDUP-FIX3, id TYPE is
  // irrelevant: P2-Z simply fails weakPairMatch on title, exactly as in the
  // no-id case above, so the component stays split.
  it("keeps an unrelated record separate from a strong-link cluster it only matches through one member, when that record carries an id of a DIFFERENT type (DEDUP-FIX3; probe 3c)", () => {
    const p1 = item({
      id: "openalex:MIXEDHUB_P1",
      source: "openalex",
      title: "Mixed Id Type Hub Hazard Case For The Pairwise Rule",
      publishedAt: "2023-01-01",
      authors: ["Hub Match"],
      metadata: { doi: "10.9230/mixed-hub-shared" },
    });
    const p2 = item({
      id: "openalex:MIXEDHUB_P2",
      source: "openalex",
      title: "Completely Unrelated Retitled Paper Sharing Only A Doi Two",
      publishedAt: "2023-01-01",
      authors: ["Someone Else"],
      metadata: { doi: "10.9230/mixed-hub-shared" }, // SAME DOI as p1 -> strong pass-1 link
    });
    const z = item({
      id: "web:mixed-hub-z",
      source: "web",
      title: "Mixed Id Type Hub Hazard Case For The Pairwise Rule", // matches p1 only
      publishedAt: "2023-06-01",
      authors: ["Hub Match"],
      metadata: { externalIds: { arxivId: "2306.54321" } }, // real id, but type "arxiv" != p1/p2's "doi"
    });

    const result = dedupItems([p1, p2, z]);
    expect(result).toHaveLength(2);

    const mergedSurvivor = result.find((r) => r.id === "openalex:MIXEDHUB_P1");
    expect(mergedSurvivor).toBeDefined();
    const mergedIds = (mergedSurvivor!.metadata.mergedFrom ?? []).map((m) => m.id);
    expect(mergedIds).toContain("openalex:MIXEDHUB_P2");
    expect(mergedIds).not.toContain("web:mixed-hub-z");

    const zStandalone = result.find((r) => r.id === "web:mixed-hub-z");
    expect(zStandalone).toBeDefined();
  });

  // DEDUP-FIX3: false-split guard — the mirror image of the hub tests
  // above. {P1,P2} again share one exact DOI (a pass-1 strong link), but
  // this time P1 and P2 ALSO share the identical title/year/author as EACH
  // OTHER (not unrelated titles), and Z is a direct version match to P1 AND
  // to P2 individually. Every cross-cluster member pair ({P1,P2} vs {Z})
  // now satisfies weakPairMatch, so the pairwise rule must correctly ALLOW
  // the merge — this guards against an implementation that over-blocks
  // merges whenever a strong-link cluster has more than one member,
  // regardless of whether every member actually matches.
  it("merges a strong-link cluster into a weak-linked version when EVERY member of the cluster (not just one) directly matches it (DEDUP-FIX3; false-split guard)", () => {
    const p1 = item({
      id: "openalex:GUARD_P1",
      source: "openalex",
      title: "Consistent Multi Member Match Case For The False Split Guard",
      publishedAt: "2023-01-01",
      authors: ["Guard Author"],
      metadata: { doi: "10.9240/guard-shared" },
    });
    const p2 = item({
      id: "dblp:guard-p2",
      source: "dblp",
      title: "Consistent Multi Member Match Case For The False Split Guard", // SAME title as p1
      publishedAt: "2023-01-01",
      authors: ["Guard Author"],
      metadata: { doi: "10.9240/guard-shared" }, // SAME DOI as p1 -> strong pass-1 link
    });
    const z = item({
      id: "openalex:GUARD_Z",
      source: "openalex",
      title: "Consistent Multi Member Match Case For The False Split Guard", // matches BOTH p1 and p2
      publishedAt: "2023-06-01",
      authors: ["Guard Author"],
      metadata: { doi: "10.9241/guard-independent-z" }, // its OWN, different DOI
    });

    const result = dedupItems([p1, p2, z]);
    expect(result).toHaveLength(1);
    const identity = identityForRawItem(result[0]);
    const allForms = [identity.key, ...identity.aliases];
    expect(allForms).toEqual(
      expect.arrayContaining(["doi:10.9240/guard-shared", "doi:10.9241/guard-independent-z"]),
    );
  });

  // DEDUP-FIX3: shuffled input produces the identical outcome for the
  // zero-id 5-hop chain (probe 2b, above) — a representative sample of
  // orderings (not all 120 permutations), matching this file's existing
  // order-independence convention for larger fixtures.
  it("produces the same 5-separate-items outcome for every tested ordering of the zero-id 5-hop chain", () => {
    const years = [2020, 2021, 2022, 2023, 2024];
    const versions = years.map((year, i) =>
      item({
        id: `web:idless-shuffle-${i + 1}`,
        source: "web",
        title: "Id Less Shuffle Order Independence Chain Case For The Pairwise Rule",
        publishedAt: `${year}-01-01`,
        authors: ["Shuffle Reviewer"],
      }),
    );
    const orderings = [
      versions,
      versions.slice().reverse(),
      [versions[2], versions[0], versions[4], versions[1], versions[3]],
      [versions[4], versions[3], versions[2], versions[1], versions[0]],
      [versions[1], versions[4], versions[0], versions[3], versions[2]],
    ];

    for (const ordered of orderings) {
      const result = dedupItems(ordered);
      expect(result).toHaveLength(5);
      expect(new Set(result.map((r) => r.id)).size).toBe(5);
    }
  });

  // DEDUP-FIX3: shuffled input produces the identical partition for the hub
  // shape — every permutation of the 3 inputs merges {P1,P2} and keeps Z
  // separate, the same order-independence guarantee §1p.G always made,
  // reverified under the new pairwise mechanism.
  it("produces the same hub partition (P1+P2 merged, Z separate) for every ordering of the hub inputs", () => {
    const p1 = item({
      id: "openalex:HUBPERM_P1",
      source: "openalex",
      title: "Hub Permutation Order Independence Case For The Pairwise Rule",
      publishedAt: "2023-01-01",
      authors: ["Perm Match"],
      metadata: { doi: "10.9250/hubperm-shared" },
    });
    const p2 = item({
      id: "openalex:HUBPERM_P2",
      source: "openalex",
      title: "Completely Unrelated Retitled Paper For Hub Permutation Case",
      publishedAt: "2023-01-01",
      authors: ["Someone Else"],
      metadata: { doi: "10.9250/hubperm-shared" },
    });
    const z = item({
      id: "openalex:HUBPERM_Z",
      source: "openalex",
      title: "Hub Permutation Order Independence Case For The Pairwise Rule",
      publishedAt: "2023-06-01",
      authors: ["Perm Match"],
      metadata: { doi: "10.9251/hubperm-independent-z" },
    });

    for (const ordered of permutations3(p1, p2, z)) {
      const result = ordered.slice();
      const dedupResult = dedupItems(result);
      expect(dedupResult).toHaveLength(2);
      const merged = dedupResult.find((r) => r.id === "openalex:HUBPERM_P1" || (r.metadata.mergedFrom ?? []).some((m) => m.id === "openalex:HUBPERM_P1"));
      expect(merged).toBeDefined();
      const mergedIds = new Set([merged!.id, ...((merged!.metadata.mergedFrom ?? []).map((m) => m.id))]);
      expect(mergedIds.has("openalex:HUBPERM_P1")).toBe(true);
      expect(mergedIds.has("openalex:HUBPERM_P2")).toBe(true);
      expect(mergedIds.has("openalex:HUBPERM_Z")).toBe(false);
      const zStandalone = dedupResult.find((r) => r.id === "openalex:HUBPERM_Z");
      expect(zStandalone).toBeDefined();
    }
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

  // DEDUP-ANGEW (ABC-JEV-INTEGRATION.md §1aw,
  // docs/jev-abc/DEDUP-ANGEW-B-20260929T064532Z.md): a production smoke
  // check on https://peer.homes found the SAME Angewandte Chemie article
  // shown as two separate feed cards — Wiley mints one DOI under the
  // International Edition's "anie" code and a second, parallel DOI under
  // the German-language original's "ange" code, for identical
  // peer-reviewed content. Root cause, reproduced by B's investigation: the
  // two editions weak-match each other directly (byte-identical title/
  // author/date), but in the real candidate pool the anie record (A below)
  // had ALREADY been pass-1 strong-linked (real shared DOI) to an unrelated
  // PubMed record (X below) whose own title/author formatting doesn't
  // weak-match the ange record (B below) — DEDUP-FIX3's `clustersFullyMatch`
  // then correctly requires EVERY cross-cluster pair in the component to
  // weak-match before it may collapse, and the X-B pair fails, so the WHOLE
  // component (not just X) stayed split, leaving A and B as two cards. The
  // fix (canonical-identity.ts's `dualEditionDoiAlias`) gives B's own "ange"
  // DOI an extra alias toward A's real "anie" DOI, so A/X/B now share one
  // id-form key directly and merge in PASS 1 (strong link) — before pass 2's
  // weak-link/clustersFullyMatch machinery (DEDUP-FIX3, untouched by this
  // fix) is even reached for this trio.
  describe("dual-edition Angewandte DOI alias (DEDUP-ANGEW)", () => {
    // A and B's title/authors/publishedAt/DOI are copied verbatim (shortest
    // fields that reproduce the bug — no abstract/venue/tags/score, none of
    // which feed identity or clustering) from the real live-response capture
    // saved at <scratchpad>/prod-lco-resp.json: openalex:W7213890479 (the
    // anie/International-Edition card) and openalex:W7213912992 (the
    // ange/German-language card).
    const A_TITLE =
      "Beyond Physical Protection Paradigm: Surface-bonded Molecular Integration for Durable High-voltage LiCoO2";
    const A_AUTHORS = [
      "Tian Xie",
      "Wenxin Liu",
      "Jiancong Cheng",
      "Yidi Jiang",
      "Ruming Yuan",
      "Jingmin Fan",
      "Dong-Liang Peng",
      "Mingsen Zheng",
      "Quanfeng Dong",
    ];
    const PUBLISHED_AT = "2026-09-21";
    // Fix round (ABC-JEV-INTEGRATION.md §1aw AMENDMENT,
    // docs/jev-abc/DEDUP-ANGEW-A-20260929T070428Z.md Check 3): A's own url
    // is the direct PDF link, B's is a bare DOI redirect; A's venue names
    // the International Edition explicitly, B's does not — both copied
    // verbatim from <scratchpad>/prod-lco-resp.json, same as every other
    // field here. Round 1's fixture omitted these two fields entirely (used
    // the shared test-helper's placeholder url, no venue at all), which is
    // exactly why the survivor-quality regression here went uncaught until
    // A's independent review added them.
    const ANIE_URL = "https://onlinelibrary.wiley.com/doi/pdfdirect/10.1002/anie.5600863";
    const ANIE_VENUE = "Angewandte Chemie International Edition";
    const ANGE_URL = "https://doi.org/10.1002/ange.5600863";
    const ANGE_VENUE = "Angewandte Chemie";

    function realAnieRecord(): RawItem {
      return item({
        id: "openalex:W7213890479",
        source: "openalex",
        title: A_TITLE,
        authors: A_AUTHORS,
        publishedAt: PUBLISHED_AT,
        url: ANIE_URL,
        venue: ANIE_VENUE,
        metadata: { doi: "10.1002/anie.5600863" },
      });
    }

    function realAngeRecord(): RawItem {
      return item({
        id: "openalex:W7213912992",
        source: "openalex",
        title: A_TITLE,
        authors: A_AUTHORS,
        publishedAt: PUBLISHED_AT,
        url: ANGE_URL,
        venue: ANGE_VENUE,
        metadata: { doi: "10.1002/ange.5600863" },
      });
    }

    // X is SYNTHETIC (not from any saved capture) — it stands in for the
    // real PubMed twin B's investigation proved exists (A's own
    // `metadata.mergedFrom` in the saved capture names
    // `{"source":"pubmed","id":"pubmed:42765143"}`) but whose exact fields
    // were never fetched (outside that investigation's allowed external
    // calls). Built the same way B's own temporary probe built it: same real
    // "anie" DOI as A (so it strong-links to A in pass 1, exactly as
    // production's PubMed record did), but title/author formatting typical
    // of a PubMed record (sentence case, no colon, abbreviated author
    // names) that does NOT satisfy weakPairMatch against B — normalized
    // titles must be EXACTLY equal for a weak link (the first, decisive
    // check in weakPairMatch), and PubMed's own indexing conventions
    // commonly differ this way from OpenAlex's; the author field's exact
    // parse doesn't matter here since the title mismatch alone already
    // decides it.
    function syntheticPubmedTwin(): RawItem {
      return item({
        id: "pubmed:42765143",
        source: "pubmed",
        title:
          "Surface-bonded molecular integration for durable high-voltage LiCoO2 cathodes",
        authors: ["Xie T", "Dong Q"],
        publishedAt: PUBLISHED_AT,
        metadata: { doi: "10.1002/anie.5600863" },
      });
    }

    it("collapses the production shape A + X + B into one survivor (RED without the alias — see the mutation test below)", () => {
      const a = realAnieRecord();
      const x = syntheticPubmedTwin();
      const b = realAngeRecord();

      // Sanity precondition, proven directly rather than assumed: without X,
      // A and B alone already merge on the bare weak-link rule (byte-
      // identical title/author/date) — so X is what makes this fixture
      // actually exercise the bug (matches B's own investigation finding).
      expect(dedupItems([a, b])).toHaveLength(1);

      const result = dedupItems([a, x, b]);
      expect(result).toHaveLength(1);

      const survivor = result[0];
      const identity = identityForRawItem(survivor);
      const allForms = [identity.key, ...identity.aliases];
      expect(allForms).toEqual(
        expect.arrayContaining([
          "doi:10.1002/anie.5600863",
          "doi:10.1002/ange.5600863",
        ]),
      );
      // All three inputs are accounted for — either AS the survivor or as a
      // recorded loser. This test intentionally does not itself pin down
      // WHICH one wins survivor selection — that precise, order-independent
      // claim (the anie record, always, with its own venue/url) has its own
      // dedicated tests just below, covering all 4 arrival orders. (History:
      // before the fix round below, the extra alias alone gave B one more
      // id-form than A, so B won this tie unconditionally — the exact HIGH
      // finding in A's review, docs/jev-abc/DEDUP-ANGEW-A-20260929T070428Z.md
      // Check 3 — fixed by `dedup.ts`'s new `dualEditionSurvivorCandidates`.)
      const mergedIds = (survivor.metadata.mergedFrom ?? []).map((m) => m.id);
      const allAccountedFor = new Set([survivor.id, ...mergedIds]);
      expect(allAccountedFor).toEqual(
        new Set(["openalex:W7213890479", "pubmed:42765143", "openalex:W7213912992"]),
      );
    });

    // Fix round (ABC-JEV-INTEGRATION.md §1aw AMENDMENT, after A
    // FAILED_REVIEW — docs/jev-abc/DEDUP-ANGEW-A-20260929T070428Z.md Check
    // 3, HIGH): the round-1 alias is one-directional (only B/"ange" gains an
    // extra id-form), so B always won dedup.ts's SOURCE_PRIORITY-tied
    // idFormKeys-count tie-break — in EVERY arrival order, not an
    // order-dependent accident (A confirmed this with its own 4-order probe
    // and live on the running dev server). The reader's card showed B's bare
    // DOI-redirect url and its more ambiguous venue name instead of A's
    // direct-PDF url and its unambiguous "International Edition" venue name.
    // `dedup.ts`'s new, named, additive `dualEditionSurvivorCandidates`
    // narrows survivor selection to the anie-DOI-holding member(s) whenever
    // a group holds both editions — these 4 tests are the exact reproduction
    // of A's own probe (same shape, same 4 distinguishable orders it used),
    // now as permanent regression coverage.
    describe("survivor preference — the anie (International Edition) member always wins (DEDUP-ANGEW fix round)", () => {
      const ANIE_ID = "openalex:W7213890479";
      const ANGE_ID = "openalex:W7213912992";
      const PUBMED_ID = "pubmed:42765143";

      function expectAnieSurvives(arrival: RawItem[]) {
        const result = dedupItems(arrival);
        expect(result).toHaveLength(1);

        const survivor = result[0];
        expect(survivor.id).toBe(ANIE_ID);
        expect(survivor.venue).toBe(ANIE_VENUE);
        expect(survivor.url).toBe(ANIE_URL);

        // mergedFrom still accounts for all three — the ange record and the
        // PubMed twin are demoted to losers, never dropped.
        const mergedIds = (survivor.metadata.mergedFrom ?? []).map((m) => m.id);
        expect(new Set([survivor.id, ...mergedIds])).toEqual(
          new Set([ANIE_ID, ANGE_ID, PUBMED_ID]),
        );
      }

      it("order: A, X, B", () => {
        expectAnieSurvives([realAnieRecord(), syntheticPubmedTwin(), realAngeRecord()]);
      });

      it("order: B, X, A", () => {
        expectAnieSurvives([realAngeRecord(), syntheticPubmedTwin(), realAnieRecord()]);
      });

      it("order: X, B, A", () => {
        expectAnieSurvives([syntheticPubmedTwin(), realAngeRecord(), realAnieRecord()]);
      });

      it("order: B, A, X", () => {
        expectAnieSurvives([realAngeRecord(), realAnieRecord(), syntheticPubmedTwin()]);
      });
    });

    // Protective: a merged group with no dual-edition pair at all must keep
    // TODAY's ordinary SOURCE_PRIORITY survivor rule completely unchanged —
    // proves `dualEditionSurvivorCandidates` returns null (falls through to
    // the unrestricted candidate list) rather than misfiring on an unrelated
    // merge. Deliberately a fresh, non-Wiley fixture (not a reuse of
    // realAnieRecord/realAngeRecord), so this test's outcome cannot depend
    // on anything about the Angewandte pair.
    it("a group with no dual-edition pair keeps today's survivor rule unchanged (protective)", () => {
      const lowerPriority = item({
        id: "pubmed:PLAIN_LOW",
        source: "pubmed", // SOURCE_PRIORITY 2
        title: "An Entirely Ordinary Merge With No Angewandte Doi Involved",
        publishedAt: "2026-04-01",
        authors: ["Epsilon Author"],
        metadata: { doi: "10.3000/plain-merge-test" },
      });
      const higherPriority = item({
        id: "openalex:PLAIN_HIGH",
        source: "openalex", // SOURCE_PRIORITY 3 — wins on today's rule alone
        title: "An Entirely Ordinary Merge With No Angewandte Doi Involved",
        publishedAt: "2026-04-01",
        authors: ["Epsilon Author"],
        metadata: { doi: "10.3000/plain-merge-test" }, // SAME doi -> strong link
      });

      // Both arrival orders, since the whole point is order-independence.
      for (const arrival of [
        [lowerPriority, higherPriority],
        [higherPriority, lowerPriority],
      ]) {
        const result = dedupItems(arrival);
        expect(result).toHaveLength(1);
        expect(result[0].id).toBe("openalex:PLAIN_HIGH");
      }
    });

    it("never merges two different Angewandte papers (different numeric suffixes)", () => {
      const anie1 = item({
        id: "openalex:W_DIFF_N_ANIE",
        source: "openalex",
        title: "First Distinct Angewandte Article About Something Specific",
        publishedAt: "2026-01-01",
        authors: ["Alpha Author"],
        metadata: { doi: "10.1002/anie.111111" },
      });
      const ange2 = item({
        id: "openalex:W_DIFF_N_ANGE",
        source: "openalex",
        title: "Second Distinct Angewandte Article About Something Else",
        publishedAt: "2026-01-01",
        authors: ["Beta Author"],
        metadata: { doi: "10.1002/ange.222222" },
      });

      const result = dedupItems([anie1, ange2]);
      expect(result).toHaveLength(2);
      expect(result.map((r) => r.id).sort()).toEqual(
        ["openalex:W_DIFF_N_ANGE", "openalex:W_DIFF_N_ANIE"].sort(),
      );
    });

    it("the alias applies only under the 10.1002 prefix — a same-suffix DOI under a different registrant never merges with the real anie record", () => {
      // Deliberately a DIFFERENT title/author from A, so the ONLY possible
      // merge path for this pair is a successful dual-edition DOI alias
      // (pass 1) — the pre-existing weak-link rule (pass 2) never forms a
      // candidate pair for them at all, isolating this test to the ID
      // mechanism specifically, the same way the "different N" test above
      // does.
      const anie = realAnieRecord();
      const wrongRegistrant = item({
        id: "openalex:W_WRONG_REGISTRANT",
        source: "openalex",
        title: "An Unrelated Paper That Only Shares A Coincidental DOI Suffix",
        publishedAt: "2026-03-01",
        authors: ["Delta Author"],
        metadata: { doi: "10.9999/ange.5600863" }, // same suffix number, NOT Wiley's registrant
      });

      expect(identityForRawItem(wrongRegistrant).aliases.some((a) => a.startsWith("doi:"))).toBe(
        false,
      );

      const result = dedupItems([anie, wrongRegistrant]);
      expect(result).toHaveLength(2);
    });

    it('a non-Wiley DOI merely containing the substring "ange" is untouched', () => {
      const unrelated = item({
        id: "openalex:W_UNRELATED_ANGE_SUBSTRING",
        source: "openalex",
        title: "An Entirely Unrelated Paper About Orange Peel Chemistry Methods",
        publishedAt: "2026-02-01",
        authors: ["Gamma Author"],
        metadata: { doi: "10.5555/orange-chemistry.789" },
      });

      const identity = identityForRawItem(unrelated);
      expect(identity.key).toBe("doi:10.5555/orange-chemistry.789");
      expect(identity.aliases.some((a) => a.startsWith("doi:"))).toBe(false);

      const result = dedupItems([unrelated, realAnieRecord()]);
      expect(result).toHaveLength(2);
    });
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

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
// docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md): a signed-out Papers
// feed showed one Figshare DATASET record ("O2-LCO-DATA") twice — the base
// work openalex:W7212231591 (DOI 10.6084/m9.figshare.33608659) and
// openalex:W7214074445 (the same DOI with a ".v4" suffix, OpenAlex's own
// version convention for Figshare deposits). Reproduced here with the real
// ids/DOIs/venue (title/type are the only fields the real record needs for
// this test, since neither feeds identity/clustering beyond what's used
// below). The fix: canonical-identity.ts's `figshareVersionDoiAlias` — see
// that file's own DATASET-RECORDS section for the unit-level coverage of the
// alias itself; this section covers the end-to-end merge through
// `dedupItems`/`clusterCanonicalWorks`, the same split B's own investigation
// used for DEDUP-ANGEW.
describe("Figshare version-DOI alias — end-to-end merge (DATASET-RECORDS)", () => {
  // "O2-LCO-DATA" normalizes to 2 qualifying (>=3-char) tokens ("lco",
  // "data" — "o2" is only 2 chars), under computeTitleAlias's >=4-token bar.
  // So titleFormOf is undefined for both records and weakPairMatch's first
  // check fails immediately — the pair CANNOT merge via the pre-existing
  // weak-link rule at all, only via a shared strong id-form key. This is the
  // exact reason the live duplicate was never caught before this fix (B's
  // own investigation, Task 1).
  const TITLE = "O2-LCO-DATA";

  function baseRecord(): RawItem {
    return item({
      id: "openalex:W7212231591",
      source: "openalex",
      title: TITLE,
      venue: "Figshare",
      metadata: { doi: "10.6084/m9.figshare.33608659" },
    });
  }

  function versionedRecord(): RawItem {
    return item({
      id: "openalex:W7214074445",
      source: "openalex",
      title: TITLE,
      venue: "Figshare",
      metadata: { doi: "10.6084/m9.figshare.33608659.v4" },
    });
  }

  it("merges the O2-LCO-DATA-shaped pair into one survivor (mutation target: removing the alias wiring turns this red — expect(result).toHaveLength(1) would fail with 2)", () => {
    const result = dedupItems([baseRecord(), versionedRecord()]);
    expect(result).toHaveLength(1);

    const survivor = result[0];
    const mergedIds = (survivor.metadata.mergedFrom ?? []).map((m) => m.id);
    expect(new Set([survivor.id, ...mergedIds])).toEqual(
      new Set(["openalex:W7212231591", "openalex:W7214074445"]),
    );
  });

  it("merges regardless of arrival order", () => {
    const result = dedupItems([versionedRecord(), baseRecord()]);
    expect(result).toHaveLength(1);
  });

  it("keeps two different (unrelated) Figshare DOIs apart, versioned or not", () => {
    const a = item({
      id: "openalex:W_FIG_1",
      source: "openalex",
      title: TITLE,
      metadata: { doi: "10.6084/m9.figshare.11111" },
    });
    const b = item({
      id: "openalex:W_FIG_2",
      source: "openalex",
      title: TITLE,
      metadata: { doi: "10.6084/m9.figshare.22222.v1" },
    });
    const result = dedupItems([a, b]);
    expect(result).toHaveLength(2);
  });

  it("leaves a non-Figshare (e.g. Zenodo) versioned-looking DOI pair unmerged — out of scope per §1bl.3", () => {
    const a = item({
      id: "openalex:W_ZEN_1",
      source: "openalex",
      title: TITLE,
      metadata: { doi: "10.5281/zenodo.99999" },
    });
    const b = item({
      id: "openalex:W_ZEN_2",
      source: "openalex",
      title: TITLE,
      metadata: { doi: "10.5281/zenodo.99999.v2" },
    });
    const result = dedupItems([a, b]);
    expect(result).toHaveLength(2);
  });
});

// DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl.8 AMENDMENT,
// docs/jev-abc/DATASET-RECORDS-A-20260930T041130Z.md Finding 1, HIGH): round 1
// only filtered the 3 source adapters. A fresh A found a live, unaddressed
// path into this SAME candidate pool — `affiliation/openalex.ts`'s
// `fetchCitationNeighborhood`, which feeds both the advisor citation
// neighbourhood (build time, pipeline.ts's `affiliationPromise`) and the
// liked-paper "positive seed" citation neighbourhood (read time, pipeline.ts's
// `fetchSeedCitationsLeg`) — with no filter of its own by design (see that
// file's own DATASET-RECORDS test section). `dedupItems` is THE single
// pipeline choke point every one of these channels' output passes through
// before scoring, regardless of which channel produced it (see the comment
// at the top of `dedupItems` and `isExcludedOpenAlexRawItem`'s own doc
// comment in utils/openalex.ts). These tests exercise each of the three real
// entry paths by the exact RawItem shape/admissionChannel tag its real
// caller in pipeline.ts gives it: "keyword" for a plain source-adapter
// result, "citation" for BOTH the advisor-neighbourhood and the liked-paper
// seed-citation channel (mechanically identical at this point — both real
// call sites push into an array that reaches this same `dedupItems` call).
describe("the pipeline choke point excludes non-paper OpenAlex types on every entry path (DATASET-RECORDS §1bl.8)", () => {
  function channelItem(
    admissionChannel: "keyword" | "citation",
    overrides: Partial<RawItem> & { id: string; title: string },
  ): RawItem {
    return item({
      source: "openalex",
      admissionChannels: [admissionChannel],
      ...overrides,
    });
  }

  it("adapter entry path (admissionChannel: keyword) — a dataset-typed item never survives dedupItems", () => {
    const result = dedupItems([
      channelItem("keyword", {
        id: "openalex:W_ADAPTER_DATASET",
        title: "O2-LCO-DATA",
        metadata: { workType: "dataset" },
      }),
    ]);
    expect(result).toEqual([]);
  });

  it("adapter entry path (admissionChannel: keyword) — an article-typed item survives unchanged", () => {
    const result = dedupItems([
      channelItem("keyword", {
        id: "openalex:W_ADAPTER_ARTICLE",
        title: "A Real Article",
        metadata: { workType: "article" },
      }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["openalex:W_ADAPTER_ARTICLE"]);
  });

  it("advisor-neighbourhood entry path (admissionChannel: citation, build time) — a dataset-typed item never survives dedupItems", () => {
    const result = dedupItems([
      channelItem("citation", {
        id: "openalex:W_ADVISOR_DATASET",
        title: "O2-LCO-DATA",
        metadata: { workType: "dataset" },
      }),
    ]);
    expect(result).toEqual([]);
  });

  it("advisor-neighbourhood entry path (admissionChannel: citation, build time) — an article-typed item survives unchanged", () => {
    const result = dedupItems([
      channelItem("citation", {
        id: "openalex:W_ADVISOR_ARTICLE",
        title: "A Paper Citing The Advisor's Work",
        metadata: { workType: "article" },
      }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["openalex:W_ADVISOR_ARTICLE"]);
  });

  it("liked-paper seed-citation entry path (admissionChannel: citation, read time) — a dataset-typed item never survives dedupItems", () => {
    // Same mechanism as the advisor-neighbourhood test above by construction
    // — pipeline.ts's fetchSeedCitationsLeg (read time) and affiliationPromise
    // (build time) both call the SAME fetchCitationNeighborhood and both tag
    // their output "citation" before it reaches this same dedupItems call;
    // kept as its own named test to cover both real call sites explicitly.
    const result = dedupItems([
      channelItem("citation", {
        id: "openalex:W_SEED_DATASET",
        title: "O2-LCO-DATA",
        metadata: { workType: "dataset" },
      }),
    ]);
    expect(result).toEqual([]);
  });

  it("liked-paper seed-citation entry path (admissionChannel: citation, read time) — an article-typed item survives unchanged", () => {
    const result = dedupItems([
      channelItem("citation", {
        id: "openalex:W_SEED_ARTICLE",
        title: "A Paper Citing A Liked Paper",
        metadata: { workType: "article" },
      }),
    ]);
    expect(result.map((r) => r.id)).toEqual(["openalex:W_SEED_ARTICLE"]);
  });

  it("a mixed pool: only the openalex dataset is dropped, everything else (including a non-openalex item sharing a coincidental workType string) survives", () => {
    const result = dedupItems([
      channelItem("keyword", {
        id: "openalex:W_MIX_ARTICLE",
        title: "A Kept OpenAlex Article",
        metadata: { workType: "article" },
      }),
      channelItem("citation", {
        id: "openalex:W_MIX_DATASET",
        title: "O2-LCO-DATA",
        metadata: { workType: "dataset" },
      }),
      item({
        id: "pubmed:MIX_1",
        source: "pubmed",
        title: "A PubMed Item Whose Own pubtype Happens To Say Dataset",
        metadata: { workType: "Dataset" },
      }),
    ]);
    expect(result.map((r) => r.id).sort()).toEqual(
      ["openalex:W_MIX_ARTICLE", "pubmed:MIX_1"].sort(),
    );
  });
});
