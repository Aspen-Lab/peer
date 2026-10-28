// P12-58 (rule 1): the upload keeps its document — the real chain, in-process.
//
// A P12-44 (D1, D2): the upload route read the whole PDF (`extractPdfTextFromBytes`) and threw the
// document away; the first reading request read it again, missed the reading route's eight-second
// wait and answered with the abstract alone. Here the upload route stores an owner's invented PDF
// and the reading route is asked for it; the extractor is wrapped, not replaced, so its calls are
// counted on the real reading. Only the request cookie jar (`next/headers`) is stubbed;
// `upload-store`, `upload-access`, `full-text` and pdf.js are real, in a private temp directory.
// Every PDF here is built in the test (`minimal-pdf.test-helper`); no paper of anyone's is read.
import { existsSync } from "node:fs";
import { readFile, rm, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { minimalPdf, prose, type Run } from "@/lib/papers/minimal-pdf.test-helper";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-upload-keeps-document-test-"));
  process.env.PEER_PRIVATE_UPLOAD_DIR = dir;
  return dir;
});

const mocks = vi.hoisted(() => ({
  token: { value: undefined as string | undefined },
  /** How many times the PDF text extractor ran (pass-through: it still reads the real PDF). */
  extractions: { n: 0 },
  /** The next `writeUploadDoc` throws this, once. */
  failNextWrite: { error: null as Error | null },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (name === "peer-private-uploads" && mocks.token.value ? { name, value: mocks.token.value } : undefined),
    set: (name: string, value: string) => {
      if (name === "peer-private-uploads") mocks.token.value = value;
    },
  }),
  headers: async () => new Headers(),
}));
vi.mock("@/lib/papers/pdf-text", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/pdf-text")>();
  return {
    ...actual,
    extractPdfTextFromBytes: (...args: Parameters<typeof actual.extractPdfTextFromBytes>) => {
      mocks.extractions.n += 1;
      return actual.extractPdfTextFromBytes(...args);
    },
  };
});
vi.mock("@/lib/papers/upload-store", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/upload-store")>();
  return {
    ...actual,
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

import { POST as uploadPOST } from "./route";
import { GET as readingGET } from "../[id]/reading/route";
import { uploadDocKey, readUploadMeta } from "@/lib/papers/upload-store";
import { UPLOAD_CONCEPT_EXTRACTION_VERSION } from "@/lib/preferences/upload-concepts";
import { READING_VERSION } from "@/components/reader/use-reading";

afterAll(async () => {
  delete process.env.PEER_PRIVATE_UPLOAD_DIR;
  await rm(uploadDir, { recursive: true, force: true });
});

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "33333333-3333-4333-8333-333333333333";

/** An invented paper: a title, an abstract and an introduction, with `word` in its prose so each PDF has its own bytes. */
function paper(word: string): Buffer {
  const pages: Run[][] = [
    [
      [`Grain Boundaries Set The Pace Of ${word} Creep`, 72, 70, 18],
      ["Abstract", 72, 140, 14, true],
      ...prose([`We measure creep in ${word} alloys with many grain boundaries per cubic micron.`, "Boundary density sets the creep rate across three decades of applied stress."], 160),
      ["1 Introduction", 72, 210, 11, true],
      ...prose(["Creep limits the life of parts that run hot for years at a time under load.", "Grain boundaries are where most of the creep strain is thought to happen."], 230),
    ],
  ];
  return minimalPdf(pages);
}

async function upload(bytes: Buffer): Promise<{ status: number; id: string; textStatus?: string }> {
  mocks.token.value = OWNER;
  const form = new FormData();
  form.set("rightsVersion", "2026-09-19");
  form.set("file", new File([bytes as unknown as BlobPart], "paper.pdf", { type: "application/pdf" }));
  const res = await uploadPOST(new Request("http://localhost/api/papers/upload", {
    method: "POST", headers: { "sec-fetch-site": "same-origin" }, body: form,
  }));
  const body = (await res.json()) as { id?: string; paper?: { textStatus?: string } };
  return { status: res.status, id: body.id ?? "", textStatus: body.paper?.textStatus };
}

function reading(id: string, as = OWNER, get: typeof readingGET = readingGET): Promise<Response> {
  mocks.token.value = as;
  return get(new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/reading?v=${READING_VERSION}`), {
    params: Promise.resolve({ id: encodeURIComponent(id) }),
  });
}

const sidecar = (hash16: string) => path.join(uploadDir, `${hash16}.doc.json`);
const hashOf = (id: string) => id.slice("upload:".length);

describe("POST /api/papers/upload — P12-58 rule 1: the upload keeps its document", () => {
  beforeEach(() => {
    mocks.extractions.n = 0;
    mocks.failNextWrite.error = null;
  });

  it("writes the document, and the first reading reads it: one extraction for the upload and the reading together", async () => {
    const { status, id } = await upload(paper("Quillwortane"));
    expect(status).toBe(200);
    expect(mocks.extractions.n).toBe(1);
    expect(existsSync(sidecar(hashOf(id)))).toBe(true);

    const res = await reading(id);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provenance.fullText).toBe("pdf");
    expect(body.body.length).toBeGreaterThan(0);
    // The count that was 2 before the route kept its document: the second extraction is the one that
    // missed the reading route's wait.
    expect(mocks.extractions.n).toBe(1);
  });

  it("is found again from the file after a cold start: the key the route writes is the key the reading reads", async () => {
    const { id } = await upload(paper("Brightleaf"));
    expect(mocks.extractions.n).toBe(1);

    // A fresh server process: no module state, only what is on disk.
    vi.resetModules();
    const { GET: coldReading } = await import("../[id]/reading/route");
    const body = await (await reading(id, OWNER, coldReading)).json();

    expect(body.provenance.fullText).toBe("pdf");
    expect(mocks.extractions.n).toBe(1);
  });

  it("is the owner's alone: a digest of the owner's key in the file, 0600, and a stranger is refused without a read", async () => {
    const { id } = await upload(paper("Marlowite"));
    const hash16 = hashOf(id);
    const meta = await readUploadMeta(hash16);
    expect(meta?.ownerKey).toBeTruthy();
    const stored = JSON.parse(await readFile(sidecar(hash16), "utf-8")) as { key: string; doc: unknown };
    const key = uploadDocKey(meta!.ownerKey!, hash16, meta!.revision, UPLOAD_CONCEPT_EXTRACTION_VERSION);

    expect(stored.key).toBe(createHash("sha256").update(key).digest("hex"));
    expect(JSON.stringify(stored)).not.toContain(meta!.ownerKey!);
    expect((await stat(sidecar(hash16))).mode & 0o777).toBe(0o600);

    const stranger = await reading(id, STRANGER);
    expect(stranger.status).toBe(404);
    expect(mocks.extractions.n).toBe(1);
  });

  it("a write that fails never fails the upload; the first reading then reads the PDF itself, as before", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    mocks.failNextWrite.error = Object.assign(new Error("disk full — Quillwortane"), { code: "ENOSPC" });

    const { status, id } = await upload(paper("Tarnished"));

    expect(status).toBe(200);
    expect(existsSync(sidecar(hashOf(id)))).toBe(false);
    expect(warn).toHaveBeenCalledWith("[papers/full-text] could not keep an upload's text:", "ENOSPC");
    // The log line carries no text of the paper and no message of the error.
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Tarnished");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("Quillwortane");
    warn.mockRestore();

    const body = await (await reading(id)).json();
    expect(body.provenance.fullText).toBe("pdf");
    // Nothing was kept, so the reading reads the PDF itself: the upload's extraction and its own.
    expect(mocks.extractions.n).toBe(2);
  });

  it("keeps nothing for a PDF with no text layer: it is read again next time, as before", async () => {
    const { status, id, textStatus } = await upload(minimalPdf([[], []]));

    expect(status).toBe(200);
    expect(textStatus).toBe("empty");
    expect(existsSync(sidecar(hashOf(id)))).toBe(false);
  });
});
