import { afterEach, describe, expect, it, vi } from "vitest";
import { dblp, DblpBotCheckError } from "./dblp";

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

// DBLP-BOTWALL (ABC-JEV-INTEGRATION.md §1ba; docs/jev-abc/DBLP-BOTWALL-B-
// 20260929T110302Z.md). dblp.org sits behind a third-party anti-automation
// product that sometimes answers a plain search request with HTTP 200 whose
// body is a static "Making sure you're not a bot!" challenge page, not the
// requested JSON. `res.ok` was already true for that response, so the
// non-2xx branch above never saw it, and handing the HTML to `res.json()`
// used to throw a bare `SyntaxError` ("Unexpected token '<'") that named the
// parse SYMPTOM, never dblp's real answer.
describe("dblp adapter — bot-check response (DBLP-BOTWALL)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("rejects with a clear, named error — not a raw SyntaxError — when dblp answers 200 with an HTML bot-check page", async () => {
    const challengePage =
      "<!doctype html><html><head><title>Making sure you're not a bot!</title></head><body></body></html>";
    globalThis.fetch = vi.fn(
      async () =>
        new Response(challengePage, {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
    ) as unknown as typeof fetch;

    let rejection: unknown = null;
    try {
      await dblp.fetch({ topics: ["solid-state batteries"], limit: 10 });
    } catch (err) {
      rejection = err;
    }

    expect(rejection).not.toBeNull();
    // Mutation check: remove the content-type gate and `res.json()` still
    // throws on this same HTML body — a bare SyntaxError — so a plain
    // `.rejects.toThrow()` alone would stay green whether or not the fix
    // exists. Only the specific class and message below tell "fixed" apart
    // from "not fixed".
    expect(rejection).toBeInstanceOf(DblpBotCheckError);
    expect((rejection as Error).name).toBe("DblpBotCheckError");
    expect((rejection as Error).message).toContain("bot-check page");
    expect((rejection as Error).message).not.toMatch(/unexpected token/i);
  });

  it("keeps today's behaviour when the content type says JSON but the body is malformed — an ordinary parse failure, not the bot-check error", async () => {
    globalThis.fetch = vi.fn(
      async () =>
        new Response("this is not valid JSON {{{", {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
    ) as unknown as typeof fetch;

    let rejection: unknown = null;
    try {
      await dblp.fetch({ topics: ["solid-state batteries"], limit: 10 });
    } catch (err) {
      rejection = err;
    }

    // Still fails honestly (unchanged P2-S2 throw contract) — just not
    // reclassified as the bot-check error, so this shape can never silently
    // start skipping same-day retries the way DBLP-BOTWALL ruling 2 reserves
    // for an actual challenge-page response.
    expect(rejection).not.toBeNull();
    expect(rejection).not.toBeInstanceOf(DblpBotCheckError);
  });
});

// QUERY-BUDGET (ABC-JEV-INTEGRATION.md §1az, docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md
// §2.4). Two changes to this source's own query cap: (1) with more than 2 Required tags, the
// cap rises so a tag past today's fixed MAX_QUERIES=2 is no longer silently dropped from every
// fetch, bounded so an unusual tag count cannot open the budget unboundedly (never more than
// RISE_CEILING=3 above MAX_QUERIES); (2) proved end to end for the case profile-compiler.ts's
// own Tier 0 exists to guarantee — a reader with 2 selected senses and 2 Required tags still has
// both tags reach this source, not the senses that rank after them in generatedQueries.
describe("dblp adapter — query cap (QUERY-BUDGET)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function fetchAndRecordQueries(query: Parameters<typeof dblp.fetch>[0]): Promise<string[]> {
    const seenQueries: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      seenQueries.push(new URL(String(url)).searchParams.get("q") ?? "");
      return new Response(JSON.stringify({ result: { hits: {} } }), { status: 200 });
    }) as unknown as typeof fetch;
    await dblp.fetch(query);
    return seenQueries;
  }

  it("sends both Required tags, not the senses ranked after them, when a reader has 2 tags and 2 selected senses", async () => {
    // Reproduces profile-compiler.ts's own Tier 0 order (tags lead, senses follow) for a
    // 2-selected-sense, 2-Required-tag reader — the exact case ABC-JEV-INTEGRATION.md §1az
    // measured today's code sending 0 of 2 tags for.
    const seenQueries = await fetchAndRecordQueries({
      topics: ["LCO", "LFP"],
      queries: ["LCO", "LFP", "role conflict", "conflict of interest"],
      limit: 10,
    });

    expect(seenQueries.sort()).toEqual(["LCO", "LFP"]);
  });

  it("raises the cap above 2 once a reader declares more than 2 Required tags, bounded at MAX_QUERIES+3", async () => {
    // A query pool bigger than every cap under test (8), so the number of calls made IS the
    // effective cap, independent of how many candidate queries exist.
    const pool = Array.from({ length: 8 }, (_, i) => `query${i}`);

    const oneTag = await fetchAndRecordQueries({ topics: ["tag0"], queries: pool, limit: 10 });
    expect(oneTag).toHaveLength(2); // unchanged baseline: <=2 tags never raises the cap

    const threeTags = await fetchAndRecordQueries({
      topics: ["tag0", "tag1", "tag2"],
      queries: pool,
      limit: 10,
    });
    expect(threeTags).toHaveLength(3); // 3 tags: cap rises 2 -> 3

    const sixTags = await fetchAndRecordQueries({
      topics: ["tag0", "tag1", "tag2", "tag3", "tag4", "tag5"],
      queries: pool,
      limit: 10,
    });
    expect(sixTags).toHaveLength(5); // 6 tags: cap rises 2 -> 5, the +3 ceiling (1 of 6 tags lost)
  });
});
