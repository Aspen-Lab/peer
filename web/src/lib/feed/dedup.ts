import type { RawItem, SourceId } from "@/lib/sources/types";
import { idFormKeys, normalizeDoi, type WorkMatchInput } from "@/lib/utils/canonical-identity";
import { clusterCanonicalWorks, identityForRawItem } from "@/lib/feed/paper-identity";
import type { FeedAdmissionChannel } from "@/lib/scoring/types";

// P2-S1 (Round 3): F-A-P2-01 fix, per ABC-JEV-INTEGRATION.md §1p.A and
// docs/jev-abc/P2-B-20260924T0345Z.md. The previous implementation keyed
// purely on the first 8 (length>2) title tokens, sorted — two genuinely
// different papers whose titles happened to share that truncated token set
// silently collapsed into one, with the loser gone and no trace (see
// dedup.test.ts's "old truncated-token key" case for the reproduction this
// replaces). This version uses the shared canonical-identity module: merge
// only on a real shared id-form key (DOI/S2/OpenAlex/arXiv/PMID), or on
// normalized-title + year(+-1) + first-author surname when neither side has
// a conflicting id-form key. A merge survivor keeps the union of every
// source's identity via `metadata.mergedFrom`; nothing is ever silently
// dropped — an unkeyable item always stands alone.
//
// P2-S1-FIX (Round 3, §1p.G): the first version of this file composed many
// pairwise `sameCanonicalWork` checks through plain union-find, which let a
// third, ID-less, title/year/author-matching record transitively bridge two
// items that directly, correctly conflict (different DOIs) into one silent
// merge — see docs/jev-abc/P2-S1-A-20260924T0438Z.md's TRANSITIVITY CHECK.
// The actual clustering (strong links, then weak links evaluated BETWEEN
// pass-1 clusters with a conflict-aware component collapse) now lives in
// `@/lib/feed/paper-identity`'s `clusterCanonicalWorks` — a reusable pure
// function over `WorkMatchInput[]`, so other slices (e.g. the S2-vs-OpenAlex
// channel-comparison harness) can share the identical, provably
// order-independent rule instead of keeping their own copy. This file's own
// remaining job is RawItem-specific:
//   - survivor selection: highest SOURCE_PRIORITY, then more of the item's
//     OWN id-form keys, then lexicographically smallest item id — a total
//     order, so a same-priority tie (e.g. dblp vs pubmed, both weight 2) no
//     longer depends on which one appears first in the input array
//     (F-A-P2S1-04);
//   - `metadata.mergedFrom` provenance (unchanged) plus new
//     `metadata.mergedAliases` — the union of every member's own id-form
//     keys/aliases — so `identityForRawItem` can re-derive the survivor's
//     full identity later without re-walking the merge (F-A-P2S1-02);
//   - a DOI missing on the survivor itself, backfilled from a member only
//     when that member's DOI is the cluster's ONLY distinct DOI (never a
//     guess between two disagreeing ones).

const SOURCE_PRIORITY: Record<SourceId, number> = {
  semantic_scholar: 5,
  arxiv: 4,
  openalex: 3,
  pubmed: 2,
  dblp: 2,
  web: 1,
  hn: 1,
};

function publishedYearOf(item: RawItem): number | undefined {
  const m = /^(\d{4})/.exec(item.publishedAt ?? "");
  return m ? Number(m[1]) : undefined;
}

/**
 * Best-effort surname of the first listed author, for the title+year+author
 * dedupe fallback only (not part of canonical-identity.ts, since P4's
 * delivery-exclusion reuse of that module never needs author parsing).
 * Handles "First Last" and "Last, First" shapes; anything else falls back to
 * the last whitespace-separated token.
 */
function firstAuthorSurnameOf(item: RawItem): string | undefined {
  const first = item.authors?.[0]?.trim();
  if (!first) return undefined;
  if (first.includes(",")) {
    const surname = first.split(",")[0]?.trim();
    return surname || undefined;
  }
  const parts = first.split(/\s+/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : undefined;
}

/**
 * Raw (un-normalized) DOI string a RawItem carries, checking both places
 * canonical-identity.ts itself accepts one from (own `.doi`, or a
 * cross-source `.externalIds.doi`). Used only for the survivor DOI-backfill
 * rule below — never for identity/key computation, which already goes
 * through `identityForRawItem`.
 */
function rawDoiOf(item: RawItem): string | undefined {
  return item.metadata?.doi ?? item.metadata?.externalIds?.doi;
}

export function dedupItems(items: RawItem[]): RawItem[] {
  if (items.length === 0) return [];

  const identities = items.map((item) => identityForRawItem(item));
  const matchInputs: WorkMatchInput[] = items.map((item, i) => ({
    identity: identities[i],
    publishedYear: publishedYearOf(item),
    firstAuthorSurname: firstAuthorSurnameOf(item),
  }));

  const finalGroups = clusterCanonicalWorks(matchInputs);

  function isBetterSurvivor(i: number, best: number): boolean {
    const pI = SOURCE_PRIORITY[items[i].source] ?? 0;
    const pBest = SOURCE_PRIORITY[items[best].source] ?? 0;
    if (pI !== pBest) return pI > pBest;
    const cI = idFormKeys(identities[i]).length;
    const cBest = idFormKeys(identities[best]).length;
    if (cI !== cBest) return cI > cBest;
    return items[i].id < items[best].id;
  }

  const result: RawItem[] = [];
  for (const idxs of finalGroups) {
    if (idxs.length === 1) {
      result.push(items[idxs[0]]);
      continue;
    }

    let survivorIdx = idxs[0];
    for (const i of idxs) {
      if (isBetterSurvivor(i, survivorIdx)) survivorIdx = i;
    }
    const survivor = items[survivorIdx];
    const loserIdxs = idxs.filter((i) => i !== survivorIdx);

    const mergedFrom = [
      ...(survivor.metadata?.mergedFrom ?? []),
      ...loserIdxs.map((i) => ({ source: items[i].source, id: items[i].id })),
      ...loserIdxs.flatMap((i) => items[i].metadata?.mergedFrom ?? []),
    ];

    // Union of every member's OWN id-form keys/aliases (title alias
    // included), so the survivor's full identity is re-derivable later via
    // `identityForRawItem` without re-walking the merge (closes F-A-P2S1-02).
    // Already-merged-in aliases from an earlier merge pass are folded in
    // too, so a second-generation merge never loses the first.
    const aliasUnion = new Set<string>();
    for (const i of idxs) {
      aliasUnion.add(identities[i].key);
      for (const a of identities[i].aliases) aliasUnion.add(a);
      for (const a of items[i].metadata?.mergedAliases ?? []) aliasUnion.add(a);
    }

    // P2-S3 (Round 3) — F-A-P2-03, ABC-JEV-INTEGRATION.md §1p.A/G. Union of
    // every member's admission-channel tags (order of first appearance,
    // deduplicated), the same shape as the alias union just above: a paper
    // found independently via a keyword source AND a non-literal channel
    // (e.g. citation-neighborhood) keeps BOTH tags on the survivor, rather
    // than only whichever single member happened to win survivor selection.
    // Left unset (not an empty array) when no member carried a tag at all,
    // so a merge nobody tagged stays byte-identical to before this field
    // existed.
    const channelUnion: FeedAdmissionChannel[] = [];
    for (const i of idxs) {
      for (const channel of items[i].admissionChannels ?? []) {
        if (!channelUnion.includes(channel)) channelUnion.push(channel);
      }
    }

    // A DOI missing on the survivor itself may be backfilled from a member
    // only when that member's DOI is the cluster's ONLY distinct DOI — never
    // a guess between two disagreeing ones.
    let doi = survivor.metadata?.doi;
    if (!doi) {
      const doiValues = new Map<string, string>(); // normalized -> first raw seen
      for (const i of idxs) {
        const raw = rawDoiOf(items[i]);
        if (!raw) continue;
        const norm = normalizeDoi(raw);
        if (!norm) continue;
        if (!doiValues.has(norm)) doiValues.set(norm, raw);
      }
      if (doiValues.size === 1) {
        doi = Array.from(doiValues.values())[0];
      }
    }

    result.push({
      ...survivor,
      ...(channelUnion.length > 0 ? { admissionChannels: channelUnion } : {}),
      metadata: {
        ...survivor.metadata,
        ...(doi ? { doi } : {}),
        mergedFrom,
        mergedAliases: Array.from(aliasUnion),
      },
    });
  }
  return result;
}
