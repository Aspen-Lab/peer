// P9-53, rule 3 — the picture the route draws for a bound section is the picture
// the pool would have put in the report. The real chain, in-process, on an
// invented PDF: the real figure engine (MuPDF's WASM build) makes the pool's
// candidates exactly as `getFigurePool` does for a PDF (`extractPdfCandidatesFromBytes`,
// the whole document, `data:` URLs), `bindFiguresToReport` binds a report to
// them with the paper's id, and the real figure-image route is asked for each
// URL the report now carries. Only the public paper's lookup, its full text and
// its PDF download are stubbed — those are the network.
//
// The PDF has one page of prose and one page with two panels of different
// widths, captioned Figure 3 (wide) and Figure 4 (narrow), so which region the
// route drew shows in the PNG's width as well as in its bytes.
import { rm } from "node:fs/promises";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { bodyText, figurePdf, panel, pngInfo, type FigurePage } from "@/lib/figures/figure-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-same-figure-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const mocks = vi.hoisted(() => ({
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
  getPdfBytes: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => undefined }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/papers/fetch-by-id", () => ({ fetchPaperById: mocks.fetchPaperById }));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));
vi.mock("@/lib/papers/pdf-text", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/papers/pdf-text")>()),
  getPdfBytes: mocks.getPdfBytes,
}));

import { GET } from "@/app/api/papers/[id]/figure-image/route";
import { extractPdfCandidatesFromBytes } from "@/lib/figures/pdf-extract";
import type { FigurePool } from "@/lib/figures/extract";
import type { PaperReport } from "./report";
import type { ExtractedFigureCaption } from "./html-text";
import { bindFiguresToReport } from "./figure-binding";
import { FIGURE_EXTRACTION_REVISION } from "@/lib/figures/figure-revision";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

const prose = bodyText(["Synthetic body text, one line.", "Synthetic body text, a second line."], 80);
const PAGES: FigurePage[] = [
  { text: prose },
  {
    text: [
      ["Figure 3. Wide panel: soil water against depth under three layers.", 100, 262, 9],
      ["Figure 4. Narrow panel: runoff loss after the storm by terrace.", 100, 492, 9],
    ],
    shapes: [...panel(100, 80, 370, 160), ...panel(100, 330, 250, 140)],
  },
];
const PDF = figurePdf(PAGES);
// 2.8x of the panel's width plus the 10 pt padding either side (as the route's own test measures).
const WIDE = (370 + 20) * 2.8;
const NARROW = (250 + 20) * 2.8;

const PAPER_ID = "arxiv:2610.00001";

/** The captions the text layer gives this PDF: the label, the words after it, and the page. */
const CAPTIONS: ExtractedFigureCaption[] = [
  { ordinal: 0, label: "Figure 3", caption: "Wide panel: soil water against depth under three layers.", page: 2, at: 0.75 },
  { ordinal: 1, label: "Figure 4", caption: "Narrow panel: runoff loss after the storm by terrace.", page: 2, at: 0.75 },
];

const report = (): PaperReport => ({
  skim: [],
  whatItProposes: { summary: "As Figure 4 shows, the runoff differs from terrace to terrace.", methods: [] },
  resultsAndSignificance: {
    summary: "",
    keyResults: [{ title: "Deeper layers held water", detail: "The index rose with depth.", evidence: "The index rose with depth, as Figure 3 plots." }],
  },
  provenance: { basis: "model-fulltext", droppedClaims: 0 },
});

/** The pool `getFigurePool` makes of a PDF's candidates (same field mapping, no network). */
let pool: FigurePool;

beforeAll(async () => {
  const extracted = await extractPdfCandidatesFromBytes(new Uint8Array(PDF), "open-access");
  expect(extracted.status).toBe("candidates");
  pool = {
    attempted: true,
    entries: extracted.candidates.map((c) => ({
      imageUrl: c.imageUrl,
      caption: c.caption ?? null,
      source: c.source,
      ordinal: c.ordinal,
      qualityHint: c.qualityHint,
    })),
  };
});

beforeEach(() => {
  mocks.fetchPaperById.mockReset();
  mocks.getFullText.mockReset();
  mocks.getPdfBytes.mockReset();
  mocks.fetchPaperById.mockResolvedValue({
    id: PAPER_ID,
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
    doc: { source: "pdf", pageCount: 2, sections: [], figureCaptions: [] },
    sourceLink: { url: "https://arxiv.org/pdf/2610.00001", kind: "pdf", label: "arxiv", rank: 1 },
    attempts: [],
  });
  mocks.getPdfBytes.mockResolvedValue({ bytes: Buffer.from(PDF) });
});

/** The binder's call: with the paper's id (what the report route passes now) or without (what it passed until now). */
function bind(id?: string): Promise<PaperReport> {
  return bindFiguresToReport({
    paper: { title: "A paper with figures", ...(id !== undefined ? { id } : {}) },
    report: report(),
    captions: CAPTIONS,
    provider: null,
    figurePool: pool,
  });
}

/** Asks the figure-image route for a report's URL, the way the browser does. */
async function fetchRoute(url: string): Promise<Response> {
  const segment = /^\/api\/papers\/([^/]+)\/figure-image/.exec(url)?.[1];
  if (!segment) throw new Error(`not a figure-image URL: ${url.slice(0, 80)}`);
  return GET(new NextRequest(`http://localhost${url}`), { params: Promise.resolve({ id: segment }) });
}

/** The PNG bytes inside a `data:image/png;base64,…` URL. */
function pngOfDataUrl(url: string): Buffer {
  return Buffer.from(url.slice(url.indexOf(",") + 1), "base64");
}

describe("the route draws the figure the pool had", () => {
  it("premise: the pool holds both panels, as PNGs of different widths, each opening its own caption", () => {
    expect(pool.entries).toHaveLength(2);
    const byFigure = (n: number) => pool.entries.find((e) => new RegExp(`^Figure ${n}\\b`).test(e.caption ?? ""));
    expect(pngInfo(pngOfDataUrl(byFigure(3)?.imageUrl ?? "")).width).toBe(WIDE);
    expect(pngInfo(pngOfDataUrl(byFigure(4)?.imageUrl ?? "")).width).toBe(NARROW);
  });

  it("answers 200 image/png for each bound section's URL, and each is the figure its caption names", async () => {
    const bound = await bind(PAPER_ID);
    const proposal = bound.whatItProposes.figureImageUrl ?? "";
    const result = bound.resultsAndSignificance.keyResults[0].figureImageUrl ?? "";

    expect(bound.whatItProposes.figureLabel).toBe("Figure 4");
    expect(bound.resultsAndSignificance.keyResults[0].figureLabel).toBe("Figure 3");
    expect(proposal).toBe("/api/papers/arxiv%3A2610.00001/figure-image?page=2&fig=4&v=" + FIGURE_EXTRACTION_REVISION + "");
    expect(result).toBe("/api/papers/arxiv%3A2610.00001/figure-image?page=2&fig=3&v=" + FIGURE_EXTRACTION_REVISION + "");

    const narrow = await fetchRoute(proposal);
    const wide = await fetchRoute(result);
    expect(narrow.status).toBe(200);
    expect(wide.status).toBe(200);
    expect(narrow.headers.get("Content-Type")).toBe("image/png");
    expect(wide.headers.get("Content-Type")).toBe("image/png");
    expect(pngInfo(new Uint8Array(await narrow.arrayBuffer())).width).toBe(NARROW);
    expect(pngInfo(new Uint8Array(await wide.arrayBuffer())).width).toBe(WIDE);
  });

  it("answers, byte for byte, the PNG the pool's pick for the same caption held", async () => {
    const bound = await bind(PAPER_ID);
    // What the report held until now: the pool's `data:` URL for each section.
    const before = await bind();

    for (const [after, held] of [
      [bound.whatItProposes.figureImageUrl, before.whatItProposes.figureImageUrl],
      [bound.resultsAndSignificance.keyResults[0].figureImageUrl, before.resultsAndSignificance.keyResults[0].figureImageUrl],
    ] as const) {
      expect(held?.startsWith("data:image/png;base64,")).toBe(true);
      const drawn = Buffer.from(await (await fetchRoute(after ?? "")).arrayBuffer());
      expect(drawn.equals(pngOfDataUrl(held ?? ""))).toBe(true);
    }
  });

  it("carries the report in a few KB where it carried two PNGs", async () => {
    const bound = await bind(PAPER_ID);
    const before = await bind();

    // Each of the two sections held its own PNG by value.
    expect(JSON.stringify(before).length).toBeGreaterThanOrEqual(pool.entries[0].imageUrl.length + pool.entries[1].imageUrl.length);
    expect(JSON.stringify(bound)).not.toContain("data:");
    expect(JSON.stringify(bound).length).toBeLessThan(4_000);
  });
});
