import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { PdfTextResult } from "@/lib/papers/pdf-text";

const mocks = vi.hoisted(() => ({
  uploadOwner: vi.fn<() => Promise<string | null>>(async () => "test-owner"),
  attachUpload: vi.fn(async () => undefined),
  extractPdfTextFromPath: vi.fn(),
  writeUploadPdfIfAbsent: vi.fn(async () => undefined),
  writeUploadMeta: vi.fn(async () => undefined),
  resolveProvider: vi.fn(),
}));

vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(),
  uploadOwner: mocks.uploadOwner,
  hostedUploadsEnabled: () => true,
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
    readUploadMeta: vi.fn(async () => null),
    purgeExpiredUploads: vi.fn(async () => undefined),
    attachUpload: mocks.attachUpload,
  };
});

vi.mock("@/lib/llm/providers/registry", () => ({
  resolveProvider: mocks.resolveProvider,
}));

import { POST } from "./route";

function pdfBytes(size = 32): Buffer {
  const bytes = Buffer.alloc(size, 0x20);
  bytes.write("%PDF-1.4\n", 0, "ascii");
  return bytes;
}

function pdfFile(bytes: Buffer, name = "paper.pdf"): File {
  return new File([bytes as unknown as BlobPart], name, { type: "application/pdf" });
}

// 9-11: a real browser always sends this on a same-origin fetch/form submit;
// every test below stands in for that unless it is specifically testing the
// CSRF gate itself (which sends no headers at all).
const SAME_ORIGIN_HEADERS = { "sec-fetch-site": "same-origin" };

function postWith(file: unknown): Promise<Response> {
  const form = new FormData();
  form.set("rightsVersion", "2026-09-19");
  if (file !== undefined) form.set("file", file as Blob);
  const req = new Request("http://localhost/api/papers/upload", {
    method: "POST",
    headers: SAME_ORIGIN_HEADERS,
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
    mocks.uploadOwner.mockResolvedValue("test-owner");
    mocks.attachUpload.mockClear();
    mocks.extractPdfTextFromPath.mockReset();
    mocks.writeUploadPdfIfAbsent.mockClear();
    mocks.writeUploadMeta.mockClear();
    mocks.resolveProvider.mockReset();
    mocks.resolveProvider.mockReturnValue(null); // no local dev provider unless a test opts in
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc: emptyDoc } satisfies PdfTextResult);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses uploads without an owner before storing or extracting anything", async () => {
    mocks.uploadOwner.mockResolvedValue(null);
    const res = await postWith(pdfFile(pdfBytes()));
    expect(res.status).toBe(401);
    expect(mocks.writeUploadPdfIfAbsent).not.toHaveBeenCalled();
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
  });

  it("requires explicit current-version rights confirmation", async () => {
    const form = new FormData(); form.set("file", pdfFile(pdfBytes()));
    const res = await POST(new Request("http://localhost/api/papers/upload", { method: "POST", headers: SAME_ORIGIN_HEADERS, body: form }));
    expect(res.status).toBe(400);
    expect(mocks.writeUploadPdfIfAbsent).not.toHaveBeenCalled();
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
  });

  it("attaches a matching full text to the original article and returns learning signals", async () => {
    const title = "Solid electrolytes for lithium metal batteries";
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc: { ...emptyDoc, title,
      sections: [{ heading: "Abstract", canonical: "abstract", text: "Solid electrolytes improve lithium metal batteries. Solid electrolytes conduct lithium ions." }] } });
    const form = new FormData(); form.set("file", pdfFile(pdfBytes()));
    form.set("rightsVersion", "2026-09-19");
    form.set("targetPaper", JSON.stringify({ id: "openalex:W123", title }));
    const res = await POST(new Request("http://localhost/api/papers/upload", { method: "POST", headers: SAME_ORIGIN_HEADERS, body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.paper.preferenceSignals.length).toBeGreaterThan(0);
    expect(body.paper.uploadDocumentKey).toMatch(/^[a-f0-9]{64}$/);
    expect(mocks.attachUpload).toHaveBeenCalledWith("test-owner", "openalex:W123", body.id.slice(7));
    expect(mocks.writeUploadMeta).toHaveBeenCalledWith(body.id.slice(7), expect.objectContaining({ ownerKey: "test-owner", rightsVersion: "2026-09-19", paperIds: ["openalex:W123"] }));
  });

  it("does not persist or attach a wrong article", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc: { ...emptyDoc, title: "An unrelated marine biology paper", sections: [{ heading: "Body", canonical: "body", text: "Fish." }] } });
    const form = new FormData(); form.set("file", pdfFile(pdfBytes()));
    form.set("rightsVersion", "2026-09-19");
    form.set("targetPaper", JSON.stringify({ id: "openalex:W123", title: "Solid electrolytes for lithium batteries" }));
    const res = await POST(new Request("http://localhost/api/papers/upload", { method: "POST", headers: SAME_ORIGIN_HEADERS, body: form }));
    expect(res.status).toBe(422);
    expect(mocks.writeUploadPdfIfAbsent).not.toHaveBeenCalled();
    expect(mocks.writeUploadMeta).not.toHaveBeenCalled();
    expect(mocks.attachUpload).not.toHaveBeenCalled();
  });

  it("rejects a request with no file", async () => {
    const res = await postWith(undefined);
    expect(res.status).toBe(400);
  });

  it("rejects a request where 'file' is not a File", async () => {
    const form = new FormData();
    form.set("file", "not-a-file");
    const req = new Request("http://localhost/api/papers/upload", { method: "POST", headers: SAME_ORIGIN_HEADERS, body: form });
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it("9-11: refuses a POST with neither Origin nor Sec-Fetch-Site before storing or extracting anything", async () => {
    // The live-confirmed CSRF gap (A9-01): a bare request with no browser
    // fetch-metadata headers at all must be refused, not default-trusted.
    const form = new FormData(); form.set("rightsVersion", "2026-09-19"); form.set("file", pdfFile(pdfBytes()));
    const res = await POST(new Request("http://localhost/api/papers/upload", { method: "POST", body: form }));
    expect(res.status).toBe(403);
    expect(mocks.writeUploadPdfIfAbsent).not.toHaveBeenCalled();
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
  });

  it("rejects a file over 25 MB before reading its bytes", async () => {
    // 5-02: an over-cap file now gets the honest 413 (not 400) — this
    // request has no computed Content-Length (see the postWith helper), so
    // it exercises the post-parse fallback gate specifically.
    const res = await postWith(pdfFile(pdfBytes(25 * 1024 * 1024 + 1)));
    expect(res.status).toBe(413);
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
  });

  it("5-02: rejects an over-cap body via Content-Length before any parsing at all", async () => {
    const oversizeLength = 25 * 1024 * 1024 + 1;
    const req = new Request("http://localhost/api/papers/upload", {
      method: "POST",
      headers: { "content-length": String(oversizeLength), ...SAME_ORIGIN_HEADERS },
      body: "irrelevant — never read",
    });
    const res = await POST(req);
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("That PDF is larger than 25 MB.");
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
    const expectedHash16 = createHash("sha256").update("test-owner").update(bytes).digest("hex").slice(0, 16);

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
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
  });

  it("2-06: never asks the model when step (a)'s title is already usable — never a network/model call for the common case", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, title: "The Real Paper Title" },
      page1Text: "The Real Paper Title\nJ. Smith, University of Nowhere",
    } satisfies PdfTextResult);
    const generateJsonText = vi.fn();
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    await postWith(pdfFile(pdfBytes()));

    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("2-06 step (b): falls back to a local-dev small-tier model when step (a) found only an arXiv stamp", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, title: "arXiv:2401.12345v2" },
      page1Text: "arXiv:2401.12345v2\nA Study Of Interesting Reactions In Modern Battery Chemistry",
    } satisfies PdfTextResult);
    const generateJsonText = vi.fn().mockResolvedValue(
      JSON.stringify({ title: "A Study Of Interesting Reactions In Modern Battery Chemistry" }),
    );
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const res = await postWith(pdfFile(pdfBytes(), "untitled-download.pdf"));
    const body = await res.json();

    expect(body.paper.title).toBe("A Study Of Interesting Reactions In Modern Battery Chemistry");
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(generateJsonText.mock.calls[0][0]).toMatchObject({ tier: "small" });
  });

  it("2-06 step (b) -> (c): a stamp-shaped or unusable model answer is never trusted — falls through to the file name", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, title: "arXiv:2401.12345v2" },
      page1Text: "arXiv:2401.12345v2\nsome ambiguous page 1 layout",
    } satisfies PdfTextResult);
    // The model echoes the same stamp shape back — never trusted, same bar
    // as step (a)'s own output.
    const generateJsonText = vi.fn().mockResolvedValue(JSON.stringify({ title: "arXiv:2401.12345v2" }));
    mocks.resolveProvider.mockReturnValue({ generateJsonText });

    const res = await postWith(pdfFile(pdfBytes(), "My Battery Paper.pdf"));
    const body = await res.json();

    expect(body.paper.title).toBe("My Battery Paper");
  });

  it("2-06: without a local dev provider (the deployed-Peer case), a stamp-only title falls straight through to the file name", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: { ...emptyDoc, title: "arXiv:2401.12345v2" },
      page1Text: "arXiv:2401.12345v2",
    } satisfies PdfTextResult);
    mocks.resolveProvider.mockReturnValue(null); // canUseLocalServerProvider() false on a deployed instance

    const res = await postWith(pdfFile(pdfBytes(), "My Battery Paper.pdf"));
    const body = await res.json();

    expect(body.paper.title).toBe("My Battery Paper");
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

  it("2-05: marks textStatus 'empty' when the extractor found sections but none carry text", async () => {
    // The default beforeEach mock (`emptyDoc`, sections: []) — extraction
    // succeeded, there is simply nothing to report on.
    const res = await postWith(pdfFile(pdfBytes()));
    const body = await res.json();
    expect(body.paper.textStatus).toBe("empty");
  });

  it("2-05: marks textStatus 'ok' when the extractor found at least one real section", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({
      ok: true,
      doc: {
        ...emptyDoc,
        sections: [{ heading: "Abstract", canonical: "abstract", text: "This paper studies things." }],
      },
    } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes()));
    const body = await res.json();
    expect(body.paper.textStatus).toBe("ok");
  });

  it("2-05: marks textStatus 'empty' when the extractor fails entirely", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: false, reason: "no-python" } satisfies PdfTextResult);

    const res = await postWith(pdfFile(pdfBytes(), "scanned.pdf"));
    const body = await res.json();
    expect(body.paper.textStatus).toBe("empty");
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
