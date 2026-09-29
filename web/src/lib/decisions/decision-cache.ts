/**
 * The decision cache: "have we already asked Jev this exact question about
 * this exact paper content, for this exact owner, under this exact rubric
 * and model?" (ABC-JEV-INTEGRATION.md §1p.H item "decision path";
 * docs/jev-abc/P3-B-20260924T0525Z.md DESIGN §4 / F-A-P3-03). Deliberately
 * has NO date/calendar component anywhere in its hashed input — unlike the
 * paper-pool cache key, a decision does not go stale merely because a new
 * day started; it goes stale only when the owner, the paper's content, the
 * user's intent, the model, or the rubric actually changed.
 *
 * DESIGN CHOICE (recorded in docs/jev-abc/P3-S3S4-C-*.md): `ownerId` is
 * included INSIDE the hash (this is the task's literal key shape), in
 * addition to `PrivateDecisionCache` also filtering by a separate, unhashed
 * `owner_id` DB column (private-decision-cache.ts) — both true at once,
 * which is strictly MORE defensive than picking only one.
 */

import { createHash } from "node:crypto";
import type { DecisionResult } from "./types";

/** The one decision provider this codebase has — kept as a named constant, not a magic string, at every call site. */
export const DECISION_CACHE_PROVIDER = "typesafe" as const;

export interface DecisionCacheKeyInput {
  ownerId: string;
  /** Optional — not every decision is scoped to a specific project. */
  projectId?: string;
  /** `serializeFeedIntent(intent)` from `feed/intent.ts` — reused as-is, never re-derived. */
  intentHash: string;
  /** `paperContentHash(...)` from `./paper-content-hash` — hash of exactly the paper content a decision was made about. */
  paperContentHash: string;
  provider: string;
  modelVersion: string;
  rubricVersion: string;
}

/**
 * Sha256 over an explicit, fully-enumerated, sorted-by-construction object
 * literal — deliberately NOT a generic canonicalizer over arbitrary
 * caller-supplied fields, so that "every field this hashes" is visible in
 * one place, in this function body, for a fresh A to grep and audit. There
 * is no `now`/`Date` parameter on this function's own signature — the
 * absence is structural, not merely tested.
 */
export function deriveDecisionCacheKey(input: DecisionCacheKeyInput): string {
  const hashInput = {
    ownerId: input.ownerId.trim(),
    projectId: input.projectId?.trim() || null,
    intentHash: input.intentHash,
    paperContentHash: input.paperContentHash,
    provider: input.provider,
    modelVersion: input.modelVersion,
    rubricVersion: input.rubricVersion,
  };
  return createHash("sha256").update(JSON.stringify(hashInput)).digest("hex");
}

/**
 * Mirrors `PoolCache` (`opportunities/pool-cache.ts`) exactly: `get`/`set`
 * keyed by an opaque string this module derives. Implementations must be
 * fail-soft on read (a storage outage is a miss, never a thrown error into a
 * caller deciding whether to call Jev) — see `private-decision-cache.ts`.
 */
export interface DecisionCache {
  get(key: string): Promise<DecisionResult | null>;
  set(key: string, result: DecisionResult): Promise<void>;
}

/**
 * A genuinely working, process-local cache — used directly by tests, and as
 * the cache for unscoped/anonymous requests (which never get a durable
 * cross-process cache: anonymous users never reach a Jev call at all per the
 * entitlement gate, so this is mostly a test convenience, not a live path —
 * DESIGN §4). Unlike `ephemeralPaperPoolCache` (a deliberate no-op), this
 * class really stores what it is given, matching `InMemoryCounterStore`'s
 * established naming convention elsewhere in this codebase: "in-memory"
 * always means "genuinely functional, just not durable or shared."
 */
export class InMemoryDecisionCache implements DecisionCache {
  private readonly entries = new Map<string, DecisionResult>();

  async get(key: string): Promise<DecisionResult | null> {
    return this.entries.get(key) ?? null;
  }

  async set(key: string, result: DecisionResult): Promise<void> {
    this.entries.set(key, result);
  }
}
