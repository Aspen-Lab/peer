// P9-29 (BACKLOG-01, ruling §1h.59, the owner's decision §1a.18 (a)) — GET
// /api/papers/[id]/figure-image?page=N&fig=K answers the picture of "Figure K"
// on page N of a paper's PDF: for a public paper, and for an upload to its
// owner only. The real chain runs in-process: the upload store on a temp
// directory, the real owner check (`upload-access`) with only the request's
// cookie jar stubbed, and the real figure engine (MuPDF's WASM build) on
// invented PDFs. Only the public paper's lookup, its full text and its PDF
// download are stubbed — those are the network.
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { barChart, bodyText, figurePdf, panel, pngInfo, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-figure-image-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const mocks = vi.hoisted(() => ({
  token: { value: undefined as string | undefined },
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
  getPdfBytes: vi.fn(),
  extractPdfFigures: vi.fn(),
  withUploadPdfSource: vi.fn(),
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
// The engine and the upload store's reader of the stored PDF are the real ones, watched.
vi.mock("@/lib/figures/pdf-engine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/figures/pdf-engine")>();
  mocks.extractPdfFigures.mockImplementation(actual.extractPdfFigures);
  return { ...actual, extractPdfFigures: mocks.extractPdfFigures };
});
vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  mocks.withUploadPdfSource.mockImplementation(actual.withUploadPdfSource);
  return { ...actual, withUploadPdfSource: mocks.withUploadPdfSource };
});

import { GET } from "./route";
import { sha16, writeUploadMeta, writeUploadPdfIfAbsent, type UploadMeta } from "@/lib/papers/upload-store";
import { uploadOwner } from "@/lib/papers/upload-access";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

// ── The invented PDF: page 1 prose, page 2 two panels of different sizes
// (Figures 3 and 4, so which region came back shows in the PNG's width), page 3
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

function call(id: string, search: string): Promise<Response> {
  const encoded = encodeURIComponent(id);
  return GET(new NextRequest(`http://localhost/api/papers/${encoded}/figure-image${search}`), {
    params: Promise.resolve({ id: encoded }),
  });
}

function publicPaper(): void {
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

async function widthOf(res: Response): Promise<number> {
  const info = pngInfo(new Uint8Array(await res.arrayBuffer()));
  expect(info.signature).toBe(true);
  return info.width;
}

beforeEach(async () => {
  // P12-61: an upload's first cut is kept beside it, and the upload here is the same bytes in every
  // test — so each test starts with nothing kept, and a test that expects the engine to run does run it.
  await rm(join(uploadDir, "figure-cuts"), { recursive: true, force: true });
  mocks.fetchPaperById.mockReset();
  mocks.getFullText.mockReset();
  mocks.getPdfBytes.mockReset();
  mocks.extractPdfFigures.mockClear();
  mocks.withUploadPdfSource.mockClear();
  mocks.token.value = undefined;
  publicPaper();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("GET /api/papers/[id]/figure-image — the parameters", () => {
  it.each([
    ["no page", "?fig=3"],
    ["page 0", "?page=0&fig=3"],
    ["a page past the 300 the route reads", "?page=301&fig=3"],
    ["a page that is not a whole number", "?page=2.5&fig=3"],
    ["a page that is not a number", "?page=abc&fig=3"],
    ["no figure number", "?page=2"],
    ["figure 0", "?page=2&fig=0"],
    ["a figure that is not a whole number", "?page=2&fig=3.5"],
    ["a figure label, not its number", "?page=2&fig=Figure%203"],
    ["a figure with a letter after it", "?page=2&fig=3a"],
    ["an exponent for a number", "?page=2&fig=1e1"],
  ])("answers 400 for %s, before any lookup or any reading of a PDF", async (_name, search) => {
    const res = await call(PUBLIC_ID, search);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers 400 to an upload id with a bad page too, privately, without reading the store", async () => {
    await storeUpload(OWNER);
    const res = await call(UPLOAD_ID, "?page=0&fig=3");
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(mocks.withUploadPdfSource).not.toHaveBeenCalled();
  });
});

describe("GET /api/papers/[id]/figure-image — a public paper", () => {
  it("answers the PNG of the figure with the public edge cache and says which engine drew it", async () => {
    const res = await call(PUBLIC_ID, "?page=2&fig=3");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_CACHE);
    expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
    expect(res.headers.get("Vary")).toBeNull();
    const bytes = new Uint8Array(await res.arrayBuffer());
    expect(res.headers.get("Content-Length")).toBe(String(bytes.length));
    // The bytes are the picture, never a `data:` URL in a PNG's clothes.
    expect(pngInfo(bytes).signature).toBe(true);
  });

  it("selects the region whose caption opens with the number, not the first or the largest, on a page with two captions", async () => {
    const wide = await widthOf(await call(PUBLIC_ID, "?page=2&fig=3"));
    const narrow = await widthOf(await call(PUBLIC_ID, "?page=2&fig=4"));
    expect(wide).toBeGreaterThan(WIDE - 4);
    expect(wide).toBeLessThan(WIDE + 4);
    expect(narrow).toBeGreaterThan(NARROW - 4);
    expect(narrow).toBeLessThan(NARROW + 4);
  });

  it("asks the engine for that page and that label only, and for one figure", async () => {
    await call(PUBLIC_ID, "?page=2&fig=4");
    expect(mocks.extractPdfFigures).toHaveBeenCalledTimes(1);
    expect(mocks.extractPdfFigures).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      expect.objectContaining({ onlyPage: 2, label: "Figure 4", maxFigures: 1 }),
    );
  });

  it("answers 404 for a figure that is not on that page, though it is on another", async () => {
    // Figure 5 is on page 3; asked for on page 1 it is not there.
    const res = await call(PUBLIC_ID, "?page=1&fig=5");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect((await res.json()).error).toContain("Figure 5");
    const onItsPage = await call(PUBLIC_ID, "?page=3&fig=5");
    expect(onItsPage.status).toBe(200);
  });

  it("answers 404 for a figure number the page does not carry, and for a page with no figure at all", async () => {
    expect((await call(PUBLIC_ID, "?page=2&fig=9")).status).toBe(404);
    expect((await call(PUBLIC_ID, "?page=1&fig=1")).status).toBe(404);
  });

  it("answers 404 for a paper that is not found, before reading anything", async () => {
    mocks.fetchPaperById.mockResolvedValue(null);
    const res = await call("arxiv:0000.00000", "?page=2&fig=3");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers 404 when no PDF stands behind the reading, and when the page is past the document", async () => {
    mocks.getFullText.mockResolvedValueOnce({ status: "ok", doc: { source: "html", sections: [], figureCaptions: [] }, sourceLink: { url: "https://x/y", kind: "html", label: "x", rank: 1 }, attempts: [] });
    expect((await call(PUBLIC_ID, "?page=2&fig=3")).status).toBe(404);
    expect((await call(PUBLIC_ID, "?page=4&fig=3")).status).toBe(404);
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers 502 when the PDF cannot be fetched, and when the engine will not load", async () => {
    mocks.getPdfBytes.mockResolvedValueOnce({ error: "download failed" });
    expect((await call(PUBLIC_ID, "?page=2&fig=3")).status).toBe(502);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.extractPdfFigures.mockRejectedValueOnce(new Error("no wasm"));
    const res = await call(PUBLIC_ID, "?page=2&fig=3");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("GET /api/papers/[id]/figure-image — an upload", () => {
  it("answers its owner the PNG of the figure, privately, and never looks the id up as a public paper", async () => {
    await storeUpload(OWNER);
    mocks.token.value = OWNER;

    const res = await call(UPLOAD_ID, "?page=2&fig=4");

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
    const width = await widthOf(res);
    expect(width).toBeGreaterThan(NARROW - 4);
    expect(width).toBeLessThan(NARROW + 4);
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.getPdfBytes).not.toHaveBeenCalled();
    // P12-61 (part 3), re-aimed: an upload's PDF reaches the engine as a file to read from, not as bytes in memory.
    expect(mocks.extractPdfFigures).toHaveBeenCalledWith(
      expect.objectContaining({ filePath: expect.any(String) }),
      expect.objectContaining({ onlyPage: 2, label: "Figure 4" }),
    );
  });

  it("selects the figure by its caption's number for an upload too", async () => {
    await storeUpload(OWNER);
    const wide = await call(UPLOAD_ID, "?page=2&fig=3");
    const narrow = await call(UPLOAD_ID, "?page=2&fig=4");
    expect(wide.status).toBe(200);
    expect(narrow.status).toBe(200);
    expect(await widthOf(wide)).toBeGreaterThan(WIDE - 4);
    expect(await widthOf(narrow)).toBeLessThan(NARROW + 4);
  });

  it("answers another reader's upload 404, privately, and reads neither its bytes nor its pages", async () => {
    await storeUpload(OWNER);
    mocks.token.value = STRANGER;

    const res = await call(UPLOAD_ID, "?page=2&fig=3");

    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(res.headers.get("Content-Type")).not.toBe("image/png");
    expect(res.headers.get("X-Peer-Figure-Engine")).toBeNull();
    expect(mocks.withUploadPdfSource).not.toHaveBeenCalled();
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
  });

  it("answers a browser with no capability cookie 404, privately", async () => {
    await storeUpload(OWNER);
    mocks.token.value = undefined;
    const res = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it.each(["UPLOAD:", "Upload:", " upload:"])("answers a malformed claim (%s<hash16>) 404, privately, never as a public id", async (prefix) => {
    await storeUpload(OWNER);
    mocks.token.value = OWNER;
    const res = await call(`${prefix}${HASH}`, "?page=2&fig=3");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers 404 for an upload that has expired or been taken down, even to its owner", async () => {
    await storeUpload(OWNER, { expiresAt: new Date(Date.now() - 1000).toISOString() });
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);
    await storeUpload(OWNER, { status: "blocked" });
    expect((await call(UPLOAD_ID, "?page=2&fig=3")).status).toBe(404);
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers 404, privately, when the figure is not on that page or the page is past the document", async () => {
    await storeUpload(OWNER);
    const notThere = await call(UPLOAD_ID, "?page=1&fig=5");
    expect(notThere.status).toBe(404);
    expect(notThere.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    const past = await call(UPLOAD_ID, "?page=4&fig=3");
    expect(past.status).toBe(404);
    expect(past.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
  });

  it("answers 404, privately, when the stored bytes are gone", async () => {
    await storeUpload(OWNER);
    mocks.withUploadPdfSource.mockResolvedValueOnce(null);
    const res = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
  });

  it("answers 502, privately, when the engine will not load", async () => {
    await storeUpload(OWNER);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.extractPdfFigures.mockRejectedValueOnce(new Error("no wasm"));
    const res = await call(UPLOAD_ID, "?page=2&fig=3");
    expect(res.status).toBe(502);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
  });
});

// ── P12-56 (R14a, ruling §1h.433): `fig=ed3` is "Extended Data Fig. 3", its own numbering ─────────────────────
//
// An invented PDF that prints "Fig. 3" and "Extended Data Fig. 3" on one page (two panels of different widths, so
// which region came back shows in the PNG's width), and "Supplementary Fig. 3" alone on the next.

const EXTENDED_PAGES: FigurePage[] = [
  {
    text: [
      ["Fig. 3 | The wide panel of a two-figure page.", 100, 262, 9],
      ["Extended Data Fig. 3 | The narrow panel of a two-figure page.", 100, 492, 9],
    ],
    shapes: [...panel(100, 80, 370, 160), ...panel(100, 330, 250, 140)],
  },
  { text: [["Supplementary Fig. 3 | A panel that belongs to the other file.", 100, 262, 9]], shapes: panel(100, 80, 300, 160) },
];
const EXTENDED_PDF = figurePdf(EXTENDED_PAGES);

function publicExtendedPaper(): void {
  publicPaper();
  mocks.getFullText.mockResolvedValue({
    status: "ok",
    doc: { source: "pdf", pageCount: 2, sections: [], figureCaptions: [] },
    sourceLink: { url: "https://arxiv.org/pdf/2610.00001", kind: "pdf", label: "arxiv", rank: 1 },
    attempts: [],
  });
  mocks.getPdfBytes.mockResolvedValue({ bytes: Buffer.from(EXTENDED_PDF) });
}

describe("GET /api/papers/[id]/figure-image — fig=ed<N> is an Extended Data figure (P12-56, R14a)", () => {
  it("answers the Extended Data panel for ed3 and the main panel for 3, on one page, each its own", async () => {
    publicExtendedPaper();
    const main = await widthOf(await call(PUBLIC_ID, "?page=1&fig=3"));
    const extended = await widthOf(await call(PUBLIC_ID, "?page=1&fig=ed3"));
    expect(main).toBeGreaterThan(WIDE - 4);
    expect(main).toBeLessThan(WIDE + 4);
    expect(extended).toBeGreaterThan(NARROW - 4);
    expect(extended).toBeLessThan(NARROW + 4);
  });

  it("asks the engine for the label 'Extended Data Fig. 3', and for 'Figure 3' for the number", async () => {
    publicExtendedPaper();
    await call(PUBLIC_ID, "?page=1&fig=ed3");
    await call(PUBLIC_ID, "?page=1&fig=3");
    expect(mocks.extractPdfFigures).toHaveBeenNthCalledWith(1, expect.any(Uint8Array), expect.objectContaining({ onlyPage: 1, label: "Extended Data Fig. 3", maxFigures: 1 }));
    expect(mocks.extractPdfFigures).toHaveBeenNthCalledWith(2, expect.any(Uint8Array), expect.objectContaining({ onlyPage: 1, label: "Figure 3", maxFigures: 1 }));
  });

  it("keeps the public edge cache and the engine header on an Extended Data picture", async () => {
    publicExtendedPaper();
    const res = await call(PUBLIC_ID, "?page=1&fig=ed3");
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe(PUBLIC_CACHE);
    expect(res.headers.get("X-Peer-Figure-Engine")).toBe("mupdf");
  });

  it("(a) a supplementary figure is not on the PDF: ed3 and 3 find nothing on the page that prints 'Supplementary Fig. 3', and 'S3' is refused", async () => {
    publicExtendedPaper();
    const asNumber = await call(PUBLIC_ID, "?page=2&fig=3");
    expect(asNumber.status).toBe(404);
    expect((await call(PUBLIC_ID, "?page=2&fig=ed3")).status).toBe(404);
    expect((await call(PUBLIC_ID, "?page=1&fig=ed4")).status).toBe(404);
    for (const fig of ["S3", "s3", "Supplementary%203", "edS3", "eds3"]) {
      const res = await call(PUBLIC_ID, `?page=2&fig=${fig}`);
      expect(res.status, fig).toBe(400);
    }
  });

  it.each([
    ["ed alone", "ed"],
    ["ed and zero", "ed0"],
    ["ed and a leading zero", "ed03"],
    ["ed and four digits", "ed1000"],
    ["capitals", "ED3"],
    ["Ed", "Ed3"],
    ["a letter after the digit", "ed3a"],
    ["a space", "ed%203"],
    ["a sign", "ed-3"],
    ["a decimal", "ed3.5"],
    ["the label spelled out", "Extended%20Data%20Fig.%203"],
    ["two prefixes", "eded3"],
    ["a prefix other than ed", "xd3"],
    ["an exponent", "ed1e1"],
  ])("answers 400 for %s, before any lookup or any reading of a PDF", async (_name, fig) => {
    const res = await call(PUBLIC_ID, `?page=1&fig=${fig}`);
    expect(res.status).toBe(400);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(mocks.fetchPaperById).not.toHaveBeenCalled();
    expect(mocks.extractPdfFigures).not.toHaveBeenCalled();
  });

  it("answers an upload's owner the Extended Data picture, privately, and a stranger 404", async () => {
    const hash = sha16(EXTENDED_PDF);
    mocks.token.value = OWNER;
    const ownerKey = await uploadOwner();
    await writeUploadPdfIfAbsent(hash, Buffer.from(EXTENDED_PDF));
    await writeUploadMeta(hash, {
      hash16: hash,
      fileName: "paper.pdf",
      title: "An invented upload",
      pageCount: 2,
      uploadedAt: new Date().toISOString(),
      textStatus: "ok",
      ownerKey: ownerKey ?? undefined,
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      status: "ready",
      revision: 1,
    });
    const res = await call(`upload:${hash}`, "?page=1&fig=ed3");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
    const width = await widthOf(res);
    expect(width).toBeGreaterThan(NARROW - 4);
    expect(width).toBeLessThan(NARROW + 4);
    mocks.token.value = STRANGER;
    const stranger = await call(`upload:${hash}`, "?page=1&fig=ed3");
    expect(stranger.status).toBe(404);
    expect(stranger.headers.get("Cache-Control")).toBe(PRIVATE_CACHE);
  });
});
