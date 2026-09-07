import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryExtractPdfText } from "./pdf-text";

// The smallest thing `downloadPdf` accepts as a PDF: the magic bytes.
const PDF_BYTES = new TextEncoder().encode("%PDF-1.4\n%âã\n1 0 obj\n<< >>\nendobj\n");

describe("tryExtractPdfText", () => {
  const savedPath = process.env.PATH;
  const savedPython = process.env.PYTHON_BIN;

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(PDF_BYTES, { status: 200, headers: { "content-type": "application/pdf" } })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    process.env.PATH = savedPath;
    if (savedPython === undefined) delete process.env.PYTHON_BIN;
    else process.env.PYTHON_BIN = savedPython;
  });

  it("reports no-python when no interpreter can be spawned", async () => {
    // No PATH and a PYTHON_BIN that does not exist: every runner ENOENTs,
    // which is what a Vercel function sees.
    process.env.PATH = "";
    process.env.PYTHON_BIN = "/nonexistent/python3";

    const result = await tryExtractPdfText("https://example.org/paper.pdf");

    expect(result).toEqual({ ok: false, reason: "no-python" });
  });
});
