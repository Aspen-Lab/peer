// POST /api/papers/[id]/plain — "Say it plainly" (P4-01; blueprint §3.6 ⑥, D14; user decision
// §1a.5 (b); rulings §1h.10, §1h.12 (h); §3d 15).
//
// A reader clicked the button under a paragraph the route marks read and asked for it in
// plainer words, at one of three levels (`lib/papers/plain-levels.ts`). The answer is that one
// paragraph rewritten — the page shows it beside the original, never in its place — and it is
// kept only when it says every number and unit the paragraph says, no more and no fewer
// (`numbersKept`, `lib/papers/plain.ts`): a rewrite that drops, adds or changes one is answered
// 422 `numbers_changed`, nothing is remembered, and the original stays. Nothing reaches this
// route before the click, and nothing about the reader reaches the model: the prompt is the
// paper's title, the level's rules and the paragraph.
//
// Gated exactly like the explain route, in the same order: the owner checks on an upload (the
// claim, the attachment, the revision), the shared sign-in and hourly-limit check, then the
// provider — only a provider that can write answers — then the paper's text, then the paragraph,
// found in it. The paragraph the model is given is the one the PAPER holds (found by the words
// the browser named, under its hint), never the browser's own copy of it.
//
// Not counted or capped by Peer (§1h.10): the model is the reader's own key, so what a rewrite
// costs is between the reader and their provider, and what bounds one reader on Peer's side is
// the gate's hourly limit (40 requests an hour, scope `paper-plain`). The one debug line carries
// sizes only.
//
// A hit in the server's memory (keyed by hashes of the document and the paragraph and the level —
// never by reader) costs no model call. Never cached by a CDN or the browser: every answer says
// `no-store`, and one about an upload says what the other private-upload routes say.

import { NextRequest, NextResponse } from "next/server";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { clipPassage, explainDocHash, locatePassage, parseModelJson, shortHash } from "@/lib/papers/explain";
import { getFullText } from "@/lib/papers/full-text";
import { buildPlainPrompt, isPlainLevel, numbersKept, plainCache, plainCacheKey, sanitizePlain, type PlainResult } from "@/lib/papers/plain";
import type { PaperReportRequest } from "@/lib/papers/report";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";
import { requireAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// One small-tier call over a bounded prompt.
export const maxDuration = 30;

/** The most one rewrite may say, in tokens. A rewrite is at most 1.2 times a paragraph clipped to
 *  1,200 characters (`PLAIN_CAPS`): 1,440 characters, which at about four characters a token is
 *  about 360 tokens, and the JSON's wrapper `{"plain":"…"}` a dozen more — about 400. 600 leaves half
 *  as much again for what tokenises denser than prose: numbers and their units, symbols, a formula's
 *  TeX, a paper that is not in English. A rewrite the budget cuts off is a JSON that does not parse,
 *  and so no rewrite at all. */
const PLAIN_MAX_TOKENS = 600;

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface PlainRequest {
  paper: PaperReportRequest["paper"];
  /** The paragraph's words, as the browser renders them. The server finds the paragraph in the
   *  paper by them and rewrites the paper's own copy, not this one. */
  text: string;
  /** Where the browser says the paragraph sits; the server looks there first and anywhere else
   *  if it is wrong. */
  sectionId?: string;
  paragraphIndex?: number;
  level: unknown;
  llmOverride?: ProviderOverrideConfig;
}

// ── Mirrors of the explain route's private helpers ────────────────────
// `app/api/papers/[id]/explain/route.ts` mirrors the report route's, and its tests pin them;
// route modules may export only their handlers, so the few lines are repeated here. Keep the
// three in step.

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
 *  replaced upload must not have an answer built from it land. */
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
  const reply = (body: PlainResult | { error: string }, status = 200): NextResponse =>
    NextResponse.json(body, { status, headers: aboutUpload ? PRIVATE_UPLOAD_HEADERS : NO_STORE });

  let body: PlainRequest;
  try {
    body = (await req.json()) as PlainRequest;
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
  if (typeof body.text !== "string") return reply({ error: "text is required" }, 400);
  const level = body.level;
  if (!isPlainLevel(level)) return reply({ error: "level is required" }, 400);

  // The owner checks, exactly as the report and explain routes make them, before anything is
  // read: a malformed claim and an unowned or unlisted upload are one 404.
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

  // The one sign-in and hourly-limit check, before the provider is resolved. A signed-out
  // reader is a 401 here, before any text is read; the 41st request in an hour is a 429.
  const gate = await requireAiRequest("paper-plain", 40);
  if (gate instanceof NextResponse) {
    gate.headers.set("Cache-Control", aboutUpload ? PRIVATE_UPLOAD_HEADERS["Cache-Control"] : NO_STORE["Cache-Control"]);
    return gate;
  }
  const userId = gate.user?.id ?? null;

  // No provider that can write: the client never asks in that state, so this is the answer to a
  // stranger's guess — and it reads nothing; the gate above has already counted the request in
  // the reader's hour.
  const provider = resolveProvider(body.llmOverride ?? null);
  if (!provider?.generateJsonText) return reply({ unavailable: true });

  const fullText = await getFullText({
    paperId: body.paper.fullTextUploadId ?? body.paper.id,
    url: bestPaperUrl(body.paper),
    doi: body.paper.doi ?? null,
    arxivId: arxivIdFromPaper(body.paper),
    openAlexId: openAlexIdFromPaper(body.paper),
  });
  const doc = fullText.status === "ok" ? fullText.doc : undefined;
  if (!doc || doc.sections.length === 0) return reply({ unavailable: true });

  // The paragraph the paper holds, found by the browser's words under its hint. What is
  // rewritten, hashed and compared is the paper's copy, clipped to 1,200 characters at a word.
  const located = locatePassage(doc, clipPassage(body.text), {
    sectionId: typeof body.sectionId === "string" ? body.sectionId : undefined,
    paragraphIndex: typeof body.paragraphIndex === "number" ? body.paragraphIndex : undefined,
  });
  if (!located) return reply({ error: "not_in_paper" }, 422);
  const original = clipPassage(located.paragraph);

  const logTurn = (fields: { promptChars: number; answerChars: number; cached: boolean }) =>
    console.debug("[papers/plain] turn", { ...(userId ? { userId: shortHash(userId) } : {}), ...fields });

  // The server's memory: the document, the paragraph and the level — never the reader.
  const key = plainCacheKey(explainDocHash(doc), original, level);
  const hit = plainCache.get(key);
  if (hit !== undefined) {
    logTurn({ promptChars: 0, answerChars: hit.length, cached: true });
    return reply({ plain: hit, level, cached: true });
  }

  const { systemPrompt, userPrompt } = buildPlainPrompt({ title: body.paper.title, level, text: original });
  let raw: string;
  try {
    raw = await provider.generateJsonText({ systemPrompt, userPrompt, maxTokens: PLAIN_MAX_TOKENS, tier: "small" });
  } catch (err) {
    // Only the kind of error is logged: a provider's message may echo the prompt, or the key.
    console.error("[papers/plain] model call failed:", err instanceof Error ? err.name : typeof err);
    return reply({ unavailable: true });
  }
  logTurn({ promptChars: systemPrompt.length + userPrompt.length, answerChars: raw.length, cached: false });

  // Sanitised, then held to the paper's numbers: nonsense or an over-long rewrite is no
  // rewrite, and one that loses, adds or changes a number or a unit is refused outright.
  const sanitized = sanitizePlain(parseModelJson(raw), original);
  if (!sanitized) return reply({ unavailable: true });
  if (!numbersKept(original, sanitized.plain)) return reply({ error: "numbers_changed" }, 422);

  // The model's work can run long: an upload changed meanwhile is not answered from, and
  // nothing built from it is remembered.
  if (!(await uploadStillCurrent(privateHash, startRevision))) {
    return reply({ error: "Upload no longer available" }, 410);
  }

  plainCache.set(key, sanitized.plain);
  return reply({ plain: sanitized.plain, level, cached: false });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
