import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache, explainDayKey, type ExplainAnswer } from "@/lib/papers/explain";
import { CompanySpendCapRefusedError } from "@/lib/usage/company-budget";
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";

// P3-02 (ruling §1h.2; §3d 14, 17): POST /api/papers/[id]/explain — one
// selected passage, explained in two parts, the second with a verified quote.
// A counting provider stub stands in for the model: no real call anywhere. The
// sign-in gate and the per-reader counting across readers are in
// `route.gate.test.ts` (it needs a deployed runtime and a session stub).
// Everything below is invented text.

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

const DEF = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const USE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "An abstract about rafting under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: "Hot turbine blades creep slowly under load and lose their shape over many hours." },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `Specimens were machined from a single casting and heat treated together.\n\n${DEF}` },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: USE },
  ],
};

const paper = {
  id: "arxiv:2607.00002",
  title: "Rafting under creep in a nickel alloy",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "This paper studies rafting in a nickel superalloy under creep.",
  summaryExperimentKeywords: ["creep"],
  summaryResultDiscussion: "Tungsten additions slowed rafting by a third at 1100 C.",
  isSaved: false,
};

const PASSAGE = "the rafting ratio as the fraction of the gauge length";
const MEANING = "A rafting ratio says how much of a sample has turned into plates.";
const HERE = "The authors use it to compare alloys on one scale.";
const modelAnswer = { meaning: MEANING, here: { text: HERE, evidence: DEF } };

const NOW = new Date("2026-10-06T12:00:00.000Z");

/** What the route hands the model. */
interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
}

function providerStub(text: string = JSON.stringify(modelAnswer)) {
  const generateJsonText = vi.fn<(args: ModelArgs) => Promise<string>>(async () => text);
  return { generateJsonText };
}

function request(body: unknown, id: string): NextRequest {
  return new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function call(body: unknown, id: string = paper.id) {
  return POST(request(body, id), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

const ask = (over: Record<string, unknown> = {}) => ({ paper, passage: PASSAGE, sectionId: "s2", paragraphIndex: 1, thread: [], ...over });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

async function turns(): Promise<number> {
  return (await getCounterStore().read(explainDayKey("local-no-auth", NOW), NOW)).value;
}

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetCounterStoreForTests();
  explainCache.clear();
  vi.clearAllMocks();
  provider = providerStub();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/explain — the request", () => {
  it("answers 400 to a body that is not JSON, a paper without an id or title, and a passage that is not text", async () => {
    expect((await call("{not json")).status).toBe(400);
    expect((await call({ passage: PASSAGE })).status).toBe(400);
    expect((await call({ paper: { id: paper.id }, passage: PASSAGE })).status).toBe(400);
    expect((await call(ask({ passage: 5 }))).status).toBe(400);
    expect((await call(ask({ passage: undefined }))).status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("answers 400 when the address and the paper name different papers", async () => {
    const response = await call(ask(), "arxiv:2607.99999");

    expect(response.status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("answers 400 to an address that is not a valid encoding", async () => {
    const response = await POST(request(ask(), paper.id), { params: Promise.resolve({ id: "%E0%A4%A" }) });

    expect(response.status).toBe(400);
  });
});

describe("POST /api/papers/[id]/explain — the two parts", () => {
  it("asks the model once, on the small tier, and answers the two parts with the quote placed", async () => {
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    const args = provider.generateJsonText.mock.calls[0][0];
    expect(args.tier).toBe("small");
    expect(args.maxTokens).toBe(600);
    expect(body).toEqual({
      cached: false,
      answer: { meaning: MEANING, here: { text: HERE, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 } },
    });
  });

  it("puts the paper, its map, the paragraph around the passage and the passage in the prompt", async () => {
    await call(ask());
    const { userPrompt } = provider.generateJsonText.mock.calls[0][0];

    expect(userPrompt).toContain(paper.title);
    expect(userPrompt).toContain(paper.summaryIntro);
    expect(userPrompt).toContain("1 Introduction");
    expect(userPrompt).toContain("3 Results");
    expect(userPrompt).toContain("Specimens were machined from a single casting and heat treated together.");
    expect(userPrompt).toContain(DEF);
    expect(userPrompt).toContain(PASSAGE);
  });

  it("puts nothing about the reader in it, whatever the request carries", async () => {
    await call(ask({ project: "PROFILE-SENTINEL", contextHint: "CONTEXT-SENTINEL", questions: ["QUESTION-SENTINEL?"], profile: { name: "PROFILE-SENTINEL" } }));
    const sent = JSON.stringify(provider.generateJsonText.mock.calls);

    expect(sent).not.toContain("PROFILE-SENTINEL");
    expect(sent).not.toContain("CONTEXT-SENTINEL");
    expect(sent).not.toContain("QUESTION-SENTINEL");
  });

  it("removes a quote the paper does not hold, and says the prose is Peer's own", async () => {
    provider.generateJsonText.mockResolvedValue(
      JSON.stringify({ meaning: MEANING, here: { text: HERE, evidence: "We define the rafting ratio as the share of every plate that covered a crack." } }),
    );
    const body = await json(await call(ask()));

    expect(body.answer).toEqual({ meaning: MEANING, here: { text: HERE, peer: true } });
  });

  it("clips the passage to what the paper holds, and finds it without the hint", async () => {
    const body = await json(await call(ask({ sectionId: undefined, paragraphIndex: undefined, passage: `  The   RAFTING ratio  rose from 0.2 to 0.7 ` })));

    expect((body.answer as ExplainAnswer).here.sectionId).toBe("s2");
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("refuses 422 a passage the body does not hold — before any model is asked", async () => {
    const response = await call(ask({ passage: "a sentence the paper never wrote" }));

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "not_in_paper" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(await turns()).toBe(0);
  });

  it("refuses 422 a passage found only in the abstract", async () => {
    const response = await call(ask({ passage: "An abstract about rafting under creep." }));

    expect(response.status).toBe(422);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("asks the model for the paper's text with the id the attached upload names, when there is one", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: [paper.id] });
    await call(ask({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" } }));

    expect(mocks.getFullText.mock.calls[0][0]).toMatchObject({ paperId: "upload:0123456789abcdef" });
  });

  it("reads a public paper's text by its own id, url and identifiers", async () => {
    await call(ask({ paper: { ...paper, linkArxiv: "https://arxiv.org/abs/2607.00002" } }));

    expect(mocks.getFullText.mock.calls[0][0]).toMatchObject({ paperId: paper.id, url: "https://arxiv.org/abs/2607.00002", arxivId: "2607.00002", openAlexId: null });
  });
});

describe("POST /api/papers/[id]/explain — the memory and the count", () => {
  it("asks the model once for the same passage twice: the second is a hit, with no call and no count", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.answer).toEqual(first.answer);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(await turns()).toBe(1);
  });

  it("counts one explanation per model call, per reader per UTC day", async () => {
    await call(ask());
    expect(await turns()).toBe(1);
    await call(ask({ passage: "Specimens were machined from a single casting", sectionId: "s2", paragraphIndex: 0 }));
    expect(await turns()).toBe(2);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
  });

  it("finds a hit however the passage is spaced or cased, and for the paragraph hint left out", async () => {
    await call(ask());
    const second = await json(await call(ask({ passage: `  THE rafting   ratio as the fraction of the gauge length `, sectionId: undefined, paragraphIndex: undefined })));

    expect(second.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("keeps a different passage, and a different paper, apart", async () => {
    await call(ask());
    await call(ask({ passage: USE.slice(0, 40), sectionId: "s3", paragraphIndex: 0 }));
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);

    const other: ExtractedDocument = { ...doc, sections: doc.sections.map((s) => (s.id === "s2" ? { ...s, text: `${s.text}\n\nAnother sentence that changes the document's hash.` } : s)) };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: other, attempts: [] });
    const third = await json(await call(ask()));

    expect(third.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(3);
  });

  it("holds the verified answer only: nothing of the request is in the memory", async () => {
    await call(ask({ project: "PROFILE-SENTINEL" }));
    // The memory is a map of hashes to answers; its one entry's answer has the two parts and no more.
    expect(explainCache.size()).toBe(1);
  });
});

describe("POST /api/papers/[id]/explain — when there is no answer", () => {
  it("is 200 unavailable when no provider can write, and asks for nothing", async () => {
    for (const none of [null, { generateJsonText: undefined }]) {
      mocks.resolveProvider.mockReturnValue(none);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(await turns()).toBe(0);
  });

  it("is 200 unavailable when the paper has no text or no sections", async () => {
    for (const result of [{ status: "paywalled", reason: "closed", attempts: [] }, { status: "ok", doc: { ...doc, sections: [] }, attempts: [] }, { status: "ok", attempts: [] }]) {
      mocks.getFullText.mockResolvedValue(result);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 200 unavailable, with nothing counted or remembered, when the model fails or answers nonsense", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    for (const failing of [
      () => Promise.reject(new Error("model down")),
      () => Promise.resolve("this is not json at all"),
      () => Promise.resolve(JSON.stringify({ meaning: "", here: { text: "x" } })),
      () => Promise.resolve(JSON.stringify({ meaning: "only one part" })),
    ]) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(await turns()).toBe(0);
    expect(explainCache.size()).toBe(0);
  });

  it("answers a company-budget refusal with unavailable and the quota signal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    provider.generateJsonText.mockRejectedValue(new CompanySpendCapRefusedError("global_cap_exceeded"));
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.unavailable).toBe(true);
    expect(body.quota).toMatchObject({ kind: "company_budget", reason: "exhausted" });
    expect(await turns()).toBe(0);
  });

  it("calls an outage of the budget check an outage, not a spent budget", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    provider.generateJsonText.mockRejectedValue(new CompanySpendCapRefusedError("price_unreadable"));
    const body = await json(await call(ask()));

    expect(body.quota).toMatchObject({ kind: "company_budget", reason: "unavailable" });
  });
});

describe("POST /api/papers/[id]/explain — private uploads", () => {
  const UPLOAD = "upload:0123456789abcdef";
  const uploadPaper = { ...paper, id: UPLOAD };

  it("is 404 for an upload the caller does not own, before any text is read or model asked", async () => {
    mocks.ownedUpload.mockResolvedValue(null);
    const response = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(response.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is 404 for a claim spelled so it is not an upload id, and never looks it up", async () => {
    for (const id of ["UPLOAD:0123456789abcdef", "upload:0123456789ABCDEF", " upload:0123456789abcdef"]) {
      const response = await call(ask({ paper: { ...paper, id } }), id);

      expect(response.status).toBe(404);
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("is 404 for a public paper naming an attachment that does not list it, or a malformed one", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: ["arxiv:other"] });
    expect((await call(ask({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" } }))).status).toBe(404);
    expect((await call(ask({ paper: { ...paper, fullTextUploadId: "not-an-upload" } }))).status).toBe(404);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("answers an owner, with the private headers on the answer", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    const response = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(response.status).toBe(200);
    expect((await json(response)).cached).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");
  });

  it("is 410 when the upload was replaced or deleted while the model was working", async () => {
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const replaced = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(replaced.status).toBe(410);
    expect(replaced.headers.get("cache-control")).toBe("private, no-store");
    expect(explainCache.size()).toBe(0);

    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce(null);
    expect((await call(ask({ paper: uploadPaper }), UPLOAD)).status).toBe(410);
  });
});

describe("POST /api/papers/[id]/explain — headers", () => {
  it("is never cached, whatever the answer is", async () => {
    const cases: Array<() => Promise<Response>> = [
      () => call(ask()),
      () => call(ask()),
      () => call(ask({ passage: "no such words in this paper" })),
      () => call("{bad"),
      () => call(ask(), "arxiv:other"),
    ];
    for (const run of cases) expect((await run()).headers.get("cache-control")).toMatch(/no-store/);
    mocks.resolveProvider.mockReturnValue(null);
    expect((await call(ask())).headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("POST /api/papers/[id]/explain — what it logs", () => {
  it("writes one debug line per turn — counts and sizes — and no word of the paper, the passage or the answer", async () => {
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    await call(ask({ project: "PROFILE-SENTINEL" }));
    await call(ask());
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    // The turn, then the hit.
    expect(debug).toHaveLength(2);
    const [label, fields] = debug[0] as [string, Record<string, unknown>];
    expect(label).toBe("[papers/explain] turn");
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "count", "promptChars", "userId"]);
    expect(fields).toMatchObject({ count: 1, cached: false });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect(fields.answerChars).toBeGreaterThan(20);
    expect(String(fields.userId)).toMatch(/^[0-9a-f]{12}$/);
    expect(String(fields.userId)).not.toContain("local-no-auth");
    expect((debug[1] as [string, Record<string, unknown>])[1]).toMatchObject({ cached: true });
    expect(levels.slice(0, 4).every((spy) => spy.mock.calls.length === 0)).toBe(true);

    for (const word of ["rafting", "gauge", "Rafting under creep", "tungsten", "Tungsten", "plates", "compare alloys", "PROFILE-SENTINEL", "Methods", "Introduction"]) {
      expect(all).not.toContain(word);
    }
  });

  it("logs a failed model call by its error's name only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("upstream said: the rafting ratio passage was refused");
    failure.name = "UpstreamError";
    provider.generateJsonText.mockRejectedValue(failure);
    await call(ask());

    expect(JSON.stringify(error.mock.calls)).toContain("UpstreamError");
    expect(JSON.stringify(error.mock.calls)).not.toContain("rafting");
  });
});

describe("POST /api/papers/[id]/explain — the provider is resolved for this reader and this route", () => {
  it("passes the reader's own key through to the registry and names the route", async () => {
    const llmOverride = { provider: "gemini", apiKey: "USER-NOT-A-KEY" };
    await call(ask({ llmOverride }));

    expect(mocks.resolveProvider).toHaveBeenCalledTimes(1);
    const [override, context] = mocks.resolveProvider.mock.calls[0] as [unknown, { path: string; byok: boolean }];
    expect(override).toEqual(llmOverride);
    expect(context).toMatchObject({ path: "paper-explain", byok: true });
  });

  it("passes none when the request carries none", async () => {
    await call(ask());
    const [override, context] = mocks.resolveProvider.mock.calls[0] as [unknown, { byok: boolean }];

    expect(override).toBeNull();
    expect(context.byok).toBe(false);
  });
});
