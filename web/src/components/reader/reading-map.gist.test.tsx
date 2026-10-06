import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gistRoute, routeByQuestions, type ReadingMap } from "@/lib/papers/reading-map";
import type { ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { MAP, PEERS_READING } from "./copy";
import { ReadingMapView } from "./reading-map";

// P3-03 (ruling §1h.6; §1a.8; §1f.17; §3d 5, Tier 2 half): under each paragraph's
// opening — the paper's words, verbatim, as the map has always drawn them — Peer's
// gist, in the label face and labelled `PEERS_READING`, never replacing, shortening
// or restyling the opening. A line with no gist is byte-identical to what it was.
// No DOM in this project's Vitest: rendered with react-dom/server.

const map: ReadingMap = {
  sections: [
    {
      id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 400, minutes: 3,
      paragraphs: [
        { index: 0, opening: "Creep limits the life of parts that run hot for years under load." },
        { index: 1, opening: null },
        { index: 2, opening: "Grain boundaries are where most of the creep strain is thought to happen." },
      ],
    },
    {
      id: "s2", heading: "2.1 Samples", canonical: "methods", role: "method", page: 2, words: 150, minutes: 1,
      paragraphs: [{ index: 0, opening: "Twelve samples with different grain sizes were cut from one cast ingot." }],
    },
    { id: "s3", heading: "Problem Statement", canonical: "body", role: "body", words: 90, minutes: 1, paragraphs: [{ index: 0, opening: null }] },
  ],
  totalMinutes: 4,
};

const GIST_0 = "Hot parts slowly deform under load.";
const GIST_2 = "Grain boundaries carry most creep strain.";
const GIST_S2 = "Twelve cast samples, differing grain sizes.";

const render = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadingMapView, { map, ...props }));

/** The `<li>` that holds a paragraph line, from its anchor to its close. */
function lineOf(html: string, anchor: string): string {
  const start = html.lastIndexOf("<li>", html.indexOf(`href="#${anchor}"`));
  const end = html.indexOf("</li>", start);
  return html.slice(start, end + "</li>".length);
}

const escaped = (text: string) => text.replace(/&/g, "&amp;").replace(/'/g, "&#x27;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The map's one line that says the gists are Peer's reading (P3-05, O12): a label-face
 *  paragraph holding `PEERS_READING` and nothing else, directly under the heading. */
const LEGEND = new RegExp(`<p class="[^"]*">${escaped(PEERS_READING)}</p>`, "g");
const legends = (html: string): string[] => html.match(LEGEND) ?? [];

// What a line was before P3-03, pinned byte for byte (the markup of the
// untinted opening: the label-face-free serif line in the faint ink).
const TODAY_LINE_0 =
  '<li><a href="#paper-section-0-p0" class="font-reading text-body-sm leading-[1.45] transition-colors hover:text-heading text-text-faint">Creep limits the life of parts that run hot for years under load.</a></li>';
const TODAY_LINE_2 =
  '<li><a href="#paper-section-0-p2" class="font-reading text-body-sm leading-[1.45] transition-colors hover:text-heading text-text-faint">Grain boundaries are where most of the creep strain is thought to happen.</a></li>';

describe("ReadingMapView — a line with no gist is byte-identical to today's", () => {
  it("renders the untinted opening line exactly as it was", () => {
    const html = render({ openRows: [0, 1] });

    expect(lineOf(html, "paper-section-0-p0")).toBe(TODAY_LINE_0);
    expect(lineOf(html, "paper-section-0-p2")).toBe(TODAY_LINE_2);
  });

  it("is the same whole map with no gists, an empty guide, a guide for papers elsewhere, or gists for paragraphs that are not drawn", () => {
    const plain = render({ openRows: [0, 1] });

    expect(render({ openRows: [0, 1], gists: undefined })).toBe(plain);
    expect(render({ openRows: [0, 1], gists: {} })).toBe(plain);
    expect(render({ openRows: [0, 1], gists: { s9: { 0: "A gist for a section the map does not have." } } })).toBe(plain);
    // Index 1 of s1 has no opening, so there is no line for a gist to follow.
    expect(render({ openRows: [0, 1], gists: { s1: { 1: "A gist for a paragraph with no line." } } })).toBe(plain);
  });

  it("leaves a line without a gist alone when its neighbour has one", () => {
    const html = render({ openRows: [0], gists: { s1: { 0: GIST_0 } } });

    expect(lineOf(html, "paper-section-0-p2")).toBe(TODAY_LINE_2);
  });
});

describe("ReadingMapView — Peer's gist after the opening", () => {
  const html = render({ openRows: [0, 1], gists: { s1: { 0: GIST_0, 2: GIST_2 }, s2: { 0: GIST_S2 } } });

  it("draws the gist on the paragraph's line, after the opening", () => {
    const line = lineOf(html, "paper-section-0-p0");

    expect(line.startsWith(TODAY_LINE_0.slice(0, -"</li>".length))).toBe(true);
    expect(line.indexOf(GIST_0)).toBeGreaterThan(line.indexOf("Creep limits the life"));
    expect(line).toContain(escaped(GIST_0));
    expect(lineOf(html, "paper-section-0-p2")).toContain(escaped(GIST_2));
    expect(lineOf(html, "paper-section-1-p0")).toContain(escaped(GIST_S2));
  });

  it("leaves the opening exactly as it was: the same anchor, the same words, the same class, and the gist outside the link", () => {
    const line = lineOf(html, "paper-section-0-p0");
    const anchor = TODAY_LINE_0.slice("<li>".length, -"</li>".length);

    expect(line.startsWith(`<li>${anchor}`)).toBe(true);
    expect(anchor.endsWith("</a>")).toBe(true);
    expect(line.indexOf("</a>")).toBeLessThan(line.indexOf(escaped(GIST_0)));
    expect(line.slice(line.indexOf("</a>")).includes("Creep limits")).toBe(false);
  });

  it("sets the gist in the label face, not the reading face, and never as a quotation", () => {
    const line = lineOf(html, "paper-section-0-p0");
    const gistSpan = line.slice(line.indexOf("</a>") + "</a>".length);

    expect(gistSpan).toMatch(/class="[^"]*\bannotation\b/);
    expect(gistSpan).not.toContain("font-reading");
    expect(gistSpan).not.toContain("italic");
    expect(gistSpan).not.toContain("<q");
    expect(gistSpan).not.toContain("<blockquote");
    expect(gistSpan).not.toContain("<a ");
  });

  // P3-05 (§1h.8 (5), O12): this test said the mark is printed beside the gist, once per
  // gist (the P3-03 reading of §1f.17) — twelve times in A's rail. The ruling: once per
  // map, under the heading (the describe after this one); the gist keeps its role, its
  // label and its face, and loses the trailing mark. The leading space stays the gist's
  // own: unlike a margin it does not indent the gist when it wraps to a new line.
  it("is the gist alone on its line, with no mark of its own: the span holds a space and the gist", () => {
    const line = lineOf(html, "paper-section-0-p0");

    expect(line).not.toContain(escaped(PEERS_READING));
    expect(line).not.toMatch(/whitespace-nowrap/);
    expect(line).not.toMatch(/<span class="[^"]*\bml-/);
    expect(line).toMatch(new RegExp(`</a><span role="note" aria-label="${escaped(MAP.gist)}" class="annotation text-text-muted"> ${escaped(GIST_0)}</span></li>$`));
  });

  it("gives the gist an accessible name", () => {
    expect(MAP.gist).toBe("Peer's gist");
    const line = lineOf(html, "paper-section-0-p0");

    expect(line).toContain(`aria-label="${escaped(MAP.gist)}"`);
    expect(line).toContain('role="note"');
  });

  it("escapes what the model wrote: a gist is text, never markup and never maths", () => {
    const risky = render({ openRows: [0], gists: { s1: { 0: "<b>Bold</b> and $x^2$ and &amp;" } } });
    const line = lineOf(risky, "paper-section-0-p0");

    expect(line).toContain("&lt;b&gt;Bold&lt;/b&gt; and $x^2$ and &amp;amp;");
    expect(line).not.toContain("<b>");
    expect(line).not.toContain("katex");
  });
});

describe("ReadingMapView — the folding is unchanged", () => {
  it("shows no gist while the row is closed, and the same fold button as before", () => {
    const closed = render({ gists: { s1: { 0: GIST_0 } } });

    expect(closed).not.toContain(escaped(GIST_0));
    expect(closed).toBe(render());
    expect(closed).toContain(`aria-label="${escaped(MAP.openLines("1 Introduction"))}"`);
  });

  it("does not make a row foldable for a gist alone: a section whose paragraphs have no opening still has no fold button", () => {
    const html = render({ gists: { s3: { 0: "A gist with no line to follow." } } });

    expect(html).not.toContain(escaped(MAP.openLines("Problem Statement")));
    expect(html).toBe(render());
  });

  it("keeps the phone fold: the table is hidden below 40rem until 'show map', with the gists inside it", () => {
    const html = render({ gists: { s1: { 0: GIST_0 } }, openRows: [0] });

    expect(html).toContain('class="hidden sm:block"');
    expect(html).toContain(MAP.show);
    expect(render({ gists: { s1: { 0: GIST_0 } }, openRows: [0], phoneOpen: true })).not.toContain('class="hidden sm:block"');
  });

  it("opens the same rows to the same lines, with or without gists", () => {
    // P3-05 (O12): a gist is one span now (its mark moved to the map's legend), and the
    // legend is the one added line under the heading; take both out and the map is what it was.
    const strip = (html: string) => html.replace(/<span role="note"[^>]*>[^<]*<\/span>/g, "").replace(LEGEND, "");

    expect(strip(render({ openRows: [0, 1], gists: { s1: { 0: GIST_0, 2: GIST_2 }, s2: { 0: GIST_S2 } } }))).toBe(render({ openRows: [0, 1] }));
  });
});

describe("ReadingMapView — a gist on a tinted line", () => {
  const questions = routeByQuestions(map, [{ paragraphs: ["Creep strain at grain boundaries is the creep we study here and creep rate also."] }, { paragraphs: ["Twelve samples."] }, { paragraphs: ["Nothing."] }], ["creep strain"]);

  it("leaves the opening's tint and its muted ink as they are, and puts neither on the gist", () => {
    const route = questions;
    const html = render({ openRows: [0], route, gists: { s1: { 0: GIST_0, 2: GIST_2 } } });
    const without = render({ openRows: [0], route });
    const line = lineOf(html, "paper-section-0-p0");
    const gistSpan = line.slice(line.indexOf("</a>") + "</a>".length);

    // The line is tinted here, and its opening's anchor is what it is without the gist.
    expect(lineOf(without, "paper-section-0-p0")).toContain('data-route="');
    expect(line.startsWith(lineOf(without, "paper-section-0-p0").slice(0, -"</li>".length))).toBe(true);
    expect(gistSpan).not.toContain("data-route");
    expect(gistSpan).not.toContain("box-decoration-clone");
  });

  it("draws the gist of an untinted line with the gist route too", () => {
    const route = gistRoute(map);
    const html = render({ openRows: [1], route, gists: { s2: { 0: GIST_S2 } } });

    expect(html).toContain(escaped(GIST_S2));
  });
});

// P3-05 (§1h.8 (5), O12): `PEERS_READING` was printed after every gist — twelve times in
// A's rail, against "time efficiency over information volume". It is a legend: once per
// map, a label-face line directly under the map's heading, there only when a gist renders
// in the map. The face already tells Peer's line from the paper's (§1f.17), and each
// gist keeps `role="note"` and its accessible name.
describe("ReadingMapView — the mark once per map, under the heading (P3-05, O12)", () => {
  const big: ReadingMap = {
    sections: [0, 1, 2].map((s) => ({
      id: `s${s + 1}`, heading: `${s + 1} Section ${s + 1}`, canonical: "body" as const, role: "body" as const, words: 100, minutes: 1,
      paragraphs: [0, 1, 2, 3].map((i) => ({ index: i, opening: `Opening sentence number ${s * 4 + i} of the paper itself.` })),
    })),
    totalMinutes: 3,
  };
  const twelve = Object.fromEntries([0, 1, 2].map((s) => [`s${s + 1}`, Object.fromEntries([0, 1, 2, 3].map((i) => [i, `Gist number ${s * 4 + i}.`]))]));
  const renderBig = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) => renderToStaticMarkup(createElement(ReadingMapView, { map: big, ...props }));

  it("prints it once for twelve gists", () => {
    const html = renderBig({ openRows: [0, 1, 2], gists: twelve });

    expect(html.split("role=\"note\"")).toHaveLength(1 + 12);
    expect(html.split(escaped(PEERS_READING))).toHaveLength(2);
    expect(legends(html)).toHaveLength(1);
  });

  it("prints it as a label-face line under the heading, before the summary line, in the faint ink it always had", () => {
    const html = renderBig({ openRows: [0], gists: twelve });
    const legend = legends(html)[0];

    expect(legend).toMatch(/^<p class="[^"]*\bannotation\b[^"]*\btext-text-faint\b[^"]*">/);
    expect(legend).not.toContain("font-reading");
    expect(legend).not.toContain("italic");
    expect(html.indexOf(`>${MAP.heading}</p>`)).toBeGreaterThan(0);
    expect(html.indexOf(legend)).toBeGreaterThan(html.indexOf(MAP.heading));
    // Directly under the heading: the next element after the heading's paragraph.
    expect(html.indexOf(legend)).toBe(html.indexOf("</p>", html.indexOf(MAP.heading)) + "</p>".length);
    expect(html.indexOf(legend)).toBeLessThan(html.indexOf(escaped(MAP.summary(3, 3))));
  });

  it("prints none when no gist renders: no guide, an empty guide, gists for another paper, or for paragraphs with no line", () => {
    const none: Array<ParagraphGuide["gists"] | undefined> = [undefined, {}, { s9: { 0: "A gist for a section the map does not have." } }, { s1: { 9: "A gist for a paragraph the map does not list." } }];
    for (const gists of none) {
      expect(renderBig({ openRows: [0, 1, 2], gists })).not.toContain(escaped(PEERS_READING));
    }
    expect(render({ openRows: [0, 1], gists: { s1: { 1: "A gist for a paragraph with no line." } } })).not.toContain(escaped(PEERS_READING));
  });

  it("prints none while every row is closed, whatever gists there are: no gist renders, so there is nothing to name", () => {
    const closed = renderBig({ gists: twelve });

    expect(closed).not.toContain(escaped(PEERS_READING));
    expect(closed).toBe(renderBig());
  });

  it("prints it once an open row has a gist, and not for a gist in a row that is closed", () => {
    expect(legends(renderBig({ openRows: [1], gists: { s1: { 0: "Only in the closed row." } } }))).toHaveLength(0);
    expect(legends(renderBig({ openRows: [0], gists: { s1: { 0: "In the open row." } } }))).toHaveLength(1);
    expect(legends(renderBig({ openRows: [0, 1], gists: { s1: { 0: "In the open row." } } }))).toHaveLength(1);
  });

  it("keeps each gist's role, accessible name and label face, with no mark on any of them", () => {
    const html = renderBig({ openRows: [0, 1, 2], gists: twelve });
    const spans = html.match(/<span role="note"[^>]*>[^<]*<\/span>/g) ?? [];

    expect(spans).toHaveLength(12);
    for (const span of spans) {
      expect(span).toContain(`aria-label="${escaped(MAP.gist)}"`);
      expect(span).toMatch(/class="[^"]*\bannotation\b/);
      expect(span).not.toContain(escaped(PEERS_READING));
      expect(span.split("<span")).toHaveLength(2); // the one span, nothing nested in it
    }
  });

  it("leaves a line without a gist byte-identical to today's, and the rows and counts as they were", () => {
    const html = render({ openRows: [0, 1], gists: { s1: { 0: GIST_0 } } });

    expect(lineOf(html, "paper-section-0-p2")).toBe(TODAY_LINE_2);
    expect(lineOf(html, "paper-section-1-p0")).toContain("Twelve samples with different grain sizes were cut from one cast ingot.");
    expect(html.replace(LEGEND, "").replace(/<span role="note"[^>]*>[^<]*<\/span>/, "")).toBe(render({ openRows: [0, 1] }));
  });

  it("folds the legend with the table on a phone: hidden below 40rem until 'show map', shown with it", () => {
    const folded = renderBig({ openRows: [0], gists: twelve });
    const shown = renderBig({ openRows: [0], gists: twelve, phoneOpen: true });

    expect(legends(folded)[0]).toMatch(/\bhidden sm:block\b/);
    expect(legends(shown)[0]).not.toMatch(/\bhidden\b/);
  });

  it("is the same legend, once, on a tinted map and on the gist route", () => {
    const route = gistRoute(big);
    const html = renderBig({ openRows: [0], route, gists: twelve });

    expect(legends(html)).toHaveLength(1);
  });
});
