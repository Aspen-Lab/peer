// GET /api/figure?id=<itemId>&url=<originUrl>
//
// Lazy figure resolver — hit per-card after feed loads. CDN-cached for
// 24h so the same paper id only triggers an upstream fetch at most once
// per user-day across all readers.

import { NextResponse, type NextRequest } from "next/server";
import { extractFigure } from "@/lib/figures/extract";
import { requireEntitledAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
export const revalidate = 86_400;
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  const url = req.nextUrl.searchParams.get("url") ?? undefined;
  const doi = req.nextUrl.searchParams.get("doi") ?? undefined;
  const query = req.nextUrl.searchParams.get("query") ?? undefined;
  const paperTitle = req.nextUrl.searchParams.get("paperTitle") ?? undefined;
  const idxParam = req.nextUrl.searchParams.get("idx");
  const figureIndex = idxParam !== null ? Math.max(0, parseInt(idxParam, 10) || 0) : 0;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
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
    itemId: id,
    url,
    doi,
    query,
    paperTitle,
    figureIndex,
    // No BYOK override reaches this route — figures are requested by the card,
    // which carries no key — so `byok` is false and the matchers fall to the
    // system provider or to null.
    // ABC-freemium 3-02 — the entitlement itself, not a copy of its user id:
    // holding one is the proof a check ran.
    ctx: { entitlement: gate.entitlement, byok: false },
  });
  const cacheControl = result.imageUrl
    ? "public, s-maxage=86400, stale-while-revalidate=604800"
    : "no-store";

  return NextResponse.json(result, {
    headers: {
      "Cache-Control": cacheControl,
    },
  });
}
