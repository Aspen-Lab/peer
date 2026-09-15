import { afterEach, describe, expect, it, vi } from "vitest";

// ABC-freemium 8-01(b). `searchGemini` is the ONLY thing the grounding
// backfill can reach, so standing in for it is the only way to assert that a
// configured Vertex Search App does not reach grounding. Everything else in
// the module — `isGeminiSearchAvailable`, `resolveWebSearchProvider` — stays
// real, because those are the subject of the other half of this item.
const searchGeminiMock = vi.hoisted(() => vi.fn(async () => []));
vi.mock("./gemini-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./gemini-search")>()),
  searchGemini: searchGeminiMock,
}));

import { isGeminiSearchAvailable, resolveWebSearchProvider } from "./gemini-search";
import {
  discoveryResultToWebResult,
  isVertexSearchAvailable,
  needsVertexSourceTimeout,
  searchEndpoint,
  searchVertex,
  webSearchOptions,
  type DiscoveryResult,
} from "./vertex-search";

// ═══════════════════════════════════════════════════════════════════════════
// THE `vertex` PROVIDER — Vertex AI Search (Discovery Engine).
//
// The response fixtures below follow the documented `v1 …:search` shape for a
// WEBSITE data store: every returned field lives under
// `document.derivedStructData`, snippets arrive as an array of
// `{snippet, snippet_status}` with `<b>` highlight markup around the matched
// terms, and an unsnippetable page comes back as `NO_SNIPPET_AVAILABLE` with a
// human-readable placeholder in the `snippet` slot.
//
// The env-dependent tests save and restore `process.env` themselves. Vitest is
// configured to load only `GOOGLE_`-prefixed variables from `.env.local`, which
// is exactly the prefix this provider's own configuration uses — so a developer
// with a live Search App configured must not have these tests read it.
// ═══════════════════════════════════════════════════════════════════════════

const ENV_KEYS = [
  "GOOGLE_VERTEX_PROJECT",
  "GOOGLE_VERTEX_SEARCH_PROJECT",
  "GOOGLE_VERTEX_SEARCH_ENGINE_ID",
  "GOOGLE_VERTEX_SEARCH_DATA_STORE_ID",
  "GOOGLE_VERTEX_SEARCH_LOCATION",
  "GOOGLE_VERTEX_SEARCH_COLLECTION",
  "GOOGLE_VERTEX_SEARCH_SERVING_CONFIG",
  "GOOGLE_VERTEX_SEARCH_MIN_RESULTS",
  "GOOGLE_VERTEX_SEARCH_FALLBACK",
] as const;

const saved = new Map<string, string | undefined>();

function setEnv(values: Record<string, string | undefined>): void {
  for (const key of ENV_KEYS) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    delete process.env[key];
  }
  for (const [key, value] of Object.entries(values)) {
    if (!saved.has(key)) saved.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

afterEach(() => {
  for (const [key, value] of saved) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  saved.clear();
});

function websiteResult(
  overrides: Record<string, unknown> = {},
): DiscoveryResult {
  return {
    document: {
      derivedStructData: {
        link: "https://example.edu/workshop-2026",
        title: "Workshop on Molten Salt Reactors 2026",
        displayLink: "example.edu",
        snippets: [
          {
            snippet: "The <b>workshop</b> runs 12-14 May 2026 in Oak Ridge.",
            snippet_status: "SUCCESS",
          },
        ],
        ...overrides,
      },
    },
  };
}

describe("isVertexSearchAvailable", () => {
  it("is false with a project but no search app — nothing switches provider", () => {
    setEnv({ GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev" });
    expect(isVertexSearchAvailable()).toBe(false);
  });

  it("is false with a search app but no project", () => {
    setEnv({ GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123" });
    expect(isVertexSearchAvailable()).toBe(false);
  });

  it("is true once both are configured", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
    });
    expect(isVertexSearchAvailable()).toBe(true);
  });

  it("accepts a data-store id in place of an engine id", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_DATA_STORE_ID: "peer-sites_123",
    });
    expect(isVertexSearchAvailable()).toBe(true);
  });
});

describe("searchEndpoint", () => {
  it("uses the un-prefixed host for the global location", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
    });
    expect(searchEndpoint()).toBe(
      "https://discoveryengine.googleapis.com/v1/projects/peer-dev/locations/global" +
        "/collections/default_collection/engines/peer-web_123" +
        "/servingConfigs/default_search:search",
    );
  });

  it("prefixes the host for a regional location", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
      GOOGLE_VERTEX_SEARCH_LOCATION: "us",
    });
    expect(searchEndpoint()).toContain("https://us-discoveryengine.googleapis.com/");
    expect(searchEndpoint()).toContain("/locations/us/");
  });

  it("addresses a data store by its own collection path", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_DATA_STORE_ID: "peer-sites_123",
    });
    expect(searchEndpoint()).toContain("/dataStores/peer-sites_123/");
  });

  it("is null when nothing is configured", () => {
    setEnv({});
    expect(searchEndpoint()).toBeNull();
  });
});

describe("discoveryResultToWebResult", () => {
  it("returns the crawler's real title, link and de-marked-up snippet", () => {
    expect(discoveryResultToWebResult(websiteResult())).toEqual({
      title: "Workshop on Molten Salt Reactors 2026",
      url: "https://example.edu/workshop-2026",
      snippet: "The workshop runs 12-14 May 2026 in Oak Ridge.",
    });
  });

  it("drops a row with no link — a row with no target is not a row", () => {
    expect(discoveryResultToWebResult(websiteResult({ link: undefined }))).toBeNull();
  });

  it("drops a row with no title rather than falling back to the host", () => {
    const row = websiteResult({ title: undefined, htmlTitle: undefined });
    expect(discoveryResultToWebResult(row)).toBeNull();
  });

  it("treats NO_SNIPPET_AVAILABLE as an EMPTY snippet, not as page text", () => {
    const row = websiteResult({
      snippets: [
        {
          snippet: "No snippet is available for this page.",
          snippet_status: "NO_SNIPPET_AVAILABLE",
        },
      ],
    });
    // The event mapper reads an empty snippet as "judge on the title alone".
    // Letting the placeholder through would silently switch that branch off.
    expect(discoveryResultToWebResult(row)?.snippet).toBe("");
  });

  it("falls back to an extractive answer when no snippet succeeded", () => {
    const row = websiteResult({
      snippets: [{ snippet: "", snippet_status: "NO_SNIPPET_AVAILABLE" }],
      extractive_answers: [{ content: "Registration closes 1 April 2026." }],
    });
    expect(discoveryResultToWebResult(row)?.snippet).toBe(
      "Registration closes 1 April 2026.",
    );
  });
});

describe("searchVertex", () => {
  const search = (results: DiscoveryResult[]) => async () => results;

  it("maps, caps and de-duplicates without any page fetch", async () => {
    const rows = await searchVertex("molten salt reactor workshop", {
      search: search([
        websiteResult(),
        websiteResult(), // same link — one row
        websiteResult({ link: "https://example.edu/second", title: "Second" }),
      ]),
      maxResults: 2,
      fallbackMinResults: 0,
    });
    expect(rows.map((row) => row.url)).toEqual([
      "https://example.edu/workshop-2026",
      "https://example.edu/second",
    ]);
    // No title recovery stage means no row can be dropped for lacking a title.
    expect(rows.every((row) => Boolean(row.title))).toBe(true);
  });

  it("pre-screens denied hosts and excluded domains before returning them", async () => {
    const rows = await searchVertex("q", {
      search: search([
        websiteResult({ link: "https://arxiv.org/abs/2601.00001" }),
        websiteResult(),
      ]),
      excludeDomains: ["arxiv.org"],
      fallbackMinResults: 0,
    });
    expect(rows.map((row) => row.url)).toEqual([
      "https://example.edu/workshop-2026",
    ]);
  });

  it("annotates pageKind from the page's own JSON-LD when asked", async () => {
    const rows = await searchVertex("q", {
      search: search([websiteResult()]),
      detectPageKind: true,
      fallbackMinResults: 0,
      fetchPages: async () => [
        '<html><script type="application/ld+json">{"@type":"Event"}</script></html>',
      ],
    });
    expect(rows[0].pageKind).toBe("event");
  });

  it("leaves pageKind undefined when the fetch fails — the row survives", async () => {
    const rows = await searchVertex("q", {
      search: search([websiteResult()]),
      detectPageKind: true,
      fallbackMinResults: 0,
      fetchPages: async () => [null],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].pageKind).toBeUndefined();
  });

  it("does not fetch pages at all unless detectPageKind is set", async () => {
    let fetched = 0;
    await searchVertex("q", {
      search: search([websiteResult()]),
      fallbackMinResults: 0,
      fetchPages: async (urls) => {
        fetched += urls.length;
        return urls.map(() => null);
      },
    });
    expect(fetched).toBe(0);
  });

  it("backfills with grounding only when the index under-delivers", async () => {
    let grounded = 0;
    const rows = await searchVertex("obscure new host", {
      search: search([websiteResult()]),
      maxResults: 5,
      fallbackMinResults: 3,
      groundFallback: async () => {
        grounded += 1;
        return [
          { title: "New host", url: "https://newhost.org/cfp", snippet: "" },
        ];
      },
    });
    expect(grounded).toBe(1);
    // Vertex rows keep their position; grounding only tops the list up.
    expect(rows.map((row) => row.url)).toEqual([
      "https://example.edu/workshop-2026",
      "https://newhost.org/cfp",
    ]);
  });

  it("does not backfill when the index already filled the query", async () => {
    let grounded = 0;
    await searchVertex("well covered", {
      search: search([
        websiteResult(),
        websiteResult({ link: "https://example.edu/b", title: "B" }),
        websiteResult({ link: "https://example.edu/c", title: "C" }),
      ]),
      fallbackMinResults: 3,
      groundFallback: async () => {
        grounded += 1;
        return [];
      },
    });
    expect(grounded).toBe(0);
  });

  it("returns an empty array when the search itself throws", async () => {
    setEnv({});
    const rows = await searchVertex("q", {
      search: async () => {
        throw new Error("boom");
      },
      fallbackMinResults: 0,
    });
    expect(rows).toEqual([]);
  });
});

/**
 * ABC-freemium 8-01 · Ruling 21 point 2 · Ruling 23 points 3-4.
 *
 * **Two things used to be one thing.** Vertex AI Search and Gemini grounding
 * both came up off `GOOGLE_VERTEX_PROJECT`, so there was no configuration in
 * which you could have the cheap site-scoped index without also arming the
 * most expensive path in the product — and grounding then ran *inside* the
 * Vertex call as an opt-out backfill, which is the same mechanism reached by
 * fallback rather than by choice.
 *
 * Neither half had a test. Inverting the backfill default reddened **zero**
 * tests before this block existed, because every existing backfill case
 * injects `groundFallback` and so never reaches the switch that decides
 * whether grounding is armed at all. **The switches that move money were the
 * untested ones.**
 *
 * None of this makes anything reachable: `operatorSearchAvailability()` is
 * frozen false for both capabilities (D2a), and `system-key.test.ts` is what
 * holds that. This block is about which variable would answer on a day when
 * the answer is allowed to be yes.
 */
describe("8-01 — Vertex AI Search and Gemini grounding are separate switches", () => {
  it("brings Vertex search up on its OWN project name, with grounding still off", () => {
    // The separation, stated as the pair it is: one signal true, the other
    // false, from one configuration. Asserting only the first half would pass
    // just as well before this item as after it.
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-search-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
    });
    expect(isVertexSearchAvailable()).toBe(true);
    expect(isGeminiSearchAvailable()).toBe(false);
  });

  it("no longer brings Vertex search up off the Gemini model project", () => {
    // The other direction, and the one that used to be impossible: a Vertex
    // MODEL project plus a Search App used to be enough to switch the search
    // provider. The app id is present here on purpose, so this fails if the
    // dropped fallback ever comes back.
    setEnv({
      GOOGLE_VERTEX_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
    });
    expect(isVertexSearchAvailable()).toBe(false);
    expect(isGeminiSearchAvailable()).toBe(true);
  });

  it("does NOT reach grounding when a Search App is configured and nothing asked for it", async () => {
    // The case that did not exist, and the one 8-01(b) is for. No injected
    // `groundFallback`, so the real enable predicate decides — and the query
    // comes back under the threshold, which is exactly when the backfill used
    // to fire. Both project names are set, so this cannot pass merely because
    // grounding was unconfigured.
    searchGeminiMock.mockClear();
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-search-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
      GOOGLE_VERTEX_PROJECT: "peer-dev",
    });

    const rows = await searchVertex("obscure new host", {
      search: async () => [websiteResult()],
      maxResults: 5,
      fallbackMinResults: 3,
    });

    expect(searchGeminiMock).not.toHaveBeenCalled();
    // The thin result is returned as it is. Fewer rows, no surprise bill.
    expect(rows).toHaveLength(1);
  });

  it("still reaches grounding when somebody deliberately turns the backfill on", async () => {
    // The capability is switched off, not deleted (Ruling 23 point 3). This is
    // also what proves the case above can tell armed from unarmed, rather than
    // passing because the backfill never runs any more.
    searchGeminiMock.mockClear();
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-search-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
      GOOGLE_VERTEX_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_FALLBACK: "on",
    });

    await searchVertex("obscure new host", {
      search: async () => [websiteResult()],
      maxResults: 5,
      fallbackMinResults: 3,
    });

    expect(searchGeminiMock).toHaveBeenCalledTimes(1);
  });

  it("stays off when the backfill flag is on but the index already filled the query", async () => {
    // The threshold is the tuning knob and it still works: armed plus
    // well-served is still no grounding call, so "on" does not mean "always".
    searchGeminiMock.mockClear();
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-search-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
      GOOGLE_VERTEX_SEARCH_FALLBACK: "on",
    });

    await searchVertex("well covered", {
      search: async () => [
        websiteResult(),
        websiteResult({ link: "https://example.edu/b", title: "B" }),
        websiteResult({ link: "https://example.edu/c", title: "C" }),
      ],
      fallbackMinResults: 3,
    });

    expect(searchGeminiMock).not.toHaveBeenCalled();
  });
});

describe("resolveWebSearchProvider with vertex", () => {
  const base = {
    geminiAvailable: true,
    braveKeyPresent: false,
    tavilyKeyPresent: false,
    requestTavilyKeyPresent: false,
  };

  it("prefers vertex over gemini in auto when both are wired", () => {
    expect(
      resolveWebSearchProvider(undefined, { ...base, vertexAvailable: true }),
    ).toBe("vertex");
  });

  it("still returns gemini when no Search App is configured", () => {
    expect(resolveWebSearchProvider(undefined, base)).toBe("gemini");
  });

  it("honours an explicit gemini preference — this changes the default only", () => {
    expect(
      resolveWebSearchProvider("gemini", { ...base, vertexAvailable: true }),
    ).toBe("gemini");
  });

  it("refuses an explicit vertex preference when no Search App exists", () => {
    expect(resolveWebSearchProvider("vertex", base)).toBeNull();
  });

  it("keeps Tavily ahead of vertex when the caller supplied a Tavily key", () => {
    expect(
      resolveWebSearchProvider(undefined, {
        ...base,
        vertexAvailable: true,
        tavilyKeyPresent: true,
        requestTavilyKeyPresent: true,
      }),
    ).toBe("tavily");
  });
});

describe("webSearchOptions", () => {
  it("selects vertex when a Search App is configured", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
    });
    expect(webSearchOptions(undefined)).toEqual({ provider: "vertex" });
  });

  it("falls back to gemini when only Vertex model credentials exist", () => {
    setEnv({ GOOGLE_VERTEX_PROJECT: "peer-dev" });
    expect(webSearchOptions(undefined)).toEqual({ provider: "gemini" });
  });

  it("honours the existing gemini opt-out for both engines", () => {
    setEnv({
      GOOGLE_VERTEX_SEARCH_PROJECT: "peer-search-dev",
      GOOGLE_VERTEX_SEARCH_ENGINE_ID: "peer-web_123",
      GOOGLE_VERTEX_PROJECT: "peer-dev",
    });
    expect(webSearchOptions({ gemini: { enabled: false } })).toBeUndefined();
  });

  it("is undefined when Vertex is absent entirely", () => {
    setEnv({});
    expect(webSearchOptions(undefined)).toBeUndefined();
  });
});

describe("needsVertexSourceTimeout", () => {
  it("covers both server-Vertex providers and nothing else", () => {
    expect(needsVertexSourceTimeout("vertex")).toBe(true);
    expect(needsVertexSourceTimeout("gemini")).toBe(true);
    expect(needsVertexSourceTimeout("tavily")).toBe(false);
    expect(needsVertexSourceTimeout(undefined)).toBe(false);
  });
});
