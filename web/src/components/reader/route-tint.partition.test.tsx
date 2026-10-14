import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { buildReading } from "@/lib/papers/reading";
import { routeByQuestions, type ReadingMap } from "@/lib/papers/reading-map";
import { partitionedMap, withPartitionMarks, type GuidePartition } from "@/lib/papers/reading-partition";
import type { Paper } from "@/types";
import { PaperBody, mergeQuestionRoute, questionRouteOverlay, sectionMark } from "./paper-body";
import { ReadingMapView, readingRoute } from "./reading-map";

// P10-07b (B P10-05 §4; rubric A9, A11): the tiers over an unheaded paper's partition. The unit
// scored is the paragraph inside the real trunk section; a group row's mark is derived from the
// grades of the paragraphs inside it, so the map's rows and the body never disagree on a
// paragraph, and a question that lives in one part leaves the others unmarked. The body reads the
// trunk's own id and does not change by a byte. Every text is invented ("a survey of shore ecology").

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const invented = (k: number): string => {
  const topic = TOPICS[k % TOPICS.length];
  return `Invented paragraph ${k} about ${topic}. The survey counted ${10 + k} sites near the ${topic}. Nothing here is quoted from a paper.`;
};
const PAPER: Paper = {
  id: "upload:00000000000000dd", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const NOW = new Date("2026-10-05T00:00:00.000Z");
const asReading = (doc: ExtractedDocument) =>
  buildReading(PAPER, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } } as FullTextResult, NOW);
function unheadedReading(over: Record<number, string> = {}) {
  return asReading({
    source: "pdf",
    pageCount: 6,
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "A survey of shore ecology", canonical: "body", page: 1, text: Array.from({ length: 30 }, (_, k) => over[k] ?? invented(k)).join("\n\n") },
      { id: "s1", heading: "Methods", canonical: "methods", page: 4, text: Array.from({ length: 4 }, (_, k) => invented(100 + k)).join("\n\n") },
    ],
  });
}
const FOUR: GuidePartition = {
  sectionId: "s0",
  parts: [
    { role: "introduction", fromParagraph: 0, toParagraph: 5 },
    { role: "results", fromParagraph: 6, toParagraph: 19 },
    { role: "discussion", fromParagraph: 20, toParagraph: 26 },
    { role: "conclusion", fromParagraph: 27, toParagraph: 29 },
  ],
};
const GROUPS = ["s0~0", "s0~1", "s0~2", "s0~3"];
const QUESTION = "How does the quillwort lattice crack?";
const HIT = "The quillwort lattice shows cracks. The quillwort lattice was measured on the sand ripples.";

describe("the tiers over a partition (A9, A11)", () => {
  it("a term in one paragraph: exactly one group is strong, the others carry no mark", () => {
    const reading = unheadedReading({ 12: HIT });
    const route = routeByQuestions(reading.map!, reading.body, [QUESTION]);
    const folded = withPartitionMarks(route, reading.map!, reading.body, FOUR);

    expect(GROUPS.map((id) => sectionMark(folded, id)?.tier ?? null)).toEqual([null, "strong", null, null]);
    expect(sectionMark(folded, "s0~1")?.paragraphs.get(12)).toBe("strong");
  });

  it("a term in a paragraph of every part: at most floor(N / 2) groups strong, the rest relevant; a third of the rows or more are faint or none", () => {
    const reading = unheadedReading({ 2: HIT, 10: HIT, 22: HIT, 28: HIT });
    const route = routeByQuestions(reading.map!, reading.body, [QUESTION]);
    const marks = GROUPS.map((id) => sectionMark(withPartitionMarks(route, reading.map!, reading.body, FOUR), id)?.tier);

    expect(marks.filter((tier) => tier === "strong")).toHaveLength(2);
    expect(marks).toEqual(["strong", "strong", "medium", "medium"]);
  });

  it("a term in some paragraphs of several parts: graded strong, faint, none — three ordered greens, never all alike", () => {
    const reading = unheadedReading({ 3: "Invented paragraph 3 about the quillwort. A single note names it once and moves on.", 12: HIT, 24: "Invented paragraph 24 about the lattice. It is named once and left." });
    const route = routeByQuestions(reading.map!, reading.body, [QUESTION]);
    const tiers = GROUPS.map((id) => sectionMark(withPartitionMarks(route, reading.map!, reading.body, FOUR), id)?.tier ?? "none");

    expect(tiers).toEqual(["faint", "strong", "faint", "none"]);
  });

  it("the gist: the group's tier is its role's, the cap not applied (the gist names no paragraph)", () => {
    const reading = unheadedReading();
    const route = readingRoute(reading, { items: [], gist: true })!;
    const tiers = GROUPS.map((id) => sectionMark(withPartitionMarks(route, reading.map!, reading.body, FOUR), id)?.tier);

    expect(tiers).toEqual(["faint", "strong", "strong", "strong"]);
  });
});

describe("the map's rows and the body never disagree on a paragraph (B §4)", () => {
  const reading = unheadedReading({
    3: "Invented paragraph 3 about the quillwort. A single note names it once and moves on.",
    12: HIT,
    13: "Invented paragraph 13 about the lattice. It is named once and left.",
    24: "Invented paragraph 24 about the lattice. It is named once and left.",
  });
  const route = routeByQuestions(reading.map!, reading.body, [QUESTION]);
  const folded = withPartitionMarks(route, reading.map!, reading.body, FOUR);

  it("gives every paragraph in a group the grade the body gives it under the trunk's id", () => {
    const body = sectionMark(folded, "s0")!;

    FOUR.parts.forEach((part, n) => {
      const group = sectionMark(folded, GROUPS[n]);
      for (let i = part.fromParagraph; i <= part.toParagraph; i += 1) expect(group?.paragraphs.get(i), `paragraph ${i}`).toBe(body.paragraphs.get(i));
    });
    expect(body.paragraphs.get(12)).toBe("strong");
    expect(body.paragraphs.get(13)).toBe("faint");
  });

  it("draws the same tints on the map's lines", () => {
    const over = partitionedMap(reading.map!, reading.body, FOUR);
    const html = renderToStaticMarkup(createElement(ReadingMapView, { map: over, route: folded, openRows: [0, 1, 2, 3] }));
    const tierOfLine = (anchor: string) => new RegExp(`<a href="#${anchor}" data-route="(\\w+)"`).exec(html)?.[1];

    expect(tierOfLine("paper-section-0-p12")).toBe("strong");
    expect(tierOfLine("paper-section-0-p13")).toBe("faint");
    expect(tierOfLine("paper-section-0-p24")).toBe("faint");
    expect(tierOfLine("paper-section-0-p14")).toBeUndefined();
  });
});

describe("the body is untouched (option A, §1h.79 (c))", () => {
  const reading = unheadedReading({ 12: HIT });
  const route = routeByQuestions(reading.map!, reading.body, [QUESTION]);
  const folded = withPartitionMarks(route, reading.map!, reading.body, FOUR);
  const body = (r: Parameters<typeof PaperBody>[0]["route"]) => renderToStaticMarkup(createElement(PaperBody, { reading, route: r }));

  it("renders the body's markup byte for byte with and without the group marks", () => {
    expect(body(folded)).toBe(body(route));
  });

  it("puts no heading, no marker and no group id in the body", () => {
    const html = body(folded);

    expect(html).not.toContain("Peer&#x27;s reading");
    expect(html).not.toContain("s0~");
    expect(html).toContain("A survey of shore ecology");
    expect(html).toContain('id="paper-section-0-p12"');
    expect(html).not.toContain('id="paper-section-0~');
  });

  it("reads every real section's mark as it was", () => {
    for (const section of reading.body) expect(sectionMark(folded, section.id)).toEqual(sectionMark(route, section.id));
  });

  it("is the same with a model's overlay merged under the fold as before it", () => {
    const overlay = questionRouteOverlay([{ question: QUESTION, answers: [{ sectionId: "s1", evidence: "Twelve samples were cut.", quote: "x" } as never], readNext: [] } as never]);
    const merged = mergeQuestionRoute(route, overlay);
    const mergedFolded = withPartitionMarks(merged, reading.map!, reading.body, FOUR);

    expect(body(mergedFolded)).toBe(body(merged));
  });
});

describe("nothing else changes: a headed paper (rule 6)", () => {
  const section = (id: string, heading: string, canonical: string, base: number) => ({
    id, heading, canonical, page: 1 + base, text: Array.from({ length: 12 }, (_, k) => invented(base + k)).join("\n\n"),
  });
  const headed = asReading({
    source: "pdf",
    pageCount: 6,
    figureCaptions: [],
    sections: [section("s0", "1 Introduction", "introduction", 0), section("s1", "2 Methods", "methods", 40), section("s2", "3 Results", "results", 80)],
  });
  const route = routeByQuestions(headed.map!, headed.body, [QUESTION]);
  const stale: GuidePartition = { sectionId: "s0", parts: [{ role: "introduction", fromParagraph: 0, toParagraph: 4 }, { role: "results", fromParagraph: 5, toParagraph: 11 }] };

  it("returns the map and the route as the same objects with no partition, and for a stale one the rule does not read as unheaded", () => {
    expect(partitionedMap(headed.map!, headed.body, undefined)).toBe(headed.map);
    expect(withPartitionMarks(route, headed.map!, headed.body, undefined)).toBe(route);
    expect(partitionedMap(headed.map!, headed.body, stale)).toBe(headed.map);
    expect(withPartitionMarks(route, headed.map!, headed.body, stale)).toBe(route);
  });

  it("draws the same map markup and the same body markup", () => {
    const html = (m: ReadingMap | undefined, r: typeof route | undefined) => renderToStaticMarkup(createElement(ReadingMapView, { map: m!, route: r, openRows: [0, 1] }));
    const body = (r: typeof route | undefined) => renderToStaticMarkup(createElement(PaperBody, { reading: headed, route: r }));

    expect(html(partitionedMap(headed.map!, headed.body, stale), withPartitionMarks(route, headed.map!, headed.body, stale))).toBe(html(headed.map, route));
    expect(body(withPartitionMarks(route, headed.map!, headed.body, stale))).toBe(body(route));
  });
});
