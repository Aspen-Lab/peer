import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { structureReviewCache, type ReviewRole, type StructureDraft, type StructureInput } from "@/lib/papers/structure-review";
import { FIVE_PARTS, inventedPaper, modelDouble } from "@/test-support/structure-fixtures";
import { LOW_ABSTRACT_FIELDS, lowPaper } from "@/test-support/structure-fixtures-low";
import { captureConsole } from "@/test-support/console-capture";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// P12-86 (rule 2; ruling §1h.464): when the structure review falls back, the route's server log line says why, as
// counts only. Measured on the owner's papers: 11 of 30 runs fell back `unusable` (one paper five times in five,
// with identical reply sizes) and the log held only the prompt's and the reply's sizes, so a reply that was not an
// answer and an answer whose every correction was refused could not be told apart. The line now carries the cause
// (`not-json`, `all-refused`, `unsound`), how many corrections were read, how many were refused, and the refusals
// by op and by reason — numbers and names from closed sets, never a word of the reply, the paper or the reader's
// key. A file of its own: the `unsound` case needs the draft replaced, which the ordinary route tests do not.
// Every text below is invented.

const mocks = vi.hoisted(() => ({
  ownedUpload: vi.fn(),
  resolveProvider: vi.fn(),
  getFullText: vi.fn(),
  /** When set, the draft the route makes is passed through this (a draft no sound answer can mend). */
  draftOverride: null as null | ((draft: StructureDraft) => StructureDraft),
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
vi.mock("@/lib/papers/structure-review", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/papers/structure-review")>();
  return {
    ...actual,
    draftOf: (input: StructureInput) => {
      const made = actual.draftOf(input);
      return made && mocks.draftOverride ? mocks.draftOverride(made) : made;
    },
  };
});

import { POST } from "./route";

const FIVE = inventedPaper(FIVE_PARTS);
// A paper whose review is kept (P12-94): the draft of `FIVE` is wrong where the rules were sure, which a review cannot correct.
const LOW = lowPaper();

const paper = {
  id: "arxiv:2610.00033",
  title: "Zymurgy of the tide pools",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Peer Review",
  source: "arxiv" as const,
  summaryIntro: "A survey of the shore.",
  summaryExperimentKeywords: ["shore"],
  summaryResultDiscussion: "Counts of sites.",
  isSaved: false,
};

interface ModelArgs {
  systemPrompt: string;
  userPrompt: string;
  maxTokens: number;
  tier: string;
}
type Reply = (args: ModelArgs) => Promise<string>;

const KEY_SENTINEL = "USER-NOT-A-KEY-0123456789";
const UNUSABLE = "[papers/structure] unusable";
/** The keys of the line, sorted: the shape this file pins. */
const LINE_KEYS = ["answerChars", "cause", "promptChars", "read", "refusedByOp", "refusedByReason", "refusedNumbers", "rejected"];
/** The keys of one refused correction in `refusedNumbers`, sorted (P12-90). */
const NUMBER_KEYS = ["draftLength", "from", "op", "ordinal", "paragraphs", "part", "reason", "role", "to"];
/** The five-part invented paper below: six parts, twenty-nine paragraphs, the results part is 9 to 17. */
const FIVE_BOUNDS = { draftLength: 6, paragraphs: 29 };

function providerOf(reply: Reply) {
  return { id: "gemini", generateJsonText: vi.fn<Reply>(reply) };
}

function call(body: unknown = { paper }) {
  const req = new NextRequest(`http://localhost/api/papers/${encodeURIComponent(paper.id)}/structure`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return POST(req, { params: Promise.resolve({ id: encodeURIComponent(paper.id) }) });
}
const json = async (response: Response) => (await response.json()) as Record<string, unknown>;

let provider: ReturnType<typeof providerOf>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-28T12:00:00.000Z"));
  resetCounterStoreForTests();
  structureReviewCache.clear();
  vi.clearAllMocks();
  mocks.draftOverride = null;
  provider = providerOf(async () => "");
  mocks.ownedUpload.mockResolvedValue(null);
  mocks.resolveProvider.mockReturnValue(provider);
  mocks.getFullText.mockResolvedValue({ status: "ok", doc: FIVE.doc, attempts: [] });
});

afterEach(() => {
  mocks.draftOverride = null;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Ask once with this reply: the answer, the one `unusable` line (its fields) and everything the console was given. */
async function fellBackWith(reply: string, body: unknown = { paper }) {
  const consoleText = captureConsole();
  const debug = vi.spyOn(console, "debug");
  try {
    provider = providerOf(async () => reply);
    mocks.resolveProvider.mockReturnValue(provider);
    const response = await call(body);
    const lines = debug.mock.calls.filter(([label]) => label === UNUSABLE);
    return { response, answer: await json(response), lines, fields: (lines[0]?.[1] ?? {}) as Record<string, unknown>, text: consoleText.text() };
  } finally {
    consoleText.restore();
  }
}

describe("POST /api/papers/[id]/structure — what it logs when the review falls back", () => {
  it("says `not-json` for a reply that is not an object with a corrections array, with nothing read and nothing refused", async () => {
    const reply = "I looked at the Invented setup paragraph about tide pools and the Zymurgy of kelp, and I think the Methods are Results.";
    const { answer, lines, fields, text } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(lines).toHaveLength(1);
    expect(Object.keys(fields).sort()).toEqual(LINE_KEYS);
    expect(fields).toEqual({
      promptChars: expect.any(Number),
      answerChars: reply.length,
      cause: "not-json",
      read: 0,
      rejected: 0,
      refusedByOp: {},
      refusedByReason: {},
      refusedNumbers: [],
    });
    expect(structureReviewCache.size()).toBe(0);
    expect(text).not.toMatch(/Invented|tide pools|kelp|Zymurgy|Methods are Results|I looked at/);
  });

  it("says `not-json` for an object with no corrections array, and for nothing at all", async () => {
    for (const reply of ["{}", '{"corrections":"none"}', "[]", ""]) {
      const { fields } = await fellBackWith(reply);

      expect(fields).toMatchObject({ cause: "not-json", read: 0, rejected: 0, refusedByOp: {}, refusedByReason: {}, answerChars: reply.length });
    }
  });

  it("says `all-refused` for a reply whose every correction is out of range, with how many were read and refused, by op and by reason", async () => {
    const reply = JSON.stringify({
      corrections: [
        { op: "set_role", part: 99, role: "banana" },
        { op: "move_start", part: 42, toParagraph: 3 },
        { op: "split", part: 77, atParagraph: 5, role: "Invented evidence about tide pools" },
      ],
      unsure: [],
    });
    const { answer, lines, fields, text } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(lines).toHaveLength(1);
    expect(Object.keys(fields).sort()).toEqual(LINE_KEYS);
    expect(fields).toEqual({
      promptChars: expect.any(Number),
      answerChars: reply.length,
      cause: "all-refused",
      read: 3,
      rejected: 3,
      refusedByOp: { set_role: 1, move_start: 1, split: 1 },
      refusedByReason: { "out-of-range": 3 },
      refusedNumbers: [
        { op: "set_role", reason: "out-of-range", part: 99, ordinal: null, role: null, ...FIVE_BOUNDS, from: null, to: null },
        { op: "move_start", reason: "out-of-range", part: 42, ordinal: 3, role: null, ...FIVE_BOUNDS, from: null, to: null },
        { op: "split", reason: "out-of-range", part: 77, ordinal: 5, role: null, ...FIVE_BOUNDS, from: null, to: null },
      ],
    });
    expect(structureReviewCache.size()).toBe(0);
    expect(text).not.toMatch(/banana|Invented|tide pools|Zymurgy/);
  });

  it("says `all-refused` with the guard's own reason when the only correction gives the role setup to a part after the opening", async () => {
    const reply = JSON.stringify({ corrections: [{ op: "set_role", part: 3, role: "setup" }], unsure: [] });
    const { fields } = await fellBackWith(reply);

    expect(fields).toMatchObject({ cause: "all-refused", read: 1, rejected: 1, refusedByOp: { set_role: 1 }, refusedByReason: { "setup-after-opening": 1 } });
  });

  it("says `all-refused` with the pieces' reason when the only corrections are two splits one paragraph apart in one part (P12-90)", async () => {
    // The measured damage: "method" at 11 and "evidence" at 12 inside the first results part (here 9 to 17).
    const reply = JSON.stringify({
      corrections: [
        { op: "split", part: 2, atParagraph: 11, role: "method" },
        { op: "split", part: 2, atParagraph: 12, role: "evidence" },
      ],
      unsure: [],
    });
    const { answer, fields } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(fields).toMatchObject({ cause: "all-refused", read: 2, rejected: 2, refusedByOp: { split: 2 }, refusedByReason: { "piece-too-short": 2 } });
    expect(structureReviewCache.size()).toBe(0);
  });

  it("names the number that was out of range: a split two paragraphs past its part logs its op, part, ordinal, role and the bounds it was judged against (P12-90)", async () => {
    // One correction read, one refused as out of range, a split. The results part is 9 to 17. (One paragraph past, 18,
    // was this test's ordinal until P12-91: that split is the next part's own start, a cut the draft already has, and
    // is no correction; two past is still out of range.)
    const reply = JSON.stringify({ corrections: [{ op: "split", part: 2, atParagraph: 19, role: "method" }], unsure: [] });
    const { answer, lines, fields, text } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(lines).toHaveLength(1);
    expect(Object.keys(fields).sort()).toEqual(LINE_KEYS);
    expect(fields).toEqual({
      promptChars: expect.any(Number),
      answerChars: reply.length,
      cause: "all-refused",
      read: 1,
      rejected: 1,
      refusedByOp: { split: 1 },
      refusedByReason: { "out-of-range": 1 },
      refusedNumbers: [{ op: "split", reason: "out-of-range", part: 2, ordinal: 19, role: "method", ...FIVE_BOUNDS, from: 9, to: 17 }],
    });
    expect(Object.keys((fields.refusedNumbers as Array<Record<string, unknown>>)[0]).sort()).toEqual(NUMBER_KEYS);
    expect(text).not.toMatch(/Invented|tide pools|kelp|Zymurgy/);
  });

  it("is no fallback when the only correction is a split at the next part's start, or at the part's own first paragraph (P12-91): reviewed, nothing corrected, no look", async () => {
    // P4's shape: every reply was one split of a part at the paragraph the next part already starts at, refused as out of
    // range, and the review fell back `all-refused`. The results part here is 9 to 17; 18 is the next part's start.
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      for (const atParagraph of [18, 9]) {
        structureReviewCache.clear();
        debug.mockClear();
        provider = providerOf(async () => JSON.stringify({ corrections: [{ op: "split", part: 2, atParagraph, role: "interpretation" }], unsure: [] }));
        mocks.resolveProvider.mockReturnValue(provider);
        const body = await json(await call());

        expect(body.cached).toBe(false);
        expect(body.fellBack).toBeUndefined();
        expect(body.review).toMatchObject({ corrections: [], unsure: [], secondLooks: [] });
        expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
        expect(structureReviewCache.size()).toBe(1);
        expect(debug.mock.calls.filter(([label]) => label === UNUSABLE)).toHaveLength(0);
        const fields = debug.mock.calls.find(([label]) => label === "[papers/structure] review")![1] as Record<string, unknown>;
        expect(fields).toMatchObject({ corrections: 0, rejected: 0, refusedNumbers: [], looks: 0 });
      }
      // One paragraph further out is still a fallback, named by its numbers.
      structureReviewCache.clear();
      debug.mockClear();
      provider = providerOf(async () => JSON.stringify({ corrections: [{ op: "split", part: 2, atParagraph: 19, role: "interpretation" }], unsure: [] }));
      mocks.resolveProvider.mockReturnValue(provider);
      expect(await json(await call())).toEqual({ fellBack: "unusable" });
      expect(debug.mock.calls.filter(([label]) => label === UNUSABLE)).toHaveLength(1);
    } finally {
      consoleText.restore();
    }
  });

  it("names the numbers of the pair of splits that were refused for their piece, with the room of the part (P12-90)", async () => {
    const reply = JSON.stringify({ corrections: [{ op: "split", part: 2, atParagraph: 11, role: "method" }, { op: "split", part: 2, atParagraph: 12, role: "evidence" }] });
    const { fields } = await fellBackWith(reply);

    expect(fields.refusedNumbers).toEqual([
      { op: "split", reason: "piece-too-short", part: 2, ordinal: 11, role: "method", ...FIVE_BOUNDS, from: 9, to: 17 },
      { op: "split", reason: "piece-too-short", part: 2, ordinal: 12, role: "evidence", ...FIVE_BOUNDS, from: 9, to: 17 },
    ]);
  });

  it("names at most eight refused corrections, and writes no word of the reply, the paper or the reader's key among them", async () => {
    const words = "Invented prose about tide pools and Zymurgy of kelp";
    const reply = JSON.stringify({
      corrections: [
        ...Array.from({ length: 6 }, (_, k) => ({ op: "set_role", part: 50 + k, role: "method" })),
        { op: words, part: words, toParagraph: words, role: words },
        { op: "split", part: 2, atParagraph: words, role: words },
        { op: "split", part: 2, atParagraph: 99, role: words },
        { op: "move_start", part: 77, toParagraph: 4 },
      ],
    });
    const { fields, text } = await fellBackWith(reply, { paper, llmOverride: { provider: "gemini", apiKey: KEY_SENTINEL } });
    const named = fields.refusedNumbers as Array<Record<string, unknown>>;

    expect(fields).toMatchObject({ cause: "all-refused", read: 10, rejected: 10 });
    expect(named).toHaveLength(8);
    expect(named.map((entry) => entry.part)).toEqual([50, 51, 52, 53, 54, 55, null, 2]);
    for (const entry of named) expect(Object.keys(entry).sort()).toEqual(NUMBER_KEYS);
    expect(text).not.toMatch(/Invented|prose|tide pools|kelp|Zymurgy/);
    expect(text).not.toContain(KEY_SENTINEL);
  });

  it("counts a mixed reply by op and by reason, and keeps the words of an op the reply invented out of the line", async () => {
    const reply = JSON.stringify({
      corrections: [
        { op: "delete", part: 1 },
        "not an object",
        { op: "set_role", part: 1, role: "method" },
        { op: "move_start", part: 0, toParagraph: 2 },
        { op: "split", part: 2, atParagraph: 19, role: "method" },
        { op: "split", part: 5, atParagraph: 27, role: "setup" },
      ],
    });
    const { fields, text } = await fellBackWith(reply);

    expect(fields).toMatchObject({
      cause: "all-refused",
      read: 6,
      rejected: 6,
      refusedByOp: { other: 2, set_role: 1, move_start: 1, split: 2 },
      refusedByReason: { malformed: 2, "same-role": 1, "part-0": 1, "out-of-range": 1, "setup-after-opening": 1 },
    });
    expect(text).not.toMatch(/delete|not an object/);
  });

  it("says `all-refused` with `confident-draft` when the only corrections are against parts the rules were sure of, and names them by their numbers (P12-94)", async () => {
    // Part 1 is the methods (`high`), part 3 "Further analysis" (`high`, bucketed as methods), part 2 the results (`high`, 9 to 17).
    const reply = JSON.stringify({
      corrections: [
        { op: "set_role", part: 3, role: "evidence" },
        { op: "move_start", part: 2, toParagraph: 11 },
        { op: "split", part: 2, atParagraph: 14, role: "interpretation" },
      ],
      unsure: [],
    });
    const { answer, lines, fields, text } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(lines).toHaveLength(1);
    expect(Object.keys(fields).sort()).toEqual(LINE_KEYS);
    expect(fields).toEqual({
      promptChars: expect.any(Number),
      answerChars: reply.length,
      cause: "all-refused",
      read: 3,
      rejected: 3,
      refusedByOp: { set_role: 1, move_start: 1, split: 1 },
      refusedByReason: { "confident-draft": 3 },
      refusedNumbers: [
        { op: "set_role", reason: "confident-draft", part: 3, ordinal: null, role: "evidence", ...FIVE_BOUNDS, from: 18, to: 21 },
        { op: "move_start", reason: "confident-draft", part: 2, ordinal: 11, role: null, ...FIVE_BOUNDS, from: 9, to: 17 },
        { op: "split", reason: "confident-draft", part: 2, ordinal: 14, role: "interpretation", ...FIVE_BOUNDS, from: 9, to: 17 },
      ],
    });
    expect(structureReviewCache.size()).toBe(0);
    expect(text).not.toMatch(/Invented|tide pools|kelp|Zymurgy/);
  });

  it("refuses the double's own review of the five-part paper, whose draft is wrong where the rules were sure: `unusable`, both corrections `confident-draft` (P12-94)", async () => {
    // Before P12-94 these were the canonical fix (a move of the results part's start and a role of the fourth part, each with a look).
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      provider = providerOf(async (args) => modelDouble(args.userPrompt));
      mocks.resolveProvider.mockReturnValue(provider);
      const body = await json(await call());
      const fields = debug.mock.calls.find(([label]) => label === UNUSABLE)![1] as Record<string, unknown>;

      expect(body).toEqual({ fellBack: "unusable" });
      expect(fields).toMatchObject({ cause: "all-refused", read: 2, rejected: 2, refusedByReason: { "confident-draft": 2 } });
      expect((fields.refusedNumbers as Array<Record<string, unknown>>).map((entry) => [entry.op, entry.part])).toEqual([["move_start", 2], ["set_role", 3]]);
      // No look was asked: the one call is the review's.
      expect(provider.generateJsonText).toHaveBeenCalledTimes(1);
      expect(structureReviewCache.size()).toBe(0);
    } finally {
      consoleText.restore();
    }
  });

  it("says `unsound` when what the corrections made is not a sound structure, with what was read and refused", async () => {
    // A draft with a part whose role is outside the five, which the rules never make: the net under the other two. (Re-aimed, P12-94: every
    // part is made `low` as well, as a correction of a part the rules were sure of would be refused before the structure was built.)
    mocks.draftOverride = (made) => ({ ...made, parts: made.parts.map((part, k) => ({ ...part, conf: "low" as const, ...(k === 0 ? { role: "body" as ReviewRole } : {}) })) });
    const reply = JSON.stringify({ corrections: [{ op: "set_role", part: 3, role: "evidence" }, { op: "set_role", part: 99, role: "method" }], unsure: [] });
    const { answer, lines, fields } = await fellBackWith(reply);

    expect(answer).toEqual({ fellBack: "unusable" });
    expect(lines).toHaveLength(1);
    expect(fields).toEqual({
      promptChars: expect.any(Number),
      answerChars: reply.length,
      cause: "unsound",
      read: 2,
      rejected: 1,
      refusedByOp: { set_role: 1 },
      refusedByReason: { "out-of-range": 1 },
      refusedNumbers: [{ op: "set_role", reason: "out-of-range", part: 99, ordinal: null, role: "method", ...FIVE_BOUNDS, from: null, to: null }],
    });
    expect(structureReviewCache.size()).toBe(0);
  });

  it("writes no key, no title and no word of the paper to the line, whatever the reader sent", async () => {
    const reply = "Zymurgy tide pools kelp";
    const { fields, text } = await fellBackWith(reply, { paper, project: "PROFILE-SENTINEL", llmOverride: { provider: "gemini", apiKey: KEY_SENTINEL } });

    expect(fields).toMatchObject({ cause: "not-json" });
    expect(text).not.toContain(KEY_SENTINEL);
    expect(text).not.toMatch(/PROFILE-SENTINEL|Zymurgy|tide pools|kelp|Introduction|Further analysis/);
  });

  it("writes no `unusable` line for a review that is used, nor for a provider that failed", async () => {
    const consoleText = captureConsole();
    const debug = vi.spyOn(console, "debug");
    try {
      // Re-aimed (P12-94): the paper is `LOW` (wrong where the rules were unsure); the review of `FIVE` is refused whole, and that is an `unusable` line.
      mocks.getFullText.mockResolvedValue({ status: "ok", doc: LOW.doc, attempts: [] });
      provider = providerOf(async (args) => modelDouble(args.userPrompt));
      mocks.resolveProvider.mockReturnValue(provider);
      expect((await json(await call({ paper: { ...paper, ...LOW_ABSTRACT_FIELDS } }))).review).toBeTruthy();
      structureReviewCache.clear();
      provider = providerOf(async () => {
        throw new Error("upstream said no");
      });
      mocks.resolveProvider.mockReturnValue(provider);
      expect(await json(await call())).toEqual({ fellBack: "provider_error" });

      expect(debug.mock.calls.filter(([label]) => label === UNUSABLE)).toHaveLength(0);
    } finally {
      consoleText.restore();
    }
  });
});
