import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractPdfCandidatesFromPath: vi.fn(),
}));

vi.mock("./pdf-extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdf-extract")>();
  return { ...actual, extractPdfCandidatesFromPath: mocks.extractPdfCandidatesFromPath };
});

import { extractFigure, finalDiagnostic, getFigurePool, tryHtmlCandidates } from "./extract";

describe("tryHtmlCandidates — 1-22, a hard 401/402/403/451 is reported as paywalled", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports a hard-403 response as paywalled, not source_unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(
      "https://onlinelibrary.wiley.com/doi/10.1002/test.1",
      "publisher",
    );

    expect(result.status).toBe("paywalled");
    expect(result.reason).toContain("onlinelibrary.wiley.com");
  });

  it("still reports a plain fetch failure (not a paywall status) as source_unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    const result = await tryHtmlCandidates("https://example.com/missing", "publisher");

    expect(result.status).toBe("source_unavailable");
  });

  it("never calls an open-access host's own 40x a paywall", async () => {
    // 2-01: classifyHardAccessStatus (shared with papers/full-text.ts and
    // figures/pdf-extract.ts) screens hosts this codebase already trusts as
    // aggregator/free (e.g. arXiv/PMC-shaped hosts) — a status-based paywall
    // guess must not override that; the verdict is "blocked", which still
    // surfaces as source_unavailable here, matching the existing
    // body-phrase check's own guard.
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
      "publisher",
    );

    expect(result.status).toBe("source_unavailable");
  });

  it("2-01: reports an OpenAlex 403 as blocked (source_unavailable), never paywalled", async () => {
    // Ruling 9 (§1j) / A2-05: openalex.org is an aggregator host this
    // codebase itself calls, not a publisher — a 403 there is an anti-bot
    // block, and must not read as a subscription paywall.
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryHtmlCandidates("https://openalex.org/W7212207112", "publisher");

    expect(result.status).toBe("source_unavailable");
    expect(result.reason).toContain("openalex.org");
  });
});

describe("tryHtmlCandidates — 1-19, the graphical-abstract/og:image honesty guard", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const articleUrl = "https://onlinelibrary.wiley.com/doi/10.1002/adfm.78026";

  it("adds the og:image as a low-priority candidate when its URL carries the article's own path segment", async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn.wiley.com/abstracts/adfm.78026-ga.jpg">
    </head><body></body></html>`;
    globalThis.fetch = vi.fn(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(articleUrl, "publisher");

    expect(result.status).toBe("candidates");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0]).toMatchObject({
      source: "og",
      qualityHint: "low",
      imageUrl: "https://cdn.wiley.com/abstracts/adfm.78026-ga.jpg",
    });
  });

  it("rejects a journal cover image even when the page has no other figures", async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn.wiley.com/covers/adfm.78026-cover.jpg">
    </head><body></body></html>`;
    globalThis.fetch = vi.fn(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(articleUrl, "publisher");

    expect(result.status).toBe("no_figures");
  });

  it("rejects an og:image with no article-specific path segment (unsure -> no figure)", async () => {
    const html = `<!doctype html><html><head>
      <meta property="og:image" content="https://cdn.wiley.com/social/default-share.jpg">
    </head><body></body></html>`;
    globalThis.fetch = vi.fn(
      async () => new Response(html, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(articleUrl, "publisher");

    expect(result.status).toBe("no_figures");
  });
});

describe("getFigurePool — Ruling 20 (S23): the pool has no Semantic Scholar branch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("never contacts api.semanticscholar.org, even for a DOI paper that used to be looked up there first", async () => {
    // Before Ruling 20, a DOI was the STRONGEST id `buildCandidatePool` used
    // to key a Semantic Scholar lookup by (ahead of arXiv/OpenAlex) — a
    // plain DOI paper with no upload and no arXiv id is exactly the shape
    // that used to trigger it. The Graph API has no `figures` field (Ruling
    // 20), so that whole branch is gone; every fetch below (the DOI landing
    // page, Unpaywall, Europe PMC) is mocked to fail fast, and the only
    // thing this test cares about is which URLs were ever asked for.
    const calledUrls: string[] = [];
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
      calledUrls.push(String(input));
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    const pool = await getFigurePool({ itemId: "openalex:W1", doi: "10.1000/test-doi" });

    expect(pool.attempted).toBe(true);
    expect(calledUrls.some((url) => url.includes("semanticscholar"))).toBe(false);
  });

  it("resolves without waiting on any grace period — there is no background lookup left to wait for or race", async () => {
    // The old code raced a 3s SEMANTIC_SCHOLAR_ENRICH_GRACE_MS timer against
    // the Semantic Scholar lookup whenever the paper's own sources already
    // had a candidate. With no such lookup started at all, nothing should
    // make this call outlive its own (mocked, instant) fetches — asserted
    // by giving the test itself a budget well under the old grace period,
    // with real timers (not `vi.useFakeTimers()` — there is no timer left
    // to advance).
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    const start = Date.now();
    await getFigurePool({ itemId: "openalex:W2", doi: "10.1000/test-doi-2" });
    expect(Date.now() - start).toBeLessThan(1_000);
  });
});

describe("finalDiagnostic — Ruling 20 (S23): no Semantic Scholar/rate_limited handling left", () => {
  it("has no rate_limited branch — an attempts array with only recognised statuses is unaffected", () => {
    // finalDiagnostic's `AttemptResult["status"]` union no longer includes
    // "rate_limited" at all (nothing produces it any more), so there is no
    // longer a throttle note to fold into another branch's reason, and no
    // separate rate_limited status to report. This is the same
    // source_unavailable-wins-over-nothing-else precedence 4-01 originally
    // tested, just without a throttled attempt in the mix.
    const result = finalDiagnostic([
      {
        status: "source_unavailable",
        candidates: [],
        reason: "Peer reached an access-check page at link.springer.com, not the article itself.",
      },
    ]);

    expect(result.status).toBe("source_unavailable");
    expect(result.reason).toBe(
      "Peer reached an access-check page at link.springer.com, not the article itself.",
    );
  });

  it("falls through to the generic source_unavailable fallback when every attempt is candidates-empty with no reason", () => {
    const result = finalDiagnostic([{ status: "candidates", candidates: [] }]);

    expect(result.status).toBe("source_unavailable");
    expect(result.reason).toBe(
      "Peer could not reach a usable full-text source for this paper's figures.",
    );
  });
});

describe("tryHtmlCandidates — 1-21, a small identity-check bounce page is not the article", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // A trimmed-down stand-in for Nature's own idp.nature.com/transit stub —
  // small, mentions cookies, does not carry a <figure> or an og:image.
  const bounceHtml =
    "<!doctype html><html><body><p>Checking your browser for a valid cookie session before continuing.</p></body></html>";
  const bounceResponse = () => {
    const res = new Response(bounceHtml, { status: 200, headers: { "content-type": "text/html" } });
    Object.defineProperty(res, "url", {
      value: "https://idp.example.com/transit?redirect_uri=https%3A%2F%2Fpublisher.example.com%2Farticle%2F1",
      configurable: true,
    });
    return res;
  };

  it("reports source_unavailable (not no_figures) when the retry bounces again too", async () => {
    globalThis.fetch = vi.fn(async () => bounceResponse()) as unknown as typeof fetch;

    const result = await tryHtmlCandidates("https://publisher.example.com/article/1", "publisher");

    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // original + one retry
    expect(result.status).toBe("source_unavailable");
    expect(result.reason).toContain("access-check page");
    expect(result.reason).toContain("idp.example.com");
  });

  it("uses the retry's content once the bounce clears", async () => {
    const realArticleHtml =
      '<!doctype html><html><body><figure><img src="/fig1.png"><figcaption>Figure 1. Panel A shows the result.</figcaption></figure></body></html>';
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call += 1;
      if (call === 1) return bounceResponse();
      const res = new Response(realArticleHtml, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", { value: "https://publisher.example.com/article/1", configurable: true });
      return res;
    }) as unknown as typeof fetch;

    const result = await tryHtmlCandidates("https://publisher.example.com/article/1", "publisher");

    expect(result.status).toBe("candidates");
    expect(result.candidates[0]?.imageUrl).toContain("fig1.png");
  });

  it("2-04: recognises a Springer-style 'Client Challenge' bot-mitigation stub with no cookie wording at all", async () => {
    // A trimmed-down stand-in for the real link.springer.com stub found
    // live: a bare CSP/JS challenge page, no <figure>, no og:image, and —
    // unlike Nature's idp.nature.com/transit page — never mentions
    // "cookie" anywhere, so the 1-21 detector alone missed it.
    const challengeHtml =
      "<!doctype html><html><head><title>Client Challenge</title></head>" +
      "<body><script>/* bot-mitigation challenge, no article content */</script></body></html>";
    const challengeResponse = () => {
      const res = new Response(challengeHtml, { status: 200, headers: { "content-type": "text/html" } });
      Object.defineProperty(res, "url", {
        value: "https://link.springer.com/10.1007/s40998-026-01240-x",
        configurable: true,
      });
      return res;
    };
    globalThis.fetch = vi.fn(async () => challengeResponse()) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(
      "https://doi.org/10.1007/s40998-026-01240-x",
      "publisher",
    );

    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // original + one retry
    expect(result.status).toBe("source_unavailable");
    expect(result.reason).toContain("access-check page");
    expect(result.reason).toContain("link.springer.com");
  });

  it("does not mistake a real, cookie-notice-carrying article page for a bounce stub", async () => {
    const realArticleHtml =
      "<!doctype html><html><body>" +
      '<figure><img src="/fig1.png"><figcaption>Figure 1. The real result.</figcaption></figure>' +
      "<footer>This site uses cookies. ".padEnd(9_000, "x") +
      "</footer></body></html>";
    globalThis.fetch = vi.fn(
      async () => new Response(realArticleHtml, { status: 200, headers: { "content-type": "text/html" } }),
    ) as unknown as typeof fetch;

    const result = await tryHtmlCandidates("https://publisher.example.com/article/2", "publisher");

    expect(globalThis.fetch).toHaveBeenCalledTimes(1); // no retry triggered
    expect(result.status).toBe("candidates");
  });
});

describe("getFigurePool — 1-29, an upload: id reads the local PDF directly", () => {
  beforeEach(() => {
    mocks.extractPdfCandidatesFromPath.mockReset();
  });

  it("reads the stored PDF and never touches Semantic Scholar or collectSourceLinks", async () => {
    mocks.extractPdfCandidatesFromPath.mockResolvedValue({
      status: "candidates",
      candidates: [
        { imageUrl: "data:image/png;base64,AAAA", caption: "Figure 1", source: "publisher", ordinal: 0, qualityHint: "high" },
      ],
    });

    const pool = await getFigurePool({ itemId: "upload:0000000000000010" });

    expect(pool.entries).toHaveLength(1);
    expect(pool.entries[0].imageUrl).toBe("data:image/png;base64,AAAA");
    expect(mocks.extractPdfCandidatesFromPath).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfCandidatesFromPath.mock.calls[0][0]).toContain("0000000000000010");
  });

  it("returns an honest empty pool (attempted, no candidates) when the PDF has no figures", async () => {
    mocks.extractPdfCandidatesFromPath.mockResolvedValue({
      status: "no_figures",
      candidates: [],
      reason: "Peer opened a legal PDF for this paper, but did not extract any usable figures from it.",
    });

    const pool = await getFigurePool({ itemId: "upload:0000000000000011" });

    expect(pool.entries).toHaveLength(0);
    expect(pool.attempted).toBe(true);
  });
});

describe("extractFigure — 5-06, the query-less og:image last resort is cached on the pool", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.extractPdfCandidatesFromPath.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("fetches input.url at most once across repeat no-query calls against the same empty pool", async () => {
    mocks.extractPdfCandidatesFromPath.mockResolvedValue({
      status: "no_figures",
      candidates: [],
      reason: "Peer opened a legal PDF for this paper, but did not extract any usable figures from it.",
    });
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    const input = { itemId: "upload:00000000000000f6", url: "https://example.com/paper-5-06" };

    const first = await extractFigure(input);
    const second = await extractFigure(input);

    expect(first.status).toBe("no_figures");
    expect(second.status).toBe("no_figures");
    // Once for the og:image last resort, cached on the pool for the second
    // call — not twice, which is what A5-04 measured as the cached-call miss.
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});
