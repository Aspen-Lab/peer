import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache, type ExplainAnswer } from "@/lib/papers/explain";
import { CompanySpendCapRefusedError } from "@/lib/usage/company-budget";
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";
import {
  ALL_USERS_EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_SEARCH_TENTHS,
  EXPLAIN_TENTHS_PER_DAY,
  EXPLAIN_TURN_TENTHS,
  explainTenthsHouseKey,
  explainTenthsKey,
} from "@/lib/usage/explain-quota";

// P3-02 (ruling §1h.2; §3d 14, 17): POST /api/papers/[id]/explain — one
// selected passage, explained in two parts, the second with a verified quote.
// P3-02c (§1h.4 amendment) turned the count into a charge: every model turn is
// paid for in tenths (one, or ten when it searched) BEFORE the model is asked,
// and a cache hit costs nothing — the tests below that used to say "counted"
// say "charged", and the ones about a failed call say what the amendment says:
// the charge stays (the report route's rule — a refusal inside the call still
// costs).
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
  webSearch?: boolean;
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

/** What this reader has been charged today, in tenths. */
async function tenths(): Promise<number> {
  return (await getCounterStore().read(explainTenthsKey("local-no-auth", NOW), NOW)).value;
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
    expect(await tenths()).toBe(0);
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

describe("POST /api/papers/[id]/explain — the memory and the charge", () => {
  it("asks the model once for the same passage twice: the second is a hit, with no call and no count", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.answer).toEqual(first.answer);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(await tenths()).toBe(1);
  });

  it("charges one tenth per model call, per reader per UTC day", async () => {
    await call(ask());
    expect(await tenths()).toBe(1);
    await call(ask({ passage: "Specimens were machined from a single casting", sectionId: "s2", paragraphIndex: 0 }));
    expect(await tenths()).toBe(2);
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
    expect(await tenths()).toBe(0);
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

  // P3-02c (§1h.4 amendment): this was "nothing counted or remembered". The
  // charge is taken before the model is asked, so a call that then fails or
  // answers nonsense has still been paid for — as in the report route, where a
  // deep read that degrades after the charge still costs. Nothing is remembered.
  it("is 200 unavailable, with nothing remembered and the charge kept, when the model fails or answers nonsense", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      () => Promise.reject(new Error("model down")),
      () => Promise.resolve("this is not json at all"),
      () => Promise.resolve(JSON.stringify({ meaning: "", here: { text: "x" } })),
      () => Promise.resolve(JSON.stringify({ meaning: "only one part" })),
    ];
    for (const failing of failures) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(await tenths()).toBe(failures.length * EXPLAIN_TURN_TENTHS);
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
    // P3-02c: a refusal inside the call still costs (it was 0 when a turn was only counted once delivered).
    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
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
    // P3-02c: `count` (the count-only counter's reading) is gone with the counter; `tenths` is this turn's charge.
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "tenths", "userId"]);
    expect(fields).toMatchObject({ tenths: EXPLAIN_TURN_TENTHS, cached: false });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect(fields.answerChars).toBeGreaterThan(20);
    expect(String(fields.userId)).toMatch(/^[0-9a-f]{12}$/);
    expect(String(fields.userId)).not.toContain("local-no-auth");
    expect((debug[1] as [string, Record<string, unknown>])[1]).toMatchObject({ cached: true, tenths: 0 });
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

// ── P3-02b (ruling §1h.3): the thread ───────────────────────────────────
// With a thread the route answers one reply turn: the reply prompt over the
// same context, the reply sanitised and its quote verified, counted on the same
// day counter, remembered under the document, the passage and the thread —
// never the reader. Every text is invented.

const FIRST_PEER = `${MEANING} ${HERE}`;
const REPLY = "A bigger share of plates changes how the metal carries load.";
const REPLY_Q = "Why does a bigger ratio matter for the blade?";
const modelReply = { reply: REPLY, evidence: DEF };
const thread1 = [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: REPLY_Q }];

function replyStub(body: unknown = modelReply) {
  provider = providerStub(JSON.stringify(body));
  mocks.resolveProvider.mockReturnValue(provider);
}

describe("POST /api/papers/[id]/explain — a reply to the thread", () => {
  it("asks the model once, on the small tier with 400 tokens, and answers the verified turn", async () => {
    replyStub();
    const response = await call(ask({ thread: thread1 }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    const args = provider.generateJsonText.mock.calls[0][0];
    expect(args.tier).toBe("small");
    expect(args.maxTokens).toBe(400);
    expect(body).toEqual({
      cached: false,
      // P3-02c: every reply says whether it searched the web (§3c) — here, not.
      turn: { role: "peer", text: REPLY, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, searched: false },
    });
  });

  it("builds the reply prompt: the paper's context and the thread in order, the reader's last message named", async () => {
    replyStub();
    await call(ask({ thread: thread1 }));
    const { userPrompt } = provider.generateJsonText.mock.calls[0][0];
    const parsed = JSON.parse(userPrompt) as { thread: Array<{ role: string; text: string }>; lastReaderMessage: string; outputSchema: Record<string, unknown> };

    expect(userPrompt).toContain(paper.title);
    expect(userPrompt).toContain(DEF);
    expect(userPrompt).toContain(PASSAGE);
    expect(parsed.thread).toEqual(thread1);
    expect(parsed.lastReaderMessage).toBe(REPLY_Q);
    expect(Object.keys(parsed.outputSchema)).toEqual(["reply", "evidence"]);
  });

  it("removes a quote the paper does not hold, or none at all, and says the reply is Peer's own", async () => {
    replyStub({ reply: REPLY, evidence: "We define the rafting ratio as the share of every plate that covered a crack." });
    expect((await json(await call(ask({ thread: thread1 })))).turn).toEqual({ role: "peer", text: REPLY, peer: true, searched: false });

    explainCache.clear();
    replyStub({ reply: REPLY });
    expect((await json(await call(ask({ thread: thread1 })))).turn).toEqual({ role: "peer", text: REPLY, peer: true, searched: false });
  });

  it("an empty thread is still the first answer, with the first answer's prompt and token budget", async () => {
    const body = await json(await call(ask({ thread: [] })));

    expect(body.answer).toBeDefined();
    expect(body.turn).toBeUndefined();
    expect(JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt)).not.toHaveProperty("thread");
    expect(provider.generateJsonText.mock.calls[0][0].maxTokens).toBe(600);
  });

  it("treats a malformed thread as no thread: the first answer, as with none", async () => {
    for (const bad of ["a thread", 5, {}, [1], [{ role: "robot", text: "x" }], [{ role: "reader" }], [{ role: "reader", text: "" }], [{ role: "peer", text: "ok" }, { role: "reader", text: 4 }]]) {
      explainCache.clear();
      provider.generateJsonText.mockClear();
      const response = await call(ask({ thread: bad }));
      const body = await json(response);

      expect(response.status).toBe(200);
      expect(body.answer).toBeDefined();
      expect(body.turn).toBeUndefined();
      expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    }
  });

  it("answers 400 to a thread whose last message is not the reader's — before any model is asked or anything counted", async () => {
    const response = await call(ask({ thread: [{ role: "reader", text: REPLY_Q }, { role: "peer", text: REPLY }] }));

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "thread must end with the reader's message" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(await tenths()).toBe(0);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("answers 400 thread_full for more than eight reader messages, and accepts exactly eight", async () => {
    const pair = (i: number) => [{ role: "reader", text: `question number ${i}` }, { role: "peer", text: `answer number ${i}` }];
    const eight = [{ role: "peer", text: FIRST_PEER }, ...[1, 2, 3, 4, 5, 6, 7].flatMap(pair), { role: "reader", text: "question number 8" }];
    const nine = [{ role: "peer", text: FIRST_PEER }, ...[1, 2, 3, 4, 5, 6, 7, 8].flatMap(pair), { role: "reader", text: "question number 9" }];
    replyStub();

    const full = await call(ask({ thread: nine }));
    expect(full.status).toBe(400);
    expect(await json(full)).toEqual({ error: "thread_full" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(await tenths()).toBe(0);

    expect(eight).toHaveLength(16);
    expect((await call(ask({ thread: eight }))).status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("clips what it reads: a long message is cut to 400 characters in the prompt, whatever was sent", async () => {
    replyStub();
    await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: `${"reader words ".repeat(300)}` }] }));
    const parsed = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { thread: Array<{ text: string }> };

    for (const message of parsed.thread) expect(message.text.length).toBeLessThanOrEqual(400);
    expect(parsed.thread[1].text.length).toBeGreaterThan(300);
  });

  // P3-05 (§1h.8 (3), O8): the first message of a thread is the first answer, both of
  // its parts joined; the model that writes a follow-up reads it whole (up to 840
  // characters), while every later message is still cut to 400.
  it("reads the first answer whole and a later message of the same length cut to 400, whatever was sent", async () => {
    replyStub();
    const answer = `${"alpha ".repeat(67)}ends-meaning. ${"gamma ".repeat(68)}ends-here.`;
    const later = "reader words ".repeat(60).trim();
    await call(ask({ thread: [{ role: "peer", text: answer }, { role: "reader", text: later }] }));
    const sent = provider.generateJsonText.mock.calls[0][0].userPrompt as string;
    const parsed = JSON.parse(sent) as { thread: Array<{ text: string }> };

    expect(answer.length).toBeGreaterThan(800);
    expect(parsed.thread[0].text).toBe(answer);
    expect(sent).toContain("ends-here.");
    expect(parsed.thread[1].text.length).toBeLessThanOrEqual(400);
    expect(later.length).toBeGreaterThan(700);
  });

  it("asks the model once for the same thread twice: the second is a hit, with no call and no count", async () => {
    replyStub();
    const first = await json(await call(ask({ thread: thread1 })));
    const second = await json(await call(ask({ thread: thread1 })));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.turn).toEqual(first.turn);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(await tenths()).toBe(1);
  });

  it("keeps a longer thread, another message and the first answer apart in the memory", async () => {
    replyStub();
    provider.generateJsonText.mockResolvedValueOnce(JSON.stringify(modelAnswer));
    await call(ask());
    await call(ask({ thread: thread1 }));
    await call(ask({ thread: [...thread1, { role: "peer", text: REPLY }, { role: "reader", text: "And at a lower temperature?" }] }));
    await call(ask({ thread: [thread1[0], { role: "reader", text: "A different question?" }] }));

    expect(provider.generateJsonText).toHaveBeenCalledTimes(4);
    expect(explainCache.size()).toBe(4);
  });

  it("charges a reply on the same day counter as the first answer, one tenth each", async () => {
    replyStub();
    provider.generateJsonText.mockResolvedValueOnce(JSON.stringify(modelAnswer)).mockResolvedValueOnce(JSON.stringify(modelReply));
    await call(ask());
    expect(await tenths()).toBe(1);
    await call(ask({ thread: thread1 }));
    expect(await tenths()).toBe(2);
  });

  // P3-02c (§1h.4 amendment): as for the first answer, the charge is taken before the model is asked and stays.
  it("is 200 unavailable, with nothing remembered and the charge kept, when the model fails or answers nonsense", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [() => Promise.reject(new Error("model down")), () => Promise.resolve("not json"), () => Promise.resolve(JSON.stringify({ reply: "" })), () => Promise.resolve(JSON.stringify({ evidence: DEF }))];
    for (const failing of failures) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask({ thread: thread1 }));

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(await tenths()).toBe(failures.length * EXPLAIN_TURN_TENTHS);
    expect(explainCache.size()).toBe(0);
  });

  it("answers a company-budget refusal with unavailable and the quota signal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    provider.generateJsonText.mockRejectedValue(new CompanySpendCapRefusedError("global_cap_exceeded"));
    const body = await json(await call(ask({ thread: thread1 })));

    expect(body.unavailable).toBe(true);
    expect(body.quota).toMatchObject({ kind: "company_budget", reason: "exhausted" });
  });

  it("still refuses 422 a passage the body does not hold, with a thread", async () => {
    const response = await call(ask({ passage: "a sentence the paper never wrote", thread: thread1 }));

    expect(response.status).toBe(422);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 200 unavailable when no provider can write, and asks for nothing", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    const response = await call(ask({ thread: thread1 }));

    expect(await json(response)).toEqual({ unavailable: true });
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/explain — a reply about a private upload", () => {
  const UPLOAD = "upload:0123456789abcdef";
  const uploadPaper = { ...paper, id: UPLOAD };

  it("answers an owner with the private headers on the turn", async () => {
    replyStub();
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    const response = await call(ask({ paper: uploadPaper, thread: thread1 }), UPLOAD);

    expect(response.status).toBe(200);
    expect((await json(response)).turn).toBeDefined();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is 404 for an upload the caller does not own, before the thread is read for any use", async () => {
    mocks.ownedUpload.mockResolvedValue(null);
    const response = await call(ask({ paper: uploadPaper, thread: thread1 }), UPLOAD);

    expect(response.status).toBe(404);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 410, with nothing cached, when the upload changed while the model was working on a reply", async () => {
    replyStub();
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const response = await call(ask({ paper: uploadPaper, thread: thread1 }), UPLOAD);

    expect(response.status).toBe(410);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(explainCache.size()).toBe(0);
  });
});

describe("POST /api/papers/[id]/explain — what a reply logs", () => {
  it("writes the same one debug line, plus the message count, and none of the reader's words", async () => {
    replyStub();
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    const sentinel = [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "READER-SENTINEL asks about the ratio?" }];
    await call(ask({ thread: sentinel }));
    await call(ask({ thread: sentinel }));
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(debug).toHaveLength(2);
    const [label, fields] = debug[0] as [string, Record<string, unknown>];
    expect(label).toBe("[papers/explain] turn");
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "tenths", "thread", "userId"]);
    expect(fields).toMatchObject({ tenths: EXPLAIN_TURN_TENTHS, cached: false, thread: 2 });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect((debug[1] as [string, Record<string, unknown>])[1]).toMatchObject({ cached: true, tenths: 0, thread: 2 });
    expect(levels.slice(0, 4).every((spy) => spy.mock.calls.length === 0)).toBe(true);

    for (const word of ["READER-SENTINEL", "rafting", "gauge", "Rafting under creep", "plates", "carries load", "ratio"]) {
      expect(all).not.toContain(word);
    }
  });

  it("does not add the message count to the first answer's line", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    await call(ask());

    expect(Object.keys((debug.mock.calls[0] as [string, Record<string, unknown>])[1])).not.toContain("thread");
  });
});

// ── P3-02c (ruling §1h.4, amendment of 08:1xZ 2026-10-06): the charge ────────
// Every model turn is paid for in tenths of a deep-report unit — one, or ten
// when the reply searched the web — after the owner checks, the gate, the
// provider check and the memory, and before the model is asked. A refused
// charge is a 429 and no model call. The first message never searches.

const UPLOAD_ID = "upload:0123456789abcdef";

/** A provider that says it can search the web, as both Gemini providers do. */
function searchStub(body: unknown = modelReply) {
  provider = Object.assign(providerStub(typeof body === "string" ? body : JSON.stringify(body)), { supportsWebSearch: true as const });
  mocks.resolveProvider.mockReturnValue(provider);
}
const modelArgs = (n = 0) => provider.generateJsonText.mock.calls[n][0];
const promptRules = (n = 0) => (JSON.parse(modelArgs(n).userPrompt) as { rules: string[] }).rules.join(" ");
const RESETS_AT = "2026-10-07T00:00:00.000Z";

describe("POST /api/papers/[id]/explain — the charge: where it is taken (P3-02c)", () => {
  it("is taken BEFORE the model is asked: by the time the model runs, the tenth is already spent", async () => {
    let seen = -1;
    provider.generateJsonText.mockImplementation(async () => {
      seen = await tenths();
      return JSON.stringify(modelAnswer);
    });
    await call(ask());

    expect(seen).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("is taken AFTER the memory: a hit costs nothing, even from a reader whose day is spent", async () => {
    await call(ask());
    await getCounterStore().increment(explainTenthsKey("local-no-auth", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    const before = await tenths();
    const hit = await call(ask());

    expect(hit.status).toBe(200);
    expect((await json(hit)).cached).toBe(true);
    expect(await tenths()).toBe(before);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("is taken only once the owner checks have passed: an upload the caller does not own costs nothing", async () => {
    mocks.ownedUpload.mockResolvedValue(null);
    const response = await call(ask({ paper: { ...paper, id: UPLOAD_ID } }), UPLOAD_ID);

    expect(response.status).toBe(404);
    expect(await tenths()).toBe(0);
    expect(await houseTenths()).toBe(0);
  });

  it("charges the house's counter as well as the reader's, by the same tenths", async () => {
    await call(ask());

    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
    expect(await houseTenths()).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("charges a reader on their own key as it charges one on Peer's: every plan, a BYOK reader included", async () => {
    await call(ask({ llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } }));

    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("keeps the charge when the model's call is refused for the company budget — a searched turn costs ten even so", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    searchStub();
    provider.generateJsonText.mockRejectedValue(new CompanySpendCapRefusedError("per_user_cap_exceeded"));
    const body = await json(await call(ask({ thread: thread1, search: true })));

    expect(body.unavailable).toBe(true);
    expect(await tenths()).toBe(EXPLAIN_SEARCH_TENTHS);
  });
});

async function houseTenths(): Promise<number> {
  return (await getCounterStore().read(explainTenthsHouseKey(NOW), NOW)).value;
}

describe("POST /api/papers/[id]/explain — a refused charge (P3-02c)", () => {
  it("is 429 explain_exhausted when the reader's day is spent: no model call, nothing remembered, the hour the day ends", async () => {
    await getCounterStore().increment(explainTenthsKey("local-no-auth", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    const response = await call(ask());

    expect(response.status).toBe(429);
    expect(await json(response)).toEqual({ error: "explain_exhausted", reason: "exhausted", resetsAt: RESETS_AT });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(explainCache.size()).toBe(0);
    expect(response.headers.get("cache-control")).toMatch(/no-store/);
  });

  it("is the same for a reply in a thread", async () => {
    replyStub();
    await getCounterStore().increment(explainTenthsKey("local-no-auth", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    const response = await call(ask({ thread: thread1 }));

    expect(response.status).toBe(429);
    expect((await json(response)).error).toBe("explain_exhausted");
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("carries the private headers when the paper is an upload", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD_ID] });
    await getCounterStore().increment(explainTenthsKey("local-no-auth", NOW), null, EXPLAIN_TENTHS_PER_DAY, NOW);
    const response = await call(ask({ paper: { ...paper, id: UPLOAD_ID } }), UPLOAD_ID);

    expect(response.status).toBe(429);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 429 for a reader far under their own cap when the house ceiling is spent — and takes nothing from them", async () => {
    await getCounterStore().increment(explainTenthsHouseKey(NOW), null, ALL_USERS_EXPLAIN_TENTHS_PER_DAY, NOW);
    const response = await call(ask());

    expect(response.status).toBe(429);
    expect(await json(response)).toMatchObject({ error: "explain_exhausted", reason: "exhausted" });
    expect(await tenths()).toBe(0);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("says unavailable, not exhausted, when the counter cannot be read — and asks nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(getCounterStore(), "increment").mockResolvedValue({ value: 0, ok: false });
    const response = await call(ask());

    expect(response.status).toBe(429);
    expect(await json(response)).toEqual({ error: "explain_exhausted", reason: "unavailable", resetsAt: RESETS_AT });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("refuses a searched turn that would cross the cap and still lets a normal one through", async () => {
    searchStub();
    await getCounterStore().increment(explainTenthsKey("local-no-auth", NOW), null, EXPLAIN_TENTHS_PER_DAY - 5, NOW);
    const refused = await call(ask({ thread: thread1, search: true }));
    const normal = await call(ask({ thread: thread1 }));

    expect(refused.status).toBe(429);
    expect(normal.status).toBe(200);
    expect(modelArgs().webSearch).toBe(false);
    expect(await tenths()).toBe(EXPLAIN_TENTHS_PER_DAY - 5 + EXPLAIN_TURN_TENTHS);
  });
});

describe("POST /api/papers/[id]/explain — a reply that searches the web (P3-02c)", () => {
  it("with search on and a provider that can: asks with webSearch true, charges ten, says it searched, and puts the search rule in the prompt", async () => {
    searchStub();
    const response = await call(ask({ thread: thread1, search: true }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(modelArgs()).toMatchObject({ webSearch: true, tier: "small", maxTokens: 400 });
    expect(promptRules()).toContain("You may use web search for general background.");
    expect(promptRules()).not.toContain("Do not search the web");
    expect(body.turn).toEqual({ role: "peer", text: REPLY, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, searched: true });
    expect(await tenths()).toBe(EXPLAIN_SEARCH_TENTHS);
  });

  it("with search off: webSearch false, one tenth, the plain prompt, searched false — whatever the provider can do", async () => {
    searchStub();
    const body = await json(await call(ask({ thread: thread1 })));

    expect(modelArgs().webSearch).toBe(false);
    expect(promptRules()).toContain("Do not search the web");
    expect((body.turn as { searched: boolean }).searched).toBe(false);
    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("with search on and a provider that cannot: a normal turn — one tenth, webSearch false, the plain prompt, searched false", async () => {
    replyStub();
    const body = await json(await call(ask({ thread: thread1, search: true })));

    expect(modelArgs().webSearch).toBe(false);
    expect(promptRules()).toContain("Do not search the web");
    expect(promptRules()).not.toMatch(/may use web search/i);
    expect((body.turn as { searched: boolean }).searched).toBe(false);
    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("takes only a literal true for a wish to search", async () => {
    searchStub();
    for (const search of ["true", 1, {}, [true], null, "yes"]) {
      explainCache.clear();
      provider.generateJsonText.mockClear();
      const body = await json(await call(ask({ thread: thread1, search })));

      expect(modelArgs().webSearch).toBe(false);
      expect((body.turn as { searched: boolean }).searched).toBe(false);
    }
    expect(await tenths()).toBe(6 * EXPLAIN_TURN_TENTHS);
  });

  it("never searches the first message, whatever the request says: no webSearch, one tenth, no search in the prompt", async () => {
    searchStub(modelAnswer);
    const body = await json(await call(ask({ search: true })));

    expect(body.answer).toBeDefined();
    expect(body.turn).toBeUndefined();
    expect(modelArgs().webSearch).toBe(false);
    expect(modelArgs().userPrompt).not.toMatch(/web search/i);
    expect(await tenths()).toBe(EXPLAIN_TURN_TENTHS);
  });

  it("remembers a searched reply under its own key: the same searched request is a hit, a plain one for the same thread is not", async () => {
    searchStub();
    const first = await json(await call(ask({ thread: thread1, search: true })));
    const again = await json(await call(ask({ thread: thread1, search: true })));

    expect(again.cached).toBe(true);
    expect(again.turn).toEqual(first.turn);
    expect((again.turn as { searched: boolean }).searched).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(await tenths()).toBe(EXPLAIN_SEARCH_TENTHS);

    const plain = await json(await call(ask({ thread: thread1 })));
    expect(plain.cached).toBe(false);
    expect((plain.turn as { searched: boolean }).searched).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
    expect(await tenths()).toBe(EXPLAIN_SEARCH_TENTHS + EXPLAIN_TURN_TENTHS);
    expect(explainCache.size()).toBe(2);
  });

  it("a plain reply is never served to a request that asked to search of a provider that can", async () => {
    searchStub();
    await call(ask({ thread: thread1 }));
    const searching = await json(await call(ask({ thread: thread1, search: true })));

    expect(searching.cached).toBe(false);
    expect(modelArgs(1).webSearch).toBe(true);
  });

  it("holds the searched reply's quote to the paper exactly as a plain one's: a quote the paper does not hold is removed", async () => {
    searchStub({ reply: REPLY, evidence: "We define the rafting ratio as the share of every plate that covered a crack." });
    const body = await json(await call(ask({ thread: thread1, search: true })));

    expect(body.turn).toEqual({ role: "peer", text: REPLY, peer: true, searched: true });
  });

  it("parses what a model says when it was not in JSON mode: a fence, or words around the object", async () => {
    searchStub();
    for (const raw of [`\`\`\`json\n${JSON.stringify(modelReply)}\n\`\`\``, `Here is the answer.\n${JSON.stringify(modelReply)}\nHope that helps.`]) {
      explainCache.clear();
      provider.generateJsonText.mockResolvedValue(raw);
      const body = await json(await call(ask({ thread: thread1, search: true })));

      expect(body.turn).toMatchObject({ text: REPLY, evidence: DEF, searched: true });
    }
  });

  it("shows no web address, whatever the model wrote: it is the paper's words and Peer's, and no link", async () => {
    searchStub({ reply: "Plates form under load (see https://example.org/guide/rafting for more) and www.example.com/alloys agrees. They carry load." });
    const body = await json(await call(ask({ thread: thread1, search: true })));
    const text = (body.turn as { text: string }).text;

    expect(text).not.toMatch(/https?:|www\.|example\.(org|com)/i);
    expect(text).toContain("Plates form under load");
    expect(text).toContain("They carry load.");
  });

  it("writes the same one debug line with this turn's tenths: ten for a searched one, and none of the paper's, the reader's or the web's words", async () => {
    searchStub();
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "READER-SENTINEL asks about the ratio?" }], search: true }));
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(debug).toHaveLength(1);
    const fields = (debug[0] as [string, Record<string, unknown>])[1];
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "tenths", "thread", "userId"]);
    expect(fields).toMatchObject({ tenths: EXPLAIN_SEARCH_TENTHS, cached: false, thread: 2 });
    for (const word of ["READER-SENTINEL", "rafting", "gauge", "Rafting under creep", "plates", "carries load"]) expect(all).not.toContain(word);
  });
});
