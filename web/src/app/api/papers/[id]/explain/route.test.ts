import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache, type ExplainAnswer } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P3-02 (ruling §1h.2; §3d 14, 17): POST /api/papers/[id]/explain — one
// selected passage, explained in two parts, the second with a verified quote.
// P4-00: the model is the reader's own key, so nothing here is counted, charged or
// capped by Peer — the tests of the allowance (the tenths, the day cap, the house
// ceiling, the 429 `explain_exhausted`, the company budget's quota signal) went with
// the allowance; what bounds a reader is the gate's hourly limit.
// A counting provider stub stands in for the model: no real call anywhere. The
// sign-in gate and the hourly limit across readers are in `route.gate.test.ts`
// (it needs a deployed runtime and a session stub).
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

describe("POST /api/papers/[id]/explain — the memory", () => {
  it("asks the model once for the same passage twice: the second is a hit, with no call", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.answer).toEqual(first.answer);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
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

  it("is 200 unavailable, with nothing remembered, when the model fails or answers nonsense", async () => {
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
    expect(explainCache.size()).toBe(0);
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
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars"]);
    expect(fields).toMatchObject({ cached: false });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect(fields.answerChars).toBeGreaterThan(20);
    // No one is signed in here (the ordinary route tests run with no sign-in at all), so
    // there is no account to hash; `route.gate.test.ts` pins the line a signed-in reader gets.
    expect(fields).not.toHaveProperty("userId");
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

describe("POST /api/papers/[id]/explain — the provider is the reader's own", () => {
  it("passes the reader's own key through to the registry, and nothing else", async () => {
    const llmOverride = { provider: "gemini", apiKey: "USER-NOT-A-KEY" };
    await call(ask({ llmOverride }));

    expect(mocks.resolveProvider).toHaveBeenCalledTimes(1);
    // One argument: the registry takes the reader's override and no context (P4-00).
    expect(mocks.resolveProvider.mock.calls[0]).toEqual([llmOverride]);
  });

  it("passes none when the request carries none", async () => {
    await call(ask());

    expect(mocks.resolveProvider.mock.calls[0]).toEqual([null]);
  });
});

// ── P3-02b (ruling §1h.3): the thread ───────────────────────────────────
// With a thread the route answers one reply turn: the reply prompt over the
// same context, the reply sanitised and its quote verified, remembered under the
// document, the passage and the thread — never the reader. Every text is invented.

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
    // P3-07 (§1h.9 (3)): the reply schema gains the optional `items` (the term table).
    expect(Object.keys(parsed.outputSchema)).toEqual(["reply", "evidence", "items"]);
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

  it("answers 400 to a thread whose last message is not the reader's — before any model is asked", async () => {
    const response = await call(ask({ thread: [{ role: "reader", text: REPLY_Q }, { role: "peer", text: REPLY }] }));

    expect(response.status).toBe(400);
    expect(await json(response)).toEqual({ error: "thread must end with the reader's message" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
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
  // its parts joined; the model that writes a follow-up reads it whole (up to 841
  // characters: both parts at their cap and the space between), while every later
  // message is still cut to 400.
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

  // P4-00c (the 841 edge, A's P3-06b O-2): both parts at their cap, 420 + a space + 420, are
  // the first message of a thread; the model reads all of it, the last word of "Why it is
  // here" included — at 840 that word was cut.
  it("reads a first answer with both parts at their cap whole, through the route", async () => {
    replyStub();
    const answer = `${`${"alpha ".repeat(69)}ends-meaning.`.slice(-420)} ${`${"gamma ".repeat(69)}ends-here.`.slice(-420)}`;
    await call(ask({ thread: [{ role: "peer", text: answer }, { role: "reader", text: "What does the ratio change?" }] }));
    const sent = provider.generateJsonText.mock.calls[0][0].userPrompt as string;
    const parsed = JSON.parse(sent) as { thread: Array<{ text: string }> };

    expect(answer).toHaveLength(841);
    expect(parsed.thread[0].text).toBe(answer);
    expect(sent).toContain("ends-here.");
  });

  it("asks the model once for the same thread twice: the second is a hit, with no call", async () => {
    replyStub();
    const first = await json(await call(ask({ thread: thread1 })));
    const second = await json(await call(ask({ thread: thread1 })));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.turn).toEqual(first.turn);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
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

  it("is 200 unavailable, with nothing remembered, when the model fails or answers nonsense", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [() => Promise.reject(new Error("model down")), () => Promise.resolve("not json"), () => Promise.resolve(JSON.stringify({ reply: "" })), () => Promise.resolve(JSON.stringify({ evidence: DEF }))];
    for (const failing of failures) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask({ thread: thread1 }));

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(explainCache.size()).toBe(0);
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
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "thread"]);
    expect(fields).toMatchObject({ cached: false, thread: 2 });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect((debug[1] as [string, Record<string, unknown>])[1]).toMatchObject({ cached: true, thread: 2 });
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

// ── P3-02c (ruling §1h.4, amendment of 08:1xZ 2026-10-06): the web search ────
// A reply may search the web, for that message only, when the reader asked and the
// provider can; the first message never searches. (The charge this section also
// tested — ten tenths for a searched turn, the 429 — went with the allowance, P4-00.)

/** A provider that says it can search the web, as both Gemini providers do. */
function searchStub(body: unknown = modelReply) {
  provider = Object.assign(providerStub(typeof body === "string" ? body : JSON.stringify(body)), { supportsWebSearch: true as const });
  mocks.resolveProvider.mockReturnValue(provider);
}
const modelArgs = (n = 0) => provider.generateJsonText.mock.calls[n][0];
const promptRules = (n = 0) => (JSON.parse(modelArgs(n).userPrompt) as { rules: string[] }).rules.join(" ");

describe("POST /api/papers/[id]/explain — a reply that searches the web (P3-02c)", () => {
  it("with search on and a provider that can: asks with webSearch true, says it searched, and puts the search rule in the prompt", async () => {
    searchStub();
    const response = await call(ask({ thread: thread1, search: true }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(modelArgs()).toMatchObject({ webSearch: true, tier: "small", maxTokens: 400 });
    expect(promptRules()).toContain("You may use web search for general background.");
    expect(promptRules()).not.toContain("Do not search the web");
    expect(body.turn).toEqual({ role: "peer", text: REPLY, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2, searched: true });
  });

  it("with search off: webSearch false, the plain prompt, searched false — whatever the provider can do", async () => {
    searchStub();
    const body = await json(await call(ask({ thread: thread1 })));

    expect(modelArgs().webSearch).toBe(false);
    expect(promptRules()).toContain("Do not search the web");
    expect((body.turn as { searched: boolean }).searched).toBe(false);
  });

  it("with search on and a provider that cannot: a normal turn — webSearch false, the plain prompt, searched false", async () => {
    replyStub();
    const body = await json(await call(ask({ thread: thread1, search: true })));

    expect(modelArgs().webSearch).toBe(false);
    expect(promptRules()).toContain("Do not search the web");
    expect(promptRules()).not.toMatch(/may use web search/i);
    expect((body.turn as { searched: boolean }).searched).toBe(false);
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
  });

  it("never searches the first message, whatever the request says: no webSearch, no search in the prompt", async () => {
    searchStub(modelAnswer);
    const body = await json(await call(ask({ search: true })));

    expect(body.answer).toBeDefined();
    expect(body.turn).toBeUndefined();
    expect(modelArgs().webSearch).toBe(false);
    expect(modelArgs().userPrompt).not.toMatch(/web search/i);
  });

  it("remembers a searched reply under its own key: the same searched request is a hit, a plain one for the same thread is not", async () => {
    searchStub();
    const first = await json(await call(ask({ thread: thread1, search: true })));
    const again = await json(await call(ask({ thread: thread1, search: true })));

    expect(again.cached).toBe(true);
    expect(again.turn).toEqual(first.turn);
    expect((again.turn as { searched: boolean }).searched).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);

    const plain = await json(await call(ask({ thread: thread1 })));
    expect(plain.cached).toBe(false);
    expect((plain.turn as { searched: boolean }).searched).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
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

  it("writes the same one debug line for a searched turn, and none of the paper's, the reader's or the web's words", async () => {
    searchStub();
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "READER-SENTINEL asks about the ratio?" }], search: true }));
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(debug).toHaveLength(1);
    const fields = (debug[0] as [string, Record<string, unknown>])[1];
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "cached", "promptChars", "thread"]);
    expect(fields).toMatchObject({ cached: false, thread: 2 });
    for (const word of ["READER-SENTINEL", "rafting", "gauge", "Rafting under creep", "plates", "carries load"]) expect(all).not.toContain(word);
  });
});

// ── P3-07 (ruling §1h.9; user decision §1a.14): short and exact ────────────
// The route reads `detail` from the body (a literal `true` only) and sets the
// effective detail = the body's flag OR the reader's last message asking for
// more in words; the cap that applies (three sentences, or eight) goes into the
// prompt and into the sanitizer; the memory keeps a short and a long reply apart;
// and a reply may carry a term table, its rows
// grounded in the paper. Every text is invented.

const lecture = (count: number) => Array.from({ length: count }, (_, i) => `Point ${i + 1} is plain and short.`).join(" ");
const row = (term: string) => ({ term, here: "what it means in this paper", read: "how a reader should take it" });

describe("POST /api/papers/[id]/explain — the long form (P3-07)", () => {
  const detailBody = (over: Record<string, unknown> = {}) => ask({ thread: thread1, ...over });

  it("is short by default: a nine-sentence reply is cut to three whole sentences, with no `detail` on the turn", async () => {
    replyStub({ reply: lecture(9), evidence: DEF });
    const body = await json(await call(detailBody()));

    expect((body.turn as { text: string }).text).toBe(lecture(3));
    expect(body.turn).not.toHaveProperty("detail");
    expect(provider.generateJsonText.mock.calls[0][0].maxTokens).toBe(400);
    expect(promptRules()).toMatch(/three sentences/i);
    expect(promptRules()).not.toMatch(/eight sentences/i);
  });

  it("with `detail: true` in the body: the long cap in the prompt, eight whole sentences kept, `detail: true` on the turn, a larger token budget", async () => {
    replyStub({ reply: lecture(12), evidence: DEF });
    const response = await call(detailBody({ detail: true }));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect((body.turn as { text: string }).text).toBe(lecture(8));
    expect(body.turn).toMatchObject({ role: "peer", evidence: DEF, searched: false, detail: true });
    expect(promptRules()).toMatch(/eight sentences/i);
    expect(promptRules()).toMatch(/1,400 characters/);
    expect(provider.generateJsonText.mock.calls[0][0].maxTokens).toBe(800);
  });

  it("takes only a literal true for the flag: a string, a number, an object, false or nothing is not a request for more", async () => {
    for (const flag of ["true", 1, "yes", {}, [true], false, null, undefined]) {
      explainCache.clear();
      replyStub({ reply: lecture(9) });
      const body = await json(await call(detailBody({ detail: flag })));

      expect((body.turn as { text: string }).text, String(flag)).toBe(lecture(3));
      expect(body.turn, String(flag)).not.toHaveProperty("detail");
    }
  });

  it("takes the reader's last message asking for more in words as the same thing: English and Chinese", async () => {
    for (const asked of ["Please explain that in detail.", "tell me more", "Can you elaborate?", "请详细解释一下", "能展开说说吗", "Can you give me more details?", "details please"]) {
      explainCache.clear();
      replyStub({ reply: lecture(12) });
      const body = await json(await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: asked }] })));

      expect((body.turn as { text: string }).text, asked).toBe(lecture(8));
      expect(body.turn, asked).toMatchObject({ detail: true });
      expect(promptRules(), asked).toMatch(/eight sentences/i);
    }
  });

  it("reads only the reader's LAST message for those words: an earlier ask for detail does not make the next reply long", async () => {
    replyStub({ reply: lecture(12) });
    const earlier = [
      { role: "peer", text: FIRST_PEER },
      { role: "reader", text: "Explain it in detail" },
      { role: "peer", text: REPLY },
      { role: "reader", text: "And at a lower temperature?" },
    ];
    const body = await json(await call(ask({ thread: earlier })));

    expect((body.turn as { text: string }).text).toBe(lecture(3));
    expect(body.turn).not.toHaveProperty("detail");
  });

  it("does not read a peer message for those words: Peer saying 'in detail' is not the reader asking", async () => {
    replyStub({ reply: lecture(12) });
    const body = await json(await call(ask({ thread: [{ role: "peer", text: "Here it is in detail and step by step. Tell me more." }, { role: "reader", text: "And at a lower temperature?" }] })));

    expect((body.turn as { text: string }).text).toBe(lecture(3));
  });

  it("is not the first answer's business: a first message with `detail: true` is the first answer, unchanged", async () => {
    const body = await json(await call(ask({ detail: true })));

    expect(body.answer).toBeDefined();
    expect(body.turn).toBeUndefined();
    expect(provider.generateJsonText.mock.calls[0][0].maxTokens).toBe(600);
    expect(JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt)).not.toHaveProperty("thread");
    expect(JSON.stringify(body)).not.toContain('"detail"');
  });

  it("keeps a short and a long reply to the same message apart in the memory: two entries, each a hit on its own repeat", async () => {
    replyStub({ reply: lecture(12) });
    const short = await json(await call(detailBody()));
    const long = await json(await call(detailBody({ detail: true })));
    const shortAgain = await json(await call(detailBody()));
    const longAgain = await json(await call(detailBody({ detail: true })));

    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
    expect(explainCache.size()).toBe(2);
    expect((short.turn as { text: string }).text).toBe(lecture(3));
    expect((long.turn as { text: string }).text).toBe(lecture(8));
    expect(shortAgain).toEqual({ ...short, cached: true });
    expect(longAgain).toEqual({ ...long, cached: true });
  });

  it("asking in words and pressing the button are the same entry: one model call for the same long reply", async () => {
    replyStub({ reply: lecture(12) });
    await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "explain in detail" }] }));
    const again = await json(await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "explain in detail" }], detail: true })));

    expect(again.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("accepts the thread Say more sends: the reader's last message once, the earlier reply left out — eight readers, none added", async () => {
    replyStub({ reply: lecture(9) });
    const pair = (i: number) => [{ role: "reader", text: `question number ${i}` }, { role: "peer", text: `answer number ${i}` }];
    const sayMore = [{ role: "peer", text: FIRST_PEER }, ...[1, 2, 3, 4, 5, 6, 7].flatMap(pair), { role: "reader", text: "question number 8" }];
    const response = await call(ask({ thread: sayMore, detail: true }));

    expect(response.status).toBe(200);
    expect(((await json(response)).turn as { text: string }).text).toBe(lecture(8));
  });

  it("writes the same one debug line for the long form: no new key, and none of the reader's words", async () => {
    replyStub({ reply: lecture(12) });
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    await call(ask({ thread: [{ role: "peer", text: FIRST_PEER }, { role: "reader", text: "READER-SENTINEL explain in detail?" }], detail: true }));
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(debug).toHaveLength(1);
    expect(Object.keys((debug[0] as [string, Record<string, unknown>])[1]).sort()).toEqual(["answerChars", "cached", "promptChars", "thread"]);
    for (const word of ["READER-SENTINEL", "rafting", "gauge", "Point 1"]) expect(all).not.toContain(word);
  });
});

describe("POST /api/papers/[id]/explain — a reply with a term table (P3-07)", () => {
  const tableReply = (items: unknown, over: Record<string, unknown> = {}) => ({ reply: "The authors report two values. Both come from the sample.", evidence: DEF, items, ...over });

  it("answers the grounded rows on the turn, in order, and drops a row whose term is nowhere in the passage, its paragraph, its neighbours or its section", async () => {
    replyStub(tableReply([row("rafting ratio"), row("tungsten additions"), row("gauge length"), row("spline interpolation")]));
    const body = await json(await call(ask({ thread: thread1 })));

    expect(body.turn).toEqual({
      role: "peer",
      text: "The authors report two values. Both come from the sample.",
      evidence: DEF,
      evidenceWhere: "2 Methods",
      sectionId: "s2",
      page: 2,
      searched: false,
      items: [row("rafting ratio"), row("gauge length")],
    });
  });

  it("has no items key when no row survives, and says the prose as the usual three sentences were allowed", async () => {
    replyStub(tableReply([row("tungsten additions")], { reply: lecture(5) }));
    const body = await json(await call(ask({ thread: thread1 })));

    expect(body.turn).not.toHaveProperty("items");
    // The shape check ran with a valid row, so the prose was held to two sentences before the paper was asked.
    expect((body.turn as { text: string }).text).toBe(lecture(2));
  });

  it("holds the shape: at most four rows, a cell over a dozen words or eighty characters drops its row", async () => {
    replyStub(tableReply([row("rafting ratio"), { term: "gauge length", here: "w ".repeat(13).trim(), read: "ok" }, { term: "constant load", here: "x".repeat(81), read: "ok" }, row("single casting"), row("heat treated"), row("fraction"), row("covered by plates")]));
    const body = await json(await call(ask({ thread: thread1 })));
    const items = (body.turn as { items: Array<{ term: string }> }).items;

    expect(items.length).toBeLessThanOrEqual(4);
    // The fit rows, the first four of them; the two that were over a cap were dropped, not cut, and the fifth fit row is over four.
    expect(items.map((item) => item.term)).toEqual(["rafting ratio", "single casting", "heat treated", "fraction"]);
  });

  it("a table with a long reply: the long form's eight sentences do not apply while rows are present", async () => {
    replyStub(tableReply([row("rafting ratio")], { reply: lecture(9) }));
    const body = await json(await call(ask({ thread: thread1, detail: true })));

    expect((body.turn as { text: string }).text).toBe(lecture(2));
    expect(body.turn).toMatchObject({ detail: true, items: [row("rafting ratio")] });
  });

  it("remembers the table with the turn, so a repeat is a hit that carries it", async () => {
    replyStub(tableReply([row("rafting ratio")]));
    const first = await json(await call(ask({ thread: thread1 })));
    const again = await json(await call(ask({ thread: thread1 })));

    expect(again.cached).toBe(true);
    expect(again.turn).toEqual(first.turn);
    expect((again.turn as { items: unknown[] }).items).toHaveLength(1);
  });

  // P4-00c (§1h.11 (a), A's P3-06b P7-14): this test said "never puts a table on the first
  // answer: it has no such schema, and the model's items there are not read" — the P3-07
  // ruling. The owner's standard applies to the first answer too, so the route now reads the
  // table there (the same sanitizer and grounding as a reply's); the cases below replace it.
  it("puts a first answer's grounded rows on the answer, in order, and drops a row whose term is nowhere in the passage, its paragraph, its neighbours or its section", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...modelAnswer, items: [row("rafting ratio"), row("tungsten additions"), row("gauge length"), row("spline interpolation")] }));
    const body = await json(await call(ask()));

    expect(body).toEqual({
      cached: false,
      answer: {
        meaning: MEANING,
        here: { text: HERE, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
        items: [row("rafting ratio"), row("gauge length")],
      },
    });
  });

  it("holds a first answer's parts to one sentence when the model sends a table, and to two when it does not", async () => {
    const twoEach = { meaning: `${MEANING} It is a share, not a count.`, here: { text: `${HERE} It rose with heat.`, evidence: DEF } };
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...twoEach, items: [row("rafting ratio")] }));
    const withTable = (await json(await call(ask()))).answer as { meaning: string; here: { text: string } };
    explainCache.clear();
    provider.generateJsonText.mockResolvedValue(JSON.stringify(twoEach));
    const without = (await json(await call(ask()))).answer as { meaning: string; here: { text: string } };

    expect(withTable.meaning).toBe(MEANING);
    expect(withTable.here.text).toBe(HERE);
    expect(without.meaning).toBe(`${MEANING} It is a share, not a count.`);
    expect(without.here.text).toBe(`${HERE} It rose with heat.`);
  });

  it("has no items key on the first answer when no row survives the paper, or the model sent none", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...modelAnswer, items: [row("tungsten additions"), row("spline interpolation")] }));
    expect((await json(await call(ask()))).answer).not.toHaveProperty("items");
    explainCache.clear();
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...modelAnswer, items: "not a table" }));
    expect((await json(await call(ask()))).answer).not.toHaveProperty("items");
    explainCache.clear();
    provider.generateJsonText.mockResolvedValue(JSON.stringify(modelAnswer));
    expect((await json(await call(ask()))).answer).toEqual({ meaning: MEANING, here: { text: HERE, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 } });
  });

  it("asks the model for the table in the first answer's prompt, and remembers the answer with it: the repeat is a hit, with no second call", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...modelAnswer, items: [row("rafting ratio")] }));
    const first = await json(await call(ask()));
    const again = await json(await call(ask()));
    const sent = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { outputSchema: Record<string, unknown> };

    expect(Object.keys(sent.outputSchema)).toEqual(["meaning", "here", "items"]);
    expect(first.cached).toBe(false);
    expect(again.cached).toBe(true);
    expect(again.answer).toEqual(first.answer);
    expect((again.answer as { items: unknown[] }).items).toHaveLength(1);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("serves the next reader's same words the same table from the memory, and a thread's reply is still its own entry", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ ...modelAnswer, items: [row("rafting ratio")] }));
    const first = await json(await call(ask()));
    replyStub({ reply: "It changes how the metal carries load.", evidence: DEF });
    const reply = await json(await call(ask({ thread: thread1 })));

    expect(first.answer).toHaveProperty("items");
    expect(reply.turn).not.toHaveProperty("items");
    expect(reply.cached).toBe(false);
  });
});
