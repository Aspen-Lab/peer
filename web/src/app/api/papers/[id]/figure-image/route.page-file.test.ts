// P12-61 (§1h.434, part 2) — the page file: the first cut on a page of an upload also cuts that page out of the
// upload as a PDF of its own and keeps it beside the upload; a cut of any other figure on that page, or of the same
// figure after a revision change, opens only that small file, never the paper. An upload without page files (made
// before, or one whose page file is damaged) takes the whole-file path and makes them. The real chain runs
// in-process, as `route.test.ts` does: the upload store on a temp directory, the real owner check with only the
// cookie jar stubbed, the real figure engine on an invented PDF; the readers and the engine are watched.

import { existsSync } from "node:fs";
import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { barChart, bodyText, figurePdf, panel, pngInfo, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-figure-image-pagefile-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

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
  cutPdfPage: vi.fn(),
  withUploadPdfSource: vi.fn(),
  readUploadPageFile: vi.fn(),
  writeUploadPageFile: vi.fn(),
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
  mocks.cutPdfPage.mockImplementation(actual.cutPdfPage);
  return { ...actual, extractPdfFigures: mocks.extractPdfFigures, cutPdfPage: mocks.cutPdfPage };
});
vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  mocks.withUploadPdfSource.mockImplementation(actual.withUploadPdfSource);
  mocks.readUploadPageFile.mockImplementation(actual.readUploadPageFile);
  mocks.writeUploadPageFile.mockImplementation(actual.writeUploadPageFile);
  return {
    ...actual,
    withUploadPdfSource: mocks.withUploadPdfSource,
    readUploadPageFile: mocks.readUploadPageFile,
    writeUploadPageFile: mocks.writeUploadPageFile,
  };
});

import { GET } from "./route";
import { deleteUpload, readUploadMeta, sha16, writeUploadMeta, writeUploadPdfIfAbsent, type UploadMeta } from "@/lib/papers/upload-store";
import { extractPdfFigures as realExtract } from "@/lib/figures/pdf-engine";
import { uploadOwner } from "@/lib/papers/upload-access";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

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

const PRIVATE_CACHE = "private, no-store";
const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "33333333-3333-4333-8333-333333333333";
const HASH = sha16(PDF);
const UPLOAD_ID = `upload:${HASH}`;
const FOLDER = path.join(uploadDir, "figure-cuts", HASH);
const pageFiles = async () => (await readdir(FOLDER).catch(() => [])).filter((name) => name.endsWith(".pdf")).sort();
const cuts = async () => (await readdir(FOLDER).catch(() => [])).filter((name) => name.endsWith(".cut")).sort();

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

const body = async (res: Response) => Buffer.from(await res.arrayBuffer());

/** What the engine draws for this figure from the whole PDF: the reference a page-file answer must equal. */
async function drawnFromWhole(page: number, fig: number): Promise<Buffer> {
  const { figures } = await realExtract(PDF, { maxPages: 24, maxFigures: 1, onlyPage: page, label: `Figure ${fig}` });
  return Buffer.from(figures[0].png);
}

beforeAll(async () => {
  // Load MuPDF's WASM once, outside any test's clock (it takes longer than 5 s on a loaded machine).
  await realExtract(PDF, { maxPages: 3, maxFigures: 1, onlyPage: 2, label: "Figure 3" });
}, 60_000);

beforeEach(async () => {
  mocks.fetchPaperById.mockReset();
  mocks.getFullText.mockReset();
  mocks.getPdfBytes.mockReset();
  for (const mock of [mocks.extractPdfFigures, mocks.cutPdfPage, mocks.withUploadPdfSource, mocks.readUploadPageFile, mocks.writeUploadPageFile]) mock.mockClear();
  mocks.token.value = undefined;
  revision.value = "4";
  await rm(path.join(uploadDir, "figure-cuts"), { recursive: true, force: true });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/papers/[id]/figure-image — an upload's page file (P12-61, part 2)", () => {
  it("makes the page's own file on the first cut on that page: one page, from the stored file, kept beside the upload", async () => {
    await storeUpload(OWNER);

    const res = await call(UPLOAD_ID, "?page=2&fig=3");

    expect(res.status).toBe(200);
    expect(mocks.cutPdfPage).toHaveBeenCalledTimes(1);
    expect(mocks.cutPdfPage.mock.calls[0][1]).toBe(2);
    expect(mocks.cutPdfPage.mock.calls[0][0]).toHaveProperty("filePath");
    expect(await pageFiles()).toEqual(["p2.pdf"]);
    // A PDF of one page, which holds the figure.
    const kept = await readFile(path.join(FOLDER, "p2.pdf"));
    expect(kept.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    const onePage = await realExtract(kept, { maxPages: 24, maxFigures: 12 });
    expect(onePage.figures.map((figure) => figure.page)).toEqual([1, 1]);
  });

  it("cuts another figure on that page from the page file alone — the paper is not opened again — and draws what the whole PDF would", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(1);
    mocks.extractPdfFigures.mockClear();

    const res = await call(UPLOAD_ID, "?page=2&fig=4");

    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    const [source, options] = mocks.extractPdfFigures.mock.calls[0];
    expect(source).toBeInstanceOf(Uint8Array);
    expect(Buffer.compare(Buffer.from(source), await readFile(path.join(FOLDER, "p2.pdf")))).toBe(0);
    expect(options).toMatchObject({ onlyPage: 1, maxPages: 1, maxFigures: 1, label: "Figure 4" });
    // The picture is the one the whole PDF gives, byte for byte.
    const png = await body(res);
    expect(pngInfo(new Uint8Array(png)).signature).toBe(true);
    expect(Buffer.compare(png, await drawnFromWhole(2, 4))).toBe(0);
    // And no second page file was made.
    expect(mocks.cutPdfPage).toHaveBeenCalledTimes(1);
  });

  it("recuts the same figure after a revision change from the page file — the paper is not opened — and the page file outlives the revision", async () => {
    await storeUpload(OWNER);
    const first = await body(await call(UPLOAD_ID, "?page=2&fig=3"));
    revision.value = "5";
    mocks.extractPdfFigures.mockClear();

    const recut = await body(await call(UPLOAD_ID, "?page=2&fig=3"));

    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures.mock.calls[0][1]).toMatchObject({ onlyPage: 1 });
    expect(Buffer.compare(recut, first)).toBe(0);
    expect(await pageFiles()).toEqual(["p2.pdf"]);
    expect(await cuts()).toHaveLength(2);
  });

  it("makes a page file for each page that is cut, and only those", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    await call(UPLOAD_ID, "?page=3&fig=5");
    expect(await pageFiles()).toEqual(["p2.pdf", "p3.pdf"]);
    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(2);
    expect(mocks.cutPdfPage).toHaveBeenCalledTimes(2);
  });

  it("falls back to the whole file for an upload with no page files, and makes the page file then", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    // The upload as it was before page files: the cut kept, the page file not there.
    await rm(path.join(FOLDER, "p2.pdf"));
    mocks.withUploadPdfSource.mockClear();
    mocks.cutPdfPage.mockClear();

    const res = await call(UPLOAD_ID, "?page=2&fig=4");

    expect(res.status).toBe(200);
    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(await body(res), await drawnFromWhole(2, 4))).toBe(0);
    expect(await pageFiles()).toEqual(["p2.pdf"]);
  });

  it.each([
    ["cut short", (whole: Buffer) => whole.subarray(0, whole.byteLength - 90)],
    ["an empty file", () => Buffer.alloc(0)],
    ["a file that is not a PDF", () => Buffer.from("these are invented words, not a PDF, but long enough to look like a file")],
    ["whole at both ends but unreadable in the middle", (whole: Buffer) => Buffer.concat([whole.subarray(0, 9), Buffer.alloc(whole.byteLength - 80, 0x41), whole.subarray(whole.byteLength - 71)])],
  ])("uses the whole file, and makes the page file again, when the page file is %s", async (_name, damage) => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    const target = path.join(FOLDER, "p2.pdf");
    const whole = await readFile(target);
    await writeFile(target, damage(whole));
    mocks.withUploadPdfSource.mockClear();

    const res = await call(UPLOAD_ID, "?page=2&fig=4");

    expect(res.status).toBe(200);
    expect(mocks.withUploadPdfSource).toHaveBeenCalledTimes(1);
    expect(Buffer.compare(await body(res), await drawnFromWhole(2, 4))).toBe(0);
    // Whole again.
    expect(Buffer.compare(await readFile(target), whole)).toBe(0);
  });

  it("answers 404 for a figure the page does not carry from the page file alone, naming the page asked for, and keeps nothing", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    mocks.withUploadPdfSource.mockClear();

    const res = await call(UPLOAD_ID, "?page=2&fig=9");

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
    const { error } = await res.json();
    expect(error).toContain("Figure 9");
    expect(error).toContain("page 2");
    expect(error).not.toContain("page 1");
    expect(mocks.withUploadPdfSource).not.toHaveBeenCalled();
    expect(await cuts()).toHaveLength(1);
  });

  it("makes no page file when the cut found nothing or failed", async () => {
    await storeUpload(OWNER);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    expect((await call(UPLOAD_ID, "?page=1&fig=5")).status).toBe(404);
    mocks.extractPdfFigures.mockRejectedValueOnce(new Error("no wasm"));
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(502);

    expect(mocks.cutPdfPage).not.toHaveBeenCalled();
    expect(await pageFiles()).toEqual([]);
  });

  it("answers the cut when the page file cannot be made — it was not cut, or could not be kept — and tries again the next time", async () => {
    await storeUpload(OWNER);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    mocks.cutPdfPage.mockResolvedValueOnce(null);
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(200);
    expect(await pageFiles()).toEqual([]);

    mocks.cutPdfPage.mockRejectedValueOnce(new Error("the engine fell over"));
    expect((await call(UPLOAD_ID, "?page=2&fig=4")).status).toBe(200);
    expect(await pageFiles()).toEqual([]);

    mocks.writeUploadPageFile.mockRejectedValueOnce(new Error("disk full"));
    expect((await call(UPLOAD_ID, "?page=3&fig=5")).status).toBe(200);
    expect(await pageFiles()).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(2);

    // Nothing is stuck: the next cut on page 2 makes it (a new revision, so that the kept picture is not the answer).
    revision.value = "5";
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(200);
    expect(await pageFiles()).toEqual(["p2.pdf"]);
  });

  it("looks a page file up only after the owner check, and never for a public paper", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    mocks.readUploadPageFile.mockClear();

    mocks.token.value = STRANGER;
    expect((await call(UPLOAD_ID, "?page=2&fig=4")).status).toBe(404);
    mocks.token.value = undefined;
    expect((await call(UPLOAD_ID, "?page=2&fig=4")).status).toBe(404);
    expect((await call(UPLOAD_ID, "?page=0&fig=4")).status).toBe(400);
    expect((await call(UPLOAD_ID, "?page=4&fig=4")).status).toBe(404);
    expect(mocks.readUploadPageFile).not.toHaveBeenCalled();

    mocks.fetchPaperById.mockResolvedValue({
      id: "arxiv:2610.00001",
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
    mocks.cutPdfPage.mockClear();
    mocks.writeUploadPageFile.mockClear();
    expect((await call("arxiv:2610.00001", "?page=2&fig=3")).status).toBe(200);
    expect(mocks.readUploadPageFile).not.toHaveBeenCalled();
    expect(mocks.writeUploadPageFile).not.toHaveBeenCalled();
    expect(mocks.cutPdfPage).not.toHaveBeenCalled();
  });

  it("is removed with the upload: after it is deleted, no page file is left", async () => {
    await storeUpload(OWNER);
    await call(UPLOAD_ID, "?page=2&fig=3");
    await call(UPLOAD_ID, "?page=3&fig=5");
    expect(await pageFiles()).toHaveLength(2);

    await deleteUpload((await readUploadMeta(HASH))!);

    expect(existsSync(FOLDER)).toBe(false);
  });
});
