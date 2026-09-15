import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "./html-text";
import type { PdfTextResult } from "./pdf-text";
import type { SourceLink } from "./source-links";

const mocks = vi.hoisted(() => ({
  collectSourceLinks: vi.fn(),
  extractPdfTextFromPath: vi.fn(),
}));

vi.mock("./source-links", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./source-links")>();
  return { ...actual, collectSourceLinks: mocks.collectSourceLinks };
});

vi.mock("./pdf-text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdf-text")>();
  return { ...actual, extractPdfTextFromPath: mocks.extractPdfTextFromPath };
});

// Mocked after source-links so `pdf-text.ts`'s own network call (a real
// `fetch`, used by the PDF path) is what we control below.
import { getFullText } from "./full-text";

const htmlLink = (url: string): SourceLink => ({ url, kind: "html", label: "publisher-html", rank: 10 });
const pdfLink = (url: string): SourceLink => ({ url, kind: "pdf", label: "doi", rank: 20 });

describe("getFullText — 1-16, a hard 401/402/403/451 is reported as paywalled", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    mocks.collectSourceLinks.mockReset();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("reports a hard-403 HTML response as paywalled, not source_unavailable", async () => {
    mocks.collectSourceLinks.mockResolvedValue([
      htmlLink("https://onlinelibrary.wiley.com/doi/10.1002/test.1"),
    ]);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await getFullText({ paperId: "test:html-403", doi: "10.1002/test.1" });

    expect(result.status).toBe("paywalled");
    expect(result.reason).toContain("onlinelibrary.wiley.com");
    expect(result.reason).toContain("paid or institutional access");
  });

  it("still reports a plain fetch failure (not a paywall status) as no_full_text, never paywalled", async () => {
    // buildResult only ever surfaces "paywalled" or "no_full_text" at the top
    // level (a per-link "source_unavailable" outcome is recorded in
    // `attempts`, not returned as the overall status) — a 404 is neither a
    // paywall signal nor a source Peer read, so it must not become "paywalled".
    mocks.collectSourceLinks.mockResolvedValue([
      htmlLink("https://example.com/not-found"),
    ]);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;

    const result = await getFullText({ paperId: "test:html-404" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toContain("source_unavailable");
  });

  it("reports a hard-403 PDF fetch as paywalled too (the PDF path shares the same bug)", async () => {
    mocks.collectSourceLinks.mockResolvedValue([
      pdfLink("https://pubs.acs.org/doi/pdf/10.1021/test.1"),
    ]);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await getFullText({ paperId: "test:pdf-403", doi: "10.1021/test.1" });

    expect(result.status).toBe("paywalled");
    expect(result.reason).toContain("pubs.acs.org");
  });

  it("2-01: an openalex.org 403 is blocked, not paywalled (Ruling 9, §1j)", async () => {
    // A2-05's OSF finding: openalex.org is an aggregator host this codebase
    // itself calls, not a publisher — a 403 there is an anti-bot block, and
    // must fall back to the abstract as "blocked", never claim a paywall.
    mocks.collectSourceLinks.mockResolvedValue([
      htmlLink("https://openalex.org/W7212207112"),
    ]);
    globalThis.fetch = vi.fn(async () => new Response("", { status: 403 })) as unknown as typeof fetch;

    const result = await getFullText({ paperId: "openalex:W7212207112" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toContain("source_unavailable");
  });
});

describe("getFullText — 1-28, an upload: id reads the local file, never collectSourceLinks", () => {
  const emptyDoc: ExtractedDocument = {
    title: "An Uploaded Paper",
    sections: [{ heading: "Body", canonical: "body", text: "Real body text." }],
    figureCaptions: [],
    source: "pdf",
    pageCount: 5,
    reason: null,
  };

  beforeEach(() => {
    mocks.collectSourceLinks.mockReset();
    mocks.extractPdfTextFromPath.mockReset();
  });

  it("reads the local PDF directly and never calls collectSourceLinks", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc: emptyDoc } satisfies PdfTextResult);

    const result = await getFullText({ paperId: "upload:0000000000000001" });

    expect(result.status).toBe("ok");
    expect(result.doc).toEqual(emptyDoc);
    expect(result.sourceLink).toEqual({
      url: "/api/papers/upload/0000000000000001/file",
      kind: "pdf",
      label: "upload",
      rank: 0,
    });
    expect(mocks.collectSourceLinks).not.toHaveBeenCalled();
  });

  it("marks a genuinely empty PDF distinctly (pdf-empty), not as a generic failure", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: false,
      reason: "PDF text extractor produced no sections.",
    } satisfies PdfTextResult);

    const result = await getFullText({ paperId: "upload:0000000000000002" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toContain("pdf-empty");
  });

  it("2-05 (A2-02): a real empty/scanned PDF — which extracts as ok:true with zero sections, not ok:false — is still marked pdf-empty", async () => {
    // The shape above (`ok: false, reason: "...produced no sections"`)
    // guards a real but different Python-side failure (a totally unreadable
    // file). A truly blank PDF instead reads *successfully*: the Python
    // extractor still returns one real (empty-text) "Body" section, which
    // pdf-text.ts's normalize() then filters out — producing exactly this
    // shape, confirmed by executing extractPdfTextFromPath against a real
    // blank PDF built with PyMuPDF.
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: {
        title: null,
        sections: [],
        figureCaptions: [],
        source: "pdf",
        pageCount: 1,
        reason: null,
      },
    } satisfies PdfTextResult);

    const result = await getFullText({ paperId: "upload:0000000000000004" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toContain("pdf-empty");
  });

  it("marks a no-python/no-extractor failure the same way a normal PDF link would", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: false, reason: "no-python" } satisfies PdfTextResult);

    const result = await getFullText({ paperId: "upload:0000000000000003" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toContain("no-python");
  });
});
