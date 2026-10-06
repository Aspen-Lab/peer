import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import { GIST_QUESTION, gistRoute, routeByQuestions, type RouteResult } from "@/lib/papers/reading-map";
import type { Paper } from "@/types";
import { ASK, MAP, ROUTE } from "./copy";
import { HEADING_MARK, PaperBody, ROUTE_TINT, mergeQuestionRoute, questionRouteOverlay, sectionMark } from "./paper-body";
import { PaperContents } from "./paper-contents";
import { ReadingMapView, readingRoute } from "./reading-map";

// P1-05 (§1f.13, §1f.14; blueprint §3.3 目录颜色): the route on the page.
// A section takes its highest tier across the questions; the tint is a
// background on the contents row, the body heading and the map; the body
// itself is never hidden, collapsed, greyed, reordered or wrapped.

const paper: Paper = {
  id: "upload:00000000000000aa", title: "T", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};
const doc: ExtractedDocument = {
  source: "pdf",
  pageCount: 3,
  figureCaptions: [],
  sections: [
    { id: "s0", heading: "Abstract", canonical: "abstract", text: "Not in the body." },
    {
      id: "s1", heading: "1 Introduction", canonical: "introduction", page: 1,
      text: "Quillwort cathodes are common in small cells and wear quickly.\n\nThe quillwort lattice cracks when the cells fade over many cycles.",
    },
    { id: "s2", heading: "2 Methods", canonical: "methods", page: 2, text: "Twelve quillwort cells were cycled at a fixed current for a month." },
    { id: "s3", heading: "3 Results", canonical: "results", page: 3, text: "Capacity fell by a fifth after five hundred cycles at room temperature." },
  ],
};
const fullText: FullTextResult = {
  status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 },
};
const reading = buildReading(paper, fullText, new Date("2026-10-05T00:00:00.000Z"));
const ids = reading.body.map((section) => section.id);

const section = (tier: "read" | "skim" | "none", paragraphs: number[] = [], extra: object = {}) => ({
  tier, hits: [], paragraphs, ...extra,
});

/** Q1 reads s1 and skims s2; Q2 is vague; Q3 skims s1 and s3. */
const ROUTE_RESULT: RouteResult = {
  byQuestion: [
    {
      question: "Does the LCO lattice crack at H1-3?",
      vague: false,
      sections: {
        [ids[0]]: section("read", [1], { hits: [{ term: "lco", count: 3 }, { term: "h1-3", count: 3 }, { term: "lattice", count: 2 }, { term: "crack", count: 1 }], evidence: "The quillwort lattice cracks when the cells fade over many cycles." }),
        [ids[1]]: section("skim", [0], { hits: [{ term: "lco", count: 1 }], evidence: "Twelve quillwort cells were cycled at a fixed current for a month." }),
        [ids[2]]: section("none"),
      },
    },
    { question: "What is it?", vague: true, sections: {} },
    {
      question: "Where do cells fade?",
      vague: false,
      sections: {
        [ids[0]]: section("skim", [0, 1], { hits: [{ term: "fade", count: 1 }], evidence: "The quillwort lattice cracks when the cells fade over many cycles." }),
        [ids[1]]: section("none"),
        [ids[2]]: section("skim", [0], { hits: [{ term: "fade", count: 1 }] }),
      },
    },
  ],
  vague: false,
};

describe("the tier → tint table (§1f.13)", () => {
  it("maps read, background and skim to their own token as a background, and none to no style", () => {
    expect(ROUTE_TINT.read).toBe("bg-[color:var(--color-route-read)]");
    expect(ROUTE_TINT.background).toBe("bg-[color:var(--color-route-background)]");
    expect(ROUTE_TINT.skim).toBe("bg-[color:var(--color-route-skim)]");
    expect(ROUTE_TINT.none).toBeNull();
    // Background only — never a text colour.
    for (const tint of Object.values(ROUTE_TINT)) if (tint) expect(tint).toMatch(/^bg-\[color:var\(--color-route-[a-z]+\)\]$/);
  });

  it("names the tiers exactly as the reader sees them", () => {
    expect(ROUTE.tiers).toEqual({ read: "read", background: "background", skim: "skim", none: "not mentioned" });
    expect(ROUTE.vague).toBe("Ask something more specific and Peer can point you to the right sections.");
  });
});

describe("the Tier 2 question-answer overlay (P2-04)", () => {
  const answers = [
    {
      question: "Does the LCO lattice crack at H1-3?",
      verdict: "answered" as const,
      answers: [{ text: "Peer answer.", evidence: "The quillwort lattice cracks when the cells fade over many cycles.", sectionId: ids[0] }],
      readNext: [{ sectionId: ids[1], why: "Context.", kind: "background" as const }],
    },
    {
      question: "Where do cells fade?",
      verdict: "partly" as const,
      answers: [{ text: "Peer answer two.", evidence: "Capacity fell by a fifth after five hundred cycles at room temperature.", sectionId: ids[2] }],
      readNext: [{ sectionId: ids[0], why: "Already answered.", kind: "answer" as const }],
    },
  ];

  it("derives read marks from verified answer evidence and background marks from Read next", () => {
    const overlay = questionRouteOverlay(answers)!;

    expect(sectionMark(overlay, ids[0])).toMatchObject({
      tier: "read",
      title: "Q1, Q2",
      evidence: "The quillwort lattice cracks when the cells fade over many cycles.",
    });
    expect(sectionMark(overlay, ids[1])).toMatchObject({ tier: "background", title: "Q1" });
    expect(sectionMark(overlay, ids[2])).toMatchObject({ tier: "read", title: "Q2" });
  });

  it("merges against Tier 0 by read > background > skim > none, preserves Tier 0 without model data, and retains multiple question titles", () => {
    const merged = mergeQuestionRoute(ROUTE_RESULT, questionRouteOverlay(answers));

    expect(sectionMark(merged, ids[0])).toMatchObject({ tier: "read", title: "Q1, Q3" });
    expect(sectionMark(merged, ids[0])?.evidence).toBe("The quillwort lattice cracks when the cells fade over many cycles.");
    expect(sectionMark(merged, ids[1])).toMatchObject({ tier: "background", title: "Q1" });
    expect(sectionMark(merged, ids[2])).toMatchObject({ tier: "read", title: "Q3" });
    expect(mergeQuestionRoute(ROUTE_RESULT, undefined)).toEqual(ROUTE_RESULT);
  });

  it("feeds the one merged display route to contents, map, and body consumers, including the background token", () => {
    const merged = mergeQuestionRoute(ROUTE_RESULT, questionRouteOverlay(answers));
    // P2-04 keeps `background` local to the display route; the existing
    // contents/map signatures stay Tier-0-shaped at this boundary.
    const display = merged as RouteResult;
    const contents = renderToStaticMarkup(createElement(PaperContents, { reading, route: display }));
    const mapHtml = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map!, route: display }));
    const body = renderToStaticMarkup(createElement(PaperBody, { reading, route: merged }));

    for (const html of [contents, mapHtml, body]) {
      expect(html).toContain('data-route="background"');
      expect(html).toContain(ROUTE_TINT.background);
    }
  });
});

describe("a section's mark across the questions (§1f.13)", () => {
  it("takes the highest tier, and lists the questions that tinted it", () => {
    const first = sectionMark(ROUTE_RESULT, ids[0]);
    expect(first?.tier).toBe("read");
    expect(first?.title).toBe("Q1, Q3");
    expect(ROUTE.questions([1, 3])).toBe("Q1, Q3");

    expect(sectionMark(ROUTE_RESULT, ids[1])).toMatchObject({ tier: "skim", title: "Q1" });
    expect(sectionMark(ROUTE_RESULT, ids[2])).toMatchObject({ tier: "skim", title: "Q3" });
  });

  it("gives no mark to a section no question mentions, to an unknown section, to no route and to a vague route", () => {
    const none: RouteResult = {
      byQuestion: [{ question: "Where do cells fade?", vague: false, sections: { [ids[0]]: section("none") } }],
      vague: false,
    };
    expect(sectionMark(none, ids[0])).toBeNull();
    expect(sectionMark(ROUTE_RESULT, "nowhere")).toBeNull();
    expect(sectionMark(undefined, ids[0])).toBeNull();
    expect(sectionMark({ byQuestion: [{ question: "What is it?", vague: true, sections: {} }], vague: true }, ids[0])).toBeNull();
  });

  it("keeps the evidence of the highest tier, the hits as the reader typed them, and each paragraph at its highest tier", () => {
    const first = sectionMark(ROUTE_RESULT, ids[0]);

    expect(first?.evidence).toBe("The quillwort lattice cracks when the cells fade over many cycles.");
    expect(first?.hits.map((hit) => hit.term)).toEqual(["LCO", "H1-3", "lattice", "crack", "fade"]);
    expect(ROUTE.mentions(first?.hits ?? [])).toBe("mentions LCO ×3, H1-3 ×3, lattice ×2");
    expect(first?.paragraphs.get(0)).toBe("skim");
    expect(first?.paragraphs.get(1)).toBe("read");
  });

  it("titles a gist row by the gist, not by a question number", () => {
    const gist = gistRoute(reading.map!);
    const results = reading.map!.sections.findIndex((row) => row.role === "evidence");

    expect(gist.byQuestion[0].question).toBe(GIST_QUESTION);
    expect(sectionMark(gist, ids[results])).toMatchObject({ tier: "read", title: ASK.chips.gist, hits: [] });
  });
});

describe("the route the page computes (§1f.13)", () => {
  const asked = (items: string[], gist = false) => ({ items, gist, updatedAt: "2026-10-05T00:00:00.000Z" });

  it("routes the typed questions, or the gist when none is typed, or nothing", () => {
    const questions = ["How does quillwort fade?"];
    expect(readingRoute(reading, asked(questions))).toEqual(routeByQuestions(reading.map!, reading.body, questions));
    expect(readingRoute(reading, asked(questions, true))).toEqual(routeByQuestions(reading.map!, reading.body, questions));
    expect(readingRoute(reading, asked([], true))).toEqual(gistRoute(reading.map!));
    expect(readingRoute(reading, asked([]))).toBeUndefined();
    expect(readingRoute(reading, undefined)).toBeUndefined();
    expect(readingRoute({ ...reading, map: undefined }, asked(questions))).toBeUndefined();
    expect(readingRoute(null, asked(questions))).toBeUndefined();
  });
});

describe("the contents rail and the body heading carry the mark", () => {
  it("tints a contents row by its tier and titles it with the question numbers", () => {
    const html = renderToStaticMarkup(createElement(PaperContents, { reading, route: ROUTE_RESULT }));

    expect(html).toMatch(/<a[^>]*data-route="read"[^>]*title="Q1, Q3"[^>]*>1 Introduction<\/a>/);
    expect(html).toMatch(/<a[^>]*data-route="skim"[^>]*title="Q1"[^>]*>2 Methods<\/a>/);
    expect(html).toMatch(/<a[^>]*data-route="skim"[^>]*title="Q3"[^>]*>3 Results<\/a>/);
    expect(html).toContain(ROUTE_TINT.read);
    expect(html).toContain(ROUTE_TINT.skim);
  });

  it("leaves the contents untouched without a route, and for a section no question mentions", () => {
    const plain = renderToStaticMarkup(createElement(PaperContents, { reading }));
    expect(plain).not.toContain("data-route");
    expect(plain).not.toContain("title=");
    expect(plain).not.toContain("--color-route-");

    const onlyFirst: RouteResult = {
      byQuestion: [{ question: "q", vague: false, sections: { [ids[0]]: section("skim"), [ids[1]]: section("none") } }],
      vague: false,
    };
    const html = renderToStaticMarkup(createElement(PaperContents, { reading, route: onlyFirst }));
    expect(html.match(/data-route=/g)).toHaveLength(1);
    expect(html).toMatch(/<a href="#paper-section-1" class="[^"]*">2 Methods<\/a>/);
  });

  it("marks the body's section headings and nothing else in the body", () => {
    const html = renderToStaticMarkup(createElement(PaperBody, { reading, route: ROUTE_RESULT }));

    expect(html).toMatch(/<h3 [^>]*data-route="read"[^>]*>1 Introduction<\/h3>/);
    expect(html).toMatch(/<h3 [^>]*data-route="skim"[^>]*>2 Methods<\/h3>/);
    expect(html.match(/data-route=/g)).toHaveLength(3);
    // The paragraphs are never tinted: only the headings are.
    expect(html).not.toMatch(/<(?:p|div)[^>]*data-route/);
  });
});

describe("the body with a route is the body without one (§3d 8: nothing hidden, collapsed, greyed or reordered)", () => {
  const without = renderToStaticMarkup(createElement(PaperBody, { reading }));
  const withRoute = renderToStaticMarkup(createElement(PaperBody, { reading, route: ROUTE_RESULT }));
  const gist = renderToStaticMarkup(createElement(PaperBody, { reading, route: gistRoute(reading.map!) }));
  const text = (html: string) => html.replace(/<[^>]+>/g, "");
  const tags = (html: string) => [...html.matchAll(/<\/?([a-z0-9]+)/g)].map((match) => match[0]);
  const hiding = (html: string) => (html.match(/hidden|display:\s*none|opacity|invisible|line-clamp|max-h-|overflow-hidden/g) ?? []).length;
  const ROUTE_MARK_CLASSES = new Set([...(Object.values(ROUTE_TINT).filter(Boolean) as string[]), ...HEADING_MARK.split(" ")]);
  /** Remove exactly what a route may add: the attribute, and the mark's classes. */
  const unmarked = (html: string) =>
    html
      .replace(/ data-route="[a-z]+"/g, "")
      .replace(/ class="([^"]*)"/g, (_, classes: string) => {
        const kept = classes.split(" ").filter((name) => !ROUTE_MARK_CLASSES.has(name));
        return ` class="${kept.join(" ")}"`;
      });

  for (const [name, html] of [["questions", withRoute], ["the gist", gist]] as const) {
    it(`${name}: identical text, identical element order, no hiding, and only a data-route and a class differ`, () => {
      expect(html).not.toBe(without);
      expect(text(html)).toBe(text(without));
      expect(tags(html)).toEqual(tags(without));
      expect(hiding(html)).toBe(hiding(without));
      expect(unmarked(html)).toBe(without);
    });
  }
});

describe("the route copy never tells the reader not to read (§1f.13, §3d 8)", () => {
  /** Every string the ask, map and route copy can produce. */
  function strings(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (typeof value === "function") {
      const samples: unknown[][] = [[1, 1], [2, 3], ["2 Methods"], [[{ term: "LCO", count: 3 }]], [[1, 3]]];
      return samples.flatMap((args) => {
        try {
          const out: unknown = value(...args);
          return typeof out === "string" ? [out] : [];
        } catch {
          return [];
        }
      });
    }
    if (value && typeof value === "object") return Object.values(value).flatMap(strings);
    return [];
  }

  it("has no 'skip', 'don't read', 'ignore' or 'not worth' in the ask, map or route copy or the tier labels", () => {
    const all = [...strings(ASK), ...strings(MAP), ...strings(ROUTE)];

    expect(all.length).toBeGreaterThan(30);
    expect(all).toContain("not mentioned");
    for (const line of all) expect(line).not.toMatch(/skip|don['’]t read|ignore|not worth/i);
  });
});
