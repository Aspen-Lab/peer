import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gistRoute, type ReadingMap, type RouteResult } from "@/lib/papers/reading-map";
import { ASK, MAP, ROUTE } from "./copy";
import { ReadingMapView } from "./reading-map";

// P1-04 (§1f.12; blueprint §3.2 ② 图): the map under the question field.
// No DOM in this project's Vitest: rendered with react-dom/server; the
// row and phone toggles start from props a test can set.

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

const render = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadingMapView, { map, ...props }));

describe("ReadingMapView", () => {
  it("heads the table with the summary line", () => {
    const html = render();

    expect(MAP.summary(3, 4)).toBe("3 sections · about 4 min");
    expect(MAP.summary(1, 1)).toBe("1 section · about 1 min");
    expect(html).toContain(MAP.heading);
    expect(html).toContain(MAP.summary(3, 4));
    expect(html.indexOf(MAP.summary(3, 4))).toBeLessThan(html.indexOf("1 Introduction"));
  });

  it("lists every section: heading linked to its anchor, role tag, page and minutes, in order", () => {
    const html = render();

    expect(html).toContain('href="#paper-section-0"');
    expect(html).toContain('href="#paper-section-1"');
    expect(html).toContain('href="#paper-section-2"');
    const order = ["1 Introduction", "2.1 Samples", "Problem Statement"].map((heading) => html.indexOf(heading));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain(`>${MAP.roles.setup}<`);
    expect(html).toContain(`>${MAP.roles.method}<`);
    expect(html).toContain(MAP.page(1));
    expect(html).toContain(MAP.page(2));
    expect(html).toContain(MAP.minutes(3));
    // A subsection is indented by its depth, as the contents rail does.
    expect(html).toMatch(/padding-left:0\.75rem[^>]*>(?:(?!<li).)*2\.1 Samples/);
  });

  it("gives the unplaced section no role tag and a PDF-less section no page", () => {
    const html = render();
    const row = html.slice(html.indexOf("Problem Statement"));

    expect(Object.values(MAP.roles).some((label) => row.includes(`>${label}<`))).toBe(false);
    expect(row).not.toContain("p.");
  });

  it("keeps a row's paragraph lines folded until it is opened, then lists the openings, each linked to its paragraph", () => {
    const folded = render();
    expect(folded).not.toContain("Creep limits the life");
    expect(folded).toContain('aria-expanded="false"');

    const opened = render({ openRows: [0] });
    expect(opened).toContain('aria-expanded="true"');
    expect(opened).toContain('href="#paper-section-0-p0"');
    expect(opened).toContain("Creep limits the life of parts that run hot for years under load.");
    expect(opened).toContain('href="#paper-section-0-p2"');
    // A paragraph with no opening is not listed.
    expect(opened).not.toContain('href="#paper-section-0-p1"');
  });

  it("offers no fold control for a section without a single opening", () => {
    const html = render({ openRows: [2] });
    const row = html.slice(html.indexOf("Problem Statement") - 400, html.indexOf("Problem Statement"));

    // Two row toggles (the two sections with openings), none for this one.
    expect(html.match(/aria-label="(?:Show|Hide) how the paragraphs of [^"]*"/g)).toHaveLength(2);
    expect(html).not.toContain(MAP.openLines("Problem Statement"));
    expect(row).not.toContain("paper-section-2-p");
  });

  it("on a phone shows only the summary and 'show map', and expands in place", () => {
    const collapsed = render();
    expect(collapsed).toContain(MAP.show);
    // The table is hidden below 40rem and shown from it: CSS, no viewport hook.
    expect(collapsed).toMatch(/class="hidden sm:block"/);

    const expanded = render({ phoneOpen: true });
    expect(expanded).toContain(MAP.hide);
    expect(expanded).not.toMatch(/class="hidden sm:block"/);
  });

  it("renders nothing for a map with no sections", () => {
    expect(render({ map: { sections: [], totalMinutes: 0 } })).toBe("");
  });
});

// P1-05 (§1f.13, §1f.7; blueprint §3.3): the route on the map. Q1 reads the
// introduction and its paragraphs 0 and 2; Q2 is vague; Q3 skims the
// introduction (paragraph 1, which has no opening line) and the samples.
const route: RouteResult = {
  byQuestion: [
    {
      question: "Does LCO creep at H1-3?",
      vague: false,
      sections: {
        s1: {
          tier: "read",
          hits: [{ term: "lco", count: 3 }, { term: "h1-3", count: 3 }, { term: "creep", count: 2 }, { term: "grain", count: 1 }],
          evidence: "Grain boundaries are where most of the creep strain is thought to happen.",
          paragraphs: [0, 2],
        },
        s2: { tier: "none", hits: [], paragraphs: [] },
        s3: { tier: "none", hits: [], paragraphs: [] },
      },
    },
    { question: "What is it?", vague: true, sections: {} },
    {
      question: "Which samples were cut?",
      vague: false,
      sections: {
        s1: { tier: "skim", hits: [{ term: "cut", count: 1 }], paragraphs: [1] },
        s2: { tier: "skim", hits: [{ term: "samples", count: 1 }], evidence: "Twelve samples with different grain sizes were cut from one cast ingot.", paragraphs: [0] },
        s3: { tier: "none", hits: [], paragraphs: [] },
      },
    },
  ],
  vague: false,
};

/** The row header of the row whose heading is `heading`. */
const rowOf = (html: string, heading: string) => {
  const at = html.indexOf(`>${heading}</a>`);
  const start = html.lastIndexOf("<li", at);
  const end = html.indexOf("</li>", at);
  return html.slice(start, end);
};

describe("ReadingMapView — the route (P1-05)", () => {
  it("tints a row by its highest tier across the questions and titles it with their numbers", () => {
    const html = render({ route });

    expect(rowOf(html, "1 Introduction")).toMatch(/<div data-route="read" title="Q1, Q3" class="[^"]*bg-\[color:var\(--color-route-read\)\]/);
    expect(rowOf(html, "2.1 Samples")).toMatch(/<div data-route="skim" title="Q3" class="[^"]*bg-\[color:var\(--color-route-skim\)\]/);
    expect(rowOf(html, "Problem Statement")).not.toContain("data-route");
    expect(rowOf(html, "Problem Statement")).not.toContain("--color-route-");
  });

  it("states the facts beside a tinted row — tier and counts, as the reader typed the terms — and 'not mentioned' for the rest", () => {
    const html = render({ route });

    expect(rowOf(html, "1 Introduction")).toContain(`${ROUTE.tiers.read} · mentions LCO ×3, H1-3 ×3, creep ×2`);
    expect(rowOf(html, "2.1 Samples")).toContain(`${ROUTE.tiers.skim} · mentions samples ×1`);
    expect(rowOf(html, "Problem Statement")).toContain(`>${ROUTE.tiers.none}<`);
  });

  it("shows the evidence sentence, in the paper's serif, when a tinted row is opened", () => {
    const folded = render({ route });
    expect(folded).not.toContain("Grain boundaries are where most of the creep strain");

    const opened = render({ route, openRows: [0] });
    expect(opened).toMatch(/<p class="[^"]*font-reading[^"]*italic[^"]*">Grain boundaries are where most of the creep strain is thought to happen\.<\/p>/);
  });

  it("tints a paragraph line whose index a question at read or skim mentions", () => {
    const opened = render({ route, openRows: [0, 1] });

    expect(opened).toMatch(/<a href="#paper-section-0-p0" data-route="read" class="[^"]*bg-\[color:var\(--color-route-read\)\]/);
    expect(opened).toMatch(/<a href="#paper-section-0-p2" data-route="read"/);
    expect(opened).toMatch(/<a href="#paper-section-1-p0" data-route="skim"/);
    // Without a route the lines are as they were.
    expect(render({ openRows: [0, 1] })).not.toContain("data-route");
  });

  // P1-07 (§1f.18 b; A's O3): faint on the read tint is 2.69:1 — a tinted
  // line's opening is set in the muted ink, which is ≥ 4.5:1 on every tint.
  it("sets a tinted line's opening in muted ink and leaves an untinted line faint", () => {
    const lineClass = (html: string, href: string) => new RegExp(`<a href="${href}"[^>]*class="([^"]*)"`).exec(html)?.[1].split(" ") ?? [];
    const opened = render({ route, openRows: [0, 1] });

    for (const href of ["#paper-section-0-p0", "#paper-section-0-p2", "#paper-section-1-p0"]) {
      expect(lineClass(opened, href)).toContain("text-text-muted");
      expect(lineClass(opened, href)).not.toContain("text-text-faint");
    }
    const plain = render({ openRows: [0, 1] });
    for (const href of ["#paper-section-0-p0", "#paper-section-0-p2", "#paper-section-1-p0"]) {
      expect(lineClass(plain, href)).toContain("text-text-faint");
      expect(lineClass(plain, href)).not.toContain("text-text-muted");
    }
  });

  it("tints nothing and states nothing for a vague route", () => {
    const vague: RouteResult = { byQuestion: [{ question: "What is it?", vague: true, sections: {} }], vague: true };
    const html = render({ route: vague, openRows: [0, 1] });

    expect(html).not.toContain("data-route");
    expect(html).not.toContain(ROUTE.tiers.none);
    expect(html).toBe(render({ openRows: [0, 1] }));
  });

  it("for the gist: the role order, with no counts and no 'not mentioned'", () => {
    const html = render({ route: gistRoute(map) });

    expect(rowOf(html, "1 Introduction")).toMatch(new RegExp(`<div data-route="skim" title="${ASK.chips.gist}"`));
    expect(rowOf(html, "1 Introduction")).toContain(`>${ROUTE.tiers.skim}<`);
    expect(html).not.toContain("mentions");
    expect(html).not.toContain(ROUTE.tiers.none);
  });
});
