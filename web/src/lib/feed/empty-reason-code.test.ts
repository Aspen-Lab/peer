import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { identityForRawItem } from "./paper-identity";
import { FEED_INTENT_VERSION } from "./intent";
import { MemoryDashboardDeliveryLedger, type PaperIdentity } from "@/lib/dashboard/delivery-ledger";

// EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb; guide
// docs/jev-abc/EMPTY-STATE-REASON-B-20260929T113729Z.md §4). Pipeline-level
// tests for `meta.emptyReasonCode`: one constructed pool per waterfall step
// (sources-unreachable -> no-results -> no-required-match -> already-
// delivered), two precedence guards, and the non-empty regression. No
// network — every source is mocked, exactly like pool-degraded.test.ts and
// ledger-exclusion.test.ts, whose fixture conventions this file reuses.

class MemoryPoolCache implements PoolCache {
  readonly values = new Map<string, CachedPool>();

  async get(key: string): Promise<CachedPool | null> {
    return this.values.get(key) ?? null;
  }

  async set(key: string, pool: CachedPool): Promise<void> {
    this.values.set(key, pool);
  }
}

const originalOpenalexFetch = bySourceId.openalex.fetch;
const originalS2Fetch = bySourceId.semantic_scholar.fetch;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
  resetCounterStoreForTests();
});

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  bySourceId.semantic_scholar.fetch = originalS2Fetch;
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

function scopeFor(ownerId: string) {
  return createTrustedPaperCacheScope({
    ownerId,
    project: "solid-state battery research",
    topics: ["solid-state battery"],
    aiTier: 0,
  });
}

// Title/abstract literally carry the request topic, mirroring
// pool-degraded.test.ts's own `paperFrom` — the pre-existing literal-keyword
// admission gate is not this file's business, so every "should clear the
// Required gate" fixture avoids it entirely.
const matchingPaper = (id: string, publishedAt = "2026-07-20"): RawItem => ({
  id: `openalex:${id}`,
  source: "openalex",
  title: "Solid-State Battery Electrolyte Research Note",
  authors: ["A. Researcher"],
  abstract: "Solid-state battery electrolyte design improves electrochemical stability.",
  url: `https://example.org/${id}`,
  publishedAt,
  venue: "Journal of Testing",
  tags: ["solid-state battery"],
  metadata: {},
});

// Shares no content word with "solid-state battery" — must fail every T1-T4
// admission path (literal, self-declared abbreviation, source subject tag,
// similarity fallback).
const nonMatchingPaper = (id: string): RawItem => ({
  id: `openalex:${id}`,
  source: "openalex",
  title: "Left-Handed Guitar Restringing Techniques",
  authors: ["B. Researcher"],
  abstract: "A step-by-step guide to restringing a left-handed acoustic guitar.",
  url: `https://example.org/${id}`,
  publishedAt: "2026-07-20",
  venue: "Hobbyist Quarterly",
  tags: [],
  metadata: {},
});

/** Same real-ledger seeding technique as ledger-exclusion.test.ts's
 *  `deliveredKeysFor`: proves the ledger's actual return shape, not an
 *  invented stand-in. */
async function deliveredKeysFor(...papers: PaperIdentity[]): Promise<ReadonlySet<string>> {
  const ledger = new MemoryDashboardDeliveryLedger();
  const batch = await ledger.prepareBatch("owner-esr-ledger", "2026-07-29", papers);
  await ledger.acknowledgeBatch("owner-esr-ledger", batch.id);
  return ledger.listDelivered("owner-esr-ledger");
}

describe("emptyReasonCode waterfall (EMPTY-STATE-REASON)", () => {
  it("sources-unreachable: every attempted academic source's fetch rejects", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated total outage");
    });
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-1"),
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("sources-unreachable");
  });

  it("no-results: every source resolves with zero candidates (no rejection)", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => []);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-2"),
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("no-results");
  });

  it("no-results: candidates exist but every one is outside the freshness ceiling", async () => {
    // 2024-01-01 -> 2026-07-29 is well past even the "month" window's
    // 180-day ceiling (freshness.ts's CEILING_DAYS), so this is stale under
    // any freshness setting, not just the request's actual one.
    bySourceId.openalex.fetch = vi.fn(async () => [matchingPaper("old-1", "2024-01-01")]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-3"),
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("no-results");
  });

  // NOTE ON CONSTRUCTION: `pool.items` (what a fresh BUILD caches) is itself
  // already gate-filtered — `buildPaperPool` runs the exact same
  // `scorePaperCandidates` gate at build time (pipeline.ts:~910) before
  // anything is cached, using the SAME `req` a single fresh
  // `runFeedPipeline` call also reads with. So a candidate that fails the
  // gate can never survive into a freshly-built `pool.items` at all — inside
  // ONE black-box call, "gate rejects it" and "it was never fetched"
  // collapse to the same observable thing (`inWindow.length === 0`), i.e.
  // "no-results", not "no-required-match" (confirmed by running this file:
  // both cases below returned "no-results" before being rewritten this way).
  // Two real pipeline mechanisms make the gate-vs-fetch distinction
  // observable from outside, and each test below uses the one that matches
  // its scenario:
  it("no-required-match: an in-window candidate shares no content word with the Required topic (via a rollover candidate, read-time-only and UNGATED by the build)", async () => {
    // `rolloverCandidates` (yesterday's unshown remainder, `rollover.test.ts`)
    // is merged in at READ time, after the cache read, before dropStale/the
    // gate — never through the build-time gate at all (pipeline.ts's own
    // comment on `poolItemsWithRollover`). That makes it the one real,
    // already-tested mechanism that can put a candidate in front of the
    // read-time gate without it ever having passed a build-time one.
    bySourceId.openalex.fetch = vi.fn(async () => []); // nothing fetched fresh
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-4"),
      },
      { cache, now, rolloverCandidates: [nonMatchingPaper("nomatch-1")] },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("no-required-match");
  });

  it("no-required-match: a candidate that would otherwise match also contains a reader-declared exclusion term", async () => {
    // `intent.exclusions` is reader-specific and, per `derivePoolCacheKey`
    // (pool-cache.ts), NOT part of the pool's cache key/identity — only
    // `preferenceLedger` is explicitly documented as read-time-only, but
    // reading `derivePoolCacheKey`'s own signature confirms exclusions are
    // in the same boat. So: build the pool with NO exclusion (the candidate
    // clears the gate and is cached), then read the SAME cache with a
    // SECOND call whose req adds the exclusion — a genuine cache hit, whose
    // read-time-only re-score is what actually drops it.
    const paper = matchingPaper("excluded-1");
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    const scope = scopeFor("owner-esr-5");

    const primed = await runFeedPipeline(
      { topics: ["solid-state battery"], sources: ["openalex"], aiTier: 0, paperCacheScope: scope },
      { cache, now },
    );
    expect(primed.items.map((i) => i.id)).toContain(paper.id); // sanity: it was cached

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scope,
        intent: {
          version: FEED_INTENT_VERSION,
          project: { presence: "omitted" },
          challenge: { presence: "omitted" },
          requiredConcepts: [],
          preferredConcepts: [],
          // "electrolyte" is literally in matchingPaper's title/abstract —
          // the reader's own declared exclusion hard-drops it in pass 1
          // (combine.ts), before the review-filter/T1-T4 gate logic runs.
          exclusions: [{ kind: "exclude-term", value: "electrolyte" }],
          methods: [],
          selectedSenseConcepts: [],
        },
      },
      { cache, now },
    );

    expect(bySourceId.openalex.fetch).toHaveBeenCalledTimes(1); // 2nd call was a cache hit
    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("no-required-match");
  });

  it("already-delivered: a candidate that clears the Required gate is removed by excludeIds", async () => {
    const paper = matchingPaper("delivered-1");
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-6a"),
        excludeIds: [paper.id],
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("already-delivered");
  });

  it("already-delivered: a candidate that clears the Required gate is removed by ledgerExclusions", async () => {
    const paper = matchingPaper("delivered-2");
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    const identity = identityForRawItem(paper);
    const ledgerExclusions = await deliveredKeysFor({
      key: identity.key,
      aliases: identity.aliases,
    });

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-6b"),
      },
      { cache, now, ledgerExclusions },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("already-delivered");
  });

  // Precedence guards (§4 test 7) — mutation-style: prove the waterfall
  // checks the STRONGER condition ("every" source failed; "anything" cleared
  // the gate) rather than a weaker one that would misclassify these exact
  // shapes.
  it("precedence: a partial source failure plus zero in-window candidates resolves as no-results, not sources-unreachable", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => {
      throw new Error("openalex: simulated outage");
    });
    bySourceId.semantic_scholar.fetch = vi.fn(async () => []); // succeeds, empty
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex", "semantic_scholar"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-7a"),
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("no-results");
  });

  it("precedence: one candidate fails the Required gate while another clears it and is then excluded — reports already-delivered, not no-required-match", async () => {
    const cleared = matchingPaper("cleared-1");
    const failedGate = nonMatchingPaper("failed-gate-1");
    bySourceId.openalex.fetch = vi.fn(async () => [cleared, failedGate]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-7b"),
        excludeIds: [cleared.id],
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("already-delivered");
  });

  // EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj.5) -- accepted, §1bj.5
  // (paperCount is 5 | 10). computeEmptyReasonCode never sees `topN`; it only
  // reads `sourceStatus`/`inWindow.length`/`scored.length` (pipeline.ts,
  // this file's own describe-block header comment). When a candidate clears
  // every gate (`scored.length > 0`) but `topN` is 0, `returned` is sliced to
  // `[]` regardless, and the waterfall's 4th branch fires: "already-
  // delivered" -- even though nothing was ever actually excluded by
  // `excludeIds`/`ledgerExclusions`. `FeedControls.paperCount` is typed
  // `5 | 10` at the TypeScript level (profile-compiler.ts) and no live UI
  // path is known to write 0, so this is a named, accepted risk in the
  // shared waterfall function, pinned here rather than fixed (manager
  // ruling, not this test's call) -- a future partial fix must be a
  // deliberate, visible change to this assertion, not a silent one.
  it("topN 0 mislabels an otherwise-qualifying candidate as already-delivered, with NO exclusion supplied anywhere (accepted, §1bj.5 (paperCount is 5 | 10))", async () => {
    const paper = matchingPaper("topn-zero-1");
    bySourceId.openalex.fetch = vi.fn(async () => [paper]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-topn0"),
        topN: 0,
        // Deliberately no excludeIds/ledgerExclusions -- the mislabel is
        // that "already-delivered" fires anyway.
      },
      { cache, now },
    );

    expect(result.items).toEqual([]);
    expect(result.meta.emptyReasonCode).toBe("already-delivered");
  });

  it("non-empty regression: a response with items never carries emptyReasonCode, and every existing meta field is unaffected", async () => {
    bySourceId.openalex.fetch = vi.fn(async () => [matchingPaper("present-1")]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      {
        topics: ["solid-state battery"],
        sources: ["openalex"],
        aiTier: 0,
        paperCacheScope: scopeFor("owner-esr-9"),
      },
      { cache, now },
    );

    expect(result.items.length).toBeGreaterThan(0);
    expect(result.meta).not.toHaveProperty("emptyReasonCode");
    expect(result.meta.returned).toBe(result.items.length);
  });
});
