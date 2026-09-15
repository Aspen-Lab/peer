import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  extractPdfCandidatesFromPath: vi.fn(),
}));

vi.mock("./pdf-extract", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdf-extract")>();
  return { ...actual, extractPdfCandidatesFromPath: mocks.extractPdfCandidatesFromPath };
});

import {
  __resetSemanticScholarLimiterForTests,
  getFigurePool,
  tryHtmlCandidates,
  trySemanticScholarCandidates,
} from "./extract";

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

describe("trySemanticScholarCandidates — 1-20, concurrency cap + minimum interval", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
    __resetSemanticScholarLimiterForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("never runs more than 2 Semantic Scholar requests at once", async () => {
    let active = 0;
    let maxActive = 0;
    const pending: Array<() => void> = [];
    globalThis.fetch = vi.fn(async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise<void>((resolve) => pending.push(resolve));
      active -= 1;
      return new Response(JSON.stringify({ figures: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const calls = [1, 2, 3, 4].map((n) => trySemanticScholarCandidates(`DOI:${n}`));

    // Let call 1 through admission immediately; call 2 is gated behind the
    // ~350ms minimum interval, not the concurrency cap, so it needs time to
    // pass before it starts too.
    await vi.advanceTimersByTimeAsync(0);
    expect(pending.length).toBe(1);
    await vi.advanceTimersByTimeAsync(400);
    expect(pending.length).toBe(2);
    expect(maxActive).toBe(2);

    // Calls 3 and 4 must wait for a slot to free, no matter how much time
    // passes, since both existing calls are still in flight (fetch has not
    // resolved for either).
    await vi.advanceTimersByTimeAsync(10_000);
    expect(pending.length).toBe(2);
    expect(maxActive).toBe(2);

    // Free one slot; a queued call should take it (after its own interval
    // wait), never pushing concurrent-in-flight above 2.
    pending.shift()!();
    await vi.advanceTimersByTimeAsync(400);
    expect(maxActive).toBeLessThanOrEqual(2);

    pending.shift()!();
    await vi.advanceTimersByTimeAsync(400);
    pending.forEach((resolve) => resolve());
    await vi.advanceTimersByTimeAsync(400);
    await Promise.all(calls);
    expect(maxActive).toBeLessThanOrEqual(2);
  });

  it("spaces consecutive request starts by at least ~350ms", async () => {
    const starts: number[] = [];
    globalThis.fetch = vi.fn(async () => {
      starts.push(Date.now());
      return new Response(JSON.stringify({ figures: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;

    const p1 = trySemanticScholarCandidates("DOI:1");
    await vi.advanceTimersByTimeAsync(0);
    const p2 = trySemanticScholarCandidates("DOI:2");
    await vi.advanceTimersByTimeAsync(0);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(349);
    expect(starts.length).toBe(1);

    await vi.advanceTimersByTimeAsync(2);
    expect(starts.length).toBe(2);
    expect(starts[1] - starts[0]).toBeGreaterThanOrEqual(350);

    await Promise.all([p1, p2]);
  });

  it("reports a 429 as rate_limited, not source_unavailable", async () => {
    globalThis.fetch = vi.fn(
      async () => new Response("", { status: 429 }),
    ) as unknown as typeof fetch;

    const promise = trySemanticScholarCandidates("DOI:1");
    await vi.advanceTimersByTimeAsync(0);
    const result = await promise;

    expect(result.status).toBe("rate_limited");
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
