// POST /api/papers/upload — S7: upload a paper's own PDF and read it like any
// other paper. Multipart only, PDF-only (checked by magic bytes, never by the
// client-supplied MIME type or extension), 25 MB cap. Stores the file once
// (idempotent — the same bytes always hash to the same id) and derives
// title/DOI/abstract/page-count honestly from whatever the PDF text
// extractor could read; never invents a field it could not find.

import { NextResponse } from "next/server";
import { extractPdfTextFromPath } from "@/lib/papers/pdf-text";
import { resolveProvider } from "@/lib/llm/providers/registry";
import {
  pdfPath,
  sha16,
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

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "Expected a multipart/form-data upload." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No PDF file was attached." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "That PDF is larger than 25 MB." }, { status: 400 });
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

  const hash16 = sha16(bytes);
  // Idempotent: a repeat upload of the same bytes reuses the existing file
  // rather than writing (or erroring) again.
  await writeUploadPdfIfAbsent(hash16, bytes);

  // Extract text now to derive title/DOI/abstract/page count. A failure here
  // (no Python on this machine, the extractor errored, a scanned PDF with no
  // text layer) does not fail the upload — the file is still valid and
  // downloadable either way; the reading page is what tells the reader their
  // PDF has no readable text (1-28), not this route.
  const extracted = await extractPdfTextFromPath(pdfPath(hash16));
  const doc = extracted.ok ? extracted.doc : undefined;

  const bodyText = (doc?.sections ?? [])
    .map((section) => section.text)
    .join(" ")
    .slice(0, DOI_SEARCH_CHARS);
  const doiMatch = bodyText.match(DOI_RE);

  const abstractSection = doc?.sections.find((section) => section.canonical === "abstract");

  // 2-06 (Ruling 9, A2-01): (a) the extractor's own largest-first-page-font
  // join, when usable; else (b) a small-tier-model re-check of page 1's raw
  // text (inert without a local dev provider — see `modelTitleFallback`);
  // else (c) the file name. Never a guessed title, never a half title,
  // never a stamp.
  const title = await resolveUploadTitle(doc?.title, extracted.page1Text, file.name);

  const meta: UploadMeta = {
    hash16,
    fileName: file.name,
    title,
    doi: doiMatch ? stripTrailingPunctuation(doiMatch[0]) : undefined,
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
  await writeUploadMeta(hash16, meta);

  return NextResponse.json({ id: uploadId(hash16), paper: uploadMetaToPaper(meta) });
}
