// POST /api/papers/[id]/structure — the model's review of the rules' structure (P12-53; B P12-42; ruling
// §1h.424 (b), §1h.428).
//
// The rules (Tier 0) divide the paper into parts and give each a role; with a model key, this route shows the
// model a compact SKELETON of the paper — each paragraph's number, its first sixteen words and counts of what
// it holds, never the paper — beside the rules' draft, and answers the CORRECTIONS it returns, made whole by
// code (`lib/papers/structure-review.ts`): a part's start moved, a role changed, a part split. A correction
// against a part the rules were sure of gets one more look at that part's own text, at most three per paper.
//
// It runs whenever the reader has a model (§1h.428 (a)); nothing about the reader and not the title reaches
// the model. EVERY failure — a refusal, a timeout, a reply that is not an answer, a skeleton over budget —
// answers `200 { fellBack }` with no corrections: the page keeps the rules' draft, and nothing is remembered.
//
// The server's memory holds the finished review (indices, role names, the model's id — no word of the paper)
// under `docHash | rules | skeleton | prompt`, for an hour, so a paper is reviewed once. It is read only after
// the owner checks, and written only after the upload is seen to be unchanged.
//
// Gated like the other model routes, in the same order: the owner checks on an upload, the shared sign-in and
// hourly-limit check, then the provider — only a provider that can write answers. Never cached by a CDN or the
// browser; an answer about an upload says what the other private-upload routes say.

import { NextRequest, NextResponse } from "next/server";
import { reportModelTier } from "@/lib/llm/provider-models";
import { resolveProvider } from "@/lib/llm/providers/registry";
import type { DigestProvider, ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { explainDocHash, parseModelJson, shortHash } from "@/lib/papers/explain";
import { getFullText } from "@/lib/papers/full-text";
import { readableSections, readingMapOf } from "@/lib/papers/reading-map";
import type { PaperReportRequest } from "@/lib/papers/report";
import {
  buildLookPrompt,
  buildReviewPrompt,
  buildSkeleton,
  draftOf,
  parseLookVerdict,
  REVIEW_PROMPT_VERSION,
  resolveLooks,
  reviewStructure,
  secondLookTargets,
  SKELETON_VERSION,
  STRUCTURE_RULES_VERSION,
  structureInputOf,
  structureReviewCache,
  structureReviewKey,
  type FellBack,
  type LookTarget,
  type LookVerdict,
  type StructureResult,
  type StructureReviewEntry,
} from "@/lib/papers/structure-review";
import { bareUploadId, claimsUploadId } from "@/lib/papers/upload-store";
import { ownedUpload, PRIVATE_UPLOAD_HEADERS } from "@/lib/papers/upload-access";
import { requireAiRequest } from "@/lib/security/ai-request";

export const dynamic = "force-dynamic";
// The review (at most 30 s) and then the looks together (at most 20 s), each on a bounded prompt.
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** How long the review may take before the draft stands, whatever the provider's own guard. */
const REVIEW_TIMEOUT_MS = 30_000;
/** The looks run together; how long they may take in all. */
const LOOK_TIMEOUT_MS = 20_000;

interface StructureRequest {
  paper: PaperReportRequest["paper"];
  llmOverride?: ProviderOverrideConfig;
}

// ── Mirrors of the report route's private helpers ─────────────────────
// `app/api/papers/report/route.ts` keeps these private and its tests pin them (the gist, explain and plain
// routes repeat them for the same reason); repeating the few lines leaves every route untouched. Keep them in step.

function arxivIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  return paper.id?.startsWith("arxiv:") ? paper.id.slice("arxiv:".length) : null;
}

function openAlexIdFromPaper(paper: PaperReportRequest["paper"]): string | null {
  return paper.id?.startsWith("openalex:") ? paper.id.slice("openalex:".length) : null;
}

function bestPaperUrl(paper: PaperReportRequest["paper"]): string | null {
  return paper.linkPaper ?? paper.linkArxiv ?? null;
}

/** The bare hash16 of this paper's private full-text supplement — its own `upload:` id, or the
 *  `fullTextUploadId` attached to a public paper — or null. */
function privateUploadHash(paper: PaperReportRequest["paper"]): string | null {
  const id = paper.fullTextUploadId ?? paper.id;
  return typeof id === "string" ? bareUploadId(id) : null;
}

/** An id that claims to be an upload in a spelling `bareUploadId` does not accept is "not found" — never looked up. */
function malformedUploadClaim(paper: PaperReportRequest["paper"]): boolean {
  if (typeof paper.id === "string" && claimsUploadId(paper.id) && !bareUploadId(paper.id)) return true;
  const attached: unknown = paper.fullTextUploadId;
  return attached !== undefined && attached !== null && (typeof attached !== "string" || !bareUploadId(attached));
}

/** The upload's revision, re-read after the model's work: a deleted, blocked or replaced upload must not have a
 *  review built from it land. */
async function uploadStillCurrent(hash: string | null, startRevision: number | undefined): Promise<boolean> {
  if (!hash) return true;
  const current = await ownedUpload(hash);
  return current !== null && current.revision === startRevision;
}

function isPaper(value: unknown): value is PaperReportRequest["paper"] {
  if (typeof value !== "object" || value === null) return false;
  const paper = value as { id?: unknown; title?: unknown };
  return typeof paper.id === "string" && paper.id !== "" && typeof paper.title === "string" && paper.title !== "";
}

type Timed<T> = { done: true; value: T } | { done: false };

/** The work, or "not done" after `ms`. A result that arrives after is ignored, and so is its failure. */
function within<T>(work: Promise<T>, ms: number): Promise<Timed<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve({ done: false }), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve({ done: true, value });
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

const errorName = (err: unknown): string => (err instanceof Error ? err.name : typeof err);

// ── The handler ───────────────────────────────────────────────────────

async function handle(req: NextRequest, rawId: string): Promise<Response> {
  /** Set once the request names an upload, however it is spelled. */
  let aboutUpload = false;
  /** Every answer is private to the reader and never cached; an upload's says so in full. */
  const reply = (body: unknown, status = 200): NextResponse =>
    NextResponse.json(body, { status, headers: aboutUpload ? PRIVATE_UPLOAD_HEADERS : NO_STORE });

  let body: StructureRequest;
  try {
    body = (await req.json()) as StructureRequest;
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

  // The owner checks, exactly as the report route makes them, before anything is read: a malformed claim and an
  // unowned or unlisted upload are one 404.
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

  // The one sign-in and hourly-limit check, before the provider is resolved.
  const gate = await requireAiRequest("paper-structure", 20);
  if (gate instanceof NextResponse) {
    gate.headers.set("Cache-Control", aboutUpload ? PRIVATE_UPLOAD_HEADERS["Cache-Control"] : NO_STORE["Cache-Control"]);
    return gate;
  }
  const userId = gate.user?.id ?? null;

  // No provider that can write: the client never asks in that state, so this is the answer to a stranger's guess
  // — and it reads nothing.
  const override = body.llmOverride ?? null;
  const provider = resolveProvider(override);
  if (!provider?.generateJsonText) return reply({ unavailable: true } satisfies StructureResult);

  const fullText = await getFullText({
    paperId: body.paper.fullTextUploadId ?? body.paper.id,
    url: bestPaperUrl(body.paper),
    doi: body.paper.doi ?? null,
    arxivId: arxivIdFromPaper(body.paper),
    openAlexId: openAlexIdFromPaper(body.paper),
  });
  const doc = fullText.status === "ok" ? fullText.doc : undefined;
  if (!doc || doc.sections.length === 0) return reply({ unavailable: true } satisfies StructureResult);

  // The paper as the page holds it: the same sections, the same paragraphs, the same numbers.
  const rendered = readableSections(doc);
  const input = structureInputOf(
    readingMapOf(rendered),
    rendered.map((section) => ({ id: section.id, canonical: section.section.canonical, paragraphs: section.paragraphs })),
    {
      // The abstract as the reading builds it (`buildReading`: the record's intro and discussion): the closing split
      // reads it, so the draft is the browser's.
      abstract: [body.paper.summaryIntro, body.paper.summaryResultDiscussion]
        .map((text) => text?.trim() ?? "")
        .filter(Boolean)
        .join("\n\n"),
      figures: doc.figureCaptions.map((figure) => ({ label: figure.label, caption: figure.caption, ...(figure.page ? { page: figure.page } : {}) })),
      ...(doc.pageCount ? { pages: doc.pageCount } : {}),
    },
  );
  const draft = input ? draftOf(input) : null;
  if (!input || !draft || input.paragraphs < 2) return reply({ unavailable: true } satisfies StructureResult);

  // The server's memory: the document, and the versions of what is asked — never the reader, never the title.
  const docHash = explainDocHash(doc);
  const key = structureReviewKey(docHash);
  const hit = structureReviewCache.get(key);
  // The memory is keyed by the document; the draft also depends on the abstract (the closing split), so a hit counts
  // only for the draft it was made against.
  if (hit && hit.draftDigest === draft.digest) return reply({ review: hit, cached: true } satisfies StructureResult);

  const skeleton = buildSkeleton(input, draft);
  if (!skeleton) {
    console.debug("[papers/structure] too_large", { paragraphs: input.paragraphs });
    return reply({ fellBack: "too_large" } satisfies StructureResult);
  }
  const prompt = buildReviewPrompt({ skeleton, draft, ...(input.pages ? { pages: input.pages } : {}) });
  const tier = reportModelTier();
  const generate = provider.generateJsonText.bind(provider) as NonNullable<DigestProvider["generateJsonText"]>;
  const fellBack = (kind: FellBack) => reply({ fellBack: kind } satisfies StructureResult);

  let raw: string;
  try {
    const first = await within(generate({ systemPrompt: prompt.systemPrompt, userPrompt: prompt.userPrompt, maxTokens: prompt.maxTokens, tier }), REVIEW_TIMEOUT_MS);
    if (!first.done) {
      console.error("[papers/structure] model call timed out");
      return fellBack("timeout");
    }
    raw = first.value;
  } catch (err) {
    // Only the kind of error is logged: a provider's message may echo the prompt.
    console.error("[papers/structure] model call failed:", errorName(err));
    return fellBack("provider_error");
  }

  // Made whole by code: a reply that is not an answer — or whose every correction was refused — leaves the draft.
  const reviewed = reviewStructure(parseModelJson(raw), draft.parts, draft.paragraphs);
  if (reviewed.fellBack || !reviewed.answer) {
    console.debug("[papers/structure] unusable", { promptChars: prompt.systemPrompt.length + prompt.userPrompt.length, answerChars: raw.length });
    return fellBack("unusable");
  }

  // The second, targeted look: a correction against a part the rules were sure of, or a part the model could not
  // judge. Each is one short call at the span's own text; one that fails or cannot be read counts as "failed".
  const targets = secondLookTargets(draft.parts, reviewed.answer);
  let answer = reviewed.answer;
  let records: StructureReviewEntry["secondLooks"] = [];
  if (targets.length > 0) {
    const looked = await Promise.all(
      targets.map(async (target: LookTarget): Promise<{ target: LookTarget; verdict: LookVerdict | null }> => {
        const look = buildLookPrompt({ draft, answer: reviewed.answer!, target, texts: input.texts });
        try {
          const result = await within(generate({ systemPrompt: look.systemPrompt, userPrompt: look.userPrompt, maxTokens: look.maxTokens, tier }), LOOK_TIMEOUT_MS);
          return { target, verdict: result.done ? parseLookVerdict(parseModelJson(result.value)) : null };
        } catch (err) {
          console.error("[papers/structure] second look failed:", errorName(err));
          return { target, verdict: null };
        }
      }),
    );
    ({ answer, records } = resolveLooks(draft.parts, reviewed.answer, looked));
  }
  // The looks can only take corrections away or add a role: the result is made whole once more.
  const final = reviewStructure({ corrections: answer.corrections, unsure: answer.unsure }, draft.parts, draft.paragraphs);
  const finalAnswer = final.fellBack || !final.answer ? { corrections: [], unsure: answer.unsure } : final.answer;

  // Sizes only: no paper word, no heading, no title.
  console.debug("[papers/structure] review", {
    ...(userId ? { userId: shortHash(userId) } : {}),
    promptChars: prompt.systemPrompt.length + prompt.userPrompt.length,
    answerChars: raw.length,
    paragraphs: input.paragraphs,
    parts: draft.parts.length,
    mode: skeleton.mode,
    corrections: finalAnswer.corrections.length,
    rejected: reviewed.rejected,
    looks: records.length,
  });

  // The model's work can run long: an upload changed meanwhile is not answered from, and nothing built from it
  // is remembered.
  if (!(await uploadStillCurrent(privateHash, startRevision))) {
    return reply({ error: "Upload no longer available" }, 410);
  }

  const entry: StructureReviewEntry = {
    v: 1,
    docHash,
    rulesVersion: STRUCTURE_RULES_VERSION,
    skeletonVersion: SKELETON_VERSION,
    promptVersion: REVIEW_PROMPT_VERSION,
    draftDigest: draft.digest,
    corrections: finalAnswer.corrections,
    unsure: finalAnswer.unsure,
    secondLooks: records,
    model: `${provider.id}/${override?.model ?? tier}`,
    reviewedAt: Date.now(),
  };
  structureReviewCache.set(key, entry);
  return reply({ review: entry, cached: false } satisfies StructureResult);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return handle(req, id);
}
