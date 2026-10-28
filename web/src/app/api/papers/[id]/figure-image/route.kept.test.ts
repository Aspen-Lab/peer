// P12-61 (§1h.434, the owner: "必须要这么做") — a figure view never opens the
// whole PDF twice. For an upload, the first successful cut of a figure is kept
// beside the upload, owner-private; a later request for the same upload, page
// and label is answered from the kept picture and neither reads the PDF nor runs
// the engine. The real chain runs in-process (as `route.test.ts` does): the upload
// store on a temp directory, the real owner check with only the cookie jar stubbed,
// the real figure engine on an invented PDF; the PDF reader, the engine and the
// kept-cut reader and writer are the real functions, watched. Only the public
// paper's lookup, full text and download are stubbed — those are the network.
import { existsSync } from "node:fs";
import { readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { barChart, bodyText, figurePdf, panel, pngInfo, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-figure-image-kept-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

// The revision is a getter, so a test can bump it the way a code change does.
const revision = vi.hoisted(() => ({ value: "4" }));
vi.mock("@/lib/figures/figure-revision", () => ({
  get FIGURE_EXTRACTION_REVISION() {
    return revision.value;
  },
}));

const mocks = vi.hoisted(() => ({
  token: { value: undefined as string | undefined },
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
  getPdfBytes: vi.fn(),
  extractPdfFigures: vi.fn(),
  readUploadPdf: vi.fn(),
  readUploadFigureCut: vi.fn(),
  writeUploadFigureCut: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "peer-private-uploads" && mocks.token.value ? { name, value: mocks.token.value } : undefined),
    set: (name: string, value: string) => {
      if (name === "peer-private-uploads") mocks.token.value = value;
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/papers/fetch-by-id", () => ({ fetchPaperById: mocks.fetchPaperById }));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));
vi.mock("@/lib/papers/pdf-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/papers/pdf-text")>()),
  getPdfBytes: mocks.getPdfBytes,
}));
vi.mock("@/lib/figures/pdf-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/figures/pdf-engine")>();
  mocks.extractPdfFigures.mockImplementation(actual.extractPdfFigures);
  return { ...actual, extractPdfFigures: mocks.extractPdfFigures };
});
vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  mocks.readUploadPdf.mockImplementation(actual.readUploadPdf);
  mocks.readUploadFigureCut.mockImplementation(actual.readUploadFigureCut);
  mocks.writeUploadFigureCut.mockImplementation(actual.writeUploadFigureCut);
  return {
    ...actual,
    readUploadPdf: mocks.readUploadPdf,
    readUploadFigureCut: mocks.readUploadFigureCut,
    writeUploadFigureCut: mocks.writeUploadFigureCut,
  };
});

import { GET } from "./route";
import {
  deleteUpload,
  purgeExpiredUploads,
  readUploadMeta,
  sha16,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "@/lib/papers/upload-store";
import { uploadOwner } from "@/lib/papers/upload-access";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

// ── The invented PDF: page 1 prose, page 2 two panels of different sizes
// (Figures 3 and 4, so which picture came back shows in the PNG's width), page 3
// a chart (Figure 5). ────────────────────────────────────────────────────────

const prose = bodyText(["Synthetic body text, one line.", "Synthetic body text, a second line."], 80);
const PAGES: FigurePage[] = [
  { text: prose },
  {
    text: [
      ["Figure 3. The wide panel of a two-figure page.", 100, 262, 9],
      ["Figure 4. The narrow panel of a two-figure page.", 100, 492, 9],
    ],
    shapes: [...panel(100, 80, 370, 160), ...panel(100, 330, 250, 140)],
  },
  { text: [...prose, ["Figure 5. A synthetic vector bar chart.", 72, 440, 9]], shapes: barChart(110, 250) },
];
const PDF = figurePdf(PAGES);
// 2.8x of the panel's width plus the 10 pt padding either side.
const WIDE = (370 + 20) * 2.8;
const NARROW = (250 + 20) * 2.8;

const PUBLIC_ID = "arxiv:2610.00001";
const PUBLIC_CACHE = "public, s-maxage=86400, stale-while-revalidate=604800";
const PRIVATE_CACHE = "private, no-store";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const HASH = sha16(PDF);
const UPLOAD_ID = `upload:${HASH}`;
const CUTS = path.join(uploadDir, "figure-cuts", HASH);
const keptObjects = async () => (await readdir(CUTS).catch(() => [])).sort();

function call(id: string, search: string): Promise<Response> {
  const encoded = encodeURIComponent(id);
  return GET(new NextRequest(`http://localhost/api/papers/${encoded}/figure-image${search}`), {
    params: Promise.resolve({ id: encoded }),
  });
}

async function storeUpload(owner: string, extra: Partial<UploadMeta> = {}): Promise<void> {
  mocks.token.value = owner;
  const ownerKey = await uploadOwner();
  await writeUploadPdfIfAbsent(HASH, Buffer.from(PDF));
  await writeUploadMeta(HASH, {
    hash16: HASH,
    fileName: "paper.pdf",
    title: "An invented upload",
    pageCount: 3,
    uploadedAt: new Date().toISOString(),
    textStatus: "ok",
    ownerKey: ownerKey ?? undefined,
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    status: "ready",
    revision: 1,
    ...extra,
  });
}

async function bytesOf(res: Response): Promise<Buffer> {
  return Buffer.from(await res.arrayBuffer());
}

function widthOf(bytes: Buffer): number {
  const info = pngInfo(new Uint8Array(bytes));
  expect(info.signature).toBe(true);
  return info.width;
}

// The first cut in a process loads MuPDF's WASM, which under a loaded machine takes longer than a test's
// default 5 s; load it once here, outside any test's clock. The counts below are cleared before each test.
beforeAll(async () => {
  await mocks.extractPdfFigures(new Uint8Array(PDF), { maxPages: 3, maxFigures: 1, onlyPage: 2, label: "Figure 3" });
}, 60_000);

beforeEach(async () => {
  mocks.fetchPaperById.mockReset();
  mocks.getFullText.mockReset();
  mocks.getPdfBytes.mockReset();
  mocks.extractPdfFigures.mockClear();
  mocks.readUploadPdf.mockClear();
  mocks.readUploadFigureCut.mockClear();
  mocks.writeUploadFigureCut.mockClear();
  mocks.token.value = undefined;
  revision.value = "4";
  await rm(path.join(uploadDir, "figure-cuts"), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/papers/[id]/figure-image — an upload's kept cut (P12-61)", () => {
  it("reads the PDF once and keeps the cut; the second request is answered from it — the same bytes, no PDF read, no engine", async () => {
    await storeUpload(OWNER);

    const first = await call(UPLOAD_ID, "?page=2&fig=4");
    const firstBytes = await bytesOf(first);

    expect(first.status).toBe(200);
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    expect(mocks.writeUploadFigureCut).toHaveBeenCalledTimes(1);
    expect(await keptObjects()).toHaveLength(1);

    const second = await call(UPLOAD_ID, "?page=2&fig=4");
    const secondBytes = await bytesOf(second);

    expect(second.status).toBe(200);
    expect(Buffer.compare(secondBytes, firstBytes)).toBe(0);
    expect(widthOf(secondBytes)).toBeGreaterThan(NARROW - 4);
    expect(widthOf(secondBytes)).toBeLessThan(NARROW + 4);
    // The PDF was read once, the engine ran once, and nothing more was kept.
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    expect(mocks.writeUploadFigureCut).toHaveBeenCalledTimes(1);
    expect(mocks.readUploadFigureCut).toHaveBeenCalledTimes(2);
    expect(await keptObjects()).toHaveLength(1);
    // Nothing public was touched either.
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.getPdfBytes).not.toHaveBeenCalled();
  });

  it("answers the kept picture with the same private, no-store headers as the first answer", async () => {
    await storeUpload(OWNER);
    const first = await call(UPLOAD_ID, "?page=2&fig=3");
    const firstBytes = await bytesOf(first);
    const second = await call(UPLOAD_ID, "?page=2&fig=3");
    const secondBytes = await bytesOf(second);

    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    for (const res of [first, second]) {
      expect(res.headers.get("Content-Type")).toBe("image/png");
      expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
      expect(res.headers.get("Vary")).toBe("Cookie");
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("X-Robots-Tag")).toBe("noindex, noarchive");
      expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
    }
    expect(second.headers.get("Content-Length")).toBe(String(secondBytes.byteLength));
    expect(second.headers.get("Content-Length")).toBe(first.headers.get("Content-Length"));
    expect(secondBytes.byteLength).toBe(firstBytes.byteLength);
  });

  it("keys the cut by page and by figure: another figure on the page, or on another page, is cut once and then kept too", async () => {
    await storeUpload(OWNER);

    const wide = await bytesOf(await call(UPLOAD_ID, "?page=2&fig=3"));
    const narrow = await bytesOf(await call(UPLOAD_ID, "?page=2&fig=4"));
    const chart = await bytesOf(await call(UPLOAD_ID, "?page=3&fig=5"));
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(3);
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(3);
    expect(await keptObjects()).toHaveLength(3);

    // Each is then answered from its own kept picture — never another figure's.
    const wideAgain = await bytesOf(await call(UPLOAD_ID, "?page=2&fig=3"));
    const narrowAgain = await bytesOf(await call(UPLOAD_ID, "?page=2&fig=4"));
    const chartAgain = await bytesOf(await call(UPLOAD_ID, "?page=3&fig=5"));
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(3);
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(3);
    expect(Buffer.compare(wideAgain, wide)).toBe(0);
    expect(Buffer.compare(narrowAgain, narrow)).toBe(0);
    expect(Buffer.compare(chartAgain, chart)).toBe(0);
    expect(widthOf(wideAgain)).toBeGreaterThan(WIDE - 4);
    expect(widthOf(narrowAgain)).toBeLessThan(NARROW + 4);
  });

  it("uses a kept cut only under the revision it was cut under: a bumped FIGURE_EXTRACTION_REVISION reads the PDF again, and the purge removes the old cut", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    await call(UPLOAD_ID, "?page=2&fig=3");
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);

    revision.value = "5";
    const recut = await call(UPLOAD_ID, "?page=2&fig=3");

    expect(recut.status).toBe(200);
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(2);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);
    expect(await keptObjects()).toHaveLength(2);
    // And the new cut is kept in its turn.
    await call(UPLOAD_ID, "?page=2&fig=3");
    expect(mocks.readUploadPdf).toHaveBeenCalledTimes(2);

    await purgeExpiredUploads();
    const left = await keptObjects();
    expect(left).toHaveLength(1);
    expect(left[0]).toMatch(/-r5\.cut$/);
  });

  it("removes the kept cuts with the upload: after the upload is deleted they are gone, and a re-uploaded file is cut afresh", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    await call(UPLOAD_ID, "?page=3&fig=5");
    expect(await keptObjects()).toHaveLength(2);

    const meta = await readUploadMeta(HASH);
    expect(meta).not.toBeNull();
    await deleteUpload(meta!);

    expect(existsSync(CUTS)).toBe(false);
    mocks.readUploadFigureCut.mockClear();
    const gone = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(gone.status).toBe(404);
    expect(gone.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(gone.headers.get("Content-Type")).not.toBe("image/png");
    // The owner check refuses first: nothing was looked up.
    expect(mocks.readUploadFigureCut).not.toHaveBeenCalled();

    // The same bytes uploaded again are the same upload id, with nothing kept for it.
    await storeUpload(OWNER);
    mocks.extractPdfFigures.mockClear();
    const again = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(again.status).toBe(200);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
  });

  it("does not keep a cut that failed: no such figure on the page, an engine that will not load, or a picture with no bytes", async () => {
    await storeUpload(OWNER);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    // Figure 5 is on page 3, not page 1.
    expect((await call(UPLOAD_ID, "?page=1&fig=5")).status).toBe(404);
    expect(mocks.writeUploadFigureCut).not.toHaveBeenCalled();
    expect(await keptObjects()).toEqual([]);
    expect((await call(UPLOAD_ID, "?page=1&fig=5")).status).toBe(404);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);

    mocks.extractPdfFigures.mockRejectedValueOnce(new Error("no wasm"));
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(502);
    expect(mocks.writeUploadFigureCut).not.toHaveBeenCalled();
    expect(await keptObjects()).toEqual([]);

    mocks.extractPdfFigures.mockResolvedValueOnce({
      figures: [{ ordinal: 0, page: 2, caption: "", kind: "drawing", png: new Uint8Array(0), width: 0, height: 0 }],
      reason: null,
    });
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);
    expect(mocks.writeUploadFigureCut).not.toHaveBeenCalled();
    expect(await keptObjects()).toEqual([]);

    // A failure left nothing behind to answer from: the next request cuts, and keeps.
    mocks.extractPdfFigures.mockClear();
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(200);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    expect(await keptObjects()).toHaveLength(1);
  });

  it("answers the cut even when it cannot be kept, and cuts again the next time", async () => {
    await storeUpload(OWNER);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.writeUploadFigureCut.mockRejectedValueOnce(new Error("disk full"));

    const res = await call(UPLOAD_ID, "?page=2&fig=3");

    expect(res.status).toBe(200);
    expect(widthOf(await bytesOf(res))).toBeGreaterThan(WIDE - 4);
    expect(warn).toHaveBeenCalled();
    expect(await keptObjects()).toEqual([]);

    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(200);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);
    expect(await keptObjects()).toHaveLength(1);
  });

  it("cuts again, and keeps the new cut, when the kept object is not whole", async () => {
    await storeUpload(OWNER);
    const first = await bytesOf(await call(UPLOAD_ID, "?page=2&fig=4"));
    const [name] = await keptObjects();
    const stored = await readFile(path.join(CUTS, name));
    await writeFile(path.join(CUTS, name), stored.subarray(0, stored.byteLength - 20));

    const res = await call(UPLOAD_ID, "?page=2&fig=4");

    expect(res.status).toBe(200);
    expect(Buffer.compare(await bytesOf(res), first)).toBe(0);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);
    // Whole again: the third request is answered from it.
    await call(UPLOAD_ID, "?page=2&fig=4");
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);
  });

  it("looks a kept cut up only after the owner check: another reader, no cookie, an expired or taken-down upload are all refused", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    expect(await keptObjects()).toHaveLength(1);
    mocks.readUploadFigureCut.mockClear();

    mocks.token.value = STRANGER;
    const stranger = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(stranger.headers.get("Content-Type")).not.toBe("image/png");
    expect(stranger.headers.get("X-Peer-Figure-Engine")).toBeNull();

    mocks.token.value = undefined;
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);

    await storeUpload(OWNER, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);
    await storeUpload(OWNER, { status: "blocked" });
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);

    expect(mocks.readUploadFigureCut).not.toHaveBeenCalled();
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
  });

  it("refuses a bad parameter or a page past the document before it looks anything up", async () => {
    await storeUpload(OWNER);
    for (const search of ["?page=0&fig=3", "?page=2&fig=0", "?page=2", "?fig=3", "?page=4&fig=3"]) {
      const res = await call(UPLOAD_ID, search);
      expect([400, 404]).toContain(res.status);
      expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    }
    expect(mocks.readUploadFigureCut).not.toHaveBeenCalled();
    expect(mocks.readUploadPdf).not.toHaveBeenCalled();
    expect(mocks.writeUploadFigureCut).not.toHaveBeenCalled();
  });
});

describe("GET /api/papers/[id]/figure-image — a public paper is unchanged by the kept cut (P12-61)", () => {
  it("keeps its day-long edge cache, reads its PDF each time it is asked, and stores nothing of its own", async () => {
    mocks.fetchPaperById.mockResolvedValue({
      id: PUBLIC_ID,
      source: "arxiv",
      title: "A paper with figures",
      authors: ["A. Researcher"],
      abstract: "An invented abstract.",
      url: "https://arxiv.org/abs/2610.00001",
      publishedAt: "2026-10-01",
      venue: "arXiv",
      metadata: {},
    });
    mocks.getFullText.mockResolvedValue({
      status: "ok",
      doc: { source: "pdf", pageCount: 3, sections: [], figureCaptions: [] },
      sourceLink: { url: "https://arxiv.org/pdf/2610.00001", kind: "pdf", label: "arxiv", rank: 1 },
      attempts: [],
    });
    mocks.getPdfBytes.mockResolvedValue({ bytes: Buffer.from(PDF) });

    const first = await call(PUBLIC_ID, "?page=2&fig=3");
    const second = await call(PUBLIC_ID, "?page=2&fig=3");

    for (const res of [first, second]) {
      expect(res.status).toBe(200);
      expect(res.headers.get("Cache-Control")).toBe(PUBLIC_CACHE);
      expect(res.headers.get("Vary")).toBeNull();
      expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
      expect(pngInfo(new Uint8Array(await res.arrayBuffer())).signature).toBe(true);
    }
    expect(mocks.getPdfBytes).toHaveBeenCalledTimes(2);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(2);
    expect(mocks.readUploadFigureCut).not.toHaveBeenCalled();
    expect(mocks.writeUploadFigureCut).not.toHaveBeenCalled();
    expect(existsSync(path.join(uploadDir, "figure-cuts"))).toBe(false);
  });
});
