import { afterEach, describe, expect, it, vi } from "vitest";
import { openalex } from "./openalex";

// P2-S2 (Round 3) — F-A-P2-02, ABC-JEV-INTEGRATION.md §1p.B(2). Before this
// slice, `fetchOne` caught every non-2xx response AND every thrown network
// error and returned `[]` either way — identical to a genuinely empty
// result. `buildPaperPool`'s own `Promise.allSettled` over sources can only
// record a source as failed when its promise REJECTS, so a real OpenAlex
// outage was indistinguishable from "no papers matched today" and got
// cached as a complete, valid day. The contract from here on: `fetchOne`
// throws on a genuine failure (non-2xx, network error) and `[]` is reserved
// for "the API answered 200 with nothing".

describe("openalex adapter — failure visibility (P2-S2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  it("still resolves [] when the API answers 200 with zero matches (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await openalex.fetch({
      topics: ["a topic with genuinely no matches"],
      limit: 10,
    });
    expect(items).toEqual([]);
  });

  it("rejects instead of resolving [] when every query gets a non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("upstream exploded", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      openalex.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when every query throws a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.openalex.org");
    }) as unknown as typeof fetch;

    await expect(
      openalex.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow(/ENOTFOUND|openalex/i);
  });

  // P2-S4a (Round 3) — F-A-P2-04 (4h), ABC-JEV-INTEGRATION.md §1p.B(3).
  it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "lexical-secret-key-789");
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await openalex.fetch({ topics: ["solid-state batteries"], limit: 10 });

    expect(capturedUrl).not.toContain("lexical-secret-key-789");
    expect(new Headers(capturedHeaders).get("Authorization")).toBe(
      "Bearer lexical-secret-key-789",
    );
  });

  it("sends no Authorization header when OPENALEX_API_KEY is unset (byte-identical to before this slice)", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "");
    let capturedHeaders: HeadersInit | undefined;
    let called = false;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      called = true;
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await openalex.fetch({ topics: ["solid-state batteries"], limit: 10 });

    expect(called).toBe(true);
    expect(capturedHeaders).toBeUndefined();
  });

  // P2-S4a-FIX (Round 3) — F-A-P2S4a-01, ABC-JEV-INTEGRATION.md §1p.B(3).
  // Before this fix, a configured key made `openalex.ts` bypass `sourceFetch`
  // entirely (a local `openAlexFetch` wrapper called raw `fetch` instead),
  // silently dropping the `revalidate: 300` this adapter has always passed
  // and the 429-retry `sourceFetch` already provides.
  it("keeps the revalidate: 300 data-cache option on the keyed path (previously silently dropped)", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "revalidate-check-key");
    let capturedInit: (RequestInit & { next?: { revalidate?: number } }) | undefined;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      capturedInit = init as RequestInit & { next?: { revalidate?: number } };
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await openalex.fetch({ topics: ["solid-state batteries"], limit: 10 });

    expect(capturedInit?.next?.revalidate).toBe(300);
  });

  it("retries once on 429 on the keyed path, same as the keyless path already does (previously never retried once keyed)", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "retry-check-key");
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await openalex.fetch({ topics: ["solid-state batteries"], limit: 10 });

    expect(call).toBe(2);
    expect(items).toEqual([]);
  });

  it("still resolves with the successful subset when only some queries fail (one flaky query must never take the source down)", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return new Response(
        JSON.stringify({
          results: [
            {
              id: "https://openalex.org/W1",
              title: "A Real Paper",
              publication_date: "2026-01-01",
              authorships: [],
              doi: null,
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const items = await openalex.fetch({
      topics: ["solid-state batteries", "cathode interfaces"],
      limit: 10,
    });
    expect(items.map((item) => item.id)).toEqual(["openalex:W1"]);
  });
});
