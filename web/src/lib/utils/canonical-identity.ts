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
//   1. Dedupe (`sameCanonicalWork`, below) merges only on a shared REAL
//      id-form key, or on normalized-title + year(+-1) + first-author
//      surname — and never merges on title alone when both sides ALSO carry
//      a real id-form key that conflicts (e.g. a preprint DOI vs a journal
//      DOI on the same title): a false merge silently deletes a paper, so
//      dedupe stays conservative.
//   2. `isDeliveredIdentity` (for P4) is deliberately looser: key OR ANY
//      alias intersecting the owner's ledger is enough, specifically so a
//      preprint shown once can't resurface as the published version under a
//      different DOI once the title matches. A false exclusion there only
//      loses one candidate; a false re-delivery breaks the user's hard rule.

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

function normalizeSurname(s: string | undefined): string | undefined {
  const t = s?.trim().toLowerCase();
  return t || undefined;
}

/**
 * Dedupe's own matching rule (§1p.A(1)): true if both records share a real
 * id-form key, OR their normalized titles are equal (and qualify for a
 * title alias) with published years within 1 of each other and the same
 * first-author surname. If BOTH records carry a real id-form key and none
 * matched, that's a conflict (e.g. a preprint DOI vs a journal DOI sharing a
 * title) — title/year/author is never allowed to override two confirmed,
 * disagreeing external identities, so this returns false rather than
 * guessing which one is "right."
 */
export function sameCanonicalWork(a: WorkMatchInput, b: WorkMatchInput): boolean {
  const aIds = idFormKeys(a.identity);
  const bIds = idFormKeys(b.identity);
  const bIdSet = new Set(bIds);
  for (const k of aIds) {
    if (bIdSet.has(k)) return true;
  }
  if (aIds.length > 0 && bIds.length > 0) return false;

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
