import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";
import { withSectionIds, type DraftSection, type ExtractedDocument } from "./html-text";
import type { FullTextResult } from "./full-text";
import { buildReading } from "./reading";
import { ROUTE_CACHE_LIMIT, buildReadingMap, routeByQuestions, routeByQuestionsCached } from "./reading-map";
import { splitSentences } from "./skim";
import zenodoDocJson from "./__fixtures__/zenodo-W7208807247.doc.json";

// P7-13 (R11b, the owner's R11): typing one question of five recomputed all five routes —
// `routeByQuestions` canonicalises every section, paragraph and sentence of the body once per
// question — 98-116 ms on a paper of the owner's size (P7-02 §9(b)). `routeByQuestionsCached`
// keeps each question's route, keyed by (the body array, the question text), so a keystroke
// recomputes the one route that changed. `routeByQuestions` itself stays the pure, uncached
// function (its own tests: reading-map.test.ts). `splitSentences` runs once per paragraph per
// question, so counting its calls counts the work.

vi.mock("./skim", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./skim")>();
  return { ...actual, splitSentences: vi.fn(actual.splitSentences) };
});

const paper: Paper = {
  id: "openalex:W1",
  title: "A Paper",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
};

function withIds(json: unknown): ExtractedDocument {
  const doc = json as Omit<ExtractedDocument, "sections"> & { sections: DraftSection[] };
  return { ...doc, sections: withSectionIds(doc.sections) };
}
const fullText = (doc: ExtractedDocument): FullTextResult => ({
  status: "ok",
  doc,
  sourceLink: { url: "https://example.org/paper", kind: "html", label: "doi", rank: 1 },
  attempts: [],
});

const doc = withIds(zenodoDocJson);
const map = buildReadingMap(doc);
const body = () => buildReading(paper, fullText(doc)).body;

const FIVE = [
  "graph embeddings protein structure",
  "protein folding prediction accuracy",
  "structure similarity benchmark datasets",
  "training embeddings neural network",
  "What is it?", // vague: fewer than two specific terms
];
const splits = () => vi.mocked(splitSentences).mock.calls.length;
beforeEach(() => {
  vi.mocked(splitSentences).mockClear();
});

describe("routeByQuestionsCached — the same answer as routeByQuestions", () => {
  it("equals the uncached result for any list of questions, vague ones, none, and the order they come in", () => {
    const sections = body();
    for (const questions of [FIVE, [], ["LCO?"], [...FIVE].reverse(), [FIVE[0], FIVE[0].toUpperCase()]]) {
      expect(routeByQuestionsCached(map, sections, questions)).toEqual(routeByQuestions(map, sections, questions));
    }
  });

  it("keeps the verdict across the list: vague only when every question is", () => {
    const sections = body();

    expect(routeByQuestionsCached(map, sections, ["What is it?", "Why?"]).vague).toBe(true);
    expect(routeByQuestionsCached(map, sections, ["What is it?", FIVE[0]]).vague).toBe(false);
    expect(routeByQuestionsCached(map, sections, [])).toEqual({ byQuestion: [], vague: false });
  });

  it("changes nothing it is given", () => {
    const sections = body();
    const before = JSON.stringify([map, sections, FIVE]);

    routeByQuestionsCached(map, sections, FIVE);
    routeByQuestionsCached(map, sections, FIVE);

    expect(JSON.stringify([map, sections, FIVE])).toBe(before);
  });
});

describe("routeByQuestionsCached — a hit returns the same object, a changed question misses", () => {
  it("a repeated question over the same body is the same entry, not a copy", () => {
    const sections = body();
    const first = routeByQuestionsCached(map, sections, FIVE);
    const second = routeByQuestionsCached(map, sections, FIVE);

    expect(second).not.toBe(first); // the list is built afresh…
    second.byQuestion.forEach((entry, i) => expect(entry).toBe(first.byQuestion[i])); // …from the same entries
  });

  it("a repeat does no routing at all", () => {
    const sections = body();
    vi.mocked(splitSentences).mockClear();
    routeByQuestionsCached(map, sections, FIVE);
    const worked = splits();
    expect(worked).toBeGreaterThan(0);

    routeByQuestionsCached(map, sections, FIVE);

    expect(splits()).toBe(worked);
  });

  it("typing in the fifth question recomputes the fifth only: four entries are the same objects, one is new", () => {
    const sections = body();
    const four = FIVE.slice(0, 4);
    const typing = ["protein embeddings accuracy", "protein embeddings accuracy similarity"];
    const before = routeByQuestionsCached(map, sections, [...four, typing[0]]);
    vi.mocked(splitSentences).mockClear();

    const after = routeByQuestionsCached(map, sections, [...four, typing[1]]);

    four.forEach((_, i) => expect(after.byQuestion[i]).toBe(before.byQuestion[i]));
    expect(after.byQuestion[4]).not.toBe(before.byQuestion[4]);
    expect(after.byQuestion[4].question).toBe(typing[1]);
    // One question's work, not five's: the same as routing that question alone.
    const forOne = splits();
    expect(forOne).toBeGreaterThan(0);
    vi.mocked(splitSentences).mockClear();
    routeByQuestions(map, sections, [typing[1]]);
    expect(forOne).toBe(splits());
    expect(after).toEqual(routeByQuestions(map, sections, [...four, typing[1]]));
  });

  it("a question typed one character at a time is a miss each time, and a return to an earlier text is a hit", () => {
    const sections = body();
    const text = "graph embeddings protein structure";
    const seen = new Map<string, unknown>();
    for (let n = 6; n <= text.length; n += 4) {
      const entry = routeByQuestionsCached(map, sections, [text.slice(0, n)]).byQuestion[0];
      seen.set(text.slice(0, n), entry);
    }
    vi.mocked(splitSentences).mockClear();

    const back = routeByQuestionsCached(map, sections, [text.slice(0, 10)]).byQuestion[0];

    expect(back).toBe(seen.get(text.slice(0, 10)));
    expect(splits()).toBe(0);
  });

  it("the same text over another body array is a miss, even when the content is equal", () => {
    const one = body();
    const other = body();
    expect(other).not.toBe(one);
    expect(other).toEqual(one);

    const first = routeByQuestionsCached(map, one, [FIVE[0]]);
    const second = routeByQuestionsCached(map, other, [FIVE[0]]);

    expect(second.byQuestion[0]).not.toBe(first.byQuestion[0]);
    expect(second).toEqual(first);
  });

  it("the same text and body under another map is a miss", () => {
    const sections = body();
    const otherMap = buildReadingMap(doc);
    const first = routeByQuestionsCached(map, sections, [FIVE[0]]);
    const second = routeByQuestionsCached(otherMap, sections, [FIVE[0]]);

    expect(second.byQuestion[0]).not.toBe(first.byQuestion[0]);
    expect(second).toEqual(first);
  });

  it("a question differing only in case or spaces is a different key (the text is what was typed)", () => {
    const sections = body();
    const first = routeByQuestionsCached(map, sections, [FIVE[0]]).byQuestion[0];
    const second = routeByQuestionsCached(map, sections, [` ${FIVE[0]}`]).byQuestion[0];

    expect(second).not.toBe(first);
    expect(second.question).toBe(` ${FIVE[0]}`);
  });
});

describe("routeByQuestionsCached — a small cache", () => {
  const typed = (n: number) => `graph embeddings protein structure variant${n} cathode`;

  it("holds a bounded number of questions per body, the least recently used leaving first", () => {
    const sections = body();
    const first = routeByQuestionsCached(map, sections, [typed(0)]).byQuestion[0];
    const second = routeByQuestionsCached(map, sections, [typed(1)]).byQuestion[0];
    for (let n = 2; n < ROUTE_CACHE_LIMIT; n++) routeByQuestionsCached(map, sections, [typed(n)]);

    // Full, nothing gone yet. Touching the first makes the second the oldest.
    expect(routeByQuestionsCached(map, sections, [typed(0)]).byQuestion[0]).toBe(first);
    routeByQuestionsCached(map, sections, [typed(ROUTE_CACHE_LIMIT)]);

    expect(routeByQuestionsCached(map, sections, [typed(0)]).byQuestion[0]).toBe(first);
    expect(routeByQuestionsCached(map, sections, [typed(1)]).byQuestion[0]).not.toBe(second);
  });

  it("is larger than a box of questions typed over a minute: five questions of sixty characters stay", () => {
    expect(ROUTE_CACHE_LIMIT).toBeGreaterThanOrEqual(5 * 4);
  });

  it("is per body: another paper's questions never push this one's out", () => {
    const sections = body();
    const mine = routeByQuestionsCached(map, sections, [typed(0)]).byQuestion[0];
    const elsewhere = body();
    for (let n = 0; n < ROUTE_CACHE_LIMIT * 3; n++) routeByQuestionsCached(map, elsewhere, [typed(n)]);

    expect(routeByQuestionsCached(map, sections, [typed(0)]).byQuestion[0]).toBe(mine);
  });
});

describe("routeByQuestions itself stays pure and uncached", () => {
  it("two calls give equal results made of different objects, and routing is done each time", () => {
    const sections = body();
    vi.mocked(splitSentences).mockClear();
    const first = routeByQuestions(map, sections, FIVE);
    const worked = splits();
    expect(worked).toBeGreaterThan(0);
    const second = routeByQuestions(map, sections, FIVE);

    expect(second).toEqual(first);
    first.byQuestion.forEach((entry, i) => expect(second.byQuestion[i]).not.toBe(entry));
    expect(splits()).toBe(worked * 2);
  });

  it("is not filled by, and does not read, the cache", () => {
    const sections = body();
    const cached = routeByQuestionsCached(map, sections, FIVE);
    const plain = routeByQuestions(map, sections, FIVE);

    plain.byQuestion.forEach((entry, i) => expect(entry).not.toBe(cached.byQuestion[i]));
  });
});
