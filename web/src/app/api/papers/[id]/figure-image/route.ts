// GET /api/papers/[id]/figure-image?page=N — a PDF page's embedded picture.
//
// The reading places a PDF's figures by the page their caption was read
// from, and where a page carries one figure it points here for the picture.
// This route finds the same PDF the reading was built from — the source link
// `getFullText` settled on, never a URL from the request — and returns the
// page's largest embedded raster as a PNG.
//
// What it cannot do: draw. A figure plotted as vector art has no raster to
// extract, and the deployed runtime has no canvas to render one with. Then
// this is a 404, and the page shows the caption alone, which is the truth.
//
// No model, no user data: public, like the reading route, and cached at the
// edge for a day.

import { NextResponse, type NextRequest } from "next/server";
import { fetchPaperById } from "@/lib/papers/fetch-by-id";
import { getFullText } from "@/lib/papers/full-text";
import { getPdfBytes } from "@/lib/papers/pdf-text";
import { rawItemToPaper } from "@/lib/feed/mapper";
import { encodePng } from "@/lib/figures/png";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CACHE_HEADERS = { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" };
const NO_STORE = { "Cache-Control": "no-store" };

/** A figure is at least this big; anything smaller is a logo or a bullet. */
const MIN_SIDE = 120;
/** And not a strip: a 40:1 banner is a rule, not a picture. */
const MAX_ASPECT = 6;
/** And not a poster: past this, encoding it is the request's whole budget. */
const MAX_PIXELS = 12_000_000;
const MAX_PAGE = 300;

function reject(status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: NO_STORE });
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const page = Number(req.nextUrl.searchParams.get("page"));
  if (!Number.isInteger(page) || page < 1 || page > MAX_PAGE) return reject(400, "page required");

  const raw = await fetchPaperById(decodeURIComponent(id));
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

  let images: Awaited<ReturnType<typeof import("unpdf").extractImages>>;
  try {
    const { extractImages } = await import("unpdf");
    images = await extractImages(new Uint8Array(pdf.bytes), page);
  } catch (err) {
    console.warn("[figure-image] extract failed:", err);
    return reject(502, "Could not read the page");
  }

  const candidates = images.filter((img) => {
    const aspect = img.width / img.height;
    return (
      img.width >= MIN_SIDE &&
      img.height >= MIN_SIDE &&
      aspect <= MAX_ASPECT &&
      aspect >= 1 / MAX_ASPECT &&
      img.width * img.height <= MAX_PIXELS &&
      (img.channels === 1 || img.channels === 3 || img.channels === 4)
    );
  });
  if (candidates.length === 0) return reject(404, "No picture on this page");

  const best = candidates.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const png = encodePng({ data: best.data, width: best.width, height: best.height, channels: best.channels });
  return new NextResponse(Buffer.from(png), {
    headers: { ...CACHE_HEADERS, "Content-Type": "image/png", "Content-Length": String(png.length) },
  });
}
