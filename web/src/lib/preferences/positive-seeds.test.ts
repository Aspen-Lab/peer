import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MemoryPositiveSeedFeedbackRepository,
  SupabasePositiveSeedFeedbackRepository,
  POSITIVE_SEED_LIMIT,
  NEGATIVE_SEED_LIMIT,
  resolvePositiveSeeds,
  resolveNegativeSeedPaperIds,
  parseItemId,
  seedFromRow,
  latestEventPerPaper,
  channelS2RecommendationsEnabled,
  channelOpenAlexSeedSimilarityEnabled,
  channelPositiveSeedCitationsEnabled,
  anyPositiveSeedChannelEnabled,
  type PositiveSeedFeedbackRow,
  type NegativeSeedFeedbackRow,
  type StoredFeedbackRow,
} from "./positive-seeds";

// P2-S4b (Round 3) — F-A-P2-04 (4c), ABC-JEV-INTEGRATION.md §1p.B(5).
// Resolves a signed-in owner's recent EXPLICIT positive feedback (Save,
// "More like this" — the ruling's own literal enumeration, deliberately
// NOT "liked", see this slice's checkpoint CONTRACT ASSUMPTIONS) into
// typed seed identities for the new retrieval channels. Never a live call:
// this whole module only ever reads already-stored feedback_events rows.
//
// P2-S4b-FIX2 (Round 3) — F-A-P2S4bFIX-01, ABC-JEV-INTEGRATION.md §4
// manager ruling (2026-09-24T11:37:37Z): the most recent EXPLICIT
// feedback event on a paper (same stored item_id) now decides its seed
// role — see the "latest-event-wins (P2-S4b-FIX2)" describe block below
// for the cross-resolver tests, and positive-seeds.ts's own header
// comment for the full ruling text and the disclosed "same paper" =
// "same item_id" scope choice.

afterEach(() => {
  vi.unstubAllEnvs();
});

function row(overrides: Partial<PositiveSeedFeedbackRow> = {}): PositiveSeedFeedbackRow {
  return {
    itemId: "openalex:W1",
    feedback: "saved",
    payload: { title: "A Paper About Solid-State Batteries" },
    createdAt: "2026-09-20T00:00:00.000Z",
    // P2-S4b-FIX2: StoredFeedbackRow gained a required `id` (the reliable
    // tie-break — see positive-seeds.ts). Arbitrary default; only the
    // dedicated tie-break tests below care about specific values.
    id: 1,
    ...overrides,
  };
}

// P2-S4b-FIX (Round 3) — §1p.B(5): "'Not interested' supplies negative
// seeds." Same shape as `row()`, defaulted to a `notInterested` S2-sourced
// row since `resolveNegativeSeedPaperIds`'s only current consumer (the S2
// Recommendations adapter's `negativePaperIds`) needs a bare S2 paper id.
function negativeRow(overrides: Partial<NegativeSeedFeedbackRow> = {}): NegativeSeedFeedbackRow {
  return {
    itemId: "semantic_scholar:s2-notinterested-1",
    feedback: "notInterested",
    payload: { title: "A Paper The Owner Is Not Interested In" },
    createdAt: "2026-09-20T00:00:00.000Z",
    id: 1, // P2-S4b-FIX2: see row()'s comment above.
    ...overrides,
  };
}

describe("parseItemId", () => {
  it("splits a well-formed \"source:nativeId\" id", () => {
    expect(parseItemId("openalex:W123")).toEqual({ source: "openalex", nativeId: "W123" });
    expect(parseItemId("semantic_scholar:abc123")).toEqual({
      source: "semantic_scholar",
      nativeId: "abc123",
    });
  });

  it("returns an empty result for an id with no colon or an empty native part", () => {
    expect(parseItemId("nocolonhere")).toEqual({});
    expect(parseItemId("openalex:")).toEqual({});
    expect(parseItemId("")).toEqual({});
  });
});

describe("seedFromRow", () => {
  it("builds an openalex-sourced seed directly from the native item id", () => {
    const seed = seedFromRow(row({ itemId: "openalex:W42", payload: { title: "Solid Electrolytes" } }));
    expect(seed?.openalexWorkId).toBe("W42");
    expect(seed?.s2PaperId).toBeUndefined();
    expect(seed?.title).toBe("Solid Electrolytes");
    expect(seed?.identity.key).toBe("openalex:W42");
  });

  it("builds a semantic-scholar-sourced seed directly from the native item id", () => {
    const seed = seedFromRow(row({ itemId: "semantic_scholar:s2paper1", payload: { title: "T" } }));
    expect(seed?.s2PaperId).toBe("s2paper1");
    expect(seed?.openalexWorkId).toBeUndefined();
    expect(seed?.identity.key).toBe("s2:s2paper1");
  });

  it("falls back to payload.resolvedIds (server-captured at save time) for a non-native id form", () => {
    const seed = seedFromRow(
      row({
        itemId: "arxiv:2409.00001",
        payload: {
          title: "Cross-referenced paper",
          resolvedIds: { openalexId: "W999" },
        },
      }),
    );
    expect(seed?.openalexWorkId).toBe("W999");
  });

  it("never throws on a malformed/missing payload; falls back to a title-only or item-only identity", () => {
    expect(() => seedFromRow(row({ payload: null }))).not.toThrow();
    expect(() => seedFromRow(row({ payload: "not an object" }))).not.toThrow();
    expect(() => seedFromRow(row({ payload: { resolvedIds: "not an object either" } }))).not.toThrow();
    const seed = seedFromRow(row({ itemId: "openalex:W7", payload: null }));
    expect(seed?.identity.key).toBe("openalex:W7");
    expect(seed?.title).toBeUndefined();
  });

  it("returns undefined for an unparseable item id (no source prefix)", () => {
    expect(seedFromRow(row({ itemId: "not-a-valid-id" }))).toBeUndefined();
  });

  // P2-S4b-FIX (Round 3): seedFromRow's parameter was widened from
  // PositiveSeedFeedbackRow to the shared StoredFeedbackRow base (it never
  // reads `.feedback`) specifically so resolveNegativeSeedPaperIds could
  // reuse it instead of duplicating the same id/title-resolution logic.
  // This proves that reuse actually works end to end against a REAL
  // NegativeSeedFeedbackRow shape, not just that the two types are
  // structurally compatible.
  it("works identically on a negative (notInterested) row — it never reads .feedback", () => {
    const seed = seedFromRow(negativeRow({ itemId: "semantic_scholar:s2-declined", payload: {} }));
    expect(seed?.s2PaperId).toBe("s2-declined");
  });
});

// P2-S4b-FIX2 (Round 3) — the pure helper both resolvers now share to
// apply the latest-event-wins rule. Tested directly (cheap, and it is the
// crux of this fix's correctness) in addition to indirectly through the
// resolver-level tests below.
describe("latestEventPerPaper", () => {
  it("keeps only the first occurrence per itemId, given already most-recent-first input", () => {
    const rows: StoredFeedbackRow[] = [
      { id: 3, itemId: "a", feedback: "notInterested", payload: null, createdAt: "2026-09-03T00:00:00.000Z" },
      { id: 2, itemId: "b", feedback: "saved", payload: null, createdAt: "2026-09-02T00:00:00.000Z" },
      { id: 1, itemId: "a", feedback: "liked", payload: null, createdAt: "2026-09-01T00:00:00.000Z" },
    ];
    const latest = latestEventPerPaper(rows);
    expect(latest.map((r) => r.itemId)).toEqual(["a", "b"]);
    // Paper "a"'s surviving row must be the FIRST-in-order (id 3,
    // notInterested) one, not its older (id 1, liked) row.
    expect(latest.find((r) => r.itemId === "a")?.feedback).toBe("notInterested");
    expect(latest.find((r) => r.itemId === "a")?.id).toBe(3);
  });

  it("returns [] for empty input, and preserves relative order otherwise", () => {
    expect(latestEventPerPaper([])).toEqual([]);
    const rows: StoredFeedbackRow[] = [
      { id: 1, itemId: "x", feedback: "saved", payload: null, createdAt: "2026-09-01T00:00:00.000Z" },
      { id: 2, itemId: "y", feedback: "saved", payload: null, createdAt: "2026-09-02T00:00:00.000Z" },
    ];
    expect(latestEventPerPaper(rows).map((r) => r.itemId)).toEqual(["x", "y"]);
  });
});

describe("MemoryPositiveSeedFeedbackRepository + resolvePositiveSeeds", () => {
  it("resolves the signed-in owner's positive seeds, most recent first", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "openalex:W1",
      itemKind: "paper",
      feedback: "saved",
      payload: { title: "Older" },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "openalex:W2",
      itemKind: "paper",
      feedback: "moreLikeThis",
      payload: { title: "Newer" },
      createdAt: "2026-09-10T00:00:00.000Z",
    });

    const seeds = await resolvePositiveSeeds(repo, "owner-1");
    expect(seeds.map((s) => s.title)).toEqual(["Newer", "Older"]);
  });

  it("bounds to the most recent POSITIVE_SEED_LIMIT (10) even when more exist", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    for (let i = 0; i < 15; i++) {
      repo.record("owner-1", {
        itemId: `openalex:W${i}`,
        itemKind: "paper",
        feedback: "saved",
        payload: { title: `Paper ${i}` },
        createdAt: new Date(2026, 8, 1 + i).toISOString(),
      });
    }
    const seeds = await resolvePositiveSeeds(repo, "owner-1");
    expect(seeds).toHaveLength(POSITIVE_SEED_LIMIT);
    // Most recent 10 -> papers 5..14, newest first.
    expect(seeds[0].title).toBe("Paper 14");
    expect(seeds[9].title).toBe("Paper 5");
  });

  // P2-S4b-FIX (Round 3): rewritten. Manager ruling (ABC-JEV-INTEGRATION.md
  // §4, 2026-09-24T10:41:33Z, per docs/jev-abc/P2-S4b-A-20260924T103042Z.md
  // PER-CHECK VERDICT 5): "liked" IS explicit positive feedback and now
  // counts as a positive seed — §1p.B(5) named Save/"More like this" only
  // as EXAMPLES, not an exhaustive list excluding "liked". This test
  // previously asserted the opposite (liked excluded); that was C's own
  // conservative reading pending the ruling, now superseded.
  it("excludes notInterested but includes liked — saved/moreLikeThis/liked are all positive seeds (§1p.B(5), manager ruling)", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "openalex:W1",
      itemKind: "paper",
      feedback: "notInterested",
      payload: { title: "Disliked" },
    });
    repo.record("owner-1", {
      itemId: "openalex:W2",
      itemKind: "paper",
      feedback: "liked",
      payload: { title: "Liked and now a declared seed" },
    });
    repo.record("owner-1", {
      itemId: "openalex:W3",
      itemKind: "paper",
      feedback: "saved",
      payload: { title: "Actually saved" },
    });

    const seeds = await resolvePositiveSeeds(repo, "owner-1");
    expect(seeds.map((s) => s.title).sort()).toEqual(
      ["Actually saved", "Liked and now a declared seed"].sort(),
    );
  });

  it("excludes non-paper feedback (event/job) even if the feedback value is saved", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", { itemId: "web:job1", itemKind: "job", feedback: "saved", payload: {} });
    const seeds = await resolvePositiveSeeds(repo, "owner-1");
    expect(seeds).toEqual([]);
  });

  it("never reads another owner's feedback", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-a", { itemId: "openalex:Wa", itemKind: "paper", feedback: "saved", payload: {} });
    repo.record("owner-b", { itemId: "openalex:Wb", itemKind: "paper", feedback: "saved", payload: {} });

    const seedsA = await resolvePositiveSeeds(repo, "owner-a");
    expect(seedsA.map((s) => s.openalexWorkId)).toEqual(["Wa"]);
  });

  it("returns [] for an unknown/empty owner id", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    expect(await resolvePositiveSeeds(repo, "")).toEqual([]);
    expect(await resolvePositiveSeeds(repo, "nobody")).toEqual([]);
  });

  it("de-duplicates repeated feedback on the same paper into one seed", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "openalex:W1",
      itemKind: "paper",
      feedback: "saved",
      payload: { title: "Same paper" },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "openalex:W1",
      itemKind: "paper",
      feedback: "moreLikeThis",
      payload: { title: "Same paper" },
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    const seeds = await resolvePositiveSeeds(repo, "owner-1");
    expect(seeds).toHaveLength(1);
  });

  it("degrades to [] (fail-soft) when the repository throws", async () => {
    // P2-S4b-FIX2: the repository interface now has ONE method
    // (recentFeedback) instead of two, so this fixture no longer needs a
    // second stub method just to structurally satisfy the interface.
    const throwingRepo = {
      async recentFeedback(): Promise<StoredFeedbackRow[]> {
        throw new Error("db is down");
      },
    };
    await expect(resolvePositiveSeeds(throwingRepo, "owner-1")).resolves.toEqual([]);
  });

  it("never logs a seed id, title, or owner id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const repo = new MemoryPositiveSeedFeedbackRepository();
      repo.record("owner-super-secret", {
        itemId: "openalex:Wsecret",
        itemKind: "paper",
        feedback: "saved",
        payload: { title: "A very private research interest" },
      });
      await resolvePositiveSeeds(repo, "owner-super-secret");
      const throwingRepo = {
        async recentFeedback(): Promise<StoredFeedbackRow[]> {
          throw new Error("db is down for owner-super-secret");
        },
      };
      await resolvePositiveSeeds(throwingRepo, "owner-super-secret");
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// P2-S4b-FIX (Round 3) — §1p.B(5): "'Not interested' supplies negative
// seeds." Resolved into BARE Semantic Scholar paper ids only (not a full
// ResolvedPositiveSeed identity) — the sole current consumer is the S2
// Recommendations adapter's `negativePaperIds`; OpenAlex seed-similarity
// and citation-neighbours have no negative-example concept in this
// codebase, so there is nothing else for a fuller identity to feed.
describe("MemoryPositiveSeedFeedbackRepository + resolveNegativeSeedPaperIds", () => {
  it("resolves the signed-in owner's notInterested rows into bare S2 paper ids, most recent first", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-older",
      itemKind: "paper",
      feedback: "notInterested",
      payload: {},
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-newer",
      itemKind: "paper",
      feedback: "notInterested",
      payload: {},
      createdAt: "2026-09-10T00:00:00.000Z",
    });

    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual(["s2-newer", "s2-older"]);
  });

  it("resolves a non-native S2 id via payload.resolvedIds.s2Id, same fallback seedFromRow already uses for positive seeds", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "openalex:W-not-interested",
      itemKind: "paper",
      feedback: "notInterested",
      payload: { resolvedIds: { s2Id: "cross-referenced-s2-id" } },
    });

    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual(["cross-referenced-s2-id"]);
  });

  it("drops a notInterested row with no resolvable S2 id, rather than sending something S2 can't use", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "arxiv:2409.00002",
      itemKind: "paper",
      feedback: "notInterested",
      payload: {},
    });

    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual([]);
  });

  it("bounds to the most recent NEGATIVE_SEED_LIMIT (10) even when more exist", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    for (let i = 0; i < 15; i++) {
      repo.record("owner-1", {
        itemId: `semantic_scholar:s2-${i}`,
        itemKind: "paper",
        feedback: "notInterested",
        payload: {},
        createdAt: new Date(2026, 8, 1 + i).toISOString(),
      });
    }
    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toHaveLength(NEGATIVE_SEED_LIMIT);
    expect(ids[0]).toBe("s2-14");
    expect(ids[9]).toBe("s2-5");
  });

  it("excludes saved/moreLikeThis/liked feedback — only notInterested is a negative seed", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", { itemId: "semantic_scholar:s2-saved", itemKind: "paper", feedback: "saved", payload: {} });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-liked", itemKind: "paper", feedback: "liked", payload: {} });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-more", itemKind: "paper", feedback: "moreLikeThis", payload: {} });

    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual([]);
  });

  it("excludes non-paper feedback (event/job) even if the feedback value is notInterested", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", { itemId: "web:job1", itemKind: "job", feedback: "notInterested", payload: {} });
    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual([]);
  });

  it("never reads another owner's feedback", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-a", { itemId: "semantic_scholar:s2-a", itemKind: "paper", feedback: "notInterested", payload: {} });
    repo.record("owner-b", { itemId: "semantic_scholar:s2-b", itemKind: "paper", feedback: "notInterested", payload: {} });

    const idsA = await resolveNegativeSeedPaperIds(repo, "owner-a");
    expect(idsA).toEqual(["s2-a"]);
  });

  it("returns [] for an unknown/empty owner id", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    expect(await resolveNegativeSeedPaperIds(repo, "")).toEqual([]);
    expect(await resolveNegativeSeedPaperIds(repo, "nobody")).toEqual([]);
  });

  it("de-duplicates repeated notInterested feedback resolving to the same S2 id", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-dup",
      itemKind: "paper",
      feedback: "notInterested",
      payload: {},
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "openalex:W-same-paper",
      itemKind: "paper",
      feedback: "notInterested",
      payload: { resolvedIds: { s2Id: "s2-dup" } },
      createdAt: "2026-09-02T00:00:00.000Z",
    });
    const ids = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(ids).toEqual(["s2-dup"]);
  });

  it("degrades to [] (fail-soft) when the repository throws", async () => {
    // P2-S4b-FIX2: see the identical comment on the positive-side fixture above.
    const throwingRepo = {
      async recentFeedback(): Promise<StoredFeedbackRow[]> {
        throw new Error("db is down");
      },
    };
    await expect(resolveNegativeSeedPaperIds(throwingRepo, "owner-1")).resolves.toEqual([]);
  });

  it("never logs a seed id, title, or owner id", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const repo = new MemoryPositiveSeedFeedbackRepository();
      repo.record("owner-super-secret", {
        itemId: "semantic_scholar:s2-secret",
        itemKind: "paper",
        feedback: "notInterested",
        payload: { title: "A very private disinterest" },
      });
      await resolveNegativeSeedPaperIds(repo, "owner-super-secret");
      expect(logSpy).not.toHaveBeenCalled();
      expect(errorSpy).not.toHaveBeenCalled();
      expect(warnSpy).not.toHaveBeenCalled();
    } finally {
      logSpy.mockRestore();
      errorSpy.mockRestore();
      warnSpy.mockRestore();
    }
  });
});

// P2-S4b-FIX2 (Round 3) — F-A-P2S4bFIX-01, ABC-JEV-INTEGRATION.md §4
// manager ruling (2026-09-24T11:37:37Z). `feedback_events` is insert-only
// (api/feedback/route.ts's POST handler only ever `.insert()`s), so the
// SAME stored item_id can carry both a qualifying positive row and a
// qualifying notInterested row. These tests prove the latest EXPLICIT
// event decides the paper's seed role, cross-checking BOTH resolvers
// together against the SAME repository/event history (the actual bug:
// before this fix, the two resolvers queried independently and could
// BOTH return the same paper).
//
// Full stored `feedback` value set (evidence): `api/feedback/route.ts`'s
// `Feedback` TS union AND `web/supabase/schema.sql`'s CHECK constraint on
// `feedback_events.feedback` both enumerate EXACTLY
// `liked | saved | notInterested | moreLikeThis` — cross-confirmed, no
// undo-type value (e.g. "unsave"/"unlike") exists in either place, and
// the POST handler never updates/deletes a row. The ruling's conditional
// "if an undo-type value exists, the latest such event removes the paper
// from both sets" therefore has no live case to test here — there is no
// stored value that means "neither positive nor negative." The
// "excludes X but includes Y" tests above (both directions, on both
// resolvers) already jointly cover the full 4-value classification
// boundary for a paper with only ONE event; the tests below cover a
// paper with MULTIPLE, conflicting-polarity events over time.
describe("latest-event-wins across positive/negative resolution (P2-S4b-FIX2)", () => {
  it("a paper liked then later marked notInterested resolves as a NEGATIVE seed only", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-flip-1",
      itemKind: "paper",
      feedback: "liked",
      payload: { title: "Flip Paper 1" },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-flip-1",
      itemKind: "paper",
      feedback: "notInterested",
      payload: { title: "Flip Paper 1" },
      createdAt: "2026-09-10T00:00:00.000Z",
    });

    const positive = await resolvePositiveSeeds(repo, "owner-1");
    const negative = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(positive).toEqual([]);
    expect(negative).toEqual(["s2-flip-1"]);
  });

  it("a paper marked notInterested then later saved resolves as a POSITIVE seed only", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-flip-2",
      itemKind: "paper",
      feedback: "notInterested",
      payload: { title: "Flip Paper 2" },
      createdAt: "2026-09-01T00:00:00.000Z",
    });
    repo.record("owner-1", {
      itemId: "semantic_scholar:s2-flip-2",
      itemKind: "paper",
      feedback: "saved",
      payload: { title: "Flip Paper 2" },
      createdAt: "2026-09-10T00:00:00.000Z",
    });

    const positive = await resolvePositiveSeeds(repo, "owner-1");
    const negative = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(positive.map((s) => s.title)).toEqual(["Flip Paper 2"]);
    expect(negative).toEqual([]);
  });

  it("interleaved events across two papers each resolve by their OWN latest event, not the other paper's", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    // Timeline: A-liked(T1), B-notInterested(T2), A-notInterested(T3), B-saved(T4).
    // Paper A's true latest is T3 (notInterested) -> negative only.
    // Paper B's true latest is T4 (saved) -> positive only.
    repo.record("owner-1", { itemId: "semantic_scholar:s2-a", itemKind: "paper", feedback: "liked", payload: { title: "Paper A" }, createdAt: "2026-09-01T00:00:00.000Z" });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-b", itemKind: "paper", feedback: "notInterested", payload: { title: "Paper B" }, createdAt: "2026-09-02T00:00:00.000Z" });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-a", itemKind: "paper", feedback: "notInterested", payload: { title: "Paper A" }, createdAt: "2026-09-03T00:00:00.000Z" });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-b", itemKind: "paper", feedback: "saved", payload: { title: "Paper B" }, createdAt: "2026-09-04T00:00:00.000Z" });

    const positive = await resolvePositiveSeeds(repo, "owner-1");
    const negative = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(positive.map((s) => s.title)).toEqual(["Paper B"]);
    expect(negative).toEqual(["s2-a"]);
  });

  it("an identical-timestamp tie is resolved by insertion order — the later-recorded row wins", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    const tiedTimestamp = "2026-09-05T00:00:00.000Z";
    repo.record("owner-1", { itemId: "semantic_scholar:s2-tie-1", itemKind: "paper", feedback: "liked", payload: { title: "Tied Paper 1" }, createdAt: tiedTimestamp });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-tie-1", itemKind: "paper", feedback: "notInterested", payload: { title: "Tied Paper 1" }, createdAt: tiedTimestamp });

    const positive = await resolvePositiveSeeds(repo, "owner-1");
    const negative = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(positive).toEqual([]);
    expect(negative).toEqual(["s2-tie-1"]);
  });

  it("the tie-break is symmetric — recording the positive event SECOND (same tied timestamp) makes it win instead", async () => {
    const repo = new MemoryPositiveSeedFeedbackRepository();
    const tiedTimestamp = "2026-09-05T00:00:00.000Z";
    repo.record("owner-1", { itemId: "semantic_scholar:s2-tie-2", itemKind: "paper", feedback: "notInterested", payload: { title: "Tied Paper 2" }, createdAt: tiedTimestamp });
    repo.record("owner-1", { itemId: "semantic_scholar:s2-tie-2", itemKind: "paper", feedback: "liked", payload: { title: "Tied Paper 2" }, createdAt: tiedTimestamp });

    const positive = await resolvePositiveSeeds(repo, "owner-1");
    const negative = await resolveNegativeSeedPaperIds(repo, "owner-1");
    expect(positive.map((s) => s.title)).toEqual(["Tied Paper 2"]);
    expect(negative).toEqual([]);
  });
});

// P2-S4b-FIX2 (Round 3) — renamed from "SupabasePositiveSeedFeedbackRepository"
// (which tested the now-removed recentPositiveFeedback/recentNegativeFeedback
// pair). Both resolvers now share ONE query method, recentFeedback, so the
// old 9-test block (a query-shape + 3 degrade tests, duplicated once per
// polarity) is consolidated to 5: the duplicate degrade-path tests (the
// underlying code is now the exact same method for both polarities, so a
// separate "recentNegativeFeedback degrades..." test would be byte-identical
// to its positive counterpart) are merged into one each; the freed test slots
// are repurposed for genuinely new assertions this fix needs: that the query
// spans ALL 4 feedback values in one call (not polarity-filtered), and that
// the fake client's ACTUAL sort/limit (not just recorded call args) matches
// the ordering `recentFeedback`'s contract relies on, including the id-desc
// tie-break.
describe("SupabasePositiveSeedFeedbackRepository.recentFeedback", () => {
  interface FakeRow {
    id: number;
    item_id: string;
    feedback: string;
    payload: unknown;
    created_at: string;
  }

  // P2-S4b-FIX2 — upgraded from a call-recording-only stub to one that
  // ACTUALLY applies the `.order()`/`.limit()` calls it receives (stable,
  // first `.order()` call = primary sort key), so these tests prove the
  // repository correctly relies on real ordering/limiting semantics
  // instead of merely asserting which arguments were passed through.
  // Only the two columns these tests ever actually order by are
  // comparable (created_at/id); narrowing to just those two (rather than
  // `keyof FakeRow`, which also includes `payload: unknown`) keeps `a[column]`
  // typed as `string | number` instead of widening to `unknown`.
  type OrderableColumn = "created_at" | "id";

  function fakeClient(rows: FakeRow[] | null, error: unknown = null) {
    const calls: { method: string; args: unknown[] }[] = [];
    const orderCols: { column: OrderableColumn; ascending: boolean }[] = [];
    let limitN: number | undefined;
    const builder = {
      eq(...args: unknown[]) {
        calls.push({ method: "eq", args });
        return builder;
      },
      in(...args: unknown[]) {
        calls.push({ method: "in", args });
        return builder;
      },
      order(column: string, opts: { ascending: boolean }) {
        calls.push({ method: "order", args: [column, opts] });
        orderCols.push({ column: column as OrderableColumn, ascending: opts.ascending });
        return builder;
      },
      limit(n: number) {
        calls.push({ method: "limit", args: [n] });
        limitN = n;
        return builder;
      },
      then(resolve: (result: { data: FakeRow[] | null; error: unknown }) => void) {
        if (error || !rows) {
          resolve({ data: null, error });
          return;
        }
        const sorted = [...rows].sort((a, b) => {
          for (const { column, ascending } of orderCols) {
            const av = a[column];
            const bv = b[column];
            if (av === bv) continue;
            const cmp = av < bv ? -1 : 1;
            return ascending ? cmp : -cmp;
          }
          return 0;
        });
        resolve({ data: limitN != null ? sorted.slice(0, limitN) : sorted, error: null });
      },
    };
    return {
      client: { from: () => ({ select: () => builder }) },
      calls,
    };
  }

  it("queries feedback_events scoped to owner + paper kind + all 4 known feedback values, ordered created_at desc then id desc, limited — and the fake client's REAL sort/limit (not just the recorded args) confirms the ordering contract, including the tie-break", async () => {
    // Deliberately unsorted input, with a created_at TIE between id 1 and
    // id 3 to exercise the id-desc tie-break.
    const { client, calls } = fakeClient([
      { id: 3, item_id: "semantic_scholar:s2-c", feedback: "liked", payload: {}, created_at: "2026-09-05T00:00:00.000Z" },
      { id: 1, item_id: "semantic_scholar:s2-a", feedback: "notInterested", payload: {}, created_at: "2026-09-05T00:00:00.000Z" },
      { id: 2, item_id: "semantic_scholar:s2-b", feedback: "saved", payload: {}, created_at: "2026-09-06T00:00:00.000Z" },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabasePositiveSeedFeedbackRepository(client as any);
    const rows = await repo.recentFeedback("owner-1", 2);

    // True order: 09-06 (id2) first; then the 09-05 tie broken by id desc
    // (id3 > id1); then limited to 2 -> [id2, id3].
    expect(rows).toEqual([
      { itemId: "semantic_scholar:s2-b", feedback: "saved", payload: {}, createdAt: "2026-09-06T00:00:00.000Z", id: 2 },
      { itemId: "semantic_scholar:s2-c", feedback: "liked", payload: {}, createdAt: "2026-09-05T00:00:00.000Z", id: 3 },
    ]);
    expect(calls).toContainEqual({ method: "eq", args: ["user_id", "owner-1"] });
    expect(calls).toContainEqual({ method: "eq", args: ["item_kind", "paper"] });
    expect(calls).toContainEqual({
      method: "in",
      args: ["feedback", ["saved", "moreLikeThis", "liked", "notInterested"]],
    });
    expect(calls).toContainEqual({ method: "order", args: ["created_at", { ascending: false }] });
    expect(calls).toContainEqual({ method: "order", args: ["id", { ascending: false }] });
    expect(calls).toContainEqual({ method: "limit", args: [2] });
  });

  it("returns rows spanning MULTIPLE feedback values from one call — proves the query is NOT polarity-filtered (the actual fix)", async () => {
    const { client } = fakeClient([
      { id: 1, item_id: "semantic_scholar:s2-pos", feedback: "saved", payload: {}, created_at: "2026-09-01T00:00:00.000Z" },
      { id: 2, item_id: "semantic_scholar:s2-neg", feedback: "notInterested", payload: {}, created_at: "2026-09-02T00:00:00.000Z" },
    ]);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabasePositiveSeedFeedbackRepository(client as any);
    const rows = await repo.recentFeedback("owner-1", 10);
    expect(rows.map((r) => r.feedback).sort()).toEqual(["notInterested", "saved"]);
  });

  it("degrades to [] on a query error, without throwing", async () => {
    // P2-S4b-FIX2: consolidated — the old file had this test twice (once
    // per polarity-specific method name); both polarities now go through
    // this exact same code path, so a second copy would be byte-identical.
    const { client } = fakeClient(null, new Error("permission denied"));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabasePositiveSeedFeedbackRepository(client as any);
    await expect(repo.recentFeedback("owner-1", 10)).resolves.toEqual([]);
  });

  it("degrades to [] when the client itself throws", async () => {
    // P2-S4b-FIX2: consolidated, same reasoning as above.
    const throwingClient = {
      from() {
        throw new Error("connection refused");
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const repo = new SupabasePositiveSeedFeedbackRepository(throwingClient as any);
    await expect(repo.recentFeedback("owner-1", 10)).resolves.toEqual([]);
  });

  it("degrades to the in-memory fallback (empty) when unconfigured (no service-role key)", async () => {
    // P2-S4b-FIX2: consolidated, same reasoning as above.
    const repo = new SupabasePositiveSeedFeedbackRepository(null);
    await expect(repo.recentFeedback("owner-1", 10)).resolves.toEqual([]);
  });
});

describe("positive-seed channel flags — server-only, literal \"on\", default off", () => {
  it("every flag defaults off", () => {
    expect(channelS2RecommendationsEnabled()).toBe(false);
    expect(channelOpenAlexSeedSimilarityEnabled()).toBe(false);
    expect(channelPositiveSeedCitationsEnabled()).toBe(false);
    expect(anyPositiveSeedChannelEnabled()).toBe(false);
  });

  it("only the literal value \"on\" enables a flag — not \"true\"/\"1\"/other casings alone", () => {
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "true");
    expect(channelS2RecommendationsEnabled()).toBe(false);
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "ON");
    expect(channelS2RecommendationsEnabled()).toBe(true);
    vi.stubEnv("PEER_CHANNEL_S2_RECOMMENDATIONS", "on");
    expect(channelS2RecommendationsEnabled()).toBe(true);
  });

  it("flags are independent of each other", () => {
    vi.stubEnv("PEER_CHANNEL_OPENALEX_SEED_SIMILARITY", "on");
    expect(channelOpenAlexSeedSimilarityEnabled()).toBe(true);
    expect(channelS2RecommendationsEnabled()).toBe(false);
    expect(channelPositiveSeedCitationsEnabled()).toBe(false);
  });

  it("anyPositiveSeedChannelEnabled is true when any one of the three is on", () => {
    vi.stubEnv("PEER_CHANNEL_POSITIVE_SEED_CITATIONS", "on");
    expect(anyPositiveSeedChannelEnabled()).toBe(true);
  });
});
