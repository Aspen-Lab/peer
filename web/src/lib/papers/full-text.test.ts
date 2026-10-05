import { existsSync } from "node:fs";
import { rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "./html-text";
import { minimalPdf, prose } from "./minimal-pdf.test-helper";
import type { PdfTextResult } from "./pdf-text";
import type { SourceLink } from "./source-links";
import type { UploadMeta } from "./upload-store";

// P0-02: the upload text cache writes a sidecar beside the upload. This file
// gets its own private upload directory, set before `upload-store` reads it,
// so nothing here touches `.local-data/uploads` or another test file's.
const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-full-text-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(async (): Promise<Partial<UploadMeta> | null> => ({ ownerKey: "test" })),
  collectSourceLinks: vi.fn(),
  extractPdfTextFromPath: vi.fn(),
  pdfOpens: { n: 0 },
}));

// P0-05: every PDF pdf.js opens in this file is counted — a pass-through.
vi.mock("unpdf", async (importOriginal) => {
  const actual = await importOriginal<typeof import("unpdf")>();
  return {
    ...actual,
    getDocumentProxy: (...args: Parameters<typeof actual.getDocumentProxy>) => {
      mocks.pdfOpens.n += 1;
      return actual.getDocumentProxy(...args);
    },
  };
});

vi.mock("./upload-access", () => ({ ownedUpload: mocks.ownedUpload }));

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
import { buildReading } from "./reading";

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
    sections: [{ id: "s0", heading: "Body", canonical: "body", text: "Real body text." }],
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

  // P0-03: rewritten. This was "marks a no-python/no-extractor failure the
  // same way a normal PDF link would" — the upload path read PDFs through a
  // Python helper that a deployed Peer could not run. It reads them with
  // pdf.js now; those two reasons no longer exist, and a scan arrives with
  // the `pdf-empty:` marker already on it, which must pass through as is.
  it("passes the extractor's own pdf-empty marker through unchanged (no-python/no-extractor are gone)", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: false, reason: "pdf-empty: no-text-layer" } satisfies PdfTextResult);

    const result = await getFullText({ paperId: "upload:0000000000000003" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toBe("no_full_text: pdf-empty: no-text-layer");
  });
});

// P0-02 (spec D0): an upload's text is read out of the PDF once per owner,
// revision and extraction version, kept in memory for the hour and in a
// sidecar beside the upload after that — and only ever looked up after the
// owner check has passed.
describe("getFullText — P0-02, an upload is extracted once and cached for its owner", () => {
  const doc: ExtractedDocument = {
    title: "A Cached Upload",
    sections: [
      { id: "s0", heading: "1 Introduction", canonical: "introduction", text: "Cached prose.", page: 1 },
      { id: "s1", heading: "2 Methods", canonical: "methods", text: "More cached prose.", page: 2 },
    ],
    figureCaptions: [],
    source: "pdf",
    pageCount: 4,
    reason: null,
  };
  const owner = (ownerKey: string, revision = 1) => async (): Promise<Partial<UploadMeta>> => ({ ownerKey, revision });
  const sidecar = (hash16: string) => path.join(uploadDir, `${hash16}.doc.json`);

  beforeEach(() => {
    mocks.collectSourceLinks.mockReset();
    mocks.extractPdfTextFromPath.mockReset();
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: true, doc } satisfies PdfTextResult);
    mocks.ownedUpload.mockImplementation(owner("owner-a"));
  });

  afterEach(() => {
    mocks.ownedUpload.mockImplementation(async () => ({ ownerKey: "test" }));
  });

  it("runs the extractor once across two opens, and keeps the text beside the upload, owner-only", async () => {
    const first = await getFullText({ paperId: "upload:00000000000000a1" });
    const second = await getFullText({ paperId: "upload:00000000000000a1" });

    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(1);
    expect(first.status).toBe("ok");
    expect(second).toEqual(first);
    expect(second.doc).toEqual(doc);
    expect(existsSync(sidecar("00000000000000a1"))).toBe(true);
    expect((await stat(sidecar("00000000000000a1"))).mode & 0o777).toBe(0o600);
  });

  it("shares one extraction between two opens that arrive together", async () => {
    const [a, b] = await Promise.all([
      getFullText({ paperId: "upload:00000000000000a2" }),
      getFullText({ paperId: "upload:00000000000000a2" }),
    ]);

    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(1);
    expect(a.doc).toEqual(doc);
    expect(b.doc).toEqual(doc);
  });

  it("reads the sidecar back after a cold start instead of reading the PDF again", async () => {
    await getFullText({ paperId: "upload:00000000000000a3" });
    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(1);

    // A fresh server process: no module state, only what is on disk.
    vi.resetModules();
    const { getFullText: coldGetFullText } = await import("./full-text");
    const cold = await coldGetFullText({ paperId: "upload:00000000000000a3" });

    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(1);
    expect(cold.status).toBe("ok");
    expect(cold.doc).toEqual(doc);
    expect(cold.sourceLink?.label).toBe("upload");
  });

  it("reads the PDF again for a new revision, and for a different owner key", async () => {
    await getFullText({ paperId: "upload:00000000000000a4" });
    mocks.ownedUpload.mockImplementation(owner("owner-a", 2));
    await getFullText({ paperId: "upload:00000000000000a4" });
    mocks.ownedUpload.mockImplementation(owner("owner-b", 2));
    await getFullText({ paperId: "upload:00000000000000a4" });

    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(3);
  });

  it("answers anyone the owner check refuses 'unavailable', never with the cached text", async () => {
    await getFullText({ paperId: "upload:00000000000000a5" });
    // ownedUpload is the owner check: it refuses anyone whose key is not the
    // record's. The cached text must not leak past that refusal.
    mocks.ownedUpload.mockImplementation(async () => null);

    const other = await getFullText({ paperId: "upload:00000000000000a5" });

    expect(other).toEqual({ status: "source_unavailable", attempts: [], reason: "Private upload unavailable." });
    expect(other.doc).toBeUndefined();
    expect(mocks.extractPdfTextFromPath).toHaveBeenCalledTimes(1);
  });

  it("never keeps a failed reading, so a scan is read as a scan again rather than cached as text", async () => {
    mocks.extractPdfTextFromPath.mockResolvedValue({ ok: false, reason: "PDF text extractor produced no sections." } satisfies PdfTextResult);

    const first = await getFullText({ paperId: "upload:00000000000000a6" });

    expect(first.status).toBe("no_full_text");
    expect(first.attempts[0].outcome).toContain("pdf-empty");
    expect(existsSync(sidecar("00000000000000a6"))).toBe(false);
  });
});

// P0-03 (spec D3, §3d item 3): the real upload path, end to end on the
// server — no stub between `getFullText` and pdf.js. A PDF with no text
// layer reads as `pdf-empty`, and the reading names it with the page's
// "no readable text" notice, not as a PDF this deployment cannot read.
describe("getFullText — P0-03, an uploaded scan read by pdf.js", () => {
  afterEach(() => {
    mocks.extractPdfTextFromPath.mockReset();
  });

  it("reads a scanned upload as pdf-empty, and the reading says it has no readable text", async () => {
    const actual = await vi.importActual<typeof import("./pdf-text")>("./pdf-text");
    mocks.extractPdfTextFromPath.mockImplementation(actual.extractPdfTextFromPath);
    await writeFile(path.join(uploadDir, "00000000000000b1.pdf"), minimalPdf([[], []]));

    const result = await getFullText({ paperId: "upload:00000000000000b1" });

    expect(result.status).toBe("no_full_text");
    expect(result.attempts[0].outcome).toMatch(/^no_full_text: pdf-empty: /);
    const reading = buildReading(
      {
        id: "upload:00000000000000b1", title: "A scanned upload", authors: [], relevanceReason: "", venue: "",
        source: "other", summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
      },
      result,
    );
    expect(reading.provenance.fullText).toBe("pdf_empty");
    expect(existsSync(path.join(uploadDir, "00000000000000b1.doc.json"))).toBe(false);
  });
});

// P0-05 (§1e.1, A's F1, privacy): only the canonical `upload:<hash16>` is an
// upload id, and an upload is read from disk only after its owner check. A
// case variant (`UPLOAD:<hash16>`) used to skip the check — `getFullText`
// tested `startsWith("upload:")` while `buildResult` read anything
// `bareUploadId` matched case-insensitively — and the private text then sat
// in the shared full-text cache for an hour under the variant id.
describe("getFullText — P0-05, a non-canonical upload id is refused, never read", () => {
  const SECRET = "Quillwortane";
  const privatePdf = minimalPdf([
    [
      ["A Private Paper About Creep", 72, 80, 18],
      ["1 Introduction", 72, 130, 11],
      ...prose(
        [
          `We measure creep in ${SECRET} alloys with many grain boundaries per cubic micron.`,
          "Boundary density sets the creep rate across three decades of applied stress.",
          "Grain boundaries are where most of the creep strain is thought to happen.",
        ],
        150,
      ),
    ],
  ]);
  const unavailable = { status: "source_unavailable", attempts: [], reason: "Private upload unavailable." };

  beforeEach(async () => {
    mocks.collectSourceLinks.mockReset();
    mocks.collectSourceLinks.mockResolvedValue([]);
    mocks.extractPdfTextFromPath.mockReset();
    const actual = await vi.importActual<typeof import("./pdf-text")>("./pdf-text");
    mocks.extractPdfTextFromPath.mockImplementation(actual.extractPdfTextFromPath);
    mocks.pdfOpens.n = 0;
  });

  afterEach(() => {
    mocks.ownedUpload.mockImplementation(async () => ({ ownerKey: "test" }));
    mocks.extractPdfTextFromPath.mockReset();
  });

  it("refuses a case-variant id even where the owner check would pass: no disk read, no pdf.js, no public lookup", async () => {
    const hash = "00000000000000c1";
    await writeFile(path.join(uploadDir, `${hash}.pdf`), privatePdf);
    // An owner check that would let anyone through, so only the id rule
    // can be what refuses.
    mocks.ownedUpload.mockImplementation(async () => ({ ownerKey: "owner-c", revision: 1 }));

    for (const id of [`UPLOAD:${hash}`, `Upload:${hash}`, `upload:${hash.toUpperCase()}`, ` upload:${hash}`]) {
      const result = await getFullText({ paperId: id });
      expect(result).toEqual(unavailable);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    }
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
    expect(mocks.pdfOpens.n).toBe(0);
    // The shared path — the only one that fills the shared cache — never
    // ran for them either: it starts with `collectSourceLinks`.
    expect(mocks.collectSourceLinks).not.toHaveBeenCalled();

    // Control: the canonical id is read, so the fixture was readable.
    const owned = await getFullText({ paperId: `upload:${hash}` });
    expect(owned.status).toBe("ok");
    expect(JSON.stringify(owned.doc)).toContain(SECRET);
    expect(mocks.pdfOpens.n).toBe(1);
  });

  it("with the owner check refusing, a case-variant id is unavailable on every call — nothing was cached for it", async () => {
    const hash = "00000000000000c2";
    await writeFile(path.join(uploadDir, `${hash}.pdf`), privatePdf);
    mocks.ownedUpload.mockImplementation(async () => null);

    const first = await getFullText({ paperId: `UPLOAD:${hash}` });
    // Gone from disk: a result served now could only come from a cache.
    await rm(path.join(uploadDir, `${hash}.pdf`), { force: true });
    const second = await getFullText({ paperId: `UPLOAD:${hash}` });

    expect(first).toEqual(unavailable);
    expect(second).toEqual(unavailable);
    expect(mocks.extractPdfTextFromPath).not.toHaveBeenCalled();
    expect(mocks.collectSourceLinks).not.toHaveBeenCalled();
    expect(mocks.pdfOpens.n).toBe(0);
  });
});
