import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReadingMap, ReadingMapSection } from "@/lib/papers/reading-map";
import { mapHierarchy, ReadingMapView } from "./reading-map";

const row = (id: string, heading: string, level: 1 | 2 | 3): ReadingMapSection => ({
  id, heading, level, canonical: "body", role: "body", words: 100, minutes: 1,
  paragraphs: [{ index: 0, opening: "The opening paragraph." }],
});

describe("contents hierarchy", () => {
  const sections = [
    row("methods", "2 Methods", 1),
    row("background", "2.1 Background", 2),
    row("problem", "2.1.1 Problem formulation", 3),
    row("model", "2.2 Model", 2),
    row("results", "3 Results", 1),
  ];

  it("finds direct children and ancestors without joining unrelated numbered sections", () => {
    expect(mapHierarchy(sections)).toEqual([
      { parents: [], children: [1, 3] },
      { parents: [0], children: [2] },
      { parents: [0, 1], children: [] },
      { parents: [0], children: [] },
      { parents: [], children: [] },
    ]);
    expect(mapHierarchy([sections[0], row("other", "4.1 Other", 2)])[1].parents).toEqual([]);
  });

  it("opens top-level sections, folds deeper branches, and keeps their links available", () => {
    const map: ReadingMap = { sections, totalMinutes: 5 };
    const html = renderToStaticMarkup(createElement(ReadingMapView, { map }));
    expect(html).toContain('aria-label="Collapse subsections of 2 Methods"');
    expect(html).toContain('aria-label="Expand subsections of 2.1 Background"');
    expect(html).toMatch(/<li[^>]*data-level="3"[^>]*hidden=""[^>]*>/);
    expect(html).toContain('href="#paper-section-2"');
    expect(html).toContain('aria-label="Show how the paragraphs of 2 Methods open"');
  });
});
