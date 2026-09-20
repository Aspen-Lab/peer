import { existsSync } from "node:fs";
import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  bareUploadId,
  metaPath,
  pdfPath,
  purgeExpiredUploads,
  readUploadMeta,
  sha16,
  uploadFileExists,
  UPLOAD_DIR,
  uploadId,
  uploadMetaToPaper,
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
    }),
  );
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
