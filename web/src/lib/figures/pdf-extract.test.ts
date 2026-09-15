import { afterEach, describe, expect, it, vi } from "vitest";
import { tryPdfCandidates } from "./pdf-extract";

describe("tryPdfCandidates — 1-22b, a hard 401/402/403/451 is reported as paywalled", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports a hard-403 response as paywalled, not source_unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryPdfCandidates(
      "https://onlinelibrary.wiley.com/doi/pdf/10.1002/test.1",
      "publisher",
    );

    expect(result.status).toBe("paywalled");
    expect(result.reason).toContain("onlinelibrary.wiley.com");
  });

  it("still reports a plain fetch failure (not a paywall status) as source_unavailable", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    const result = await tryPdfCandidates("https://example.com/missing.pdf", "publisher");

    expect(result.status).toBe("source_unavailable");
  });

  it("never calls an open-access host's own 40x a paywall", async () => {
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await tryPdfCandidates(
      "https://arxiv.org/pdf/1234.5678",
      "open-access",
    );

    expect(result.status).toBe("source_unavailable");
  });
});
