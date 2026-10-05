import { existsSync } from "node:fs";
import { readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import type { ExtractedDocument } from "./html-text";
import {
  bareUploadId,
  deleteUpload,
  docPath,
  hasOtherReadyDocumentCopy,
  metaPath,
  pdfPath,
  purgeExpiredUploads,
  readUploadDoc,
  readUploadMeta,
  resolveWebRoot,
  sha16,
  uploadDocKey,
  uploadFileExists,
  UPLOAD_DIR,
  uploadId,
  uploadMetaToPaper,
  writeUploadDoc,
  writeUploadMeta,
  writeUploadPdfIfAbsent,
  type UploadMeta,
} from "./upload-store";

const writtenHashes: string[] = [];

afterEach(async () => {
  await Promise.all(
    writtenHashes.splice(0).map(async (hash16) => {
      await rm(pdfPath(hash16), { force: true });
      await rm(metaPath(hash16), { force: true });
      await rm(docPath(hash16), { force: true });
    }),
  );
});

// P0-02 (spec D0): the text Peer read out of an upload is kept beside the
// upload — a JSON sidecar, owner-only, written whole or not at all — so the
// second open of the same PDF does not read the PDF again. It lives and dies
// with the upload.
describe("the extracted-document sidecar (P0-02)", () => {
  const doc: ExtractedDocument = {
    title: "A Sidecar Fixture",
    sections: [{ id: "s0", heading: "1 Introduction", canonical: "introduction", text: "Fixture prose.", page: 1 }],
    figureCaptions: [],
    source: "pdf",
    pageCount: 3,
    reason: null,
  };
  const ownerKey = "owner-under-test-p0-02";

  it("writes <hash16>.doc.json owner-only, with no temp file left, and reads it back only under the same key", async () => {
    const hash16 = sha16(Buffer.from("p0-02: sidecar round trip"));
    writtenHashes.push(hash16);
    const key = uploadDocKey(ownerKey, hash16, 1, 2);

    await writeUploadDoc(hash16, key, doc);

    expect(path.basename(docPath(hash16))).toBe(`${hash16}.doc.json`);
    expect((await stat(docPath(hash16))).mode & 0o777).toBe(0o600);
    expect((await readdir(UPLOAD_DIR)).filter((name) => name.startsWith(hash16) && name.endsWith(".tmp"))).toEqual([]);
    // The owner's key is not written into the file; a digest of the whole
    // cache key is.
    expect(await readFile(docPath(hash16), "utf-8")).not.toContain(ownerKey);

    expect(await readUploadDoc(hash16, key)).toEqual(doc);
    // Another revision, another extraction version or another owner is a
    // different key, and gets nothing.
    expect(await readUploadDoc(hash16, uploadDocKey(ownerKey, hash16, 2, 2))).toBeNull();
    expect(await readUploadDoc(hash16, uploadDocKey(ownerKey, hash16, 1, 3))).toBeNull();
    expect(await readUploadDoc(hash16, uploadDocKey("another-owner", hash16, 1, 2))).toBeNull();
  });

  it("is removed with the upload by deleteUpload", async () => {
    const hash16 = sha16(Buffer.from("p0-02: deleted with the upload"));
    writtenHashes.push(hash16);
    const meta: UploadMeta = {
      hash16, fileName: "paper.pdf", title: "A Real Paper", uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok", status: "ready", revision: 1, ownerKey,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    };
    await writeUploadMeta(hash16, meta);
    await writeUploadPdfIfAbsent(hash16, Buffer.from("%PDF-1.4 p0-02 delete fixture"));
    const key = uploadDocKey(ownerKey, hash16, 1, 2);
    await writeUploadDoc(hash16, key, doc);

    await deleteUpload(meta);

    expect(existsSync(docPath(hash16))).toBe(false);
    expect(existsSync(pdfPath(hash16))).toBe(false);
    expect(existsSync(metaPath(hash16))).toBe(false);
    // Nothing is served from memory once the upload is gone either.
    expect(await readUploadDoc(hash16, key)).toBeNull();
  });

  it("is removed by the purge job with an expired upload, and swept when its upload is gone or blocked", async () => {
    const expired = sha16(Buffer.from("p0-02: expired upload"));
    const orphan = sha16(Buffer.from("p0-02: orphaned sidecar"));
    const blocked = sha16(Buffer.from("p0-02: blocked upload"));
    const live = sha16(Buffer.from("p0-02: live upload"));
    writtenHashes.push(expired, orphan, blocked, live);
    const base = { fileName: "paper.pdf", title: "A Real Paper", uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok" as const, status: "ready" as const, revision: 1, ownerKey };
    await writeUploadMeta(expired, { ...base, hash16: expired, expiresAt: new Date(Date.now() - 1000).toISOString() });
    await writeUploadMeta(live, { ...base, hash16: live, expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    await writeUploadMeta(blocked, { hash16: blocked, fileName: "", title: "", uploadedAt: base.uploadedAt,
      textStatus: "empty", status: "blocked", ownerKey });
    for (const hash16 of [expired, orphan, blocked, live]) {
      await writeUploadDoc(hash16, uploadDocKey(ownerKey, hash16, 1, 2), doc);
    }

    await purgeExpiredUploads();

    expect(existsSync(docPath(expired))).toBe(false);
    expect(existsSync(docPath(orphan))).toBe(false);
    expect(existsSync(docPath(blocked))).toBe(false);
    // A live upload keeps the text Peer already read out of it.
    expect(existsSync(docPath(live))).toBe(true);
  });
});

// P0-03: the upload directory used to be anchored on the Python text helper
// (`scripts/extract_pdf_text.py`) being present under the web root. That
// helper is deleted; the anchor is the web app's own `next.config.ts`, so
// the dev server started from the repo root and the test runner started
// from `web/` still agree on one `web/.local-data/uploads`.
describe("resolveWebRoot / UPLOAD_DIR (P0-03)", () => {
  const webRoot = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));

  it("finds web/ from web/ itself and from the repository root", () => {
    expect(resolveWebRoot(webRoot)).toBe(webRoot);
    expect(resolveWebRoot(path.dirname(webRoot))).toBe(webRoot);
  });

  it.skipIf(Boolean(process.env.PEER_PRIVATE_UPLOAD_DIR))("puts uploads under web/.local-data/uploads", () => {
    expect(UPLOAD_DIR).toBe(path.join(webRoot, ".local-data", "uploads"));
  });
});

describe("sha16 / uploadId / bareUploadId", () => {
  it("is deterministic for the same bytes", () => {
    const bytes = Buffer.from("%PDF-1.4 test bytes");
    expect(sha16(bytes)).toBe(sha16(Buffer.from(bytes)));
  });

  it("differs for different bytes", () => {
    expect(sha16(Buffer.from("a"))).not.toBe(sha16(Buffer.from("b")));
  });

  it("round-trips through uploadId / bareUploadId", () => {
    const hash16 = sha16(Buffer.from("round trip"));
    expect(bareUploadId(uploadId(hash16))).toBe(hash16);
  });

  it("rejects an id that isn't upload-shaped", () => {
    expect(bareUploadId("openalex:W123")).toBeNull();
    expect(bareUploadId("upload:tooshort")).toBeNull();
  });
});

describe("writeUploadPdfIfAbsent — idempotent on re-upload", () => {
  it("writes once and a repeat upload of the same bytes is a no-op, not an error", async () => {
    const bytes = Buffer.from("%PDF-1.4 idempotency test\n");
    const hash16 = sha16(bytes);
    writtenHashes.push(hash16);

    await writeUploadPdfIfAbsent(hash16, bytes);
    expect(uploadFileExists(hash16)).toBe(true);
    const firstWrite = await readFile(pdfPath(hash16));

    // Re-upload: must not throw, and must not corrupt the stored file even
    // if handed different (e.g. truncated) bytes under the same hash — the
    // guarantee is "no-op", not "last write wins".
    await writeUploadPdfIfAbsent(hash16, Buffer.from("different bytes, same claimed hash"));
    const secondRead = await readFile(pdfPath(hash16));
    expect(secondRead.equals(firstWrite)).toBe(true);
  });
});

describe("readUploadMeta / writeUploadMeta", () => {
  it("returns null for a hash that was never written", async () => {
    expect(await readUploadMeta("0000000000000000")).toBeNull();
  });

  it("round-trips a written record", async () => {
    const hash16 = sha16(Buffer.from("meta round trip"));
    writtenHashes.push(hash16);
    const meta: UploadMeta = {
      hash16,
      fileName: "my-paper.pdf",
      title: "A Study Of Things",
      pageCount: 12,
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
    };

    await writeUploadMeta(hash16, meta);
    expect(await readUploadMeta(hash16)).toEqual(meta);
  });
});

describe("uploadMetaToPaper — honesty of the mapped Paper record", () => {
  it("never invents an author, venue, or DOI the meta didn't have", () => {
    const meta: UploadMeta = {
      hash16: "abcdef0123456789",
      fileName: "no-metadata-found.pdf",
      title: "no-metadata-found",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
    };

    const paper = uploadMetaToPaper(meta);

    expect(paper.id).toBe("upload:abcdef0123456789");
    expect(paper.authors).toEqual([]);
    expect(paper.venue).toBe("");
    expect(paper.doi).toBeUndefined();
    expect(paper.relevanceReason).toBe("");
    expect(paper.linkPaper).toBe("/api/papers/upload/abcdef0123456789/file");
    expect(paper.isSaved).toBe(false);
  });

  it("carries a found DOI, page count, and extracted abstract through", () => {
    const meta: UploadMeta = {
      hash16: "abcdef0123456789",
      fileName: "paper.pdf",
      title: "A Real Title",
      doi: "10.1000/example",
      pageCount: 20,
      summaryIntro: "This paper studies things.",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
    };

    const paper = uploadMetaToPaper(meta);

    expect(paper.doi).toBe("10.1000/example");
    expect(paper.pageCount).toBe(20);
    expect(paper.summaryIntro).toBe("This paper studies things.");
  });

  it("2-05: forwards textStatus onto the mapped Paper record", () => {
    const emptyMeta: UploadMeta = {
      hash16: "abcdef0123456789",
      fileName: "scanned.pdf",
      title: "scanned",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "empty",
    };
    const okMeta: UploadMeta = {
      hash16: "abcdef0123456789",
      fileName: "paper.pdf",
      title: "A Real Title",
      uploadedAt: "2026-09-15T00:00:00.000Z",
      textStatus: "ok",
    };

    expect(uploadMetaToPaper(emptyMeta).textStatus).toBe("empty");
    expect(uploadMetaToPaper(okMeta).textStatus).toBe("ok");
  });
});

// 9-16 (A9-03): purgeExpiredUploads sweeps a closed list of derived-file
// names/patterns that do not belong in UPLOAD_DIR — never a wildcard, and
// never anything that could match a real <hash16>.pdf/.json/.attachment.json.
describe("purgeExpiredUploads — stray derived files (9-16)", () => {
  it("removes a legacy figures.json and any *.tmp leftover, but leaves a live, unexpired upload alone", async () => {
    const strayFiguresJson = path.join(UPLOAD_DIR, "figures.json");
    const strayTmp = path.join(UPLOAD_DIR, "some-leftover.tmp");
    await writeFile(strayFiguresJson, "stale derived image data — a fixture, not a real figure", "utf-8");
    await writeFile(strayTmp, "stale temp data", "utf-8");

    const liveHash = sha16(Buffer.from("purge fixture: still-live upload"));
    writtenHashes.push(liveHash);
    await writeUploadMeta(liveHash, {
      hash16: liveHash,
      fileName: "keep.pdf",
      title: "Keep Me",
      uploadedAt: new Date().toISOString(),
      textStatus: "ok",
      status: "ready",
      revision: 1,
      ownerKey: "owner",
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
    });

    try {
      await purgeExpiredUploads();

      expect(existsSync(strayFiguresJson)).toBe(false);
      expect(existsSync(strayTmp)).toBe(false);
      // Not a stray-pattern name and not expired — purgeExpiredUploads must
      // never touch it.
      expect(existsSync(metaPath(liveHash))).toBe(true);
    } finally {
      await rm(strayFiguresJson, { force: true });
      await rm(strayTmp, { force: true });
    }
  });

  it("the exact figures.json pattern never sweeps a merely-similar name", async () => {
    // Regression guard for the stray-file branch's precision: the closed
    // list matches exact names/suffixes only, never "contains figures.json"
    // or "contains .tmp" as a substring anywhere in the name.
    const nearMissNames = ["figures.json.bak", "notfigures.json", "figures.jsontmp"];
    for (const name of nearMissNames) {
      await writeFile(path.join(UPLOAD_DIR, name), "near-miss fixture", "utf-8");
    }
    try {
      await purgeExpiredUploads();
      for (const name of nearMissNames) {
        expect(existsSync(path.join(UPLOAD_DIR, name))).toBe(true);
      }
    } finally {
      for (const name of nearMissNames) await rm(path.join(UPLOAD_DIR, name), { force: true });
    }
  });

  it("the .tmp pattern sweeps a leftover named like a real asset's temp file too", async () => {
    const trickyTmp = path.join(UPLOAD_DIR, "abcdef0123456789.pdf.tmp");
    await writeFile(trickyTmp, "leftover partial write", "utf-8");
    try {
      await purgeExpiredUploads();
      expect(existsSync(trickyTmp)).toBe(false);
    } finally {
      await rm(trickyTmp, { force: true });
    }
  });
});

// 9-22 (A9-02): the reference-counting helper the DELETE and admin-block
// routes both call before retracting a document's shared preference-ledger
// evidence — reproduces A's own throwaway repro (two live copies sharing a
// documentKey; forgetting one must not erase the other's still-valid
// evidence) as a real, persisted test.
describe("hasOtherReadyDocumentCopy (9-22)", () => {
  const ownerKey = "owner-under-test-9-22-store";
  const documentKey = "shared-doi-doc-key-9-22";

  function fixtureMeta(hash16: string, overrides: Partial<UploadMeta> = {}): UploadMeta {
    return {
      hash16, fileName: "paper.pdf", title: "A Real Paper",
      uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok",
      status: "ready", revision: 1, ownerKey, documentKey,
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      ...overrides,
    };
  }

  it("is false with no documentKey, and false when this is the only copy", async () => {
    const hash16 = sha16(Buffer.from("9-22: only copy"));
    writtenHashes.push(hash16);
    await writeUploadMeta(hash16, fixtureMeta(hash16));

    expect(await hasOtherReadyDocumentCopy(ownerKey, undefined, hash16)).toBe(false);
    expect(await hasOtherReadyDocumentCopy(ownerKey, documentKey, hash16)).toBe(false);
  });

  it("is true when another ready copy of the same document is live, false once that's the one excluded", async () => {
    const hashA = sha16(Buffer.from("9-22: copy a"));
    const hashB = sha16(Buffer.from("9-22: copy b"));
    writtenHashes.push(hashA, hashB);
    await writeUploadMeta(hashA, fixtureMeta(hashA));
    await writeUploadMeta(hashB, fixtureMeta(hashB));

    // Deleting A: B is still a live ready sibling.
    expect(await hasOtherReadyDocumentCopy(ownerKey, documentKey, hashA)).toBe(true);
    // Deleting B: A is still a live ready sibling.
    expect(await hasOtherReadyDocumentCopy(ownerKey, documentKey, hashB)).toBe(true);
  });

  it("ignores a sibling that is blocked, deleted-shaped, or another owner's", async () => {
    const target = sha16(Buffer.from("9-22: target of interest"));
    const blockedSibling = sha16(Buffer.from("9-22: blocked sibling"));
    const otherOwnerSibling = sha16(Buffer.from("9-22: other owner sibling"));
    writtenHashes.push(target, blockedSibling, otherOwnerSibling);
    await writeUploadMeta(target, fixtureMeta(target));
    // A blocked sibling has no expiresAt (matches the real admin route's
    // minimal record) — listUploadMeta already excludes it on that basis,
    // and the explicit status check here is the second, defensive layer.
    await writeUploadMeta(blockedSibling, { hash16: blockedSibling, fileName: "", title: "",
      uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "empty", status: "blocked",
      ownerKey, documentKey });
    await writeUploadMeta(otherOwnerSibling, fixtureMeta(otherOwnerSibling, { ownerKey: "a-different-owner" }));

    expect(await hasOtherReadyDocumentCopy(ownerKey, documentKey, target)).toBe(false);
  });

  it("ignores a still-writing 'pending' sibling, even though it already has expiresAt set", async () => {
    // 9-13's own write order gives a `pending` record `expiresAt` from the
    // very first write (before the bytes even land) — so `listUploadMeta`'s
    // own unexpired-only filter does NOT exclude it on that basis alone.
    // This is the one case where the explicit `status === "ready"` check
    // inside this function is load-bearing, not merely defensive.
    const target = sha16(Buffer.from("9-22: target with a pending sibling"));
    const pendingSibling = sha16(Buffer.from("9-22: pending sibling"));
    writtenHashes.push(target, pendingSibling);
    await writeUploadMeta(target, fixtureMeta(target));
    await writeUploadMeta(pendingSibling, fixtureMeta(pendingSibling, { status: "pending" }));

    expect(await hasOtherReadyDocumentCopy(ownerKey, documentKey, target)).toBe(false);
  });
});
