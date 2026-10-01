import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchOpenAlexSemantic,
  OPENALEX_SEMANTIC_MAX_QUERY_CHARS,
  truncateSemanticQuery,
} from "./openalex-semantic";
import fixture from "./__fixtures__/openalex-semantic.json";

// P2-S4a (Round 3) — F-A-P2-04 (4b), ABC-JEV-INTEGRATION.md §1p.B(3),
// docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("OpenAlex semantic
// search" — verified: GET /works?search.semantic=<query>, max 50 results,
// max 2,000 input chars truncated beyond that, 1 req/s). Recorded-fixture
// tests only — no live call, ever, from this file.
//
// Failure contract mirrors P2-S2 (web/src/lib/sources/openalex.ts): a
// fetcher THROWS on a real error and resolves `[]` only for a genuine
// empty result, so a dead channel is never indistinguishable from a quiet
// day.

describe("openalex-semantic adapter", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("parses a recorded fixture response into RawItems via the existing OpenAlex mapping", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("solid-state battery interfaces");

    expect(items.map((item) => item.id)).toEqual(
      fixture.results.map((w) => `openalex:${w.id.split("/").pop()}`),
    );
    expect(items[0].title).toBe(fixture.results[0].title);
    expect(items[0].source).toBe("openalex");
  });

  it("caps returned items at the requested limit even when the API returns more", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("solid-state battery interfaces", {
      limit: 1,
    });
    expect(items).toHaveLength(1);
  });

  it("clamps an out-of-range limit into [1, OPENALEX_SEMANTIC_MAX_RESULTS] rather than trusting the caller", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexSemantic("solid-state batteries", { limit: 9999 });
    const url = new URL(capturedUrl);
    expect(Number(url.searchParams.get("per_page"))).toBe(50);
  });

  it("truncates a query over the documented 2,000-char ceiling deterministically", () => {
    const long = "x".repeat(3000);
    const truncated = truncateSemanticQuery(long);
    expect(truncated).toHaveLength(OPENALEX_SEMANTIC_MAX_QUERY_CHARS);
    expect(truncated).toBe(long.slice(0, OPENALEX_SEMANTIC_MAX_QUERY_CHARS));
    // Deterministic: same input always produces the same output.
    expect(truncateSemanticQuery(long)).toBe(truncated);
  });

  it("sends the truncated query text under search.semantic, never a raw lexical `search` param", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexSemantic("x".repeat(2500));
    const url = new URL(capturedUrl);
    expect(url.searchParams.get("search.semantic")).toHaveLength(
      OPENALEX_SEMANTIC_MAX_QUERY_CHARS,
    );
    expect(url.searchParams.has("search")).toBe(false);
    expect(url.searchParams.has("search.exact")).toBe(false);
  });

  it("makes no network call for blank query text", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("   ");
    expect(items).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("still resolves [] when the API answers 200 with zero matches (P2-S2 empty contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("a genuinely unmatched query");
    expect(items).toEqual([]);
  });

  it("throws instead of resolving [] on a non-2xx response (P2-S2 failure contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("upstream exploded", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchOpenAlexSemantic("solid-state batteries")).rejects.toThrow();
  });

  it("throws instead of resolving [] on a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.openalex.org");
    }) as unknown as typeof fetch;

    await expect(fetchOpenAlexSemantic("solid-state batteries")).rejects.toThrow(
      /ENOTFOUND|openalex/i,
    );
  });

  it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "test-secret-key-123");
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexSemantic("solid-state batteries");

    expect(capturedUrl).not.toContain("test-secret-key-123");
    expect(new Headers(capturedHeaders).get("Authorization")).toBe(
      "Bearer test-secret-key-123",
    );
  });

  it("sends no Authorization header when OPENALEX_API_KEY is unset", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "");
    let capturedHeaders: HeadersInit | undefined;
    let called = false;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      called = true;
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexSemantic("solid-state batteries");

    expect(called).toBe(true);
    expect(capturedHeaders).toBeUndefined();
  });

  // P2-S4a-FIX (Round 3) — F-A-P2S4a-01, ABC-JEV-INTEGRATION.md §1p.B(3).
  // Before this fix, this adapter never used `sources/_fetch.ts`'s
  // `sourceFetch` at all (always a raw `fetch`, keyed or keyless) — so
  // neither path ever retried a 429. Now it routes through `sourceFetch`,
  // which retries once, on both paths.
  it("retries once on 429 on the keyed path (previously never retried, keyed or keyless)", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "retry-check-key");
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("solid-state batteries");

    expect(call).toBe(2);
    expect(items).toEqual([]);
  });

  it("retries once on 429 on the keyless path too (previously never retried at all)", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await fetchOpenAlexSemantic("solid-state batteries");

    expect(call).toBe(2);
    expect(items).toEqual([]);
  });

  // DATASET-RECORDS (ABC-JEV-INTEGRATION.md §1bl,
  // docs/jev-abc/DATASET-RECORDS-B-20260930T030544Z.md). Mutation target:
  // dropping the `.filter((w) => !isExcludedOpenAlexType(w))` call turns the
  // first test in this block red.
  describe("drops clearly non-paper OpenAlex types after fetch (DATASET-RECORDS)", () => {
    function workResult(overrides: Record<string, unknown>) {
      return {
        id: `https://openalex.org/${overrides.id ?? "W1"}`,
        title: overrides.title ?? "A Fixture Work",
        publication_date: "2026-01-01",
        authorships: [],
        doi: null,
        ...overrides,
      };
    }

    it("a dataset-typed work never reaches the feed", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [workResult({ id: "W_DATASET", title: "O2-LCO-DATA", type: "dataset" })],
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const items = await fetchOpenAlexSemantic("solid-state batteries");
      expect(items).toEqual([]);
    });

    it("an article-typed and a preprint-typed work both survive unchanged", async () => {
      globalThis.fetch = vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              results: [
                workResult({ id: "W_ARTICLE", title: "A Real Article", type: "article" }),
                workResult({ id: "W_PREPRINT", title: "A Real Preprint", type: "preprint" }),
              ],
            }),
            { status: 200 },
          ),
      ) as unknown as typeof fetch;

      const items = await fetchOpenAlexSemantic("solid-state batteries");
      expect(items.map((item) => item.id).sort()).toEqual([
        "openalex:W_ARTICLE",
        "openalex:W_PREPRINT",
      ]);
    });

    it("sends `type` in the select parameter", async () => {
      let capturedUrl = "";
      globalThis.fetch = vi.fn(async (url: string) => {
        capturedUrl = String(url);
        return new Response(JSON.stringify({ results: [] }), { status: 200 });
      }) as unknown as typeof fetch;

      await fetchOpenAlexSemantic("solid-state batteries");

      const select = new URL(capturedUrl).searchParams.get("select") ?? "";
      expect(select.split(",")).toContain("type");
    });
  });
});
