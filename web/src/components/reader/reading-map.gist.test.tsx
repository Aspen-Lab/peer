import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gistRoute, routeByQuestions, type ReadingMap } from "@/lib/papers/reading-map";
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

  it("labels it as Peer's words, beside the gist, once per gist", () => {
    const line = lineOf(html, "paper-section-0-p0");

    expect(line.split(escaped(PEERS_READING))).toHaveLength(2);
    expect(line.indexOf(escaped(PEERS_READING))).toBeGreaterThan(line.indexOf(escaped(GIST_0)));
    expect(html.split(escaped(PEERS_READING))).toHaveLength(1 + 3);
    // Look finding (Chromium, the narrow rail): the mark never breaks mid-phrase, and a
    // space before it (not a margin) gives it somewhere to break, so the gist's last word
    // is not dragged to the next line with it.
    expect(line).toMatch(/<span class="[^"]*\bwhitespace-nowrap\b[^"]*">/);
    expect(line).not.toMatch(/<span class="[^"]*\bml-/);
    // The one span holds the gist and its mark: the mark is inside it.
    expect(line).toMatch(new RegExp(`${escaped(GIST_0)} <span[^>]*>${escaped(PEERS_READING)}</span></span></li>$`));
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
    const strip = (html: string) => html.replace(/<span role="note"[\s\S]*?<\/span><\/span>/g, "");

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
