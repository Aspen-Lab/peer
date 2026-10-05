// 1-23: everything the upload route (`app/api/papers/upload`) and the two
// `upload:`-aware pipeline branches (`full-text.ts`, `figures/extract.ts`)
// need to agree on about an uploaded PDF's id scheme and on-disk layout,
// defined exactly once — per Ruling 4 (§1e).
//
// Storage: `web/.local-data/uploads/<hash16>.pdf` + `<hash16>.json` (+ the
// extracted-text sidecar `<hash16>.doc.json`, P0-02, below), already
// covered by `web/.gitignore`'s `/.local-data` (confirmed — nothing here is
// ever committed). Id: `upload:<hash16>`. Idempotent on re-upload — the same
// bytes hash to the same id, so a repeat upload is a no-op write, not a
// duplicate paper.

import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile, readdir, unlink } from "node:fs/promises";
import path from "node:path";
import type { Paper, PreferenceConcept } from "@/types";
import type { ExtractedDocument } from "./html-text";

// The dev server and some test runners start from different working
// directories (repo root vs. `web/`), so the web root is found by a file
// that is always checked into it, not by `.local-data/uploads` itself: that
// directory is gitignored and may not exist yet on a fresh checkout, so
// there's nothing to `existsSync` an upload directory against before the
// very first upload. P0-03: the anchor was the Python PDF-text helper
// (`scripts/extract_pdf_text.py`), deleted when uploads moved to pdf.js; it
// is the web app's own `next.config.ts` now, which only `web/` has.
export function resolveWebRoot(cwd: string = process.cwd()): string {
  const candidates = [cwd, path.join(cwd, "web")];
  for (const candidate of candidates) {
    if (existsSync(path.join(candidate, "next.config.ts"))) {
      return candidate;
    }
  }
  return cwd;
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

// P0-10 (§1e.10): the upload-id rule lives in `upload-id.ts` (no `node:`
// import, so the browser shares it); re-exported here so every existing
// import from this module keeps working.
export { bareUploadId, claimsUploadId } from "./upload-id";

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

/** P0-02: the text Peer read out of the upload, beside it. */
export function docPath(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return path.join(UPLOAD_DIR, `${hash16}.doc.json`);
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
    preferenceSignalsRecordedAt: meta.preferenceSignalsRecordedAt,
    extractionVersion: meta.extractionVersion,
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

// ── P0-02: the extracted document, cached for its owner ───────────────
//
// Reading an upload used to mean reading the PDF again on every open — the
// reading request and the report request each, every visit — because the
// server kept only the file and a small record. The `ExtractedDocument` is
// now kept for the hour in memory and, after that, in `<hash16>.doc.json`
// beside the upload: owner-only (0600), written whole or not at all (a temp
// file renamed into place), and removed with the upload by `deleteUpload`,
// the purge job and the operator's takedown.
//
// The cache key is `owner|hash16|revision|extractionVersion`. The file holds
// a digest of that key, never the owner key itself, and a read under any
// other key — another revision, a newer extractor, another owner — misses.
// Callers look it up only after the owner check has passed
// (`full-text.ts`); nothing here decides who may read an upload.

const DOC_CACHE_TTL_MS = 60 * 60 * 1000;
const DOC_CACHE_KEEP = 32;
const recentDocs = new Map<string, { key: string; doc: ExtractedDocument; ts: number }>();

export function uploadDocKey(
  ownerKey: string,
  hash16: string,
  revision: number | undefined,
  extractionVersion: number,
): string {
  return `${ownerKey}|${hash16}|${revision ?? ""}|${extractionVersion}`;
}

function keyDigest(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function rememberDoc(hash16: string, key: string, doc: ExtractedDocument): void {
  recentDocs.delete(hash16);
  recentDocs.set(hash16, { key, doc, ts: Date.now() });
  while (recentDocs.size > DOC_CACHE_KEEP) {
    const oldest = recentDocs.keys().next().value;
    if (oldest === undefined) break;
    recentDocs.delete(oldest);
  }
}

function looksLikeDocument(value: unknown): value is ExtractedDocument {
  if (!value || typeof value !== "object") return false;
  const doc = value as Partial<ExtractedDocument>;
  return Array.isArray(doc.sections) && Array.isArray(doc.figureCaptions) && typeof doc.source === "string";
}

/** The document cached under exactly `key`, from memory or the sidecar; null
 *  when there is none, it is stale, or it was written under another key. */
export async function readUploadDoc(hash16: string, key: string): Promise<ExtractedDocument | null> {
  const hit = recentDocs.get(hash16);
  if (hit && hit.key === key && Date.now() - hit.ts <= DOC_CACHE_TTL_MS) return hit.doc;
  try {
    const stored = JSON.parse(await readFile(docPath(hash16), "utf-8")) as { key?: unknown; doc?: unknown };
    if (stored.key !== keyDigest(key) || !looksLikeDocument(stored.doc)) return null;
    rememberDoc(hash16, key, stored.doc);
    return stored.doc;
  } catch {
    return null;
  }
}

/** Keep `doc` for `key`: in memory, and in the sidecar via a temp file
 *  renamed into place, so a reader never sees half a file. */
export async function writeUploadDoc(hash16: string, key: string, doc: ExtractedDocument): Promise<void> {
  const target = docPath(hash16);
  rememberDoc(hash16, key, doc);
  await ensureUploadDir();
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, JSON.stringify({ key: keyDigest(key), doc }), { encoding: "utf-8", mode: 0o600 });
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

/** Forget the extracted document: the memory entry and the sidecar. */
export async function removeUploadDoc(hash16: string): Promise<void> {
  recentDocs.delete(hash16);
  await unlink(docPath(hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
}

export async function deleteUpload(meta: UploadMeta): Promise<void> {
  // Remove permission/metadata first, then the file, then the text Peer
  // read out of it (P0-02).
  await unlink(metaPath(meta.hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await unlink(pdfPath(meta.hash16)).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
  });
  await removeUploadDoc(meta.hash16);
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
    if (/^[0-9a-f]{16}\.doc\.json$/.test(name)) {
      // P0-02: a sidecar outlives nothing. One whose upload is gone (a
      // delete that raced a write) or taken down is removed here; an expired
      // upload's goes with it through `deleteUpload` below.
      const owner = await readUploadMeta(name.slice(0, 16));
      if (!owner || owner.status === "blocked" || owner.status === "deleted") await removeUploadDoc(name.slice(0, 16));
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
