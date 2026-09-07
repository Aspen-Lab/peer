import { NextResponse } from "next/server";
import { fetchPaperById } from "@/lib/papers/fetch-by-id";
import { rawItemToPaper } from "@/lib/feed/mapper";
import { DEEP_LINK_REASON } from "@/lib/reader/recommendation";

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
};

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const raw = await fetchPaperById(decodedId);
  if (!raw) {
    return NextResponse.json({ error: "Paper not found" }, { status: 404 });
  }
  // A paper resolved by id was not recommended; the reading page knows this
  // string and never shows it as a reason.
  const paper = rawItemToPaper(raw, { relevanceReason: DEEP_LINK_REASON });
  return NextResponse.json(paper, { headers: CACHE_HEADERS });
}
