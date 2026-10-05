// GET /api/figure?id=<itemId>&url=<originUrl>
// POST /api/figure  { id, url, doi, query, paperTitle, idx, rev, v }
//   (an upload's figure, or a figure of a paper with a private attachment)
//
// Lazy figure resolver — hit per-card after feed loads. CDN-cached for
// 24h so the same paper id only triggers an upstream fetch at most once
// per user-day across all readers.
//
// P0-10 (§1e.10, A's F7): an uploaded PDF's figure request never carries
// private text in a URL. The page used to send the PDF's own title
// (`paperTitle`) and Peer's words about it (`query`) as GET parameters, and
// the request log printed them. An upload's request is a POST now; its
// title comes from the owner-checked record, never from the client; and a
// GET for an upload that still carries either is refused before any work.
// P0-11 (§1e.11): a public paper with a private PDF attached posts too — its
// `query` is text from the deep report on that PDF — and every POST answer
// is `private, no-store`. A public paper with no attachment keeps its GET
// and the day-long edge cache unchanged.

import { NextResponse, type NextRequest } from "next/server";
import { extractFigure } from "@/lib/figures/extract";
import { requireEntitledAiRequest } from "@/lib/security/ai-request";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

export const dynamic = "force-dynamic";
export const revalidate = 86_400;
export const runtime = "nodejs";

interface FigureRequest {
  id: string;
  url?: string;
  doi?: string;
  query?: string;
  /** Public papers only; an upload's title is read from its record. */
  paperTitle?: string;
  figureIndex: number;
}

function figureIndexOf(value: unknown): number {
  if (value === null || value === undefined) return 0;
  return Math.max(0, parseInt(String(value), 10) || 0);
}

/** One implementation for both methods. `privately` marks an answer that
 *  must never be cached on the way: an upload's, and every POST's. */
async function answer(input: FigureRequest, { privately = false } = {}): Promise<Response> {
  // P0-08 (§1e.8): any spelling of the prefix is a claim; only the canonical
  // id of an upload the caller owns gets past it.
  const privateUpload = claimsUploadId(input.id);
  let paperTitle = input.paperTitle;
  if (privateUpload) {
    const hash = bareUploadId(input.id);
    const meta = hash ? await ownedUpload(hash) : null;
    if (!meta) return NextResponse.json({ error: "Upload not found." }, { status: 404, headers: PRIVATE_UPLOAD_HEADERS });
    // P0-10: the owner's own record, not anything the client sent.
    paperTitle = meta.title?.trim() || undefined;
  }

  // ABC-freemium 1-07 · R-SEC-1 — **this route had no authentication of any
  // kind.** It reaches a provider through `extractFigure` -> `chooseCandidate`
  // -> the semantic and vision matchers, which were the only two no-argument
  // `resolveProvider()` calls in the tree. D8 says a route that can reach a
  // provider requires a signed-in user in deployed runtimes.
  //
  // 60/h matches the feed scopes: this is hit once per card, so a lower limit
  // would break an ordinary page of results.
  const gate = await requireEntitledAiRequest("figure", 60);
  if (gate instanceof NextResponse) return gate;

  const result = await extractFigure({
    itemId: input.id,
    url: input.url,
    doi: input.doi,
    query: input.query,
    paperTitle,
    figureIndex: input.figureIndex,
    // No BYOK override reaches this route — figures are requested by the card,
    // which carries no key — so `byok` is false and the matchers fall to the
    // system provider or to null.
    // ABC-freemium 3-02 — the entitlement itself, not a copy of its user id:
    // holding one is the proof a check ran.
    ctx: { entitlement: gate.entitlement, byok: false },
  });
  const isPrivate = privateUpload || privately;
  const cacheControl = isPrivate ? "private, no-store" : result.imageUrl
    ? "public, s-maxage=86400, stale-while-revalidate=604800"
    : "no-store";

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": cacheControl,
      ...(isPrivate ? PRIVATE_UPLOAD_HEADERS : {}),
    },
  });
}

export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const id = params.get("id");
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  // P0-10: an upload's report words and title never travel in a URL. A GET
  // that carries them for an upload is a client regression; refuse it before
  // the owner check, the gate or any fetch, so it fails where it can be seen.
  if (claimsUploadId(id) && (params.has("query") || params.has("paperTitle"))) {
    return NextResponse.json(
      { error: "An upload's figure request is a POST." },
      { status: 400, headers: PRIVATE_UPLOAD_HEADERS },
    );
  }
  // P0-12 (§1e.12): the same for a paper with a private attachment — the
  // only kind that carries `rev`, and which posts since P0-11. A GET with a
  // revision plus report text or a title is a client regression; refuse it
  // before the gate or any fetch.
  if (params.has("rev") && (params.has("query") || params.has("paperTitle"))) {
    return NextResponse.json(
      { error: "A paper with a private attachment asks for figures by POST." },
      { status: 400, headers: PRIVATE_UPLOAD_HEADERS },
    );
  }
  return answer({
    id,
    url: params.get("url") ?? undefined,
    doi: params.get("doi") ?? undefined,
    query: params.get("query") ?? undefined,
    paperTitle: params.get("paperTitle") ?? undefined,
    figureIndex: figureIndexOf(params.get("idx")),
  });
}

/** The same request in a JSON body: `{ id, url, doi, query, paperTitle,
 *  idx, rev, v }` — for an upload (P0-10) and for a public paper with a
 *  private attachment (P0-11). `rev` and `v` only keep two requests apart.
 *  `paperTitle` is read only for a public id; an upload's comes from its
 *  record. Every answer is `private, no-store`. */
export async function POST(req: NextRequest) {
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await req.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    body = parsed as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400, headers: PRIVATE_UPLOAD_HEADERS });
  }
  const text = (value: unknown) => (typeof value === "string" && value ? value : undefined);
  const id = text(body.id);
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400, headers: PRIVATE_UPLOAD_HEADERS });
  }
  return answer({
    id,
    url: text(body.url),
    doi: text(body.doi),
    query: text(body.query),
    paperTitle: claimsUploadId(id) ? undefined : text(body.paperTitle),
    figureIndex: figureIndexOf(body.idx),
  }, { privately: true });
}
