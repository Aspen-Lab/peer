import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { gistRoute, type ReadingMap, type RouteResult } from "@/lib/papers/reading-map";
import { ASK, MAP, ROUTE } from "./copy";
import type { DisplayRoute } from "./paper-body";
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

// P11-23 rule 4 (BACKLOG-104; ruling §1h.126), RE-AIMED: the summary line is drawn in parts (`SummaryLine`: each separator in a slot of its own, a clipped box),
// so its words are no longer one contiguous string of the markup. What a reader or a copy gets is the same string (`MAP.summary`'s own): these read it as the
// text of its box, the tags removed, and where a test looked the string up in the markup it looks the box up (`data-map-summary`).
const summaryText = (html: string): string => {
  const at = html.indexOf("data-map-summary");
  return at < 0 ? "" : html.slice(html.indexOf(">", at) + 1, html.indexOf("<button", at)).replace(/<[^>]*>/g, "");
};
/** The whole markup as text: the tags removed. */
const textOf = (html: string): string => html.replace(/<[^>]*>/g, "");

describe("ReadingMapView", () => {
  it("heads the table with the summary line", () => {
    const html = render();

    // The short form (no word count) is what it was.
    expect(MAP.summary(3, 4)).toBe("3 sections · about 4 min");
    expect(MAP.summary(1, 1)).toBe("1 section · about 1 min");
    expect(html).toContain(MAP.heading);
    // P7-14 (R5): the rendered line also carries the words the map's rows add up to (400 + 150 + 90).
    expect(summaryText(html)).toBe(MAP.summary(3, 4, 640));
    expect(html.indexOf("data-map-summary")).toBeLessThan(html.indexOf("1 Introduction"));
  });

  // P7-14 (R5, the owner's review): the contents rail and the count line under "The paper" are gone,
  // so the map's summary is the one place that says where the text was read from and how long it is.
  it("says where the text was read from and how many words it has, once", () => {
    expect(MAP.summary(21, 61, 10908, "PDF")).toBe("Read from PDF · 21 sections · 10,908 words · about 61 min");
    expect(MAP.summary(1, 1, 120, "arXiv HTML")).toBe("Read from arXiv HTML · 1 section · 120 words · about 1 min");
    expect(MAP.summary(2, 3, 1000)).toBe("2 sections · 1,000 words · about 3 min");

    const html = render({ source: "PDF" });
    expect(summaryText(html)).toBe("Read from PDF · 3 sections · 640 words · about 4 min");
    expect(textOf(html).split("Read from").length - 1).toBe(1);
    expect(textOf(render())).not.toContain("Read from");
  });

  it("is handed the reading's source label by the page, so 'Read from …' is said", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");
    const mount = /<ReadingMapView [^>]*\/>/.exec(page)?.[0] ?? "";

    expect(mount).toContain("source={reading.provenance.sourceLabel}");
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

  // P9-05 (X14, the feature walk): at 390 px the button shared a flex line with the summary sentence
  // and wrapped to "hide / map". The button is one unbreakable, unshrinkable word pair; the summary
  // span is the part that may wrap. The DOM cannot measure a wrap, so this pins the classes that
  // prevent it, on both states of the button.
  it("keeps the show/hide button on one line: whitespace-nowrap and shrink-0 in both states, the summary span left free to wrap (P9-05, X14)", () => {
    for (const [html, label] of [[render(), MAP.show], [render({ phoneOpen: true }), MAP.hide]] as const) {
      const button = new RegExp(`<button\\b[^>]*class="([^"]*)"[^>]*>${label}</button>`).exec(html);
      const classes = (button?.[1] ?? "").split(/\s+/);

      expect(button, `the ${label} button`).not.toBeNull();
      expect(classes).toContain("whitespace-nowrap");
      expect(classes).toContain("shrink-0");
      // Still the phone-only control it was.
      expect(classes).toContain("sm:hidden");
      // The summary sentence beside it is not the nowrap one: it is the part that wraps (its box and its lines; only a separator's slot and the
      // first word after it, which must not part, are nowrap pieces).
      const summary = /<span data-map-summary=""([^>]*)><span([^>]*)>/.exec(html);
      expect(summary, "the summary box and its lines").not.toBeNull();
      expect(summary?.[1] ?? "").not.toContain("whitespace-nowrap");
      expect(summary?.[2] ?? "").not.toContain("whitespace-nowrap");
    }
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
          tier: "strong",
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
        s1: { tier: "faint", hits: [{ term: "cut", count: 1 }], paragraphs: [1] },
        s2: { tier: "faint", hits: [{ term: "samples", count: 1 }], evidence: "Twelve samples with different grain sizes were cut from one cast ingot.", paragraphs: [0] },
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

    expect(rowOf(html, "1 Introduction")).toMatch(/<div data-route="strong" title="Q1, Q3" class="[^"]*bg-\[color:var\(--color-route-strong\)\]/);
    expect(rowOf(html, "2.1 Samples")).toMatch(/<div data-route="faint" title="Q3" class="[^"]*bg-\[color:var\(--color-route-faint\)\]/);
    expect(rowOf(html, "Problem Statement")).not.toContain("data-route");
    expect(rowOf(html, "Problem Statement")).not.toContain("--color-route-");
  });

  it("states the facts beside a tinted row — tier and counts, as the reader typed the terms — and 'not mentioned' for the rest", () => {
    const html = render({ route });

    expect(rowOf(html, "1 Introduction")).toContain(`${ROUTE.tiers.strong} · mentions LCO ×3, H1-3 ×3, creep ×2`);
    // P10-06 (re-aimed, §1c): the faintest tier states no tier word, only the counts.
    expect(rowOf(html, "2.1 Samples")).toContain(">mentions samples ×1<");
    expect(rowOf(html, "2.1 Samples")).not.toContain(`${ROUTE.tiers.faint} ·`);
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

    expect(opened).toMatch(/<a href="#paper-section-0-p0" data-route="strong" class="[^"]*bg-\[color:var\(--color-route-strong\)\]/);
    expect(opened).toMatch(/<a href="#paper-section-0-p2" data-route="strong"/);
    expect(opened).toMatch(/<a href="#paper-section-1-p0" data-route="faint"/);
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

    expect(rowOf(html, "1 Introduction")).toMatch(new RegExp(`<div data-route="faint" title="${ASK.chips.gist}"`));
    expect(rowOf(html, "1 Introduction")).toContain(`>${ROUTE.tiers.faint}<`);
    expect(html).not.toContain("mentions");
    expect(html).not.toContain(ROUTE.tiers.none);
  });
});

// P2-04b (§1g.15 finding 3): a Tier 2 `background` mark with no Tier 0 hits
// said the bare word "background" — a tier label with nothing behind it. It
// now says what the mark is for. With hits it is the Tier 0 fact, as before.
describe("ReadingMapView — the background mark's fact line (P2-04b)", () => {
  const backgroundRoute: DisplayRoute = {
    byQuestion: [
      {
        question: "Which samples were cut?",
        vague: false,
        sections: {
          s1: { tier: "background", hits: [], paragraphs: [] },
          s2: { tier: "background", hits: [{ term: "samples", count: 2 }], paragraphs: [0] },
          s3: { tier: "none", hits: [], paragraphs: [] },
        },
      },
    ],
    vague: false,
  };

  it("reads 'background · context for an answer' for a background mark with no hits", () => {
    const html = render({ route: backgroundRoute });

    expect(ROUTE.backgroundWhy).toBe("background · context for an answer");
    expect(rowOf(html, "1 Introduction")).toContain(`>${ROUTE.backgroundWhy}<`);
    expect(rowOf(html, "1 Introduction")).not.toContain(`>${ROUTE.tiers.background}<`);
    // Tinted with the middle token, and the title names the question.
    expect(rowOf(html, "1 Introduction")).toMatch(/<div data-route="background" title="Q1" class="[^"]*bg-\[color:var\(--color-route-background\)\]/);
  });

  it("keeps 'background · mentions …' when the mark has hits, and never shows the context line then", () => {
    const html = render({ route: backgroundRoute });

    expect(rowOf(html, "2.1 Samples")).toContain(`${ROUTE.tiers.background} · mentions samples ×2`);
    expect(rowOf(html, "2.1 Samples")).not.toContain(ROUTE.backgroundWhy);
  });

  it("leaves the other tiers' fact lines as they were", () => {
    const html = render({ route: backgroundRoute });

    // A section the route does not mention still says so; background's line is for background only.
    expect(rowOf(html, "Problem Statement")).toContain(`>${ROUTE.tiers.none}<`);
    expect(rowOf(html, "Problem Statement")).not.toContain(ROUTE.backgroundWhy);
    const skim: DisplayRoute = {
      byQuestion: [{ question: "Which samples were cut?", vague: false, sections: { s1: { tier: "faint", hits: [], paragraphs: [] } } }],
      vague: false,
    };
    expect(rowOf(render({ route: skim }), "1 Introduction")).toContain(`>${ROUTE.tiers.faint}<`);
    expect(render({ route: skim })).not.toContain(ROUTE.backgroundWhy);
  });
});

// P9-51 (F08; the owner's first report: the map gives each section's heading, page, word count, minutes and
// role): the row said its page and its minutes and left the words to the summary line. Now each row says its
// words — `p.N · W words · N min` — and, as in P9-22's rule, each part is a span of its own that carries its
// own separator, so a wrap never leaves a line ending on "·". The row's words are the count its minutes come
// from (`row.words`), and the rows' words are the ones the summary line adds up. The DOM cannot measure a wrap:
// these pin the text, the parts and the classes that prevent a bad break; the pixels are in the checkpoint.

/** What the row's meta is made of: the markup between the heading link and the row's closing tag. */
const metaMarkup = (html: string, heading: string) => {
  const at = html.indexOf(`>${heading}</a>`);
  const after = html.indexOf("</a>", at) + "</a>".length;
  return html.slice(after, html.indexOf("</div>", after));
};
/** The row's meta as a reader or a copy gets it: the text, the tags removed. */
const metaText = (html: string, heading: string) => metaMarkup(html, heading).replace(/<[^>]*>/g, "");
/** The parts, in order: [name, text]. */
const metaParts = (html: string, heading: string) =>
  [...metaMarkup(html, heading).matchAll(/<span data-meta-part="([a-z]+)"[^>]*>([^<]*)<\/span>/g)].map((m) => [m[1], m[2]] as const);

/** The separator slots, in order: the text of each `data-meta-slot` span. */
const metaSlots = (html: string, heading: string) =>
  [...metaMarkup(html, heading).matchAll(/<span data-meta-slot="" class="[^"]*">([^<]*)<\/span>/g)].map((m) => m[1]);

const wordsMap: ReadingMap = {
  sections: [
    { id: "w1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 1234, minutes: 6, paragraphs: [] },
    { id: "w2", heading: "2.1 Samples", canonical: "methods", role: "method", page: 12, words: 1, minutes: 1, paragraphs: [] },
    { id: "w3", heading: "Problem Statement", canonical: "body", role: "body", words: 90, minutes: 1, paragraphs: [] },
    { id: "w4", heading: "Appendix", canonical: "body", role: "body", words: 0, minutes: 0, paragraphs: [] },
    { id: "w5", heading: "3 Results", canonical: "results", role: "evidence", page: 4, words: 12345, minutes: 54, paragraphs: [] },
  ],
  totalMinutes: 62,
};
const renderWords = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadingMapView, { map: wordsMap, ...props }));

describe("ReadingMapView — each row says its words (P9-51, F08)", () => {
  it("says the section's words between its page and its minutes, as the summary line formats them", () => {
    const html = renderWords();

    expect(metaText(html, "1 Introduction")).toBe("setup · p.1 · 1,234 words · 6 min");
    expect(metaText(html, "3 Results")).toBe("evidence · p.4 · 12,345 words · 54 min");
    // The unplaced section has no role and no page: the words open its meta and nothing stands before them.
    expect(metaText(html, "Problem Statement")).toBe("90 words · 1 min");
  });

  it("says '1 word', not '1 words', and gives a section with no words its '0 words' and no minutes", () => {
    const html = renderWords();

    expect(metaText(html, "2.1 Samples")).toBe("method · p.12 · 1 word · 1 min");
    expect(metaText(html, "Appendix")).toBe("0 words");
  });

  it("is the same number the minutes come from: the row's words, whole, with the thousands as the summary line writes them", () => {
    const html = renderWords({ source: "PDF" });
    const written = (n: number) => `${n.toLocaleString("en-US")} words`;

    expect(MAP.summary(2, 3, 1234)).toContain("1,234 words");
    for (const row of wordsMap.sections.filter((r) => r.words > 1)) expect(metaText(html, row.heading)).toContain(written(row.words));
  });

  it("adds up, over twelve rows, to the words the summary line states", () => {
    const rows: ReadingMap["sections"] = Array.from({ length: 12 }, (_, i) => ({
      id: `t${i}`, heading: `${i + 1} Section ${i + 1}`, canonical: "body", role: "body", ...(i % 3 === 0 ? {} : { page: i + 1 }),
      words: 137 * (i + 1) + (i === 5 ? 1 : 0), minutes: Math.max(1, Math.ceil((137 * (i + 1)) / 230)), paragraphs: [],
    }));
    const html = renderToStaticMarkup(createElement(ReadingMapView, { map: { sections: rows, totalMinutes: 40 }, source: "PDF" }));
    const stated = Number(/([\d,]+) words · about/.exec(summaryText(html))?.[1].replace(/,/g, ""));
    const said = rows.map((row) => Number(/([\d,]+) words?/.exec(metaText(html, row.heading))?.[1].replace(/,/g, "")));

    expect(said).toHaveLength(12);
    expect(said.every((n) => Number.isFinite(n))).toBe(true);
    expect(said.reduce((sum, n) => sum + n, 0)).toBe(stated);
    expect(stated).toBe(rows.reduce((sum, row) => sum + row.words, 0));
  });

  // The row's spans used to run together in the text (`setupp.14 min`): the flex gap spaced them, not a space.
  it("reads, to a screen reader and a copy, as the words in order with their separators and spaces", () => {
    const html = renderWords();

    expect(metaText(html, "1 Introduction")).not.toMatch(/setupp\.|p\.\d\d* ?\d+ words|words\d/);
    expect(metaText(html, "1 Introduction")).toMatch(/^setup · p\.1 · 1,234 words · 6 min$/);
    for (const row of wordsMap.sections) {
      expect(metaMarkup(html, row.heading)).not.toMatch(/&nbsp;|<br|<wbr| |​|aria-/);
    }
  });

  // P11-23 rule 2 (A P11-21 X-A2; ruling §1h.120), RE-AIMED from "puts each part in a span of its own, with the separator as the first word of every
  // part but the first" and "keeps each part whole ... joins two parts with one plain space that stands outside both" (P9-51, which drew each
  // separator with the part AFTER it: a break left "· 11 min" at the start of a line). The separator belongs to the part BEFORE it now, in a slot of
  // its own beside the part, and the two runs ("setup · p.1", "1,234 words · 6 min") are the only places a line may break. What a reader or a copy gets
  // is unchanged (the test above), and so is every part's own span, its text and its `whitespace-nowrap`.
  it("puts each part in a span of its own, none of them opening with a separator, the separator after it in a slot of its own (the last part's slot empty)", () => {
    const html = renderWords();

    expect(metaParts(html, "1 Introduction")).toEqual([["role", "setup"], ["page", "p.1"], ["words", "1,234 words"], ["minutes", "6 min"]]);
    expect(metaParts(html, "Problem Statement")).toEqual([["words", "90 words"], ["minutes", "1 min"]]);
    expect(metaParts(html, "Appendix")).toEqual([["words", "0 words"]]);
    for (const row of wordsMap.sections) {
      const parts = metaParts(html, row.heading);
      expect(parts.length, row.heading).toBeGreaterThanOrEqual(1);
      for (const [, text] of parts) {
        // No part starts or ends with a separator or a space: the separator is not part of a part.
        expect(text, `${row.heading}: ${text}`).not.toMatch(/^[·\s]|[·\s]$/);
      }
      // The slots, in order: " ·" after every part but the last, which has an empty one (it only holds the room the box clips).
      expect(metaSlots(html, row.heading), row.heading).toEqual([...parts.slice(1).map(() => " ·"), ""]);
    }
  });

  it("keeps each part whole (whitespace-nowrap) and breaks a row only between its two runs: the plain space between them, none inside one", () => {
    const html = renderWords();
    const markup = metaMarkup(html, "1 Introduction");
    const classes = [...markup.matchAll(/<span data-meta-part="[a-z]+"[^>]*class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));

    expect(classes).toHaveLength(4);
    for (const each of classes) expect(each).toContain("whitespace-nowrap");
    // Two runs, each whole: where the section is, and how long it is. The one plain space between them is the row's only break.
    const runs = [...markup.matchAll(/<span data-meta-run="([a-z]+)" class="([^"]*)">/g)].map((m) => [m[1], m[2].split(/\s+/)] as const);
    expect(runs.map(([name]) => name)).toEqual(["place", "size"]);
    for (const [, cls] of runs) expect(cls).toContain("whitespace-nowrap");
    expect(markup).toContain('</span></span> <span data-meta-run="size"');
    // A row with only the words and minutes has the one run, and so no break at all.
    expect([...metaMarkup(html, "Problem Statement").matchAll(/data-meta-run="([a-z]+)"/g)].map((m) => m[1])).toEqual(["size"]);
  });

  // The copy: one function, the summary line's own number format (a thousands comma), "1 word" singular.
  it("writes a row's words with MAP.words: 'N words', a thousands comma, '1 word' singular, '0 words'", () => {
    expect(MAP.words(0)).toBe("0 words");
    expect(MAP.words(1)).toBe("1 word");
    expect(MAP.words(2)).toBe("2 words");
    expect(MAP.words(1234)).toBe("1,234 words");
    expect(MAP.words(12345)).toBe("12,345 words");
    // The same figure the summary line writes for the same count.
    expect(MAP.summary(1, 1, 1234)).toContain(MAP.words(1234));
    // The row's own words and minutes are not touched: `page` and `minutes` are what they were.
    expect(MAP.page(3)).toBe("p.3");
    expect(MAP.minutes(3)).toBe("3 min");
  });

  // The layout the words need: at 390 px a role, a page, the words and the minutes are ~230 px of
  // monospace, which beside a heading squeezed it to a sliver. The row wraps: the heading keeps a floor
  // of room (a basis), the meta drops under it, right-aligned as it sat beside it, and may itself wrap
  // between two parts. (Pixels: the checkpoint's measurement.)
  it("lets the row drop its meta under the heading rather than squeeze the heading: wrap on the heading-and-meta group, a floor on the heading, the meta free to shrink", () => {
    const html = renderWords();
    const row =
      /<div[^>]*class="([^"]*)"[^>]*><span aria-hidden="true" class="w-3 shrink-0"><\/span><div class="([^"]*)"><a href="#paper-section-2" class="([^"]*)">Problem Statement<\/a><span class="([^"]*)">/.exec(html);

    expect(row, "the row, the group of its heading link and its meta").not.toBeNull();
    const [, rowClasses, groupClasses, headingClasses, metaClasses] = (row ?? []).map((c) => (c ?? "").split(/\s+/));
    // The row stays one flex line (the fold toggle, then the group); the group is what wraps.
    expect(rowClasses).toContain("flex");
    expect(rowClasses).not.toContain("flex-wrap");
    expect(groupClasses).toEqual(expect.arrayContaining(["flex", "flex-wrap", "min-w-0", "flex-1"]));
    // The heading is still the flexible part, with a floor of room before the meta drops under it.
    expect(headingClasses).toContain("min-w-0");
    // At 390 px (a 330-px group) a 12rem floor leaves a long heading its whole line and the meta its own line
    // under it; a smaller floor left it 163 px, in three lines, beside the meta.
    const floor = Number(headingClasses.map((c) => /^flex-\[1_1_(\d+(?:\.\d+)?)rem\]$/.exec(c)?.[1]).find((n) => n !== undefined));
    expect(floor).toBeGreaterThanOrEqual(12);
    // The meta is no longer an unshrinkable run: it may shrink to the group and wrap between two parts, and
    // it stays at the right of the line (also when it is alone on a line).
    expect(metaClasses).not.toContain("shrink-0");
    expect(metaClasses).toContain("min-w-0");
    expect(metaClasses).toContain("max-w-full");
    expect(metaClasses).toContain("ml-auto");
    expect(metaClasses).toContain("text-right");
  });

  it("states the words on a row the same with a row open and with the table shown on a phone", () => {
    const base = metaText(renderWords(), "1 Introduction");

    expect(base).toBe("setup · p.1 · 1,234 words · 6 min");
    expect(metaText(renderWords({ openRows: [0] }), "1 Introduction")).toBe(base);
    expect(metaText(renderWords({ phoneOpen: true }), "1 Introduction")).toBe(base);
  });
});

describe("ReadingMapView — the map's toggles are touch targets (P9-51, N5)", () => {
  const TOUCH = "[@media(hover:none)]:min-h-11";
  const classesOf = (html: string, pattern: RegExp) => (pattern.exec(html)?.[1] ?? "").split(/\s+/).filter(Boolean);

  it("makes 'show map' and 'hide map' 44 px tall where there is no hover, the visible text unchanged", () => {
    for (const [html, label] of [[render(), MAP.show], [render({ phoneOpen: true }), MAP.hide]] as const) {
      const classes = classesOf(html, new RegExp(`<button\\b[^>]*class="([^"]*)"[^>]*>${label}</button>`));

      expect(classes, `the ${label} button`).toContain(TOUCH);
      // The visible text is the label and nothing else.
      expect(html).toMatch(new RegExp(`<button[^>]*>${label}</button>`));
    }
  });

  it("makes each row's fold toggle ('+' / '−') 44 px tall where there is no hover, its glyph and its name unchanged", () => {
    const opened = render({ openRows: [0] });
    const toggles = [...opened.matchAll(/<button\b[^>]*aria-label="((?:Show|Hide) how the paragraphs of [^"]*)"[^>]*class="([^"]*)"[^>]*>([^<]*)<\/button>/g)];

    expect(toggles.map((m) => m[3]).sort()).toEqual(["+", "−"].sort());
    for (const [, name, classes] of toggles) expect(classes.split(/\s+/), name).toContain(TOUCH);
  });

  // The floor is on the fold toggle, which is the row's first item. With the heading and the meta in
  // one group beside it, a row whose meta dropped under the heading is as tall as the floor (the toggle
  // centred against the two lines), not the floor plus the meta line. With a mouse the row is as it was.
  it("centres the row's toggle against its heading and meta where there is no hover, so the floor does not stack on the wrapped meta", () => {
    const html = render({ openRows: [0] });
    const row = /<div class="([^"]*)"><button\b[^>]*aria-expanded/.exec(html);
    const rowClasses = (row?.[1] ?? "").split(/\s+/).filter(Boolean);

    expect(row, "a row with a fold toggle").not.toBeNull();
    expect(rowClasses).toContain("flex");
    expect(rowClasses).toContain("items-baseline");
    expect(rowClasses).toContain("[@media(hover:none)]:items-center");
    // Behind the media query only: a bare items-center would move the mouse's rows.
    expect(rowClasses).not.toContain("items-center");
  });

  it("leaves the mouse's boxes alone: the floor is behind hover:none, never a bare min-h-11", () => {
    for (const html of [render(), render({ phoneOpen: true }), render({ openRows: [0] })]) {
      const buttons = [...html.matchAll(/<button\b[^>]*class="([^"]*)"/g)].map((m) => m[1].split(/\s+/));

      expect(buttons.length).toBeGreaterThan(0);
      for (const classes of buttons) {
        expect(classes).not.toContain("min-h-11");
        expect(classes.filter((c) => /^min-h-/.test(c) && !c.startsWith("["))).toEqual([]);
      }
    }
  });

  it("is still the same toggles: 'show map' / 'hide map' is the phone's control, each fold keeps its name and aria-expanded", () => {
    const html = render({ openRows: [0] });

    expect(html).toMatch(/aria-expanded="false"[^>]*>show map<\/button>/);
    expect(html).toContain(`aria-label="${MAP.closeLines("1 Introduction")}"`);
    expect(html).toContain(`aria-label="${MAP.openLines("2.1 Samples")}"`);
    expect(html.match(/aria-expanded="(?:true|false)"/g)).toHaveLength(3);
  });
});

// P10-04 (review 3.3; A10): the map shows the paper's own hierarchy. "2. RESULTS AND DISCUSSION" and
// "4. EXPERIMENTAL SECTION" are rows (group rows: no paragraphs of their own), their subsections indented
// one step per level under them, in one list; a group row says the sum of its children's words and minutes
// and has no fold of its own.
const treeMap: ReadingMap = {
  sections: [
    { id: "g0", heading: "1. INTRODUCTION", canonical: "introduction", role: "setup", page: 1, level: 1, words: 400, minutes: 3, paragraphs: [{ index: 0, opening: "Cathodes fade with use in ways nobody has traced." }] },
    { id: "g1", heading: "2. RESULTS AND DISCUSSION", canonical: "results", role: "evidence", page: 3, level: 1, words: 0, minutes: 0, paragraphs: [] },
    { id: "g2", heading: "2.1. Growth", canonical: "results", role: "evidence", page: 3, level: 2, parentId: "g1", words: 500, minutes: 3, paragraphs: [{ index: 0, opening: "Crystals grew as faceted plates from the molten bath." }] },
    { id: "g3", heading: "2.2. Form", canonical: "results", role: "evidence", page: 5, level: 2, parentId: "g1", words: 290, minutes: 2, paragraphs: [{ index: 0, opening: "Plates meet at twin boundaries that carry strain." }] },
    { id: "g4", heading: "2.2.1. Twins", canonical: "results", role: "evidence", page: 6, level: 3, parentId: "g3", words: 100, minutes: 1, paragraphs: [{ index: 0, opening: "Twin planes repeat every few nanometres along the plate." }] },
    { id: "g5", heading: "3. CONCLUSION", canonical: "conclusion", role: "interpretation", page: 9, level: 1, words: 60, minutes: 1, paragraphs: [{ index: 0, opening: "Shape sets the life of the cathode." }] },
    { id: "g6", heading: "4. EXPERIMENTAL SECTION", canonical: "methods", role: "method", page: 15, level: 1, words: 0, minutes: 0, paragraphs: [] },
    { id: "g7", heading: "4.1. Material Growth", canonical: "methods", role: "method", page: 15, level: 2, parentId: "g6", words: 900, minutes: 5, paragraphs: [{ index: 0, opening: "Films were grown on gold from a molten hydroxide bath." }] },
    { id: "g8", heading: "4.2. Raman Spectroscopy", canonical: "methods", role: "method", page: 17, level: 2, parentId: "g6", words: 662, minutes: 4, paragraphs: [{ index: 0, opening: "Spectra were collected across the film with a laser." }] },
  ],
  totalMinutes: 17,
};
const renderTree = (props: Partial<Parameters<typeof ReadingMapView>[0]> = {}) =>
  renderToStaticMarkup(createElement(ReadingMapView, { map: treeMap, ...props }));

describe("ReadingMapView — the paper's hierarchy (P10-04, A10)", () => {
  it("lists the group rows in the paper's order, each directly before its first child", () => {
    const html = renderTree();
    const at = (heading: string) => html.indexOf(`>${heading}</a>`);

    expect(treeMap.sections.map((r) => at(r.heading)).every((n, i, all) => n > 0 && (i === 0 || n > all[i - 1]))).toBe(true);
    expect(html).toContain('href="#paper-section-1"');
    expect(html).toContain('href="#paper-section-6"');
  });

  it("says a group row's heading, role, page and the sum of its children's words and minutes", () => {
    const html = renderTree();

    // 500 + 290 + 100 = 890 words; the minutes are the summed words' (890 / 180, rounded up), as the map's total is.
    expect(metaText(html, "2. RESULTS AND DISCUSSION")).toBe("evidence · p.3 · 890 words · 5 min");
    // 900 + 662 = 1,562 words, 9 minutes (the children's own 5 + 4 agree here; the group above is where the two differ).
    expect(metaText(html, "4. EXPERIMENTAL SECTION")).toBe("method · p.15 · 1,562 words · 9 min");
    // A row with paragraphs of its own says its own.
    expect(metaText(html, "2.2. Form")).toBe("evidence · p.5 · 290 words · 2 min");
  });

  it("gives a group row no fold of its own, and its children theirs", () => {
    const html = renderTree();

    expect(html).not.toContain(MAP.openLines("2. RESULTS AND DISCUSSION"));
    expect(html).not.toContain(MAP.openLines("4. EXPERIMENTAL SECTION"));
    expect(html).toContain(MAP.openLines("2.1. Growth"));
    expect(html).toContain(MAP.openLines("4.2. Raman Spectroscopy"));
  });

  it("indents a row one step per level, in one list — not a nested table", () => {
    const html = renderTree();
    const pad = (heading: string) => /padding-left:([\d.]+)rem/.exec(rowOf(html, heading))?.[1];

    expect([pad("1. INTRODUCTION"), pad("2. RESULTS AND DISCUSSION")]).toEqual(["0", "0"]);
    expect([pad("2.1. Growth"), pad("2.2. Form"), pad("4.1. Material Growth")]).toEqual(["0.75", "0.75", "0.75"]);
    expect(pad("2.2.1. Twins")).toBe("1.5");
    expect(rowOf(html, "2.2.1. Twins")).toContain('data-level="3"');
    expect(rowOf(html, "2.1. Growth")).toContain('data-level="2"');
    // One <ol> for the rows; no row is a list inside another while the paragraph lines are folded.
    expect(html.match(/<ol\b/g)).toHaveLength(1);
    expect(html.match(/<li\b/g)).toHaveLength(treeMap.sections.length);
  });

  it("indents by the stored level, not the heading's number", () => {
    const html = renderToStaticMarkup(createElement(ReadingMapView, {
      map: { sections: [{ ...treeMap.sections[0], heading: "Overview", level: 1 }, { ...treeMap.sections[2], heading: "Detail without a number", level: 2 }], totalMinutes: 6 },
    }));

    expect(/padding-left:([\d.]+)rem/.exec(rowOf(html, "Detail without a number"))?.[1]).toBe("0.75");
  });

  it("counts the group rows as sections and adds the words over the leaves only", () => {
    const html = renderTree({ source: "PDF" });
    const leaves = 400 + 500 + 290 + 100 + 60 + 900 + 662;

    expect(summaryText(html)).toBe(MAP.summary(9, 17, leaves, "PDF"));
    // The group rows' summed words are not in the line: 890 + 1,562 more would double count.
    expect(MAP.summary(9, 17, leaves, "PDF")).toContain("2,912 words");
  });

  it("opens a child's paragraph lines and links them to the body section of the same index", () => {
    const html = renderTree({ openRows: [7] });

    expect(html).toContain('href="#paper-section-7-p0"');
    expect(html).toContain("Films were grown on gold");
  });

  it("states no 'not mentioned' on a group row when questions are asked, only on rows that have text", () => {
    const asked: RouteResult = {
      byQuestion: [{
        question: "Which films were grown?",
        vague: false,
        sections: {
          g2: { tier: "strong", hits: [{ term: "films", count: 4 }], paragraphs: [0] },
          g1: { tier: "none", hits: [], paragraphs: [] },
          g6: { tier: "none", hits: [], paragraphs: [] },
        },
      }],
      vague: false,
    };
    const html = renderTree({ route: asked });

    expect(rowOf(html, "2. RESULTS AND DISCUSSION")).not.toContain(ROUTE.tiers.none);
    expect(rowOf(html, "4. EXPERIMENTAL SECTION")).not.toContain(ROUTE.tiers.none);
    expect(rowOf(html, "3. CONCLUSION")).toContain(ROUTE.tiers.none);
  });

  it("follows a row's link through the page's reveal when the body is on the other tab", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const view = readFileSync(resolve(process.cwd(), "src/components/reader/reading-map.tsx"), "utf8");
    const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");

    expect(view).toMatch(/onClick=\{\(event\) => followSectionLink\(event, /);
    expect(/<ReadingMapView [^>]*\/>/.exec(page)?.[0] ?? "").toContain("reveal={reveal}");
  });
});

// P10-12 (A15; ruling §1h.87 (g)): in the keyed map of an unheaded paper each paragraph line is drawn
// once. The doubled line the readers saw was never a second row: it was Peer's gist, which the guide's
// reply can give as the paragraph's own first words, drawn in the label face after the opening — the
// same words twice. A gist that only repeats the line adds nothing and is not drawn; a gist that says
// something else is, as it was. The no-key map has no gists and is untouched.
describe("ReadingMapView — an unheaded paper's keyed map draws each paragraph line once (P10-12, A15)", () => {
  const OPENINGS = [
    "Survey paragraph 0 looks at the tide pools.",
    "Survey paragraph 1 looks at the kelp beds.",
    "Survey paragraph 2 looks at the gull colonies.",
    "Survey paragraph 3 looks at the sand ripples.",
    "Survey paragraph 4 looks at the salt marsh.",
    "Survey paragraph 5 looks at the mussel banks.",
  ];
  const part = (n: number, role: "introduction" | "results", from: number, to: number) => ({
    id: `s0~${n}`, heading: role === "introduction" ? "Introduction" : "Results", canonical: role, role: role === "introduction" ? "setup" : "evidence",
    level: 1, words: 60, minutes: 1,
    paragraphs: OPENINGS.slice(from, to + 1).map((opening, k) => ({ index: from + k, opening })),
    part: { sectionId: "s0", sectionIndex: 0, role, from, to },
  });
  const partitioned = { sections: [part(0, "introduction", 0, 2), part(1, "results", 3, 5)], totalMinutes: 2 } as unknown as ReadingMap;
  // What the stub's guide answers, and a model may: the paragraph's own first eight words.
  const echoed = Object.fromEntries(OPENINGS.map((opening, k) => [k, opening.split(/\s+/).slice(0, 8).join(" ")]));
  const lineOf = (html: string, k: number): string => {
    // The line's own `<li>` (a group row's heading link points at its first paragraph too).
    const start = html.indexOf(`<li><a href="#paper-section-0-p${k}"`);
    return html.slice(start, html.indexOf("</li>", start));
  };
  const renderKeyed = (gists: Record<number, string>) =>
    renderToStaticMarkup(createElement(ReadingMapView, { map: partitioned, gists: { s0: gists }, openRows: [0, 1] }));

  it("counts one element per paragraph, in the reading serif, when the gist only repeats the opening", () => {
    const html = renderKeyed(echoed);

    for (let k = 0; k < OPENINGS.length; k += 1) {
      const line = lineOf(html, k);
      expect(line.split(OPENINGS[k]).length - 1).toBe(1);
      expect(line.match(/<a /g)?.length).toBe(1);
      expect(line).toContain('class="font-reading text-body-sm leading-[1.45]');
      expect(line).not.toContain("annotation");
      expect(line).not.toContain("role=\"note\"");
    }
    expect(html.match(/role="note"/g)).toBeNull();
    // The rows are as they were: two group rows tagged as Peer's reading, three lines each.
    expect(html.match(/<li data-level/g)?.length).toBe(2);
    expect(html.match(/<li><a href="#paper-section-0-p\d"/g)?.length).toBe(OPENINGS.length);
  });

  it("drops a repeat however it is cased or punctuated, and a gist that is the line's start", () => {
    const html = renderKeyed({
      0: "SURVEY paragraph 0 looks at the tide pools",
      1: "survey paragraph 1 looks at the kelp beds.",
      2: "Survey paragraph 2 looks at",
    });

    for (const k of [0, 1, 2]) expect(lineOf(html, k)).not.toContain("role=\"note\"");
  });

  it("still draws a gist that says something else, after the line, as before", () => {
    const html = renderKeyed({ ...echoed, 1: "Kelp beds are counted twice.", 4: "Salt marsh sites, visited in one tide." });

    expect(lineOf(html, 1)).toContain('role="note"');
    expect(lineOf(html, 1)).toContain("Kelp beds are counted twice.");
    expect(lineOf(html, 4)).toContain("Salt marsh sites, visited in one tide.");
    expect(lineOf(html, 0)).not.toContain('role="note"');
    expect(html.match(/role="note"/g)?.length).toBe(2);
  });

  it("is the no-key map's line, byte for byte, when every gist is a repeat", () => {
    const plain = renderToStaticMarkup(createElement(ReadingMapView, { map: partitioned, openRows: [0, 1] }));

    expect(renderKeyed(echoed)).toBe(plain);
  });
});
