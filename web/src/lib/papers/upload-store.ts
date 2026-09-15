// 1-23: everything the upload route (`app/api/papers/upload`) and the two
// `upload:`-aware pipeline branches (`full-text.ts`, `figures/extract.ts`)
// need to agree on about an uploaded PDF's id scheme and on-disk layout,
// defined exactly once — per Ruling 4 (§1e).
//
// Storage: `web/.local-data/uploads/<hash16>.pdf` + `<hash16>.json`, already
// covered by `web/.gitignore`'s `/.local-data` (confirmed — nothing here is
// ever committed). Id: `upload:<hash16>`. Idempotent on re-upload — the same
// bytes hash to the same id, so a repeat upload is a no-op write, not a
// duplicate paper.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Paper } from "@/types";

// Mirrors `papers/pdf-text.ts`'s `resolveHelperScript` dual-candidate cwd
// resolution — the dev server and some test runners start from different
// working directories (repo root vs. `web/`). Anchored on a file that is
// always checked into the repo (the Python PDF-text helper), not on
// `.local-data/uploads` itself: that directory is gitignored and may not
// exist yet on a fresh checkout, so there's nothing to `existsSync` an
// upload directory against before the very first upload. Whichever root the
// Python helper resolves from is also the root the server actually runs
// from, so anchoring here keeps uploads and the extractor that reads them
// from ever silently splitting across two directories.
function resolveWebRoot(): string {
  const candidates = [process.cwd(), path.join(process.cwd(), "web")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "scripts", "extract_pdf_text.py"))) {
      return candidate;
    }
  }
  return process.cwd();
}

export const UPLOAD_DIR = path.join(resolveWebRoot(), ".local-data", "uploads");

/**
 * sha256 of the raw PDF bytes, first 16 hex chars — short enough for a URL
 * segment, long enough that a collision is not a real concern for this use
 * case.
 */
export function sha16(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex").slice(0, 16);
}

export function uploadId(hash16: string): string {
  return `upload:${hash16}`;
}

/** The bare hash16 from an `upload:<hash16>` id, or null when it isn't one. */
export function bareUploadId(itemId: string): string | null {
  const match = itemId.match(/^upload:([0-9a-f]{16})$/i);
  return match ? match[1].toLowerCase() : null;
}

export function pdfPath(hash16: string): string {
  return path.join(UPLOAD_DIR, `${hash16}.pdf`);
}

export function metaPath(hash16: string): string {
  return path.join(UPLOAD_DIR, `${hash16}.json`);
}

export interface UploadMeta {
  hash16: string;
  fileName: string;
  /** Largest-font first-page line, or the file name without its extension
   * when that heuristic isn't available — never a guessed title. */
  title: string;
  /** Only set when a real DOI was found by regex in the first pages. */
  doi?: string;
  pageCount?: number;
  /** The extracted `abstract` canonical bucket's text, when present. */
  summaryIntro?: string;
  uploadedAt: string;
}

async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true });
}

export async function readUploadMeta(hash16: string): Promise<UploadMeta | null> {
  try {
    const raw = await readFile(metaPath(hash16), "utf-8");
    return JSON.parse(raw) as UploadMeta;
  } catch {
    return null;
  }
}

export async function writeUploadMeta(hash16: string, meta: UploadMeta): Promise<void> {
  await ensureUploadDir();
  await writeFile(metaPath(hash16), JSON.stringify(meta, null, 2), "utf-8");
}

export function uploadFileExists(hash16: string): boolean {
  return existsSync(pdfPath(hash16));
}

/** Writes the PDF bytes only if this hash isn't already stored — the actual
 * idempotency guarantee (a repeat upload of the same file is a no-op here,
 * not a duplicate write). */
export async function writeUploadPdfIfAbsent(hash16: string, bytes: Buffer): Promise<void> {
  await ensureUploadDir();
  if (!uploadFileExists(hash16)) {
    await writeFile(pdfPath(hash16), bytes);
  }
}

/**
 * Maps a stored upload record onto the app's existing `Paper` shape (1-30)
 * rather than inventing a parallel record type — every downstream pipeline
 * stage (full-text, figures, the reading page, Save) already knows how to
 * read a `Paper`, so nothing else needs to learn a second shape.
 *
 * Every field left empty here is honestly unknown for an uploaded PDF, not
 * omitted by accident: no author list (1-26 does not attempt one — author
 * blocks vary too much across templates for a safe heuristic), no venue, no
 * relevance reason (nothing recommended this paper; the user brought it),
 * no experiment-keyword list. `source: "other"` is the closest honest fit —
 * this codebase's `PaperSource` union has no "upload" case and adding one
 * is out of scope here (nothing downstream branches on it for this path).
 */
export function uploadMetaToPaper(meta: UploadMeta): Paper {
  return {
    id: uploadId(meta.hash16),
    title: meta.title,
    authors: [],
    relevanceReason: "",
    venue: "",
    source: "other",
    summaryIntro: meta.summaryIntro ?? "",
    summaryExperimentKeywords: [],
    summaryResultDiscussion: "",
    linkPaper: `/api/papers/upload/${meta.hash16}/file`,
    doi: meta.doi,
    isSaved: false,
    pageCount: meta.pageCount,
  };
}
