import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RawItem } from "@/lib/sources/types";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import zenodoDocJson from "@/lib/papers/__fixtures__/zenodo-W7208807247.doc.json";

const mocks = vi.hoisted(() => ({
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
  readUploadMeta: vi.fn(),
}));

vi.mock("@/lib/papers/fetch-by-id", () => ({
  fetchPaperById: mocks.fetchPaperById,
}));
vi.mock("@/lib/papers/full-text", () => ({
  getFullText: mocks.getFullText,
}));
vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
    readUploadMeta: mocks.readUploadMeta,
  };
});

import { GET } from "./route";

vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(), ownedUpload: mocks.readUploadMeta,
}));

const zenodoDoc = zenodoDocJson as unknown as ExtractedDocument;

/** The Zenodo record as `fetchPaperById` returns it. */
const zenodoItem: RawItem = {
  id: "openalex:W7208807247",
  source: "openalex",
  title: "Graph Embeddings for Protein Structure Prediction",
  authors: ["Jincheng Zhang"],
  abstract:
    "Predicting protein structure from its amino acid sequence remains a central challenge in computational biology. This work explores the potential of graph embeddings to address this challenge. We propose a novel framework where proteins are represented as graphs. We demonstrate that graph embeddings capture the structural information encoded within protein sequences.",
  url: "https://doi.org/10.5281/zenodo.22316532",
  publishedAt: "2026-09-05",
  venue: "Zenodo",
  metadata: { doi: "https://doi.org/10.5281/zenodo.22316532" },
};

const zenodoFullText: FullTextResult = {
  status: "ok",
  doc: zenodoDoc,
  sourceLink: {
    url: "https://zenodo.org/api/records/22316532/files/paper.pdf/content",
    kind: "pdf",
    label: "zenodo",
    rank: 12,
  },
  attempts: [],
};

function call(id: string, search = "") {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/reading${search}`);
  return GET(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

describe("GET /api/papers/[id]/reading", () => {
  beforeEach(() => {
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
    mocks.readUploadMeta.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the reading with a day-long edge cache once the full text settled", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe(
      "public, s-maxage=86400, stale-while-revalidate=604800",
    );
    const body = await res.json();
    // 1-28/1-31: PaperReading.version bumped 3 -> 4 for the new `pdf_empty`
    // fullText state; 4 -> 5 is main's later math-rendering shape change,
    // which this merge keeps (see reading.test.ts's own note). P1-04: 5 -> 6
    // (section ids and the reading map). P8-04: 6 -> 7 (the extractors'
    // sections and buckets changed; see reading.test.ts's note).
    // P9: 7 -> 8 (the PDF text and the cleaner changed: P9-08 / P9-09 / P9-10).
    expect(body.version).toBe(12);
    expect(body.paperId).toBe("openalex:W7208807247");
    expect(body.provenance.fullText).toBe("pdf");
    expect(body.provenance.pageCount).toBe(5);
    expect(body.provenance.sourceLabel).toBe("Zenodo PDF");
    expect(body.method).toHaveLength(2);
    expect(body.omitted).toContainEqual({ block: "findings", reason: "no_section" });
    expect(body.source).toEqual({ label: "Open the PDF", url: zenodoFullText.sourceLink?.url });

    // Resolved by id on the server, with every identifier the paper carries.
    expect(mocks.fetchPaperById).toHaveBeenCalledWith("openalex:W7208807247");
    expect(mocks.getFullText).toHaveBeenCalledWith({
      paperId: "openalex:W7208807247",
      url: "https://doi.org/10.5281/zenodo.22316532",
      doi: "10.5281/zenodo.22316532",
      arxivId: null,
      openAlexId: "W7208807247",
    });
  });

  it("caches a settled no-full-text outcome too — it is a fact about the paper", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [],
    } satisfies FullTextResult);

    const res = await call("openalex:W7208807247");

    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
    const body = await res.json();
    expect(body.provenance.fullText).toBe("none");
    expect(body.omitted).toContainEqual({ block: "method", reason: "not_in_abstract" });
  });

  it("answers with the abstract alone, uncached, when the full text does not settle in time", async () => {
    vi.useFakeTimers();
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockReturnValue(new Promise<FullTextResult>(() => undefined));

    const pending = call("openalex:W7208807247");
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await pending;

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.provenance.fullText).toBe("none");
    expect(body.abstract.sentences.length).toBeGreaterThan(0);
  });

  it("does not cache when the full-text attempt throws", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockRejectedValue(new Error("network down"));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const res = await call("openalex:W7208807247");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    quiet.mockRestore();
  });

  // P8-04: the client puts its reading version in the URL (`?v=`) so a shared cache never serves it an
  // older shape. The route reads only `refresh` and `upload`; a `v` it does not know changes nothing.
  it("ignores ?v= — an unknown version changes neither the answer nor its cache headers (P8-04)", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const plain = await call("openalex:W7208807247");
    const versioned = await call("openalex:W7208807247", "?v=999");

    expect(versioned.status).toBe(plain.status);
    expect(versioned.headers.get("cache-control")).toBe(plain.headers.get("cache-control"));
    expect({ ...(await versioned.json()), builtAt: undefined }).toEqual({ ...(await plain.json()), builtAt: undefined });
  });

  it("skips the edge cache on ?refresh=1", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247", "?refresh=1");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("404s, uncached, for an id that resolves to nothing", async () => {
    mocks.fetchPaperById.mockResolvedValue(null);

    const res = await call("openalex:W0");

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});

describe("GET /api/papers/[id]/reading — 2-05 (bug B): an upload: id never reaches fetchPaperById", () => {
  beforeEach(() => {
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
    mocks.readUploadMeta.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("404s, uncached, when no upload record exists for the hash — and never calls fetchPaperById", async () => {
    mocks.readUploadMeta.mockResolvedValue(null);

    const res = await call("upload:0000000000000000");

    expect(res.status).toBe(404);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
  });

  // P0-05 (§1e.1, A's F1): only the canonical `upload:<hash16>` is an
  // upload id. A case variant is refused as not found — never looked up as
  // an upload (even one whose owner check would pass), never handed to the
  // public paper lookup, never read.
  it("404s a non-canonical upload id, in the path or as ?upload=, without any lookup or read", async () => {
    mocks.readUploadMeta.mockResolvedValue({
      hash16: "0000000000000005", fileName: "paper.pdf", title: "A Real Uploaded Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", paperIds: ["openalex:W7208807247"],
    });
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    for (const id of ["UPLOAD:0000000000000005", "Upload:0000000000000005", "upload:00000000000000AB"]) {
      const res = await call(id);
      expect(res.status).toBe(404);
      expect(res.headers.get("cache-control")).toBe("no-store");
    }
    const supplement = await call("openalex:W7208807247", "?upload=UPLOAD%3A0000000000000005");
    expect(supplement.status).toBe(404);

    expect(mocks.readUploadMeta).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.fetchPaperById).toHaveBeenCalledTimes(1);
    expect(mocks.fetchPaperById).toHaveBeenCalledWith("openalex:W7208807247");
  });

  it("returns pdf_empty provenance for an upload whose PDF had no readable text", async () => {
    mocks.readUploadMeta.mockResolvedValue({
      hash16: "0000000000000001",
      fileName: "scanned.pdf",
      title: "scanned",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "empty",
    });
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "pdf-empty: PDF text extractor produced no sections.",
      attempts: [
        {
          link: { url: "/api/papers/upload/0000000000000001/file", kind: "pdf", label: "upload", rank: 0 },
          outcome: "no_full_text: pdf-empty: PDF text extractor produced no sections.",
        },
      ],
    } satisfies FullTextResult);

    const res = await call("upload:0000000000000001");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance.fullText).toBe("pdf_empty");
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
  });

  it("returns an ordinary pdf provenance for an upload with real sections — proving the wider 404 gap is closed, not just the empty case", async () => {
    mocks.readUploadMeta.mockResolvedValue({
      hash16: "0000000000000002",
      fileName: "paper.pdf",
      title: "A Real Uploaded Paper",
      pageCount: 5,
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
    });
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("upload:0000000000000002");

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.provenance.fullText).toBe("pdf");
    expect(body.paperId).toBe("upload:0000000000000002");
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
  });

  // 9-14 (A9-13, matrix C5): the full-text wait can take up to 8s; a
  // delete/block/replace landing during that window must not let a reading
  // built from the old asset be returned.
  it("9-14: returns 410 when the upload's revision changed while the full-text wait was in flight", async () => {
    mocks.readUploadMeta
      .mockResolvedValueOnce({
        hash16: "0000000000000003", fileName: "paper.pdf", title: "A Real Uploaded Paper",
        uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
      })
      .mockResolvedValueOnce({
        hash16: "0000000000000003", fileName: "paper.pdf", title: "A Real Uploaded Paper",
        uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 2,
      });
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("upload:0000000000000003");

    expect(res.status).toBe(410);
    expect(res.headers.get("cache-control")).not.toContain("s-maxage");
  });

  it("9-14: returns 410 when the upload was deleted while the full-text wait was in flight", async () => {
    mocks.readUploadMeta
      .mockResolvedValueOnce({
        hash16: "0000000000000004", fileName: "paper.pdf", title: "A Real Uploaded Paper",
        uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
      })
      .mockResolvedValueOnce(null);
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("upload:0000000000000004");

    expect(res.status).toBe(410);
  });
});

describe("GET /api/papers/[id]/reading — 9-14 (A9-13): the ?upload= supplement re-checks its revision too", () => {
  beforeEach(() => {
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
    mocks.readUploadMeta.mockReset();
  });

  it("returns 410 when the attached upload's revision changed while getFullText was in flight", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.readUploadMeta
      .mockResolvedValueOnce({
        hash16: "0000000000000005", fileName: "paper.pdf", title: "A Real Uploaded Paper",
        uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
        paperIds: ["openalex:W7208807247"],
      })
      .mockResolvedValueOnce({
        hash16: "0000000000000005", fileName: "paper.pdf", title: "A Real Uploaded Paper",
        uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 2,
        paperIds: ["openalex:W7208807247"],
      });
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247", "?upload=upload:0000000000000005");

    expect(res.status).toBe(410);
  });

  it("still returns the reading normally when the revision is unchanged", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.readUploadMeta.mockResolvedValue({
      hash16: "0000000000000006", fileName: "paper.pdf", title: "A Real Uploaded Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
      paperIds: ["openalex:W7208807247"],
    });
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247", "?upload=upload:0000000000000006");

    expect(res.status).toBe(200);
  });

  // P8-04: the hook's request is `?v=<version>&upload=…`; `v` first does not hide `upload`.
  it("reads the supplement when ?v= comes before ?upload=, and keeps the private headers (P8-04)", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.readUploadMeta.mockResolvedValue({
      hash16: "0000000000000007", fileName: "paper.pdf", title: "A Real Uploaded Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
      paperIds: ["openalex:W7208807247"],
    });
    mocks.getFullText.mockResolvedValue(zenodoFullText);

    const res = await call("openalex:W7208807247", "?v=12&upload=upload:0000000000000007");

    expect(res.status).toBe(200);
    expect(mocks.getFullText).toHaveBeenCalledWith({ paperId: "upload:0000000000000007" });
    expect(res.headers.get("cache-control")).toContain("no-store");
  });
});

// P9-42 (§1h.67): a supplement reading takes its captions and their pages from the reader's own
// attached PDF, so its figure pictures come from that PDF too — the URL names the upload, and the
// figure-image route answers it to its owner only. The public reading keeps the public id.
describe("GET /api/papers/[id]/reading — P9-42 (§1h.67): a supplement's figure pictures come from the owner's attached PDF", () => {
  beforeEach(() => {
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
    mocks.readUploadMeta.mockReset();
  });

  /** The text of a PDF with a "Figure 2" caption on page 3 (the Zenodo fixture's body, one caption added). */
  const picturedText: FullTextResult = {
    ...zenodoFullText,
    doc: {
      ...zenodoDoc,
      figureCaptions: [{ ordinal: 1, label: "Figure 2", caption: "Embedding dimension against accuracy.", page: 3, at: 0.5 }],
    },
  };
  const figureUrls = (body: { body: { figures?: { imageUrl?: string }[] }[] }) =>
    body.body.flatMap((section) => section.figures ?? []).map((figure) => figure.imageUrl);
  const meta = (hash16: string, extra: Record<string, unknown> = {}) => ({
    hash16, fileName: "paper.pdf", title: "A Real Uploaded Paper",
    uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1, ...extra,
  });

  it("names the attached upload in every figure picture's URL on the ?upload= branch — never the public paper", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.readUploadMeta.mockResolvedValue(meta("0000000000000008", { paperIds: ["openalex:W7208807247"] }));
    mocks.getFullText.mockResolvedValue(picturedText);

    const res = await call("openalex:W7208807247", "?upload=upload:0000000000000008");

    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = await res.json();
    expect(figureUrls(body)).toEqual(["/api/papers/upload%3A0000000000000008/figure-image?page=3&fig=2"]);
    expect(JSON.stringify(body)).not.toContain("openalex%3AW7208807247/figure-image");
    // Still the public paper's reading: its id, and the captions read from the attached text.
    expect(body.paperId).toBe("openalex:W7208807247");
    expect(mocks.getFullText).toHaveBeenCalledWith({ paperId: "upload:0000000000000008" });
  });

  it("keeps the public paper's id in the picture URLs of the plain branch", async () => {
    mocks.fetchPaperById.mockResolvedValue(zenodoItem);
    mocks.getFullText.mockResolvedValue(picturedText);

    const res = await call("openalex:W7208807247");

    expect(res.status).toBe(200);
    expect(figureUrls(await res.json())).toEqual(["/api/papers/openalex%3AW7208807247/figure-image?page=3&fig=2"]);
  });

  it("keeps an upload's own reading naming itself", async () => {
    mocks.readUploadMeta.mockResolvedValue(meta("0000000000000009"));
    mocks.getFullText.mockResolvedValue(picturedText);

    const res = await call("upload:0000000000000009");

    expect(res.status).toBe(200);
    expect(figureUrls(await res.json())).toEqual(["/api/papers/upload%3A0000000000000009/figure-image?page=3&fig=2"]);
  });
});
