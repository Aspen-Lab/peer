// POST /api/papers/[id]/explain — "Explain this?" (P3-02, P3-02b; rulings
// §1h.2, §1h.3; user decision §1a.10).
//
// A reader selected a passage of the paper's body and clicked the button. With
// no thread this answers in two parts — what the term or passage means in
// general, and why the author brings it up here, the second with one sentence of
// the paper quoted and verified (`lib/papers/explain.ts`). With a thread — the
// first answer as its first `peer` message, then the reader's follow-ups and
// Peer's replies, ending with the reader's new message (P3-02b) — it answers
// one reply turn, its quote verified the same way. Nothing reaches this route
// before the click or the reader's send, and nothing about the reader reaches
// the model: the prompt is the paper's title and abstract, its map, the
// paragraph around the passage, the passage and, for a reply, the words of the
// thread the reader chose to send.
//
// Gated like the report route, in the same order: the owner checks on an
// upload (the claim, the attachment, the revision), the shared sign-in and
// hourly-limit check, then the provider — only a provider that can write answers.
//
// Not counted or capped by Peer (P4-00): the model is the reader's own key, so
// what a turn costs is between the reader and their provider, and what bounds one
// reader on Peer's side is the gate's hourly limit (40 requests an hour). The one
// debug line carries sizes and, for a reply, the thread's message count.
//
// A reply may search the web, for that message only, when the reader turned it on
// (`search: true`) AND the provider says it can (`supportsWebSearch`); otherwise
// it is a plain turn and says `searched: false`. The first message never
// searches. A hit in the server's memory (keyed by the document, the passage, the
// thread's texts and whether the reply searched — never by reader) costs no model
// call.
//
// Short and exact (P3-07, §1h.9; user decision §1a.14): a reply is three sentences and 560
// characters unless the reader asked for more — the body's `detail: true` (the box's
// "Say more", a literal true only) or a last message that asks in words
// (`asksForDetail`) — when it may run to eight and 1,400; the prompt names the cap that
// applies, the sanitizer enforces it, the memory's key carries it, and the turn says
// `detail: true` so the box does not offer "Say more" under a reply that is already long.
// A reply may carry a small term table, its rows held to the paper; since P4-00c (§1h.11 (a))
// so may the first answer (one sentence a part with it), by the same sanitizer and grounding.
//
// Never cached by a CDN or the browser: every answer says `no-store`, and one
// about an upload says what the other private-upload routes say.

import { NextRequest, NextResponse } from "next/server";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import {
  EXPLAIN_CAPS,
  asksForDetail,
  buildExplainPrompt,
  buildExplainReplyPrompt,
  clipPassage,
  explainCache,
  explainCacheKey,
  explainDocHash,
  explainMapLines,
  locatePassage,
  parseModelJson,
  readThread,
  sanitizeExplainAnswer,
  sanitizeExplainReply,
  shortHash,
  verifyExplainAnswer,
  verifyExplainReply,
  type ExplainCached,
  type ExplainResult,
} from "@/lib/papers/explain";
import { getFullText } from "@/lib/papers/full-text";
import type { PaperReportRequest } from "@/lib/papers/report";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";
import { requireAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// One small-tier call over a bounded prompt.
export const maxDuration = 30;

/** The most one explanation may say, in tokens (two parts of two sentences, and a quote — or, with a
 *  term table, two one-sentence parts, a quote and up to four rows).
 *
 *  P4-01 commit 0 (§1h.12 (a)): 600 -> 800. A first answer at every cap is: two parts of at most 420
 *  characters (840), a quote of at most 400, a table of four rows of three cells of at most 80 (960),
 *  and the JSON's keys, quotes and braces (about 150) — about 2,350 characters, which at four
 *  characters a token is about 590 tokens. 600 left no margin, and a JSON cut off by the budget is no
 *  answer at all: the reader loses the whole of it, on a key that is their own and so is the cost
 *  (§1h.10). 800 holds the full answer with room for the notation and numbers that tokenise denser. */
const MAX_TOKENS = 800;
/** The most one reply may say (three sentences and a quote, or a two-sentence reply and a small table).
 *
 *  P4-01 commit 0 (§1h.12 (a)): 400 -> 560. A reply with a table at every cap is: two sentences of at
 *  most 560 characters, a quote of at most 400, the table's 960, and the JSON (about 230) — about 2,150
 *  characters, about 540 tokens. 400 cut that reply off; 560 holds it. A short reply without a table
 *  (three sentences, a quote) stays far below it. */
const REPLY_MAX_TOKENS = 560;
/** P3-07: the most the long form of a reply may say (eight sentences and a quote). */
const REPLY_DETAIL_MAX_TOKENS = 800;

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ExplainRequest {
  paper: PaperReportRequest["paper"];
  passage: string;
  /** Where the browser says the selection sits; the server looks there first and
   *  anywhere else if it is wrong. */
  sectionId?: string;
  paragraphIndex?: number;
  /** P3-02b's thread, read by `readThread`: the first message has none, and
   *  anything malformed is taken for none. */
  thread?: unknown;
  /** P3-02c: the reader turned web search on for this message. Only a literal
   *  `true` counts, and only a reply can search. */
  search?: unknown;
  /** P3-07: the reader pressed "Say more" — the reply may run to the long cap. Only a
   *  literal `true` counts, and only a reply has a long form; a reader's last message that
   *  asks for more in words (`asksForDetail`) is the same request. */
  detail?: unknown;
  llmOverride?: ProviderOverrideConfig;
}

// ── Mirrors of the report route's private helpers ─────────────────────
// `app/api/papers/report/route.ts` keeps these private and its tests pin
// them; repeating the few lines here leaves that route untouched. Keep the
// two in step.

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
 *  replaced upload must not have an answer built from it land (9-14, A9-13). */
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

  let body: ExplainRequest;
  try {
    body = (await req.json()) as ExplainRequest;
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
  if (typeof body.passage !== "string") return reply({ error: "passage is required" }, 400);

  // P3-02b: the thread, read before anything else is. A malformed one is none
  // (the first answer, as with no thread); one with more than eight reader
  // messages is full; one that does not end with the reader's message is not a
  // question to answer.
  const read = readThread(body.thread);
  if (read.readers > EXPLAIN_CAPS.threadReaderMessages) return reply({ error: "thread_full" } satisfies ExplainResult, 400);
  const thread = read.messages;
  const replying = thread.length > 0;
  if (replying && thread[thread.length - 1].role !== "reader") {
    return reply({ error: "thread must end with the reader's message" }, 400);
  }

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
  const gate = await requireAiRequest("paper-explain", 40);
  if (gate instanceof NextResponse) {
    gate.headers.set("Cache-Control", aboutUpload ? PRIVATE_UPLOAD_HEADERS["Cache-Control"] : NO_STORE["Cache-Control"]);
    return gate;
  }
  const userId = gate.user?.id ?? null;

  // No provider that can write: the client never asks in that state, so this is
  // the answer to a stranger's guess — and it reads nothing; the gate above has
  // already counted the request in the reader's hour.
  const override = body.llmOverride ?? null;
  const provider = resolveProvider(override);
  if (!provider?.generateJsonText) return reply({ unavailable: true } satisfies ExplainResult);

  const fullText = await getFullText({
    paperId: body.paper.fullTextUploadId ?? body.paper.id,
    url: bestPaperUrl(body.paper),
    doi: body.paper.doi ?? null,
    arxivId: arxivIdFromPaper(body.paper),
    openAlexId: openAlexIdFromPaper(body.paper),
  });
  const doc = fullText.status === "ok" ? fullText.doc : undefined;
  if (!doc || doc.sections.length === 0) return reply({ unavailable: true } satisfies ExplainResult);

  const passage = clipPassage(body.passage);
  const located = locatePassage(doc, passage, {
    sectionId: typeof body.sectionId === "string" ? body.sectionId : undefined,
    paragraphIndex: typeof body.paragraphIndex === "number" ? body.paragraphIndex : undefined,
  });
  if (!located) return reply({ error: "not_in_paper" } satisfies ExplainResult, 422);

  // Whether this turn searches the web: the reader asked (a literal `true`), it is
  // a reply (the first message never searches) and the provider can. A request that
  // asks of a provider that cannot is a plain turn.
  const searched = replying && body.search === true && provider.supportsWebSearch === true;

  // Whether this reply may be the long form (P3-07, §1h.9 (2)): the reader pressed "Say more"
  // (a literal `true`) or their last message asks for more in words. Only a reply has one; the
  // first answer's caps do not move. The cap that applies goes into the prompt and the sanitizer.
  const lastReaderMessage = [...thread].reverse().find((message) => message.role === "reader")?.text ?? "";
  const detail = replying && (body.detail === true || asksForDetail(lastReaderMessage));

  // The server's memory: the document, the passage, the thread's texts, whether the
  // reply searched and whether it is the long form — never the reader.
  const key = explainCacheKey(explainDocHash(doc), passage, thread.map((message) => message.text), searched, detail);
  const logTurn = (fields: { promptChars: number; answerChars: number; cached: boolean }) =>
    console.debug("[papers/explain] turn", {
      ...(userId ? { userId: shortHash(userId) } : {}),
      ...fields,
      ...(replying ? { thread: thread.length } : {}),
    });
  // A key with a thread in it is never the first message's key, so what it
  // holds is the kind of turn this request asks for.
  const hit = explainCache.get(key);
  if (hit && replying && "role" in hit) {
    logTurn({ promptChars: 0, answerChars: JSON.stringify(hit).length, cached: true });
    return reply({ turn: hit, cached: true } satisfies ExplainResult);
  }
  if (hit && !replying && "meaning" in hit) {
    logTurn({ promptChars: 0, answerChars: JSON.stringify(hit).length, cached: true });
    return reply({ answer: hit, cached: true } satisfies ExplainResult);
  }

  const abstract = [body.paper.summaryIntro, body.paper.summaryResultDiscussion].filter(Boolean).join(" ");
  const context = { paper: { title: body.paper.title, abstract }, map: explainMapLines(doc), located, passage };
  const { systemPrompt, userPrompt } = replying ? buildExplainReplyPrompt({ ...context, thread, search: searched, detail }) : buildExplainPrompt(context);
  const maxTokens = replying ? (detail ? REPLY_DETAIL_MAX_TOKENS : REPLY_MAX_TOKENS) : MAX_TOKENS;

  let raw: string;
  try {
    raw = await provider.generateJsonText({ systemPrompt, userPrompt, maxTokens, tier: "small", webSearch: searched });
  } catch (err) {
    // Only the kind of error is logged: a provider's message may echo the prompt.
    console.error("[papers/explain] model call failed:", err instanceof Error ? err.name : typeof err);
    return reply({ unavailable: true } satisfies ExplainResult);
  }

  // Sanitised, then held to the paper: the quote must be the paper's own words
  // or the prose is labelled Peer's. Nonsense is no answer — nothing is kept.
  const parsed = parseModelJson(raw);
  const sanitizedReply = replying ? sanitizeExplainReply(parsed, { detail }) : null;
  const sanitizedAnswer = replying ? null : sanitizeExplainAnswer(parsed);
  let result: ExplainCached;
  // A table's rows — a reply's (P3-07) or, since P4-00c (§1h.11 (a)), the first answer's — are
  // held to the paper in the scope the passage was found in.
  if (sanitizedReply) result = { ...verifyExplainReply(sanitizedReply, doc, located.sectionId, { passage, located }), searched, ...(detail ? { detail: true as const } : {}) };
  else if (sanitizedAnswer) result = verifyExplainAnswer(sanitizedAnswer, doc, located.sectionId, { passage, located });
  else return reply({ unavailable: true } satisfies ExplainResult);

  logTurn({ promptChars: systemPrompt.length + userPrompt.length, answerChars: raw.length, cached: false });

  // The model's work can run long: an upload changed meanwhile is not answered
  // from, and nothing built from it is remembered.
  if (!(await uploadStillCurrent(privateHash, startRevision))) {
    return reply({ error: "Upload no longer available" }, 410);
  }

  explainCache.set(key, result);
  return reply(("role" in result ? { turn: result, cached: false } : { answer: result, cached: false }) satisfies ExplainResult);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
