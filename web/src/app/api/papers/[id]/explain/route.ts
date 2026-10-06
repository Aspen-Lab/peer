// POST /api/papers/[id]/explain — "Explain this?", the first message (P3-02;
// ruling §1h.2; user decision §1a.10).
//
// A reader selected a passage of the paper's body and clicked the button. This
// answers in two parts — what the term or passage means in general, and why the
// author brings it up here, the second with one sentence of the paper quoted
// and verified (`lib/papers/explain.ts`). Nothing reaches this route before
// that click, and nothing from the reader reaches the model: the prompt is the
// paper's title and abstract, its map, the paragraph around the passage and the
// passage.
//
// Gated like the report route, in the same order: the owner checks on an
// upload (the claim, the attachment, the revision), the shared entitlement
// check, then the provider — only a provider that can write answers.
// Counted, not charged (§1h.2): each model turn adds one to the reader's
// per-day counter and writes one debug line with sizes only, so P3-02c can set
// the fraction from real numbers. A hit in the server's memory (keyed by the
// document, the passage and the thread — never by reader) costs no model call
// and no count.
//
// Never cached by a CDN or the browser: every answer says `no-store`, and one
// about an upload says what the other private-upload routes say.

import { NextRequest, NextResponse } from "next/server";
import { hasUsableProviderOverride, resolveProvider } from "@/lib/llm/providers/registry";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import {
  buildExplainPrompt,
  clipPassage,
  explainCache,
  explainCacheKey,
  explainDayKey,
  explainDocHash,
  explainMapLines,
  locatePassage,
  parseModelJson,
  sanitizeExplainAnswer,
  shortHash,
  verifyExplainAnswer,
  type ExplainResult,
} from "@/lib/papers/explain";
import { getFullText } from "@/lib/papers/full-text";
import type { PaperReportRequest } from "@/lib/papers/report";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";
import { requireEntitledAiRequest } from "@/lib/security/ai-request";
import { entitledContext } from "@/lib/security/entitled-context";
import { CompanySpendCapRefusedError } from "@/lib/usage/company-budget";
import { companyBudgetQuotaSignal } from "@/lib/usage/deep-report-quota";
import { endOfUtcDay, getCounterStore } from "@/lib/usage/counters";

export const dynamic = "force-dynamic";
// One small-tier call over a bounded prompt.
export const maxDuration = 30;

/** The most one explanation may say, in tokens (two parts of two sentences, and a quote). */
const MAX_TOKENS = 600;

const NO_STORE = { "Cache-Control": "no-store" } as const;

interface ExplainRequest {
  paper: PaperReportRequest["paper"];
  passage: string;
  /** Where the browser says the selection sits; the server looks there first and
   *  anywhere else if it is wrong. */
  sectionId?: string;
  paragraphIndex?: number;
  /** P3-02b's thread. The first message has none; anything sent is not read. */
  thread?: unknown;
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

  // The one entitlement check, before the provider is resolved.
  const gate = await requireEntitledAiRequest("paper-explain", 40);
  if (gate instanceof NextResponse) {
    gate.headers.set("Cache-Control", aboutUpload ? PRIVATE_UPLOAD_HEADERS["Cache-Control"] : NO_STORE["Cache-Control"]);
    return gate;
  }
  const userId = gate.entitlement.userId;

  // No provider that can write: the client never asks in that state, so this is
  // the answer to a stranger's guess — and it reads nothing and counts nothing.
  const override = body.llmOverride ?? null;
  const provider = resolveProvider(
    override,
    entitledContext(gate.entitlement, "paper-explain", hasUsableProviderOverride(override)),
  );
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

  // The server's memory: the document, the passage and the thread — never the
  // reader. P3-02 has no thread.
  const key = explainCacheKey(explainDocHash(doc), passage, []);
  const hit = explainCache.get(key);
  if (hit) {
    console.debug("[papers/explain] turn", {
      ...(userId ? { userId: shortHash(userId) } : {}),
      count: null,
      promptChars: 0,
      answerChars: JSON.stringify(hit).length,
      cached: true,
    });
    return reply({ answer: hit, cached: true } satisfies ExplainResult);
  }

  const abstract = [body.paper.summaryIntro, body.paper.summaryResultDiscussion].filter(Boolean).join(" ");
  const { systemPrompt, userPrompt } = buildExplainPrompt({
    paper: { title: body.paper.title, abstract },
    map: explainMapLines(doc),
    located,
    passage,
  });

  let raw: string;
  try {
    raw = await provider.generateJsonText({ systemPrompt, userPrompt, maxTokens: MAX_TOKENS, tier: "small" });
  } catch (err) {
    // Only the kind of error is logged: a provider's message may echo the prompt.
    console.error("[papers/explain] model call failed:", err instanceof Error ? err.name : typeof err);
    if (err instanceof CompanySpendCapRefusedError) {
      return reply({ unavailable: true, quota: companyBudgetQuotaSignal(err.reason, new Date()) } satisfies ExplainResult);
    }
    return reply({ unavailable: true } satisfies ExplainResult);
  }

  const sanitized = sanitizeExplainAnswer(parseModelJson(raw));
  if (!sanitized) return reply({ unavailable: true } satisfies ExplainResult);

  // Counted (not charged): one model turn for this reader today. The store never
  // refuses a count and a failure to write one never fails the explanation.
  let count: number | null = null;
  if (userId) {
    const now = new Date();
    try {
      const reading = await getCounterStore().increment(explainDayKey(userId, now), endOfUtcDay(now), 1, now);
      count = reading.ok ? reading.value : null;
    } catch {
      count = null;
    }
  }
  console.debug("[papers/explain] turn", {
    ...(userId ? { userId: shortHash(userId) } : {}),
    count,
    promptChars: systemPrompt.length + userPrompt.length,
    answerChars: raw.length,
    cached: false,
  });

  const answer = verifyExplainAnswer(sanitized, doc, located.sectionId);

  // The model's work can run long: an upload changed meanwhile is not answered
  // from, and nothing built from it is remembered.
  if (!(await uploadStillCurrent(privateHash, startRevision))) {
    return reply({ error: "Upload no longer available" }, 410);
  }

  explainCache.set(key, answer);
  return reply({ answer, cached: false } satisfies ExplainResult);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
