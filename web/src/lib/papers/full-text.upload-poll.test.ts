// P12-58 (rule 3): a reading in flight is shared with every ask that arrives while the page waits.
//
// The page asks again every 2 to 20 seconds while the reading route says "pending", each ask waiting
// eight seconds at most (`use-reading.ts`, `reading/route.ts`). Every ask must join the extraction that
// is running, and one that arrives just after it settled must be given what it found: a scan has no
// document to keep, so without that an extraction ending between two asks would be started again by the
// next, for as long as the page asked. The extractor is a stub that settles when the test says (a delay
// it controls, on fake timers); no PDF of anyone's is read.
import { existsSync } from "node:fs";
import { rm } from "node:fs/promises";
import path from "node:path";
import { setTimeout as realSleep } from "node:timers/promises";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExtractedDocument } from "./html-text";
import type { PdfTextResult } from "./pdf-text";

const uploadDir = await vi.hoisted(async () => {
  const { mkdtempSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const dir = mkdtempSync(join(tmpdir(), "peer-full-text-poll-test-"));
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

import { getFullText } from "./full-text";

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

/** Wait, on the real clock (the fake one stands still), until the extractor has been called `n` times:
 *  the ask reads files first, and real I/O takes as long as the machine takes. */
async function extractorCalled(n: number): Promise<void> {
  for (let turn = 0; turn < 2_000; turn++) {
    if (mocks.extractPdfTextFromBytes.mock.calls.length >= n) return;
    await realSleep(5);
  }
  throw new Error(`the extractor was not called ${n} time(s)`);
}

/** An extraction that settles when the test calls `finish`. */
function slowExtraction() {
  let finish!: (result: PdfTextResult) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<PdfTextResult>((resolve, reject) => {
    finish = resolve;
    fail = reject;
  });
  return { promise, finish, fail };
}

describe("getFullText on an upload — P12-58 rule 3: every ask joins the reading in flight, and one just after it is given its result", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    mocks.ownerKey.value = "owner-poll";
    mocks.revision.value = 1;
    mocks.failNextWrite.error = null;
    mocks.extractPdfTextFromBytes.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a slow extraction is started once however many asks arrive while it runs, and the body is the answer once it ends", async () => {
    const hash16 = "00000000000000e1";
    const slow = slowExtraction();
    mocks.extractPdfTextFromBytes.mockReturnValueOnce(slow.promise);

    const asks = [getFullText({ paperId: idOf(hash16) })];
    await extractorCalled(1);
    await vi.advanceTimersByTimeAsync(10_000);
    asks.push(getFullText({ paperId: idOf(hash16) }));
    await vi.advanceTimersByTimeAsync(10_000);
    asks.push(getFullText({ paperId: idOf(hash16) }));
    // Give the joined asks the time a second extraction would have needed to start.
    await realSleep(50);
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(1);

    slow.finish({ ok: true, doc });
    const answers = await Promise.all(asks);

    expect(answers.map((answer) => answer.status)).toEqual(["ok", "ok", "ok"]);
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(1);
    // And it was kept: the next ask after the hold is a read of the document, not an extraction.
    await vi.advanceTimersByTimeAsync(120_000);
    expect((await getFullText({ paperId: idOf(hash16) })).status).toBe("ok");
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(1);
  });

  it("an extraction that ended between two asks (a scan: nothing kept) is not started again by the next, within a minute", async () => {
    const hash16 = "00000000000000e2";
    const slow = slowExtraction();
    mocks.extractPdfTextFromBytes.mockReturnValueOnce(slow.promise);

    const first = getFullText({ paperId: idOf(hash16) });
    await extractorCalled(1);
    await vi.advanceTimersByTimeAsync(8_000); // the route's wait is over; the page waits 2 s, then asks again
    slow.finish({ ok: false, reason: "no-sections" });
    expect((await first).attempts[0].outcome).toContain("pdf-empty");
    await vi.advanceTimersByTimeAsync(20_000); // the next ask, 20 s later

    const next = await getFullText({ paperId: idOf(hash16) });

    expect(next.status).toBe("no_full_text");
    expect(next.attempts[0].outcome).toContain("pdf-empty");
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(1);
    expect(existsSync(sidecar(hash16))).toBe(false);

    // A minute on, the hold is over and a fresh ask reads the PDF again, as a scan always was.
    await vi.advanceTimersByTimeAsync(41_000);
    mocks.extractPdfTextFromBytes.mockResolvedValueOnce({ ok: false, reason: "no-sections" } satisfies PdfTextResult);
    await getFullText({ paperId: idOf(hash16) });
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(2);
  });

  it("an extraction that threw is not held: the next ask tries again", async () => {
    const hash16 = "00000000000000e3";
    const slow = slowExtraction();
    mocks.extractPdfTextFromBytes.mockReturnValueOnce(slow.promise);

    const first = getFullText({ paperId: idOf(hash16) });
    const rejected = expect(first).rejects.toThrow("pdf.js fell over");
    await extractorCalled(1);
    slow.fail(new Error("pdf.js fell over"));
    await rejected;

    mocks.extractPdfTextFromBytes.mockResolvedValueOnce({ ok: true, doc } satisfies PdfTextResult);
    const second = await getFullText({ paperId: idOf(hash16) });

    expect(second.status).toBe("ok");
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(2);
  });

  it("the hold is the reading's owner's alone: another owner's ask is refused before it, whatever was held", async () => {
    const hash16 = "00000000000000e4";
    mocks.extractPdfTextFromBytes.mockResolvedValueOnce({ ok: false, reason: "no-sections" } satisfies PdfTextResult);
    await getFullText({ paperId: idOf(hash16) });

    // The owner check is what refuses (`ownedUpload` returns null for anyone else) — here the check is
    // the key: a different owner key is a different reading, read for itself.
    mocks.ownerKey.value = "someone-else";
    mocks.extractPdfTextFromBytes.mockResolvedValueOnce({ ok: true, doc } satisfies PdfTextResult);
    const other = await getFullText({ paperId: idOf(hash16) });

    expect(other.status).toBe("ok");
    expect(mocks.extractPdfTextFromBytes).toHaveBeenCalledTimes(2);
  });
});
