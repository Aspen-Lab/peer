// P2-S1 (Round 3) — shared canonical paper identity.
//
// One module, reused by dedupe (`feed/dedup.ts`) today and, per
// ABC-JEV-INTEGRATION.md §1p.A, by the P4 delivery ledger, rollover, the
// comparison harness (P2-S5) and RRF provenance (P2-S6) later. Nothing here
// makes a network call or throws — every function is pure and defensive, so
// a malformed upstream record degrades to "unkeyable," never a crash.
//
// Key priority (§1p.A): doi: -> s2: -> openalex: -> arxiv: (version suffix
// stripped) -> pmid: -> title:. `aliases` holds every OTHER id-form key the
// item carries, plus a title alias (normalized full title, no year, emitted
// only when the title has >=4 tokens of length >=3 — a generic title like
// "Editorial" gets no title alias, so it can't become a false matching hook).
//
// Two different rules read this identity, deliberately asymmetric:
//   1. Dedupe (`feed/paper-identity.ts`'s `clusterCanonicalWorks` — NOT this
//      file; see R3-CLEANUP-3 below) merges pass-1 clusters transitively on
//      a shared REAL id-form key; a weak-linked component of clusters
//      (normalized-title + year(+-1) + first-author surname) then collapses
//      into one survivor only if every cross-cluster pair in it directly
//      satisfies that weak-link test — ids play no part in the decision
//      (DEDUP-FIX3, ABC-JEV-INTEGRATION.md §4 Round 3 "structural pairwise
//      rule ruled", 2026-09-24T22:06:02Z): a false merge silently deletes a
//      paper, so dedupe stays conservative about anything that isn't
//      directly a version pair, while still merging genuine versions of one
//      work minted under different DOIs (e.g. Zenodo).
//   2. `isDeliveredIdentity` (for P4) is deliberately looser: key OR ANY
//      alias intersecting the owner's ledger is enough, specifically so a
//      preprint shown once can't resurface as the published version under a
//      different DOI once the title matches. A false exclusion there only
//      loses one candidate; a false re-delivery breaks the user's hard rule.
//
// R3-CLEANUP-3 (Round 3, same ruling as above, "remove the unused
// sameCanonicalWork"): this file used to also export a per-pair
// `sameCanonicalWork` encoding rule 1's ORIGINAL, since-twice-superseded
// form. It had zero production callers (dedupe's actual clustering needs a
// cluster-level, not pairwise, conflict check) and was removed as dead code
// — see `feed/paper-identity.ts` for the real dedupe rule.

export interface CanonicalPaperExternalIds {
  doi?: string;
  arxivId?: string;
  pmid?: string;
  openalexId?: string;
  s2Id?: string;
}

export interface CanonicalPaperInput {
  /** The RawItem's own source, e.g. "openalex" | "semantic_scholar" | "arxiv" | "pubmed" | "dblp" | ... */
  source?: string;
  /** The RawItem's own id, already formatted "<source>:<nativeId>" by every adapter. */
  id?: string;
  doi?: string;
  title?: string;
  /** Cross-source ids the adapter's own response already carried (e.g. S2's externalIds.ArXiv/.PubMed). */
  externalIds?: CanonicalPaperExternalIds;
}

export interface CanonicalIdentity {
  key: string;
  keyVersion: 1;
  aliases: string[];
}

export interface WorkMatchInput {
  identity: CanonicalIdentity;
  publishedYear?: number;
  firstAuthorSurname?: string;
}

const DOI_PREFIX_RE = /^(?:https?:\/\/(?:dx\.)?doi\.org\/|doi:\s*)/i;
// CrossRef's own DOI shape: "10." + 4-9 digit registrant + "/" + a suffix
// with no whitespace. Anything else is treated as malformed rather than
// guessed at.
const DOI_SHAPE_RE = /^10\.\d{4,9}\/\S+$/;

// DEDUP-ANGEW (ABC-JEV-INTEGRATION.md §1aw,
// docs/jev-abc/DEDUP-ANGEW-B-20260929T064532Z.md): Wiley mints two parallel
// DOIs for the SAME peer-reviewed Angewandte Chemie article — one under the
// International Edition's "anie" code, one under the German-language
// original's "ange" code — sharing the article's numeric suffix
// (e.g. 10.1002/anie.5600863 / 10.1002/ange.5600863). A production smoke
// check found the two editions shown as separate feed cards: they weak-match
// each other on title/author/date, but in the real candidate pool the anie
// record had already been pass-1 strong-linked (by a real shared DOI) to an
// unrelated PubMed record whose own fields don't weak-match the ange record
// — DEDUP-FIX3's `clustersFullyMatch` (paper-identity.ts) correctly requires
// EVERY cross-cluster pair to weak-match before a component collapses, so
// the split stood. Finite, hardcoded, one-directional alias: an "ange" DOI
// gets ONE extra `doi:` alias pointing at its "anie" sibling's OWN key value
// — the exact string that sibling's `canonicalPaperKey` call already uses as
// `key` — so pass-1's existing shared-id-form-key union (unchanged) merges
// the two editions transitively, the same already-hardened path that
// already merges e.g. two Zenodo DOIs sharing one arXiv id. Purely additive:
// nothing in paper-identity.ts (clustering/weak-link code DEDUP-FIX3
// hardened) is touched. Only the 10.1002 registrant, only an exact "ange."
// journal-code segment, only a numeric suffix (a trailing-letter suffix,
// e.g. a supporting-information DOI, is an accepted, safe-direction miss —
// it stays unmerged, never a false merge).
const DUAL_EDITION_DOI_RE = /^10\.1002\/ange\.(\d+)$/;

/**
 * For a normalized DOI (already run through `normalizeDoi`, so lowercase and
 * prefix-stripped) shaped exactly `10.1002/ange.<digits>`, returns the
 * `doi:` id-form of its Angewandte Chemie International Edition sibling —
 * `doi:10.1002/anie.<digits>` — the literal value that sibling record's own
 * `canonicalPaperKey` call already uses as `key`. Returns `undefined` for
 * every other DOI, including an already-"anie" one (nothing to alias to), a
 * non-1002 registrant, a DOI where "ange" is only a substring of a longer
 * journal code (e.g. "orange"), and a suffix with anything but digits. Never
 * throws.
 */
function dualEditionDoiAlias(doiValue: string): string | undefined {
  const m = DUAL_EDITION_DOI_RE.exec(doiValue);
  if (!m) return undefined;
  return `doi:10.1002/anie.${m[1]}`;
}

/**
 * Lowercase, strip a `https://doi.org/`, `http://dx.doi.org/` (any http(s)/dx
 * combination) or `doi:` prefix, and trim. Returns undefined — never throws —
 * for anything that doesn't end up looking like `10.NNNN/suffix`.
 */
export function normalizeDoi(raw: string | null | undefined): string | undefined {
  if (typeof raw !== "string") return undefined;
  let s = raw.trim();
  if (!s) return undefined;
  s = s.replace(DOI_PREFIX_RE, "").trim();
  if (!s) return undefined;
  s = s.toLowerCase();
  if (!DOI_SHAPE_RE.test(s)) return undefined;
  return s;
}

/** Lowercase, punctuation -> space, collapsed whitespace, trimmed. Never throws. */
export function normalizeTitle(title: string | null | undefined): string {
  if (typeof title !== "string" || !title) return "";
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function qualifyingTokenCount(normalizedTitle: string): number {
  if (!normalizedTitle) return 0;
  return normalizedTitle.split(" ").filter((t) => t.length >= 3).length;
}

/** `title:<normalized full title>` when the title clears the >=4-qualifying-token bar; else undefined. */
function computeTitleAlias(title: string | null | undefined): string | undefined {
  const norm = normalizeTitle(title);
  if (!norm) return undefined;
  if (qualifyingTokenCount(norm) < 4) return undefined;
  return `title:${norm}`;
}

/** Strip a leading "<source>:" prefix from a RawItem-style id, if present. */
function nativePart(id: string | undefined): string | undefined {
  if (!id) return undefined;
  const idx = id.indexOf(":");
  const rest = idx >= 0 ? id.slice(idx + 1) : id;
  const trimmed = rest.trim();
  return trimmed || undefined;
}

function resolveIdTier(
  input: CanonicalPaperInput,
  matchSource: string,
  prefix: string,
  externalIdField: keyof CanonicalPaperExternalIds,
  stripVersionSuffix = false,
): string | undefined {
  const native = input.source === matchSource ? nativePart(input.id) : undefined;
  const cross = input.externalIds?.[externalIdField]?.trim() || undefined;
  let value = native ?? cross;
  if (!value) return undefined;
  if (stripVersionSuffix) value = value.replace(/v\d+$/i, "");
  return `${prefix}:${value}`;
}

/**
 * Build the canonical identity for one paper record. `key` is the single
 * best available id-form (or, last resort, a title/item form); `aliases`
 * carries every OTHER id-form the record has plus a qualifying title alias,
 * so cross-source matching and P4's delivery exclusion both have something
 * to intersect against even when `key` itself doesn't match.
 */
export function canonicalPaperKey(input: CanonicalPaperInput): CanonicalIdentity {
  const doiValue = normalizeDoi(input.doi ?? input.externalIds?.doi);
  const doiCandidate = doiValue ? `doi:${doiValue}` : undefined;
  // DEDUP-ANGEW: an "ange" DOI's extra alias toward its "anie" sibling — see
  // DUAL_EDITION_DOI_RE's doc comment above. Computed from doiValue (not
  // doiCandidate) since dualEditionDoiAlias expects the bare normalized DOI.
  const dualEditionAlias = doiValue ? dualEditionDoiAlias(doiValue) : undefined;
  const s2Candidate = resolveIdTier(input, "semantic_scholar", "s2", "s2Id");
  const openalexCandidate = resolveIdTier(input, "openalex", "openalex", "openalexId");
  const arxivCandidate = resolveIdTier(input, "arxiv", "arxiv", "arxivId", true);
  const pmidCandidate = resolveIdTier(input, "pubmed", "pmid", "pmid");

  const idCandidates = [doiCandidate, s2Candidate, openalexCandidate, arxivCandidate, pmidCandidate].filter(
    (v): v is string => Boolean(v),
  );

  const titleAlias = computeTitleAlias(input.title);
  const aliasSet = new Set<string>();
  let key: string;

  if (idCandidates.length > 0) {
    key = idCandidates[0];
    for (let i = 1; i < idCandidates.length; i++) aliasSet.add(idCandidates[i]);
    if (titleAlias) aliasSet.add(titleAlias);
  } else if (titleAlias) {
    key = titleAlias;
  } else {
    // Never leave `key` empty/undefined: fall back to something guaranteed
    // unique to this record so it can never accidentally collide with an
    // unrelated unkeyable item (acceptance: "empty/unkeyable title kept
    // unconditionally").
    key = `item:${input.id ?? input.source ?? "unknown"}`;
  }

  // DEDUP-ANGEW: added last, unconditionally — whenever dualEditionAlias is
  // present, doiValue (hence doiCandidate) was present too, so `key` is
  // always doiCandidate itself (DOI is priority 1) and can never equal this
  // alias (an "ange" key vs. an "anie" alias are always different strings).
  if (dualEditionAlias) aliasSet.add(dualEditionAlias);

  return { key, keyVersion: 1, aliases: Array.from(aliasSet) };
}

/** True if `identity`'s key or any alias is in `deliveredKeysAndAliases`. Deliberately loose — see file header. */
export function isDeliveredIdentity(
  identity: CanonicalIdentity,
  deliveredKeysAndAliases: ReadonlySet<string>,
): boolean {
  if (!identity) return false;
  if (deliveredKeysAndAliases.has(identity.key)) return true;
  for (const alias of identity.aliases) {
    if (deliveredKeysAndAliases.has(alias)) return true;
  }
  return false;
}

/** The real id-form keys (doi:/s2:/openalex:/arxiv:/pmid:) an identity carries — excludes title:/item: forms. */
export function idFormKeys(identity: CanonicalIdentity): string[] {
  const keys: string[] = [];
  if (!identity.key.startsWith("title:") && !identity.key.startsWith("item:")) {
    keys.push(identity.key);
  }
  for (const alias of identity.aliases) {
    if (!alias.startsWith("title:")) keys.push(alias);
  }
  return keys;
}

/** The title: form an identity carries, whether it's the primary key or an alias. */
export function titleFormOf(identity: CanonicalIdentity): string | undefined {
  if (identity.key.startsWith("title:")) return identity.key;
  return identity.aliases.find((a) => a.startsWith("title:"));
}

// R3-CLEANUP-3 (Round 3, ABC-JEV-INTEGRATION.md §4 Round 3 "DEDUP-FIX fresh
// A: FAILED_REVIEW... narrowed conflict rule ruled", 2026-09-24T21:21:36Z,
// "remove the unused sameCanonicalWork"): this file used to export
// `sameCanonicalWork(a, b)`, a per-PAIR match rule (shared id-form key, or
// title+year(±1)+first-author-surname with neither side carrying a
// conflicting id) that encoded the ORIGINAL §1p.A(1) prose verbatim.
// Grep-confirmed zero production callers (by this C, and independently by
// both the prior DEDUP-FIX C and the fresh DEDUP-FIX-A review before it):
// `feed/paper-identity.ts`'s `clusterCanonicalWorks` deliberately does NOT
// reuse it — clustering needs to evaluate the weak-link rule at the CLUSTER
// level (now `clustersFullyMatch`/`weakPairMatch`, DEDUP-FIX3's structural
// pairwise rule — ids play no part), not as a single pairwise predicate —
// and nothing else in the codebase ever called it. Removed as dead code,
// along with the `normalizeSurname` helper that existed only to support it.
