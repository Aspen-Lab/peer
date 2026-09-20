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
import { mkdir, readFile, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { Paper, PreferenceConcept } from "@/types";

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

export const UPLOAD_DIR = process.env.PEER_PRIVATE_UPLOAD_DIR || path.join(resolveWebRoot(), ".local-data", "uploads");

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

/**
 * Exactly 16 lowercase-or-uppercase hex chars — the shape `sha16` always
 * produces. The two `GET` upload routes take a hash16 straight from a URL
 * path segment; validating it here before it ever reaches `pdfPath`/
 * `metaPath` (a plain `path.join`) is what keeps a hand-crafted id like
 * `../../.env` from resolving outside `UPLOAD_DIR`.
 */
export function isValidHash16(value: string): boolean {
  return /^[0-9a-f]{16}$/i.test(value);
}

export function pdfPath(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return path.join(UPLOAD_DIR, `${hash16}.pdf`);
}

export function metaPath(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return path.join(UPLOAD_DIR, `${hash16}.json`);
}

export interface UploadMeta {
  ownerKey?: string;
  expiresAt?: string;
  rightsVersion?: string;
  rightsAcceptedAt?: string;
  paperIds?: string[];
  preferenceSignals?: PreferenceConcept[];
  /** Stable within an owner; DOI when known, otherwise the PDF content hash. */
  documentKey?: string;
  /**
   * 9-12/9-13 (A9-15, A9-13, A9-10): required on every new write; absent only
   * on legacy meta written before this field existed. `ownedUpload` treats a
   * legacy record with no `status` as "ready" (it already required
   * `ownerKey`+`expiresAt`, which legacy unowned files never have) — but any
   * record that DOES carry an explicit `status` must be exactly "ready".
   * Write order (9-13): "pending" -> PDF bytes written -> "ready"; a failure
   * partway removes both the meta and any partial PDF bytes rather than
   * leaving a stuck "pending" record.
   */
  status?: "pending" | "ready" | "deleted" | "blocked";
  /**
   * 9-12 (A9-10, matrix B7): monotonic per owner+document, starting at 1.
   * Unchanged by an idempotent re-upload of the same bytes (that's a
   * refresh, not a new version). Bumped when a new physical asset (a
   * different hash16) supersedes a still-live one for the same owner —
   * either the same `documentKey` (a DOI-verified new PDF of the same
   * document) or the same attached paper — so report/reading/figure caches
   * keyed on it (9-15) never mix an old and a new attachment.
   */
  revision?: number;
  /** 9-19 (A9-06): set only by the operator takedown route, alongside
   *  `status: "blocked"` — an audit timestamp, never displayed to the owner
   *  as anything but "no longer available". */
  blockedAt?: string;
  /** 9-21 (A9-04/A9-11): the `extractUploadConcepts` algorithm version that
   * produced `preferenceSignals` below — mirrors the per-concept field of
   * the same name (`UPLOAD_CONCEPT_EXTRACTION_VERSION`). */
  extractionVersion?: number;
  /** 9-23 (A9-07): when `preferenceSignals` was last (re)computed — the
   * server-side audit timestamp a client's idempotent list-load merge can
   * point back to. Not itself part of the idempotency check (that's still
   * per-`documentKey`, in the ledger). */
  preferenceSignalsRecordedAt?: string;
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
  /**
   * Ruling 9 (§1j) / A2-02: "ok" when the extractor found at least one
   * section of real text; "empty" when it read the file successfully but
   * found nothing extractable (most likely a scanned PDF with no text
   * layer). Set once, at upload time, from a fact upload/route.ts already
   * has (doc.sections.length) — never re-derived downstream. Required (not
   * optional) here: the upload route always knows the answer at write
   * time, unlike `Paper.textStatus`, which is unset for every non-upload
   * source.
   */
  textStatus: "ok" | "empty";
}

async function ensureUploadDir(): Promise<void> {
  await mkdir(UPLOAD_DIR, { recursive: true, mode: 0o700 });
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
  await writeFile(metaPath(hash16), JSON.stringify(meta, null, 2), { encoding: "utf-8", mode: 0o600 });
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
    await writeFile(pdfPath(hash16), bytes, { mode: 0o600 });
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
    summaryExperimentKeywords: (meta.preferenceSignals ?? []).map((c) => c.label),
    preferenceSignals: meta.preferenceSignals,
    uploadDocumentKey: meta.documentKey,
    revision: meta.revision,
    summaryResultDiscussion: "",
    linkPaper: `/api/papers/upload/${meta.hash16}/file`,
    doi: meta.doi,
    isSaved: false,
    pageCount: meta.pageCount,
    textStatus: meta.textStatus,
  };
}

/** Content IDs are private to an owner, so another account cannot guess them
 * from a publisher PDF's publicly known hash or reuse another reader's file. */
export function privateUploadHash(ownerKey: string, bytes: Buffer): string {
  return createHash("sha256").update(ownerKey).update(bytes).digest("hex").slice(0, 16);
}

function attachmentPath(ownerKey: string, paperId: string): string {
  const key = createHash("sha256").update(`${ownerKey}\n${paperId}`).digest("hex");
  return path.join(UPLOAD_DIR, `${key}.attachment.json`);
}

export async function attachUpload(ownerKey: string, paperId: string, hash16: string): Promise<void> {
  await ensureUploadDir();
  await writeFile(attachmentPath(ownerKey, paperId), JSON.stringify({ hash16 }), { mode: 0o600 });
}

export async function attachedUploadHash(ownerKey: string, paperId: string): Promise<string | null> {
  try {
    const value = JSON.parse(await readFile(attachmentPath(ownerKey, paperId), "utf-8"));
    return typeof value.hash16 === "string" && isValidHash16(value.hash16) ? value.hash16 : null;
  } catch { return null; }
}

export async function deleteUpload(meta: UploadMeta): Promise<void> {
  // Remove permission/metadata first. No derived upload content is cached.
  await unlink(metaPath(meta.hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await unlink(pdfPath(meta.hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  for (const paperId of meta.paperIds ?? []) {
    if (meta.ownerKey && await attachedUploadHash(meta.ownerKey, paperId) === meta.hash16) {
      await unlink(attachmentPath(meta.ownerKey, paperId)).catch(() => undefined);
    }
  }
}

// 9-16 (A9-03): a closed list of derived-file names/patterns that do not
// belong in `UPLOAD_DIR` at all — never a wildcard. `figures.json` was the
// pre-fix (C4) shared intermediate file `figures/pdf-extract.ts` used to
// write directly into this directory; that code path no longer exists (each
// extraction now uses its own `mkdtemp` under the OS temp dir, cleaned up in
// a `finally` block — confirmed by reading `pdf-extract.ts`, which never
// writes into `UPLOAD_DIR` at all today), but a leftover from before that
// fix, or any future regression that reintroduces the pattern, is still
// worth sweeping. `*.tmp` is a defensive, generic leftover-write pattern.
// There is no `extract-*` temp-DIRECTORY pattern to add here: the
// extractor's temp dirs (`peer-pdf-figures-*`, `peer-pdf-*`) are created
// under `tmpdir()`, never under `UPLOAD_DIR`, so they can never appear in
// this listing regardless.
const STRAY_UPLOAD_FILE_PATTERNS: RegExp[] = [/^figures\.json$/, /\.tmp$/];

export async function purgeExpiredUploads(): Promise<void> {
  const names = await readdir(UPLOAD_DIR).catch(() => [] as string[]);
  for (const name of names) {
    if (STRAY_UPLOAD_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
      await unlink(path.join(UPLOAD_DIR, name)).catch(() => undefined);
      continue;
    }
    if (!/^[0-9a-f]{16}\.json$/.test(name)) continue;
    const meta = await readUploadMeta(name.slice(0, 16));
    if (meta?.expiresAt && Date.parse(meta.expiresAt) <= Date.now()) await deleteUpload(meta);
  }
}

export async function listUploadMeta(ownerKey: string): Promise<UploadMeta[]> {
  const names = await readdir(UPLOAD_DIR).catch(() => [] as string[]);
  const out: UploadMeta[] = [];
  for (const name of names) {
    if (!/^[0-9a-f]{16}\.json$/.test(name)) continue;
    const meta = await readUploadMeta(name.slice(0, 16));
    if (meta?.ownerKey === ownerKey && meta.expiresAt && Date.parse(meta.expiresAt) > Date.now()) out.push(meta);
  }
  return out.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

/**
 * 9-22 (A9-02): true when this owner has at least one OTHER `ready` asset
 * sharing `documentKey` — i.e. the caller (a delete or an operator block)
 * must NOT retract this document's shared preference-ledger evidence,
 * because a still-live copy of the same logical document continues to
 * justify it. `listUploadMeta` already excludes anything without a live,
 * unexpired `expiresAt` (which a blocked/deleted record never carries), but
 * checks `status === "ready"` explicitly too, defensively, rather than
 * relying on that as an implicit proxy — a transient "pending" write (9-13)
 * must never count as a live sibling either.
 */
export async function hasOtherReadyDocumentCopy(
  ownerKey: string,
  documentKey: string | undefined,
  excludeHash16: string,
): Promise<boolean> {
  if (!documentKey) return false;
  const siblings = await listUploadMeta(ownerKey);
  return siblings.some((sibling) =>
    sibling.hash16 !== excludeHash16 &&
    sibling.status === "ready" &&
    sibling.documentKey === documentKey,
  );
}
