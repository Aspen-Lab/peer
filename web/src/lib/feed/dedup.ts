import type { RawItem, SourceId } from "@/lib/sources/types";
import { idFormKeys, normalizeDoi, type WorkMatchInput } from "@/lib/utils/canonical-identity";
import {
  clusterCanonicalWorks,
  firstAuthorSurnameOf,
  identityForRawItem,
  publishedYearOf,
} from "@/lib/feed/paper-identity";
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
// The actual clustering now lives in `@/lib/feed/paper-identity`'s
// `clusterCanonicalWorks` — a reusable pure function over `WorkMatchInput[]`,
// so other slices (e.g. the S2-vs-OpenAlex channel-comparison harness) can
// share the identical, provably order-independent rule instead of keeping
// their own copy: strong links (shared id-form key) union transitively
// first, then weak links (title+year+author) are evaluated BETWEEN the
// resulting pass-1 clusters. DEDUP-FIX3 (ABC-JEV-INTEGRATION.md §4 Round 3
// "DEDUP-FIX2 fresh A: FAILED_REVIEW (scoped; R3-CLEANUP-3 VERIFIED);
// whack-a-mole stop; structural pairwise rule ruled; DEDUP-FIX3 C assigned",
// 2026-09-24T22:06:02Z, replacing DEDUP-FIX2's id-form-TYPE-based conflict
// check, which two independent reviews found still missed false merges
// whenever the disputed record carried no id or an id of the wrong type): a
// weak-linked component of clusters collapses into one group only if EVERY
// pair of records drawn from DIFFERENT pass-1 clusters in that component
// directly satisfies the weak-link test — checked over the full member
// cross-product of every pair of clusters in the component, with ids never
// consulted at all. One failing cross-cluster pair blocks the WHOLE
// component, so a genuine version pair (the observed Zenodo regression)
// still merges (a direct pair trivially satisfies "every" pair, since
// there's only one), while a purely transitive bridge or an unrelated
// record swept in through only one member of a strong-link cluster is
// caught regardless of what ids either side happens to carry — see
// `clusterCanonicalWorks`'s own doc comment for the full mechanism.
// R3-CLEANUP-3: `publishedYearOf`/`firstAuthorSurnameOf`
// (used just below, in `matchInputs`) are imported from that same module
// rather than defined here, so this file, `pipeline.ts` and
// `channel-comparison.ts` share one implementation instead of three copies.
// This file's own remaining job is RawItem-specific:
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

// DEDUP-ANGEW fix round (ABC-JEV-INTEGRATION.md §1aw AMENDMENT,
// docs/jev-abc/DEDUP-ANGEW-A-20260929T070428Z.md Check 3, HIGH): the
// dual-edition DOI alias (canonical-identity.ts's `dualEditionDoiAlias`) is
// deliberately one-directional — only a "10.1002/ange.N" record gains the
// extra `doi:10.1002/anie.N` alias, an "anie" record gets no reciprocal
// alias — so the "ange" record always carries one MORE id-form key
// (`idFormKeys(identity).length`) than its "anie" sibling. That silently
// made the German-language "ange" edition always win `isBetterSurvivor`'s
// SOURCE_PRIORITY-tied tie-break, in every arrival order (both editions are
// typically the same source, e.g. openalex): the reader's card showed the
// "ange" edition's bare `doi.org/10.1002/ange.N` redirect link and its more
// ambiguous venue name ("Angewandte Chemie") instead of the International
// Edition's direct PDF link and its clearer venue name ("Angewandte
// Chemie International Edition") — confirmed live and by a 4-arrival-order
// probe in A's review. Named, additive survivor preference, ADDED ON TOP OF
// `isBetterSurvivor` rather than folded into it: within one merged group, if
// some member's OWN doi is exactly "10.1002/anie.<N>" and some OTHER
// member's OWN doi is exactly "10.1002/ange.<N>" for that SAME N, survivor
// selection is narrowed to just the member(s) that directly carry that
// literal anie DOI — e.g. the real anie record AND a strong-linked PubMed
// twin that also happens to carry the same anie DOI both qualify, and
// `isBetterSurvivor` (unchanged) then picks among only THOSE exactly as it
// always has, so a genuine multi-source report of the SAME anie DOI still
// resolves exactly as before. The "ange" member and any other member are
// simply never eligible to win in this case — never a tie-break preference
// that could still lose, an outright restriction of the candidate pool.
// Returns `null` (falls through to today's unrestricted candidate list)
// whenever no such pair exists in the group, so a group with no dual-edition
// pair is completely unaffected — provably, not just tested (every existing
// dedup.test.ts fixture before this fix round used DOIs that can never match
// either pattern below, and this function's only observable effect is
// narrowing the CANDIDATE SET passed into the existing, untouched
// `isBetterSurvivor` loop; `loserIdxs`, hence `mergedFrom`/`mergedAliases`/
// `channelUnion`/DOI-backfill below, still runs over the FULL group either
// way). Order-independent by construction, not by luck: `anieDoiOwners`/the
// returned Set are built from group MEMBERSHIP, never from scan order, and
// `isBetterSurvivor`'s own max-selection loop already converges to the same
// unique winner regardless of visiting order (a strict total order — unique
// `id`s make the final lexicographic step a true tie-breaker) — restricting
// its input to an order-independent subset preserves that same property.
// Neither `dualEditionDoiAlias` (canonical-identity.ts) nor
// `paper-identity.ts`'s clustering/weak-link code is touched by this.
const ANGE_DOI_RE = /^10\.1002\/ange\.(\d+)$/;

function dualEditionSurvivorCandidates(items: RawItem[], idxs: number[]): number[] | null {
  const anieDoiOwners = new Map<string, number[]>(); // normalized doi -> member idxs whose OWN doi is exactly this
  for (const i of idxs) {
    const doi = normalizeDoi(rawDoiOf(items[i]));
    if (!doi) continue;
    const owners = anieDoiOwners.get(doi);
    if (owners) owners.push(i);
    else anieDoiOwners.set(doi, [i]);
  }

  const preferred = new Set<number>();
  for (const i of idxs) {
    const doi = normalizeDoi(rawDoiOf(items[i]));
    const m = doi ? ANGE_DOI_RE.exec(doi) : null;
    if (!m) continue;
    const anieSibling = `10.1002/anie.${m[1]}`;
    const owners = anieDoiOwners.get(anieSibling);
    if (owners) for (const j of owners) preferred.add(j);
  }

  return preferred.size > 0 ? Array.from(preferred) : null;
}

export function dedupItems(items: RawItem[]): RawItem[] {
  if (items.length === 0) return [];

  const identities = items.map((item) => identityForRawItem(item));
  const matchInputs: WorkMatchInput[] = items.map((item, i) => ({
    identity: identities[i],
    publishedYear: publishedYearOf(item.publishedAt),
    firstAuthorSurname: firstAuthorSurnameOf(item.authors),
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

    // DEDUP-ANGEW fix round: narrowed to the anie side of a dual-edition
    // pair when one is present in this group; unrestricted (`idxs`)
    // otherwise — see `dualEditionSurvivorCandidates`'s own doc comment.
    const survivorCandidates = dualEditionSurvivorCandidates(items, idxs) ?? idxs;
    let survivorIdx = survivorCandidates[0];
    for (const i of survivorCandidates) {
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
