import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Only the two model-backed searchers are stood in for; the provider-order
// helpers and the gate stay REAL, because they are the subject.
const geminiSearchMock = vi.hoisted(() => vi.fn());
const vertexSearchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sources/gemini-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/gemini-search")>()),
  searchGemini: geminiSearchMock,
}));
vi.mock("@/lib/sources/vertex-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/vertex-search")>()),
  searchVertex: vertexSearchMock,
}));

import { webSearch } from "./web-search";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import {
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "@/lib/usage/events";

/**
 * ABC-freemium 2-04 · D3 · Ruling 3 point 5 · Ruling 6 point 3.
 *
 * **This file had no test suite at all**, which is a large part of why the two
 * ungated capability reads in it went unnoticed for a round. `feed/pipeline.ts`
 * passes a hard `systemSearchAllowed: false`, and that made the surface
 * permanently free of spend **only for Tavily**: Brave arrived from an ungated
 * environment read, and `isGeminiSearchAvailable()` / `isVertexSearchAvailable()`
 * were called directly here, so both walked straight past the flag.
 *
 * The papers surface now spends nothing on any operator key in **any** runtime
 * (Ruling 6 point 3), including local development.
 */
describe("the papers web source spends nothing on an operator key", () => {
  const rows: UsageEventRow[] = [];

  const query = {
    topics: ["molten salt"],
    queries: ["molten salt electrochemistry"],
    limit: 20,
  };

  /** Everything an operator could possibly have configured, all at once. */
  function configureEveryOperatorCredential(): void {
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "peer-web");
  }

  beforeEach(() => {
    rows.length = 0;
    resetCounterStoreForTests();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setUsageEventsClientForTests({
      from: () => ({
        insert: (inserted: UsageEventRow[]) => {
          rows.push(...inserted);
          return Promise.resolve({ error: null });
        },
      }),
    } as never);
    geminiSearchMock.mockResolvedValue([]);
    vertexSearchMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setUsageEventsClientForTests(undefined);
    resetCounterStoreForTests();
    geminiSearchMock.mockReset();
    vertexSearchMock.mockReset();
  });

  it("returns [] with every operator credential set and no entitlement", async () => {
    // THE case this file exists for. Before 2-04 this ran Vertex AI Search on
    // the operator's project for an anonymous caller, with no gate, no breaker
    // and no usage row.
    configureEveryOperatorCredential();

    const items = await webSearch.fetch({
      ...query,
      webSearch: { systemSearchAllowed: false },
    });

    expect(items).toEqual([]);
    expect(vertexSearchMock).not.toHaveBeenCalled();
    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });

  it("returns [] when the query carries no webSearch block at all", async () => {
    // The default is `false`, never inferred — a query that says nothing is not
    // entitled. This is the shape the surface actually sends when the gemini
    // connector is switched off.
    configureEveryOperatorCredential();

    expect(await webSearch.fetch(query)).toEqual([]);
    expect(vertexSearchMock).not.toHaveBeenCalled();
    expect(geminiSearchMock).not.toHaveBeenCalled();
  });

  it("is unaffected by the RUNTIME — there is no local-development exemption", async () => {
    // Ruling 6 point 3 accepted this explicitly: Rulings 75 and 79c of the
    // report-parity loop kept this source alive locally through grounding, and
    // they are superseded for this surface. The gate is one predicate with no
    // runtime test inside it, which is the shape 1-06 and R-ENT-5 removed.
    configureEveryOperatorCredential();
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");

    expect(
      await webSearch.fetch({ ...query, webSearch: { systemSearchAllowed: false } }),
    ).toEqual([]);
    expect(geminiSearchMock).not.toHaveBeenCalled();
  });

  it("still honours a reader's OWN Tavily key, which costs the operator nothing", async () => {
    // D3 is about the operator's money, not about switching the source off. If
    // a BYOK key is ever threaded to this surface it must still work — and it
    // must still write no row.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(JSON.stringify({ results: [] }), { status: 200 }),
      );

    await webSearch.fetch({
      ...query,
      webSearch: { tavilyApiKey: "USER-NOT-A-KEY", systemSearchAllowed: false },
    });

    expect(fetchSpy).toHaveBeenCalled();
    // BYOK is never charged and never attributed.
    expect(rows).toHaveLength(0);
    fetchSpy.mockRestore();
  });

  it("writes NO usage row and calls no adapter, even with the flag forced true", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12).
    //
    // Was "has the metering wired even though the gate makes it unreachable".
    // It forced `systemSearchAllowed: true` with a Vertex project configured and
    // asserted the opposite of everything below:
    //
    //     expect(geminiSearchMock).toHaveBeenCalled();
    //     expect(rows).toHaveLength(1);
    //     expect(rows[0]).toMatchObject({
    //       kind: "search", surface: "papers", provider: "gemini", byok: false,
    //     });
    //
    // The old expectation is kept above rather than thrown away, because the
    // row's SHAPE is knowledge 2-04 bought — the row names the `provider` that
    // actually ran, never a hard-coded `"tavily"` — and it should not vanish
    // from the file with the assertion.
    //
    // **What it proves now, and it is a sharper statement than before.** Forcing
    // the entitlement flag `true` is the most generous input this surface can be
    // given, and the answer is still nothing: `operatorSearchAvailability` is
    // frozen `false`, so no provider resolves, no adapter is called, and no row
    // is written. That makes it **standing tally 2 of Ruling 12 point 7** for
    // the papers surface — `kind:"search"` rows produced must be 0 — measured
    // rather than argued.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "");

    await webSearch.fetch({
      ...query,
      webSearch: {
        provider: "gemini",
        systemSearchAllowed: true,
        userId: "user-1",
      },
    });

    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
    expect(rows.filter((row) => row.kind === "search")).toEqual([]);
  });
});
