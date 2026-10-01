import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenAlexTopicField } from "./openalex-topic";
import fixture from "./__fixtures__/openalex-topic.json";

// P2-S4a (Round 3) — F-A-P2-04 (4e), ABC-JEV-INTEGRATION.md §1p.B(3),
// docs/jev-abc/P2-B-20260924T0345Z.md API CONTRACTS ("OpenAlex topic
// filter" — `topics.id:<T-id>` matches a work with that topic anywhere in
// its top-3 scored topics). Bounded exploration, not a whole-field dump —
// see TOPIC_FIELD_DEFAULT_LIMIT in the adapter. Recorded-fixture tests
// only — no live call, ever, from this file.
//
// `topicIds` must never be invented by this file or its caller — an empty
// array is today's everyday, honest input (no upstream topic-id source
// exists yet; see this slice's checkpoint DESIGN CHOICES), so it must
// produce zero network calls, not a guess.

describe("openalex-topic adapter", () => {
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

    const items = await fetchOpenAlexTopicField(["T20001"]);

    expect(items.map((item) => item.id)).toEqual(
      fixture.results.map((w) => `openalex:${w.id.split("/").pop()}`),
    );
    expect(items[0].title).toBe(fixture.results[0].title);
  });

  it("caps returned items at the requested limit", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify(fixture), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchOpenAlexTopicField(["T20001"], { limit: 1 });
    expect(items).toHaveLength(1);
  });

  it("makes no network call for an empty topicIds array — today's default, everyday input", async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;

    const items = await fetchOpenAlexTopicField([]);
    expect(items).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it("filters by topics.id, OR-joining multiple ids, and bares a full OpenAlex URL id down to its tail", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexTopicField(["https://openalex.org/T20001", "T20002"]);

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("filter")).toBe("topics.id:T20001|T20002");
  });

  it("ignores a malformed topic id rather than sending a broken filter", async () => {
    let capturedUrl = "";
    globalThis.fetch = vi.fn(async (url: string) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexTopicField(["not-a-topic-id", "T20001"]);

    const url = new URL(capturedUrl);
    expect(url.searchParams.get("filter")).toBe("topics.id:T20001");
  });

  it("still resolves [] when the API answers 200 with zero matches (P2-S2 empty contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ results: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await fetchOpenAlexTopicField(["T20001"]);
    expect(items).toEqual([]);
  });

  it("throws instead of resolving [] on a non-2xx response (P2-S2 failure contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("upstream exploded", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(fetchOpenAlexTopicField(["T20001"])).rejects.toThrow();
  });

  it("throws instead of resolving [] on a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND api.openalex.org");
    }) as unknown as typeof fetch;

    await expect(fetchOpenAlexTopicField(["T20001"])).rejects.toThrow(
      /ENOTFOUND|openalex/i,
    );
  });

  it("sends Authorization: Bearer and never puts the key in the URL when OPENALEX_API_KEY is set", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "topic-secret-key-456");
    let capturedUrl = "";
    let capturedHeaders: HeadersInit | undefined;
    globalThis.fetch = vi.fn(async (url: string, init?: RequestInit) => {
      capturedUrl = String(url);
      capturedHeaders = init?.headers;
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    await fetchOpenAlexTopicField(["T20001"]);

    expect(capturedUrl).not.toContain("topic-secret-key-456");
    expect(new Headers(capturedHeaders).get("Authorization")).toBe(
      "Bearer topic-secret-key-456",
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

    await fetchOpenAlexTopicField(["T20001"]);

    expect(called).toBe(true);
    expect(capturedHeaders).toBeUndefined();
  });

  // P2-S4a-FIX (Round 3) — F-A-P2S4a-01, ABC-JEV-INTEGRATION.md §1p.B(3).
  // Same fix as openalex-semantic.test.ts: this adapter never used
  // `sourceFetch` before, so neither path ever retried a 429.
  it("retries once on 429 on the keyed path (previously never retried, keyed or keyless)", async () => {
    vi.stubEnv("OPENALEX_API_KEY", "retry-check-key");
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("rate limited", { status: 429 });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as unknown as typeof fetch;

    const items = await fetchOpenAlexTopicField(["T20001"]);

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

    const items = await fetchOpenAlexTopicField(["T20001"]);

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

      const items = await fetchOpenAlexTopicField(["T20001"]);
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

      const items = await fetchOpenAlexTopicField(["T20001"]);
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

      await fetchOpenAlexTopicField(["T20001"]);

      const select = new URL(capturedUrl).searchParams.get("select") ?? "";
      expect(select.split(",")).toContain("type");
    });
  });
});
