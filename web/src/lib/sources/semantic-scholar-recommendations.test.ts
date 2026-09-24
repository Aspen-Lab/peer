import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fetchSemanticScholarRecommendations, RECOMMENDATIONS_MAX_LIMIT } from "./semantic-scholar-recommendations";
import { __resetSemanticScholarClientForTests } from "./semantic-scholar-client";
import fixture from "./__fixtures__/semantic-scholar-recommendations.json";

// P2-S4b (Round 3) — F-A-P2-04 (4d, S2 leg), ABC-JEV-INTEGRATION.md §1p.B(5),
// docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("S2 Recommendations
// API" — request shape MODERATE confidence; response shape UNVERIFIED, see
// this slice's checkpoint CONTRACT ASSUMPTIONS). Recorded-fixture tests
// only — never a live call from this file.
//
// Routes through the SAME shared paced client every other S2 call in this
// codebase uses (`fetchSemanticScholar`), so it obeys the existing 1-RPS/
// backoff/x-api-key logic rather than inventing a second limiter — this is
// asserted indirectly by resetting/using that module's own test hook, the
// same convention `semantic-scholar.test.ts` already established.
//
// Failure contract matches P2-S2 (ABC-JEV-INTEGRATION.md §1p.B(2)): throws
// on a real error (non-2xx, network error); `[]` is reserved for a genuine
// 200-with-zero-results response.

describe("semantic-scholar-recommendations adapter", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetSemanticScholarClientForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    __resetSemanticScholarClientForTests();
  });

  it("resolves [] without any network call when positivePaperIds is empty", async () => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
    const items = await fetchSemanticScholarRecommendations([]);
    expect(items).toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("parses a recorded fixture response into RawItems", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchSemanticScholarRecommendations(["seed-s2-paper"]);

    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("semantic_scholar:rec-paper-1");
    expect(items[0].source).toBe("semantic_scholar");
    expect(items[0].title).toBe(fixture.recommendedPapers[0].title);
    expect(items[0].metadata.externalIds?.doi).toBe("10.1234/rec-paper-1");
    expect(items[1].id).toBe("semantic_scholar:rec-paper-2");
  });

  // P2-S4b-FIX (Round 3): docs/jev-abc/P2-S4b-A-20260924T103042Z.md fetched
  // the official swagger.json directly (2026-09-24T10:32:14Z UTC) and found
  // the request body's field names must be camelCase (`positivePaperIds`/
  // `negativePaperIds`), not the snake_case this test previously asserted —
  // the snake_case shape was an unverified, incorrect carry-over from a
  // community client rather than the primary source. Rewritten to match the
  // now-verified contract.
  it("sends a POST with positivePaperIds (S2 ids only, prefix stripped) in the body", async () => {
    let capturedBody: unknown;
    let capturedMethod: string | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedMethod = init?.method;
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({ recommendedPapers: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSemanticScholarRecommendations(["semantic_scholar:seed-1", "seed-2"]);

    expect(capturedMethod).toBe("POST");
    expect(capturedBody).toMatchObject({ positivePaperIds: ["seed-1", "seed-2"] });
    expect(capturedBody).not.toHaveProperty("negativePaperIds");
    expect(capturedBody).not.toHaveProperty("positive_paper_ids");
  });

  // P2-S4b-FIX (Round 3): same camelCase correction as above.
  it("includes negativePaperIds only when supplied", async () => {
    let capturedBody: { positivePaperIds?: string[]; negativePaperIds?: string[] } | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({ recommendedPapers: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSemanticScholarRecommendations(["seed-1"], { negativePaperIds: ["neg-1"] });
    expect(capturedBody?.negativePaperIds).toEqual(["neg-1"]);
    expect(capturedBody).not.toHaveProperty("negative_paper_ids");
  });

  it("clamps limit into [1, RECOMMENDATIONS_MAX_LIMIT] and sends it as a query parameter", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ recommendedPapers: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchSemanticScholarRecommendations(["seed-1"], { limit: 99999 });
    const url = new URL(capturedUrl);
    expect(Number(url.searchParams.get("limit"))).toBe(RECOMMENDATIONS_MAX_LIMIT);
    expect(url.pathname).toBe("/recommendations/v1/papers/");
  });

  // P2-S4b-FIX (Round 3): same camelCase correction as above.
  it("caps the number of seed ids sent, even given more than 10", async () => {
    let capturedBody: { positivePaperIds?: string[] } | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body ? JSON.parse(String(init.body)) : undefined;
      return new Response(JSON.stringify({ recommendedPapers: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const many = Array.from({ length: 20 }, (_, i) => `seed-${i}`);
    await fetchSemanticScholarRecommendations(many);
    expect(capturedBody?.positivePaperIds?.length).toBeLessThanOrEqual(10);
  });

  it("still resolves [] when the API answers 200 with zero recommendations (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ recommendedPapers: [] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const items = await fetchSemanticScholarRecommendations(["seed-1"]);
    expect(items).toEqual([]);
  });

  it("throws instead of resolving [] on a non-2xx response", async () => {
    // 500, not 429 — a 429 exercises fetchSemanticScholar's own real
    // retry-with-backoff (1s/2s/4s), which is correct behavior but would
    // make this single assertion take 7s+; semantic-scholar.test.ts's
    // equivalent case makes the same choice for the same reason.
    globalThis.fetch = vi.fn(
      async () => new Response("internal error", { status: 500 }),
    ) as unknown as typeof fetch;
    await expect(fetchSemanticScholarRecommendations(["seed-1"])).rejects.toThrow();
  });

  it("throws instead of resolving [] when the underlying request fails (fetchSemanticScholar returns null)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    await expect(fetchSemanticScholarRecommendations(["seed-1"])).rejects.toThrow();
  });
});
