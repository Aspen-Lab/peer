import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { semanticScholar } from "./semantic-scholar";
import { __resetSemanticScholarClientForTests } from "./semantic-scholar-client";

// P2-S2 (Round 3) — F-A-P2-02. `fetchSemanticScholar` itself returns `null`
// on a network error and otherwise hands back whatever `Response` it got,
// "never throws" by its own doc comment (semantic-scholar-client.ts) — this
// file's job is unchanged, but what THIS adapter's `fetchOne` does with a
// `null`/non-ok response changes: it used to log and return `[]`
// indistinguishably from a genuine zero-result page. Now it throws, so a
// real S2 outage shows up in `Promise.allSettled` instead of looking like a
// quiet day.

describe("semantic_scholar adapter — failure visibility (P2-S2)", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    __resetSemanticScholarClientForTests();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    __resetSemanticScholarClientForTests();
  });

  it("still resolves [] when the API answers 200 with zero matches (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ data: [] }), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await semanticScholar.fetch({
      topics: ["a topic with genuinely no matches"],
      limit: 10,
    });
    expect(items).toEqual([]);
  });

  it("rejects instead of resolving [] on a non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("rate limited forever", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      semanticScholar.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when the underlying request fails (fetchSemanticScholar returns null)", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      semanticScholar.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("still resolves with the successful subset when only some queries fail", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return new Response(
        JSON.stringify({
          data: [
            {
              paperId: "abc123",
              title: "A Real Paper",
              authors: [],
              year: 2026,
            },
          ],
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const items = await semanticScholar.fetch({
      topics: ["solid-state batteries", "cathode interfaces"],
      limit: 10,
    });
    expect(items.map((item) => item.id)).toEqual(["semantic_scholar:abc123"]);
  }, 10_000);
});
