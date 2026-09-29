import { createHash } from "node:crypto";

// P2-S7 (Round 3) — F-A-P2-06 (the safe half only) / acceptance 8-identity,
// per ABC-JEV-INTEGRATION.md §1k/§1p.A/§3c and
// docs/jev-abc/P2-B-20260924T0345Z.md.
//
// A pure, offline function that turns one "retrieval recipe" — provider,
// channel, canonical query, semantic definition version, language, date
// interval, filters, page/caps, schema version, scope and refresh epoch —
// into a single stable SHA-256 digest, so two requests describing the exact
// same recipe can recognize each other without re-running the request. It
// makes no network/DB call and has no side effects.
//
// PRIVACY — READ BEFORE WIRING THIS ANYWHERE (§1c/§1k):
//   - A "private" fingerprint (the default; requires `ownerId`) is PERSONAL
//     DATA, not an anonymous cache key. It is derived from one owner's own
//     query/filters/scope, and hashing it does not make it shareable —
//     "hashes are not anonymization" is a binding ruling in this campaign,
//     not a style note. A private fingerprint must never be used as, or
//     folded into, a PUBLIC/shared cache key, logged in a place other
//     owners can read, or compared across owners for anything other than
//     "is this literally the same owner's own repeated request."
//   - A "public" fingerprint may only be produced when the caller explicitly
//     passes `{ kind: "public", eligibility: "reviewed" }` — there is no
//     default or fallback path into "public" scope. Missing or non-"reviewed"
//     eligibility makes `computeRetrievalIdentityFingerprint` throw rather
//     than silently returning any fingerprint at all, public or otherwise.
//   - This module is NOT wired into any live cache, and must not be, until
//     the isolated DB/RLS-authorized environment §1k requires exists. Today
//     it has no caller outside its own test file. A real shared
//     `retrieval_pools`-style cache keyed by this fingerprint is explicitly
//     future work, not part of this slice.
//
// Determinism: the digest is computed over a canonical JSON encoding (object
// keys sorted recursively, `undefined`/absent fields normalized so "field
// omitted" and "field explicitly cleared" agree) so structurally-identical
// recipes always hash identically regardless of how the caller happened to
// construct the input object. Multi-value filters are treated as unordered
// sets (their own array order does not affect the digest) since a filter
// such as "these topic IDs, in any order" is logically a set, not a
// sequence — see `canonicalizeFilters` below.

export const RETRIEVAL_IDENTITY_FINGERPRINT_VERSION = 1;

export interface RetrievalIdentityDateInterval {
  /** UTC ISO date/datetime string. Treated as an opaque, already-normalized string — this module does not parse, validate or convert timezones. */
  fromUtc: string;
  toUtc: string;
}

export type RetrievalIdentityFilterValue = string | number | boolean | string[];

/**
 * Private defaults, and requires `ownerId` — a private fingerprint is
 * personal data (see file header). Public requires explicit, exact
 * `eligibility: "reviewed"`; there is no other way to reach public scope.
 */
export type RetrievalIdentityScope =
  | { kind: "private"; ownerId: string; projectId?: string }
  | { kind: "public"; eligibility: "reviewed" };

export interface RetrievalIdentityInput {
  provider: string;
  /** Endpoint/channel within the provider, e.g. "works-semantic-search", "recommendations-by-seed". */
  channel: string;
  /** Raw query text; normalized (trim, collapse internal whitespace, lowercase) before hashing — nothing else is stripped, so meaningful punctuation/operators are preserved. */
  query: string;
  semanticDefinitionVersion?: string;
  language: string;
  dateInterval: RetrievalIdentityDateInterval;
  /** Order-independent: key order never affects the digest, and a multi-value (array) filter's own element order doesn't either. */
  filters?: Record<string, RetrievalIdentityFilterValue>;
  page?: number;
  caps?: number;
  schemaVersion: string | number;
  scope: RetrievalIdentityScope;
  /** UTC epoch (whatever precision the caller uses consistently — this module includes it verbatim, it does not interpret or convert it). */
  refreshEpochUtc: number;
}

export interface RetrievalIdentity {
  fingerprint: string;
  fingerprintVersion: typeof RETRIEVAL_IDENTITY_FINGERPRINT_VERSION;
  /** Echoes `input.scope.kind` so a caller/reviewer can see at a glance whether this is personal data (private) or requires reviewed eligibility (public) without re-deriving it. */
  scopeKind: "private" | "public";
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Validated at RUNTIME, not just by the TypeScript type — this input may
 * cross a JSON boundary (an API request body, a persisted job payload)
 * where nothing enforces the discriminated union at compile time. A
 * malformed scope must never silently produce ANY fingerprint: better a
 * thrown error a caller has to handle than a fingerprint whose scope
 * guarantee can't actually be trusted.
 */
function assertValidScope(scope: RetrievalIdentityScope): void {
  const kind = (scope as { kind?: unknown } | null | undefined)?.kind;
  if (kind === "private") {
    const ownerId = (scope as { ownerId?: unknown }).ownerId;
    if (typeof ownerId !== "string" || !ownerId.trim()) {
      throw new Error("retrieval-identity: private scope requires a non-empty ownerId");
    }
    return;
  }
  if (kind === "public") {
    const eligibility = (scope as { eligibility?: unknown }).eligibility;
    if (eligibility !== "reviewed") {
      throw new Error(
        'retrieval-identity: public scope requires explicit eligibility "reviewed" — missing or non-"reviewed" eligibility can never yield a public fingerprint',
      );
    }
    return;
  }
  throw new Error(`retrieval-identity: scope.kind must be "private" or "public", got ${JSON.stringify(kind)}`);
}

/** Multi-value filters are unordered sets: sort a copy of each array value. Drops `undefined` entries so an explicitly-undefined filter value and an absent one hash identically. */
function canonicalizeFilters(
  filters: Record<string, RetrievalIdentityFilterValue> | undefined,
): Record<string, RetrievalIdentityFilterValue> {
  if (!filters) return {};
  const out: Record<string, RetrievalIdentityFilterValue> = {};
  for (const key of Object.keys(filters)) {
    const value = filters[key];
    if (value === undefined) continue;
    out[key] = Array.isArray(value) ? [...value].sort() : value;
  }
  return out;
}

/**
 * Recursively sorts object keys so structurally-equal data serializes
 * identically regardless of construction order, and drops `undefined`
 * values so an omitted field and an explicitly-`undefined` field agree.
 * Arrays keep their own element order — a field that needs order-independence
 * (e.g. filter values) normalizes that itself before reaching this function.
 */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] === undefined) continue;
      sorted[key] = canonicalize(obj[key]);
    }
    return sorted;
  }
  return value;
}

/**
 * Compute the stable digest for one retrieval recipe. Throws (produces no
 * fingerprint at all) when `scope` is missing, has an unknown `kind`, is
 * "private" without a non-empty `ownerId`, or is "public" without exactly
 * `eligibility: "reviewed"` — see `assertValidScope`.
 */
export function computeRetrievalIdentityFingerprint(input: RetrievalIdentityInput): RetrievalIdentity {
  assertValidScope(input.scope);

  const payload = {
    fingerprintVersion: RETRIEVAL_IDENTITY_FINGERPRINT_VERSION,
    provider: input.provider,
    channel: input.channel,
    query: normalizeQuery(input.query),
    semanticDefinitionVersion: input.semanticDefinitionVersion ?? null,
    language: input.language,
    dateInterval: { fromUtc: input.dateInterval.fromUtc, toUtc: input.dateInterval.toUtc },
    filters: canonicalizeFilters(input.filters),
    page: input.page ?? null,
    caps: input.caps ?? null,
    schemaVersion: input.schemaVersion,
    scope: input.scope,
    refreshEpochUtc: input.refreshEpochUtc,
  };

  const canonicalJson = JSON.stringify(canonicalize(payload));
  const fingerprint = createHash("sha256").update(canonicalJson).digest("hex");

  return {
    fingerprint,
    fingerprintVersion: RETRIEVAL_IDENTITY_FINGERPRINT_VERSION,
    scopeKind: input.scope.kind,
  };
}
