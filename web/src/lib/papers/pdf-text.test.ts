import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryExtractPdfText } from "./pdf-text";

// The smallest thing `downloadPdf` accepts as a PDF: the magic bytes.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\n<< >>\nendobj\n");

describe("tryExtractPdfText", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } })),
    );
  });

  afterEach(() => vi.unstubAllGlobals());

  it("says a PDF with nothing to read is unreadable, not missing", async () => {
    // This used to be the `no-python` case — the reading ran in a helper that
    // needed an interpreter, so a deployed Peer could never read any PDF. It
    // reads PDFs in-process now; what is left is the file that carries no
    // text, and the reading page names that rather than claiming no full text.
    const result = await tryExtractPdfText("https://example.org/paper.pdf");

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/no-text-layer|no-sections|InvalidPDF|Invalid/i);
  });

  it("refuses a landing page dressed as a PDF link", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html><body>Sign in</body></html>", { status: 200 })),
    );

    const result = await tryExtractPdfText("https://example.org/paywall");

    expect(result).toEqual({
      ok: false,
      reason: "Response was not a PDF (likely a landing/paywall page).",
    });
  });
});
