import type { RawItem } from "@/lib/sources/types";
import {
  canonicalPaperKey,
  idFormKeys,
  titleFormOf,
  type CanonicalIdentity,
  type WorkMatchInput,
} from "@/lib/utils/canonical-identity";

// P2-S1-FIX (Round 3) — shared identity + clustering helpers, per
// ABC-JEV-INTEGRATION.md §1p.A/§1p.G (docs/jev-abc/P2-S1-A-20260924T0438Z.md
// is the failed review this file answers). Two exports:
//
//   `identityForRawItem` builds a RawItem's canonical identity the same way
//   `dedup.ts` always has, but also folds in `metadata.mergedAliases` — the
//   alias union a dedupe survivor picks up when it absorbs other records
//   (populated by `dedup.ts`, below). A plain, never-merged item gets
//   exactly `canonicalPaperKey`'s own output back — nothing added, nothing
//   removed. Reused later by the P4 delivery-exclusion path (§1p.G(4): "so
//   the P4 delivery-exclusion path uses the same identity as dedupe" — that
//   switch is a later pipeline slice, not this one).
//
//   `clusterCanonicalWorks` is the corrected, order-independent clustering
//   step itself (§1p.G(1)-(3)), extracted as a reusable pure function so
//   `dedup.ts` and, in a later slice, the S2-vs-OpenAlex channel-comparison
//   harness (`scoring/channel-comparison.ts` — a different slice's file,
//   NOT edited here) can share one identity/merge rule instead of each
//   keeping its own copy of a union-find. It takes only the already
//   abstracted `WorkMatchInput[]` (identity + published year + first-author
//   surname) — no RawItem, metadata, or source-priority awareness — and
//   returns the partition as arrays of input indices, e.g.
//   `[[0], [1, 2], [3]]`.
//
// Neither function makes a network call or throws.
//
// DEDUP-FIX (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "manager smoke
// check... version rule ruled", 2026-09-24T20:30:13Z, revising §1p.A(1)/
// §1p.G(2)): a production smoke check found real duplicate feed items (e.g.
// two Zenodo records of the same paper, one DOI minted per version).
// `clusterCanonicalWorks` no longer blocks a weak-linked component from
// merging just because its clusters carry differing id-form values (e.g.
// two different DOIs) — see that function's own doc comment for the full
// before/after reasoning. Nothing in `identityForRawItem` changed; it
// already re-derives whatever aliases `dedup.ts` unions onto a survivor, so
// a version merge's extra DOI aliases flow through it unchanged, and from
// there into RRF clustering (scoring/rrf.ts) and P4's delivery-exclusion
// path for free.
//
// DEDUP-FIX2 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh A:
// FAILED_REVIEW (scoped...); narrowed conflict rule ruled", 2026-09-24T21:
// 21:36Z; SUPERSEDED by DEDUP-FIX3 below — kept for history): a fresh
// independent review (docs/jev-abc/DEDUP-FIX-A-20260924T205613Z.md) found
// DEDUP-FIX's full removal of the id-type conflict check went wider than
// the version rule's own intent — two concrete false-merge shapes: (1) a
// transitive-only chain (A 2020 ~ B 2021 ~ C 2022, same title/author,
// bridged by ID-less B) collapsed A and C into one survivor even though A
// and C ALONE are two years apart, outside the version rule's own +-1
// window; (2) a pass-1 strong-link cluster {P1, P2} (sharing one real
// id-form key, e.g. a DOI, despite unrelated titles) could pull in an
// unrelated record Z that only ever matches P1, sweeping P2 into the same
// survivor as Z even though P2 and Z were never compared.
// `clusterCanonicalWorks` reinstated a conflict check, narrowed so it never
// re-blocked a genuine version pair: two pass-1 clusters conflicted only
// when some member of one and some member of the other carried the SAME
// id-form TYPE with different values AND that SPECIFIC pair did not itself
// directly satisfy `weakPairMatch`.
//
// DEDUP-FIX3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2 fresh
// A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole stop;
// structural pairwise rule ruled; DEDUP-FIX3 C assigned", 2026-09-24T22:
// 06:02Z): a SECOND fresh independent review
// (docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md) found DEDUP-FIX2's
// id-type-comparison mechanism only ever detects a conflict when BOTH sides
// of the disputed pair carry a real id of the SAME type — a record that
// only ever weak-links on title (no id at all, or an id of a different type
// than the cluster it's disputing) got NO protection, reproducing both of
// DEDUP-FIX's original false-merge shapes again, just with thinner id
// metadata. Two consecutive per-instance patches for the same slot is this
// project's own whack-a-mole stop signal, so the fix this time is
// structural rather than another patch: `clusterCanonicalWorks` no longer
// looks at ids AT ALL when deciding whether a weak-linked component may
// collapse. Instead: a component collapses into one survivor ONLY IF every
// pair of records drawn from DIFFERENT pass-1 clusters in that component
// directly satisfies `weakPairMatch` — checked over the full member
// cross-product of every pair of clusters in the component (not just the
// pair that happened to create a link, and not just adjacent clusters in
// whatever chain first connected them). If even one cross-cluster pair
// fails, the WHOLE component stays split — every pass-1 cluster in it
// becomes its own final group. A direct version pair (only 2 pass-1
// clusters in the component) trivially satisfies this — there is only one
// cross-cluster pair to check, and it's the same pair that created the
// link in the first place — so the observed Zenodo regression and every
// other direct version pair still merge exactly as before; a transitive
// chain or a hub's "innocent" member fails it precisely because SOME
// cross-cluster pair doesn't match, with no id evidence required either
// way. See `clustersFullyMatch`/`clusterCanonicalWorks`'s own doc comments
// below for the full mechanism.

/**
 * A RawItem's canonical identity, including any aliases a dedupe merge
 * folded onto it (`metadata.mergedAliases`). For an item that was never
 * part of a merge, this is byte-identical to calling `canonicalPaperKey`
 * directly on the item's own fields.
 */
export function identityForRawItem(item: RawItem): CanonicalIdentity {
  const base = canonicalPaperKey({
    source: item.source,
    id: item.id,
    doi: item.metadata?.doi,
    title: item.title,
    externalIds: item.metadata?.externalIds,
  });
  const merged = item.metadata?.mergedAliases;
  if (!merged || merged.length === 0) return base;
  const aliasSet = new Set(base.aliases);
  for (const alias of merged) {
    if (alias !== base.key) aliasSet.add(alias);
  }
  return { key: base.key, keyVersion: base.keyVersion, aliases: Array.from(aliasSet) };
}

function normalizeSurname(s: string | undefined): string | undefined {
  const t = s?.trim().toLowerCase();
  return t || undefined;
}

/**
 * The title+year(+-1)+first-author-surname "weak link" rule alone. Per the
 * DEDUP-FIX version rule (ABC-JEV-INTEGRATION.md §4 Round 3 "manager smoke
 * check... version rule ruled", 2026-09-24T20:30:13Z, revising §1p.A(1) and
 * §1p.G(2)), these four conditions — normalized title equality, a
 * qualifying (>=4-token) title alias, matching first-author surname, and
 * published years within +-1 — are the complete "these two records THEMSELVES
 * are directly VERSIONS of one work" test, deliberately with NO id-conflict
 * short-circuit here: two items that both happen to carry some real id-form
 * key (matching, differing, or of different types) are allowed to weak-link
 * at THIS pairwise level on equal terms — ids are never consulted anywhere
 * in this function. DEDUP-FIX3 (pairwise version rule, 2026-09-24T22:06:02Z):
 * this SAME per-pair test is also reused, one level up, as the entire
 * cross-cluster collapse condition — `clustersFullyMatch` requires every
 * pair of records from different pass-1 clusters in a weak component to
 * pass THIS function before the whole component is allowed to collapse (see
 * `clusterCanonicalWorks`'s own doc comment for the full mechanism). This
 * deliberately does NOT reuse `sameCanonicalWork`
 * (canonical-identity.ts — removed as dead code by R3-CLEANUP-3; it
 * encoded the ORIGINAL, now-twice-superseded §1p.A(1) prose, which blocked a
 * match whenever BOTH sides carried ANY id-form key at all, regardless of
 * type or of whether the pair itself satisfied this same 4-condition test).
 */
function weakPairMatch(a: WorkMatchInput, b: WorkMatchInput): boolean {
  const aTitle = titleFormOf(a.identity);
  const bTitle = titleFormOf(b.identity);
  if (!aTitle || !bTitle || aTitle !== bTitle) return false;

  if (a.publishedYear == null || b.publishedYear == null) return false;
  if (Math.abs(a.publishedYear - b.publishedYear) > 1) return false;

  const aSurname = normalizeSurname(a.firstAuthorSurname);
  const bSurname = normalizeSurname(b.firstAuthorSurname);
  if (!aSurname || !bSurname || aSurname !== bSurname) return false;

  return true;
}

class DisjointSet {
  private readonly parent: number[];

  constructor(size: number) {
    this.parent = Array.from({ length: size }, (_, i) => i);
  }

  find(x: number): number {
    while (this.parent[x] !== x) {
      this.parent[x] = this.parent[this.parent[x]];
      x = this.parent[x];
    }
    return x;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

interface PassOneCluster {
  memberIdxs: number[];
}

/**
 * DEDUP-FIX3 (pairwise version rule, ABC-JEV-INTEGRATION.md §4 Round 3
 * "DEDUP-FIX2 fresh A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED);
 * whack-a-mole stop; structural pairwise rule ruled; DEDUP-FIX3 C assigned",
 * 2026-09-24T22:06:02Z) — true iff EVERY member of `a` and EVERY member of
 * `b` (the full member cross-product, not just the pair that happened to
 * create the two clusters' weak link) directly satisfies `weakPairMatch`.
 * Ids play no part in this at all — replaces DEDUP-FIX2's id-form-TYPE
 * comparison (`pairConflicts`/`clustersConflict`, both removed), which could
 * only ever detect a problem when both sides of the disputed pair happened
 * to carry a real id of the same type, and so missed the same false-merge
 * shapes whenever the disputed record had no id, or an id of a different
 * type (docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md's NEW FINDINGS 1-3).
 * The mismatched pair and the version-matching pair can be different
 * records within the same two clusters — e.g. a strong-link cluster {P1,
 * P2} (sharing a DOI) weak-linked to {Z} through P1 alone: P1-Z directly
 * satisfies the version rule, but P2-Z does not, and THAT pair (not P1-Z)
 * is what must block the collapse — see `clusterCanonicalWorks`'s own doc
 * comment for the full worked example.
 */
function clustersFullyMatch(inputs: WorkMatchInput[], a: PassOneCluster, b: PassOneCluster): boolean {
  for (const i of a.memberIdxs) {
    for (const j of b.memberIdxs) {
      if (!weakPairMatch(inputs[i], inputs[j])) return false;
    }
  }
  return true;
}

/**
 * The order-independent clustering step (§1p.G(1)-(3), revised by the
 * DEDUP-FIX version rule, narrowed by DEDUP-FIX2, and replaced again by
 * DEDUP-FIX3): strong links (shared id-form key) union transitively first;
 * weak links (title+year+author) are then evaluated BETWEEN the resulting
 * pass-1 clusters, not raw items, and a weak-linked component of clusters
 * collapses into one group only if EVERY pair of clusters anywhere in the
 * component fully matches (`clustersFullyMatch`, above — every member of one
 * against every member of the other, all via `weakPairMatch`). If even ONE
 * cross-cluster pair anywhere in the component fails, the WHOLE component
 * stays split — every pass-1 cluster in it becomes its own final group —
 * rather than guessing which side is "right."
 *
 * DEDUP-FIX2 (ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh A:
 * FAILED_REVIEW... narrowed conflict rule ruled", 2026-09-24T21:21:36Z;
 * SUPERSEDED by DEDUP-FIX3 below): DEDUP-FIX (the version rule) removed the
 * original conflict check entirely, so every weak-linked component always
 * collapsed — correct for a direct version pair (the observed Zenodo
 * regression), but a fresh independent review
 * (docs/jev-abc/DEDUP-FIX-A-20260924T205613Z.md) found it ALSO silently
 * merged (1) a transitive-only chain whose two ID-bearing ENDS never
 * themselves satisfy the version rule (only the adjacent links in the chain
 * do — e.g. A(2020)~B(2021)~C(2022): A and C are 2 years apart, so A-C alone
 * fails, yet the old code merged all three anyway), and (2) an unrelated
 * record pulled in through ONE member of a strong-link cluster while
 * conflicting with that cluster's OTHER member (the {P1,P2}-vs-Z hub case
 * below). DEDUP-FIX2 reinstated a conflict check keyed on id-form TYPE
 * comparison — see this file's git history / DEDUP-FIX2-C's checkpoint for
 * the exact mechanism, since it no longer exists in this file.
 *
 * DEDUP-FIX3 (ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX2 fresh A:
 * FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED); whack-a-mole stop;
 * structural pairwise rule ruled; DEDUP-FIX3 C assigned", 2026-09-24T22:
 * 06:02Z): a SECOND fresh independent review
 * (docs/jev-abc/DEDUP-FIX2-A-20260924T214311Z.md) found DEDUP-FIX2's
 * id-type comparison went wrong whenever the disputed record carried no id
 * at all, or an id of a different type than the cluster it disputed with —
 * reproducing BOTH of DEDUP-FIX's original false-merge shapes again (a
 * zero-id 5-hop chain fully collapsed; a hub's intruder with no id, or an
 * id of the wrong type, was never flagged as conflicting), simply with
 * thinner id metadata than the fixtures that first proved DEDUP-FIX2. Two
 * consecutive per-instance patches for this one slot is this project's own
 * whack-a-mole stop signal, so this fix removes id comparison from the
 * decision ENTIRELY, replacing it with the structural pairwise test
 * described above. Worked hub example: {P1, P2} share a DOI (a pass-1
 * strong link) despite unrelated titles; Z matches P1's title/year/author
 * but not P2's. The component {P1,P2}~Z has exactly one cross-cluster
 * cluster-pair to check, and `clustersFullyMatch` requires EVERY member
 * pair within it to satisfy `weakPairMatch`: P1-Z passes, P2-Z does not
 * (different titles) — one failing pair is enough to block the whole
 * component, with no id ever consulted, so {P1,P2} stays merged with each
 * other (their pass-1 strong link is unaffected) while Z stays separate.
 * Contrast: if P2's title ALSO matched Z's (every member of {P1,P2}
 * individually satisfies `weakPairMatch` against Z), `clustersFullyMatch`
 * would return true and the whole trio would correctly collapse — the
 * false-split guard in dedup.test.ts/paper-identity.test.ts pins exactly
 * this. Since a weak link only ever forms (`weakPairMatch`, above) when
 * normalized titles are equal AND a qualifying >=4-token title alias exists
 * AND the first-author surnames match AND the published years are within
 * +-1, the three OTHER protections (different first-author surname; either
 * side missing authors; a short/generic title with no qualifying alias) are
 * unchanged — they block a weak link from forming at all, above this
 * function, not here. A direct version pair (exactly 2 pass-1 clusters in
 * the component) trivially satisfies the pairwise test — there is only one
 * cross-cluster pair to check, and it's the same pair that created the link
 * — so the observed Zenodo regression, and every all-pairs-matching version
 * set, still merge exactly as before. Accepted costs (restated, unchanged in
 * substance from the version rule, §4 Round 3 ruling): an ambiguous
 * component with any non-matching cross-cluster pair lands every pass-1
 * cluster in its own group rather than guessing (the "ambiguous weak
 * component" tally); two distinct same-author works sharing an identical
 * long title in consecutive years still merge, because their own direct
 * pairwise year gap is within +-1 (the "version merges spanning different
 * calendar years" tally). See dedup.test.ts / paper-identity.test.ts's
 * DEDUP-FIX3-tagged cases.
 *
 * Provably independent of input order: the edge set (which pairs of
 * clusters weak-link) and `clustersFullyMatch` are both computed from
 * fixed, precomputed `inputs` and never depend on prior union state or scan
 * order, so the resulting partition — and therefore every final group — is
 * invariant to permuting `inputs`.
 *
 * Returns the partition as arrays of indices into `inputs`, e.g.
 * `[[0], [1, 2], [3]]`. Never drops an input: every index appears in
 * exactly one output group.
 */
export function clusterCanonicalWorks(inputs: WorkMatchInput[]): number[][] {
  if (inputs.length === 0) return [];

  // Pass 1 — strong links: union everything sharing a real id-form key
  // (DOI/S2/OpenAlex/arXiv/PMID), transitively, O(n) via a map instead of
  // pairwise comparison. Two versions sharing e.g. an arXiv id may merge
  // even with different DOIs (§1p.G(1)) — a shared identifier is evidence
  // of one work, stronger than a differing one found elsewhere.
  const dsu1 = new DisjointSet(inputs.length);
  const byIdKey = new Map<string, number>();
  for (let i = 0; i < inputs.length; i++) {
    for (const key of idFormKeys(inputs[i].identity)) {
      const seen = byIdKey.get(key);
      if (seen === undefined) byIdKey.set(key, i);
      else dsu1.union(seen, i);
    }
  }

  // Build the pass-1 clusters (contiguous 0..k-1 index -> member indices).
  const clusterIndexByRoot = new Map<number, number>();
  const clusters: PassOneCluster[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const root = dsu1.find(i);
    let ci = clusterIndexByRoot.get(root);
    if (ci === undefined) {
      ci = clusters.length;
      clusterIndexByRoot.set(root, ci);
      clusters.push({ memberIdxs: [] });
    }
    clusters[ci].memberIdxs.push(i);
  }

  // Pass 2 — weak links, evaluated BETWEEN pass-1 clusters: bucket clusters
  // by every qualifying title alias any of their members carry, so only
  // clusters that could plausibly match are ever compared; within a
  // promising pair, check the full member cross-product (a cluster's
  // members can have slightly different titles/years after a strong-link
  // merge, e.g. a preprint vs its published version).
  const byTitle = new Map<string, Set<number>>();
  clusters.forEach((cluster, ci) => {
    const titles = new Set<string>();
    for (const idx of cluster.memberIdxs) {
      const t = titleFormOf(inputs[idx].identity);
      if (t) titles.add(t);
    }
    for (const t of titles) {
      let bucket = byTitle.get(t);
      if (!bucket) {
        bucket = new Set();
        byTitle.set(t, bucket);
      }
      bucket.add(ci);
    }
  });

  const weakDsu = new DisjointSet(clusters.length);
  const candidatePairs = new Set<string>();
  for (const bucket of byTitle.values()) {
    const uniq = Array.from(bucket);
    for (let a = 0; a < uniq.length; a++) {
      for (let b = a + 1; b < uniq.length; b++) {
        const ci = Math.min(uniq[a], uniq[b]);
        const cj = Math.max(uniq[a], uniq[b]);
        candidatePairs.add(`${ci}:${cj}`);
      }
    }
  }
  for (const pairKey of candidatePairs) {
    const [ciStr, cjStr] = pairKey.split(":");
    const ci = Number(ciStr);
    const cj = Number(cjStr);
    if (weakDsu.find(ci) === weakDsu.find(cj)) continue;
    let linked = false;
    for (const i of clusters[ci].memberIdxs) {
      for (const j of clusters[cj].memberIdxs) {
        if (weakPairMatch(inputs[i], inputs[j])) {
          linked = true;
          break;
        }
      }
      if (linked) break;
    }
    if (linked) weakDsu.union(ci, cj);
  }

  // Group pass-1 clusters by weak-link connected component, then decide, per
  // component, whether it's safe to collapse into one group: DEDUP-FIX3's
  // pairwise rule — only if EVERY pair of clusters anywhere in the
  // component fully matches (`clustersFullyMatch` — see the function-level
  // doc comment above and `clusterCanonicalWorks`'s own doc comment for the
  // worked hub example). This checks every pair of clusters in the
  // component, not just the ones a candidate weak link originally tested —
  // a component can connect clusters that never shared a title bucket
  // directly (e.g. X~Y via "Foo", Y~Z via "Bar", when Y is a multi-title
  // strong-link cluster), and those, too, must fully match for the whole
  // component to collapse.
  const componentOf = new Map<number, number[]>();
  for (let ci = 0; ci < clusters.length; ci++) {
    const root = weakDsu.find(ci);
    const arr = componentOf.get(root);
    if (arr) arr.push(ci);
    else componentOf.set(root, [ci]);
  }

  const finalGroups: number[][] = [];
  for (const clusterIdxs of componentOf.values()) {
    if (clusterIdxs.length === 1) {
      finalGroups.push(clusters[clusterIdxs[0]].memberIdxs);
      continue;
    }
    let allPairsFullyMatch = true;
    for (let a = 0; a < clusterIdxs.length && allPairsFullyMatch; a++) {
      for (let b = a + 1; b < clusterIdxs.length; b++) {
        if (!clustersFullyMatch(inputs, clusters[clusterIdxs[a]], clusters[clusterIdxs[b]])) {
          allPairsFullyMatch = false;
          break;
        }
      }
    }
    if (allPairsFullyMatch) {
      finalGroups.push(clusterIdxs.flatMap((ci) => clusters[ci].memberIdxs));
    } else {
      for (const ci of clusterIdxs) finalGroups.push(clusters[ci].memberIdxs);
    }
  }

  return finalGroups;
}

// R3-CLEANUP-3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh
// A: FAILED_REVIEW... narrowed conflict rule ruled", 2026-09-24T21:21:36Z,
// "FOLDED IN R3-CLEANUP-3"): `feed/dedup.ts` and `feed/pipeline.ts` each used
// to carry their own byte-identical private `publishedYearOf(item: RawItem)`
// / `firstAuthorSurnameOf(item: RawItem)` pair (pipeline.ts's own copy was
// itself a deliberate P2-S6-FIX byte-for-byte mirror of dedup.ts's, kept in
// sync "by inspection"); `scoring/channel-comparison.ts` carried a third
// copy of just the surname half, pre-extracted to take an `authors` array
// directly (its own `ChannelComparisonItem` already supplies `year` as a
// plain number, so it never needed a year helper at all). The two functions
// below are the one shared implementation, taking the already-extracted
// primitive fields (`publishedAt` string / `authors` array) rather than a
// RawItem, so every call site — RawItem-shaped or not — can pass its own
// field without a wrapper: `publishedYearOf(item.publishedAt)` /
// `firstAuthorSurnameOf(item.authors)` at the two RawItem call sites,
// `firstAuthorSurnameOf(candidateAuthors)` at channel-comparison.ts's.
// Behaviour is byte-identical to the three deleted copies — proved by the
// existing dedup.test.ts / pipeline.rrf.test.ts / channel-comparison.test.ts
// suites stayed green across the swap, including pipeline.rrf.test.ts's own
// "Jane Doe" vs "Doe, Jane" (First-Last vs Last-First) coverage.

/**
 * Published year parsed from a RawItem-style `publishedAt` (leading 4-digit
 * year, e.g. "2024-05-01" -> 2024); undefined when absent or unparseable.
 * Never throws.
 */
export function publishedYearOf(publishedAt: string | undefined): number | undefined {
  const m = /^(\d{4})/.exec(publishedAt ?? "");
  return m ? Number(m[1]) : undefined;
}

/**
 * Best-effort surname of the first listed author, for the title+year+author
 * dedupe/weak-link fallback only (not part of canonical-identity.ts, since
 * P4's delivery-exclusion reuse of that module never needs author parsing).
 * Handles "First Last" and "Last, First" shapes; anything else falls back to
 * the last whitespace-separated token. Never throws.
 */
export function firstAuthorSurnameOf(authors: string[] | undefined): string | undefined {
  const first = authors?.[0]?.trim();
  if (!first) return undefined;
  if (first.includes(",")) {
    const surname = first.split(",")[0]?.trim();
    return surname || undefined;
  }
  const parts = first.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}
