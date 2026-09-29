import { afterEach, describe, expect, it, vi } from "vitest";
import { dblp } from "./dblp";

// P2-S2 (Round 3) — F-A-P2-02. Same fix as every other academic adapter:
// `fetchOne` used to catch a non-2xx response or a thrown network error and
// return `[]`, identical to a legitimately empty hit list. Now it throws on
// a genuine failure and reserves `[]` for a response with no hits.

describe("dblp adapter — failure visibility (P2-S2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("still resolves [] when the API answers 200 with zero hits (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response(JSON.stringify({ result: { hits: {} } }), { status: 200 }),
    ) as unknown as typeof fetch;

    const items = await dblp.fetch({
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
      dblp.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when every query throws a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      dblp.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("still resolves with the successful subset when only some queries fail", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return new Response("boom", { status: 500 });
      return new Response(
        JSON.stringify({
          result: {
            hits: {
              hit: [
                {
                  "@id": "123",
                  info: {
                    title: "A Real Paper",
                    year: "2026",
                    authors: { author: [] },
                  },
                },
              ],
            },
          },
        }),
        { status: 200 },
      );
    }) as unknown as typeof fetch;

    const items = await dblp.fetch({
      topics: ["solid-state batteries", "cathode interfaces"],
      limit: 10,
    });
    expect(items.map((item) => item.id)).toEqual(["dblp:123"]);
  });
});
