import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PaperReport } from "@/lib/papers/report";
import { groupTotals, type ReadingMap } from "@/lib/papers/reading-map";
import { SectionLinks } from "./evidence-quote";
import { ForYourQuestions, readNextLabel } from "./for-your-questions";

// P10-11 rule 1 (the walk's X-A2): a Read-next line that names a GROUP row — "2. RESULTS AND DISCUSSION", a numbered heading
// with no text of its own — said "0 min", while the map's row for it shows what its children add up to. The line now
// takes the same number the map takes (`groupTotals`: the summed words, not the sum of the rounded minutes).
const NB = " ";

// 200 + 200 words: each child is 2 min on its own (180 words a minute), the two together are 400 / 180 → 3 min, not
// the 4 that the rounded children would add to.
const map: ReadingMap = {
  sections: [
    { id: "s1", heading: "1. INTRODUCTION", canonical: "introduction", role: "setup", page: 2, words: 200, minutes: 2, paragraphs: [], level: 1 },
    { id: "g2", heading: "2. RESULTS AND DISCUSSION", canonical: "body", role: "body", page: 3, words: 0, minutes: 0, paragraphs: [], level: 1 },
    { id: "s21", heading: "2.1 Capacity", canonical: "results", role: "evidence", page: 3, words: 200, minutes: 2, paragraphs: [], level: 2, parentId: "g2" },
    { id: "s22", heading: "2.2 Cycling", canonical: "results", role: "evidence", page: 4, words: 200, minutes: 2, paragraphs: [], level: 2, parentId: "g2" },
  ],
  totalMinutes: 5,
};

function render(sectionId: string, kind: "answer" | "background" = "answer"): string {
  const report: Pick<PaperReport, "forYourQuestions"> = {
    forYourQuestions: [
      { question: "What is the capacity?", verdict: "partly", answers: [], readNext: [{ sectionId, why: "It reports it.", kind }] },
    ],
  };
  return renderToStaticMarkup(
    createElement(SectionLinks, { headings: map.sections.map((s) => s.heading) }, createElement(ForYourQuestions, { report, map })),
  );
}

function metaRow(html: string): string {
  const inner = /<p class="[^"]*text-meta[^"]*">(.*?)<\/p>/.exec(html)?.[1] ?? "";
  return inner.replace(/<[^>]+>/g, "");
}

describe("a Read-next line's minutes for a group row (P10-11, X-A2)", () => {
  it("gives a group row the summed minutes of its children, the number the map's row shows", () => {
    const shown = groupTotals(map).get("g2")!.minutes;
    expect(shown).toBe(3);
    expect(metaRow(render("g2"))).toBe(`§2. RESULTS AND DISCUSSION · p.3 · ${shown}${NB}min`);
    expect(metaRow(render("g2", "background"))).toBe(`§2. RESULTS AND DISCUSSION · p.3 · 3${NB}min · background`);
    expect(metaRow(render("g2"))).not.toContain(`0${NB}min`);
  });

  it("leaves a leaf row as it was: its own minutes", () => {
    expect(metaRow(render("s1"))).toBe(`§1. INTRODUCTION · p.2 · 2${NB}min`);
    expect(metaRow(render("s21"))).toBe(`§2.1 Capacity · p.3 · 2${NB}min`);
  });

  it("readNextLabel, given the minutes, names the same line the row reads", () => {
    expect(readNextLabel(map.sections[1], "answer", 3)).toBe(`§2. RESULTS AND DISCUSSION · p.3 · 3${NB}min`);
    expect(readNextLabel(map.sections[0], "answer")).toBe(`§1. INTRODUCTION · p.2 · 2${NB}min`);
  });
});
