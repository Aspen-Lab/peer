import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainCache } from "@/lib/papers/explain";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P11-42 (round 2, Theme B readers r1, r2, r3; ruling §1h.139 (b)): POST /api/papers/[id]/explain explains a passage that stands in a figure's caption or a
// section's heading, as it does a paragraph's. Before it, such a passage was found nowhere ("not_in_paper", 422) and the page did not offer Explain this for it.
// The request is the one the page has always sent — the passage, the section's id and the block's number in it (`paper-section-<k>-p<n>`'s `n`: the paragraphs,
// then the heading, then the captions) — and nothing else: no new field. A paragraph's passage is answered exactly as before. A counting provider stub stands in
// for the model; every text is invented.

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
const OPENING = "Specimens were machined from a single casting and heat treated together.";
const NAMES_FIGURE = "Figure 2 plots the ratio against time for each alloy, with the tungsten alloy lowest throughout.";
const SECOND = "Tungsten additions slowed the rafting ratio by about a third in every test.";
const SAYS_RESULTS = "The findings are set out under 3 Results once the methods are described.";
const CAPTION = "Rafting ratio against creep time for three alloys. The tungsten alloy rafts the slowest.";
const CAPTION_SENTENCE = "The tungsten alloy rafts the slowest.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [
    { ordinal: 1, label: "Figure 2", caption: CAPTION, page: 3, at: 0.8 },
    { ordinal: 2, label: "Table 1", caption: "Alloy compositions in weight percent for every specimen.", page: 2, at: 0.4 },
  ],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "An abstract about rafting under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: `Hot turbine blades creep slowly under load and lose their shape over many hours.\n\n${SAYS_RESULTS}` },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `${OPENING}\n\n${DEF}` },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: [USE, NAMES_FIGURE, SECOND].join("\n\n") },
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

const MEANING = "A rafting ratio says how much of a sample has turned into plates.";
const HERE = "The authors use it to compare alloys on one scale.";

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
  webSearch?: boolean;
}

function providerStub(text: string) {
  const generateJsonText = vi.fn<(args: ModelArgs) => Promise<string>>(async () => text);
  return { generateJsonText };
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

const ask = (over: Record<string, unknown> = {}) => ({ paper, passage: "", sectionId: "s2", paragraphIndex: 1, thread: [], ...over });
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const contextOf = (args: ModelArgs) => (JSON.parse(args.userPrompt) as { context: Record<string, unknown> }).context;

// Where the page says each block is: the Results are body section 2 with three paragraphs, so their heading is block 3 and the one figure's caption block 4; the
// Methods are body section 1 with two, so their heading is block 2.
const CAPTION_REQUEST = { passage: "Figure 2 · Rafting ratio against creep time for three alloys", sectionId: "s3", paragraphIndex: 4 };
const HEADING_REQUEST = { passage: "2 Methods", sectionId: "s2", paragraphIndex: 2 };

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00.000Z"));
  resetCounterStoreForTests();
  explainCache.clear();
  vi.clearAllMocks();
  provider = providerStub(JSON.stringify({ meaning: MEANING, here: { text: HERE, evidence: CAPTION_SENTENCE } }));
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/explain — a caption's words (P11-42 rule 1)", () => {
  it("finds the passage in the caption and answers it, the quote placed in the paragraph that names the figure (the sections' text is what a quote is held to)", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ meaning: MEANING, here: { text: HERE, evidence: NAMES_FIGURE } }));
    const response = await call(ask(CAPTION_REQUEST));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ cached: false, answer: { meaning: MEANING, here: { text: HERE, evidence: expect.stringContaining(NAMES_FIGURE), evidenceWhere: "3 Results", sectionId: "s3", page: 3 } } });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("a quote of the caption's own words is not the section's: the answer stands and the prose is labelled Peer's reading", async () => {
    const response = await call(ask(CAPTION_REQUEST));

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ cached: false, answer: { meaning: MEANING, here: { text: HERE, peer: true } } });
  });

  it("gives the model the caption and its section: the caption's words, the figure, the section's heading and the paragraphs the figure stands between", async () => {
    await call(ask(CAPTION_REQUEST));
    const args = provider.generateJsonText.mock.calls[0][0];

    expect(contextOf(args)).toEqual({ block: "caption", figure: "Figure 2", section: "3 Results", before: NAMES_FIGURE, paragraph: CAPTION, after: SECOND });
    expect(JSON.parse(args.userPrompt).passage).toBe(CAPTION_REQUEST.passage);
    expect(args.tier).toBe("small");
    expect(args.maxTokens).toBe(800);
  });

  it("answers a reply in a thread about the caption, with the same context", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ reply: "It shows tungsten rafting slowest.", evidence: NAMES_FIGURE }));
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "What does the figure show?" },
    ];
    const response = await call(ask({ ...CAPTION_REQUEST, thread }));

    expect(response.status).toBe(200);
    expect((await json(response)).turn).toMatchObject({ role: "peer", text: "It shows tungsten rafting slowest.", evidence: expect.stringContaining(NAMES_FIGURE), sectionId: "s3" });
    expect(contextOf(provider.generateJsonText.mock.calls[0][0])).toMatchObject({ block: "caption", figure: "Figure 2", paragraph: CAPTION });
  });

  it("finds a caption the hint does not name, or names wrongly", async () => {
    for (const over of [{ sectionId: undefined, paragraphIndex: undefined }, { sectionId: "s1", paragraphIndex: 4 }, { sectionId: "nope", paragraphIndex: 99 }]) {
      explainCache.clear();
      provider.generateJsonText.mockClear();
      const response = await call(ask({ ...CAPTION_REQUEST, ...over }));
      expect(response.status, JSON.stringify(over)).toBe(200);
      expect(contextOf(provider.generateJsonText.mock.calls[0][0]), JSON.stringify(over)).toMatchObject({ block: "caption", figure: "Figure 2" });
    }
  });
});

describe("POST /api/papers/[id]/explain — a heading's words (P11-42 rule 1)", () => {
  it("finds the passage in the heading and answers it, with how the section opens as the context after it", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ meaning: MEANING, here: { text: HERE, evidence: OPENING } }));
    const response = await call(ask(HEADING_REQUEST));
    const args = provider.generateJsonText.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(contextOf(args)).toEqual({ block: "heading", paragraph: "2 Methods", after: OPENING });
    expect((await json(response)).answer).toEqual({ meaning: MEANING, here: { text: HERE, evidence: OPENING, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 } });
  });
});

describe("POST /api/papers/[id]/explain — what is not the paper's is still refused (P11-42 rule 1)", () => {
  it("a passage found nowhere is 422 not_in_paper, before any model is asked: in a caption's place, in a heading's, and with no hint", async () => {
    for (const body of [
      ask({ ...CAPTION_REQUEST, passage: "a sentence the paper never wrote" }),
      ask({ ...HEADING_REQUEST, passage: "9 Appendix" }),
      ask({ passage: "a sentence the paper never wrote", sectionId: undefined, paragraphIndex: undefined }),
      // A table's caption is not drawn by the page, and the abstract's heading is not the body's.
      ask({ passage: "Alloy compositions in weight percent", sectionId: "s2", paragraphIndex: 3 }),
      ask({ passage: "Abstract", sectionId: "s0", paragraphIndex: 0 }),
    ]) {
      const response = await call(body);
      expect(response.status, JSON.stringify(body.passage)).toBe(422);
      expect(await json(response)).toEqual({ error: "not_in_paper" });
    }
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("no provider (Tier 0, no key): nothing is read and nothing is asked, for a caption's words as for a paragraph's", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    for (const body of [ask(CAPTION_REQUEST), ask(HEADING_REQUEST), ask({ passage: DEF })]) {
      const response = await call(body);
      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/explain — the memory keeps a heading's words and a paragraph's apart (P11-42)", () => {
  // "3 Results" is the Results' heading and also words of an Introduction's paragraph.
  const HEADING = { passage: "3 Results", sectionId: "s3", paragraphIndex: 3 };
  const PARAGRAPH = { passage: "3 Results", sectionId: "s1", paragraphIndex: 1 };

  it("the same words selected in the heading and in the paragraph are two entries; each repeated is a hit", async () => {
    const heading = await call(ask(HEADING));
    const paragraph = await call(ask(PARAGRAPH));
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
    expect(contextOf(provider.generateJsonText.mock.calls[0][0])).toMatchObject({ block: "heading" });
    expect(contextOf(provider.generateJsonText.mock.calls[1][0])).toEqual({ before: "Hot turbine blades creep slowly under load and lose their shape over many hours.", paragraph: SAYS_RESULTS });
    expect((await json(heading)).cached).toBe(false);
    expect((await json(paragraph)).cached).toBe(false);

    expect((await json(await call(ask(HEADING)))).cached).toBe(true);
    expect((await json(await call(ask(PARAGRAPH)))).cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
  });
});

describe("POST /api/papers/[id]/explain — a paragraph's passage is answered byte for byte as before (P11-42 rule 3)", () => {
  // The prompts of a paragraph's passage on this paper, hashed from the base (43c1811f) before the change: the same request, the same two prompts.
  const PARAGRAPH_REQUEST = ask({ passage: "the rafting ratio as the fraction of the gauge length", sectionId: "s2", paragraphIndex: 1 });
  const USER_PROMPT_SHA = "d178ea9b41edeb46316b4e752289f7f12941c2b74d50eafe38cf9c4b55f93b16";
  const SYSTEM_PROMPT_SHA = "90945c1e026e14166b8c9f2207b13f500d3d04bb52b0576e6519af8530d61e64";
  const REPLY_USER_PROMPT_SHA = "d53b8201ab15742ae0d5b9cc783845ae69a0dc2dc948947068d6ddb9838bf4be";

  it("the first answer's two prompts and token budget are what the base wrote", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ meaning: MEANING, here: { text: HERE, evidence: DEF } }));
    const response = await call(PARAGRAPH_REQUEST);
    const args = provider.generateJsonText.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ cached: false, answer: { meaning: MEANING, here: { text: HERE, evidence: DEF, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 } } });
    expect({ user: sha(args.userPrompt), system: sha(args.systemPrompt), maxTokens: args.maxTokens, webSearch: args.webSearch }).toEqual({
      user: USER_PROMPT_SHA,
      system: SYSTEM_PROMPT_SHA,
      maxTokens: 800,
      webSearch: false,
    });
    // The Methods' second and last paragraph: the one before it, and nothing after.
    expect(Object.keys(contextOf(args))).toEqual(["before", "paragraph"]);
  });

  it("a reply's prompt is what the base wrote", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ reply: "It is a share of the gauge length.", evidence: DEF }));
    const thread = [
      { role: "peer", text: `${MEANING} ${HERE}` },
      { role: "reader", text: "What is the gauge length?" },
    ];
    const response = await call({ ...PARAGRAPH_REQUEST, thread });
    const args = provider.generateJsonText.mock.calls[0][0];

    expect(response.status).toBe(200);
    expect(sha(args.userPrompt)).toBe(REPLY_USER_PROMPT_SHA);
  });

  it("a paragraph that holds the words of a caption is still the paragraph's: with a paragraph hint, the paragraph is found", async () => {
    const response = await call(ask({ passage: "Figure 2 plots the ratio against time", sectionId: "s3", paragraphIndex: 1 }));

    expect(response.status).toBe(200);
    expect(Object.keys(contextOf(provider.generateJsonText.mock.calls[0][0]))).toEqual(["before", "paragraph", "after"]);
  });
});
