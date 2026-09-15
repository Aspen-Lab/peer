import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { PdfTextResult } from "@/lib/papers/pdf-text";

const mocks = vi.hoisted(() => ({
  extractPdfTextFromPath: vi.fn(),
  writeUploadPdfIfAbsent: vi.fn(async () => undefined),
  writeUploadMeta: vi.fn(async () => undefined),
}));

vi.mock("@/lib/papers/pdf-text", () => ({
  extractPdfTextFromPath: mocks.extractPdfTextFromPath,
}));

vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
    writeUploadPdfIfAbsent: mocks.writeUploadPdfIfAbsent,
    writeUploadMeta: mocks.writeUploadMeta,
  };
});

import { POST } from "./route";

function pdfBytes(size = 32): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write("%PDF-1.4\n", 0, "ascii");
  return bytes;
}

function pdfFile(bytes: Buffer, name = "paper.pdf"): File {
  return new File([bytes as unknown as BlobPart], name, { type: "application/pdf" });
}

function postWith(file: unknown): Promise<Response> {
  const form = new FormData();
  if (file !== undefined) form.set("file", file as Blob);
  const req = new Request("http://localhost/api/papers/upload", {
    method: "POST",
    body: form,
  });
  return POST(req);
}

const emptyDoc: ExtractedDocument = {
  title: null,
  sections: [],
  figureCaptions: [],
  source: "pdf",
  pageCount: 1,
  reason: null,
};

describe("POST /api/papers/upload", () => {
  beforeEach(() => {
    mocks.extractPdfTextFromPath.mockReset();
    mocks.writeUploadPdfIfAbsent.mockClear();
    mocks.writeUploadMeta.mockClear();
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc: emptyDoc } satisfies PdfTextResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects a request with no file", async () => {
    const res = await postWith(undefined);
    expect(res.status).toBe(400);
  });

  it("rejects a request where 'file' is not a File", async () => {
    const form = new FormData();
    form.set("file", "not-a-file");
    const req = new Request("http://localhost/api/papers/upload", { method: "POST", body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("rejects a file over 25 MB before reading its bytes", async () => {
    const res = await postWith(pdfFile(pdfBytes(25 * 1024 * 1024 + 1)));
    expect(res.status).toBe(400);
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
  });

  it("rejects a file whose magic bytes are not %PDF- (never trusts the extension or MIME type)", async () => {
    const notAPdf = Buffer.from("this is just text, renamed .pdf");
    const res = await postWith(pdfFile(notAPdf));
    expect(res.status).toBe(415);
    expect(mocks.writeUploadPdfIfAbsent).not.toHaveBeenCalled();
  });

  it("accepts a real PDF, hashes it, and returns an upload: id with a mapped Paper", async () => {
    const bytes = pdfBytes();
    const expectedHash16 = createHash("sha256").update(bytes).digest("hex").slice(0, 16);

    const res = await postWith(pdfFile(bytes));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.id).toBe(`upload:${expectedHash16}`);
    expect(body.paper.id).toBe(`upload:${expectedHash16}`);
    expect(body.paper.authors).toEqual([]);
    expect(body.paper.venue).toBe("");
    expect(mocks.writeUploadPdfIfAbsent).toHaveBeenCalledWith(expectedHash16, expect.any(Buffer));
  });

  it("falls back to the file name (without extension) when the extractor found no title", async () => {
    const res = await postWith(pdfFile(pdfBytes(), "My Battery Paper.pdf"));
    const body = await res.json();
    expect(body.paper.title).toBe("My Battery Paper");
  });

  it("uses the extractor's own title when it found one, not the file name", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, title: "The Real Paper Title" },
    } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes(), "untitled-download.pdf"));
    const body = await res.json();
    expect(body.paper.title).toBe("The Real Paper Title");
  });

  it("finds a DOI mentioned in the extracted body text, stripping trailing punctuation", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: {
        ...emptyDoc,
        sections: [
          { heading: "Abstract", canonical: "abstract", text: "See https://doi.org/10.1000/abcd.123, for details." },
        ],
      },
    } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes()));
    const body = await res.json();
    expect(body.paper.doi).toBe("10.1000/abcd.123");
  });

  it("leaves the DOI absent (never invented) when no DOI-shaped string is in the extracted text", async () => {
    const res = await postWith(pdfFile(pdfBytes()));
    const body = await res.json();
    expect(body.paper.doi).toBeUndefined();
  });

  it("still succeeds when the extractor fails entirely (e.g. no Python on this machine)", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: false, reason: "no-python" } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes(), "scanned.pdf"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paper.title).toBe("scanned");
    expect(body.paper.doi).toBeUndefined();
    expect(mocks.writeUploadMeta).toHaveBeenCalled();
  });

  it("carries the abstract section through as summaryIntro, capped to 400 chars", async () => {
    const longAbstract = "x".repeat(500);
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, sections: [{ heading: "Abstract", canonical: "abstract", text: longAbstract }] },
    } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes()));
    const body = await res.json();
    expect(body.paper.summaryIntro).toHaveLength(400);
  });
});
