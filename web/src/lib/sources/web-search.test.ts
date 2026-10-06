import { afterEach, describe, expect, it, vi } from "vitest";
import { webSearch } from "./web-search";
import { armEveryOperatorSearchCredential } from "@/test-support/route-harness";

/**
 * ABC-freemium 2-04 · D3 · Ruling 3 point 5 · Ruling 6 point 3, rewritten for
 * the BYOK-only change (scope (b)).
 *
 * **This file had no test suite at all** before 2-04, which is a large part of
 * why two ungated capability reads in it went unnoticed for a round. Those
 * reads (Brave, Vertex AI Search, Gemini grounding) are gone with the engines
 * behind them: Peer funds no search for anyone, so the only search the papers
 * `web` source can run is on a Tavily key a reader pasted in themselves and sent
 * in the request. The cases that remain say so from both sides: a credential in
 * the server's environment is not a search, in any runtime, and a reader's own
 * key still is.
 */
describe("the papers web source runs on a reader's own key and nothing else", () => {
  const query = {
    topics: ["molten salt"],
    queries: ["molten salt electrochemistry"],
    limit: 20,
  };

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("returns [] and makes no outgoing call with every environment credential set and no reader key", async () => {
    // THE case this file exists for. Before 2-04 this ran Vertex AI Search on
    // the operator's project for an anonymous caller, with no gate, no breaker
    // and no usage row.
    armEveryOperatorSearchCredential(vi.stubEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const items = await webSearch.fetch({ ...query, webSearch: {} });

    expect(items).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns [] when the query carries no webSearch block at all", async () => {
    // A query that says nothing carries no key. This is the shape the papers
    // pipeline actually sends.
    armEveryOperatorSearchCredential(vi.stubEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await webSearch.fetch(query)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("is unaffected by the RUNTIME — there is no local-development exemption", async () => {
    // Ruling 6 point 3 accepted this explicitly: Rulings 75 and 79c of the
    // report-parity loop kept this source alive locally through grounding, and
    // they are superseded for this surface. A developer machine with every name
    // set gets nothing either.
    armEveryOperatorSearchCredential(vi.stubEnv);
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("VERCEL", "");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    expect(await webSearch.fetch(query)).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("still runs a reader's OWN Tavily key, and sends it nowhere but Tavily", async () => {
    // D3 is about Peer's money, not about switching the source off. If a
    // reader's key is ever threaded to this surface it must work — and the
    // environment must not be what answers.
    armEveryOperatorSearchCredential(vi.stubEnv);
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            results: [
              {
                title: "Molten salt electrochemistry review",
                url: "https://example.org/review",
                content: "A review.",
              },
              { title: "", url: "https://example.org/untitled" },
            ],
          }),
          { status: 200 },
        ),
    );

    const items = await webSearch.fetch({
      ...query,
      webSearch: { tavilyApiKey: "USER-NOT-A-KEY" },
    });

    expect(fetchSpy).toHaveBeenCalled();
    for (const call of fetchSpy.mock.calls) {
      expect(String(call[0])).toBe("https://api.tavily.com/search");
      const body = JSON.parse(String((call[1] as RequestInit).body)) as Record<string, unknown>;
      expect(body.api_key).toBe("USER-NOT-A-KEY");
    }
    // One row per distinct url; the title-less row is dropped.
    expect(items).toEqual([
      expect.objectContaining({
        id: "web:https://example.org/review",
        source: "web",
        venue: "Web",
        title: "Molten salt electrochemistry review",
      }),
    ]);
  });

  it("reports a reader's dead key instead of returning an empty web", async () => {
    // sources/search-failure.ts: a key that fails on every query is REPORTED.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("invalid key", { status: 401 }),
    );

    await expect(
      webSearch.fetch({ ...query, webSearch: { tavilyApiKey: "USER-NOT-A-KEY" } }),
    ).rejects.toThrow(/tavily web search failed for every query/);
  });
});
