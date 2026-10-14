import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FullTextResult } from "@/lib/papers/full-text";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { minimalPdf, type Run } from "@/lib/papers/minimal-pdf.test-helper";
import { extractPdfTextFromPath } from "@/lib/papers/pdf-text";
import { buildReading } from "@/lib/papers/reading";
import { readableSections, readingMapOf, routeByQuestions, type ReadingMap } from "@/lib/papers/reading-map";
import { partitionedMap, withPartitionMarks, type GuidePartition } from "@/lib/papers/reading-partition";
import type { Paper } from "@/types";
import { MAP, PEERS_READING, ROUTE } from "./copy";
import { ReadingMapView, carryOpenRows } from "./reading-map";

// P10-07b (B P10-05 §3.1-3.3; review 3.3, second half; rubric A15): the map of a paper with no
// headings draws the model's partition as group rows — named for the roles, tagged "Peer's
// reading", in the trunk row's place, holding the paper's own paragraph lines — and without a
// partition it is the paper's paragraphs under one row, never empty. No DOM in this project's
// Vitest: rendered with react-dom/server. Every text is invented ("a survey of shore ecology").

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const invented = (k: number): string => {
  const topic = TOPICS[k % TOPICS.length];
  return `Invented paragraph ${k} about ${topic}. The survey counted ${10 + k} sites near the ${topic}. Nothing here is quoted from a paper.`;
};
const PAPER: Paper = {
  id: "upload:00000000000000cc", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
function unheadedReading(over: Record<number, string> = {}) {
  const doc: ExtractedDocument = {
    source: "pdf",
    pageCount: 6,
    figureCaptions: [],
    sections: [
      { id: "s0", heading: "A survey of shore ecology", canonical: "body", page: 1, text: Array.from({ length: 30 }, (_, k) => over[k] ?? invented(k)).join("\n\n") },
      { id: "s1", heading: "Methods", canonical: "methods", page: 4, text: Array.from({ length: 4 }, (_, k) => invented(100 + k)).join("\n\n") },
    ],
  };
  const fullText: FullTextResult = { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/shore.pdf", kind: "pdf", label: "doi", rank: 1 } };
  return buildReading(PAPER, fullText, new Date("2026-10-05T00:00:00.000Z"));
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

const reading = unheadedReading({
  3: "Invented paragraph 3 about the quillwort. A single note names it once and moves on.",
  12: "The quillwort lattice shows cracks. The quillwort lattice was measured twice on the sand ripples.",
});
const map = reading.map!;
const over = partitionedMap(map, reading.body, FOUR);

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const render = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) => renderToStaticMarkup(createElement(ReadingMapView, { map, ...props }));
const hrefs = (html: string): string[] => [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
/** The paragraph lines' anchors in a row (or a whole map): every link to a paragraph but a group row's own, the first in its row. */
const lineHrefs = (row: string): string[] => hrefs(row).slice(1).filter((id) => /-p\d+$/.test(id));
const allLineHrefs = (html: string): string[] => hrefs(html).filter((id) => /^paper-section-\d+-p\d+$/.test(id));
/** The legend line: a label-face paragraph holding `PEERS_READING` and nothing else. */
const legends = (html: string): number => (html.match(new RegExp(`<p class="[^"]*">${escaped(PEERS_READING)}</p>`, "g")) ?? []).length;
/** The row whose heading is `heading`: from its `<li data-level>` to the next row's (its own lines are inside). */
function rowOf(html: string, heading: string): string {
  const at = html.indexOf(`>${escaped(heading)}</a>`);
  const start = html.lastIndexOf("<li data-level", at);
  const next = html.indexOf("<li data-level", at);
  return html.slice(start, next < 0 ? html.length : next);
}
const opened = (...positions: number[]) => ({ openRows: positions });

describe("ReadingMapView — a partition's group rows (B P10-05 §3.1)", () => {
  it("draws one row per part where the trunk's row was, then the paper's own rows", () => {
    const html = render({ map: over, ...opened() });
    const headings = [...html.matchAll(/class="min-w-0 flex-\[1_1_14rem\][^"]*">([^<]*)<\/a>/g)].map((m) => m[1]);

    expect(headings).toEqual(["Introduction", "Results", "Discussion", "Conclusion", "Methods"]);
    expect(html).not.toContain("A survey of shore ecology");
  });

  it("tags each group row \"Peer's reading\" where a headed row reads its role, then its words and minutes", () => {
    const html = render({ map: over, ...opened() });
    const results = rowOf(html, "Results");

    expect(MAP.parts.tag).toBe("Peer's reading");
    expect(results).toContain(`<span data-meta-part="role" class="whitespace-nowrap">${escaped(MAP.parts.tag)}</span>`);
    expect(results).toContain(escaped(MAP.words(over.sections[1].words)));
    expect(results).toContain(MAP.minutes(over.sections[1].minutes));
    // No page for a group (the trunk's page is the first part's), and the role word of a headed row is not on it.
    expect(results).not.toContain("data-meta-part=\"page\"");
    expect(results).not.toContain("evidence");
    // A headed row after the trunk reads as it did.
    const methods = rowOf(html, "Methods");
    expect(methods).toContain('<span data-meta-part="role" class="whitespace-nowrap">method</span>');
    expect(methods).toContain('data-meta-part="page"');
    expect(methods).not.toContain(escaped(MAP.parts.tag));
  });

  it("links a group row to its first paragraph's anchor, and the row after the trunk to its own section's place in the body", () => {
    const html = render({ map: over, ...opened() });

    expect(rowOf(html, "Introduction")).toContain('href="#paper-section-0-p0"');
    expect(rowOf(html, "Results")).toContain('href="#paper-section-0-p6"');
    expect(rowOf(html, "Conclusion")).toContain('href="#paper-section-0-p27"');
    // Methods is the body's section 1, though it is the map's fifth row.
    expect(rowOf(html, "Methods")).toContain('href="#paper-section-1"');
  });

  it("links the paragraph lines of an open group to the trunk's real paragraph anchors", () => {
    const html = render({ map: over, ...opened(1, 4) });
    const results = rowOf(html, "Results");
    const lines = lineHrefs(results);

    expect(lines[0]).toBe("paper-section-0-p6");
    expect(lines).toContain("paper-section-0-p12");
    expect(lines.at(-1)).toBe("paper-section-0-p19");
    expect(lines).toHaveLength(14);
    // Methods' own lines: its section's paragraphs, the body's section 1.
    expect(lineHrefs(rowOf(html, "Methods"))).toEqual(["paper-section-1-p0", "paper-section-1-p1", "paper-section-1-p2", "paper-section-1-p3"]);
  });

  it("keeps the paper's own opening on a line, word for word", () => {
    const html = render({ map: over, ...opened(1) });

    expect(rowOf(html, "Results")).toContain(escaped(map.sections[0].paragraphs[12].opening!));
  });

  it("folds a group row's lines like any row: closed until opened", () => {
    const closed = render({ map: over, ...opened() });
    const open = render({ map: over, ...opened(2) });

    expect(lineHrefs(rowOf(closed, "Discussion"))).toEqual([]);
    expect(lineHrefs(rowOf(open, "Discussion"))).toHaveLength(7);
    expect(rowOf(closed, "Discussion")).toContain('aria-expanded="false"');
  });

  it("looks a gist up under the trunk's section id, and shows it under the group that holds the paragraph", () => {
    const gists = { s0: { 12: "Cracks in the lattice, measured twice.", 22: "A discussion paragraph's gist." }, s1: { 0: "Methods gist." } };
    const html = render({ map: over, gists, ...opened(1, 2, 4) });

    expect(rowOf(html, "Results")).toContain("Cracks in the lattice, measured twice.");
    expect(rowOf(html, "Results")).not.toContain("A discussion paragraph");
    expect(rowOf(html, "Discussion")).toContain("A discussion paragraph&#x27;s gist.");
    expect(rowOf(html, "Methods")).toContain("Methods gist.");
    // A gist keyed by a group's own id is nobody's.
    expect(render({ map: over, gists: { "s0~1": { 12: "Keyed by the group." } }, ...opened(1) })).not.toContain("Keyed by the group.");
  });

  it("shows the legend line when a group row is on screen, once, and not for a headed map with no gist", () => {
    expect(legends(render({ map: over, ...opened() }))).toBe(1);
    expect(legends(render({ map: over, gists: { s0: { 12: "x" } }, ...opened(1) }))).toBe(1);
    expect(legends(render({ map, ...opened() }))).toBe(0);
  });

  // P10-21 re-aim (rule 4; round 2's reader 3: "1 section · 633 words" over four "Peer's reading" rows) of "says the
  // paper's own section count in the summary line, not the number of rows": the partition's groups count as sections, so
  // the line counts the rows it draws (the five of `over`: four parts and Methods); the undivided map's two rows say 2.
  it("says in the summary line as many sections as it draws rows: the partition's groups count", () => {
    const totalWords = map.sections.reduce((sum, row) => sum + row.words, 0);

    expect(over.sections).toHaveLength(5);
    expect(render({ map: over, source: "PDF" })).toContain(escaped(MAP.summary(5, map.totalMinutes, totalWords, "PDF")));
    expect(render({ map: over, source: "PDF" })).toContain("5 sections");
    expect(render({ map, source: "PDF" })).toContain(escaped(MAP.summary(2, map.totalMinutes, totalWords, "PDF")));
  });

  it("the keyed unheaded map: four \"Peer's reading\" rows under \"4 sections\"; the no-key single row says \"1 section\"", () => {
    const trunkOnly: ReadingMap = { sections: [map.sections[0]], totalMinutes: map.totalMinutes };
    const four = partitionedMap(trunkOnly, reading.body, FOUR);
    const keyed = render({ map: four, source: "PDF" });

    expect(four.sections).toHaveLength(4);
    expect(keyed.split(`>${escaped(MAP.parts.tag)}<`).length - 1).toBe(4);
    expect(keyed).toContain("Read from PDF · 4 sections ·");
    expect(keyed).not.toContain("1 section");
    expect(render({ map: trunkOnly, source: "PDF" })).toContain("Read from PDF · 1 section ·");
  });

  it("indents a group row as a level-1 row and marks no row a group of the paper's hierarchy", () => {
    const html = render({ map: over, ...opened() });

    expect(rowOf(html, "Results")).toMatch(/^<li data-level="1"/);
    expect(html).not.toContain("data-group");
  });
});

describe("ReadingMapView — without a partition: the paper's paragraphs under one row, never empty (B §3.2)", () => {
  const trunkOnly: ReadingMap = { sections: [map.sections[0]], totalMinutes: map.totalMinutes };

  it("shows the unheaded paper's one row with its lines", () => {
    const html = render({ map, openRows: [0] });
    const lines = map.sections[0].paragraphs.filter((line) => line.opening !== null);

    expect(rowOf(html, "A survey of shore ecology")).toBeTruthy();
    expect(lineHrefs(rowOf(html, "A survey of shore ecology"))).toHaveLength(lines.length);
    expect(lines.length).toBe(30);
    expect(rowOf(html, "Methods")).toContain('href="#paper-section-1"');
    expect(html).not.toContain(escaped(MAP.parts.tag));
    expect(legends(html)).toBe(0);
  });

  it("opens a map of one row by default, so the lines are there; an explicit openRows is honoured", () => {
    expect(allLineHrefs(render({ map: trunkOnly }))).toHaveLength(30);
    expect(allLineHrefs(render({ map: trunkOnly, openRows: [] }))).toEqual([]);
  });

  it("does not open a map of several rows by default", () => {
    expect(map.sections).toHaveLength(2);
    expect(allLineHrefs(render({ map }))).toEqual([]);
  });

  describe("a headless PDF", () => {
    let tempDir: string;
    beforeAll(async () => {
      tempDir = await mkdtemp(path.join(tmpdir(), "peer-partition-map-"));
    });
    afterAll(async () => {
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    });

    it("is never an empty map: one row, its paragraph lines, no partition tag", async () => {
      const pages: Run[][] = [];
      let runs: Run[] = [["A Survey of Shore Ecology", 72, 80, 20]];
      let top = 130;
      for (let k = 0; k < 24; k += 1) {
        const lines = [`Survey paragraph ${k} looks at the ${TOPICS[k % TOPICS.length]}.`, `The team counted ${10 + k} sites near the ${TOPICS[k % TOPICS.length]} on one visit.`];
        if (top + lines.length * 14 > 760) {
          pages.push(runs);
          runs = [];
          top = 80;
        }
        lines.forEach((text, i) => runs.push([text, 72, top + i * 14, 11]));
        top += lines.length * 14 + 14;
      }
      pages.push(runs);
      const pdfPath = path.join(tempDir, "headless.pdf");
      await writeFile(pdfPath, minimalPdf(pages));

      const result = await extractPdfTextFromPath(pdfPath);
      const headless = readingMapOf(readableSections(result.doc!));
      const html = renderToStaticMarkup(createElement(ReadingMapView, { map: headless }));

      expect(headless.sections).toHaveLength(1);
      expect(html).toContain("<ol");
      expect(allLineHrefs(html).length).toBeGreaterThan(10);
      expect(html).not.toContain(escaped(MAP.parts.tag));
      // A partition that does not fit it (the model was never asked) changes nothing.
      expect(partitionedMap(headless, result.doc ? readableSections(result.doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs })) : [], { sectionId: headless.sections[0].id, parts: FOUR.parts })).toBe(headless);
    });
  });
});

describe("the open set is kept by row id (B §3.1, trap one)", () => {
  const ids = (set: ReadonlySet<string>) => [...set].sort();

  it("gives each group the trunk's openness when the partition arrives, and keeps the rows after it", () => {
    expect(ids(carryOpenRows(new Set(["s0", "s1"]), over))).toEqual(["s0~0", "s0~1", "s0~2", "s0~3", "s1"]);
    expect(ids(carryOpenRows(new Set(["s1"]), over))).toEqual(["s1"]);
    expect(ids(carryOpenRows(new Set(), over))).toEqual([]);
  });

  it("keeps a group open that was opened by hand, and drops an id the map no longer has", () => {
    expect(ids(carryOpenRows(new Set(["s0~1", "s1"]), over))).toEqual(["s0~1", "s1"]);
    expect(ids(carryOpenRows(new Set(["s0~1", "s1"]), map))).toEqual(["s1"]);
  });

  it("reads openRows as positions of the map it is given, then keeps them as ids", () => {
    const html = render({ map: over, openRows: [4] });

    expect(lineHrefs(rowOf(html, "Methods"))).toHaveLength(4);
    expect(lineHrefs(rowOf(html, "Results"))).toEqual([]);
  });
});

describe("ReadingMapView — a group row is marked from its paragraphs (B §4)", () => {
  const route = routeByQuestions(map, reading.body, ["How does the quillwort lattice crack?"]);
  const folded = withPartitionMarks(route, map, reading.body, FOUR);
  const html = render({ map: over, route: folded, ...opened(0, 1, 2) });

  it("tints the group that holds the strongest paragraph, and its line", () => {
    const results = rowOf(html, "Results");

    expect(results).toContain('data-route="strong"');
    expect(results).toContain("mentions lattice ×2, quillwort ×2, crack ×1");
    expect(results).toContain("strongest");
    const line = results.slice(results.indexOf('href="#paper-section-0-p12"') - 80);
    expect(line).toContain('data-route="strong"');
  });

  it("tints the group that only mentions faintly, and says \"not mentioned\" for a group that does not mention", () => {
    expect(rowOf(html, "Introduction")).toContain('data-route="faint"');
    expect(rowOf(html, "Introduction")).toContain("mentions quillwort ×1");
    expect(rowOf(html, "Discussion")).not.toContain("data-route");
    expect(rowOf(html, "Discussion")).toContain(ROUTE.tiers.none);
  });

  it("tints no group row from a route that was not folded: the trunk's mark is the body's, and its row is gone from the map", () => {
    const unfolded = render({ map: over, route, ...opened() });

    expect(unfolded).not.toContain("data-route=");
  });
});
