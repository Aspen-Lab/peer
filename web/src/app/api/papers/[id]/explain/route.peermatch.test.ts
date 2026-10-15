import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache, type ExplainAnswer, type ExplainReplyTurn } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P10-38 (BACKLOG-75; ruling §1h.102): a selection of Peer's own words (P10-08b) carries the body paragraph that best matches it,
// so the explanation's quote from the paper can be verified against it, as a selection in the body already can. The match is the
// Tier 0 route's own scoring with a floor — no new model call, no new request. A counting provider stub stands in for the model.
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
const TUNGSTEN = "Tungsten additions delayed plate formation, and the rafting ratio stayed below 0.3 for 200 hours.";
const KEEPS = "The alloy keeps its shape for a week at the test temperature.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "An abstract about rafting under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: "Hot turbine blades creep slowly under load and lose their shape over many hours." },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `Specimens were machined from a single casting and heat treated together.\n\n${DEF}` },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: `${KEEPS}\n\n${TUNGSTEN}` },
  ],
};

const paper = {
  id: "arxiv:2607.00003",
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

// Words of Peer's own that a paragraph of the body backs (tungsten, plate, formation, rafting, ratio) …
const BACKED = "Tungsten slowed plate formation, so the rafting ratio stays low for longer.";
// … and words with no paragraph behind them (one term shared with the Methods, none with the rest).
const UNBACKED = "The supervisor was pleased with the pace, and heat from the furnace was never a worry.";
const MEANING = "Plate formation is the alloy's grains lining up into flat layers.";
const HERE = "Peer's summary says it because the paper's results are about slowing that.";

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

function call(body: unknown, id: string = paper.id) {
  const request = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/explain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(request, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

const peer = (source: "summary" | "answer", passage: string, over: Record<string, unknown> = {}) => ({
  paper,
  passage,
  sectionId: "",
  paragraphIndex: -1,
  thread: [],
  source,
  ...over,
});

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}
const promptOf = (provider: ReturnType<typeof providerStub>, call = 0) => JSON.parse(provider.generateJsonText.mock.calls[call][0].userPrompt) as Record<string, unknown>;

let provider: ReturnType<typeof providerStub>;
const setModel = (reply: unknown) => {
  provider = providerStub(typeof reply === "string" ? reply : JSON.stringify(reply));
  mocks.resolveProvider.mockReturnValue(provider);
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T16:00:00.000Z"));
  resetCounterStoreForTests();
  explainCache.clear();
  vi.clearAllMocks();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  setModel({ meaning: MEANING, here: { text: HERE, evidence: TUNGSTEN } });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/explain — Peer's own words carry their source paragraph (P10-38, rule 1)", () => {
  it("puts the best-matching body paragraph and its section in the context of a Summary selection", async () => {
    const response = await call(peer("summary", BACKED));

    expect(response.status).toBe(200);
    const prompt = promptOf(provider);
    expect(prompt.context).toEqual({ section: "3 Results", paragraph: TUNGSTEN });
    expect(prompt.passage).toBe(BACKED);
    expect(String(prompt.passageFrom)).toContain("Peer's own words about this paper");
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("does the same for an answer selection", async () => {
    await call(peer("answer", BACKED));

    expect(promptOf(provider).context).toEqual({ section: "3 Results", paragraph: TUNGSTEN });
  });

  it("lets the model's quote from that paragraph verify, with its section and page from the document", async () => {
    const answer = (await json(await call(peer("summary", BACKED)))).answer as ExplainAnswer;

    expect(answer.here.evidence).toBe(TUNGSTEN);
    expect(answer.here.sectionId).toBe("s3");
    expect(answer.here.evidenceWhere).toBe("3 Results");
    expect(answer.here.page).toBe(3);
    expect(answer.here.peer).toBeUndefined();
    expect(answer).not.toHaveProperty("items");
  });

  it("still labels the prose Peer's reading when the quote is not the paper's", async () => {
    setModel({ meaning: MEANING, here: { text: HERE, evidence: "A sentence the paper never wrote at all." } });
    const answer = (await json(await call(peer("summary", BACKED)))).answer as ExplainAnswer;

    expect(answer.here.peer).toBe(true);
    expect(answer.here).not.toHaveProperty("evidence");
  });

  it("carries the paragraph into a follow-up's prompt, whose quote is held to the paper as ever", async () => {
    setModel({ reply: "It is the delay of the plates.", evidence: TUNGSTEN });
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "What is a plate here?" },
    ];
    const turn = (await json(await call(peer("summary", BACKED, { thread })))).turn as ExplainReplyTurn;

    expect(promptOf(provider).context).toEqual({ section: "3 Results", paragraph: TUNGSTEN });
    expect(turn.evidence).toBe(TUNGSTEN);
    expect(turn.sectionId).toBe("s3");
  });

  it("sends no paragraph below the floor, and the answer is Peer's reading as before", async () => {
    setModel({ meaning: MEANING, here: { text: HERE } });
    const answer = (await json(await call(peer("summary", UNBACKED)))).answer as ExplainAnswer;

    expect(promptOf(provider)).not.toHaveProperty("context");
    expect(answer.here.peer).toBe(true);
  });

  it("keeps a paper selection as it was: the paragraph found, its neighbours, no `section`, and the table offered", async () => {
    await call({ paper, passage: "the rafting ratio as the fraction of the gauge length", sectionId: "s2", paragraphIndex: 1, thread: [] });
    const prompt = promptOf(provider) as { context: Record<string, unknown>; outputSchema: Record<string, unknown> };

    expect(prompt.context.paragraph).toBe(DEF);
    expect(prompt.context).not.toHaveProperty("section");
    expect(prompt.outputSchema).toHaveProperty("items");
  });
});

describe("POST /api/papers/[id]/explain — Tier 0 and the memory hold (P10-38, rule 3)", () => {
  it("sends nothing and reads nothing with no key: the paper's text is not even fetched", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    const response = await call(peer("summary", BACKED));

    expect(await json(response)).toEqual({ unavailable: true });
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("answers the same selection twice with one model call, and holds the answer and a hash only", async () => {
    await call(peer("summary", BACKED, { project: "PROFILE-SENTINEL" }));
    const second = await json(await call(peer("summary", BACKED)));

    expect(second.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(explainCache.size()).toBe(1);
    expect(JSON.stringify(promptOf(provider))).not.toContain("PROFILE-SENTINEL");
  });
});
