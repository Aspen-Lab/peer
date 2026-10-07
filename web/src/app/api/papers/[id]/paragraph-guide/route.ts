// POST /api/papers/[id]/paragraph-guide — Peer's gist of each paragraph, for
// the reading map (P3-03; ruling §1h.6; user decision §1a.8; §3d 5 Tier 2 half).
//
// Under each section the map lists one line per paragraph: the paragraph's own
// opening, the paper's words. This route answers Peer's line after it — one gist
// of at most twelve words per paragraph, condensed from that opening and the
// paragraph — in ONE small-model call over the whole document
// (`lib/papers/paragraph-guide.ts`). What comes back is held to the paper: only
// a gist that names a paragraph the map shows a line for, in at most twelve words,
// and shares two content words with its own paragraph is kept; the rest are
// dropped, never mended. A document with more than 120 such paragraphs is not
// asked about at all (`200 { skipped }`).
//
// Nothing about the reader reaches the model: the prompt is the paper's title and
// its paragraphs. The answer is remembered by the document's hash alone, in this
// process for an hour — one reader's guide is another's hit for the same text, and
// a hit costs no model call.
//
// Gated like the explain route, in the same order: the owner checks on an upload
// (the claim, the attachment, the revision), the shared sign-in and hourly-limit
// check, then the provider — only a provider that can write answers.
//
// Not counted or capped by Peer (P4-00): the model is the reader's own key. It is
// one small call per document per hour across ALL readers — the memory sees to that
// — and the gate's hourly limit (20 requests an hour) bounds a single reader. The
// debug line below is what a later pass may size it by.
//
// Never cached by a CDN or the browser: every answer says `no-store`, and one
// about an upload says what the other private-upload routes say.

import { NextRequest, NextResponse } from "next/server";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { explainDocHash, parseModelJson, shortHash } from "@/lib/papers/explain";
import { getFullText } from "@/lib/papers/full-text";
import {
  buildParagraphGuidePrompt,
  gistCandidates,
  gistMaxTokens,
  GUIDE_CAPS,
  paragraphGuideCache,
  sanitizeParagraphGuide,
  verifyParagraphGuide,
  type ParagraphGuide,
  type ParagraphGuideResult,
} from "@/lib/papers/paragraph-guide";
import type { PaperReportRequest } from "@/lib/papers/report";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";
import { requireAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// One small-tier call over a bounded prompt; the answer is a list of short gists.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ParagraphGuideRequest {
  paper: PaperReportRequest["paper"];
  llmOverride?: ProviderOverrideConfig;
}

// ── Mirrors of the report route's private helpers ─────────────────────
// `app/api/papers/report/route.ts` keeps these private and its tests pin
// them (the explain route repeats them for the same reason); repeating the
// few lines here leaves both routes untouched. Keep the three in step.

function arxivIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  return paper.id?.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : null;
}

function openAlexIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  return paper.id?.startsWith("openalex:") ? paper.id.slice("openalex:".length) : null;
}

function bestPaperUrl(paper: PaperReportRequest["paper"]): string | null {
  return paper.linkPaper ?? paper.linkArxiv ?? null;
}

/** The bare hash16 of this paper's private full-text supplement — its own
 *  `upload:` id, or the `fullTextUploadId` attached to a public paper — or null. */
function privateUploadHash(paper: PaperReportRequest["paper"]): string | null {
  const id = paper.fullTextUploadId ?? paper.id;
  return typeof id === "string" ? bareUploadId(id) : null;
}

/** An id that claims to be an upload in a spelling `bareUploadId` does not accept
 *  (`UPLOAD:<hash16>`, upper-case hex, a non-string attachment) is "not found" —
 *  never looked up, never read (P0-05, §1e.1). */
function malformedUploadClaim(paper: PaperReportRequest["paper"]): boolean {
  if (typeof paper.id === "string" && claimsUploadId(paper.id) && !bareUploadId(paper.id)) return true;
  const attached: unknown = paper.fullTextUploadId;
  return attached !== undefined && attached !== null && (typeof attached !== "string" || !bareUploadId(attached));
}

/** The upload's revision, re-read after the model's work: a deleted, blocked or
 *  replaced upload must not have a guide built from it land (9-14, A9-13). */
async function uploadStillCurrent(hash: string | null, startRevision: number | undefined): Promise<boolean> {
  if (!hash) return true;
  const current = await ownedUpload(hash);
  return current !== null && current.revision === startRevision;
}

// ── The handler ───────────────────────────────────────────────────────

function isPaper(value: unknown): value is PaperReportRequest["paper"] {
  if (typeof value !== "object" || value === null) return false;
  const paper = value as { id?: unknown; title?: unknown };
  return typeof paper.id === "string" && paper.id !== "" && typeof paper.title === "string" && paper.title !== "";
}

async function handle(req: NextRequest, rawId: string): Promise<Response> {
  /** Set once the request names an upload, however it is spelled. */
  let aboutUpload = false;
  /** Every answer is private to the reader and never cached; an upload's says so in full. */
  const reply = (body: unknown, status = 200): NextResponse =>
    NextResponse.json(body, { status, headers: aboutUpload ? PRIVATE_UPLOAD_HEADERS : NO_STORE });

  let body: ParagraphGuideRequest;
  try {
    body = (await req.json()) as ParagraphGuideRequest;
  } catch {
    return reply({ error: "Invalid JSON" }, 400);
  }
  if (!isPaper(body?.paper)) return reply({ error: "paper is required" }, 400);
  let id: string;
  try {
    id = decodeURIComponent(rawId);
  } catch {
    return reply({ error: "paper does not match the address" }, 400);
  }
  if (id !== body.paper.id) return reply({ error: "paper does not match the address" }, 400);

  // The owner checks, exactly as the report route makes them, before anything
  // is read: a malformed claim and an unowned or unlisted upload are one 404.
  if (malformedUploadClaim(body.paper)) {
    aboutUpload = true;
    return reply({ error: "Upload not found." }, 404);
  }
  const privateHash = privateUploadHash(body.paper);
  aboutUpload = privateHash !== null;
  let startRevision: number | undefined;
  if (privateHash) {
    const meta = await ownedUpload(privateHash);
    if (!meta || (body.paper.fullTextUploadId && !meta.paperIds?.includes(body.paper.id))) {
      return reply({ error: "Upload not found." }, 404);
    }
    startRevision = meta.revision;
  }

  // The one sign-in and hourly-limit check, before the provider is resolved. A
  // signed-out reader is a 401 here, as before.
  const gate = await requireAiRequest("paragraph-guide", 20);
  if (gate instanceof NextResponse) {
    gate.headers.set("Cache-Control", aboutUpload ? PRIVATE_UPLOAD_HEADERS["Cache-Control"] : NO_STORE["Cache-Control"]);
    return gate;
  }
  const userId = gate.user?.id ?? null;

  // No provider that can write: the client never asks in that state, so this is
  // the answer to a stranger's guess — and it reads nothing.
  const override = body.llmOverride ?? null;
  const provider = resolveProvider(override);
  if (!provider?.generateJsonText) return reply({ unavailable: true } satisfies ParagraphGuideResult);

  const fullText = await getFullText({
    paperId: body.paper.fullTextUploadId ?? body.paper.id,
    url: bestPaperUrl(body.paper),
    doi: body.paper.doi ?? null,
    arxivId: arxivIdFromPaper(body.paper),
    openAlexId: openAlexIdFromPaper(body.paper),
  });
  const doc = fullText.status === "ok" ? fullText.doc : undefined;
  if (!doc || doc.sections.length === 0) return reply({ unavailable: true } satisfies ParagraphGuideResult);

  // The paragraphs the map shows a line for. Too many: the pass is skipped and the
  // client does not ask again for a day. None: there is nothing to say a gist about.
  const candidates = gistCandidates(doc);
  if (candidates.length > GUIDE_CAPS.maxParagraphs) {
    return reply({ skipped: "too_many_paragraphs" } satisfies ParagraphGuideResult);
  }
  if (candidates.length === 0) return reply({ unavailable: true } satisfies ParagraphGuideResult);

  // The server's memory: the document alone — never the reader, never the title.
  const docHash = explainDocHash(doc);
  const hit = paragraphGuideCache.get(docHash);
  if (hit) return reply({ guide: hit, cached: true } satisfies ParagraphGuideResult);

  const { systemPrompt, userPrompt } = buildParagraphGuidePrompt({ paper: { title: body.paper.title }, candidates });
  let raw: string;
  try {
    raw = await provider.generateJsonText({ systemPrompt, userPrompt, maxTokens: gistMaxTokens(candidates.length), tier: "small" });
  } catch (err) {
    // Only the kind of error is logged: a provider's message may echo the prompt.
    console.error("[papers/paragraph-guide] model call failed:", err instanceof Error ? err.name : typeof err);
    return reply({ unavailable: true } satisfies ParagraphGuideResult);
  }

  // Sanitised, then held to the paragraphs: a gist the paragraph does not support is
  // dropped. Nothing left is no guide — nothing is kept, and the client is told so.
  const gists = verifyParagraphGuide(sanitizeParagraphGuide(parseModelJson(raw), candidates), candidates);
  const kept = Object.values(gists).reduce((sum, section) => sum + Object.keys(section).length, 0);
  // Sizes only: no paper word, no gist, no title.
  console.debug("[papers/paragraph-guide] pass", {
    ...(userId ? { userId: shortHash(userId) } : {}),
    promptChars: systemPrompt.length + userPrompt.length,
    answerChars: raw.length,
    paragraphs: candidates.length,
    kept,
  });
  if (kept === 0) return reply({ unavailable: true } satisfies ParagraphGuideResult);

  // The model's work can run long: an upload changed meanwhile is not answered
  // from, and nothing built from it is remembered.
  if (!(await uploadStillCurrent(privateHash, startRevision))) {
    return reply({ error: "Upload no longer available" }, 410);
  }

  const guide: ParagraphGuide = { docHash, gists };
  paragraphGuideCache.set(docHash, guide);
  return reply({ guide, cached: false } satisfies ParagraphGuideResult);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
