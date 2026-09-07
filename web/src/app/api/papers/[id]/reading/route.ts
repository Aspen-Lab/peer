// GET /api/papers/[id]/reading — the deterministic reading of one paper.
//
// One document per paper for every reader: resolved server-side by id, built
// from the record and the full text alone (no figure pool, no model, no user
// data), and cached at the edge for a day once the full-text attempt has
// settled. The client already rendered the abstract-only reading at first
// paint; what this adds is the blocks below the Decision block.

import { NextResponse, type NextRequest } from "next/server";
import { fetchPaperById } from "@/lib/papers/fetch-by-id";
import { getFullText, type FullTextResult } from "@/lib/papers/full-text";
import { buildReading } from "@/lib/papers/reading";
import { rawItemToPaper } from "@/lib/feed/mapper";

/**
 * How long the route waits for the full text before answering with the
 * abstract alone. `getFullText` keeps running behind the answer and caches
 * its result, so the next request — uncached, see below — gets the sections.
 */
const FULL_TEXT_TIMEOUT_MS = 8_000;

const CACHE_HEADERS = {
  "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800",
};
const NO_STORE_HEADERS = { "Cache-Control": "no-store" };

const TIMED_OUT = Symbol("timed out");

/** The full-text attempt, or the timeout — whichever settles first. */
async function fullTextWithin(
  input: Parameters<typeof getFullText>[0],
  ms: number,
): Promise<{ settled: true; result: FullTextResult | null } | { settled: false }> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), ms);
  });
  try {
    const outcome = await Promise.race([getFullText(input), timeout]);
    if (outcome === TIMED_OUT) return { settled: false };
    return { settled: true, result: outcome };
  } catch (err) {
    // A thrown attempt is a transient failure, not a fact about the paper —
    // answer with the abstract, but do not let the edge keep the answer.
    console.error("[papers/reading] full text failed:", err);
    return { settled: false };
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const decodedId = decodeURIComponent(id);
  const refresh = req.nextUrl.searchParams.get("refresh") === "1";

  const raw = await fetchPaperById(decodedId);
  if (!raw) {
    return NextResponse.json(
      { error: "Paper not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  const paper = rawItemToPaper(raw);

  const fullText = await fullTextWithin(
    {
      paperId: paper.id,
      url: paper.linkPaper ?? paper.linkArxiv ?? null,
      doi: paper.doi ?? null,
      arxivId: paper.id.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : null,
      openAlexId: paper.id.startsWith("openalex:")
        ? paper.id.slice("openalex:".length)
        : null,
    },
    FULL_TEXT_TIMEOUT_MS,
  );

  const reading = buildReading(paper, fullText.settled ? fullText.result : null);
  return NextResponse.json(reading, {
    headers: fullText.settled && !refresh ? CACHE_HEADERS : NO_STORE_HEADERS,
  });
}
