/**
 * A hash of "the paper content a decision was made about" — one of the five
 * components of a decision-cache key (`decision-cache.ts`). Deliberately NOT
 * the paper's canonical identity (`web/src/lib/utils/canonical-identity.ts`
 * answers "which paper is this", used by dedupe/the P4 ledger) and NOT the
 * paper's local retrieval/ranking score — a local re-rank must never
 * invalidate a cached decision, but a real content change always should.
 *
 * DESIGN CHOICE (recorded in docs/jev-abc/P3-S3S4-C-*.md for fresh-A review):
 * this hashes the FULL, pre-truncation abstract, not the literal
 * post-truncation text Jev actually saw on the wire. Two reasons, both
 * load-bearing: (1) `jev-contract.ts`'s truncation function is a private,
 * unexported detail of a snapshotted file this slice must not modify or
 * hand-duplicate; (2) a cache LOOKUP must happen before any decision to call
 * Jev at all, so "the literal truncated text" is not actually available at
 * lookup time without redundantly re-deriving it. Truncation is a pure,
 * deterministic function of (full abstract, fixed budget), so hashing the
 * full abstract is at least as discriminating as hashing the truncated text
 * for every case that matters, and strictly more CONSERVATIVE in the one
 * case where they differ (an edit entirely past the truncation cutoff causes
 * an unnecessary cache miss, never a wrongful cache hit — the safe
 * direction, never the dangerous one).
 */

import { createHash } from "node:crypto";

export interface PaperContentInput {
  title: string;
  abstract: string | null;
  venue?: string;
}

function normalizedOrNull(value: string | undefined): string | null {
  if (value === undefined) return null;
  const trimmed = value.trim();
  return trimmed || null;
}

/**
 * Pure, synchronous, no date/clock input of any kind — the absence of a
 * `now`/`Date` parameter on this signature is itself the guarantee that this
 * hash can never carry a date component, not merely a claim proven by tests.
 */
export function paperContentHash(input: PaperContentInput): string {
  const normalized = {
    title: input.title.trim(),
    abstract: input.abstract === null ? null : input.abstract.trim(),
    venue: normalizedOrNull(input.venue),
  };
  return createHash("sha256").update(JSON.stringify(normalized)).digest("hex");
}
