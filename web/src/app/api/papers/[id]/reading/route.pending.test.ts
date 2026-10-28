// P12-58 (rule 2): "pending", not "none" — the reading route answers before the full text settles.
//
// A P12-44 (D1): the route waits `FULL_TEXT_TIMEOUT_MS` (8 s) and, if the attempt has not finished,
// answered with the abstract alone and `provenance.fullText: "none"` — the value of a settled "no
// text" — so the page said no abstract was published and never asked again. Here the extraction is
// an invented one that settles when the test says (fake timers), and the answer's value is read.
// A settled "no text" stays "none" (and `pdf_empty`, `paywalled`); only an attempt that has not
// finished — or threw, which is a fact about the moment — is pending, and a pending answer is never
// kept: a private reading is `private, no-store`, a public one `no-store` (never the day-long cache).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { RawItem } from "@/lib/sources/types";
import type { FullTextResult } from "@/lib/papers/full-text";

const mocks = vi.hoisted(() => ({
  fetchPaperById: vi.fn(),
  getFullText: vi.fn(),
  ownedUpload: vi.fn(),
}));

vi.mock("@/lib/papers/fetch-by-id", () => ({ fetchPaperById: mocks.fetchPaperById }));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));
vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...await original<typeof import("@/lib/papers/upload-access")>(),
  ownedUpload: mocks.ownedUpload,
}));

import { GET } from "./route";

const item: RawItem = {
  id: "openalex:W7208807999",
  source: "openalex",
  title: "Graph Embeddings For An Invented Protein Family",
  authors: ["A. Writer"],
  abstract:
    "Predicting structure from sequence remains a central challenge. This work explores graph embeddings to address it. We propose a framework where proteins are graphs. We show the embeddings capture structural information.",
  url: "https://doi.org/10.5281/zenodo.1",
  publishedAt: "2026-09-05",
  venue: "Zenodo",
  metadata: { doi: "https://doi.org/10.5281/zenodo.1" },
};

const upload = (hash16: string) => ({
  hash16, fileName: "paper.pdf", title: "An Invented Uploaded Paper",
  uploadedAt: "2026-09-15T00:00:00.000Z", textStatus: "ok", status: "ready", revision: 1,
  summaryIntro: "We measure creep in invented alloys. Boundary density sets the rate.",
});

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/reading?v=16`);
  return GET(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

/** A full-text attempt the test settles by hand. */
function slowAttempt() {
  let settle!: (result: FullTextResult) => void;
  let fail!: (error: Error) => void;
  const promise = new Promise<FullTextResult>((resolve, reject) => {
    settle = resolve;
    fail = reject;
  });
  return { promise, settle, fail };
}

describe("GET /api/papers/[id]/reading — P12-58 rule 2: pending, not none", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchPaperById.mockReset();
    mocks.getFullText.mockReset();
    mocks.ownedUpload.mockReset();
    mocks.fetchPaperById.mockResolvedValue(item);
    mocks.ownedUpload.mockResolvedValue(upload("0000000000000a01"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("an upload whose extraction outlasts the wait: the abstract alone, provenance 'pending', private and never kept", async () => {
    const attempt = slowAttempt();
    mocks.getFullText.mockReturnValue(attempt.promise);

    const answering = call("upload:0000000000000a01");
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await answering;
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.provenance.fullText).toBe("pending");
    expect(body.provenance.fullText).not.toBe("none");
    // Still the abstract-only reading: the record's own abstract, no sections.
    expect(body.abstract.sentences.length).toBeGreaterThan(0);
    expect(body.body).toEqual([]);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("the attempt that finishes after the answer is what the next ask is given: settled, with the sections' provenance", async () => {
    const attempt = slowAttempt();
    mocks.getFullText.mockReturnValueOnce(attempt.promise);

    const first = call("upload:0000000000000a01");
    await vi.advanceTimersByTimeAsync(8_000);
    expect((await (await first).json()).provenance.fullText).toBe("pending");

    // The extraction ends; `getFullText` (the real one shares the attempt) now answers at once.
    const settled: FullTextResult = { status: "no_full_text", reason: "pdf-empty: PDF text extractor produced no sections.", attempts: [{ link: { url: "/api/papers/upload/0000000000000a01/file", kind: "pdf", label: "upload", rank: 0 }, outcome: "no_full_text: pdf-empty: PDF text extractor produced no sections." }] };
    attempt.settle(settled);
    mocks.getFullText.mockResolvedValueOnce(settled);
    const second = await call("upload:0000000000000a01");

    expect((await second.json()).provenance.fullText).toBe("pdf_empty");
  });

  it("a settled 'no text' stays 'none' — an attempt that finished is a fact about the paper, not pending", async () => {
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "PDF text extractor failed on this server.",
      attempts: [],
    } satisfies FullTextResult);

    const res = await call("upload:0000000000000a01");
    const body = await res.json();

    expect(body.provenance.fullText).toBe("none");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("a settled scan stays 'pdf_empty'", async () => {
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "pdf-empty: PDF text extractor produced no sections.",
      attempts: [{ link: { url: "/api/papers/upload/0000000000000a01/file", kind: "pdf", label: "upload", rank: 0 }, outcome: "no_full_text: pdf-empty: PDF text extractor produced no sections." }],
    } satisfies FullTextResult);

    const body = await (await call("upload:0000000000000a01")).json();

    expect(body.provenance.fullText).toBe("pdf_empty");
  });

  it("an attempt that throws is pending too (a transient failure, not a fact about the paper), and nothing is kept", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.getFullText.mockRejectedValue(new Error("storage hiccup"));

    const res = await call("upload:0000000000000a01");

    expect((await res.json()).provenance.fullText).toBe("pending");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    quiet.mockRestore();
  });

  it("a public paper whose full text outlasts the wait: 'pending', and the day-long edge cache is never used", async () => {
    mocks.getFullText.mockReturnValue(slowAttempt().promise);

    const answering = call("openalex:W7208807999");
    await vi.advanceTimersByTimeAsync(8_000);
    const res = await answering;

    expect((await res.json()).provenance.fullText).toBe("pending");
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("a public paper whose attempt settled with no full text: 'none', cached for the day as before", async () => {
    mocks.getFullText.mockResolvedValue({
      status: "no_full_text",
      reason: "No legal full-text source returned readable body text.",
      attempts: [],
    } satisfies FullTextResult);

    const res = await call("openalex:W7208807999");

    expect((await res.json()).provenance.fullText).toBe("none");
    expect(res.headers.get("cache-control")).toContain("s-maxage=86400");
  });

  it("a settled paywall stays 'paywalled'", async () => {
    mocks.getFullText.mockResolvedValue({
      status: "paywalled",
      reason: "publisher.example requires paid or institutional access — Peer could not read the full paper, so the report falls back to the abstract.",
      attempts: [],
    } satisfies FullTextResult);

    const body = await (await call("openalex:W7208807999")).json();

    expect(body.provenance.fullText).toBe("paywalled");
  });
});
