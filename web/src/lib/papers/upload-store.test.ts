import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import {
  bareUploadId,
  metaPath,
  pdfPath,
  readUploadMeta,
  sha16,
  uploadFileExists,
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
    };

    const paper = uploadMetaToPaper(meta);

    expect(paper.doi).toBe("10.1000/example");
    expect(paper.pageCount).toBe(20);
    expect(paper.summaryIntro).toBe("This paper studies things.");
  });
});
