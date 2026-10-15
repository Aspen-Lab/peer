import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { plainCache, plainLimit } from "@/lib/papers/plain";
import { captureConsole } from "@/test-support/console-capture";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P4-01 (blueprint §3.6, D14; rulings §1h.10, §1h.12 (h); §3d 15): POST /api/papers/[id]/plain —
// one paragraph of the paper said plainly, at one of three levels, on the reader's own key.
// The numeric-set guard is the subject of most of this file: a rewrite that drops, adds or
// changes a number or a unit is no rewrite of that paragraph — 422, nothing remembered, and the
// page leaves the original standing. Peer counts nothing here (§1h.10): what bounds a reader is
// the gate's hourly limit, pinned in `route.gate.test.ts` (it needs a deployed runtime and a
// session stub). A counting provider stub stands in for the model: no real call anywhere.
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

/** The paragraph the tests rewrite: seven numbers, four with units or brackets. */
const NUMS =
  "Specimens were heat treated at 1100 K for 10–20 ms [12], and the rafting ratio rose from 0.2 to 0.7 (Eq. (3)).";
const FIRST = "Specimens were machined from a single casting and heat treated together.";
const USE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";

const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "An abstract about rafting under creep." },
    { id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1, text: "Hot turbine blades creep slowly under load and lose their shape over many hours." },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: `${FIRST}\n\n${NUMS}` },
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

/** Said plainly, with every number and unit of `NUMS` kept (the brackets and the label too). */
const GOOD = "The samples were heated to 1100 K for 10–20 ms [12]. The rafting ratio went from 0.2 to 0.7 (Eq. (3)).";
/** Every number kept, said in the other order — a multiset, so it is kept. */
const REORDERED = "The rafting ratio went from 0.2 to 0.7 (Eq. (3)). The samples were heated to 1100 K for 10–20 ms [12].";
const DROPS = "The samples were heated to 1100 K for 10–20 ms [12]. The rafting ratio rose to 0.7 (Eq. (3)).";
// Short enough to pass the 1.2 times bound, so it is the numbers that refuse it.
const ADDS = `${GOOD} 50 in all.`;
const UNIT = "The samples were heated to 1100 K for 10–20 s [12]. The rafting ratio went from 0.2 to 0.7 (Eq. (3)).";
const LABEL = "The samples were heated to 1100 K for 10–20 ms [12]. The rafting ratio went from 0.2 to 0.7.";

const NOW = new Date("2026-10-07T12:00:00.000Z");
const LEVELS = ["highschool", "undergrad", "graduate"] as const;

/** What the route hands the model. */
interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
  webSearch?: boolean;
}

/** A model that answers `text`, whatever it is. */
function providerStub(text: string = JSON.stringify({ plain: GOOD })) {
  const generateJsonText = vi.fn<(args: ModelArgs) => Promise<string>>(async () => text);
  return { generateJsonText };
}

function request(body: unknown, id: string): NextRequest {
  return new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/plain`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

function call(body: unknown, id: string = paper.id) {
  return POST(request(body, id), { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}

const ask = (over: Record<string, unknown> = {}) => ({ paper, sectionId: "s2", paragraphIndex: 1, text: NUMS, level: "undergrad", ...over });

async function json(response: Response): Promise<Record<string, unknown>> {
  return (await response.json()) as Record<string, unknown>;
}

let provider: ReturnType<typeof providerStub>;

/** A model whose answer is `{ plain }`. */
function stub(plain: string) {
  stubRaw(JSON.stringify({ plain }));
}

/** A model whose answer is exactly `text`. */
function stubRaw(text: string) {
  provider = providerStub(text);
  mocks.resolveProvider.mockReturnValue(provider);
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  resetCounterStoreForTests();
  plainCache.clear();
  vi.clearAllMocks();
  provider = providerStub();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc, attempts: [] });
  // The route's one debug line per turn: silenced here, read in "what it logs" below.
  vi.spyOn(console, "debug").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("POST /api/papers/[id]/plain — the request", () => {
  it("answers 400 to a body that is not JSON, a paper without an id or title, a text that is not text, and a level that is not one of the three", async () => {
    expect((await call("{not json")).status).toBe(400);
    expect((await call({ text: NUMS, level: "undergrad" })).status).toBe(400);
    expect((await call({ paper: { id: paper.id }, text: NUMS, level: "undergrad" })).status).toBe(400);
    expect((await call(ask({ text: 5 }))).status).toBe(400);
    expect((await call(ask({ text: undefined }))).status).toBe(400);
    for (const level of [undefined, null, "", "phd", "Undergrad", " undergrad", 2, ["undergrad"], {}]) {
      expect((await call(ask({ level }))).status, JSON.stringify(level)).toBe(400);
    }
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });

  it("answers 400 when the address and the paper name different papers, and to an address that is not a valid encoding", async () => {
    const mismatch = await call(ask(), "arxiv:2607.99999");
    const badAddress = await POST(request(ask(), paper.id), { params: Promise.resolve({ id: "%E0%A4%A" }) });

    expect(mismatch.status).toBe(400);
    expect(badAddress.status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/plain — the rewrite", () => {
  it("asks the model once, on the small tier with the rewrite's own token budget, and answers the plain paragraph with its level", async () => {
    const response = await call(ask());
    const body = await json(response);

    expect(response.status).toBe(200);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    const args = provider.generateJsonText.mock.calls[0][0];
    expect(args.tier).toBe("small");
    // 1,200 x 1.2 characters is about 400 tokens, with room for what tokenises denser: 600.
    expect(args.maxTokens).toBe(600);
    expect(args.webSearch).toBeUndefined();
    expect(body).toEqual({ plain: GOOD, level: "undergrad", cached: false });
  });

  it("writes the level into the prompt, for each of the three, and answers it back", async () => {
    for (const level of LEVELS) {
      plainCache.clear();
      provider.generateJsonText.mockClear();
      const body = await json(await call(ask({ level })));
      const prompt = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { level: string; levelRules: string[] };

      expect(body.level).toBe(level);
      expect(prompt.level).toBe(level);
      expect(prompt.levelRules.join(" ")).toMatch(level === "highschool" ? /at most 20 words/ : level === "undergrad" ? /at most 25 words/ : /at most 30 words/);
    }
  });

  it("puts the paper's title and the paragraph, as the paper holds it, in the prompt — and nothing about the reader, whatever the request carries", async () => {
    await call(ask({ project: "PROFILE-SENTINEL", contextHint: "CONTEXT-SENTINEL", questions: ["QUESTION-SENTINEL?"], profile: { name: "PROFILE-SENTINEL" } }));
    const { systemPrompt, userPrompt } = provider.generateJsonText.mock.calls[0][0];
    const parsed = JSON.parse(userPrompt) as { paper: { title: string }; paragraph: string };

    expect(parsed.paper.title).toBe(paper.title);
    expect(parsed.paragraph).toBe(NUMS);
    // The abstract, the map and the neighbouring paragraphs are not part of this request.
    expect(`${systemPrompt}${userPrompt}`).not.toContain(paper.summaryIntro);
    expect(`${systemPrompt}${userPrompt}`).not.toContain("1 Introduction");
    expect(`${systemPrompt}${userPrompt}`).not.toContain(FIRST);
    const sent = JSON.stringify(provider.generateJsonText.mock.calls);
    for (const sentinel of ["PROFILE-SENTINEL", "CONTEXT-SENTINEL", "QUESTION-SENTINEL"]) expect(sent).not.toContain(sentinel);
  });

  it("rewrites the paragraph the paper holds, whichever words of it the request named, and finds it without the hint", async () => {
    const body = await json(await call(ask({ text: "the rafting ratio rose from 0.2 to 0.7", sectionId: undefined, paragraphIndex: undefined })));
    const parsed = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { paragraph: string };

    expect(body.plain).toBe(GOOD);
    expect(parsed.paragraph).toBe(NUMS);
  });

  it("reads the paragraph under the hint first, and the same words elsewhere in the paper when the hint is wrong", async () => {
    const wrongHint = await json(await call(ask({ sectionId: "s3", paragraphIndex: 0 })));

    expect(wrongHint.plain).toBe(GOOD);
    expect(JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt)).toMatchObject({ paragraph: NUMS });
  });

  it("refuses 422 a paragraph the body does not hold — before any model is asked", async () => {
    for (const text of ["a sentence the paper never wrote", "An abstract about rafting under creep.", "", "   "]) {
      const response = await call(ask({ text }));

      expect(response.status, text).toBe(422);
      expect(await json(response)).toEqual({ error: "not_in_paper" });
    }
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("clips a long paragraph to 1,200 characters at a word, and the rewrite is held to 1.2 times that", async () => {
    const long = `${NUMS} ${"The grains coarsened slowly under a steady load. ".repeat(40)}`.trim();
    expect(long.length).toBeGreaterThan(1500);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: { ...doc, sections: doc.sections.map((s) => (s.id === "s2" ? { ...s, text: `${FIRST}\n\n${long}` } : s)) }, attempts: [] });
    // `clipPassage`: at most 1,200 characters, cut at the last space.
    const clipped = long.slice(0, long.lastIndexOf(" ", 1200));
    stub(clipped);
    const body = await json(await call(ask({ text: long })));
    const parsed = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { paragraph: string; maxCharacters: number };

    expect(parsed.paragraph.length).toBeLessThanOrEqual(1200);
    expect(parsed.paragraph.length).toBeGreaterThan(1100);
    expect(parsed.maxCharacters).toBe(plainLimit(parsed.paragraph));
    expect(body.plain).toBe(clipped);
  });

  it("asks the paper's text by the id the attached upload names, when there is one, and by its own id, url and identifiers otherwise", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: [paper.id] });
    await call(ask({ paper: { ...paper, fullTextUploadId: "upload:0123456789abcdef" } }));
    expect(mocks.getFullText.mock.calls[0][0]).toMatchObject({ paperId: "upload:0123456789abcdef" });

    plainCache.clear();
    await call(ask({ paper: { ...paper, linkArxiv: "https://arxiv.org/abs/2607.00002" } }));
    expect(mocks.getFullText.mock.calls[1][0]).toMatchObject({ paperId: paper.id, url: "https://arxiv.org/abs/2607.00002", arxivId: "2607.00002", openAlexId: null });
  });
});

// ── The numeric-set guard (§3d 15) ──────────────────────────────────────

describe("POST /api/papers/[id]/plain — the numeric-set guard", () => {
  it("answers 422 numbers_changed when the rewrite drops a number — and remembers nothing", async () => {
    stub(DROPS);
    const response = await call(ask());

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "numbers_changed" });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(plainCache.size()).toBe(0);
  });

  it("answers 422 when the rewrite adds a number the paragraph did not say", async () => {
    stub(ADDS);
    const response = await call(ask());

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "numbers_changed" });
    expect(plainCache.size()).toBe(0);
  });

  it("answers 422 when the rewrite changes a unit: 10 ms to 10 s", async () => {
    stub(UNIT);
    const response = await call(ask());

    expect(response.status).toBe(422);
    expect(await json(response)).toEqual({ error: "numbers_changed" });
    expect(plainCache.size()).toBe(0);
  });

  it("answers 422 when the rewrite loses a citation or an equation label the author wrote", async () => {
    stub(LABEL);
    expect((await call(ask())).status).toBe(422);
    plainCache.clear();
    stub(GOOD.replace(" [12]", ""));
    expect((await call(ask())).status).toBe(422);
    expect(plainCache.size()).toBe(0);
  });

  it("keeps a rewrite that says the same numbers in another order: the set is a multiset", async () => {
    stub(REORDERED);
    const response = await call(ask());

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ plain: REORDERED, level: "undergrad", cached: false });
    expect(plainCache.size()).toBe(1);
  });

  it("is a 200 with nothing to show, not a 422, for a rewrite 1.3 times the original — it is discarded whole, never cut", async () => {
    const padding = " It is worth saying again, in other words, that these are plain facts about the heated samples.";
    let long = GOOD;
    while (long.length < 1.3 * NUMS.length) long += padding;
    stub(long);
    const response = await call(ask());

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ unavailable: true });
    expect(plainCache.size()).toBe(0);
  });

  it("takes a web address out of a rewrite that still keeps the numbers, and answers the rest", async () => {
    stub(`${GOOD} (https://example.org/where-it-came-from)`);
    const body = await json(await call(ask()));

    expect(body.plain).toBe(GOOD);
    expect(JSON.stringify(body)).not.toMatch(/https?:/);
  });

  it("is a 200 with nothing to show for an answer that is not the promised JSON, and remembers nothing", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failures = [
      () => Promise.reject(new Error("model down")),
      () => Promise.resolve("this is not json at all"),
      () => Promise.resolve(JSON.stringify({ plain: "" })),
      () => Promise.resolve(JSON.stringify({ plain: 5 })),
      () => Promise.resolve(JSON.stringify({ other: GOOD })),
      () => Promise.resolve(JSON.stringify([GOOD])),
    ];
    for (const failing of failures) {
      provider.generateJsonText.mockImplementation(failing);
      const response = await call(ask());

      expect(response.status).toBe(200);
      expect(await json(response)).toEqual({ unavailable: true });
    }
    expect(plainCache.size()).toBe(0);
  });

  it("reads a fenced or surrounded JSON object the way the explain answers are read", async () => {
    stubRaw(`Here is the rewrite:\n\`\`\`json\n${JSON.stringify({ plain: GOOD })}\n\`\`\``);
    const body = await json(await call(ask()));

    expect(body.plain).toBe(GOOD);
  });
});

describe("POST /api/papers/[id]/plain — the memory", () => {
  it("asks the model once for the same paragraph at the same level twice: the second is a hit, with no call", async () => {
    const first = await json(await call(ask()));
    const second = await json(await call(ask()));

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.plain).toBe(first.plain);
    expect(second.level).toBe("undergrad");
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("finds a hit however the paragraph is spaced or hinted, because it is keyed by the paragraph the paper holds", async () => {
    await call(ask());
    const second = await json(await call(ask({ text: `  ${NUMS.replace(/ /g, "   ")} `, sectionId: undefined, paragraphIndex: undefined })));

    expect(second.cached).toBe(true);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("keeps a different level, a different paragraph and a different paper apart", async () => {
    await call(ask());
    await call(ask({ level: "graduate" }));
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);

    // A different paragraph, kept apart: a rewrite whose numbers are that paragraph's.
    stub("The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.");
    await call(ask({ text: USE, sectionId: "s3", paragraphIndex: 0 }));
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);

    // The same words in a document that differs: another paper, another entry.
    stub(GOOD);
    const other: ExtractedDocument = { ...doc, sections: doc.sections.map((s) => (s.id === "s2" ? { ...s, text: `${s.text}\n\nAnother sentence that changes the document's hash.` } : s)) };
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: other, attempts: [] });
    const third = await json(await call(ask()));

    expect(third.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("holds the verified rewrite only: a refused one is not remembered, so asking again asks again", async () => {
    stub(DROPS);
    await call(ask());
    await call(ask());

    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
    expect(plainCache.size()).toBe(0);
  });

  it("holds one entry per answer, and nothing of the request in it", async () => {
    await call(ask({ project: "PROFILE-SENTINEL" }));

    expect(plainCache.size()).toBe(1);
  });
});

describe("POST /api/papers/[id]/plain — when there is no answer", () => {
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
});

describe("POST /api/papers/[id]/plain — private uploads", () => {
  const UPLOAD = "upload:0123456789abcdef";
  const uploadPaper = { ...paper, id: UPLOAD };

  it("is 404 for an upload the caller does not own, before any text is read or model asked, with the private headers", async () => {
    mocks.ownedUpload.mockResolvedValue(null);
    const response = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(response.status).toBe(404);
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(provider.generateJsonText).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");
  });

  it("is 404 for a claim spelled so it is not an upload id — a case variant included — and never looks it up", async () => {
    for (const id of ["UPLOAD:0123456789abcdef", "upload:0123456789ABCDEF", " upload:0123456789abcdef", "Upload:0123456789abcdef"]) {
      const response = await call(ask({ paper: { ...paper, id } }), id);

      expect(response.status, id).toBe(404);
      expect(response.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(mocks.ownedUpload).not.toHaveBeenCalled();
    expect(mocks.getFullText).not.toHaveBeenCalled();
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("is 404 for a public paper naming an attachment that does not list it, or a malformed one", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 1, paperIds: ["arxiv:other"] });
    expect((await call(ask({ paper: { ...paper, fullTextUploadId: UPLOAD } }))).status).toBe(404);
    expect((await call(ask({ paper: { ...paper, fullTextUploadId: "not-an-upload" } }))).status).toBe(404);
    expect((await call(ask({ paper: { ...paper, fullTextUploadId: 5 } }))).status).toBe(404);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("answers an owner, with the private headers on the answer and on a refused rewrite alike", async () => {
    mocks.ownedUpload.mockResolvedValue({ revision: 3, paperIds: [UPLOAD] });
    const response = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(response.status).toBe(200);
    expect((await json(response)).cached).toBe(false);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-robots-tag")).toBe("noindex, noarchive");

    plainCache.clear();
    stub(DROPS);
    const refused = await call(ask({ paper: uploadPaper }), UPLOAD);
    expect(refused.status).toBe(422);
    expect(refused.headers.get("cache-control")).toBe("private, no-store");
  });

  it("is 410 when the upload was replaced or deleted while the model was working, and remembers nothing", async () => {
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });
    const replaced = await call(ask({ paper: uploadPaper }), UPLOAD);

    expect(replaced.status).toBe(410);
    expect(replaced.headers.get("cache-control")).toBe("private, no-store");
    expect(plainCache.size()).toBe(0);

    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce(null);
    expect((await call(ask({ paper: uploadPaper }), UPLOAD)).status).toBe(410);
    expect(plainCache.size()).toBe(0);
  });

  it("checks the guard before the revision: a refused rewrite is a 422 even when the upload changed", async () => {
    stub(DROPS);
    mocks.ownedUpload.mockResolvedValueOnce({ revision: 3, paperIds: [UPLOAD] }).mockResolvedValueOnce({ revision: 4, paperIds: [UPLOAD] });

    expect((await call(ask({ paper: uploadPaper }), UPLOAD)).status).toBe(422);
  });
});

describe("POST /api/papers/[id]/plain — headers", () => {
  it("is never cached, whatever the answer is", async () => {
    const cases: Array<() => Promise<Response>> = [
      () => call(ask()),
      () => call(ask()),
      () => call(ask({ text: "no such words in this paper" })),
      () => call("{bad"),
      () => call(ask(), "arxiv:other"),
      () => call(ask({ level: "phd" })),
    ];
    for (const run of cases) expect((await run()).headers.get("cache-control")).toMatch(/no-store/);
    stub(DROPS);
    plainCache.clear();
    expect((await call(ask())).headers.get("cache-control")).toMatch(/no-store/);
    mocks.resolveProvider.mockReturnValue(null);
    expect((await call(ask())).headers.get("cache-control")).toMatch(/no-store/);
  });
});

describe("POST /api/papers/[id]/plain — what it logs", () => {
  const KEY = "USER-NOT-A-KEY-PLAIN";

  it("writes one debug line per turn — counts and sizes — and no word of the paper, the paragraph, the rewrite, the reader or the key, in any console method", async () => {
    const consoleText = captureConsole();
    try {
      await call(ask({ project: "PROFILE-SENTINEL", llmOverride: { provider: "gemini", apiKey: KEY } }));
      await call(ask({ llmOverride: { provider: "gemini", apiKey: KEY } }));
      const all = consoleText.text();

      // The turn, then the hit.
      expect(consoleText.calls()).toBe(2);
      const lines = all.split("\n");
      expect(lines[0]).toContain("[papers/plain] turn");
      expect(lines[0]).toMatch(/promptChars: \d+/);
      expect(lines[0]).toMatch(/answerChars: \d+/);
      expect(lines[0]).toContain("cached: false");
      expect(lines[1]).toContain("cached: true");
      // No one is signed in here (the ordinary route tests run with no sign-in at all), so there
      // is no account to hash; `route.gate.test.ts` pins the line a signed-in reader gets.
      expect(all).not.toContain("userId");
      for (const word of ["rafting", "Rafting under creep", "Specimens", "heat treated", "1100", "10–20", "samples", "heated", "PROFILE-SENTINEL", "Methods", "Introduction", KEY, "apiKey"]) {
        expect(all).not.toContain(word);
      }
    } finally {
      consoleText.restore();
    }
  });

  it("logs a failed model call by its error's name only — not the message, which may echo the paragraph or the key", async () => {
    const consoleText = captureConsole();
    try {
      const failure = new Error(`upstream said: the paragraph about rafting at 1100 K was refused for key ${KEY}`);
      failure.name = "UpstreamError";
      provider.generateJsonText.mockRejectedValue(failure);
      await call(ask({ llmOverride: { provider: "gemini", apiKey: KEY } }));
      const all = consoleText.text();

      expect(all).toContain("UpstreamError");
      for (const word of ["rafting", "1100", KEY, "refused"]) expect(all).not.toContain(word);
    } finally {
      consoleText.restore();
    }
  });

  it("logs a refused rewrite's sizes too, and still no word of it", async () => {
    stub(DROPS);
    const consoleText = captureConsole();
    try {
      expect((await call(ask())).status).toBe(422);
      const all = consoleText.text();

      expect(consoleText.calls()).toBe(1);
      expect(all).toContain("[papers/plain] turn");
      for (const word of ["rafting", "samples", "0.7", "numbers_changed"]) expect(all).not.toContain(word);
    } finally {
      consoleText.restore();
    }
  });
});

describe("POST /api/papers/[id]/plain — the provider is the reader's own", () => {
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
