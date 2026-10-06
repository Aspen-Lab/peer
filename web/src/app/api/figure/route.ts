// GET /api/figure?id=<itemId>&url=<originUrl>
//
// Lazy figure resolver — hit per-card after feed loads. CDN-cached for
// 24h so the same paper id only triggers an upstream fetch at most once
// per user-day across all readers.

import { NextResponse, type NextRequest } from "next/server";
import { extractFigure } from "@/lib/figures/extract";
import { requireAiRequest } from "@/lib/security/ai-request";
import { bareUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

export const dynamic = "force-dynamic";
export const revalidate = 86_400;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const url = req.nextUrl.searchParams.get("url") ?? undefined;
  const doi = req.nextUrl.searchParams.get("doi") ?? undefined;
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const idxParam = req.nextUrl.searchParams.get("idx");
  const figureIndex = idxParam !== null ? Math.max(0, parseInt(idxParam, 10) || 0) : 0;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  if (id.startsWith("upload:")) {
    const hash = bareUploadId(id);
    if (!hash || !(await ownedUpload(hash))) return NextResponse.json({ error: "Upload not found." }, { status: 404, headers: PRIVATE_UPLOAD_HEADERS });
  }

  // R-SEC-1 — this route had no authentication of any kind. It reaches no model
  // (the figure is chosen by the deterministic extractor), but it makes Peer's
  // server fetch a page the caller names, so it takes the same sign-in and
  // hourly limit as the routes that do.
  //
  // 60/h matches the feed scopes: this is hit once per card, so a lower limit
  // would break an ordinary page of results.
  const gate = await requireAiRequest("figure", 60);
  if (gate instanceof NextResponse) return gate;

  const result = await extractFigure({
    itemId: id,
    url,
    doi,
    query,
    figureIndex,
  });
  const cacheControl = id.startsWith("upload:") ? "private, no-store" : result.imageUrl
    ? "public, s-maxage=86400, stale-while-revalidate=604800"
    : "no-store";

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": cacheControl,
      ...(id.startsWith("upload:") ? PRIVATE_UPLOAD_HEADERS : {}),
    },
  });
}
