import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { canonicalizeHeading, withInheritedBuckets, withSectionIds, type ExtractedDocument } from "@/lib/papers/html-text";
import { buildReadingMap, readableSections, type ReadingMap } from "@/lib/papers/reading-map";
import { closingPartition, partOf, partitionedMap, type GuidePartition } from "@/lib/papers/reading-partition";
import { MAP, PEERS_READING } from "./copy";
import { ReadingMapView } from "./reading-map";

// P12-63 (rule 3; ruling §1h.436 (c), §1h.424 (a)): a row whose role the rules worked out is drawn exactly like a named row. The closing split's two
// rows (`part.closing`) wear their role's own tag, and the "Peer's reading" tag and legend stay for the model partition's rows only. Every text is
// invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF. No DOM in this project's Vitest: rendered with react-dom/server.

const SNAILS = "Snail density rises with wave exposure";
const SHELLS = "Shell thickness follows crab predation";
const STORMS = "Recovery after storm scouring";
/** The paper's own announcement (the last paragraph of its introduction) and the closing that restates it. */
const ANNOUNCE = "Here we show that wave exposure raises snail density and that crab predation thickens shells.";
const SUMMARY = "Taken together, we show that wave exposure raises snail density and that crab predation thickens the shells.";
const OUTLOOK = "Future surveys could follow the recovery of algal cover after storm scouring across more shores.";

const plain = (n: number, seed = 0): string[] =>
  Array.from({ length: n }, (_, k) => `The survey logged ${10 + k + seed} counts of ${["limpets", "barnacles", "periwinkles"][(k + seed) % 3]} on the rocky shore.`);

function shore(rows: ReadonlyArray<readonly [string, readonly string[]]>): ExtractedDocument {
  return {
    sections: withSectionIds(withInheritedBuckets(rows.map(([heading, paragraphs]) => ({ heading, canonical: canonicalizeHeading(heading), text: paragraphs.join("\n\n") })))),
    figureCaptions: [],
    source: "pdf",
  };
}

/** The Nature-style paper of the measure: no abstract, an announcing last introduction paragraph, three descriptive parts, the last ending on the closing. */
const doc = shore([
  ["Body", [...plain(2), ANNOUNCE]],
  [SNAILS, plain(4, 1)],
  [SHELLS, plain(4, 2)],
  [STORMS, [...plain(3), SUMMARY, OUTLOOK]],
  ["Online content", plain(1)],
  ["References", plain(3)],
  ["Methods", plain(3)],
]);
const map = buildReadingMap(doc);
const body = readableSections(doc).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));
const partition = closingPartition(map, body, undefined);
const over = partitionedMap(map, body, partition);
const at = map.sections.findIndex((row) => row.heading === STORMS);

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const render = (shown: ReadingMap, props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) => renderToStaticMarkup(createElement(ReadingMapView, { map: shown, ...props }));
const hrefs = (html: string): string[] => [...html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]);
/** The legend line: a label-face paragraph holding `PEERS_READING` and nothing else. */
const legends = (html: string): number => (html.match(new RegExp(`<p class="[^"]*">${escaped(PEERS_READING)}</p>`, "g")) ?? []).length;
/** The row whose heading is `heading`: from its `<li data-level>` to the next row's (its own lines are inside). */
function rowOf(html: string, heading: string): string {
  const start = html.lastIndexOf("<li data-level", html.indexOf(`>${escaped(heading)}</a>`));
  const next = html.indexOf("<li data-level", start + 1);
  return html.slice(start, next < 0 ? html.length : next);
}
/** The summary line as its box reads (`SummaryLine` draws each separator in a slot of its own): the text, the tags removed. */
const summaryText = (html: string): string => {
  const from = html.indexOf("data-map-summary");
  return from < 0 ? "" : html.slice(html.indexOf(">", from) + 1, html.indexOf("<button", from)).replace(/<[^>]*>/g, "");
};
const roleCell = (label: string) => `<span data-meta-part="role" class="whitespace-nowrap">${escaped(label)}</span>`;
const roleOfRow = (row: string): string | undefined => /<span data-meta-part="role" class="whitespace-nowrap">([^<]*)<\/span>/.exec(row)?.[1];

describe("ReadingMapView - the closing split's rows are drawn like named rows (P12-63, rule 3)", () => {
  it("(a) draws the closing as an interpretation row with no \"Peer's reading\" tag", () => {
    const html = render(over);
    const closing = rowOf(html, MAP.parts.labels.conclusion);

    expect(partition?.closing).toBe(true);
    expect(partOf(over.sections[at + 1])?.closing).toBe(true);
    expect(closing).toContain(roleCell(MAP.roles.interpretation));
    expect(closing).not.toContain(escaped(MAP.parts.tag));
    expect(html).not.toContain(escaped(MAP.parts.tag));
  });

  it("draws the row above it as the paper's own row, with the role its heading has", () => {
    const html = render(over);
    const head = rowOf(html, STORMS);

    expect(partOf(over.sections[at])?.closing).toBe(true);
    expect(head).toContain(roleCell(MAP.roles.evidence));
    expect(head).toContain(escaped(MAP.words(over.sections[at].words)));
    expect(head).not.toContain(escaped(MAP.parts.tag));
  });

  it("puts no \"Peer's reading\" legend over the map", () => {
    expect(legends(render(over))).toBe(0);
    expect(legends(render(over, { openRows: [at, at + 1] }))).toBe(0);
  });

  it("draws the rows whose role the rules worked out like named ones: the front text, the descriptive parts, the back matter", () => {
    const html = render(over);
    const roles = Object.fromEntries(
      [MAP.parts.labels.introduction, SNAILS, SHELLS, "Online content", "Methods"].map((heading) => [heading, roleOfRow(rowOf(html, heading))]),
    );

    expect(roles).toEqual({
      [MAP.parts.labels.introduction]: MAP.roles.setup,
      [SNAILS]: MAP.roles.evidence,
      [SHELLS]: MAP.roles.evidence,
      "Online content": MAP.roles.apparatus,
      Methods: MAP.roles.method,
    });
    expect(legends(html)).toBe(0);
  });

  it("(b) keeps the tag and the legend for the model partition's rows, drawn as before", () => {
    // The model's parts of an unheaded paper's trunk: the same shape, the part record without `closing`.
    const unheaded = shore([["Body", plain(30)], ["Methods", plain(3)], ["References", plain(2)]]);
    const unheadedMap = buildReadingMap(unheaded);
    const model: GuidePartition = {
      sectionId: unheadedMap.sections[0].id,
      parts: [
        { role: "introduction", fromParagraph: 0, toParagraph: 9 },
        { role: "results", fromParagraph: 10, toParagraph: 29 },
      ],
    };
    const modelBody = readableSections(unheaded).map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));
    const drawn = partitionedMap(unheadedMap, modelBody, model);
    const html = render(drawn);

    expect(drawn.sections.filter((row) => partOf(row) !== undefined)).toHaveLength(2);
    expect(partOf(drawn.sections[0])?.closing).toBeUndefined();
    for (const heading of [MAP.parts.labels.introduction, MAP.parts.labels.results]) {
      expect(rowOf(html, heading)).toContain(roleCell(MAP.parts.tag));
    }
    expect(legends(html)).toBe(1);
    // The paper's own rows beside them still say their role.
    expect(rowOf(html, "Methods")).toContain(roleCell(MAP.roles.method));
  });

  it("keeps the tag and the legend for a model's row beside a closing row, and only for it", () => {
    // Not a map the page makes (the two never meet), but the view reads each row's own record.
    const mixed: ReadingMap = {
      ...over,
      sections: over.sections.map((row, k) => (k === 0 ? { ...row, part: { sectionId: row.id, sectionIndex: 0, role: "introduction" as const, from: 0, to: 2 } } : row)) as ReadingMap["sections"],
    };
    const html = render(mixed);

    expect(rowOf(html, MAP.parts.labels.introduction)).toContain(roleCell(MAP.parts.tag));
    expect(rowOf(html, MAP.parts.labels.conclusion)).toContain(roleCell(MAP.roles.interpretation));
    expect(legends(html)).toBe(1);
  });

  it("changes nothing else about the two rows: their links, their paragraph lines and the count", () => {
    const html = render(over, { openRows: [at, at + 1] });
    const head = rowOf(html, STORMS);
    const closing = rowOf(html, MAP.parts.labels.conclusion);

    // Each row links to its first paragraph, the lines to the section's real paragraph anchors (the body is untouched).
    expect(hrefs(head)).toEqual([0, 0, 1, 2].map((p) => `paper-section-${at}-p${p}`));
    expect(hrefs(closing)).toEqual([3, 3, 4].map((p) => `paper-section-${at}-p${p}`));
    // The words and minutes are the rows' own, and the rows after them are in place.
    expect(closing).toContain(escaped(MAP.words(over.sections[at + 1].words)));
    expect(hrefs(render(over)).filter((id) => /^paper-section-\d+$/.test(id)).slice(-3)).toEqual([at + 1, at + 2, at + 3].map((k) => `paper-section-${k}`));
    const totalWords = over.sections.reduce((sum, row) => sum + row.words, 0);
    expect(summaryText(render(over, { source: "PDF" }))).toBe(MAP.summary(map.sections.length + 1, map.totalMinutes, totalWords, "PDF"));
  });
});
