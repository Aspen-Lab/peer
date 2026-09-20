// POST /api/papers/upload — S7: upload a paper's own PDF and read it like any
// other paper. Multipart only, PDF-only (checked by magic bytes, never by the
// client-supplied MIME type or extension), 25 MB cap. Stores the file once
// (idempotent — the same bytes always hash to the same id) and derives
// title/DOI/abstract/page-count honestly from whatever the PDF text
// extractor could read; never invents a field it could not find.

import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { hostedUploadsEnabled, ownedUpload, PRIVATE_UPLOAD_HEADERS, sameOriginUploadRequest, UPLOAD_RIGHTS_VERSION, uploadOwner } from "@/lib/papers/upload-access";
import { extractUploadConcepts, matchesUploadedPaper } from "@/lib/preferences/upload-concepts";
import { extractPdfTextFromPath } from "@/lib/papers/pdf-text";
import { resolveProvider } from "@/lib/llm/providers/registry";
import {
  attachUpload,
  attachedUploadHash,
  deleteUpload,
  privateUploadHash,
  readUploadMeta,
  purgeExpiredUploads,
  listUploadMeta,
  uploadFileExists,
  uploadId,
  uploadMetaToPaper,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "@/lib/papers/upload-store";

export const dynamic = "force-dynamic";
// PDF text extraction (Python/PyMuPDF) can take up to ~100s for a full-length
// paper (see `pdf-text.ts`'s own execFile timeout) — give the route the same
// headroom the report route gives deep-report generation.
export const maxDuration = 120;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
// Same shape as `figures/extract.ts`'s DOI regex family; searched over
// whatever body text the extractor returned (see the honesty note below),
// not the raw PDF — absent if nothing matches, never invented.
const DOI_RE = /\b10\.\d{4,9}\/[^\s"'<>]+/;
// How much of the extracted body to search for a DOI mention. The PDF text
// extractor's own section builder drops everything before the first
// recognized heading (the title/header area, where a DOI most often appears
// in print) — so this can miss a DOI a human would see immediately. That's a
// known, accepted gap for this pass, not a bug: an absent DOI is honest,
// never invented from a guess.
const DOI_SEARCH_CHARS = 20_000;

function stripTrailingPunctuation(raw: string): string {
  return raw.replace(/[.,;:)\]]+$/, "");
}

function titleFromFileName(fileName: string): string {
  const withoutExtension = fileName.replace(/\.pdf$/i, "").trim();
  return withoutExtension || "Untitled PDF";
}

// 2-06 (Ruling 9, A2-01), step (b): mirrors extract_pdf_text.py's own
// TITLE_STAMP_RE — a small shared pattern, duplicated deliberately rather
// than round-tripped through a second process boundary (Python and TS each
// need their own copy). Defense in depth: extract_title (step a) already
// excludes a stamp/DOI/URL line before picking the largest-font line, so
// this only ever catches a shape that slipped past that filter.
const TITLE_STAMP_RE = /^(?:arXiv:\d{4}\.\d{4,5}|10\.\d{4,9}\/|https?:\/\/)/i;

/** ≥ 3 words, not stamp-shaped, ≤ 200 chars — the bar both step (a)'s
 *  output and step (b)'s model answer must clear before either is trusted. */
function looksLikeUsableTitle(title: string): boolean {
  const trimmed = title.trim();
  if (!trimmed || trimmed.length > 200) return false;
  if (TITLE_STAMP_RE.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).filter(Boolean).length;
  return wordCount >= 3;
}

/**
 * Step (b): a small-tier-model re-check, only reached when step (a) —
 * extract_pdf_text.py's own largest-font-line join — did not produce a
 * usable title. Uses the same no-override `resolveProvider(null)` pattern
 * `report/route.ts` already uses: a real model call locally (dev
 * credentials via `resolveLocalServerProvider`), inert on a deployed
 * instance with no operator key (`canUseLocalServerProvider`'s existing,
 * deliberate fail-closed rule — a stranger's upload never spends the
 * operator's account). Never invents a title: a missing/unusable model
 * answer falls through to step (c), the file name.
 */
async function modelTitleFallback(page1Text: string): Promise<string | null> {
  const provider = resolveProvider(null);
  if (!provider?.generateJsonText || !page1Text.trim()) return null;
  try {
    const raw = await provider.generateJsonText({
      systemPrompt:
        "You are given the raw text extracted from page 1 of an academic " +
        "paper's PDF. Reply with only a JSON object of the shape " +
        '{"title": string | null}. Set "title" to the paper\'s own title as ' +
        "printed on the page. Use null when the text does not clearly " +
        "contain a title — never guess or invent one.",
      userPrompt: page1Text.slice(0, 3000),
      maxTokens: 200,
      tier: "small",
    });
    const match = raw.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : raw) as { title?: unknown };
    const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
    return title && looksLikeUsableTitle(title) ? title : null;
  } catch {
    return null;
  }
}

/**
 * The full title heuristic (2-06, Ruling 9 / A2-01): (a) the extractor's own
 * largest-first-page-font join, when it produced something usable; else (b)
 * a small-tier-model re-check of page 1's raw text; else (c) the file name.
 * Never a half title, never a stamp — at every step the same
 * `looksLikeUsableTitle` bar decides, and an unusable answer falls through
 * rather than being trusted anyway.
 */
async function resolveUploadTitle(
  extractorTitle: string | null | undefined,
  page1Text: string | undefined,
  fileName: string,
): Promise<string> {
  const stepA = extractorTitle?.trim() ?? "";
  if (looksLikeUsableTitle(stepA)) return stepA;
  const stepB = await modelTitleFallback(page1Text ?? "");
  if (stepB) return stepB;
  return titleFromFileName(fileName);
}

const OVER_CAP_RESPONSE = { error: "That PDF is larger than 25 MB." } as const;

export async function POST(req: Request) {
  if (!sameOriginUploadRequest(req)) return NextResponse.json({ error: "Cross-site upload refused." }, { status: 403 });
  if (!hostedUploadsEnabled()) return NextResponse.json({ error: "Private PDF storage is not configured on this server." }, { status: 503 });
  const ownerKey = await uploadOwner(true);
  if (!ownerKey) return NextResponse.json({ error: "Sign in to upload a private PDF." }, { status: 401, headers: PRIVATE_UPLOAD_HEADERS });
  // 5-02: fail fast on Content-Length before spending any time on
  // parsing. Absent for chunked transfer-encoding or a Request built
  // directly without a computed length (e.g. this route's own tests) — the
  // post-parse check below is the fallback gate for those cases.
  const contentLength = req.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > MAX_UPLOAD_BYTES) {
    return NextResponse.json(OVER_CAP_RESPONSE, { status: 413 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch (err) {
    console.error("[upload] formData failed:", err);
    return NextResponse.json({ error: "Expected a multipart/form-data upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file was attached." }, { status: 400 });
  }
  // 5-02: same message and status as the pre-parse gate above — this is the
  // fallback for a request whose Content-Length was absent or understated,
  // not a different failure mode the client should be able to tell apart.
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(OVER_CAP_RESPONSE, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.byteLength === 0) {
    return NextResponse.json({ error: "The uploaded file was empty." }, { status: 400 });
  }
  // Magic bytes, not the browser-supplied `file.type` or the `.pdf`
  // extension — both are client-controlled and not trustworthy.
  if (bytes.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return NextResponse.json({ error: "That file is not a PDF." }, { status: 415 });
  }

  if (form.get("rightsVersion") !== UPLOAD_RIGHTS_VERSION) {
    return NextResponse.json({ error: "Confirm that you are authorized to store and process this PDF in Peer." }, { status: 400 });
  }
  let target: { id: string; title: string; doi?: string } | undefined;
  const targetValue = form.get("targetPaper");
  if (targetValue !== null) {
    try {
      target = JSON.parse(String(targetValue));
      if (!target || typeof target.id !== "string" || target.id.length > 200 || !target.id.trim() || target.id.startsWith("upload:") ||
          typeof target.title !== "string" || !target.title.trim() || target.title.length > 1000 ||
          (target.doi !== undefined && typeof target.doi !== "string")) throw new Error("invalid");
    } catch { return NextResponse.json({ error: "Invalid paper to supplement." }, { status: 400 }); }
  }
  const hash16 = privateUploadHash(ownerKey, bytes);

  // Extract text now to derive title/DOI/abstract/page count. A failure here
  // (no Python on this machine, the extractor errored, a scanned PDF with no
  // text layer) does not fail the upload — the file is still valid and
  // downloadable either way; the reading page is what tells the reader their
  // PDF has no readable text (1-28), not this route.
  const temporary = await mkdtemp(path.join(tmpdir(), "peer-upload-"));
  const temporaryPdf = path.join(temporary, "source.pdf");
  const extracted = await (async () => {
    try {
      await writeFile(temporaryPdf, bytes, { mode: 0o600 });
      return await extractPdfTextFromPath(temporaryPdf);
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  })();
  const doc = extracted.ok ? extracted.doc : undefined;

  const bodyText = (doc?.sections ?? [])
    .map((section) => section.text)
    .join(" ")
    .slice(0, DOI_SEARCH_CHARS);
  const doiMatch = (extracted.page1Text || bodyText).match(DOI_RE);

  const abstractSection = doc?.sections.find((section) => section.canonical === "abstract");

  // 2-06 (Ruling 9, A2-01): (a) the extractor's own largest-first-page-font
  // join, when usable; else (b) a small-tier-model re-check of page 1's raw
  // text (inert without a local dev provider — see `modelTitleFallback`);
  // else (c) the file name. Never a guessed title, never a half title,
  // never a stamp.
  const title = await resolveUploadTitle(doc?.title, extracted.page1Text, file.name);

  const doi = doiMatch ? stripTrailingPunctuation(doiMatch[0]) : undefined;
  if (target && (!(doc?.sections.length) || !matchesUploadedPaper(target, title, doi))) {
    return NextResponse.json({ error: "This PDF could not be verified as this article. Choose its full-text PDF with readable text; the existing report has been kept." }, { status: 422, headers: PRIVATE_UPLOAD_HEADERS });
  }
  const previous = await readUploadMeta(hash16);
  const now = new Date().toISOString();
  // DOI deduplicates alternate publisher PDFs; otherwise use identical bytes.
  const documentKey = createHash("sha256").update(`${ownerKey}:${doi?.toLowerCase() ?? hash16}`).digest("hex");
  // 9-12 (A9-10, matrix B7): an idempotent re-upload of bytes already on disk
  // keeps its own revision (a refresh, not a new version). A genuinely new
  // asset (a hash16 never seen before) starts a fresh chain at 1, UNLESS it
  // supersedes a still-live sibling asset of this owner — either the same
  // DOI-verified `documentKey`, or the same target paper's prior attachment
  // — in which case it continues that sibling's chain. Never touches any
  // other owner's records (`listUploadMeta` is already owner-scoped).
  const revision = previous?.revision ?? await (async () => {
    const siblings = await listUploadMeta(ownerKey);
    const prior = siblings.find((sibling) => sibling.hash16 !== hash16 &&
      (sibling.documentKey === documentKey || (target && sibling.paperIds?.includes(target.id))));
    return prior ? (prior.revision ?? 1) + 1 : 1;
  })();

  const meta: UploadMeta = {
    ownerKey,
    rightsVersion: UPLOAD_RIGHTS_VERSION,
    rightsAcceptedAt: now,
    expiresAt: new Date(Date.now() + 30 * 86400_000).toISOString(),
    paperIds: [...new Set([...(previous?.paperIds ?? []), ...(target ? [target.id] : [])])],
    preferenceSignals: doc ? extractUploadConcepts(doc) : [],
    documentKey,
    status: "ready",
    revision,
    hash16,
    fileName: file.name,
    title,
    doi,
    pageCount: doc?.pageCount,
    summaryIntro: abstractSection ? abstractSection.text.slice(0, 400) : undefined,
    uploadedAt: new Date().toISOString(),
    // A2-02 (2-05): "empty" covers both a failed extraction (`doc` is
    // undefined) and a successful-but-textless one (`doc.sections` is a
    // real, present, zero-length array — confirmed by execution against a
    // real blank PDF) — both mean the same thing to the reader: nothing to
    // report on.
    textStatus: (doc?.sections.length ?? 0) > 0 ? "ok" : "empty",
  };
  // 9-13 (A9-15): a genuinely new asset (this hash16 has no PDF bytes on disk
  // yet) is written meta `pending` -> PDF bytes -> meta `ready`, so a crash or
  // a throwing write partway through never leaves a stuck `pending` record
  // that `ownedUpload` would otherwise refuse forever; on any failure in that
  // sequence, both files are rolled back via the same `deleteUpload` the
  // owner-facing DELETE route uses. An idempotent re-upload of bytes already
  // on disk (`previous` existed as `ready`) skips the `pending` phase
  // entirely and goes straight to the single ready write it always did — the
  // PDF bytes are already safely stored, so there is nothing to roll back,
  // and a failed refresh must never delete a still-good asset (matrix B7:
  // "if a ready meta exists, return it").
  const isNewAsset = !uploadFileExists(hash16);
  try {
    if (isNewAsset) await writeUploadMeta(hash16, { ...meta, status: "pending" });
    await writeUploadPdfIfAbsent(hash16, bytes);
    await writeUploadMeta(hash16, meta);
  } catch (err) {
    console.error("[upload] failed to store the uploaded PDF:", err);
    if (isNewAsset) await deleteUpload(meta);
    return NextResponse.json({ error: "Could not store the uploaded PDF. Try again." }, { status: 500, headers: PRIVATE_UPLOAD_HEADERS });
  }
  if (target) await attachUpload(ownerKey, target.id, hash16);
  await purgeExpiredUploads();

  return NextResponse.json({ id: uploadId(hash16), paper: uploadMetaToPaper(meta), expiresAt: meta.expiresAt }, { headers: PRIVATE_UPLOAD_HEADERS });
}

/** The mapping itself is private: shared paper metadata never gains an upload. */
export async function GET(req: Request) {
  const owner = await uploadOwner();
  const paperId = new URL(req.url).searchParams.get("paperId");
  if (!owner) return NextResponse.json({ paper: null, uploads: [] }, { headers: PRIVATE_UPLOAD_HEADERS });
  if (!paperId) {
    const uploads = (await listUploadMeta(owner)).map((meta) => ({ paper: uploadMetaToPaper(meta), expiresAt: meta.expiresAt }));
    return NextResponse.json({ uploads }, { headers: PRIVATE_UPLOAD_HEADERS });
  }
  const hash = await attachedUploadHash(owner, paperId);
  const meta = hash ? await ownedUpload(hash, owner) : null;
  return NextResponse.json({ paper: meta ? uploadMetaToPaper(meta) : null }, { headers: PRIVATE_UPLOAD_HEADERS });
}
