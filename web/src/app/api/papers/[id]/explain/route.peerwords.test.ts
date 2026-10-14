import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache, type ExplainAnswer, type ExplainReplyTurn } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P10-08b (the owner's review 8.4; rubric B3, B4; rulings §1h.78 (i), §1h.85): a selection of Peer's own words — a
// line of the Summary, an answer to a question — is explained in the paper's context instead of refused as "not in
// the paper". The client sends `source: "summary" | "answer"` with it (P10-08); the route skips the locate, hands the
// model the passage as Peer's own words with the paper's abstract and the map's one line per section, keeps the two
// parts, and keeps the quote held to the paper. A passage that is the paper's is built exactly as before; a passage
// that is neither the paper's nor marked with a source is still refused. A counting provider stub stands in for the
// model: no real call anywhere. Everything below is invented text.

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

// Words of Peer's, not of the paper's body.
const SUMMARY_WORDS = "Tungsten slowed plate formation, so the alloy keeps its shape longer under heat.";
const ANSWER_WORDS = "The authors report the ratio doubling twice, which suggests the plates grow in two stages.";
const PAPER_PASSAGE = "the rafting ratio as the fraction of the gauge length";
const MEANING = "Plate formation is the alloy's grains lining up into flat layers.";
const HERE = "Peer's summary says it because the paper's headline result is about slowing that.";

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
  webSearch?: boolean;
}

function providerStub(text: string) {
  return { generateJsonText: vi.fn<(args: ModelArgs) => Promise<string>>(async () => text) };
}

function request(body: unknown, id: string): NextRequest {
  return new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function call(body: unknown, id: string = paper.id) {
  return POST(request(body, id), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

/** What the client sends for a selection in the Summary or an answer: an empty section id, the container's id as the paragraph index −1. */
const peer = (source: "summary" | "answer", over: Record<string, unknown> = {}) => ({
  paper,
  passage: source === "summary" ? SUMMARY_WORDS : ANSWER_WORDS,
  sectionId: "",
  paragraphIndex: -1,
  thread: [],
  source,
  ...over,
});
const fromPaper = (over: Record<string, unknown> = {}) => ({ paper, passage: PAPER_PASSAGE, sectionId: "s2", paragraphIndex: 1, thread: [], ...over });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
const sha = (text: string) => createHash("sha256").update(text).digest("hex");

let provider: ReturnType<typeof providerStub>;
const setModel = (reply: unknown) => {
  provider = providerStub(typeof reply === "string" ? reply : JSON.stringify(reply));
  mocks.resolveProvider.mockReturnValue(provider);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
  resetCounterStoreForTests();
  explainCache.clear();
  vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  setModel({ meaning: MEANING, here: { text: HERE, evidence: DEF } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/explain — a selection of Peer's own words (P10-08b, rule 1)", () => {
  it("explains a Summary selection in two parts, 200, with one model call", async () => {
    const response = await call(peer("summary"));
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body.cached).toBe(false);
    const answer = body.answer as ExplainAnswer;
    expect(answer.meaning).toBe(MEANING);
    expect(answer.here.text).toBe(HERE);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("explains an answer selection the same way", async () => {
    const response = await call(peer("answer"));

    expect(response.status).toBe(200);
    expect((await json(response)).answer).toMatchObject({ meaning: MEANING });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("hands the model the passage as Peer's own words about this paper, with the abstract and the map — and no paragraph of the body", async () => {
    await call(peer("summary"));
    const prompt = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as Record<string, unknown>;

    expect(prompt.passage).toBe(SUMMARY_WORDS);
    expect(JSON.stringify(prompt)).toContain("Peer's own words about this paper");
    expect(prompt.paper).toMatchObject({ title: paper.title });
    expect((prompt.paper as { abstract: string }).abstract).toContain("Tungsten additions slowed rafting");
    expect((prompt.sections as Array<{ heading: string }>).map((s) => s.heading)).toEqual(["1 Introduction", "2 Methods", "3 Results"]);
    expect(prompt).not.toHaveProperty("context");
  });

  it("says which kind of Peer's words it is: a line of the Summary, or an answer to the reader's question", async () => {
    await call(peer("summary"));
    await call(peer("answer"));
    const [summary, answer] = provider.generateJsonText.mock.calls.map((c) => JSON.parse(c[0].userPrompt) as { passageFrom: string });

    expect(summary.passageFrom).toMatch(/summary/i);
    expect(answer.passageFrom).toMatch(/answer/i);
    expect(summary.passageFrom).not.toBe(answer.passageFrom);
  });

  it("clips the passage to 1,200 characters like a paper passage", async () => {
    await call(peer("answer", { passage: `${"word ".repeat(400)}` }));
    const prompt = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { passage: string };

    expect(prompt.passage.length).toBeLessThanOrEqual(1200);
  });

  it("keeps the paper's own sentence as the receipt when the model gives one that verifies", async () => {
    const answer = (await json(await call(peer("summary")))).answer as ExplainAnswer;

    expect(answer.here.evidence).toBe(DEF);
    expect(answer.here.sectionId).toBe("s2");
    expect(answer.here.peer).toBeUndefined();
  });

  it("labels the prose Peer's own reading, with no quote, when the quote does not verify", async () => {
    setModel({ meaning: MEANING, here: { text: HERE, evidence: "A sentence the paper never wrote at all." } });
    const answer = (await json(await call(peer("summary")))).answer as ExplainAnswer;

    expect(answer.here.peer).toBe(true);
    expect(answer.here).not.toHaveProperty("evidence");
    expect(answer.here).not.toHaveProperty("sectionId");
  });

  it("labels it Peer's reading when the model gives no quote at all", async () => {
    setModel({ meaning: MEANING, here: { text: HERE } });
    const answer = (await json(await call(peer("answer")))).answer as ExplainAnswer;

    expect(answer.here.peer).toBe(true);
  });

  it("keeps no term table for Peer's words: a row would have nothing of the paper's to be held to", async () => {
    setModel({ meaning: MEANING, here: { text: HERE }, items: [{ term: "rafting", here: "plates", read: "as a ratio" }] });
    const answer = (await json(await call(peer("summary")))).answer as ExplainAnswer;

    expect(answer).not.toHaveProperty("items");
    expect(JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt).outputSchema).not.toHaveProperty("items");
  });

  it("does not look for the words in the body: a Summary line that quotes the paper is still Peer's words, with no paragraph and no table", async () => {
    setModel({ meaning: MEANING, here: { text: HERE }, items: [{ term: "rafting ratio", here: "the share of plates", read: "as a fraction" }] });
    const answer = (await json(await call(peer("summary", { passage: PAPER_PASSAGE })))).answer as ExplainAnswer;
    const prompt = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as Record<string, unknown>;

    expect(prompt).not.toHaveProperty("context");
    expect(String(prompt.passageFrom)).toContain("Peer's own words about this paper");
    expect(answer).not.toHaveProperty("items");
  });

  it("answers a follow-up about Peer's words, 200, with the thread in the prompt and the quote held to the paper", async () => {
    setModel({ reply: "It is the layering of the alloy's grains.", evidence: USE });
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "What is plate formation?" },
    ];
    const response = await call(peer("summary", { thread }));
    const turn = (await json(response)).turn as ExplainReplyTurn;

    expect(response.status).toBe(200);
    expect(turn.text).toBe("It is the layering of the alloy's grains.");
    expect(turn.evidence).toBe(USE);
    const prompt = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as Record<string, unknown>;
    expect(prompt.lastReaderMessage).toBe("What is plate formation?");
    expect(JSON.stringify(prompt)).toContain("Peer's own words about this paper");
    expect(prompt).not.toHaveProperty("context");
  });

  it("labels a follow-up's unverifiable quote as Peer's reading", async () => {
    setModel({ reply: "Probably the layering.", evidence: "Not a sentence of the paper." });
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "Why?" },
    ];
    const turn = (await json(await call(peer("answer", { thread })))).turn as ExplainReplyTurn;

    expect(turn.peer).toBe(true);
    expect(turn).not.toHaveProperty("evidence");
  });
});

describe("POST /api/papers/[id]/explain — the memory keeps the source (P10-08b, rule 1)", () => {
  it("keeps the same words as a paper passage and as a Summary selection apart", async () => {
    await call(fromPaper());
    const second = await json(await call(peer("summary", { passage: PAPER_PASSAGE })));

    expect(second.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
  });

  it("keeps a Summary selection and an answer selection of the same words apart", async () => {
    await call(peer("summary", { passage: SUMMARY_WORDS }));
    const second = await json(await call(peer("answer", { passage: SUMMARY_WORDS })));

    expect(second.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
  });

  it("answers the same Summary selection twice with one model call", async () => {
    await call(peer("summary"));
    const second = await json(await call(peer("summary")));

    expect(second.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("holds the answer and a hash only", async () => {
    await call(peer("summary", { project: "PROFILE-SENTINEL" }));

    expect(explainCache.size()).toBe(1);
  });
});

describe("POST /api/papers/[id]/explain — what is still refused (P10-08b, rule 1)", () => {
  it("refuses 422 words that are not the paper's and carry no source — before any model is asked", async () => {
    const response = await call(fromPaper({ passage: SUMMARY_WORDS }));

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "not_in_paper" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("refuses 422 the same words marked as the paper's own source, and a source it does not know", async () => {
    expect((await call(fromPaper({ passage: SUMMARY_WORDS, source: "paper" }))).status).toBe(422);
    expect((await call(fromPaper({ passage: SUMMARY_WORDS, source: "elsewhere" }))).status).toBe(422);
    expect((await call(fromPaper({ passage: SUMMARY_WORDS, source: 5 }))).status).toBe(422);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("refuses 422 a Peer-words passage with no words in it", async () => {
    expect((await call(peer("summary", { passage: "   " }))).status).toBe(422);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("still answers unavailable when the paper has no text, whatever the source", async () => {
    mocks.getFullText.mockResolvedValue({ status: "failed", attempts: [] });
    const response = await call(peer("summary"));

    expect(await json(response)).toEqual({ unavailable: true });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/explain — a paper passage is built exactly as before (P10-08b, rule 4)", () => {
  // The sha-256 of the system and user prompts the head built for this request, recorded before the change.
  const HEAD = { first: { system: "90945c1e026e14166b8c9f2207b13f500d3d04bb52b0576e6519af8530d61e64", user: "d178ea9b41edeb46316b4e752289f7f12941c2b74d50eafe38cf9c4b55f93b16" }, reply: { system: "f4d4b7083dc51ff4807c33eac415daaaf1cee64a529589f345b88c23a935812e", user: "8101cd22f5c885e3649f78667b727bae057b485f4128336998bed4f2fd5f8276" } };

  it("sends the first answer's prompt byte for byte as the head built it", async () => {
    await call(fromPaper());
    const args = provider.generateJsonText.mock.calls[0][0];

    expect({ system: sha(args.systemPrompt), user: sha(args.userPrompt), maxTokens: args.maxTokens }).toEqual({ system: HEAD.first.system, user: HEAD.first.user, maxTokens: 800 });
  });

  it("sends a reply's prompt byte for byte as the head built it", async () => {
    setModel({ reply: "It is the share of the gauge length." });
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "What is the gauge length?" },
    ];
    await call(fromPaper({ thread }));
    const args = provider.generateJsonText.mock.calls[0][0];

    expect({ system: sha(args.systemPrompt), user: sha(args.userPrompt), maxTokens: args.maxTokens }).toEqual({ system: HEAD.reply.system, user: HEAD.reply.user, maxTokens: 560 });
  });

  it("is not changed by a source that says paper", async () => {
    await call(fromPaper());
    explainCache.clear();
    await call(fromPaper({ source: "paper", paragraphIndex: 0 }));

    expect(provider.generateJsonText.mock.calls[1][0].userPrompt).toBe(provider.generateJsonText.mock.calls[0][0].userPrompt);
  });
});
