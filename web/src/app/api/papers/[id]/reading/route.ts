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
import { readabilityOf } from "@/lib/papers/readability";
import { rawItemToPaper } from "@/lib/feed/mapper";
import { bareUploadId, claimsUploadId, uploadMetaToPaper } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";

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

  // An
  // uploaded PDF maps straight to a `Paper` (like `uploadMetaToPaper`
  // already does elsewhere), skipping the RawItem shape entirely, rather
  // than teaching `fetchPaperById` a RawItem-shaped lie about an upload.
  // Before this branch existed this route 404'd for every `upload:` id
  // (empty or not), so the client's useReading hook fell back to a
  // client-only reading that never runs buildReading's real pdf_empty
  // provenance logic at all — confirmed by execution.
  const uploadHash16 = bareUploadId(decodedId);
  // P0-05 (§1e.1): an id that claims to be an upload in a spelling
  // `bareUploadId` does not accept (`UPLOAD:<hash16>`) is not found — never
  // looked up as an upload, and never handed to the public paper lookup.
  if (!uploadHash16 && claimsUploadId(decodedId)) {
    return NextResponse.json(
      { error: "Paper not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  if (uploadHash16) {
    const meta = await ownedUpload(uploadHash16);
    if (!meta) {
      return NextResponse.json(
        { error: "Paper not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }
    // 9-14 (A9-13, matrix C5): captured before the (up to 8s) full-text wait.
    const startRevision = meta.revision;
    const uploadPaper = uploadMetaToPaper(meta);
    const uploadFullText = await fullTextWithin(
      {
        paperId: uploadPaper.id,
        url: uploadPaper.linkPaper ?? null,
        doi: uploadPaper.doi ?? null,
      },
      FULL_TEXT_TIMEOUT_MS,
    );
    const uploadReading = buildReading(
      uploadPaper,
      uploadFullText.settled ? uploadFullText.result : null,
    );
    const stillCurrent = await ownedUpload(uploadHash16);
    if (!stillCurrent || stillCurrent.revision !== startRevision) {
      return NextResponse.json(
        { error: "Upload no longer available" },
        { status: 410, headers: PRIVATE_UPLOAD_HEADERS },
      );
    }
    return NextResponse.json(uploadReading, {
      headers: { ...PRIVATE_UPLOAD_HEADERS, "X-Peer-Readability": uploadFullText.settled ? readabilityOf(uploadFullText.result) : "unknown" },
    });
  }

  const raw = await fetchPaperById(decodedId).catch(() => undefined);
  if (raw === undefined) return NextResponse.json({ error: "Paper source temporarily unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  if (!raw) {
    return NextResponse.json(
      { error: "Paper not found" },
      { status: 404, headers: NO_STORE_HEADERS },
    );
  }
  const paper = rawItemToPaper(raw);

  const supplement = req.nextUrl.searchParams.get("upload");
  if (supplement) {
    const hash = bareUploadId(supplement);
    const meta = hash ? await ownedUpload(hash) : null;
    if (!meta?.paperIds?.includes(paper.id)) return NextResponse.json({ error: "Upload not found." }, { status: 404, headers: PRIVATE_UPLOAD_HEADERS });
    // 9-14 (A9-13, matrix C5): re-checked after getFullText, before this
    // owner-supplied reading is ever returned.
    const startRevision = meta.revision;
    const fullText = await getFullText({ paperId: supplement });
    const stillCurrent = hash ? await ownedUpload(hash) : null;
    if (!stillCurrent || stillCurrent.revision !== startRevision) {
      return NextResponse.json({ error: "Upload no longer available" }, { status: 410, headers: PRIVATE_UPLOAD_HEADERS });
    }
    // P9-42 (§1h.67): the captions and their pages were read from the attached
    // PDF, so its figure pictures are drawn from it too — `supplement` is the
    // canonical `upload:<hash16>` (`bareUploadId` accepted it), the same id the
    // text was read from. The figure-image route answers it to its owner only.
    return NextResponse.json(buildReading(paper, fullText, new Date(), { figuresFrom: supplement }), {
      headers: { ...PRIVATE_UPLOAD_HEADERS, "X-Peer-Readability": readabilityOf(fullText) },
    });
  }

  const fullText = await fullTextWithin(
    {
      paperId: paper.id,
      url: paper.linkPaper ?? paper.linkArxiv ?? null,
      doi: paper.doi ?? null,
      arxivId: paper.id.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : raw.metadata.externalIds?.arxivId ?? null,
      openAlexId: paper.id.startsWith("openalex:")
        ? paper.id.slice("openalex:".length)
        : raw.metadata.externalIds?.openalexId ?? null,
    },
    FULL_TEXT_TIMEOUT_MS,
  );

  const reading = buildReading(paper, fullText.settled ? fullText.result : null);
  const availability = fullText.settled ? readabilityOf(fullText.result) : "unknown";
  return NextResponse.json(reading, {
    headers: { ...(availability !== "unknown" && !refresh ? CACHE_HEADERS : NO_STORE_HEADERS), "X-Peer-Readability": availability },
  });
}
