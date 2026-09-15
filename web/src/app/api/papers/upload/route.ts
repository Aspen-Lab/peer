// POST /api/papers/upload — S7: upload a paper's own PDF and read it like any
// other paper. Multipart only, PDF-only (checked by magic bytes, never by the
// client-supplied MIME type or extension), 25 MB cap. Stores the file once
// (idempotent — the same bytes always hash to the same id) and derives
// title/DOI/abstract/page-count honestly from whatever the PDF text
// extractor could read; never invents a field it could not find.

import { NextResponse } from "next/server";
import { extractPdfTextFromPath } from "@/lib/papers/pdf-text";
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

  const meta: UploadMeta = {
    hash16,
    fileName: file.name,
    // The extractor's own largest-first-page-font heuristic, when it found
    // one (see extract_pdf_text.py's `extract_title`) — never an LLM guess.
    // Falls back to the file name (minus its extension) rather than
    // inventing a title.
    title: doc?.title?.trim() || titleFromFileName(file.name),
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
