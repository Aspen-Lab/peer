// GET /api/papers/[id]/figure-image?page=N&fig=K — the picture of "Figure K"
// on page N of a paper's PDF. `fig=ed3` (P12-56, R14a) is "Extended Data Fig. 3": the
// letters `ed` and plain digits, nothing else; "Supplementary Fig. 3" and "Fig. S3" are
// another file's figures and are refused like any other token.
//
// The reading places each figure by the page its caption was read from and
// the number in its label, and points here for the picture. This route finds
// the PDF the reading was built from — for a public paper, the source link
// `getFullText` settled on; for an upload, the stored file — never a URL from
// the request, and has the figure engine (`lib/figures/pdf-engine.ts`, MuPDF's
// WASM build) draw the one region whose caption opens "Figure K" on page N.
// A raster, or a vector figure drawn as paths: the engine renders either.
//
// P9-29 (BACKLOG-01, §1h.59): an upload's figures have pictures. The route
// used to answer 404 to an `upload:` id, and to return "the largest raster on
// the page" for any other, so the reading offered a picture only on a page
// with exactly one caption. Now an `upload:` id is answered to its owner only
// (the same capability-cookie check as `/api/figure`) with `private, no-store`;
// a public paper's answer keeps its day-long edge cache. The label, not the
// page's biggest picture, says which figure; a figure the page does not carry
// is a 404, and the page shows the caption alone, which is the truth.
//
// No model, no key. The body is the PNG's bytes, never a `data:` URL.

import { NextResponse, type NextRequest } from "next/server";
import { fetchPaperById } from "@/lib/papers/fetch-by-id";
import { getFullText } from "@/lib/papers/full-text";
import { getPdfBytes } from "@/lib/papers/pdf-text";
import { rawItemToPaper } from "@/lib/feed/mapper";
import { extractPdfFigures } from "@/lib/figures/pdf-engine";
import { bareUploadId, claimsUploadId, readUploadPdf } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };
const NO_STORE = { "Cache-Control": "no-store" };
/** Every answer that ran the engine says which engine it was (as `/api/figure` does). */
const FIGURE_ENGINE = { "X-Peer-Figure-Engine": "mupdf" };

/** The reading cuts a PDF at 24 pages; the route accepts a few more. */
const MAX_PAGE = 300;
/** "Figure 1" … "Figure 999": the number a caption's label carries. */
const MAX_FIGURE = 999;

/** A whole number from 1 to `max` written in plain digits, or null. */
function wholeNumber(raw: string | null, max: number): number | null {
  if (raw === null || !/^[1-9]\d{0,2}$/.test(raw)) return null;
  const value = Number(raw);
  return value <= max ? value : null;
}

/** The label the engine looks for, for a `fig` value: "Figure 3" for `3`, "Extended Data Fig. 3" for `ed3`
 *  (R14a), or null for anything else. The `ed` is lower case and the digits are plain, as a number's are. */
function figureLabel(raw: string | null): string | null {
  const extended = raw !== null && raw.startsWith("ed");
  const n = wholeNumber(extended ? raw.slice(2) : raw, MAX_FIGURE);
  if (n === null) return null;
  return extended ? `Extended Data Fig. ${n}` : `Figure ${n}`;
}

function reject(status: number, error: string, headers: Record<string, string> = NO_STORE) {
  return NextResponse.json({ error }, { status, headers });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const paperId = decodeURIComponent(id);
  // An upload's answers, errors included, are never cached on the way.
  const privately = claimsUploadId(paperId);
  const refusal = privately ? PRIVATE_UPLOAD_HEADERS : NO_STORE;

  const page = wholeNumber(req.nextUrl.searchParams.get("page"), MAX_PAGE);
  if (page === null) return reject(400, "page required", refusal);
  const label = figureLabel(req.nextUrl.searchParams.get("fig"));
  if (label === null) return reject(400, "fig required", refusal);

  let bytes: Uint8Array;
  if (privately) {
    // P0-05 / P0-08: only the canonical `upload:<hash16>` is an upload id, and
    // only its owner is answered. A spelling that merely claims to be one is
    // not found — never looked up as an upload, never as a public paper.
    const hash16 = bareUploadId(paperId);
    const meta = hash16 ? await ownedUpload(hash16) : null;
    if (!hash16 || !meta) return reject(404, "Upload not found.", refusal);
    if (meta.pageCount && page > meta.pageCount) return reject(404, "No such page", refusal);
    const stored = await readUploadPdf(hash16);
    if (!stored) return reject(404, "Upload not found.", refusal);
    bytes = new Uint8Array(stored);
  } else {
    const raw = await fetchPaperById(paperId);
    if (!raw) return reject(404, "Paper not found");
    const paper = rawItemToPaper(raw);

    // The same resolution the reading route runs, so the same PDF answers —
    // and served from the hour-long cache when the reading was just built.
    const fullText = await getFullText({
      paperId: paper.id,
      url: paper.linkPaper ?? paper.linkArxiv ?? null,
      doi: paper.doi ?? null,
      arxivId: paper.id.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : null,
      openAlexId: paper.id.startsWith("openalex:") ? paper.id.slice("openalex:".length) : null,
    });
    const link = fullText.status === "ok" ? fullText.sourceLink : undefined;
    if (!link || link.kind !== "pdf") return reject(404, "No PDF behind this reading");
    if (fullText.doc?.pageCount && page > fullText.doc.pageCount) return reject(404, "No such page");

    const pdf = await getPdfBytes(link.url);
    if ("error" in pdf) return reject(502, pdf.error);
    bytes = new Uint8Array(pdf.bytes);
  }

  // From here the engine runs, and every answer says so.
  const engineRan = { ...refusal, ...FIGURE_ENGINE };
  let extracted: Awaited<ReturnType<typeof extractPdfFigures>>;
  try {
    extracted = await extractPdfFigures(bytes, {
      maxPages: MAX_PAGE,
      maxFigures: 1,
      onlyPage: page,
      label,
    });
  } catch (err) {
    console.warn("[figure-image] extract failed:", err);
    return reject(502, "Could not read the page", engineRan);
  }

  const found = extracted.figures[0];
  if (!found || found.png.byteLength === 0) {
    return reject(404, extracted.reason ?? `No ${label} on page ${page}`, engineRan);
  }

  return new NextResponse(Buffer.from(found.png), {
    headers: {
      ...(privately ? PRIVATE_UPLOAD_HEADERS : CACHE_HEADERS),
      ...FIGURE_ENGINE,
      "Content-Type": "image/png",
      "Content-Length": String(found.png.byteLength),
    },
  });
}
