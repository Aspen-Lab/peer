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
