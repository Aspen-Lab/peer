import { afterEach, describe, expect, it, vi } from "vitest";
import { tryHtmlCandidates } from "./extract";

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
