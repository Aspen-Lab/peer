import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import type { FullTextResult } from "@/lib/papers/full-text";
import { GIST_QUESTION, gistRoute, routeByQuestions, type RouteResult } from "@/lib/papers/reading-map";
import type { Paper } from "@/types";
import { ASK, EXPLAIN, FOR_YOUR_QUESTIONS, MAP, ROUTE } from "./copy";
import { HEADING_MARK, PaperBody, ROUTE_TINT, mergeQuestionRoute, questionRouteOverlay, sectionMark } from "./paper-body";
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

const section = (tier: "strong" | "faint" | "none", paragraphs: number[] = [], extra: object = {}) => ({
  tier, hits: [], paragraphs, ...extra,
});

/** Q1 marks s1 strong and s2 faint; Q2 is vague; Q3 marks s1 and s3 faint. */
const ROUTE_RESULT: RouteResult = {
  byQuestion: [
    {
      question: "Does the LCO lattice crack at H1-3?",
      vague: false,
      sections: {
        [ids[0]]: section("strong", [1], { hits: [{ term: "lco", count: 3 }, { term: "h1-3", count: 3 }, { term: "lattice", count: 2 }, { term: "crack", count: 1 }], evidence: "The quillwort lattice cracks when the cells fade over many cycles." }),
        [ids[1]]: section("faint", [0], { hits: [{ term: "lco", count: 1 }], evidence: "Twelve quillwort cells were cycled at a fixed current for a month." }),
        [ids[2]]: section("none"),
      },
    },
    { question: "What is it?", vague: true, sections: {} },
    {
      question: "Where do cells fade?",
      vague: false,
      sections: {
        [ids[0]]: section("faint", [0, 1], { hits: [{ term: "fade", count: 1 }], evidence: "The quillwort lattice cracks when the cells fade over many cycles." }),
        [ids[1]]: section("none"),
        [ids[2]]: section("faint", [0], { hits: [{ term: "fade", count: 1 }] }),
      },
    },
  ],
  vague: false,
};

describe("the tier → tint table (§1f.13)", () => {
  it("maps strong, medium, faint and background to their own token as a background, and none to no style", () => {
    expect(ROUTE_TINT.strong).toBe("bg-[color:var(--color-route-strong)]");
    expect(ROUTE_TINT.medium).toBe("bg-[color:var(--color-route-medium)]");
    expect(ROUTE_TINT.background).toBe("bg-[color:var(--color-route-background)]");
    expect(ROUTE_TINT.faint).toBe("bg-[color:var(--color-route-faint)]");
    expect(ROUTE_TINT.none).toBeNull();
    // Background only — never a text colour.
    for (const tint of Object.values(ROUTE_TINT)) if (tint) expect(tint).toMatch(/^bg-\[color:var\(--color-route-[a-z]+\)\]$/);
  });

  it("names the tiers exactly as the reader sees them", () => {
    expect(ROUTE.tiers).toEqual({ strong: "strongest", medium: "relevant", background: "background", faint: "less relevant", none: "not mentioned" });
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
      tier: "strong",
      title: "Q1, Q2",
      evidence: "The quillwort lattice cracks when the cells fade over many cycles.",
    });
    expect(sectionMark(overlay, ids[1])).toMatchObject({ tier: "background", title: "Q1" });
    expect(sectionMark(overlay, ids[2])).toMatchObject({ tier: "strong", title: "Q2" });
  });

  it("merges against Tier 0 by read > background > skim > none, preserves Tier 0 without model data, and retains multiple question titles", () => {
    const merged = mergeQuestionRoute(ROUTE_RESULT, questionRouteOverlay(answers));

    expect(sectionMark(merged, ids[0])).toMatchObject({ tier: "strong", title: "Q1, Q3" });
    expect(sectionMark(merged, ids[0])?.evidence).toBe("The quillwort lattice cracks when the cells fade over many cycles.");
    expect(sectionMark(merged, ids[1])).toMatchObject({ tier: "background", title: "Q1" });
    expect(sectionMark(merged, ids[2])).toMatchObject({ tier: "strong", title: "Q3" });
    expect(mergeQuestionRoute(ROUTE_RESULT, undefined)).toEqual(ROUTE_RESULT);
  });

  // P2-08b (§1g.19 c, F6): after a report, the reader edits a question it
  // answered. The report still answers the OLD text, which now matches no line
  // of the field; appending that entry as one more question gave the rail, the
  // map and the headings a phantom "Q3" the field does not have. Pairing is by
  // text and nothing else: an entry no live line claims is dropped, and a model
  // never adds a question.
  it("drops an overlay entry whose question matches no live line, and never appends a model-only question (F6)", () => {
    const edited = answers.map((entry, index) => (index === 0 ? { ...entry, question: "Does the LCO lattice crack at H1-3 in thin cells?" } : entry));

    const merged = mergeQuestionRoute(ROUTE_RESULT, questionRouteOverlay(edited));

    // The live questions, exactly: no fourth one from the orphaned entry.
    expect(merged?.byQuestion.map((entry) => entry.question)).toEqual(ROUTE_RESULT.byQuestion.map((entry) => entry.question));
    // The orphan's background mark on section 2 is gone: Tier 0's own skim stands.
    expect(sectionMark(merged, ids[1])).toEqual(sectionMark(ROUTE_RESULT, ids[1]));
    // The entry that still matches a live line still lends its answer.
    expect(sectionMark(merged, ids[2])).toMatchObject({ tier: "strong", title: "Q3" });
    // No section names a question number the field does not have.
    for (const id of ids) expect(sectionMark(merged, id)?.title ?? "").not.toMatch(/Q4/);
  });

  it("with no Tier 0 route there is nothing for a model entry to answer", () => {
    expect(mergeQuestionRoute(undefined, questionRouteOverlay(answers))).toBeUndefined();
    expect(mergeQuestionRoute(undefined, undefined)).toBeUndefined();
  });

  it("feeds the one merged display route to the map and body consumers, including the background token", () => {
    const merged = mergeQuestionRoute(ROUTE_RESULT, questionRouteOverlay(answers));
    // P2-04b (§1g.15): the consumers take the one `DrawRoute`, so the
    // merged route goes in as it is — no `as RouteResult`; `tsc` is the proof.
    // P7-14 (R5): the contents rail was the third consumer; the owner removed it, so the one
    // list of the paper's sections that is tinted besides the body's own headings is the map.
    const mapHtml = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map!, route: merged }));
    const body = renderToStaticMarkup(createElement(PaperBody, { reading, route: merged }));

    for (const html of [mapHtml, body]) {
      expect(html).toContain('data-route="background"');
      expect(html).toContain(ROUTE_TINT.background);
    }
  });
});

describe("a section's mark across the questions (§1f.13)", () => {
  it("takes the highest tier, and lists the questions that tinted it", () => {
    const first = sectionMark(ROUTE_RESULT, ids[0]);
    expect(first?.tier).toBe("strong");
    expect(first?.title).toBe("Q1, Q3");
    expect(ROUTE.questions([1, 3])).toBe("Q1, Q3");

    expect(sectionMark(ROUTE_RESULT, ids[1])).toMatchObject({ tier: "faint", title: "Q1" });
    expect(sectionMark(ROUTE_RESULT, ids[2])).toMatchObject({ tier: "faint", title: "Q3" });
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
    expect(first?.paragraphs.get(0)).toBe("faint");
    expect(first?.paragraphs.get(1)).toBe("strong");
  });

  it("titles a gist row by the gist, not by a question number", () => {
    const gist = gistRoute(reading.map!);
    const results = reading.map!.sections.findIndex((row) => row.role === "evidence");

    expect(gist.byQuestion[0].question).toBe(GIST_QUESTION);
    expect(sectionMark(gist, ids[results])).toMatchObject({ tier: "strong", title: ASK.chips.gist, hits: [] });
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

// P7-14 (R5): the contents rail (`PaperContents`) is deleted — the owner's review found it a
// second copy of the map's rows — so its two tint cases are re-aimed at the map's rows, which
// carry the same mark: the tier as `data-route`, the question numbers as the `title`, and no
// mark at all for a section no question mentions. (§1a.5 (d) named the rail as a tint surface;
// the surfaces are the map's rows and lines and the body's headings now.)
describe("the map's rows and the body heading carry the mark", () => {
  const mapRow = (html: string, heading: string) => {
    const at = html.indexOf(heading);
    return html.slice(html.lastIndexOf("<li", at), at + heading.length);
  };

  it("tints a map row by its tier and titles it with the question numbers", () => {
    const html = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map!, route: ROUTE_RESULT }));

    expect(mapRow(html, "1 Introduction")).toMatch(/data-route="strong"[^>]*title="Q1, Q3"/);
    expect(mapRow(html, "2 Methods")).toMatch(/data-route="faint"[^>]*title="Q1"/);
    expect(mapRow(html, "3 Results")).toMatch(/data-route="faint"[^>]*title="Q3"/);
    expect(html).toContain(ROUTE_TINT.strong);
    expect(html).toContain(ROUTE_TINT.faint);
  });

  it("leaves the map's rows untouched without a route, and for a section no question mentions", () => {
    const plain = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map! }));
    expect(plain).not.toContain("data-route");
    expect(plain).not.toMatch(/\s+title=/);
    expect(plain).not.toContain("--color-route-");

    const onlyFirst: RouteResult = {
      byQuestion: [{ question: "q", vague: false, sections: { [ids[0]]: section("faint"), [ids[1]]: section("none") } }],
      vague: false,
    };
    const html = renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map!, route: onlyFirst }));
    expect(html.match(/data-route=/g)).toHaveLength(1);
    expect(mapRow(html, "2 Methods")).not.toContain("data-route");
    expect(mapRow(html, "1 Introduction")).toContain('data-route="faint"');
  });

  it("marks the body's section headings and nothing else in the body", () => {
    const html = renderToStaticMarkup(createElement(PaperBody, { reading, route: ROUTE_RESULT }));

    expect(html).toMatch(/<h3 [^>]*data-route="strong"[^>]*>1 Introduction<\/h3>/);
    expect(html).toMatch(/<h3 [^>]*data-route="faint"[^>]*>2 Methods<\/h3>/);
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
      // P2-04b: a question sample for `FOR_YOUR_QUESTIONS.notAddressed`, in
      // both of its endings (with and without the reader's own terminal mark).
      const samples: unknown[][] = [[1, 1], [2, 3], ["2 Methods"], [[{ term: "LCO", count: 3 }]], [[1, 3]], ["Does it discuss recycling?"], ["recycling"]];
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

  it("has no 'skip', 'don't read', 'ignore' or 'not worth' in the ask, map, route or answers copy or the tier labels", () => {
    // P2-04b (§1g.15 finding 4): the answers block's copy is scanned too.
    // P3-02 (§1h.2): so is "Explain this?" — the button, the card's two labels
    // and its three states.
    const all = [...strings(ASK), ...strings(MAP), ...strings(ROUTE), ...strings(FOR_YOUR_QUESTIONS), ...strings(EXPLAIN)];

    expect(all.length).toBeGreaterThan(30);
    expect(all).toContain("not mentioned");
    expect(all).toContain("This paper does not address: Does it discuss recycling?");
    expect(all).toContain("This paper does not address: recycling.");
    // P2-08b (§1g.21 (2)): the unverified verdict line is scanned too.
    expect(all).toContain(FOR_YOUR_QUESTIONS.unverified);
    expect(all).toContain(ROUTE.backgroundWhy);
    expect(all).toContain("Explain this?");
    // P3-03 (§1h.6): the accessible name of Peer's paragraph gist is scanned too.
    expect(all).toContain(MAP.gist);
    expect(all).toContain("What it means");
    expect(all).toContain("Why it is here");
    expect(all).toContain(EXPLAIN.defines("2 Methods"));
    // Re-aimed (P10-08, review 8.6): the search toggle's label, its warning, the mark and the note (P3-02c) are gone with the toggle.
    // The window's title and where a Summary or answer passage is from are scanned instead.
    for (const line of [EXPLAIN.title, EXPLAIN.fromSummary, EXPLAIN.fromAnswer]) {
      expect(all).toContain(line);
    }
    for (const line of all) expect(line).not.toMatch(/skip|don['’]t read|ignore|not worth/i);
  });
});

// P10-06 (review 3.2, 3.4; rule 3): the tint is graded — three greens ordered by relevance — and the map's
// paragraph lines are graded inside a section the same way: the paragraphs that say most carry the section's
// tier, the others that mention a term a faint one.
describe("the graded tint (P10-06)", () => {
  const graded = (tier: "strong" | "medium" | "faint", paragraphs: number[], topParagraphs?: number[]) => ({
    tier, hits: [{ term: "lco", count: 2 }], paragraphs, ...(topParagraphs ? { topParagraphs } : {}),
  });
  const routeOf = (...sections: Array<Record<string, object>>): RouteResult => ({
    byQuestion: sections.map((entry, i) => ({ question: `question ${i}`, vague: false, sections: entry as RouteResult["byQuestion"][number]["sections"] })),
    vague: false,
  });
  const mapOf = (route: RouteResult, openRows: number[] = []) =>
    renderToStaticMarkup(createElement(ReadingMapView, { map: reading.map!, route, openRows }));

  it("draws the three tiers with three different tints, in the map and on the headings", () => {
    const route = routeOf({ [ids[0]]: graded("strong", [0]), [ids[1]]: graded("medium", [0]), [ids[2]]: graded("faint", [0]) });
    const map = mapOf(route);
    const body = renderToStaticMarkup(createElement(PaperBody, { reading, route }));

    for (const html of [map, body]) {
      expect(html).toMatch(/data-route="strong"[^>]*bg-\[color:var\(--color-route-strong\)\]/);
      expect(html).toMatch(/data-route="medium"[^>]*bg-\[color:var\(--color-route-medium\)\]/);
      expect(html).toMatch(/data-route="faint"[^>]*bg-\[color:var\(--color-route-faint\)\]/);
    }
    expect(new Set([ROUTE_TINT.strong, ROUTE_TINT.medium, ROUTE_TINT.faint, ROUTE_TINT.background]).size).toBe(4);
  });

  it("states the facts: 'strongest · mentions …', 'relevant · mentions …', and for the faintest only 'mentions …'", () => {
    const html = mapOf(routeOf({ [ids[0]]: graded("strong", [0]), [ids[1]]: graded("medium", [0]), [ids[2]]: graded("faint", [0]) }));
    // P11-35 (re-aimed, §1c): the line is drawn in parts (`MentionsLine`: a term's last word and its count in one span), so its words are no longer one text node: this
    // reads them as the line's text, the tags removed. The same string is expected, in full.
    const fact = (heading: string) =>
      new RegExp(`>${heading}</a>[\\s\\S]*?<p class="annotation pl-5 text-text-faint[^"]*">([\\s\\S]*?)</p>`).exec(html)?.[1]?.replace(/<[^>]*>/g, "");

    expect(fact("1 Introduction")).toBe("strongest · mentions lco ×2");
    expect(fact("2 Methods")).toBe("relevant · mentions lco ×2");
    expect(fact("3 Results")).toBe("mentions lco ×2");
    expect(ROUTE.tiers.strong).toBe("strongest");
    expect(ROUTE.tiers.medium).toBe("relevant");
  });

  it("grades a section's paragraphs: the top ones take its tier, the rest that mention a term are faint", () => {
    const route = routeOf({ [ids[0]]: graded("strong", [0, 1], [1]) });
    const mark = sectionMark(route, ids[0]);

    expect(mark?.paragraphs.get(1)).toBe("strong");
    expect(mark?.paragraphs.get(0)).toBe("faint");
    expect(mark?.paragraphs.has(2)).toBe(false);

    const medium = sectionMark(routeOf({ [ids[0]]: graded("medium", [0, 1], [0]) }), ids[0]);
    expect(medium?.paragraphs.get(0)).toBe("medium");
    expect(medium?.paragraphs.get(1)).toBe("faint");
  });

  it("tints a paragraph line by its own grade in the opened row, and leaves an unmentioned line untinted", () => {
    const html = mapOf(routeOf({ [ids[0]]: graded("strong", [0, 1], [1]) }), [0]);
    const line = (index: number) => new RegExp(`<a href="#paper-section-0-p${index}"([^>]*)>`).exec(html)?.[1] ?? "";

    expect(line(1)).toContain('data-route="strong"');
    expect(line(1)).toContain(ROUTE_TINT.strong!);
    expect(line(0)).toContain('data-route="faint"');
    expect(line(0)).toContain(ROUTE_TINT.faint!);
    expect(line(0)).not.toContain("--color-route-strong");
  });

  it("takes each paragraph at its highest grade across the questions", () => {
    const route = routeOf({ [ids[0]]: graded("strong", [0, 1], [1]) }, { [ids[0]]: graded("medium", [0, 1], [0]) });
    const mark = sectionMark(route, ids[0]);

    expect(mark?.tier).toBe("strong");
    expect(mark?.paragraphs.get(0)).toBe("medium");
    expect(mark?.paragraphs.get(1)).toBe("strong");
  });

  it("ranks the tiers strong over medium over faint when questions meet, and keeps the model's background between faint and medium", () => {
    const route = routeOf({ [ids[0]]: graded("faint", [0]) }, { [ids[0]]: graded("medium", [0]) });
    expect(sectionMark(route, ids[0])?.tier).toBe("medium");
    const overlay = { byQuestion: [{ question: "question 0", vague: false, sections: { [ids[0]]: { tier: "background" as const, hits: [], paragraphs: [] } } }], vague: false };
    expect(sectionMark(mergeQuestionRoute(routeOf({ [ids[0]]: graded("faint", [0]) }), overlay), ids[0])?.tier).toBe("background");
    expect(sectionMark(mergeQuestionRoute(routeOf({ [ids[0]]: graded("medium", [0]) }), overlay), ids[0])?.tier).toBe("medium");
  });
});

// P10-06b (rule 6): the Tier 0 route wears the strongest tier on three rows at most. A model's verified
// answers are marked strong too, and a report with many answers showed more than three — so the merged
// route keeps the cap: the model's rows are counted with the route's, and beyond three they are medium.
describe("the strongest rows stay three once a model's marks are merged (P10-06b)", () => {
  const Q = "Does the LCO lattice crack at H1-3?";
  const tier0 = (tiers: Record<string, "strong" | "medium" | "faint" | "none">): RouteResult => ({
    byQuestion: [
      {
        question: Q,
        vague: false,
        sections: Object.fromEntries(Object.entries(tiers).map(([id, tier]) => [id, { tier, hits: [{ term: "lco", count: 2 }], paragraphs: [0], evidence: `Tier 0 says ${id}.` }])),
      },
    ],
    vague: false,
  });
  const answered = (...answerIds: string[]) => [
    {
      question: Q,
      verdict: "answered" as const,
      answers: answerIds.map((sectionId) => ({ text: `Peer answer ${sectionId}.`, evidence: `Model says ${sectionId}.`, sectionId })),
      readNext: [],
    },
  ];
  const tiersOf = (route: ReturnType<typeof mergeQuestionRoute>) =>
    Object.fromEntries(Object.entries(route!.byQuestion[0].sections).map(([id, section]) => [id, section.tier as string]));
  const strongIds = (tiers: Record<string, string>) => Object.keys(tiers).filter((id) => tiers[id] === "strong");

  it("counts the model's strong rows with the route's: three at most in all, the model's verified answers first", () => {
    const merged = mergeQuestionRoute(tier0({ a: "strong", b: "strong", c: "strong", d: "medium", e: "none", f: "faint" }), questionRouteOverlay(answered("d", "e")));
    const tiers = tiersOf(merged);

    expect(strongIds(tiers)).toEqual(["a", "d", "e"]);
    expect(tiers.b).toBe("medium");
    expect(tiers.c).toBe("medium");
    expect(tiers.f).toBe("faint");
  });

  it("keeps a demoted row's mentions, paragraphs and evidence: only its tier changes", () => {
    const merged = mergeQuestionRoute(tier0({ a: "strong", b: "strong", c: "strong" }), questionRouteOverlay(answered("d", "e", "f")));
    const demoted = merged!.byQuestion[0].sections.a;

    expect(strongIds(tiersOf(merged))).toEqual(["d", "e", "f"]);
    expect(demoted).toMatchObject({ tier: "medium", hits: [{ term: "lco", count: 2 }], paragraphs: [0], evidence: "Tier 0 says a." });
  });

  it("counts a section strong in both once, and leaves a merge within the cap as it was", () => {
    const merged = mergeQuestionRoute(tier0({ a: "strong", b: "strong", c: "medium" }), questionRouteOverlay(answered("a", "c")));
    const tiers = tiersOf(merged);

    expect(strongIds(tiers)).toEqual(["a", "b", "c"]);
    expect(merged!.byQuestion[0].sections.a.evidence).toBe("Model says a.");
  });

  it("caps the overlay on its own: five verified answers are three strong rows and two medium", () => {
    const overlay = questionRouteOverlay(answered("a", "b", "c", "d", "e"))!;
    const tiers = Object.fromEntries(Object.entries(overlay.byQuestion[0].sections).map(([id, section]) => [id, section.tier as string]));

    expect(tiers).toEqual({ a: "strong", b: "strong", c: "strong", d: "medium", e: "medium" });
    expect(overlay.byQuestion[0].sections.d.evidence).toBe("Model says d.");
  });

  it("does not count a background mark against the cap, and does not demote one", () => {
    const overlay = questionRouteOverlay([
      {
        question: Q,
        verdict: "partly" as const,
        answers: [{ text: "x", evidence: "Model says a.", sectionId: "a" }],
        readNext: [{ sectionId: "e", why: "Context.", kind: "background" as const }],
      },
    ]);
    const tiers = tiersOf(mergeQuestionRoute(tier0({ a: "strong", b: "strong", c: "strong", e: "faint" }), overlay));

    expect(strongIds(tiers)).toEqual(["a", "b", "c"]);
    expect(tiers.e).toBe("background");
  });
});
