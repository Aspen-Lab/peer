import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainDocHash } from "@/lib/papers/explain";
import { buildParagraphGuidePrompt, gistCandidates, gistMaxTokens, GUIDE_CAPS, paragraphGuideCache } from "@/lib/papers/paragraph-guide";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P10-07a (B P10-05 §2.6 and §5.2; review 3.3, second half; rubric A15): POST
// /api/papers/[id]/paragraph-guide for a paper with no headings of its own. The same one call
// also asks the model to divide the paper's one big section into parts; the answer's partition
// is made whole by its sanitizer and kept with the gists, in the same memory (the document's
// hash alone). A paper with headings is asked for none. In-test provider stubs stand in for the
// model: no real call anywhere. Every text below is invented ("a survey of shore ecology").

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

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const invented = (k: number) =>
  `Invented paragraph ${k} about ${TOPICS[k % TOPICS.length]}. The survey counted ${10 + k} sites near the ${TOPICS[k % TOPICS.length]}. Nothing here is quoted from a paper.`;
const paragraphs = (from: number, n: number) => Array.from({ length: n }, (_, k) => invented(from + k)).join("\n\n");

/** B's fixture: an unheaded main text (one body section, 30 paragraphs) and a Methods heading with 4. */
const unheaded: ExtractedDocument = {
  source: "pdf",
  pageCount: 4,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "A Survey of Shore Ecology", canonical: "body", page: 1, text: paragraphs(0, 30) },
    { id: "s1", heading: "Methods", canonical: "methods", page: 4, text: paragraphs(100, 4) },
  ],
};
const CANDIDATES = 34;

/** A paper with headings of its own. */
const headed: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: paragraphs(0, 3) },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: paragraphs(100, 2) },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: paragraphs(200, 2) },
  ],
};

const paper = {
  id: "arxiv:2610.00007",
  title: "A survey of shore ecology",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "A survey of the shore.",
  summaryExperimentKeywords: ["shore"],
  summaryResultDiscussion: "Counts of sites.",
  isSaved: false,
};

const GIST_ENTRIES = [
  { sectionId: "s0", paragraphIndex: 0, gist: "Invented paragraph about tide pools." },
  { sectionId: "s0", paragraphIndex: 7, gist: "Invented paragraph about kelp beds survey." },
  { sectionId: "s1", paragraphIndex: 0, gist: "Invented paragraph about tide pools methods." },
];
const FOUR_PARTS = [
  { role: "introduction", fromParagraph: 0 },
  { role: "results", fromParagraph: 6 },
  { role: "discussion", fromParagraph: 20 },
  { role: "conclusion", fromParagraph: 27 },
];
const FOUR_PARTS_KEPT = {
  sectionId: "s0",
  parts: [
    { role: "introduction", fromParagraph: 0, toParagraph: 5 },
    { role: "results", fromParagraph: 6, toParagraph: 19 },
    { role: "discussion", fromParagraph: 20, toParagraph: 26 },
    { role: "conclusion", fromParagraph: 27, toParagraph: 29 },
  ],
};
const GISTS_KEPT = {
  s0: { 0: "Invented paragraph about tide pools.", 7: "Invented paragraph about kelp beds survey." },
  s1: { 0: "Invented paragraph about tide pools methods." },
};

const answerOf = (over: Record<string, unknown> = {}) => JSON.stringify({ partition: FOUR_PARTS, gists: GIST_ENTRIES, ...over });

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
}

function providerStub(text: string = answerOf()) {
  return { generateJsonText: vi.fn<(args: ModelArgs) => Promise<string>>(async () => text) };
}

function call(body: unknown, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/paragraph-guide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}
const ask = (over: Record<string, unknown> = {}) => ({ paper, ...over });
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const useDoc = (doc: ExtractedDocument) => mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-14T12:00:00.000Z"));
  resetCounterStoreForTests();
  paragraphGuideCache.clear();
  vi.clearAllMocks();
  provider = providerStub();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  useDoc(unheaded);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/paragraph-guide — a paper with no headings is also divided into parts", () => {
  it("asks the model once, with the partition asked for and the allowance 300 larger, and keeps the gists and the partition", async () => {
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    const args = provider.generateJsonText.mock.calls[0][0];
    expect(args.tier).toBe("small");
    expect(args.maxTokens).toBe(gistMaxTokens(CANDIDATES) + 300);
    const sent = JSON.parse(args.userPrompt) as { task: string; outputSchema: Record<string, unknown> };
    expect(Object.keys(sent.outputSchema)).toEqual(["partition", "gists"]);
    expect(sent.task).toContain("divide the paragraphs of section `s0`");
    expect(body).toEqual({ cached: false, guide: { docHash: explainDocHash(unheaded), gists: GISTS_KEPT, partition: FOUR_PARTS_KEPT } });
  });

  it("measured on B's fixture: 4 kept parts, their ranges, the whole section covered", async () => {
    const guide = (await json(await call(ask()))).guide as { partition: { parts: Array<{ role: string; fromParagraph: number; toParagraph: number }> } };

    expect(guide.partition.parts.map((p) => `${p.role}:${p.fromParagraph}-${p.toParagraph}`)).toEqual(["introduction:0-5", "results:6-19", "discussion:20-26", "conclusion:27-29"]);
  });

  it("still keeps a guide when every gist is dropped: the partition alone is a guide", async () => {
    provider.generateJsonText.mockResolvedValue(answerOf({ gists: [{ sectionId: "s0", paragraphIndex: 0, gist: "Stocks fell after the earnings call." }] }));
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(body).toEqual({ cached: false, guide: { docHash: explainDocHash(unheaded), gists: {}, partition: FOUR_PARTS_KEPT } });
    expect(paragraphGuideCache.size()).toBe(1);
  });

  it("leaves the gists when the partition is garbage: a guide with no partition", async () => {
    for (const bad of ["nope", [], [{ role: "introduction", fromParagraph: 0 }], [{ role: "banana", fromParagraph: 0 }, { role: "cherry", fromParagraph: 9 }], { 0: { role: "results" } }]) {
      paragraphGuideCache.clear();
      provider.generateJsonText.mockResolvedValue(answerOf({ partition: bad }));
      const body = await json(await call(ask()));

      expect(body.guide).toEqual({ docHash: explainDocHash(unheaded), gists: GISTS_KEPT });
      expect(body.guide).not.toHaveProperty("partition");
    }
  });

  it("leaves the gists when the answer has no partition at all", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ gists: GIST_ENTRIES }));
    const body = await json(await call(ask()));

    expect(body.guide).toEqual({ docHash: explainDocHash(unheaded), gists: GISTS_KEPT });
  });

  it("is unavailable, and remembers nothing, when neither a gist nor a partition survives", async () => {
    provider.generateJsonText.mockResolvedValue(answerOf({ partition: [{ role: "introduction", fromParagraph: 0 }], gists: [] }));
    const response = await call(ask());

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ unavailable: true });
    expect(paragraphGuideCache.size()).toBe(0);
  });

  it("reads the partition out of a code fence, and takes starts written as digit strings", async () => {
    provider.generateJsonText.mockResolvedValue("```json\n" + answerOf({ partition: [{ role: "Introduction", fromParagraph: "0" }, { role: "methods", fromParagraph: "9" }] }) + "\n```");
    const guide = (await json(await call(ask()))).guide as { partition: unknown };

    expect(guide.partition).toEqual({
      sectionId: "s0",
      parts: [
        { role: "introduction", fromParagraph: 0, toParagraph: 8 },
        { role: "experimental", fromParagraph: 9, toParagraph: 29 },
      ],
    });
  });

  it("returns the partition on a cache hit, with no second model call", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.guide).toEqual(first.guide);
    expect((second.guide as { partition: unknown }).partition).toEqual(FOUR_PARTS_KEPT);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("holds the partition under the document's hash alone: nothing of the request is in the memory", async () => {
    await call(ask({ project: "PROFILE-SENTINEL" }));
    const entry = paragraphGuideCache.get(explainDocHash(unheaded));

    expect(paragraphGuideCache.size()).toBe(1);
    expect(entry).toEqual({ docHash: explainDocHash(unheaded), gists: GISTS_KEPT, partition: FOUR_PARTS_KEPT });
    expect(JSON.stringify(entry)).not.toContain("SENTINEL");
  });

  it("puts nothing about the reader in the prompt, whatever the request carries", async () => {
    await call(ask({ project: "PROFILE-SENTINEL", questions: ["QUESTION-SENTINEL?"], profile: { name: "PROFILE-SENTINEL" } }));

    expect(JSON.stringify(provider.generateJsonText.mock.calls)).not.toContain("SENTINEL");
  });

  it("sends the same paragraphs it always sent: the partition adds rules, not text of the paper", async () => {
    await call(ask());
    const withPartition = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { paragraphs: unknown };
    const plain = JSON.parse(buildParagraphGuidePrompt({ paper: { title: paper.title }, candidates: gistCandidates(unheaded) }).userPrompt) as { paragraphs: unknown };

    expect(withPartition.paragraphs).toEqual(plain.paragraphs);
  });

  it("asks no partition beyond the 120-paragraph cap: the pass is skipped, partition and all", async () => {
    useDoc({ ...unheaded, sections: [{ ...unheaded.sections[0], text: paragraphs(0, GUIDE_CAPS.maxParagraphs + 1) }] });
    const response = await call(ask());

    expect(await json(response)).toEqual({ skipped: "too_many_paragraphs" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(paragraphGuideCache.size()).toBe(0);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — a paper with headings asks for no partition", () => {
  const HEADED_GISTS = [{ sectionId: "s1", paragraphIndex: 0, gist: "Invented paragraph about tide pools." }];

  beforeEach(() => {
    useDoc(headed);
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ gists: HEADED_GISTS }));
  });

  it("sends the prompt and the allowance it always sent, byte for byte", async () => {
    await call(ask());
    const args = provider.generateJsonText.mock.calls[0][0];
    const candidates = gistCandidates(headed);
    const today = buildParagraphGuidePrompt({ paper: { title: paper.title }, candidates });

    expect(args.userPrompt).toBe(today.userPrompt);
    expect(args.systemPrompt).toBe(today.systemPrompt);
    expect(args.maxTokens).toBe(gistMaxTokens(candidates.length));
    expect(Object.keys((JSON.parse(args.userPrompt) as { outputSchema: object }).outputSchema)).toEqual(["gists"]);
    expect(args.userPrompt).not.toContain("partition");
  });

  it("keeps no partition even when the model volunteers one", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ partition: FOUR_PARTS, gists: HEADED_GISTS }));
    const body = await json(await call(ask()));

    expect(body.guide).toEqual({ docHash: explainDocHash(headed), gists: { s1: { 0: "Invented paragraph about tide pools." } } });
    expect(body.guide).not.toHaveProperty("partition");
  });

  it("is unavailable when no gist is grounded, whatever partition the model volunteered", async () => {
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ partition: FOUR_PARTS, gists: [] }));

    expect(await json(await call(ask()))).toEqual({ unavailable: true });
    expect(paragraphGuideCache.size()).toBe(0);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — Tier 0 and the owner's checks are as they were", () => {
  it("is 200 unavailable when no provider can write, and reads nothing: nothing of the partition shows", async () => {
    for (const none of [null, { generateJsonText: undefined }]) {
      mocks.resolveProvider.mockReturnValue(none);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("is 410 and remembers nothing when the upload changed while the model worked, partition or not", async () => {
    const UPLOAD = "upload:0123456789abcdef";
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const response = await call(ask({ paper: { ...paper, id: UPLOAD } }), UPLOAD);

    expect(response.status).toBe(410);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(paragraphGuideCache.size()).toBe(0);
  });

  it("keeps the guide of a partition-only answer for an owner whose upload did not change", async () => {
    const UPLOAD = "upload:0123456789abcdef";
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    provider.generateJsonText.mockResolvedValue(answerOf({ gists: [] }));
    const response = await call(ask({ paper: { ...paper, id: UPLOAD } }), UPLOAD);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(((await json(response)).guide as { partition: unknown }).partition).toEqual(FOUR_PARTS_KEPT);
    expect(paragraphGuideCache.size()).toBe(1);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — what it logs for a partition", () => {
  const spies = () => (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));

  it("adds the part count to the debug line — a number — and no word of the paper, the answer or the roles", async () => {
    const levels = spies();
    await call(ask({ project: "PROFILE-SENTINEL" }));
    const [label, fields] = levels[4].mock.calls[0] as [string, Record<string, unknown>];
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(levels[4].mock.calls).toHaveLength(1);
    expect(label).toBe("[papers/paragraph-guide] pass");
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "kept", "paragraphs", "parts", "promptChars"]);
    expect(fields).toMatchObject({ paragraphs: CANDIDATES, kept: 3, parts: 4 });
    expect(typeof fields.parts).toBe("number");
    for (const word of ["Invented", "tide", "kelp", "Survey", "Shore", "Methods", "introduction", "results", "discussion", "conclusion", "experimental", "PROFILE-SENTINEL"]) {
      expect(all).not.toContain(word);
    }
  });

  it("counts zero parts when the partition was asked for and not made, and adds nothing for a paper with headings", async () => {
    const levels = spies();
    provider.generateJsonText.mockResolvedValue(answerOf({ partition: "nope" }));
    await call(ask());
    expect((levels[4].mock.calls[0][1] as { parts: number }).parts).toBe(0);

    levels[4].mockClear();
    paragraphGuideCache.clear();
    useDoc(headed);
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ gists: [{ sectionId: "s1", paragraphIndex: 0, gist: "Invented paragraph about tide pools." }] }));
    await call(ask());
    expect(Object.keys(levels[4].mock.calls[0][1] as object).sort()).toEqual(["answerChars", "kept", "paragraphs", "promptChars"]);
  });
});
