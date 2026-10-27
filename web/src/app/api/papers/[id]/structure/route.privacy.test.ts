import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { explainDocHash } from "@/lib/papers/explain";
import { structureReviewCache, structureReviewKey } from "@/lib/papers/structure-review";
import { FIVE_PARTS, inventedPaper, modelDouble } from "@/test-support/structure-fixtures";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P12-53 (B P12-42 §4 "Privacy"; ruling §1h.424 (b) "private for uploads"): the review of an uploaded PDF is the
// owner's. The order of checks is the gist route's — the claim, the attachment and the owner BEFORE the sign-in
// gate, the provider, the text and the memory — so another owner's upload is a 404 whatever the memory holds; an
// answer about an upload says what the other private-upload routes say; an upload replaced while the model worked
// is not answered from and nothing of it is remembered; and no answer, entry or log line holds a word of the paper.

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  getFullText: vi.fn(),
}));

vi.mock("@/lib/llm/providers/registry", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/llm/providers/registry")>();
  return { ...actual, resolveProvider: mocks.resolveProvider };
});
vi.mock("@/lib/papers/upload-access", async (original) => ({
  ...(await original<typeof import("@/lib/papers/upload-access")>()),
  ownedUpload: mocks.ownedUpload,
}));
vi.mock("@/lib/papers/full-text", () => ({ getFullText: mocks.getFullText }));

import { POST } from "./route";

const FIVE = inventedPaper(FIVE_PARTS);
const UPLOAD = "upload:0123456789abcdef";
const uploadPaper = {
  id: UPLOAD,
  title: "Zymurgy of the tide pools",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "upload" as never,
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};

function call(paper: Record<string, unknown> = uploadPaper, id: string = String(paper.id)) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paper }),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

let generateJsonText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  structureReviewCache.clear();
  generateJsonText = vi.fn(async (args: { userPrompt: string }) => modelDouble(args.userPrompt));
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue({ id: "gemini", generateJsonText });
  mocks.getFullText.mockResolvedValue({ status: "ok", doc: FIVE.doc, attempts: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/structure — private uploads", () => {
  it("is 404 for an upload the caller does not own, before any text is read or model asked", async () => {
    const response = await call();

    expect(response.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(mocks.resolveProvider).not.toHaveBeenCalled();
    expect(generateJsonText).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is 404 for another owner's upload even when the same text was reviewed and is in the memory", async () => {
    structureReviewCache.set(structureReviewKey(explainDocHash(FIVE.doc)), {
      v: 1,
      docHash: explainDocHash(FIVE.doc),
      rulesVersion: "x",
      skeletonVersion: "x",
      promptVersion: "x",
      draftDigest: "0".repeat(14),
      corrections: [],
      unsure: [],
      secondLooks: [],
      model: "gemini/large",
      reviewedAt: 0,
    });
    const response = await call();

    expect(response.status).toBe(404);
    expect(JSON.stringify(await response.json())).not.toContain("corrections");
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("is 404 for a claim spelled so it is not an upload id, and never looks it up", async () => {
    for (const id of ["UPLOAD:0123456789abcdef", "upload:0123456789ABCDEF", " upload:0123456789abcdef"]) {
      expect((await call({ ...uploadPaper, id }, id)).status).toBe(404);
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("is 404 for a public paper naming an attachment that does not list it, or a malformed one", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: ["arxiv:other"] });
    const pub = { ...uploadPaper, id: "arxiv:2610.00033" };
    expect((await call({ ...pub, fullTextUploadId: "upload:0123456789abcdef" })).status).toBe(404);
    expect((await call({ ...pub, fullTextUploadId: "not-an-upload" })).status).toBe(404);
    expect(generateJsonText).not.toHaveBeenCalled();
  });

  it("answers an owner, with the private headers on the answer, and no word of the paper in it", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    const response = await call();
    const text = JSON.stringify(await response.json());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");
    expect(text).toContain("corrections");
    expect(text).not.toMatch(/Invented|tide pools|Introduction|Methods|Results|Zymurgy|Further analysis/);
  });

  it("is 410 when the upload was replaced or deleted while the model was working, and remembers nothing", async () => {
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const replaced = await call();

    expect(replaced.status).toBe(410);
    expect(replaced.headers.get("cache-control")).toBe("private, no-store");
    expect(structureReviewCache.size()).toBe(0);

    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce(null);
    expect((await call()).status).toBe(410);
    expect(structureReviewCache.size()).toBe(0);
  });

  it("sends the model the skeleton of the owner's upload and no title, and never the reader's key", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(UPLOAD)}/structure`, {
      method: "POST",
      body: JSON.stringify({ paper: uploadPaper, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } }),
    });
    await POST(req, { params: Promise.resolve({ id: encodeURIComponent(UPLOAD) }) });

    expect(generateJsonText).toHaveBeenCalled();
    for (const [args] of generateJsonText.mock.calls as Array<[{ systemPrompt: string; userPrompt: string }]>) {
      expect(args.systemPrompt + args.userPrompt).not.toMatch(/Zymurgy|USER-NOT-A-KEY/);
    }
  });
});
