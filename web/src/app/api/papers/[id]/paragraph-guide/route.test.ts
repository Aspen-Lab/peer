import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { explainDocHash } from "@/lib/papers/explain";
import { GUIDE_CAPS, gistMaxTokens, paragraphGuideCache } from "@/lib/papers/paragraph-guide";
import { CompanySpendCapRefusedError } from "@/lib/usage/company-budget";
import { getCounterStore, resetCounterStoreForTests } from "@/lib/usage/counters";
import { explainTenthsHouseKey, explainTenthsKey } from "@/lib/usage/explain-quota";

// P3-03 (ruling §1h.6; §3d 5 Tier 2 half, 17): POST /api/papers/[id]/paragraph-guide
// — one small-model call per document, one gist of at most twelve words per
// paragraph, each grounded in its paragraph or dropped; remembered by the
// document's hash alone; charged to neither the deep-report allowance nor the
// explain allowance. A counting provider stub stands in for the model: no real
// call anywhere. The sign-in gate and the reader-to-reader memory are in
// `route.gate.test.ts`. Every text below is invented.

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  getFullText: vi.fn(),
  consumeDeepReport: vi.fn(),
  consumeExplainTurn: vi.fn(),
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
// The two meters are spied, not stubbed: a call to either would still count, and
// the test would say so. The pass is charged to neither.
vi.mock("@/lib/usage/deep-report-quota", async (original) => {
  const actual = await original<typeof import("@/lib/usage/deep-report-quota")>();
  mocks.consumeDeepReport.mockImplementation(actual.consumeDeepReport);
  return { ...actual, consumeDeepReport: mocks.consumeDeepReport };
});
vi.mock("@/lib/usage/explain-quota", async (original) => {
  const actual = await original<typeof import("@/lib/usage/explain-quota")>();
  mocks.consumeExplainTurn.mockImplementation(actual.consumeExplainTurn);
  return { ...actual, consumeExplainTurn: mocks.consumeExplainTurn };
});

import { POST } from "./route";

const INTRO_0 = "Hot turbine blades creep slowly under load and lose their shape over many hours.";
const INTRO_1 = "Nickel alloys form plates inside their grains when they creep at high temperature.";
const METH_0 = "Specimens were machined from a single casting and heat treated together.";
const METH_1 = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const RES_0 = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
// Every sentence is a field opener, so this paragraph has no opening and no candidate.
const NO_OPENING = "Creep has long been a concern in the field. Cast alloys remain one of the oldest topics.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "An abstract about rafting under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: `${INTRO_0}\n\n${INTRO_1}\n\n${NO_OPENING}` },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `${METH_0}\n\n${METH_1}` },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: RES_0 },
  ],
};
/** The five candidates, in reading order. */
const CANDIDATES = 5;

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

const GISTS = {
  gists: [
    { sectionId: "s1", paragraphIndex: 0, gist: "Blades slowly lose their shape under load." },
    { sectionId: "s1", paragraphIndex: 1, gist: "Nickel alloys form plates inside grains." },
    { sectionId: "s2", paragraphIndex: 0, gist: "Specimens machined from one casting, then heat treated." },
    { sectionId: "s2", paragraphIndex: 1, gist: "Defines the rafting ratio as plate coverage." },
    { sectionId: "s3", paragraphIndex: 0, gist: "The rafting ratio rose as specimens crept." },
  ],
};
const GISTS_KEPT = {
  s1: { 0: "Blades slowly lose their shape under load.", 1: "Nickel alloys form plates inside grains." },
  s2: { 0: "Specimens machined from one casting, then heat treated.", 1: "Defines the rafting ratio as plate coverage." },
  s3: { 0: "The rafting ratio rose as specimens crept." },
};

const NOW = new Date("2026-10-06T12:00:00.000Z");

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
  webSearch?: boolean;
}

function providerStub(text: string = JSON.stringify(GISTS)) {
  const generateJsonText = vi.fn<(args: ModelArgs) => Promise<string>>(async () => text);
  return { generateJsonText };
}

function request(body: unknown, id: string): NextRequest {
  return new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/paragraph-guide`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function call(body: unknown, id: string = paper.id) {
  return POST(request(body, id), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

const ask = (over: Record<string, unknown> = {}) => ({ paper, ...over });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let provider: ReturnType<typeof providerStub>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetCounterStoreForTests();
  paragraphGuideCache.clear();
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

describe("POST /api/papers/[id]/paragraph-guide — the request", () => {
  it("answers 400 to a body that is not JSON and a paper without an id or title", async () => {
    expect((await call("{not json")).status).toBe(400);
    expect((await call({})).status).toBe(400);
    expect((await call({ paper: { id: paper.id } })).status).toBe(400);
    expect((await call({ paper: { title: "T" } })).status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("answers 400 when the address and the paper name different papers, or the address is not a valid encoding", async () => {
    expect((await call(ask(), "arxiv:2607.99999")).status).toBe(400);
    expect((await POST(request(ask(), paper.id), { params: Promise.resolve({ id: "%E0%A4%A" }) })).status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/paragraph-guide — the one pass", () => {
  it("asks the model once, on the small tier, and answers the grounded gists keyed by section and paragraph", async () => {
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    const args = provider.generateJsonText.mock.calls[0][0];
    expect(args.tier).toBe("small");
    expect(args.maxTokens).toBe(gistMaxTokens(CANDIDATES));
    expect(args.webSearch).toBeUndefined();
    expect(body).toEqual({ cached: false, guide: { docHash: explainDocHash(doc), gists: GISTS_KEPT } });
  });

  it("puts the paper's title and every paragraph with an opening in the prompt, the opening named as its topic sentence — and no paragraph without one", async () => {
    await call(ask());
    const { userPrompt } = provider.generateJsonText.mock.calls[0][0];
    const sent = JSON.parse(userPrompt) as { paper: { title: string }; paragraphs: Array<{ sectionId: string; paragraphIndex: number; topicSentence: string; text: string }> };

    expect(sent.paper.title).toBe(paper.title);
    expect(sent.paragraphs.map((p) => `${p.sectionId}:${p.paragraphIndex}`)).toEqual(["s1:0", "s1:1", "s2:0", "s2:1", "s3:0"]);
    expect(sent.paragraphs[0].topicSentence).toBe(INTRO_0);
    expect(sent.paragraphs[0].text).toBe(INTRO_0);
    expect(userPrompt).not.toContain("Cast alloys remain one of the oldest");
    expect(userPrompt).not.toContain("An abstract about rafting");
  });

  it("puts nothing about the reader in it, whatever the request carries", async () => {
    await call(ask({ project: "PROFILE-SENTINEL", contextHint: "CONTEXT-SENTINEL", questions: ["QUESTION-SENTINEL?"], profile: { name: "PROFILE-SENTINEL" } }));
    const sent = JSON.stringify(provider.generateJsonText.mock.calls);

    for (const sentinel of ["PROFILE-SENTINEL", "CONTEXT-SENTINEL", "QUESTION-SENTINEL"]) expect(sent).not.toContain(sentinel);
    // Not even the paper's abstract: the gist is condensed from the paragraph's own words.
    expect(sent).not.toContain(paper.summaryIntro);
  });

  it("drops a gist the paragraph does not support, and one over twelve words", async () => {
    provider.generateJsonText.mockResolvedValue(
      JSON.stringify({
        gists: [
          { sectionId: "s1", paragraphIndex: 0, gist: "Stocks fell after the earnings call." },
          { sectionId: "s1", paragraphIndex: 1, gist: "Nickel alloys form plates inside grains." },
          { sectionId: "s2", paragraphIndex: 0, gist: "Specimens were machined from one casting and then heat treated together at last." },
          { sectionId: "s3", paragraphIndex: 0, gist: "The rafting ratio rose as specimens crept." },
        ],
      }),
    );
    const body = await json(await call(ask()));

    expect((body.guide as { gists: unknown }).gists).toEqual({
      s1: { 1: "Nickel alloys form plates inside grains." },
      s3: { 0: "The rafting ratio rose as specimens crept." },
    });
  });

  it("drops an entry that names a paragraph the pass never asked about", async () => {
    provider.generateJsonText.mockResolvedValue(
      JSON.stringify({
        gists: [
          { sectionId: "s1", paragraphIndex: 2, gist: "Creep has long been a concern in the field." },
          { sectionId: "s0", paragraphIndex: 0, gist: "An abstract about rafting under creep." },
          { sectionId: "s3", paragraphIndex: 0, gist: "The rafting ratio rose as specimens crept." },
        ],
      }),
    );
    const body = await json(await call(ask()));

    expect((body.guide as { gists: unknown }).gists).toEqual({ s3: { 0: "The rafting ratio rose as specimens crept." } });
  });

  it("reads the model's JSON out of a code fence", async () => {
    provider.generateJsonText.mockResolvedValue("```json\n" + JSON.stringify(GISTS) + "\n```");
    const body = await json(await call(ask()));

    expect((body.guide as { gists: unknown }).gists).toEqual(GISTS_KEPT);
  });

  it("reads a public paper's text by its own id, url and identifiers", async () => {
    await call(ask({ paper: { ...paper, linkArxiv: "https://arxiv.org/abs/2607.00003" } }));

    expect(mocks.getFullText.mock.calls[0][0]).toMatchObject({ paperId: paper.id, url: "https://arxiv.org/abs/2607.00003", arxivId: "2607.00003", openAlexId: null });
  });

  it("reads the id the attached upload names, when there is one", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: [paper.id] });
    await call(ask({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" } }));

    expect(mocks.getFullText.mock.calls[0][0]).toMatchObject({ paperId: "upload:0123456789abcdef" });
  });
});

describe("POST /api/papers/[id]/paragraph-guide — the pass is skipped for a long paper", () => {
  const longDoc = (n: number): ExtractedDocument => ({
    source: "pdf",
    figureCaptions: [],
    sections: [
      {
        id: "s1",
        heading: "1 Methods",
        canonical: "methods",
        text: Array.from({ length: n }, (_, i) => `Specimen batch number ${i} was held at one temperature for a long time under load.`).join("\n\n"),
      },
    ],
  });

  it("answers 200 skipped at 121 paragraphs, asks nothing and remembers nothing", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: longDoc(GUIDE_CAPS.maxParagraphs + 1), attempts: [] });
    const response = await call(ask());

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ skipped: "too_many_paragraphs" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(paragraphGuideCache.size()).toBe(0);
  });

  it("asks at 120 paragraphs", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: longDoc(GUIDE_CAPS.maxParagraphs), attempts: [] });
    provider.generateJsonText.mockResolvedValue(JSON.stringify({ gists: [{ sectionId: "s1", paragraphIndex: 0, gist: "Specimen batches held under load." }] }));
    const response = await call(ask());

    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(provider.generateJsonText.mock.calls[0][0].maxTokens).toBe(gistMaxTokens(120));
    expect(((await json(response)).guide as { gists: unknown }).gists).toEqual({ s1: { 0: "Specimen batches held under load." } });
  });
});

describe("POST /api/papers/[id]/paragraph-guide — the server's memory", () => {
  it("asks the model once for the same document twice: the second is a hit, with no model call", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.guide).toEqual(first.guide);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(paragraphGuideCache.size()).toBe(1);
  });

  it("keys the memory by the document alone: another title or another request body for the same text is a hit", async () => {
    await call(ask());
    const second = await json(await call(ask({ paper: { ...paper, title: "A different title", summaryIntro: "Another abstract." } })));

    expect(second.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("keeps a different document apart", async () => {
    await call(ask());
    const other: ExtractedDocument = { ...doc, sections: doc.sections.map((s) => (s.id === "s3" ? { ...s, text: `${s.text}\n\nAnother sentence that changes the document's hash.` } : s)) };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: other, attempts: [] });
    const third = await json(await call(ask()));

    expect(third.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
  });

  it("holds the finished guide only, under the document's hash: nothing of the request is in the memory", async () => {
    await call(ask({ project: "PROFILE-SENTINEL" }));

    expect(paragraphGuideCache.size()).toBe(1);
    expect(paragraphGuideCache.get(explainDocHash(doc))).toEqual({ docHash: explainDocHash(doc), gists: GISTS_KEPT });
  });
});

describe("POST /api/papers/[id]/paragraph-guide — not charged", () => {
  it("takes nothing from the deep-report allowance or the explain allowance, on a model call or a hit", async () => {
    await call(ask());
    await call(ask());

    expect(mocks.consumeDeepReport).not.toHaveBeenCalled();
    expect(mocks.consumeExplainTurn).not.toHaveBeenCalled();
    expect((await getCounterStore().read(explainTenthsKey("local-no-auth", NOW), NOW)).value).toBe(0);
    expect((await getCounterStore().read(explainTenthsHouseKey(NOW), NOW)).value).toBe(0);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — when there is no guide", () => {
  it("is 200 unavailable when no provider can write, and reads nothing", async () => {
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

  it("is 200 unavailable, with no model call, when no paragraph has an opening", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: { ...doc, sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: NO_OPENING }] }, attempts: [] });
    const response = await call(ask());

    expect(await json(response)).toEqual({ unavailable: true });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 200 unavailable, with nothing remembered, when the model fails, answers nonsense or says nothing grounded", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      () => Promise.reject(new Error("model down")),
      () => Promise.resolve("this is not json at all"),
      () => Promise.resolve(JSON.stringify({ gists: "nope" })),
      () => Promise.resolve(JSON.stringify({ gists: [] })),
      () => Promise.resolve(JSON.stringify({ gists: [{ sectionId: "s1", paragraphIndex: 0, gist: "Stocks fell after the earnings call." }] })),
    ];
    for (const failing of failures) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(paragraphGuideCache.size()).toBe(0);
  });

  it("answers a company-budget refusal with unavailable and the quota signal", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    provider.generateJsonText.mockRejectedValue(new CompanySpendCapRefusedError("global_cap_exceeded"));
    const body = await json(await call(ask()));

    expect(body.unavailable).toBe(true);
    expect(body.quota).toMatchObject({ kind: "company_budget", reason: "exhausted" });
    expect(paragraphGuideCache.size()).toBe(0);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — private uploads", () => {
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
      expect((await call(ask({ paper: { ...paper, id } }), id)).status).toBe(404);
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

  it("is 410 when the upload was replaced or deleted while the model was working, and remembers nothing", async () => {
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const replaced = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(replaced.status).toBe(410);
    expect(replaced.headers.get("cache-control")).toBe("private, no-store");
    expect(paragraphGuideCache.size()).toBe(0);

    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce(null);
    expect((await call(ask({ paper: uploadPaper }), UPLOAD)).status).toBe(410);
    expect(paragraphGuideCache.size()).toBe(0);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — headers", () => {
  it("is never cached, whatever the answer is", async () => {
    const cases: Array<() => Promise<Response>> = [() => call(ask()), () => call(ask()), () => call("{bad"), () => call(ask(), "arxiv:other")];
    for (const run of cases) expect((await run()).headers.get("cache-control")).toMatch(/no-store/);
    mocks.resolveProvider.mockReturnValue(null);
    expect((await call(ask())).headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("POST /api/papers/[id]/paragraph-guide — what it logs", () => {
  it("writes one debug line per model call — counts and sizes — none for a hit, and no word of the paper or the answer", async () => {
    const levels = (["log", "info", "warn", "error", "debug"] as const).map((level) => vi.spyOn(console, level).mockImplementation(() => {}));
    await call(ask({ project: "PROFILE-SENTINEL" }));
    await call(ask());
    const debug = levels[4].mock.calls;
    const all = JSON.stringify(levels.flatMap((spy) => spy.mock.calls));

    expect(debug).toHaveLength(1);
    const [label, fields] = debug[0] as [string, Record<string, unknown>];
    expect(label).toBe("[papers/paragraph-guide] pass");
    expect(Object.keys(fields).sort()).toEqual(["answerChars", "kept", "paragraphs", "promptChars", "userId"]);
    expect(fields).toMatchObject({ paragraphs: CANDIDATES, kept: 5 });
    expect(fields.promptChars).toBeGreaterThan(500);
    expect(fields.answerChars).toBeGreaterThan(100);
    expect(String(fields.userId)).toMatch(/^[0-9a-f]{12}$/);
    expect(String(fields.userId)).not.toContain("local-no-auth");
    expect(levels.slice(0, 4).every((spy) => spy.mock.calls.length === 0)).toBe(true);

    for (const word of ["rafting", "gauge", "Rafting under creep", "tungsten", "Tungsten", "turbine", "blades", "Specimens", "Nickel", "Methods", "Introduction", "PROFILE-SENTINEL"]) {
      expect(all).not.toContain(word);
    }
  });

  it("counts the gists kept, not the gists asked for", async () => {
    const debug = vi.spyOn(console, "debug").mockImplementation(() => {});
    provider.generateJsonText.mockResolvedValue(
      JSON.stringify({
        gists: [
          { sectionId: "s1", paragraphIndex: 0, gist: "Stocks fell after the earnings call." },
          { sectionId: "s3", paragraphIndex: 0, gist: "The rafting ratio rose as specimens crept." },
        ],
      }),
    );
    await call(ask());

    expect((debug.mock.calls[0][1] as { kept: number }).kept).toBe(1);
  });

  it("logs a failed model call by its error's name only", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("upstream said: the rafting ratio paragraph was refused");
    failure.name = "UpstreamError";
    provider.generateJsonText.mockRejectedValue(failure);
    await call(ask());

    expect(JSON.stringify(error.mock.calls)).toContain("UpstreamError");
    expect(JSON.stringify(error.mock.calls)).not.toContain("rafting");
  });
});

describe("POST /api/papers/[id]/paragraph-guide — the provider is resolved for this reader and this route", () => {
  it("passes the reader's own key through to the registry and names the route", async () => {
    const llmOverride = { provider: "gemini", apiKey: "USER-NOT-A-KEY" };
    await call(ask({ llmOverride }));

    expect(mocks.resolveProvider).toHaveBeenCalledTimes(1);
    const [override, context] = mocks.resolveProvider.mock.calls[0] as [unknown, { path: string; byok: boolean }];
    expect(override).toEqual(llmOverride);
    expect(context).toMatchObject({ path: "paragraph-guide", byok: true });
  });

  it("passes none when the request carries none", async () => {
    await call(ask());
    const [override, context] = mocks.resolveProvider.mock.calls[0] as [unknown, { byok: boolean }];

    expect(override).toBeNull();
    expect(context.byok).toBe(false);
  });
});
