import { afterEach, describe, expect, it, vi } from "vitest";
import { pubmed } from "./pubmed";

// P2-S2 (Round 3) — F-A-P2-02. Same fix as every other academic adapter,
// applied to BOTH of PubMed's two calls (esearch then esummary): each used
// to catch a non-2xx response and return `[]`, and `fetchOne`'s own
// try/catch swallowed any thrown error the same way — both indistinguishable
// from a legitimately empty search. Now both throw on a genuine failure;
// `[]` is reserved for esearch genuinely returning no ids.

function esearchResponse(ids: string[]): Response {
  return new Response(
    JSON.stringify({ esearchresult: { idlist: ids } }),
    { status: 200 },
  );
}

function esummaryResponse(uid: string): Response {
  return new Response(
    JSON.stringify({
      result: {
        uids: [uid],
        [uid]: { uid, title: "A Real Paper", authors: [] },
      },
    }),
    { status: 200 },
  );
}

describe("pubmed adapter — failure visibility (P2-S2)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("still resolves [] when esearch answers 200 with zero ids (unchanged contract)", async () => {
    globalThis.fetch = vi.fn(async () => esearchResponse([])) as unknown as typeof fetch;

    const items = await pubmed.fetch({
      topics: ["a topic with genuinely no matches"],
      limit: 10,
    });
    expect(items).toEqual([]);
  });

  it("rejects instead of resolving [] when esearch gets a non-2xx response", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("upstream exploded", { status: 500 }),
    ) as unknown as typeof fetch;

    await expect(
      pubmed.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when esummary gets a non-2xx response", async () => {
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("esearch")) return esearchResponse(["111"]);
      return new Response("summary service down", { status: 500 });
    }) as unknown as typeof fetch;

    await expect(
      pubmed.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("rejects instead of resolving [] when every query throws a network error", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;

    await expect(
      pubmed.fetch({ topics: ["solid-state batteries"], limit: 10 }),
    ).rejects.toThrow();
  });

  it("still resolves with the successful subset when only some queries fail", async () => {
    let call = 0;
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      const href = String(url);
      call += 1;
      // Query 1 (whichever topic's esearch call goes first) fails outright;
      // query 2's esearch + esummary pair both succeed.
      if (call === 1) return new Response("boom", { status: 500 });
      if (href.includes("esearch")) return esearchResponse(["222"]);
      return esummaryResponse("222");
    }) as unknown as typeof fetch;

    const items = await pubmed.fetch({
      topics: ["solid-state batteries", "cathode interfaces"],
      limit: 10,
    });
    expect(items.map((item) => item.id)).toEqual(["pubmed:222"]);
  });
});

// QUERY-BUDGET (ABC-JEV-INTEGRATION.md §1az, docs/jev-abc/QUERY-BUDGET-B-20260929T094059Z.md
// §2.4). With more than 2 Required tags, this source's cap rises so a tag past today's fixed
// MAX_QUERIES=2 is no longer silently dropped from every fetch — bounded so an unusual tag count
// cannot open the budget unboundedly (never more than RISE_CEILING=3 above MAX_QUERIES).
describe("pubmed adapter — query cap (QUERY-BUDGET)", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  async function fetchAndRecordQueries(query: Parameters<typeof pubmed.fetch>[0]): Promise<string[]> {
    const seenQueries: string[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL) => {
      // No timeWindow is passed, so dateScopedQuery leaves `term` as the bare query — every
      // call here is an esearch call, and an empty idlist means fetchOne never reaches esummary.
      seenQueries.push(new URL(String(url)).searchParams.get("term") ?? "");
      return esearchResponse([]);
    }) as unknown as typeof fetch;
    await pubmed.fetch(query);
    return seenQueries;
  }

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
