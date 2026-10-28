// P12-58 (rule 1): the upload's document is kept under the key the first reading reads.
//
// `keepUploadDocument` (`full-text.ts`) writes a document the upload route has already read, under
// the key `getFullText` looks for — owner, hash, revision, extractor — so the first reading of a PDF
// that was just uploaded is a read of that document, not a second extraction (A P12-44, D2). Only a
// document with text is kept, and a failed write is a log line, never an error. The extractor is a
// stub that counts its calls; no PDF of anyone's is read.
import { existsSync } from "node:fs";
import { rm, stat } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "./html-text";
import type { PdfTextResult } from "./pdf-text";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-full-text-keep-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

const mocks = vi.hoisted(() => ({
  ownerKey: { value: "owner-poll" },
  revision: { value: 1 },
  extractPdfTextFromBytes: vi.fn(),
  failNextWrite: { error: null as Error | null },
}));

vi.mock("./upload-access", () => ({
  ownedUpload: async () => ({ ownerKey: mocks.ownerKey.value, revision: mocks.revision.value }),
}));
vi.mock("./upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./upload-store")>();
  return {
    ...actual,
    readUploadPdf: async () => Buffer.from("%PDF-1.4 fixture"),
    writeUploadDoc: async (...args: Parameters<typeof actual.writeUploadDoc>) => {
      const failure = mocks.failNextWrite.error;
      if (failure) {
        mocks.failNextWrite.error = null;
        throw failure;
      }
      return actual.writeUploadDoc(...args);
    },
  };
});
vi.mock("./pdf-text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pdf-text")>();
  return { ...actual, extractPdfTextFromBytes: mocks.extractPdfTextFromBytes };
});

import { getFullText, keepUploadDocument } from "./full-text";

const doc: ExtractedDocument = {
  title: "An Invented Upload",
  sections: [
    { id: "s0", heading: "1 Introduction", canonical: "introduction", text: "Invented prose.", page: 1 },
    { id: "s1", heading: "2 Methods", canonical: "methods", text: "More invented prose.", page: 2 },
  ],
  figureCaptions: [],
  source: "pdf",
  pageCount: 4,
  reason: null,
};
const sidecar = (hash16: string) => path.join(uploadDir, `${hash16}.doc.json`);
const idOf = (hash16: string) => `upload:${hash16}`;

describe("keepUploadDocument — P12-58 rule 1: the document the upload route read is the one the first reading finds", () => {
  beforeEach(() => {
    mocks.ownerKey.value = "owner-poll";
    mocks.revision.value = 1;
    mocks.failNextWrite.error = null;
    mocks.extractPdfTextFromBytes.mockReset();
    mocks.extractPdfTextFromBytes.mockResolvedValue({ ok: true, doc } satisfies PdfTextResult);
  });

  it("is read by getFullText with no extraction, from memory and from the file after a cold start", async () => {
    const hash16 = "00000000000000d1";
    expect(await keepUploadDocument(hash16, { ownerKey: "owner-poll", revision: 1 }, doc)).toBe(true);
    expect((await stat(sidecar(hash16))).mode & 0o777).toBe(0o600);

    const warm = await getFullText({ paperId: idOf(hash16) });
    expect(warm.status).toBe("ok");
    expect(warm.doc).toEqual(doc);
    expect(mocks.extractPdfTextFromBytes).not.toHaveBeenCalled();

    vi.resetModules();
    const { getFullText: cold } = await import("./full-text");
    const afterRestart = await cold({ paperId: idOf(hash16) });
    expect(afterRestart.doc).toEqual(doc);
    expect(mocks.extractPdfTextFromBytes).not.toHaveBeenCalled();
  });

  it("is found under that owner, revision and extractor only: another revision or owner reads the PDF itself", async () => {
    const hash16 = "00000000000000d2";
    await keepUploadDocument(hash16, { ownerKey: "owner-poll", revision: 1 }, doc);

    mocks.revision.value = 2;
    await getFullText({ paperId: idOf(hash16) });
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(1);

    mocks.revision.value = 1;
    mocks.ownerKey.value = "someone-else";
    await getFullText({ paperId: idOf(hash16) });
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(2);
  });

  it("keeps nothing for a document with no sections (a scan is read again, as before)", async () => {
    const hash16 = "00000000000000d3";

    expect(await keepUploadDocument(hash16, { ownerKey: "owner-poll", revision: 1 }, { ...doc, sections: [] })).toBe(false);

    expect(existsSync(sidecar(hash16))).toBe(false);
  });

  it("answers false and logs only the error's code when the write fails: the reading stands", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.failNextWrite.error = Object.assign(new Error("no space left on device: Quillwortane"), { code: "ENOSPC" });

    const kept = await keepUploadDocument("00000000000000d4", { ownerKey: "owner-poll", revision: 1 }, doc);

    expect(kept).toBe(false);
    expect(warn).toHaveBeenCalledWith("[papers/full-text] could not keep an upload's text:", "ENOSPC");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Quillwortane");
    warn.mockRestore();
  });
});
