import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetSemanticScholarLimiterForTests,
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
    // hostLooksOpenAccess screens hosts this codebase already trusts as open
    // (e.g. arXiv/PMC-shaped hosts) — a status-based paywall guess must not
    // override that, matching the existing body-phrase check's own guard.
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryHtmlCandidates(
      "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
      "publisher",
    );

    expect(result.status).toBe("source_unavailable");
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
