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
 * The title+year(+-1)+first-author-surname "weak link" rule alone
 * (§1p.A(1)'s fallback tier), with NO id-conflict short-circuit — conflict
 * is handled separately, at the pass-1-cluster level, by `clustersConflict`
 * below. Two items that both happen to carry some real id-form key (of
 * DIFFERENT, non-conflicting types — e.g. one has only an arXiv id, the
 * other only a PMID) are allowed to weak-link here; whether the wider
 * component they land in actually gets to merge is decided separately.
 * This deliberately does NOT reuse `sameCanonicalWork` (which blocks a weak
 * link whenever BOTH sides carry ANY id-form key, regardless of type) —
 * that blanket rule is exactly what made the old per-item union-find unable
 * to express "conflict" as a first-class, transitivity-safe concept.
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

/** The id-form TYPE prefix (e.g. "doi", "arxiv") of an id-form key like "doi:10.1/x". */
function idTypeOf(idFormKey: string): string {
  const idx = idFormKey.indexOf(":");
  return idx >= 0 ? idFormKey.slice(0, idx) : idFormKey;
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
  /** Union of every member's OWN id-form key TYPES (doi/s2/openalex/arxiv/pmid). */
  idTypes: Set<string>;
}

/**
 * Two pass-1 clusters conflict (§1p.G(2)) iff they carry the same id-form
 * TYPE. Pass 1 already transitively unions every item sharing an exact
 * id-form key (type AND value), so two items still in separate clusters can
 * never share an exact key — any type overlap here necessarily means
 * differing values of that type (e.g. two different DOIs), which is exactly
 * the "on conflict keep both" signal §1p.A requires dedupe to respect.
 */
function clustersConflict(a: PassOneCluster, b: PassOneCluster): boolean {
  for (const t of a.idTypes) {
    if (b.idTypes.has(t)) return true;
  }
  return false;
}

/**
 * The corrected, order-independent clustering step (§1p.G(1)-(3)): strong
 * links (shared id-form key) union transitively first; weak links
 * (title+year+author) are then evaluated BETWEEN the resulting pass-1
 * clusters, not raw items, and a weak-linked component of clusters collapses
 * into one group only if no two clusters anywhere in it conflict. Any
 * conflict anywhere in the component blocks the WHOLE component — every
 * pass-1 cluster in it stays its own separate group — rather than guessing
 * which side is "right."
 *
 * This is what fixes the transitivity bug a plain per-item union-find has:
 * a bridging record with no id-form key (e.g. a dblp entry) can still
 * connect two conflicting, ID-bearing clusters into one weak-link
 * component, but the conflict inside that component now blocks the whole
 * component from merging, instead of being silently outvoted by two
 * separate pairwise unions (A-B union, B-C union, transitively joining A
 * and C despite A-vs-C itself being a correctly-detected conflict).
 *
 * Provably independent of input order: the edge set (which pairs of
 * clusters weak-link) is computed from fixed, precomputed `inputs` and
 * never depends on prior union state or scan order, so the resulting
 * partition is invariant to permuting `inputs`; conflict detection then
 * checks every pair within a component, not just directly-linked ones, so
 * it cannot miss a conflict based on which edge happened to be found first.
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

  // Build the pass-1 clusters (contiguous 0..k-1 index -> member indices +
  // the union of their own id-form key types, used by the conflict check).
  const clusterIndexByRoot = new Map<number, number>();
  const clusters: PassOneCluster[] = [];
  for (let i = 0; i < inputs.length; i++) {
    const root = dsu1.find(i);
    let ci = clusterIndexByRoot.get(root);
    if (ci === undefined) {
      ci = clusters.length;
      clusterIndexByRoot.set(root, ci);
      clusters.push({ memberIdxs: [], idTypes: new Set() });
    }
    clusters[ci].memberIdxs.push(i);
    for (const key of idFormKeys(inputs[i].identity)) clusters[ci].idTypes.add(idTypeOf(key));
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

  // Group pass-1 clusters by weak-link connected component, then decide,
  // per component, whether it's safe to collapse into one group: only if no
  // two clusters anywhere in the component conflict.
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
    let conflict = false;
    for (let a = 0; a < clusterIdxs.length && !conflict; a++) {
      for (let b = a + 1; b < clusterIdxs.length; b++) {
        if (clustersConflict(clusters[clusterIdxs[a]], clusters[clusterIdxs[b]])) {
          conflict = true;
          break;
        }
      }
    }
    if (conflict) {
      for (const ci of clusterIdxs) finalGroups.push(clusters[ci].memberIdxs);
    } else {
      finalGroups.push(clusterIdxs.flatMap((ci) => clusters[ci].memberIdxs));
    }
  }

  return finalGroups;
}
