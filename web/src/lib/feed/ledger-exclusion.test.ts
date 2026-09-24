import { afterEach, describe, expect, it, vi } from "vitest";
import { runFeedPipeline } from "./pipeline";
import { resolveProvider } from "@/lib/llm/providers/registry";
import { bySourceId } from "@/lib/sources";
import type { RawItem } from "@/lib/sources/types";
import type { CachedPool, PoolCache } from "@/lib/opportunities/pool-cache";
import { createTrustedPaperCacheScope } from "@/lib/opportunities/private-paper-cache";
import { canonicalPaperKey } from "@/lib/utils/canonical-identity";
import {
  MemoryDashboardDeliveryLedger,
  type PaperIdentity,
} from "@/lib/dashboard/delivery-ledger";

// P4-S2 (Round 3) — F-A-P4-01: a signed-in owner must never see a paper
// server-side already knows it delivered, even when the client sends an
// empty (or no) `excludeIds`. Per ABC-JEV-INTEGRATION.md §1p.A, exclusion is
// deliberately LOOSE: a candidate is dropped if its own canonical key OR ANY
// of its aliases intersects the owner's ledger set, so a preprint shown once
// can't resurface as the published version under a different DOI once the
// title matches.
//
// Every "already delivered" fixture below is seeded through the REAL
// MemoryDashboardDeliveryLedger (prepareBatch -> acknowledgeBatch ->
// listDelivered), not a hand-typed Set of key strings — this proves the
// ledger's actual return shape (Set<string>, keys UNION aliases) is exactly
// what `runFeedPipeline`'s new `ledgerExclusions` option expects, rather than
// testing against an invented stand-in that could silently drift from the
// real contract. Keys are computed with the same `canonicalPaperKey` the
// pipeline itself uses, for the same reason.

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("@/lib/llm/providers/registry")
  >();
  return { ...actual, resolveProvider: vi.fn(() => null) };
});

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
const originalArxivFetch = bySourceId.arxiv.fetch;

afterEach(() => {
  bySourceId.openalex.fetch = originalOpenalexFetch;
  bySourceId.arxiv.fetch = originalArxivFetch;
  vi.mocked(resolveProvider).mockReset();
  vi.mocked(resolveProvider).mockReturnValue(null);
});

function stubSources(openalexItems: RawItem[], arxivItems: RawItem[] = []) {
  const openalexFetch = vi.fn(async () => openalexItems);
  const arxivFetch = vi.fn(async () => arxivItems);
  bySourceId.openalex.fetch = openalexFetch;
  bySourceId.arxiv.fetch = arxivFetch;
  return { openalexFetch, arxivFetch };
}

/**
 * Seeds a fresh, isolated ledger with a one-paper acknowledged batch and
 * returns exactly what `listDelivered` (the real read path) returns: the
 * flattened key-UNION-aliases set the pipeline's `ledgerExclusions` option
 * consumes.
 */
async function deliveredKeysFor(
  ...papers: PaperIdentity[]
): Promise<ReadonlySet<string>> {
  const ledger = new MemoryDashboardDeliveryLedger();
  const batch = await ledger.prepareBatch(
    "owner-ledger-test",
    "2026-07-29",
    papers,
  );
  await ledger.acknowledgeBatch("owner-ledger-test", batch.id);
  return ledger.listDelivered("owner-ledger-test");
}

const baseRequest = {
  topics: ["solid-state battery"],
  sources: ["openalex" as const, "arxiv" as const],
  aiTier: 0 as const,
};

// Every fixture below shares this abstract (mirrors paper-daily-cache.test.ts's
// own `{ ...academicPaper, ... }` convention) so keyword admission is never in
// doubt regardless of which title a given test needs.
const basePaper: RawItem = {
  id: "openalex:base",
  source: "openalex",
  title: "Solid-State Battery Electrolytes for High Energy Cells",
  authors: ["A. Researcher"],
  abstract:
    "Solid-state battery electrolyte design improves electrochemical stability.",
  url: "https://openalex.org/W900",
  publishedAt: "2026-07-20",
  metadata: {},
};

const deliveredDoiPaper: RawItem = {
  ...basePaper,
  id: "openalex:already-delivered",
  metadata: { doi: "10.1000/battery-doi" },
};

const freshPaper: RawItem = {
  ...basePaper,
  id: "openalex:never-shown",
  title: "Grain Boundary Engineering in Garnet Electrolytes",
  url: "https://openalex.org/W901",
  publishedAt: "2026-07-21",
};

describe("pipeline ledger exclusion (P4-S2, F-A-P4-01)", () => {
  it("excludes a candidate whose canonical key is in ledgerExclusions even when excludeIds is empty", async () => {
    stubSources([deliveredDoiPaper, freshPaper]);
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/battery-doi",
        title: deliveredDoiPaper.title,
      }),
    );
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, excludeIds: [] },
      { now, ledgerExclusions },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(deliveredDoiPaper.id);
    expect(ids).toContain(freshPaper.id);
  });

  it("excludes via alias only — same >=4-token title, no DOI on the re-fetched copy", async () => {
    const title = "Interfacial Stability of Sulfide Solid Electrolytes";
    // The PRIOR delivery was recorded under a DOI-based key; canonicalPaperKey
    // always attaches a qualifying title alias alongside a primary id-key, so
    // the ledger set below carries BOTH the doi: form and the title: form.
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({ doi: "10.1000/prior-published-doi", title }),
    );
    // Today's re-fetch has no DOI at all (e.g. an arXiv mirror) — its own
    // computed KEY is arxiv:..., which is not literally in the ledger set.
    // Only its title ALIAS intersects it.
    const arxivCopy: RawItem = {
      ...basePaper,
      id: "arxiv:2607.99999",
      source: "arxiv",
      title,
      url: "https://arxiv.org/abs/2607.99999",
      metadata: {},
    };
    stubSources([freshPaper], [arxivCopy]);
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, excludeIds: [] },
      { now, ledgerExclusions },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(arxivCopy.id);
    expect(ids).toContain(freshPaper.id);
  });

  it("keeps a non-matching candidate untouched", async () => {
    stubSources([freshPaper]);
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/some-other-doi",
        title: "An Unrelated Paper About Heterogeneous Catalysis",
      }),
    );
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, excludeIds: [] },
      { now, ledgerExclusions },
    );

    expect(result.items.map((item) => item.id)).toEqual([freshPaper.id]);
  });

  it("is byte-identical to today when the option is absent, and reuses the same cached pool when it is present", async () => {
    const { openalexFetch } = stubSources([deliveredDoiPaper, freshPaper]);
    const cache = new MemoryPoolCache();
    const now = new Date(2026, 6, 29, 9, 0);
    // A trusted scope so `options.cache` is actually consulted — an
    // unscoped/anonymous request always uses the request-local ephemeral
    // cache (paper-daily-cache.test.ts's own "keeps anonymous Tier-0
    // requests ephemeral" test), which would rebuild on every call
    // regardless of ledgerExclusions and prove nothing about it being a
    // read-time-only filter.
    const paperCacheScope = createTrustedPaperCacheScope({
      ownerId: "owner-byte-identical-test",
      topics: baseRequest.topics,
      aiTier: 0,
    });
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/battery-doi",
        title: deliveredDoiPaper.title,
      }),
    );

    const withoutOption = await runFeedPipeline(
      { ...baseRequest, paperCacheScope },
      { cache, now },
    );
    const withExclusions = await runFeedPipeline(
      { ...baseRequest, paperCacheScope },
      { cache, now, ledgerExclusions },
    );

    expect(withoutOption.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([deliveredDoiPaper.id, freshPaper.id]),
    );
    expect(withExclusions.items.map((item) => item.id)).not.toContain(
      deliveredDoiPaper.id,
    );
    // A read-time filter, exactly like excludeIds: the same built pool is
    // reused for the second call, not re-fetched.
    expect(openalexFetch).toHaveBeenCalledOnce();
  });

  it("never pads scarcity — a ledger-filtered result stays smaller than topN, not backfilled", async () => {
    stubSources([deliveredDoiPaper]);
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/battery-doi",
        title: deliveredDoiPaper.title,
      }),
    );
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, topN: 10 },
      { now, ledgerExclusions },
    );

    expect(result.items).toHaveLength(0);
  });

  it("still excludes on a second local day — not tied to one day's cached pool", async () => {
    stubSources([deliveredDoiPaper, freshPaper]);
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/battery-doi",
        title: deliveredDoiPaper.title,
      }),
    );
    const cache = new MemoryPoolCache();
    const dayTwo = new Date(2026, 6, 30, 9, 0);

    const result = await runFeedPipeline(baseRequest, {
      cache,
      now: dayTwo,
      ledgerExclusions,
    });

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(deliveredDoiPaper.id);
    expect(ids).toContain(freshPaper.id);
  });

  // P4-S3 (Round 3) — two follow-ups from docs/jev-abc/P4-S2-A-20260924T0505Z.md's
  // NEW FINDINGS. Finding #2 was a coverage gap, not a behavior bug: the union
  // of excludeIds and ledgerExclusions was already correct by code reading
  // (two independent early-return conditions in one filter callback) but had
  // no test exercising both firing together on DIFFERENT candidates in the
  // same call — this test should already be green, added to lock the
  // contract in, not to fix a bug. Finding #3 (re-confirmed by that same
  // checkpoint's PER-CHECK VERDICT 6) is a real gap: the filter site built its
  // own inline `canonicalPaperKey({...})` call, which cannot see a dedupe
  // survivor's `metadata.mergedAliases` the way `identityForRawItem` can —
  // that one is expected to be RED until pipeline.ts switches to the shared
  // helper (ABC-JEV-INTEGRATION.md §1p.G(4)).
  it("(P4-S2-A finding #2) excludeIds and ledgerExclusions target DIFFERENT candidates in one call — both are filtered, independently", async () => {
    const excludedByClientId: RawItem = {
      ...basePaper,
      id: "openalex:excluded-by-client-id",
      title: "Dismissed Via The Client Recently-Shown List",
      url: "https://openalex.org/W-client-excluded",
    };
    stubSources([excludedByClientId, deliveredDoiPaper, freshPaper]);
    const ledgerExclusions = await deliveredKeysFor(
      canonicalPaperKey({
        doi: "10.1000/battery-doi",
        title: deliveredDoiPaper.title,
      }),
    );
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, excludeIds: [excludedByClientId.id] },
      { now, ledgerExclusions },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(excludedByClientId.id); // excludeIds alone
    expect(ids).not.toContain(deliveredDoiPaper.id); // ledgerExclusions alone
    expect(ids).toContain(freshPaper.id); // neither — kept
  });

  it("(P4-S2-A finding #3) excludes via a dedupe survivor's merged alias — the old inline canonicalPaperKey() call could not see metadata.mergedAliases", async () => {
    // No DOI, no S2 id, and a title that shares nothing with anything else in
    // this test — its OWN plain identity does not intersect the ledger at
    // all. Only `metadata.mergedAliases` (set by dedup.ts when this item
    // absorbed another record during merging) carries the key the ledger
    // actually has.
    const mergedSurvivor: RawItem = {
      ...basePaper,
      id: "openalex:merged-survivor-item",
      title: "A Completely Unrelated Title About Photonic Crystal Fibers",
      url: "https://openalex.org/W-merged-survivor",
      metadata: { mergedAliases: ["s2:99999"] },
    };
    stubSources([mergedSurvivor, freshPaper]);
    const ledger = new MemoryDashboardDeliveryLedger();
    const batch = await ledger.prepareBatch("owner-ledger-test", "2026-07-29", [
      { key: "s2:99999", aliases: [] },
    ]);
    await ledger.acknowledgeBatch("owner-ledger-test", batch.id);
    const ledgerExclusions = await ledger.listDelivered("owner-ledger-test");
    const now = new Date(2026, 6, 29, 9, 0);

    const result = await runFeedPipeline(
      { ...baseRequest, excludeIds: [] },
      { now, ledgerExclusions },
    );

    const ids = result.items.map((item) => item.id);
    expect(ids).not.toContain(mergedSurvivor.id);
    expect(ids).toContain(freshPaper.id);
  });
});
