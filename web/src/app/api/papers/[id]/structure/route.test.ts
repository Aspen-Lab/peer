import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { explainDocHash } from "@/lib/papers/explain";
import {
  draftOf,
  REVIEW_CAPS,
  REVIEW_PROMPT_VERSION,
  restoreReview,
  reviewedParts,
  SKELETON_VERSION,
  STRUCTURE_RULES_VERSION,
  structureReviewCache,
  structureReviewKey,
  type StructureReviewEntry,
} from "@/lib/papers/structure-review";
import { FIVE_PARTS, inventedPaper, inventedParagraph, modelDouble } from "@/test-support/structure-fixtures";
import { LOW_ABSTRACT_FIELDS, LOW_ROWS, lowPaper } from "@/test-support/structure-fixtures-low";
import { captureConsole } from "@/test-support/console-capture";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P12-53 (B P12-42 §6; ruling §1h.424 (b), §1h.428): POST /api/papers/[id]/structure — the model's review of the
// rules' structure. The rules' draft and the skeleton are made from the document; the model returns corrections
// only; every failure leaves the draft; a finished review is remembered by the document and the versions of what
// is asked. An in-test provider stands in for the model: no real call anywhere, and the double that answers reads
// only the prompt it is given. The sign-in gate is in `route.gate.test.ts`, the owner checks in
// `route.privacy.test.ts`. Every text below is invented.

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

// `FIVE` is wrong in parts the rules were sure of, so the review of it is refused whole (P12-94); the prompt tests below use it for
// its skeleton. `LOW` is wrong where the rules were unsure (the unplaced opening and the closing): the paper most tests review.
const FIVE = inventedPaper(FIVE_PARTS);
const draft = draftOf(FIVE.input)!;
const LOW = lowPaper();
const lowDraft = draftOf(LOW.input)!;

const paper = {
  id: "arxiv:2610.00031",
  title: "Zymurgy of the tide pools",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  ...LOW_ABSTRACT_FIELDS,
  summaryExperimentKeywords: ["shore"],
  isSaved: false,
};

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
}
type Reply = (args: ModelArgs) => Promise<string>;

/** A provider whose model is the double: it answers from the prompt it is given. */
function providerOf(reply: Reply = async (args) => modelDouble(args.userPrompt)) {
  return { id: "gemini", generateJsonText: vi.fn<Reply>(reply) };
}

function call(body: unknown = { paper }, id: string = paper.id) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(id)}/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(id) }) });
}
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;
const reviewOf = async (response: Response) => (await json(response)).review as StructureReviewEntry;
const isLook = (args: ModelArgs) => (JSON.parse(args.userPrompt) as { outputSchema: Record<string, unknown> }).outputSchema.verdict !== undefined;

let provider: ReturnType<typeof providerOf>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-27T12:00:00.000Z"));
  resetCounterStoreForTests();
  structureReviewCache.clear();
  vi.clearAllMocks();
  provider = providerOf();
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc: LOW.doc, attempts: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("POST /api/papers/[id]/structure — the request", () => {
  it("answers 400 to a body that is not JSON and a paper without an id or title", async () => {
    expect((await call("{bad")).status).toBe(400);
    expect((await call({ paper: { id: "x" } })).status).toBe(400);
    expect((await call({})).status).toBe(400);
  });

  it("answers 400 when the address and the paper name different papers, or the address is not a valid encoding", async () => {
    expect((await call({ paper }, "arxiv:other")).status).toBe(400);
    const bad = new NextRequest("http://localhost/api/papers/%E0%A4%A/structure", { method: "POST", body: JSON.stringify({ paper }) });
    expect((await POST(bad, { params: Promise.resolve({ id: "%E0%A4%A" }) })).status).toBe(400);
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });
});

describe("POST /api/papers/[id]/structure — the review", () => {
  // Re-aimed (P12-94): the paper is `LOW`, not `FIVE`. The double's corrections for `FIVE` (a move and a role, both against parts the rules were
  // sure of) are refused whole now, and its two looks were `contradicts-high`; for `LOW` the corrections are against the two parts the rules were
  // unsure of (a split and a role of the unplaced opening, a move of the closing), and the two looks are `contradicts-low`. The claims are kept: one
  // call on the report tier, the corrections applied to the draft equal the truth, one look for each part corrected.
  it("asks the model once on the report tier, and answers the corrections: applied to the draft they equal the truth", async () => {
    const response = await call();
    const body = await json(response);
    const review = body.review as StructureReviewEntry;

    expect(response.status).toBe(200);
    expect(body.cached).toBe(false);
    expect(review.corrections).toEqual([
      { op: "move_start", part: 2, toParagraph: 13 },
      { op: "split", part: 0, atParagraph: 5, role: "setup" },
      { op: "set_role", part: 0, role: "method" },
    ]);
    expect(review.draftDigest).toBe(lowDraft.digest);
    expect(reviewedParts(lowDraft, review)).toEqual(LOW.truthParts);
    // One call for the review, and one look for each of the two parts the model corrected that the rules were unsure of.
    const reviews = provider.generateJsonText.mock.calls.filter(([args]) => !isLook(args));
    expect(reviews).toHaveLength(1);
    expect(reviews[0][0]).toMatchObject({ tier: "large", maxTokens: 600 });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(3);
    expect(review.secondLooks).toEqual([
      { part: 0, why: "contradicts-low", verdict: "review" },
      { part: 2, why: "contradicts-low", verdict: "review" },
    ]);
    // What the route answers reads back as it is, the new kind of look included.
    expect(restoreReview(JSON.parse(JSON.stringify(review)))).toEqual(review);
  });

  it("makes the draft the browser makes: the closing split of rule set B reads the record's abstract, and the closing is a `low` part", async () => {
    const abstract = "Mussel populations decline sharply under persistent warming, according to the survey.";
    const closing = inventedPaper(
      [
        { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 3]] },
        { heading: "3 Results", canonical: "results", truth: [["evidence", 5]] },
        { heading: "4 Methods", canonical: "methods", truth: [["method", 2]] },
        { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
      ],
      { abstract, paragraphs: { 7: "In summary, mussel populations decline sharply under persistent warming across the survey." } },
    );
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: closing.doc, attempts: [] });
    await call({ paper: { ...paper, summaryIntro: "Mussel populations decline sharply", summaryResultDiscussion: "under persistent warming, according to the survey." } });
    const sent = JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { draft: { parts: string[] } };
    const browser = draftOf(closing.input)!;

    expect(browser.parts[2]).toMatchObject({ from: 7, to: 7, role: "interpretation", conf: "low" });
    expect(sent.draft.parts).toEqual(browser.lines);
    // Without the abstract the split is not made, and the draft is another draft (another digest).
    structureReviewCache.clear();
    provider.generateJsonText.mockClear();
    await call({ paper: { ...paper, summaryIntro: "", summaryResultDiscussion: "" } });
    expect((JSON.parse(provider.generateJsonText.mock.calls[0][0].userPrompt) as { draft: { parts: string[] } }).draft.parts).toHaveLength(4);
  });

  it("uses the small tier where the report tier is set small", async () => {
    vi.stubEnv("PEER_REPORT_MODEL_TIER", "small");
    await call();

    for (const [args] of provider.generateJsonText.mock.calls) expect(args.tier).toBe("small");
  });

  it("puts the skeleton and the draft in the prompt, the paragraph heads and no tail, and no title and nothing of the request", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: FIVE.doc, attempts: [] });
    await call({ paper, project: "PROFILE-SENTINEL", llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    const [args] = provider.generateJsonText.mock.calls[0];
    const user = JSON.parse(args.userPrompt) as { skeleton: string[]; draft: { parts: string[] } };

    expect(user.draft.parts).toEqual(draft.lines);
    expect(user.skeleton.some((line) => line.startsWith('## s1 L1 p1 introduction "1 Introduction" 0-5'))).toBe(true);
    expect(user.skeleton.find((line) => line.startsWith("11 "))).toBe("11 F1 T1 N2 | Invented evidence paragraph 11 about mussel banks. Fig. 2 shows a rise of 14 % in…");
    for (const sent of provider.generateJsonText.mock.calls.map(([a]) => a.systemPrompt + a.userPrompt)) {
      for (const word of ["Zymurgy", "PROFILE-SENTINEL", "USER-NOT-A-KEY"]) expect(sent).not.toContain(word);
    }
    // The review prompt carries heads and counts, never a paragraph's tail (a look carries the disputed span's own text).
    expect(args.userPrompt).not.toContain("Nothing here is quoted");
  });

  it("sizes the skeleton against the whole text: the review prompt is a fraction of what the paper would cost", async () => {
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: FIVE.doc, attempts: [] });
    await call();
    const [args] = provider.generateJsonText.mock.calls[0];

    expect(args.systemPrompt.length + args.userPrompt.length).toBeLessThan(FIVE.wholeChars + 3_500);
    expect(args.userPrompt.length).toBeLessThan(FIVE.wholeChars + 1_000);
  });

  it("answers a draft that is right with no correction, asks no look, and remembers the answer", async () => {
    const right = inventedPaper([
      { heading: "1 Introduction", canonical: "introduction", truth: [["setup", 3]] },
      { heading: "2 Methods", canonical: "methods", truth: [["method", 3]] },
      { heading: "3 Results", canonical: "results", truth: [["evidence", 3]] },
      { heading: "References", canonical: "references", truth: [["apparatus", 2]] },
    ]);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: right.doc, attempts: [] });
    const body = await json(await call());

    expect((body.review as StructureReviewEntry).corrections).toEqual([]);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(structureReviewCache.size()).toBe(1);
  });

  it("keeps the correction a look confirms and drops the one a look overrules, or cannot read", async () => {
    // Re-aimed (P12-94): `LOW`'s review holds three corrections (it was two for `FIVE`), against two parts; a look decides each part's.
    const answers: Array<[string, number]> = [
      [JSON.stringify({ verdict: "draft" }), 0],
      [JSON.stringify({ verdict: "review" }), 3],
      ["I cannot help with that.", 0],
    ];
    for (const [look, kept] of answers) {
      structureReviewCache.clear();
      provider = providerOf(async (args) => (isLook(args) ? look : modelDouble(args.userPrompt)));
      mocks.resolveProvider.mockReturnValue(provider);

      expect((await reviewOf(await call())).corrections).toHaveLength(kept);
    }
  });

  // Re-aimed (P12-94): the measured damage was a split as setup and a split as evidence inside the first results part (9 to 17 of `FIVE`), a part the
  // rules were sure of, which is refused as `confident-draft` now. The guard is shown on a part the rules were unsure of that comes after the opening,
  // the closing (14 to 16 of `LOW`): the split as setup is refused for the guard's reason, the correction beside it (the opening's role) stands.
  it("refuses a setup piece cut out of the part after the opening (P12-86): the log counts the refusal and the other correction stands", async () => {
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      provider = providerOf(async (args) =>
        isLook(args)
          ? JSON.stringify({ verdict: "review" })
          : JSON.stringify({
              corrections: [
                { op: "split", part: 2, atParagraph: 15, role: "setup" },
                { op: "set_role", part: 0, role: "method" },
              ],
              unsure: [],
            }),
      );
      mocks.resolveProvider.mockReturnValue(provider);
      const review = await reviewOf(await call());
      const fields = debug.mock.calls.find(([label]) => label === "[papers/structure] review")![1] as Record<string, unknown>;

      expect(review.corrections).toEqual([{ op: "set_role", part: 0, role: "method" }]);
      expect(reviewedParts(lowDraft, review)).toEqual([
        { from: 0, to: 7, role: "method" },
        { from: 8, to: 13, role: "evidence" },
        { from: 14, to: 16, role: "interpretation" },
        { from: 17, to: 19, role: "apparatus" },
      ]);
      expect(fields).toMatchObject({ corrections: 1, rejected: 1 });
      expect(fields.refusedNumbers).toEqual([{ op: "split", reason: "setup-after-opening", part: 2, ordinal: 15, role: "setup", draftLength: 4, paragraphs: 20, from: 14, to: 16 }]);
    } finally {
      consoleText.restore();
    }
  });

  // Re-aimed (P12-94): the pair was cut in the first results part of `FIVE` (9 to 17, sure) with a role of part 3 beside it; it is cut in the
  // unplaced opening of `LOW` (0 to 7, unsure) with a role of the closing beside it. The claims are the same.
  it("refuses a one-paragraph piece cut out of a part (P12-90): the log counts both splits and the other correction stands", async () => {
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      // "method" at 5 and "evidence" at 6 inside the opening (0 to 7), beside a correction elsewhere.
      provider = providerOf(async (args) =>
        isLook(args)
          ? JSON.stringify({ verdict: "review" })
          : JSON.stringify({
              corrections: [
                { op: "split", part: 0, atParagraph: 5, role: "method" },
                { op: "split", part: 0, atParagraph: 6, role: "evidence" },
                { op: "set_role", part: 2, role: "evidence" },
              ],
              unsure: [],
            }),
      );
      mocks.resolveProvider.mockReturnValue(provider);
      const review = await reviewOf(await call());
      const fields = debug.mock.calls.find(([label]) => label === "[papers/structure] review")![1] as Record<string, unknown>;

      expect(review.corrections).toEqual([{ op: "set_role", part: 2, role: "evidence" }]);
      expect(reviewedParts(lowDraft, review)).toEqual([
        { from: 0, to: 7, role: "setup" },
        { from: 8, to: 16, role: "evidence" },
        { from: 17, to: 19, role: "apparatus" },
      ]);
      expect(fields).toMatchObject({ corrections: 1, rejected: 2 });
      // Named by their numbers (P12-90): the opening is 0 to 7 in a draft of four parts and twenty paragraphs.
      expect(fields.refusedNumbers).toEqual([
        { op: "split", reason: "piece-too-short", part: 0, ordinal: 5, role: "method", draftLength: 4, paragraphs: 20, from: 0, to: 7 },
        { op: "split", reason: "piece-too-short", part: 0, ordinal: 6, role: "evidence", draftLength: 4, paragraphs: 20, from: 0, to: 7 },
      ]);
    } finally {
      consoleText.restore();
    }
  });

  it("refuses a correction against a part the rules were sure of, beside one against a part they were unsure of: the log names `confident-draft`, the other stands, one look (P12-94)", async () => {
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      // Part 1 is the results (`high`, 8 to 13), part 0 the unplaced opening (`low`).
      provider = providerOf(async (args) =>
        isLook(args)
          ? JSON.stringify({ verdict: "review" })
          : JSON.stringify({ corrections: [{ op: "set_role", part: 1, role: "method" }, { op: "set_role", part: 0, role: "method" }], unsure: [] }),
      );
      mocks.resolveProvider.mockReturnValue(provider);
      const review = await reviewOf(await call());
      const fields = debug.mock.calls.find(([label]) => label === "[papers/structure] review")![1] as Record<string, unknown>;

      expect(review.corrections).toEqual([{ op: "set_role", part: 0, role: "method" }]);
      // The refused one drew no look: one for the part the rules were unsure of.
      expect(review.secondLooks).toEqual([{ part: 0, why: "contradicts-low", verdict: "review" }]);
      expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
      expect(fields).toMatchObject({ corrections: 1, rejected: 1, looks: 1 });
      expect(fields.refusedNumbers).toEqual([{ op: "set_role", reason: "confident-draft", part: 1, ordinal: null, role: "method", draftLength: 4, paragraphs: 20, from: 8, to: 13 }]);
      expect(consoleText.text()).not.toMatch(/Invented|tide pools|Zymurgy/);
    } finally {
      consoleText.restore();
    }
  });

  // Re-aimed (P12-94), was "never takes more than three looks, each at most 6,600 characters, and none for a correction against a part the rules were
  // unsure of": the paper was ten rows the rules were sure of, and the model corrected every one; those corrections are refused now, and a correction
  // against a part the rules were unsure of draws a look. The rules are unsure of two parts of a paper at most (the opening nothing places, the
  // closing), so the route cannot reach the cap of three by itself; the core test pins the cap with a draft of more parts. Kept here: a look for each
  // part the model corrected that the rules were unsure of, no more than the cap, each at most 6,600 characters of the paper, 60 tokens to answer.
  it("takes a look for each part the rules were unsure of that the model corrected, never more than three, each at most 6,600 characters", async () => {
    const padding = " Padding words about nothing in particular.".repeat(30);
    const paragraphs: Record<number, string> = {};
    LOW.roles.forEach((role, g) => {
      if (g !== 14) paragraphs[g] = `${inventedParagraph(role, g)}${padding}`;
    });
    const long = lowPaper(LOW_ROWS, paragraphs);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: long.doc, attempts: [] });
    const review = await reviewOf(await call());
    const looks = provider.generateJsonText.mock.calls.filter(([args]) => isLook(args));

    expect(looks).toHaveLength(2);
    expect(looks.length).toBeLessThanOrEqual(REVIEW_CAPS.secondLooks);
    expect(review.secondLooks).toEqual([
      { part: 0, why: "contradicts-low", verdict: "review" },
      { part: 2, why: "contradicts-low", verdict: "review" },
    ]);
    for (const [args] of looks) {
      expect(args.userPrompt.length).toBeLessThanOrEqual(REVIEW_CAPS.lookChars + 3_000);
      expect(args.maxTokens).toBe(60);
    }
    // The looks agreed: all three corrections stand.
    expect(review.corrections).toHaveLength(3);
  });

  // Re-aimed (P12-94), was "asks no look for a correction against a part the rules were unsure of, and keeps it": it asks one, and keeps
  // the correction only if that look sides with the review. The look costs one call, inside the cap of three.
  it("asks one look for a correction against a part the rules were unsure of, and keeps it only if the look agrees", async () => {
    const unheaded = inventedPaper([
      { heading: "A Survey of Shore Ecology", canonical: "body", truth: [["setup", 4], ["evidence", 4]] },
      { heading: "Methods", canonical: "methods", truth: [["method", 3]] },
    ]);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: unheaded.doc, attempts: [] });
    const review = await reviewOf(await call());

    expect(review.corrections).toEqual([{ op: "split", part: 0, atParagraph: 4, role: "evidence" }]);
    expect(review.secondLooks).toEqual([{ part: 0, why: "contradicts-low", verdict: "review" }]);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(2);
    expect(provider.generateJsonText.mock.calls.filter(([args]) => isLook(args))).toHaveLength(1);

    for (const [look, verdict] of [[JSON.stringify({ verdict: "draft" }), "draft"], ["I cannot help with that.", "failed"]] as const) {
      structureReviewCache.clear();
      provider = providerOf(async (args) => (isLook(args) ? look : modelDouble(args.userPrompt)));
      mocks.resolveProvider.mockReturnValue(provider);
      const dropped = await reviewOf(await call());

      expect(dropped.corrections).toEqual([]);
      expect(dropped.secondLooks).toEqual([{ part: 0, why: "contradicts-low", verdict }]);
    }
  });

  // Re-aimed (P12-94): the part the model could not judge was part 3 of `FIVE` ("Further analysis", sure); a part the rules were sure of draws no look
  // for an unsure listing now, so it is part 0 of `LOW` (the unplaced opening, unsure): its paragraphs say method, mostly.
  it("looks again at a part the model could not judge, and a look that names another role changes it", async () => {
    provider = providerOf(async (args) => (isLook(args) ? modelDouble(args.userPrompt) : JSON.stringify({ corrections: [], unsure: [0] })));
    mocks.resolveProvider.mockReturnValue(provider);
    const review = await reviewOf(await call());

    expect(review.unsure).toEqual([0]);
    expect(review.secondLooks).toEqual([{ part: 0, why: "unsure", verdict: "review" }]);
    expect(review.corrections).toEqual([{ op: "set_role", part: 0, role: "method" }]);
  });

  it("asks no look for a part the model could not judge when the rules were sure of it, and changes nothing (P12-94)", async () => {
    // Part 1 is the results (`high`), part 3 the references (`high`).
    provider = providerOf(async (args) => (isLook(args) ? modelDouble(args.userPrompt) : JSON.stringify({ corrections: [], unsure: [1, 3] })));
    mocks.resolveProvider.mockReturnValue(provider);
    const review = await reviewOf(await call());

    expect(review.unsure).toEqual([1, 3]);
    expect(review.secondLooks).toEqual([]);
    expect(review.corrections).toEqual([]);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });
});

describe("POST /api/papers/[id]/structure — when the review fails the draft stands", () => {
  const unusable: Array<[string, string]> = [
    ["a part out of range", JSON.stringify({ corrections: [{ op: "set_role", part: 99, role: "method" }] })],
    ["an unknown role", JSON.stringify({ corrections: [{ op: "set_role", part: 1, role: "banana" }] })],
    ["an op outside the three", JSON.stringify({ corrections: [{ op: "delete", part: 1 }] })],
    ["sixty corrections and none valid", JSON.stringify({ corrections: Array.from({ length: 60 }, () => ({ op: "set_role", part: 99, role: "method" })) })],
    ["an empty object", "{}"],
    ["prose", "I cannot help with that."],
    ["an array", "[]"],
    ["nothing", ""],
  ];

  it.each(unusable)("answers fellBack unusable, with nothing remembered, for %s", async (_name, reply) => {
    provider = providerOf(async () => reply);
    mocks.resolveProvider.mockReturnValue(provider);
    const response = await call();

    expect(response.status).toBe(200);
    expect(await json(response)).toEqual({ fellBack: "unusable" });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    expect(structureReviewCache.size()).toBe(0);
  });

  it("applies the valid corrections of an answer that also holds refused ones", async () => {
    provider = providerOf(async (args) =>
      isLook(args) ? JSON.stringify({ verdict: "review" }) : JSON.stringify({ corrections: [{ op: "set_role", part: 99, role: "method" }, { op: "set_role", part: 0, role: "method" }] }),
    );
    mocks.resolveProvider.mockReturnValue(provider);

    // Re-aimed (P12-94): the valid correction was a role of part 3 of `FIVE` (sure); it is the role of part 0 of `LOW` (unsure).
    expect((await reviewOf(await call())).corrections).toEqual([{ op: "set_role", part: 0, role: "method" }]);
  });

  it("answers fellBack timeout after 30 seconds, with nothing remembered, and ignores a late answer", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    let late: (text: string) => void = () => {};
    provider = providerOf(() => new Promise<string>((resolve) => (late = resolve)));
    mocks.resolveProvider.mockReturnValue(provider);
    const pending = call();
    await vi.advanceTimersByTimeAsync(29_999);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const response = await pending;

    expect(await json(response)).toEqual({ fellBack: "timeout" });
    late(JSON.stringify({ corrections: [{ op: "set_role", part: 3, role: "evidence" }], unsure: [] }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(structureReviewCache.size()).toBe(0);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
  });

  it("answers fellBack provider_error when the provider throws or says nothing, and logs the error's name only", async () => {
    const consoleText = captureConsole();
    try {
      const failure = new Error("upstream said: Invented setup paragraph about tide pools was refused");
      failure.name = "UpstreamError";
      provider = providerOf(async () => {
        throw failure;
      });
      mocks.resolveProvider.mockReturnValue(provider);

      expect(await json(await call())).toEqual({ fellBack: "provider_error" });
      expect(consoleText.text()).toContain("UpstreamError");
      expect(consoleText.text()).not.toMatch(/Invented|tide pools|Zymurgy/);
      expect(structureReviewCache.size()).toBe(0);
    } finally {
      consoleText.restore();
    }
  });

  it("answers fellBack too_large, asking nothing, for a skeleton no mode can fit", async () => {
    const huge = inventedPaper([{ heading: "1 Introduction", canonical: "introduction", truth: [["setup", 1600]] }, { heading: "2 Methods", canonical: "methods", truth: [["method", 1600]] }]);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: huge.doc, attempts: [] });
    const response = await call();

    expect(await json(response)).toEqual({ fellBack: "too_large" });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  }, 30_000);

  it("drops a correction whose look could not answer in time, and keeps the draft's part", async () => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
    provider = providerOf((args) => (isLook(args) ? new Promise<string>(() => {}) : Promise.resolve(modelDouble(args.userPrompt))));
    mocks.resolveProvider.mockReturnValue(provider);
    const pending = call();
    await vi.advanceTimersByTimeAsync(20_000);
    const review = await reviewOf(await pending);

    expect(review.corrections).toEqual([]);
    expect(review.secondLooks.map((look) => look.verdict)).toEqual(["failed", "failed"]);
  });
});

describe("POST /api/papers/[id]/structure — the server's memory", () => {
  it("reviews a document once: the second ask is a hit, with no model call", async () => {
    const first = await json(await call());
    const calls = provider.generateJsonText.mock.calls.length;
    const second = await json(await call());

    expect(first.cached).toBe(false);
    expect(second.cached).toBe(true);
    expect(second.review).toEqual(first.review);
    expect(provider.generateJsonText).toHaveBeenCalledTimes(calls);
  });

  it("keys the memory by the document and the versions: another request body for the same text is a hit, another text is not", async () => {
    await call();
    const calls = provider.generateJsonText.mock.calls.length;
    await call({ paper: { ...paper, title: "Another title altogether" }, project: "x" });
    expect(provider.generateJsonText).toHaveBeenCalledTimes(calls);

    // Re-aimed (P12-94): another text whose review is kept, which the first five rows of `FIVE` are not any more (refused whole).
    const other = lowPaper(LOW_ROWS.slice(0, 2));
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: other.doc, attempts: [] });
    await call();
    expect(provider.generateJsonText.mock.calls.length).toBeGreaterThan(calls);
    expect(structureReviewCache.size()).toBe(2);
  });

  it("misses for an entry made under another version of the rules, the skeleton or the prompt", async () => {
    const docHash = explainDocHash(LOW.doc);
    const stale = { v: 1, docHash, rulesVersion: "old", skeletonVersion: "old", promptVersion: "old", draftDigest: lowDraft.digest, corrections: [], unsure: [], secondLooks: [], model: "x", reviewedAt: 0 } as StructureReviewEntry;
    for (const key of [structureReviewKey(docHash).replace(/rules:[^|]+/, "rules:old"), structureReviewKey(docHash).replace(/skel:[^|]+/, "skel:old"), structureReviewKey(docHash).replace(/prompt:.+$/, "prompt:old")]) {
      structureReviewCache.set(key, stale);
    }
    const body = await json(await call());

    expect(body.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalled();
  });

  it("counts a hit only for the draft it was made against: the same document under another abstract is asked again", async () => {
    const docHash = explainDocHash(LOW.doc);
    structureReviewCache.set(structureReviewKey(docHash), {
      v: 1,
      docHash,
      rulesVersion: STRUCTURE_RULES_VERSION,
      skeletonVersion: SKELETON_VERSION,
      promptVersion: REVIEW_PROMPT_VERSION,
      draftDigest: "0".repeat(14),
      corrections: [],
      unsure: [],
      secondLooks: [],
      model: "x",
      reviewedAt: 0,
    });
    const body = await json(await call());

    expect(body.cached).toBe(false);
    expect(provider.generateJsonText).toHaveBeenCalled();
    expect(structureReviewCache.get(structureReviewKey(docHash))?.draftDigest).toBe(lowDraft.digest);
  });

  it("holds the finished review only, under the document's key: indices, roles and the model's id, no word of the paper", async () => {
    await call();
    const entry = structureReviewCache.get(structureReviewKey(explainDocHash(LOW.doc)))!;

    expect(entry.model).toBe("gemini/large");
    expect(entry.docHash).toBe(explainDocHash(LOW.doc));
    expect(JSON.stringify(entry)).not.toMatch(/Invented|tide pools|Introduction|Methods|Results|Zymurgy|Further analysis/);
  });
});

describe("POST /api/papers/[id]/structure — when there is no review to make", () => {
  it("is 200 unavailable when no provider can write, and reads nothing", async () => {
    mocks.resolveProvider.mockReturnValue(null);
    const response = await call();

    expect(await json(response)).toEqual({ unavailable: true });
    expect(mocks.getFullText).not.toHaveBeenCalled();
    mocks.resolveProvider.mockReturnValue({ id: "gemini" });
    expect(await json(await call())).toEqual({ unavailable: true });
  });

  it("is 200 unavailable when the paper has no text or no sections, or fewer than two paragraphs", async () => {
    mocks.getFullText.mockResolvedValue({ status: "none", attempts: [] });
    expect(await json(await call())).toEqual({ unavailable: true });
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: { ...FIVE.doc, sections: [] }, attempts: [] });
    expect(await json(await call())).toEqual({ unavailable: true });
    const one = inventedPaper([{ heading: "1 Introduction", canonical: "introduction", truth: [["setup", 1]] }]);
    mocks.getFullText.mockResolvedValue({ status: "ok", doc: one.doc, attempts: [] });
    expect(await json(await call())).toEqual({ unavailable: true });
    expect(provider.generateJsonText).not.toHaveBeenCalled();
  });

  it("passes the reader's own key through to the registry, and nothing else; none when the request carries none", async () => {
    const llmOverride = { provider: "gemini", apiKey: "USER-NOT-A-KEY" };
    await call({ paper, llmOverride });
    expect(mocks.resolveProvider.mock.calls[0]).toEqual([llmOverride]);
    mocks.resolveProvider.mockClear();
    await call();
    expect(mocks.resolveProvider.mock.calls[0]).toEqual([null]);
  });

  it("reads a public paper's text by its own id, url and identifiers, and the attached upload's id when there is one", async () => {
    await call({ paper: { ...paper, doi: "10.1000/x", linkPaper: "https://example.org/p" } });
    expect(mocks.getFullText).toHaveBeenCalledWith({ paperId: paper.id, url: "https://example.org/p", doi: "10.1000/x", arxivId: "2610.00031", openAlexId: null });
  });
});

describe("POST /api/papers/[id]/structure — what it logs", () => {
  it("writes one debug line per review — counts and sizes — none for a hit, and no word of the paper", async () => {
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      await call();
      await call();
      const lines = debug.mock.calls.filter(([label]) => label === "[papers/structure] review");

      expect(lines).toHaveLength(1);
      const fields = lines[0][1] as Record<string, unknown>;
      expect(Object.keys(fields).sort()).toEqual(["answerChars", "corrections", "looks", "mode", "paragraphs", "parts", "promptChars", "refusedNumbers", "rejected"]);
      expect(fields).toMatchObject({ paragraphs: 20, parts: 4, mode: "A", corrections: 3, looks: 2, refusedNumbers: [] });
      expect(consoleText.text()).not.toMatch(/Invented|tide pools|kelp|Introduction|Methods|Results|Zymurgy|Further analysis/);
    } finally {
      consoleText.restore();
    }
  });
});

describe("POST /api/papers/[id]/structure — headers", () => {
  it("is never cached, whatever the answer is", async () => {
    const cases: Array<() => Promise<Response>> = [() => call(), () => call(), () => call("{bad"), () => call({ paper }, "arxiv:other")];
    for (const run of cases) expect((await run()).headers.get("cache-control")).toMatch(/no-store/);
    mocks.resolveProvider.mockReturnValue(null);
    expect((await call()).headers.get("cache-control")).toMatch(/no-store/);
  });
});
