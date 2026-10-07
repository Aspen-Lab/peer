// 1-23: everything the upload route (`app/api/papers/upload`) and the two
// `upload:`-aware pipeline branches (`full-text.ts`, `figures/extract.ts`)
// need to agree on about an uploaded PDF's id scheme and storage layout,
// defined exactly once — per Ruling 4 (§1e).
//
// Storage: `<hash16>.pdf` + `<hash16>.json` (+ `<sha256>.attachment.json`
// for a PDF supplementing another paper, + the extracted-text sidecar
// `<hash16>.doc.json`, P0-02, below), held by `upload-backend.ts` —
// `web/.local-data/uploads/` locally (covered by `web/.gitignore`'s
// `/.local-data`, never committed), `PEER_PRIVATE_UPLOAD_DIR` when
// self-hosting, or a private Supabase Storage bucket when
// `PEER_UPLOAD_BUCKET` is set. The bucket also keeps
// `owners/<ownerKey>/<hash16>` markers, so one reader's list never reads
// every reader's records, and `incoming/<ownerKey>/` for PDFs the browser
// put there directly (see `createStagedUpload`). Id: `upload:<hash16>`.
// Idempotent on re-upload — the same bytes hash to the same id, so a repeat
// upload is a no-op write, not a duplicate paper.

import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Paper, PreferenceConcept } from "@/types";
import type { ExtractedDocument } from "./html-text";
import { createSignedUploadTicket, UPLOAD_DIR, uploadBackend } from "./upload-backend";

// P0-03: `resolveWebRoot` is anchored on the web app's own `next.config.ts`
// (it was the Python text helper, deleted when uploads moved to pdf.js); it
// lives with `UPLOAD_DIR` in `upload-backend.ts` and is re-exported here so
// the tests that pin both keep importing them from this module.
export { resolveWebRoot, UPLOAD_DIR } from "./upload-backend";

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

function pdfName(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return `${hash16}.pdf`;
}

function metaName(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return `${hash16}.json`;
}

/** P0-02: the object name of the text Peer read out of the upload, beside it. */
function docName(hash16: string): string {
  if (!isValidHash16(hash16)) throw new Error("Invalid upload id");
  return `${hash16}.doc.json`;
}

/** P0-02: where the sidecar sits when the backend is the disk. */
export function docPath(hash16: string): string {
  return path.join(UPLOAD_DIR, docName(hash16));
}

/** Owner keys are sha256 hex; nothing else ever becomes a folder name. */
function isValidOwnerKey(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function ownerMarkerName(ownerKey: string, hash16: string): string | null {
  return isValidOwnerKey(ownerKey) && isValidHash16(hash16) ? `owners/${ownerKey}/${hash16}` : null;
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

export async function readUploadMeta(hash16: string): Promise<UploadMeta | null> {
  try {
    const raw = await uploadBackend().read(metaName(hash16));
    return raw ? JSON.parse(raw.toString("utf-8")) as UploadMeta : null;
  } catch {
    return null;
  }
}

export async function writeUploadMeta(hash16: string, meta: UploadMeta): Promise<void> {
  const backend = uploadBackend();
  await backend.write(metaName(hash16), JSON.stringify(meta, null, 2), "application/json");
  // The bucket lists one owner's records through these markers; the disk
  // backend scans its one directory instead (see `candidateHashes`).
  const marker = backend.kind === "supabase" && meta.ownerKey ? ownerMarkerName(meta.ownerKey, hash16) : null;
  if (marker) await backend.write(marker, "", "text/plain");
}

export async function uploadFileExists(hash16: string): Promise<boolean> {
  return uploadBackend().exists(pdfName(hash16));
}

/** The stored PDF's bytes, or null when they are gone. */
export async function readUploadPdf(hash16: string): Promise<Buffer | null> {
  return uploadBackend().read(pdfName(hash16));
}

/** Removes only the PDF bytes (the operator takedown keeps a minimal record). */
export async function removeUploadPdf(hash16: string): Promise<void> {
  await uploadBackend().remove([pdfName(hash16)]);
}

/**
 * Runs `read` with a local file path to the stored PDF, for the one reader
 * that needs a path rather than bytes (the figure extractor, a separate
 * process). On disk that is the stored file itself — no second copy; from
 * the bucket it is a private temp copy, removed once `read` settles. Null
 * when the PDF is gone.
 */
export async function withUploadPdfFile<T>(hash16: string, read: (filePath: string) => Promise<T>): Promise<T | null> {
  const backend = uploadBackend();
  if (backend.kind === "disk") {
    return (await backend.exists(pdfName(hash16))) ? read(pdfPath(hash16)) : null;
  }
  const bytes = await backend.read(pdfName(hash16));
  if (!bytes) return null;
  const dir = await mkdtemp(path.join(tmpdir(), "peer-upload-read-"));
  try {
    const filePath = path.join(dir, "paper.pdf");
    await writeFile(filePath, bytes, { mode: 0o600 });
    return await read(filePath);
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

/** Writes the PDF bytes only if this hash isn't already stored — the actual
 * idempotency guarantee (a repeat upload of the same file is a no-op here,
 * not a duplicate write). */
export async function writeUploadPdfIfAbsent(hash16: string, bytes: Buffer): Promise<void> {
  if (!(await uploadFileExists(hash16))) {
    await uploadBackend().write(pdfName(hash16), bytes, "application/pdf");
  }
}

// ── Direct-to-bucket uploads ─────────────────────────────────────────
// A Vercel function refuses a request body much over 4 MB, and a paper's
// PDF is often larger. So with the bucket, the browser puts the PDF in
// `incoming/<ownerKey>/` itself, then names it to the upload route, which
// reads it back and files it like any other upload. The route removes a
// staged object as soon as it is done with it; `purgeExpiredUploads` sweeps
// any left behind for more than a day.

const STAGED_NAME_RE = /^incoming\/([0-9a-f]{64})\/[0-9a-f-]{36}\.pdf$/;
const STAGED_MAX_AGE_MS = 24 * 3600_000;

/** True when uploads go through the bucket, so the browser should stage. */
export function stagedUploadsAvailable(): boolean {
  return uploadBackend().kind === "supabase";
}

/** A one-time ticket for the browser to put one PDF in this owner's folder. */
export async function createStagedUpload(ownerKey: string): Promise<{ bucket: string; path: string; token: string }> {
  if (!isValidOwnerKey(ownerKey)) throw new Error("Invalid owner");
  return createSignedUploadTicket(`incoming/${ownerKey}/${randomUUID()}.pdf`);
}

/** Whether `name` is a staged object inside this owner's own folder. */
export function isOwnStagedUpload(ownerKey: string, name: string): boolean {
  const match = name.match(STAGED_NAME_RE);
  return !!match && match[1] === ownerKey;
}

/** The staged PDF's bytes, or null when it is missing or not this owner's. */
export async function readStagedUpload(ownerKey: string, name: string): Promise<Buffer | null> {
  if (!stagedUploadsAvailable() || !isOwnStagedUpload(ownerKey, name)) return null;
  return uploadBackend().read(name);
}

export async function removeStagedUpload(ownerKey: string, name: string): Promise<void> {
  if (!stagedUploadsAvailable() || !isOwnStagedUpload(ownerKey, name)) return;
  await uploadBackend().remove([name]).catch((error) => {
    console.warn("[upload] could not remove a staged PDF:", error);
  });
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

function attachmentName(ownerKey: string, paperId: string): string {
  const key = createHash("sha256").update(`${ownerKey}\n${paperId}`).digest("hex");
  return `${key}.attachment.json`;
}

export async function attachUpload(ownerKey: string, paperId: string, hash16: string): Promise<void> {
  await uploadBackend().write(attachmentName(ownerKey, paperId), JSON.stringify({ hash16 }), "application/json");
}

export async function attachedUploadHash(ownerKey: string, paperId: string): Promise<string | null> {
  try {
    const raw = await uploadBackend().read(attachmentName(ownerKey, paperId));
    if (!raw) return null;
    const value = JSON.parse(raw.toString("utf-8"));
    return typeof value.hash16 === "string" && isValidHash16(value.hash16) ? value.hash16 : null;
  } catch { return null; }
}

// ── P0-02: the extracted document, cached for its owner ───────────────
//
// Reading an upload used to mean reading the PDF again on every open — the
// reading request and the report request each, every visit — because the
// server kept only the file and a small record. The `ExtractedDocument` is
// now kept for the hour in memory and, after that, in `<hash16>.doc.json`
// beside the upload, in whichever backend holds the upload (the disk, owner-only
// 0600, or the private bucket): written whole or not at all (on disk a temp file
// renamed into place; an object upload replaces the object whole), and removed
// with the upload by `deleteUpload`, the purge job and the operator's takedown.
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
    const raw = await uploadBackend().read(docName(hash16));
    if (!raw) return null;
    const stored = JSON.parse(raw.toString("utf-8")) as { key?: unknown; doc?: unknown };
    if (stored.key !== keyDigest(key) || !looksLikeDocument(stored.doc)) return null;
    rememberDoc(hash16, key, stored.doc);
    return stored.doc;
  } catch {
    return null;
  }
}

/** Keep `doc` for `key`: in memory, and in the sidecar. On the disk the file
 *  is written under a temp name and renamed into place, so a reader never sees
 *  half a file; a leftover temp file is swept by `purgeExpiredUploads` (`.tmp`). */
export async function writeUploadDoc(hash16: string, key: string, doc: ExtractedDocument): Promise<void> {
  const backend = uploadBackend();
  const name = docName(hash16);
  const payload = JSON.stringify({ key: keyDigest(key), doc });
  rememberDoc(hash16, key, doc);
  if (backend.kind !== "disk") {
    await backend.write(name, payload, "application/json");
    return;
  }
  const temporary = `${name}.${randomUUID()}.tmp`;
  try {
    await backend.write(temporary, payload, "application/json");
    await rename(path.join(UPLOAD_DIR, temporary), docPath(hash16));
  } catch (error) {
    await backend.remove([temporary]).catch(() => undefined);
    throw error;
  }
}

/** Forget the extracted document: the memory entry and the sidecar. */
export async function removeUploadDoc(hash16: string): Promise<void> {
  recentDocs.delete(hash16);
  await uploadBackend().remove([docName(hash16)]);
}

export async function deleteUpload(meta: UploadMeta): Promise<void> {
  const backend = uploadBackend();
  // Remove permission/metadata first, then the file, then the text Peer
  // read out of it (P0-02).
  await backend.remove([metaName(meta.hash16)]);
  await backend.remove([pdfName(meta.hash16)]);
  await removeUploadDoc(meta.hash16);
  for (const paperId of meta.paperIds ?? []) {
    if (meta.ownerKey && await attachedUploadHash(meta.ownerKey, paperId) === meta.hash16) {
      await backend.remove([attachmentName(meta.ownerKey, paperId)]).catch(() => undefined);
    }
  }
  const marker = backend.kind === "supabase" && meta.ownerKey ? ownerMarkerName(meta.ownerKey, meta.hash16) : null;
  if (marker) await backend.remove([marker]).catch(() => undefined);
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
  const backend = uploadBackend();
  const objects = await backend.list("").catch(() => []);
  for (const { name } of objects) {
    if (STRAY_UPLOAD_FILE_PATTERNS.some((pattern) => pattern.test(name))) {
      await backend.remove([name]).catch(() => undefined);
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
  if (backend.kind === "supabase") await purgeAbandonedStagedUploads();
}

/** Staged PDFs the browser put in the bucket that no upload ever claimed. */
async function purgeAbandonedStagedUploads(): Promise<void> {
  const backend = uploadBackend();
  const owners = (await backend.listFolders("incoming").catch(() => [])).filter(isValidOwnerKey);
  for (const owner of owners) {
    const staged = await backend.list(`incoming/${owner}`).catch(() => []);
    const stale = staged
      .filter((entry) => !entry.createdAt || Date.now() - Date.parse(entry.createdAt) > STAGED_MAX_AGE_MS)
      .map((entry) => `incoming/${owner}/${entry.name}`)
      .filter((name) => STAGED_NAME_RE.test(name));
    if (stale.length > 0) await backend.remove(stale).catch(() => undefined);
  }
}

/**
 * The hash16 of every record worth reading for `ownerKey`. A superset is
 * fine — `listUploadMeta` still checks each record's own `ownerKey` — but
 * the bucket narrows to the owner's markers so one reader's list never
 * downloads every reader's records; the disk backend scans its directory.
 */
async function candidateHashes(ownerKey: string): Promise<string[]> {
  const backend = uploadBackend();
  if (backend.kind === "supabase") {
    if (!isValidOwnerKey(ownerKey)) return [];
    const markers = await backend.list(`owners/${ownerKey}`).catch(() => []);
    return markers.map((entry) => entry.name).filter(isValidHash16);
  }
  const objects = await backend.list("").catch(() => []);
  return objects
    .map((entry) => entry.name)
    .filter((name) => /^[0-9a-f]{16}\.json$/.test(name))
    .map((name) => name.slice(0, 16));
}

export async function listUploadMeta(ownerKey: string): Promise<UploadMeta[]> {
  const out: UploadMeta[] = [];
  for (const hash16 of await candidateHashes(ownerKey)) {
    const meta = await readUploadMeta(hash16);
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
