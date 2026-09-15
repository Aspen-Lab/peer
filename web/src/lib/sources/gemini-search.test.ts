import { afterEach, describe, expect, it, vi } from "vitest";
import {
  GEMINI_SOURCE_TIMEOUT_MS,
  geminiSearchDeadline,
  geminiWebSearchOptions,
  groundingWebChunks,
  isGeminiSearchAvailable,
  isPreScreenedOut,
  pageDeclaresEventFromHtml,
  pageSnippetFromHtml,
  pageTitleFromHtml,
  resolveGroundingRedirect,
  resolveWebSearchProvider,
  searchGemini,
  type GroundingWebChunk,
} from "./gemini-search";

// ═══════════════════════════════════════════════════════════════════════════
// RULING 75 — THE `gemini` WEB-SEARCH PROVIDER.
//
// The fixtures below are RECORDED, not imagined. Round 28 C ran one grounded
// `gemini-2.5-flash` query against the live Vertex endpoint on 2026-08-15 and
// clipped the result: three rows, redirect tokens truncated to 24 characters so
// no live token is committed. Everything the fixture shows was measured —
// including the fact the whole design turns on, that `web.title` came back as
// the registrable DOMAIN on 5 of 5 rows (B measured 64 of 64).
// ═══════════════════════════════════════════════════════════════════════════

const REDIRECT_PREFIX =
  "https://vertexaisearch.cloud.google.com/grounding-api-redirect/";

/**
 * The SDK stood in for, so the production grounding path — the one that builds
 * its OWN config because `genConfig` is refused with the Search tool — is
 * exercised rather than bypassed by a test seam.
 */
const generateContentMock = vi.hoisted(() => vi.fn());
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    models = { generateContent: generateContentMock };
  },
}));

/** Recorded live shape, clipped. `title` === `domain` on every row. */
const RECORDED_GROUNDING_RESPONSE = {
  candidates: [
    {
      content: { parts: [{ text: "Several molten salt meetings are scheduled…" }] },
      groundingMetadata: {
        webSearchQueries: ["molten salt electrochemistry conference 2026"],
        searchEntryPoint: { renderedContent: "<style>…</style>" },
        groundingChunks: [
          {
            web: {
              uri: `${REDIRECT_PREFIX}AUZIYQFr17qUMbT2Tx9MnO0c`,
              title: "byu.edu",
              domain: "byu.edu",
            },
          },
          {
            web: {
              uri: `${REDIRECT_PREFIX}AUZIYQGaNJ3nWJ7s_dX_n3vJ`,
              title: "grc.org",
              domain: "grc.org",
            },
          },
          {
            web: {
              uri: `${REDIRECT_PREFIX}AUZIYQFDcLGxUK7IzmdRZcPW`,
              title: "programmaster.org",
              domain: "programmaster.org",
            },
          },
        ],
        groundingSupports: [
          { segment: { text: "Several molten salt meetings are scheduled" } },
        ],
        retrievalMetadata: {},
      },
    },
  ],
};

/** Measured: a nonsense query and a non-web question both return this. */
const EMPTY_GROUNDING_RESPONSE = {
  candidates: [{ groundingMetadata: { groundingChunks: [] } }],
};

function chunk(token: string): GroundingWebChunk {
  return { uri: `${REDIRECT_PREFIX}${token}`, title: "example.com", domain: "example.com" };
}

function page(title: string, description?: string): string {
  return `<html><head><title>${title}</title>${
    description ? `<meta name="description" content="${description}">` : ""
  }</head><body>x</body></html>`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  generateContentMock.mockReset();
});

// ── STAGE 1 — the grounding channel ────────────────────────────────────────

describe("groundingWebChunks — the recorded live shape", () => {
  it("reads every web chunk out of the recorded response", () => {
    const chunks = groundingWebChunks(RECORDED_GROUNDING_RESPONSE);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].uri).toBe(`${REDIRECT_PREFIX}AUZIYQFr17qUMbT2Tx9MnO0c`);
  });

  it("records the central measured fact: every chunk title IS the domain", () => {
    // THE reason the design recovers page titles. If this ever stops being true
    // the design can be revisited — until then, `web.title` is a hostname.
    const chunks = groundingWebChunks(RECORDED_GROUNDING_RESPONSE);
    expect(chunks).toHaveLength(3);
    for (const c of chunks) expect(c.title).toBe(c.domain);
  });

  it("every recorded uri is a grounding redirect, not a target url", () => {
    for (const c of groundingWebChunks(RECORDED_GROUNDING_RESPONSE)) {
      expect(c.uri?.startsWith(REDIRECT_PREFIX)).toBe(true);
    }
  });

  it("returns [] for a query that grounded nothing (measured: empty array, no throw)", () => {
    expect(groundingWebChunks(EMPTY_GROUNDING_RESPONSE)).toEqual([]);
  });

  it("returns [] when groundingMetadata is absent entirely", () => {
    expect(groundingWebChunks({ candidates: [{ content: {} }] })).toEqual([]);
  });

  it("returns [] when there are no candidates", () => {
    expect(groundingWebChunks({ candidates: [] })).toEqual([]);
    expect(groundingWebChunks({})).toEqual([]);
    expect(groundingWebChunks(null)).toEqual([]);
    expect(groundingWebChunks("not a response")).toEqual([]);
  });

  it("returns [] when groundingChunks is not an array", () => {
    expect(
      groundingWebChunks({ candidates: [{ groundingMetadata: { groundingChunks: {} } }] }),
    ).toEqual([]);
  });

  it("filters the non-web chunk kinds — UNWITNESSED, not cleared", () => {
    // 0 of 64 for B and 0 of 5 for C, but `maps` / `retrievedContext` / `image`
    // are in the SDK union, so the filter is written for them rather than
    // assuming they cannot arrive.
    const mixed = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { maps: { uri: "https://maps.example/x", title: "Somewhere" } },
              { retrievedContext: { uri: "https://corpus.example/y", title: "Doc" } },
              { web: { uri: `${REDIRECT_PREFIX}keeper`, title: "a.com", domain: "a.com" } },
            ],
          },
        },
      ],
    };
    const chunks = groundingWebChunks(mixed);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].uri).toBe(`${REDIRECT_PREFIX}keeper`);
  });

  it("drops a web chunk with no uri, and one whose uri is not a string", () => {
    const broken = {
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { title: "a.com", domain: "a.com" } },
              { web: { uri: 42, title: "b.com" } },
              { web: { uri: "", title: "c.com" } },
              { web: { uri: `${REDIRECT_PREFIX}ok` } },
            ],
          },
        },
      ],
    };
    expect(groundingWebChunks(broken)).toHaveLength(1);
  });
});

// ── STAGE 2 — redirect resolution ──────────────────────────────────────────

describe("resolveGroundingRedirect — the 302/404 split, measured", () => {
  function stubFetch(impl: (input: unknown, init?: unknown) => Promise<Response>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
  }

  it("reads the target out of a 302 Location, path and query intact", async () => {
    stubFetch(async () =>
      new Response(null, {
        status: 302,
        headers: { location: "https://lanl.jobs/search/jobdetails/x?src=grounding&id=7" },
      }),
    );
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`)).resolves.toBe(
      "https://lanl.jobs/search/jobdetails/x?src=grounding&id=7",
    );
  });

  it("uses HEAD with manual redirect and NEVER fetches the target page", async () => {
    const spy = stubFetch(async () =>
      new Response(null, { status: 302, headers: { location: "https://example.org/a" } }),
    );
    await resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`);
    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0];
    expect(url).toBe(`${REDIRECT_PREFIX}tok`);
    expect((init as RequestInit).method).toBe("HEAD");
    expect((init as RequestInit).redirect).toBe("manual");
  });

  it("DROPS a corrupted token — 404 with no Location, measured at 275–452ms", async () => {
    stubFetch(async () => new Response(null, { status: 404 }));
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}bad`)).resolves.toBeNull();
  });

  it("DROPS a 302 that carries no Location header", async () => {
    stubFetch(async () => new Response(null, { status: 302 }));
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`)).resolves.toBeNull();
  });

  it("DROPS a 200 — only a 302 is a resolution", async () => {
    stubFetch(async () =>
      new Response(null, { status: 200, headers: { location: "https://example.org/a" } }),
    );
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`)).resolves.toBeNull();
  });

  it("DROPS a Location that is not an http(s) url", async () => {
    stubFetch(async () =>
      new Response(null, { status: 302, headers: { location: "javascript:alert(1)" } }),
    );
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`)).resolves.toBeNull();
  });

  it("DROPS on a network failure instead of throwing", async () => {
    stubFetch(async () => {
      throw new Error("socket hang up");
    });
    await expect(resolveGroundingRedirect(`${REDIRECT_PREFIX}tok`)).resolves.toBeNull();
  });

  it("passes a direct http url through without a request (defensive branch)", async () => {
    const spy = stubFetch(async () => new Response(null, { status: 302 }));
    await expect(resolveGroundingRedirect("https://example.org/direct")).resolves.toBe(
      "https://example.org/direct",
    );
    expect(spy).not.toHaveBeenCalled();
  });

  it("drops a non-redirect uri that is not an http url either", async () => {
    await expect(resolveGroundingRedirect("mailto:someone@example.org")).resolves.toBeNull();
  });
});

// ── STAGE 2b — the host pre-screen and its boundary ────────────────────────

describe("isPreScreenedOut — only outright, title-independent denies", () => {
  it("screens out a host the shipped page fetcher refuses anyway", () => {
    expect(isPreScreenedOut("https://10times.com/x", {})).toBe(true);
    expect(isPreScreenedOut("https://www.10times.com/x", {})).toBe(true);
    expect(isPreScreenedOut("https://sub.10times.com/x", {})).toBe(true);
  });

  it("screens out a caller's outright deny host", () => {
    expect(isPreScreenedOut("https://denied.example/x", { denyHosts: ["denied.example"] })).toBe(true);
  });

  it("screens out a caller's excluded domain", () => {
    expect(
      isPreScreenedOut("https://arxiv.org/abs/1", { excludeDomains: ["arxiv.org"] }),
    ).toBe(true);
  });

  it("does NOT screen an aggregator host — that list requires a posting id, it does not deny", () => {
    // The admission-neutrality proof B demanded by test rather than argument:
    // `indeed.com` and `ziprecruiter.com` reach the shipped job admission and
    // are judged there on their posting id. Pre-screening them here would drop
    // rows the shipped rule ADMITS.
    expect(isPreScreenedOut("https://indeed.com/viewjob?jk=abc", {})).toBe(false);
    expect(isPreScreenedOut("https://www.ziprecruiter.com/c/x/Job/y", {})).toBe(false);
  });

  it("screens out anything that is not a parseable url", () => {
    expect(isPreScreenedOut("not a url", {})).toBe(true);
  });

  it("keeps an ordinary host", () => {
    expect(isPreScreenedOut("https://pyro.byu.edu/moses", {})).toBe(false);
  });
});

// ── STAGE 3 — the title and snippet channel ────────────────────────────────

describe("pageTitleFromHtml — the page's own name, never a hostname", () => {
  it("prefers og:title", () => {
    expect(
      pageTitleFromHtml(
        '<meta property="og:title" content="Molten Salt Electrochemistry Symposium (MoSES)"><title>pyro.byu.edu</title>',
      ),
    ).toBe("Molten Salt Electrochemistry Symposium (MoSES)");
  });

  it("falls back to the title element", () => {
    expect(pageTitleFromHtml(page("Nuclear Materials and Molten Salt Technologist 1"))).toBe(
      "Nuclear Materials and Molten Salt Technologist 1",
    );
  });

  it("decodes entities the way every other display path does", () => {
    expect(pageTitleFromHtml(page("Materials &amp; Chemistry"))).toBe("Materials & Chemistry");
  });

  it("returns undefined for a page with no title at all", () => {
    expect(pageTitleFromHtml("<html><body>no head</body></html>")).toBeUndefined();
  });

  it("returns undefined for an empty title element", () => {
    expect(pageTitleFromHtml("<html><head><title>   </title></head></html>")).toBeUndefined();
  });

  it("returns undefined when the page could not be fetched", () => {
    expect(pageTitleFromHtml(null)).toBeUndefined();
  });
});

describe("pageSnippetFromHtml — page-derived text or the empty string", () => {
  it("prefers og:description", () => {
    expect(
      pageSnippetFromHtml('<meta property="og:description" content="Held in Provo, Utah.">'),
    ).toBe("Held in Provo, Utah.");
  });

  it("falls back to the plain meta description", () => {
    expect(pageSnippetFromHtml(page("T", "A four-day symposium."))).toBe("A four-day symposium.");
  });

  it("is the EMPTY STRING when the page describes itself nowhere", () => {
    // Not a drop, and never model prose. Both shipped mappers read
    // `result.snippet ?? ""` and the event mapper's dateless branch is
    // explicitly unaffected by an empty snippet.
    expect(pageSnippetFromHtml(page("T"))).toBe("");
    expect(pageSnippetFromHtml(null)).toBe("");
  });
});

// ── THE WHOLE ADAPTER ──────────────────────────────────────────────────────

describe("searchGemini — three stages, drop-on-undecidable", () => {
  function harness(options: {
    chunks: GroundingWebChunk[];
    resolved: Record<string, string | null>;
    pages: Record<string, string | null>;
  }) {
    const fetched: string[][] = [];
    return {
      fetched,
      call: (extra: Record<string, unknown> = {}) =>
        searchGemini("molten salt", {
          ground: async () => options.chunks,
          resolveRedirect: async (uri) => options.resolved[uri] ?? null,
          fetchPages: async (urls) => {
            fetched.push(urls);
            return urls.map((u) => options.pages[u] ?? null);
          },
          ...extra,
        }),
    };
  }

  it("returns the page's own title and a real target url", async () => {
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://pyro.byu.edu/moses" },
      pages: { "https://pyro.byu.edu/moses": page("Molten Salt Electrochemistry Symposium (MoSES)", "Provo.") },
    });
    await expect(h.call()).resolves.toEqual([
      {
        title: "Molten Salt Electrochemistry Symposium (MoSES)",
        url: "https://pyro.byu.edu/moses",
        snippet: "Provo.",
      },
    ]);
  });

  it("NEVER uses the chunk title — a row whose page has no title is DROPPED", async () => {
    // The item's central negative. Regime A (chunk title = hostname) admitted
    // 31 of 40 job rows under a bare host; this asserts the hostname can never
    // reach a result, not even as a last resort.
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://lanl.jobs/search/x" },
      pages: { "https://lanl.jobs/search/x": "<html><body>bot wall</body></html>" },
    });
    const rows = await h.call();
    expect(rows).toEqual([]);
    expect(JSON.stringify(rows)).not.toContain("example.com");
  });

  it("drops a row whose page could not be fetched at all", async () => {
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://tesla.com/careers/x" },
      pages: {},
    });
    await expect(h.call()).resolves.toEqual([]);
  });

  it("drops the unresolvable row and keeps the resolvable one in the same call", async () => {
    const h = harness({
      chunks: [chunk("good"), chunk("bad")],
      resolved: {
        [`${REDIRECT_PREFIX}good`]: "https://grc.org/molten-salts",
        [`${REDIRECT_PREFIX}bad`]: null,
      },
      pages: { "https://grc.org/molten-salts": page("Molten Salts Gordon Research Conference") },
    });
    const rows = await h.call();
    expect(rows).toHaveLength(1);
    expect(rows[0].url).toBe("https://grc.org/molten-salts");
  });

  it("NEVER passes an unresolved redirect token through as the row's url", async () => {
    // **THE UNIQUELY-RED CASE FOR THE DROP RULE, and it was not free.** The
    // "drops the unresolvable row" test above turned out to be VACUOUS on this
    // clause: with the drop removed, the redirect token became the url, its
    // page fetch found nothing, and the row died to the NO-TITLE rule instead —
    // green either way. Here the token's own "page" is deliberately fetchable
    // and titled, so nothing downstream can rescue the row: it survives if and
    // only if the drop rule is gone. The loop's guards parse URL SHAPES, and an
    // opaque token carries none of them.
    const h = harness({
      chunks: [chunk("unresolvable")],
      resolved: { [`${REDIRECT_PREFIX}unresolvable`]: null },
      pages: { [`${REDIRECT_PREFIX}unresolvable`]: page("A Perfectly Good Title") },
    });
    await expect(h.call()).resolves.toEqual([]);
    expect(h.fetched).toEqual([]);
  });

  it("dedups on the RESOLVED url — two per-call tokens for one page yield one row", async () => {
    // Dedup cannot run earlier: the tokens are opaque and per-call (64 of 64
    // unique across queries), so every shipped dedup key would see two rows.
    const h = harness({
      chunks: [chunk("a"), chunk("b")],
      resolved: {
        [`${REDIRECT_PREFIX}a`]: "https://grc.org/molten-salts",
        [`${REDIRECT_PREFIX}b`]: "https://grc.org/molten-salts",
      },
      pages: { "https://grc.org/molten-salts": page("Molten Salts GRC") },
    });
    const rows = await h.call();
    expect(rows).toHaveLength(1);
    expect(h.fetched[0]).toEqual(["https://grc.org/molten-salts"]);
  });

  it("caps the chunks one query may commission — a documented, tested choice", async () => {
    const many = Array.from({ length: 25 }, (_, i) => chunk(`t${i}`));
    const resolved: Record<string, string | null> = {};
    const pages: Record<string, string | null> = {};
    many.forEach((c, i) => {
      resolved[c.uri!] = `https://example.org/p${i}`;
      pages[`https://example.org/p${i}`] = page(`Page ${i}`);
    });
    const h = harness({ chunks: many, resolved, pages });
    const rows = await h.call();
    expect(rows).toHaveLength(10);
    expect(h.fetched[0]).toHaveLength(10);
  });

  it("honours maxResults before paying for any page fetch", async () => {
    const many = Array.from({ length: 8 }, (_, i) => chunk(`m${i}`));
    const resolved: Record<string, string | null> = {};
    const pages: Record<string, string | null> = {};
    many.forEach((c, i) => {
      resolved[c.uri!] = `https://example.org/q${i}`;
      pages[`https://example.org/q${i}`] = page(`Q ${i}`);
    });
    const h = harness({ chunks: many, resolved, pages });
    await h.call({ maxResults: 3 });
    expect(h.fetched[0]).toHaveLength(3);
  });

  it("returns [] and fetches nothing when the query grounded nothing", async () => {
    const h = harness({ chunks: [], resolved: {}, pages: {} });
    await expect(h.call()).resolves.toEqual([]);
    expect(h.fetched).toEqual([]);
  });

  it("stops at the shared deadline rather than letting the source time out to zero", async () => {
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://example.org/a" },
      pages: { "https://example.org/a": page("A") },
    });
    await expect(h.call({ deadlineAt: Date.now() - 1 })).resolves.toEqual([]);
    expect(h.fetched).toEqual([]);
  });

  it("applies the pre-screen before fetching, on the caller's deny list", async () => {
    const h = harness({
      chunks: [chunk("keep"), chunk("deny")],
      resolved: {
        [`${REDIRECT_PREFIX}keep`]: "https://grc.org/x",
        [`${REDIRECT_PREFIX}deny`]: "https://denied.example/y",
      },
      pages: { "https://grc.org/x": page("Kept") },
    });
    await h.call({ denyHosts: ["denied.example"] });
    expect(h.fetched[0]).toEqual(["https://grc.org/x"]);
  });

  it("keeps the url's query string, which the loop's guards parse", async () => {
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://indeed.com/viewjob?jk=abc123" },
      pages: { "https://indeed.com/viewjob?jk=abc123": page("Postdoc, Battery Materials") },
    });
    const rows = await h.call();
    expect(rows[0].url).toBe("https://indeed.com/viewjob?jk=abc123");
  });

  it("gives a row with no page description the empty string, not model prose", async () => {
    const h = harness({
      chunks: [chunk("t1")],
      resolved: { [`${REDIRECT_PREFIX}t1`]: "https://example.org/a" },
      pages: { "https://example.org/a": page("A Real Page Title") },
    });
    const rows = await h.call();
    expect(rows[0].snippet).toBe("");
  });

  it("returns [] with no Vertex project, without touching the network", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    const spy = vi.spyOn(globalThis, "fetch");
    await expect(searchGemini("molten salt")).resolves.toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ── THE PRODUCTION GROUNDING PATH, THROUGH A MOCKED SDK ────────────────────

describe("the live grounding call, with the SDK stood in for", () => {
  it("sends the Search tool and NO responseMimeType — controlled generation is refused (400)", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "probe-project");
    vi.stubEnv("GOOGLE_VERTEX_LOCATION", "us-central1");
    generateContentMock.mockResolvedValueOnce(RECORDED_GROUNDING_RESPONSE);
    vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
      new Response(null, { status: 404 })) as typeof fetch);

    await searchGemini("molten salt electrochemistry conference 2026");

    expect(generateContentMock).toHaveBeenCalledTimes(1);
    const config = generateContentMock.mock.calls[0][0].config as Record<string, unknown>;
    expect(config.tools).toEqual([{ googleSearch: {} }]);
    // Vertex answers 400 INVALID_ARGUMENT — "controlled generation is not
    // supported with Search tool" — which is why `genConfig` cannot be reused.
    expect(config).not.toHaveProperty("responseMimeType");
    // Measured: capping output throttles CHUNK COUNT, not latency (none → 13
    // chunks, 256 → 3, 64 → 0). Capping here would silently discard evidence.
    expect(config).not.toHaveProperty("maxOutputTokens");
  });

  it("swallows a grounding failure and returns [] rather than breaking the source", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "probe-project");
    generateContentMock.mockRejectedValueOnce(new Error("vertex 503"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(searchGemini("molten salt")).resolves.toEqual([]);
  });

  it("carries a grounded row all the way to a mapped result", async () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "probe-project");
    generateContentMock.mockResolvedValueOnce({
      candidates: [
        {
          groundingMetadata: {
            groundingChunks: [
              { web: { uri: `${REDIRECT_PREFIX}live`, title: "pyro.byu.edu", domain: "pyro.byu.edu" } },
            ],
          },
        },
      ],
    });
    const rows = await searchGemini("molten salt", {
      resolveRedirect: async () => "https://pyro.byu.edu/moses",
      fetchPages: async () => [page("Molten Salt Electrochemistry Symposium (MoSES)", "Provo, Utah.")],
    });
    expect(rows).toEqual([
      {
        title: "Molten Salt Electrochemistry Symposium (MoSES)",
        url: "https://pyro.byu.edu/moses",
        snippet: "Provo, Utah.",
      },
    ]);
    // And the hostname the API handed back as `web.title` is not the title.
    expect(rows[0].title).not.toBe("pyro.byu.edu");
  });
});

// ── PROVIDER ORDER (RULING 75 requirement 2) ───────────────────────────────

describe("resolveWebSearchProvider — explicit → gemini → brave → tavily", () => {
  const none = {
    geminiAvailable: false,
    braveKeyPresent: false,
    tavilyKeyPresent: false,
    requestTavilyKeyPresent: false,
  };

  it("honours an explicit gemini preference", () => {
    expect(resolveWebSearchProvider("gemini", { ...none, geminiAvailable: true })).toBe("gemini");
  });

  it("returns null for an explicit gemini preference with no Vertex project", () => {
    expect(resolveWebSearchProvider("gemini", none)).toBeNull();
  });

  it("an explicit brave preference is unaffected by gemini being available", () => {
    expect(
      resolveWebSearchProvider("brave", { ...none, geminiAvailable: true, braveKeyPresent: true }),
    ).toBe("brave");
    expect(resolveWebSearchProvider("brave", { ...none, geminiAvailable: true })).toBeNull();
  });

  it("an explicit tavily preference is unaffected by gemini being available", () => {
    expect(
      resolveWebSearchProvider("tavily", { ...none, geminiAvailable: true, tavilyKeyPresent: true }),
    ).toBe("tavily");
  });

  it("auto puts the METERED providers ahead of the local-only ones", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 2-04 · Ruling 5 point 2 ·
    // R-KEY-3 as amended 2026-09-05.
    //
    // This case used to assert that grounding won over an available system
    // Tavily key. That was the WRONG ORDER half of the defect: grounding was
    // neither gated, nor charged to the 500/day breaker, nor written to the
    // usage ledger, so an uncounted provider outranked the gated, metered one.
    // Ruling 5 point 2 states the principle directly — an uncounted provider
    // never outranks the gated, metered one — so Tavily now wins here.
    expect(
      resolveWebSearchProvider(undefined, {
        ...none,
        geminiAvailable: true,
        braveKeyPresent: true,
        tavilyKeyPresent: true,
      }),
    ).toBe("tavily");
    // With nothing else configured, grounding is still reached.
    expect(resolveWebSearchProvider("auto", { ...none, geminiAvailable: true })).toBe("gemini");
  });

  it("auto follows R-KEY-3's arrow chain, group by group (2-04)", () => {
    // The whole order asserted as a SEQUENCE rather than as one pair: remove
    // the winner and the next candidate must step up. This is the case that
    // makes the order a contract instead of five independent facts.
    const all = {
      geminiAvailable: true,
      vertexAvailable: true,
      braveKeyPresent: true,
      tavilyKeyPresent: true,
      requestTavilyKeyPresent: true,
    };

    // 1. the reader's own key — costs the operator nothing
    expect(resolveWebSearchProvider("auto", all)).toBe("tavily");
    // 2. the system Tavily key — gated AND metered
    expect(
      resolveWebSearchProvider("auto", { ...all, requestTavilyKeyPresent: false }),
    ).toBe("tavily");
    // 3. Brave, then Vertex, then grounding — all local-only
    expect(
      resolveWebSearchProvider("auto", {
        ...all,
        requestTavilyKeyPresent: false,
        tavilyKeyPresent: false,
      }),
    ).toBe("brave");
    expect(
      resolveWebSearchProvider("auto", {
        ...all,
        requestTavilyKeyPresent: false,
        tavilyKeyPresent: false,
        braveKeyPresent: false,
      }),
    ).toBe("vertex");
    expect(
      resolveWebSearchProvider("auto", {
        ...all,
        requestTavilyKeyPresent: false,
        tavilyKeyPresent: false,
        braveKeyPresent: false,
        vertexAvailable: false,
      }),
    ).toBe("gemini");
    // 4. nothing — the surface serves its free structured sources
    expect(resolveWebSearchProvider("auto", none)).toBeNull();
  });

  it("returns null for an EXPLICIT preference whose availability is gated off (2-04)", () => {
    // THE most important new case in this item. For jobs and events the auto
    // branch is usually never reached: the pipeline sets an explicit `provider`
    // from the server's own environment, so this branch answers first. A fix
    // that only rewrote the ordering clauses would have left this wide open.
    for (const preferred of ["vertex", "gemini", "brave", "tavily"] as const) {
      expect(resolveWebSearchProvider(preferred, none)).toBeNull();
    }
  });

  it("auto still yields to a caller-supplied Tavily key — 'AND Tavily is disabled' is load-bearing", () => {
    expect(
      resolveWebSearchProvider("auto", {
        ...none,
        geminiAvailable: true,
        tavilyKeyPresent: true,
        requestTavilyKeyPresent: true,
      }),
    ).toBe("tavily");
  });

  it("puts the system Tavily key ahead of Brave when Vertex is absent", () => {
    // REWRITTEN, NOT DELETED — 2-04. The one assertion that moved is the
    // Brave-vs-system-Tavily pair: Brave used to win, and Brave was the
    // uncounted one. Every other line here is unchanged.
    expect(
      resolveWebSearchProvider("auto", { ...none, tavilyKeyPresent: true, requestTavilyKeyPresent: true }),
    ).toBe("tavily");
    expect(resolveWebSearchProvider("auto", { ...none, braveKeyPresent: true })).toBe("brave");
    expect(
      resolveWebSearchProvider("auto", { ...none, braveKeyPresent: true, tavilyKeyPresent: true }),
    ).toBe("tavily");
    expect(resolveWebSearchProvider("auto", { ...none, tavilyKeyPresent: true })).toBe("tavily");
    expect(resolveWebSearchProvider("auto", none)).toBeNull();
  });
});

describe("isGeminiSearchAvailable / geminiWebSearchOptions", () => {
  it("is Vertex presence and nothing else", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(isGeminiSearchAvailable()).toBe(true);
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    expect(isGeminiSearchAvailable()).toBe(false);
  });

  it("turns the surfaces on by default when Vertex is present", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(geminiWebSearchOptions(undefined)).toEqual({ provider: "gemini" });
    expect(geminiWebSearchOptions({})).toEqual({ provider: "gemini" });
    expect(geminiWebSearchOptions({ gemini: { enabled: true } })).toEqual({ provider: "gemini" });
  });

  it("respects an explicit opt-out", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(geminiWebSearchOptions({ gemini: { enabled: false } })).toBeUndefined();
  });

  it("stays off with no Vertex project, whatever the connector says", () => {
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    expect(geminiWebSearchOptions({ gemini: { enabled: true } })).toBeUndefined();
  });
});

describe("RULING 76a — the per-source budget", () => {
  it("is 25 seconds, the value the manager approved", () => {
    expect(GEMINI_SOURCE_TIMEOUT_MS).toBe(25_000);
  });

  it("leaves the adapter's own soft deadline inside the source budget", () => {
    // If the internal budget ever met or exceeded the source cap, the soft stop
    // would never fire and one slow page could take the whole census to zero.
    const started = 1_000_000;
    expect(geminiSearchDeadline(started) - started).toBeLessThan(GEMINI_SOURCE_TIMEOUT_MS);
  });

  it("defaults its deadline to now when the caller does not share one", () => {
    const before = Date.now();
    const deadline = geminiSearchDeadline();
    expect(deadline).toBeGreaterThan(before);
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 1 (A29-01) — CHANNEL L's READER. Ruling 79a.
//
// `pageSnippetFromHtml` is NOT touched by this item and its cases above must
// stay byte-unchanged: round 29 B measured every widening of the text channel
// HARMFUL (0 of 3 rescues, manufactured date evidence, non-monotone). If a
// snippet case ever moves, the text channel was widened after all.
// ---------------------------------------------------------------------------

describe("pageDeclaresEventFromHtml — channel L", () => {
  const ld = (body: string) =>
    `<html><head><script type="application/ld+json">${body}</script></head></html>`;

  it("reads a scalar @type: Event", () => {
    expect(pageDeclaresEventFromHtml(ld('{"@type":"Event","name":"X"}'))).toBe(true);
  });

  it("reads an @type array, which is how the named rescue publishes it", () => {
    // `thebatteryshow.com` declares Event, Place, Organization and Schedule.
    expect(
      pageDeclaresEventFromHtml(
        ld('{"@type":["Event","Place","Organization","Schedule"]}'),
      ),
    ).toBe(true);
  });

  it("reads a fully-qualified schema.org URL", () => {
    expect(pageDeclaresEventFromHtml(ld('{"@type":"https://schema.org/Event"}'))).toBe(true);
  });

  it("accepts the closed subtype list", () => {
    for (const type of [
      "BusinessEvent",
      "EducationEvent",
      "ExhibitionEvent",
      "Festival",
      "SocialEvent",
      "CourseInstance",
    ]) {
      expect(pageDeclaresEventFromHtml(ld(`{"@type":"${type}"}`))).toBe(true);
    }
  });

  it("REFUSES the excluded types — this half is the load-bearing one", () => {
    // `euchemsil2026.com` declares LocalBusiness and is deliberately excluded:
    // a page describing a venue is not a page describing an event.
    for (const type of [
      "WebPage",
      "Organization",
      "BreadcrumbList",
      "LocalBusiness",
      "JobPosting",
    ]) {
      expect(pageDeclaresEventFromHtml(ld(`{"@type":"${type}"}`))).toBe(false);
    }
  });

  it("does NOT match on a substring of some other vendor's type", () => {
    // Deliberately not `endsWith("event")`: the KIND gate's boundary is closed.
    expect(pageDeclaresEventFromHtml(ld('{"@type":"NonProfitEvent"}'))).toBe(false);
    expect(pageDeclaresEventFromHtml(ld('{"@type":"EventVenueListing"}'))).toBe(false);
  });

  it("ignores an Event word that is not a JSON-LD @type declaration", () => {
    expect(
      pageDeclaresEventFromHtml(
        '<html><body><p>@type Event</p><script>var x = {"@type":"Event"}</script></body></html>',
      ),
    ).toBe(false);
  });

  it("returns false on absent, empty and malformed input", () => {
    expect(pageDeclaresEventFromHtml(null)).toBe(false);
    expect(pageDeclaresEventFromHtml("")).toBe(false);
    expect(pageDeclaresEventFromHtml(ld("{ this is not json"))).toBe(false);
  });

  it("survives a JSON-LD block too broken to parse", () => {
    // Read by regex on purpose: a `JSON.parse` here would turn channel L off
    // for the whole page on any truncated block, which is common in the wild.
    expect(pageDeclaresEventFromHtml(ld('{"@type":"Event","name":"X"'))).toBe(true);
  });
});

describe("searchGemini carries the page's declaration onto the row", () => {
  const eventPage = (title: string, description: string, ld?: string) =>
    `<html><head><title>${title}</title><meta name="description" content="${description}">${
      ld ? `<script type="application/ld+json">${ld}</script>` : ""
    }</head><body>x</body></html>`;

  const run = (html: string) =>
    searchGemini("battery show", {
      ground: async () => [
        {
          uri: `${REDIRECT_PREFIX}bsna`,
          title: "thebatteryshow.com",
          domain: "thebatteryshow.com",
        },
      ],
      resolveRedirect: async () => "https://www.thebatteryshow.com/",
      fetchPages: async () => [html],
    });

  it("sets pageKind from the SAME buffer the title and snippet are read from", async () => {
    // ROUND 29 C, ITEM 1 — the contract change's wiring. No extra fetch: the
    // declaration comes off the one HTML buffer already in hand.
    const rows = await run(
      eventPage("The Battery Show North America", "Detroit.", '{"@type":["Event","Place"]}'),
    );
    expect(rows[0].pageKind).toBe("event");
  });

  it("leaves pageKind ABSENT when the page declares nothing", async () => {
    // The row must stay byte-identical to what this adapter returned before
    // the contract widened, so every non-declaring page is unaffected.
    const rows = await run(eventPage("The Battery Show North America", "Detroit."));
    expect(rows[0]).toEqual({
      title: "The Battery Show North America",
      url: "https://www.thebatteryshow.com/",
      snippet: "Detroit.",
    });
    expect("pageKind" in rows[0]).toBe(false);
  });

  it("the adapter itself still makes NO kind decision", async () => {
    // B item 7 §7.2 rejected option A (refusing in the adapter) because the
    // paper surface WANTS a repository record. A declaration the event mapper
    // would act on must not change what the adapter returns.
    const rows = await run(
      eventPage("Some Page", "x", '{"@type":"LocalBusiness"}'),
    );
    expect(rows).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 5 (A29-06) — the idempotent second decode, at ONE seam.
// `text/clean.ts` and `clean.test.ts` are NOT touched by this item; if they
// ever move for it, the repair was made in the shared function by mistake.
// ---------------------------------------------------------------------------

describe("pageTitleFromHtml — the double-escaped title", () => {
  const og = (content: string) => `<meta property="og:title" content="${content}">`;
  const tag = (content: string) => `<html><head><title>${content}</title></head></html>`;

  it("recovers a title the page escaped TWICE", () => {
    expect(pageTitleFromHtml(og("R&amp;amp;D Intern"))).toBe("R&D Intern");
  });

  it("fixes the SAME defect on the <title> branch", () => {
    // Both branches read raw HTML, so both carry the defect.
    expect(pageTitleFromHtml(tag("R&amp;amp;D Intern"))).toBe("R&D Intern");
  });

  it("is IDEMPOTENT on all four of B's adversarial shapes", () => {
    // A title whose LITERAL, intended text contains an entity is the danger of
    // decoding twice. Once the entity is a bare `&`, a second pass has nothing
    // left to match — so the extra pass costs zero on every case B could build.
    expect(pageTitleFromHtml(og("Writing &amp; in HTML: a guide"))).toBe(
      "Writing & in HTML: a guide",
    );
    expect(pageTitleFromHtml(og("Ampersand (&amp;) escaping workshop"))).toBe(
      "Ampersand (&) escaping workshop",
    );
    expect(pageTitleFromHtml(og("R&amp;D Intern"))).toBe("R&D Intern");
    expect(pageTitleFromHtml(og("AT&amp;T Labs Intern"))).toBe("AT&T Labs Intern");
  });

  it("stops at TWO passes — not unbounded", () => {
    // A triple escape leaves one layer behind ON PURPOSE. An unbounded loop
    // over attacker-shaped input is a cost with no measured benefit, and two
    // passes covers every sighting.
    expect(pageTitleFromHtml(og("R&amp;amp;amp;D Intern"))).toBe("R&amp;D Intern");
  });

  it("an absent title still DROPS — no invention, no new admission", () => {
    expect(pageTitleFromHtml("<html><head></head></html>")).toBeUndefined();
    expect(pageTitleFromHtml(og(""))).toBeUndefined();
    expect(pageTitleFromHtml(null)).toBeUndefined();
  });
});
