import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { PaperReading } from "@/lib/papers/reading";
import type { PaperTerm } from "@/lib/papers/report";
import { defaultProfile, type Paper } from "@/types";
import { EXPLAIN, PEERS_READING } from "./copy";
import { EvidenceQuote, SectionLinks } from "./evidence-quote";
import {
  ExplainCard,
  ExplainBox,
  buttonStyle,
  definingTerm,
  explainLlmOverride,
  placeButton,
  placeCard,
  previewOf,
  requestExplanation,
  termInPassage,
  termSource,
  type ExplainStatus,
} from "./explain-box";
import { DOCK_BOTTOM_PX, DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX, legendHeightPx } from "./explain-dock";
import type { ExplainSelection } from "./paper-body";

// P3-02 (ruling §1h.2; §3d 14): the button beside a selected passage and the
// card it opens. No DOM in this project's Vitest: the markup is rendered with
// react-dom/server, the pure rules (which term is in the passage, where the
// button and the card stand, what is sent) are tested on their own, and the
// click, Escape and a new selection are in `explain-box.flow.test.tsx`.
// Everything is invented text.

const PEERS_HTML = PEERS_READING.replace(/'/g, "&#x27;");
const SENTENCE = "We define the rafting ratio as the fraction of the gauge length covered by plates.";
const rafting: PaperTerm = { term: "rafting ratio", definition: SENTENCE, evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
const peerOnly: PaperTerm = { term: "creep", definition: "Slow deformation under load.", peer: true };

const selection: ExplainSelection = {
  sectionIndex: 1,
  paragraphIndex: 1,
  passage: "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.",
  rect: { left: 300, top: 400, right: 420, bottom: 420 },
  bounds: { left: 100, top: 380, right: 420, bottom: 420 },
};

const reading = {
  body: [
    { id: "s1", canonical: "introduction", heading: "1 Introduction", paragraphs: ["Hot parts creep."] },
    { id: "s2", canonical: "methods", heading: "2 Methods", paragraphs: ["Specimens.", SENTENCE] },
  ],
  map: {
    totalMinutes: 1,
    sections: [
      { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 1, words: 3, minutes: 1, paragraphs: [] },
      { id: "s2", heading: "2 Methods", canonical: "methods", role: "method", page: 2, words: 20, minutes: 1, paragraphs: [] },
    ],
  },
} as unknown as Pick<PaperReading, "body" | "map">;

const answer: ExplainAnswer = {
  meaning: "A rafting ratio says how much of a sample has turned into plates.",
  here: { text: "The authors use it to compare alloys on one scale.", evidence: SENTENCE, evidenceWhere: "2 Methods", sectionId: "s2", page: 2 },
};
const peerAnswer: ExplainAnswer = { meaning: answer.meaning, here: { text: "The authors use it to compare alloys.", peer: true } };

type PopoverProps = Parameters<typeof ExplainBox>[0];
const render = (props: Partial<PopoverProps> = {}) =>
  renderToStaticMarkup(
    createElement(SectionLinks, { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainBox, { target: selection, terms: [], canAsk: true, onAsk: async () => answer, reading, ...props })),
  );

describe("ExplainBox — when the button shows (§1h.2)", () => {
  // P8-06 (re-aimed): these are the button's rules, in a window of 800 px — the card's width, where nothing stands
  // before the press. From 1024 px a reader with a key has the empty window from the first render, beside the
  // button (`explain-box.empty.test.tsx`); a server render, with no window, is 1024 wide.
  beforeEach(() => {
    vi.stubGlobal("window", { innerWidth: 800, innerHeight: 900 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows nothing without a selection", () => {
    expect(render({ target: null })).toBe("");
    expect(render({ target: null, terms: [rafting], canAsk: true })).toBe("");
  });

  it("shows the button for a reader who can ask", () => {
    const html = render({ canAsk: true });

    expect(html).toContain(">Explain this?<");
    expect(html).toMatch(/<button[^>]*type="button"/);
  });

  it("shows it with no key when the paper itself defines a term inside the passage", () => {
    expect(render({ canAsk: false, terms: [rafting] })).toContain(">Explain this?<");
    // Case does not matter.
    expect(render({ canAsk: false, terms: [{ ...rafting, term: "RAFTING RATIO" }] })).toContain(">Explain this?<");
  });

  it("shows nothing with no key and no paper definition: a locked block is not shown", () => {
    expect(render({ canAsk: false, terms: [] })).toBe("");
    expect(render({ canAsk: false, terms: [{ ...rafting, term: "tungsten" }] })).toBe("");
    // A definition that is Peer's, not the paper's, is no paper definition.
    expect(render({ canAsk: false, terms: [{ ...peerOnly, term: "rafting ratio" }] })).toBe("");
  });

  it("sets the button in the label face, fixed, inside the viewport — on the page's furniture where the body reported no paragraph (re-aimed, P9-20: was beside the selection, just under where it ends)", () => {
    const html = render();
    const style = /style="([^"]*)"/.exec(html)?.[1] ?? "";
    const right = /right:\s*calc\(100% - (\d+(?:\.\d+)?)px\)/.exec(style)?.[1];
    const bottom = /bottom:\s*([^;]+)/.exec(style)?.[1];

    expect(html).toMatch(/class="[^"]*\bfixed\b/);
    expect(html).toMatch(/class="[^"]*\bfont-mono\b/);
    // 800 px: the foot legend's strip (28 px) and a margin (8) above it; its right edge a margin from the window's (800 − 8).
    expect(bottom).toBe(`${DOCK_BOTTOM_PX + 8}px`);
    expect(Number(right)).toBe(800 - 8);
    // Not under the selection: nothing in the style comes from where the words are.
    expect(style).not.toMatch(/(?:^|;)\s*top:/);
    expect(style).not.toMatch(/(?:^|;)\s*left:/);
    expect(Number(right)).toBeGreaterThanOrEqual(120 + 8);
  });

  it("sends nothing and shows no card until it is clicked: the closed popover is the button alone", () => {
    const html = render();

    expect(html).not.toContain("role=\"dialog\"");
    // P9-20: nor is there a region (the window's role now) — the closed popover is the button alone.
    expect(html).not.toContain("role=\"region\"");
    expect(html).not.toContain("data-explain-card");
    expect(html).not.toContain(EXPLAIN.loading);
    expect(html).not.toContain(EXPLAIN.meaning);
  });
});

// P9-20 (A P9-W2's X13): where no gutter stands the floating button was just under the selection's end and covered the next line's
// words (116 x 34 px = 2,120 px² at 700, 640 and 390). It stands on the page's own bottom furniture now: above the thumb bar under
// 768 px, above the foot legend from it. The markup at each width (no DOM in this project's Vitest; the pixels are measured in a browser).
describe("ExplainBox — the floating button where no gutter stands stands on the page's furniture (P9-20, X13)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const at = (width: number, over: Partial<PopoverProps> = {}) => {
    vi.stubGlobal("window", { innerWidth: width, innerHeight: 844 });
    const html = render(over);
    const style = /style="([^"]*)"/.exec(html)?.[1] ?? "";
    return { html, style };
  };
  const paragraphAt = (right: number): ExplainSelection => ({ ...selection, paragraph: { left: 16, top: 300, right, bottom: 640 } });

  // Re-aimed, P9-41 (§1h.66; was: "on a phone and under 768 px it is a pill 8 px above the thumb bar's top edge, its right edge on the
  // column's"): that pill still covered 1,790 to 2,473 px² of the words that scroll under it (P9-20's checkpoint §5 a). Under 768 px the
  // control is the thumb bar's own cell (`thumb-bar.tsx`, `thumb-bar.test.tsx`), so the box draws nothing there — for a reader with a key
  // and for a Tier 0 definition alike, with or without a gutter — and publishes the offer to the bar (`explain-box.bar.flow.test.tsx`).
  it("under 768 px there is no floating pill at all: the thumb bar holds the control (re-aimed, P9-41: was a pill 8 px above the bar)", () => {
    for (const [width, right] of [[390, 374], [640, 624], [700, 684], [767, 751]] as const) {
      const cases: Partial<PopoverProps>[] = [{ target: paragraphAt(right) }, { target: paragraphAt(right - 300) }, { target: selection }, { target: paragraphAt(right), canAsk: false, terms: [rafting] }];
      for (const over of cases) {
        const { html } = at(width, over);

        expect(html, `${width} px`).toBe("");
        expect(html, `${width} px`).not.toContain("data-explain-ask");
        expect(html, `${width} px`).not.toContain(">Explain this?<");
      }
    }
  });

  it("from 768 px with no gutter it is a pill 8 px above the foot legend's top edge: the legend's 28 px and the margin", () => {
    // 800 px wide, the paragraph's right edge at 700: 100 px to its right, less than the 136 the button and its margins need.
    for (const width of [768, 800, 1000]) {
      const { style } = at(width, { target: paragraphAt(width - 100) });

      expect(style, `${width} px`).toContain(`right:calc(100% - ${width - 100}px)`);
      expect(style, `${width} px`).toContain(`bottom:${DOCK_BOTTOM_PX + 8}px`);
      expect(style, `${width} px`).not.toMatch(/(?:^|;)(?:top|left):/);
    }
  });

  it("where a gutter stands the button is beside the words, as it was: `left` and `top`, no `bottom`", () => {
    const { style } = at(800, { target: paragraphAt(600) });

    expect(style).toContain(`left:${600 + 6}px`);
    expect(style).toMatch(/(?:^|;)top:\d/);
    expect(style).not.toContain("bottom:");
    expect(style).not.toContain("right:");
  });

  it("is the same pill wherever in the page the selection is: its place does not read the selection's rectangles (re-aimed, P9-41: at 800 px, the legend's pill — at 390 px there is no pill to place)", () => {
    const high: ExplainSelection = { ...paragraphAt(700), rect: { left: 40, top: 40, right: 100, bottom: 60 }, bounds: { left: 16, top: 20, right: 700, bottom: 60 } };
    const low: ExplainSelection = { ...paragraphAt(700), rect: { left: 40, top: 700, right: 300, bottom: 720 }, bounds: { left: 16, top: 640, right: 700, bottom: 720 } };

    expect(at(800, { target: high }).style).toContain("right:calc(100% - 700px)");
    expect(at(800, { target: high }).style).toBe(at(800, { target: low }).style);
  });
});

// P9-41 (§1h.66; C P9-20's checkpoint §7, §8 item 1): the pill that stays — from 768 px, where the foot legend is the furniture and a
// column with no gutter leaves it nowhere else — is a 44 px touch target where there is no hover (P9-23's rule), as the window's own
// header control is (P9-17). Only the legend's pill: the gutter pill's clamps assume the 32 px `BUTTON_HEIGHT` (a taller one would be
// pushed past the window's foot), and with a mouse nothing about either pill changes.
describe("ExplainBox — the pill from 768 px is a 44 px touch target where there is no hover (P9-41, §1h.66)", () => {
  afterEach(() => vi.unstubAllGlobals());
  const TOUCH = "[@media(hover:none)]:min-h-11";
  const pillAt = (width: number, right: number, over: Partial<PopoverProps> = {}) => {
    vi.stubGlobal("window", { innerWidth: width, innerHeight: 844 });
    const html = render({ target: { ...selection, paragraph: { left: 16, top: 300, right, bottom: 640 } }, ...over });
    const tag = /<button[^>]*data-explain-ask[^>]*>/.exec(html)?.[0] ?? "";
    return { tag, tokens: (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean) };
  };

  it("the legend's pill (no gutter) carries the touch class: 44 px tall under hover:none, from 768 px up", () => {
    for (const width of [768, 800, 1000]) {
      const { tag, tokens } = pillAt(width, width - 100);

      expect(tag, `${width} px`).not.toBe("");
      expect(tokens, `${width} px`).toContain(TOUCH);
    }
    // A Tier 0 definition's pill is the same control.
    expect(pillAt(800, 700, { canAsk: false, terms: [rafting] }).tokens).toContain(TOUCH);
  });

  it("the gutter pill is untouched: beside the words, its class list as it was — the touch class is the legend pill's alone", () => {
    const gutter = pillAt(800, 600);
    const legend = pillAt(800, 700);

    expect(gutter.tag).not.toBe("");
    expect(gutter.tokens).not.toContain(TOUCH);
    // The two pills are one control: the legend's is the gutter's with the touch class added, nothing else differs.
    expect(legend.tokens.filter((token) => token !== TOUCH)).toEqual(gutter.tokens);
  });
});

const card = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(SectionLinks, { headings: reading.body.map((s) => s.heading) },
      createElement(ExplainCard, {
        passage: selection.passage,
        heading: "2 Methods",
        term: null,
        termWhere: null,
        canAsk: true,
        status: { kind: "loading" } as ExplainStatus,
        onClose: () => {},
        ...over,
      })),
  );

describe("ExplainCard — the two parts (§1h.2)", () => {
  it("is a named, non-modal region (re-aimed, P9-20: was a dialog) and says its passage as the paper's own words, with its section", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html).toContain('role="region"');
    expect(html).not.toContain('role="dialog"');
    expect(html).toContain(`aria-label="${EXPLAIN.card}"`);
    expect(html).not.toContain("aria-modal");
    // The passage is the paper's: an attributed quote, never a bare label-face line.
    expect(html).toContain("font-reading italic");
    expect(html).toContain(selection.passage);
    expect(html).toMatch(/— (?:<a [^>]*>)?§2 Methods/);
  });

  it("cuts a long passage to a short preview with an ellipsis", () => {
    const long = `${"word ".repeat(60)}end`;
    const html = card({ passage: long });

    expect(html).toContain(previewOf(long));
    expect(html).not.toContain(long);
    expect(previewOf(long).endsWith("…")).toBe(true);
    expect(previewOf(long).length).toBeLessThanOrEqual(81);
    expect(previewOf("A short passage.")).toBe("A short passage.");
  });

  it("shows the loading line, in the label face, while Peer is working", () => {
    const html = card({ status: { kind: "loading" } });

    expect(html).toContain(EXPLAIN.loading);
    expect(html).toContain('role="status"');
    expect(html).not.toContain(EXPLAIN.meaning);
    expect(html).not.toContain(EXPLAIN.here);
  });

  it("shows the two parts: What it means, then Why it is here, the prose in the reading face", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html.indexOf(EXPLAIN.meaning)).toBeGreaterThan(-1);
    expect(html.indexOf(EXPLAIN.meaning)).toBeLessThan(html.indexOf(EXPLAIN.here));
    expect(html).toMatch(/font-mono[^"]*"[^>]*>What it means</);
    expect(html).toMatch(/font-mono[^"]*"[^>]*>Why it is here</);
    expect(html).toMatch(/<p class="font-reading[^"]*">A rafting ratio says how much/);
    expect(html).toMatch(/<p class="font-reading[^"]*">The authors use it to compare alloys on one scale\./);
  });

  it("labels the meaning as Peer's reading, once, beside its heading", () => {
    const html = card({ status: { kind: "answer", answer } });

    expect(html.split(PEERS_HTML)).toHaveLength(2);
    expect(html.indexOf(PEERS_HTML)).toBeGreaterThan(html.indexOf(EXPLAIN.meaning));
    expect(html.indexOf(PEERS_HTML)).toBeLessThan(html.indexOf(EXPLAIN.here));
  });

  it("shows the paper's sentence as an attributed quote with its section link and page — not as Peer's prose", () => {
    const html = card({ status: { kind: "answer", answer } });
    const after = html.slice(html.indexOf(EXPLAIN.here));

    expect(after).toContain(`>${SENTENCE}<span`);
    expect(after).toContain('<a href="#paper-section-1"');
    expect(after).toContain("§2 Methods");
    expect(after).toContain("p.2");
    // The prose is not italic and is not quote-styled.
    expect(after).toMatch(/<p class="font-reading(?![^"]*italic)[^"]*">The authors use it/);
  });

  it("when the quote could not be verified, labels the second part's prose as Peer's own and shows no quote", () => {
    const html = card({ status: { kind: "answer", answer: peerAnswer } });
    const after = html.slice(html.indexOf(EXPLAIN.here));

    expect(html.split(PEERS_HTML)).toHaveLength(3);
    expect(after).toContain(PEERS_HTML);
    expect(after).not.toContain("— §");
    expect(after).not.toContain("font-reading italic");
  });

  it("says Peer could not explain it just now, or that the selection is not the paper's text", () => {
    const unavailable = card({ status: { kind: "unavailable" } });
    const notIn = card({ status: { kind: "not_in_paper" } });

    expect(unavailable).toContain("Peer could not explain this just now.");
    expect(notIn).toContain("Select text from the paper itself.");
    for (const html of [unavailable, notIn]) {
      expect(html).not.toContain(EXPLAIN.meaning);
      expect(html).not.toContain(EXPLAIN.loading);
    }
  });

  it("has a close control", () => {
    expect(card()).toMatch(/<button[^>]*type="button"[^>]*>Close</);
  });
});

describe("ExplainCard — Tier 0: the paper's own definition (§1h.2)", () => {
  const where = { where: "2 Methods", page: 2 };

  it("opens with the defining sentence as a quote, with its section and page", () => {
    const html = card({ term: rafting, termWhere: where, status: { kind: "loading" } });

    expect(html).toContain(EXPLAIN.defines("rafting ratio"));
    expect(html).toContain(`>${SENTENCE}<span`);
    expect(html).toContain("§2 Methods");
    expect(html).toContain("p.2");
  });

  it("is the whole card, with no key: no parts, no loading, no apology", () => {
    const html = card({ canAsk: false, term: rafting, termWhere: where, status: { kind: "none" } });

    expect(html).toContain(SENTENCE);
    for (const text of [EXPLAIN.meaning, EXPLAIN.here, EXPLAIN.loading, EXPLAIN.unavailable, EXPLAIN.notInPaper]) {
      expect(html).not.toContain(text);
    }
    expect(html).not.toContain(PEERS_HTML);
  });

  it("stands above the model's two parts when there is a key", () => {
    const html = card({ term: rafting, termWhere: where, status: { kind: "answer", answer } });

    expect(html.indexOf(EXPLAIN.defines("rafting ratio"))).toBeLessThan(html.indexOf(EXPLAIN.meaning));
  });
});

// P9-20 (A P9-W2's N4): in the 360 px window and the phone's sheet the quotes are set ragged-right. `EvidenceQuote` carries
// `reading-justify` (the paper's own column keeps that: the design); the window overrides it for what it holds.
describe("ExplainCard — the quotes are set ragged-right, not justified (P9-20, N4)", () => {
  const body = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) => card({ status: { kind: "answer", answer }, ...over });
  // The markup escapes `&` in an attribute; the class is the one the source says.
  const rootClass = (html: string) => (/data-explain-card=""[^>]*class="([^"]*)"/.exec(html)?.[1] ?? "").replace(/&amp;/g, "&");

  it("the window's root turns the body's justification off for the quotes it holds: in the dock, the card and the sheet, and the empty window", () => {
    for (const over of [{ dock: true }, {}, { sheet: true }, { dock: true, empty: true }]) {
      expect(rootClass(body(over)).split(/\s+/), JSON.stringify(over)).toContain("[&_.reading-justify]:text-left");
    }
  });

  it("the quote is still the body's own element (`reading-justify`), so the override has something to take off, and nowhere else is it taken off", () => {
    const html = body({ dock: true });

    // The passage's quote, the answer's quote and the paper's definition are `EvidenceQuote`s: each carries the class.
    expect(html.match(/reading-justify/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
    const quote = renderToStaticMarkup(createElement(SectionLinks, { headings: ["2 Methods"] }, createElement(EvidenceQuote, { text: "A sentence.", where: "2 Methods" })));
    expect(quote).toContain("reading-justify");
    // The utility itself is untouched: the paper's column keeps its justification.
    const css = readFileSync(resolve(process.cwd(), "src/app/globals.css"), "utf8");
    expect(/@utility reading-justify \{\s*text-align: justify;/.test(css)).toBe(true);
    // And the override is scoped to the window's root, not a rule on every quote.
    expect(readFileSync(resolve(process.cwd(), "src/components/reader/evidence-quote.tsx"), "utf8")).toContain("reading-justify");
  });
});

describe("the pure rules", () => {
  it("termInPassage: whole words, any case, multi-word terms; never inside another word", () => {
    expect(termInPassage("rafting ratio", "The Rafting Ratio rose.")).toBe(true);
    expect(termInPassage("QPU", "Run on a qpu today")).toBe(true);
    expect(termInPassage("DM", "The admission was late")).toBe(false);
    expect(termInPassage("ratio", "The rafting ratios rose")).toBe(false);
    expect(termInPassage("C++", "We wrote it in C++ and Go")).toBe(true);
    expect(termInPassage("(a)", "see (a) above")).toBe(true);
    expect(termInPassage("", "anything")).toBe(false);
  });

  it("definingTerm: the first term with the paper's own sentence that lies in the passage", () => {
    const other: PaperTerm = { ...rafting, term: "plates" };

    expect(definingTerm([peerOnly, rafting, other], selection.passage)).toBe(rafting);
    expect(definingTerm([other, rafting], "The plates and the rafting ratio")).toBe(other);
    expect(definingTerm([peerOnly], "Slow creep")).toBeNull();
    expect(definingTerm([rafting], "Nothing relevant here")).toBeNull();
    expect(definingTerm([], selection.passage)).toBeNull();
  });

  it("termSource: the term's own place, else the map's heading and page for its section, else the abstract", () => {
    expect(termSource(rafting, reading)).toEqual({ where: "2 Methods", page: 2 });
    expect(termSource({ ...rafting, evidenceWhere: undefined, page: undefined }, reading)).toEqual({ where: "2 Methods", page: 2 });
    expect(termSource({ ...rafting, evidenceWhere: undefined, sectionId: undefined, page: undefined }, reading)).toEqual({ where: "abstract", page: undefined });
  });

  it("placeButton: with no paragraph reported it stands on the page's furniture, never just below the selection, and always inside the window (re-aimed, P9-20: was just below the selection's end, flipped above at the foot of the window)", () => {
    const vp = { width: 1024, height: 768 };
    const room = 120 + 8;

    // No gutter is known: the foot legend's strip from 768 px, a margin above its top edge; the right edge on the window's margin.
    expect(placeButton({ left: 300, top: 400, right: 420, bottom: 420 }, vp)).toEqual({ edge: 1024 - 8, bottom: `${DOCK_BOTTOM_PX + 8}px` });
    // Wherever the selection is — mid-page, at the foot of the window, off its left edge — the pill is where it was (it was under the end).
    for (const rect of [{ left: 300, top: 400, right: 420, bottom: 420 }, { left: 300, top: 740, right: 420, bottom: 760 }, { left: 1000, top: 100, right: 1020, bottom: 120 }, { left: -50, top: 100, right: 10, bottom: 120 }, { left: 5, top: 5, right: 9, bottom: 9 }]) {
      expect(placeButton(rect, vp)).toEqual({ edge: 1024 - 8, bottom: `${DOCK_BOTTOM_PX + 8}px` });
    }
    // Always inside the window, down to the narrowest that holds the button and a margin each side (136).
    for (const width of [136, 390, 767, 768, 1024]) {
      const at = placeButton({ left: 5, top: 5, right: 9, bottom: 9 }, { width, height: 768 });
      expect("edge" in at).toBe(true);
      const { edge } = at as { edge: number };
      expect(edge).toBeGreaterThanOrEqual(room);
      expect(edge).toBeLessThanOrEqual(width - 8);
    }
  });

  // P9-03 (the feature walk's X13: at 1440 the button stood at (535,317), 116 x 34, over the body text of the
  // selected paragraph — the next line of the paragraph it was beside). A control stands beside the words, never on
  // them: with the paragraph's box known and room to its right, the button stands in the gutter, level with the
  // selection, and below the selection's end only where there is no gutter (a phone, a narrow window) — re-aimed, P9-20: where there is
  // none it stands on the page's bottom furniture (the next describe).
  describe("placeButton: the gutter beside the paragraph (P9-03)", () => {
    // The gutter's place is a corner (`left`, `top`); the helper says so, and narrows the type.
    const inGutter = (...args: Parameters<typeof placeButton>) => {
      const place = placeButton(...args);
      expect("top" in place, "a gutter place has a corner").toBe(true);
      return place as { left: number; top: number };
    };
    // The viewport the box passes while the dock stands: 1440 less the 376 px the page keeps clear.
    const docked = { width: 1440 - 376, height: 1000 };
    const paragraph = { left: 408, top: 280, right: 900, bottom: 540 };
    const rect = { left: 600, top: 317, right: 700, bottom: 337 };

    it("(a) stands in the gutter: 6 px right of the paragraph's edge, level with the selection's FIRST line (re-aimed, P9-03b: was the line it ends on)", () => {
      // A selection of three lines: it begins on the line at 317 and ends on the one at 357 (`rect`, the last line).
      const lines = { left: 410, top: 317, right: 898, bottom: 377 };
      const last = { left: 410, top: 357, right: 700, bottom: 377 };
      const at = inGutter(last, docked, paragraph, lines);

      // P9-03b: the first line's top (317), not the last's (357).
      expect(at).toEqual({ left: 900 + 6, top: 317 });
      // Beside the words, not on them: not one pixel of the button is within the paragraph's box.
      expect(at.left).toBeGreaterThanOrEqual(paragraph.right);
      // The same place whatever the selection's width or where in the line it ends.
      expect(placeButton({ left: 410, top: 317, right: 430, bottom: 337 }, docked, paragraph, { left: 410, top: 317, right: 430, bottom: 337 })).toEqual({ left: 906, top: 317 });
      expect(placeButton({ left: 410, top: 317, right: 898, bottom: 337 }, docked, paragraph, { left: 410, top: 317, right: 898, bottom: 337 })).toEqual({ left: 906, top: 317 });
      // A selection of one line has one line: with no `bounds` given the line reported is the selection's.
      expect(placeButton(rect, docked, paragraph)).toEqual({ left: 906, top: 317 });
    });

    it("(a) with no dock to narrow it, the same rule on the whole window (a reader with no key, a defined term)", () => {
      expect(placeButton(rect, { width: 1440, height: 1000 }, paragraph)).toEqual({ left: 906, top: 317 });
      expect(placeButton({ left: 410, top: 357, right: 700, bottom: 377 }, { width: 1440, height: 1000 }, paragraph, { left: 410, top: 317, right: 898, bottom: 377 })).toEqual({ left: 906, top: 317 });
    });

    it("(b) the first line's top is held inside the window: a margin from the head, the button's foot a margin above the window's foot (re-aimed, P9-03b: was the last line's)", () => {
      // The selection's first line is at `top`; it ends 40 px lower. 1000 − 8 (margin) − 32 (the button's height) = 960.
      const at = (top: number, viewport = docked) => inGutter({ left: 600, top: top + 40, right: 700, bottom: top + 60 }, viewport, paragraph, { left: 410, top, right: 700, bottom: top + 60 });
      expect(at(990)).toEqual({ left: 906, top: 960 });
      expect(at(960).top).toBe(960);
      expect(at(959).top).toBe(959);
      // A selection scrolled partly above the window's head: its first line is above it, its last is not. Re-aimed, P9-17:
      // the head is the masthead's foot and a margin (56) from 768 px, where the masthead shows, was the window's own 8.
      expect(at(-20)).toEqual({ left: 906, top: 56 });
      expect(at(-60).top).toBe(56);
      // A window too short to hold the button: the head wins, as the card's does.
      expect(at(30, { width: 1064, height: 30 }).top).toBe(56);
      // With no `bounds` the clamps are the selection's own line, as they were.
      expect(placeButton({ left: 600, top: 990, right: 700, bottom: 1010 }, docked, paragraph)).toEqual({ left: 906, top: 960 });
      expect(placeButton({ left: 600, top: -20, right: 700, bottom: 0 }, docked, paragraph)).toEqual({ left: 906, top: 56 });
    });

    // P9-17 (ruling §1h.56; A P9-R2 F4): the masthead is `hidden md:grid sticky top-0 z-50 h-12` and the button `fixed z-[70]`, so
    // a long paragraph straddling the head of the window put the button over the masthead's right side from 768 px (the
    // gutter is 161 px at 800 and 211 px at 900): its head is the masthead's foot and a margin.
    it("(e) never stands in the masthead from 768 px: its top is held 8 px below the masthead's foot", () => {
      // A's scratch: 800 x 900, the paragraph's right edge at 639, the selection's first line 120 px above the window.
      const paragraph800 = { left: 44, top: -300, right: 639, bottom: 420 };
      const first = { left: 60, top: -120, right: 600, bottom: 200 };
      const at800 = inGutter({ left: 300, top: 176, right: 420, bottom: 200 }, { width: 800, height: 900 }, paragraph800, first);

      expect(at800.left).toBeGreaterThanOrEqual(paragraph800.right);
      expect(at800.top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
      expect(at800).toEqual({ left: 645, top: DOCK_TOP_PX + 8 });
      // The measure's case: 900 x 900, a paragraph straddling the head.
      const at900 = inGutter({ left: 300, top: 176, right: 420, bottom: 200 }, { width: 900, height: 900 }, { left: 44, top: -300, right: 689, bottom: 420 }, first);
      expect(at900.top).toBeGreaterThanOrEqual(56);
      // The boundary is the masthead's own: Tailwind's `md`, 768 px.
      expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(768);
      const atWidth = (width: number) => inGutter({ left: 300, top: 176, right: 420, bottom: 200 }, { width, height: 900 }, { left: 44, top: -300, right: width - 200, bottom: 420 }, first).top;
      // Under 768 px there is no masthead (`hidden md:grid`): the window's own margin, as before.
      expect(atWidth(767)).toBe(8);
      expect(atWidth(768)).toBe(56);
      expect(atWidth(1064)).toBe(56);
      // Below the head it is untouched: a first line at 56 or lower is where it was; one at 40 is moved down to 56.
      const line = (top: number) => inGutter({ left: 300, top, right: 420, bottom: top + 20 }, { width: 900, height: 900 }, { left: 44, top: top - 20, right: 689, bottom: 420 }, { left: 60, top, right: 600, bottom: 200 }).top;
      expect(line(56)).toBe(56);
      expect(line(300)).toBe(300);
      expect(line(40)).toBe(56);
    });

    it("(c) with no paragraph reported it stands on the furniture, right-aligned to the window's margin (re-aimed, P9-20: was today's place, under where the selection ends, flipped above at the foot)", () => {
      const vp = { width: 1024, height: 768 };
      const legend = { edge: 1024 - 8, bottom: `${DOCK_BOTTOM_PX + 8}px` };
      expect(placeButton({ left: 300, top: 400, right: 420, bottom: 420 }, vp, undefined)).toEqual(legend);
      expect(placeButton(rect, docked, undefined)).toEqual(placeButton(rect, docked));
      expect(placeButton(rect, docked)).toEqual({ edge: 1064 - 8, bottom: `${DOCK_BOTTOM_PX + 8}px` });
      // At the foot of the window it is no longer flipped above the selection: the strip it stands on is the foot's.
      expect(placeButton({ left: 300, top: 740, right: 420, bottom: 760 }, vp, undefined)).toEqual(legend);
      // P9-03b: the first line is for the gutter only — the whole selection's box changes nothing where there is none.
      const whole = { left: 100, top: 200, right: 420, bottom: 420 };
      expect(placeButton({ left: 300, top: 400, right: 420, bottom: 420 }, vp, undefined, whole)).toEqual(legend);
    });

    it("(d) a paragraph with less than 136 px (the button, a margin each side) to its right gets the furniture (re-aimed, P9-20: was today's place under the selection's end); with exactly 136, the gutter", () => {
      const noRoom = { left: 408, top: 280, right: 1064 - 135, bottom: 540 };
      // 1064 px: the foot legend's strip; the pill's right edge is the column's.
      expect(placeButton(rect, docked, noRoom)).toEqual({ edge: 1064 - 135, bottom: `${DOCK_BOTTOM_PX + 8}px` });
      // …and the whole selection's box (P9-03b) does not move it.
      expect(placeButton(rect, docked, noRoom, { left: 410, top: 200, right: 898, bottom: 337 })).toEqual(placeButton(rect, docked, noRoom));
      // One pixel more room is the gutter, and it ends a margin and two pixels short of the window's edge.
      const justRoom = { left: 408, top: 280, right: 1064 - 136, bottom: 540 };
      const at = inGutter(rect, docked, justRoom);
      expect(at).toEqual({ left: 1064 - 136 + 6, top: 317 });
      expect(at.left + 120).toBeLessThanOrEqual(1064 - 8);
      // A column flush with the window's edge: the pill's right edge is held a margin inside it.
      expect(placeButton(rect, docked, { left: 0, top: 280, right: 1064, bottom: 540 })).toEqual({ edge: 1064 - 8, bottom: `${DOCK_BOTTOM_PX + 8}px` });
      // A phone: no gutter at 390 px (16 px to the column's right) — and, re-aimed, P9-41, no pill either: the box does not ask for a
      // place under 768 px (the thumb bar holds the control; `ExplainBox — under 768 px there is no floating pill at all`), so the
      // pure function is pinned only where it is asked: a column that leaves the legend's strip at 768.
      expect(placeButton({ left: 40, top: 300, right: 200, bottom: 320 }, { width: 768, height: 780 }, { left: 16, top: 250, right: 752, bottom: 600 })).toEqual({
        edge: 752,
        bottom: `${DOCK_BOTTOM_PX + 8}px`,
      });
    });

    it("for any paragraph, selection and window: in the gutter it never touches the paragraph and stays inside the window; without one it is on the furniture, wherever the selection is (re-aimed, P9-20: was today's place)", () => {
      let gutter = 0;
      let fallback = 0;
      for (const vp of [docked, { width: 1440, height: 900 }, { width: 904, height: 800 }, { width: 1024, height: 768 }, { width: 640, height: 700 }, { width: 390, height: 780 }]) {
        for (const right of [300, 600, 760, 900, 1200]) {
          for (const top of [-40, 8, 300, 760, 1200]) {
            const box = { left: 100, top: top - 20, right, bottom: top + 400 };
            const where = { left: 120, top, right: Math.min(right, 400), bottom: top + 20 };
            // P9-03b: the selection began 60 px higher (three lines or so) than the line it ends on.
            const whole = { left: 100, top: top - 60, right: Math.min(right, 400), bottom: top + 20 };
            if (vp.width - right >= 120 + 2 * 8) {
              gutter += 1;
              const at = inGutter(where, vp, box, whole);
              expect(at.left).toBeGreaterThanOrEqual(right);
              expect(at.left + 120).toBeLessThanOrEqual(vp.width - 8);
              // P9-17: from 768 px the head is the masthead's foot and a margin, below it the window's own margin.
              const head = vp.width >= 768 ? 56 : 8;
              expect(at.top).toBeGreaterThanOrEqual(head);
              expect(at.top + 32).toBeLessThanOrEqual(vp.height - 8);
              // Level with the first line wherever it fits in the window.
              if (whole.top >= head && whole.top + 32 <= vp.height - 8) expect(at.top).toBe(whole.top);
            } else {
              fallback += 1;
              const at = placeButton(where, vp, box, whole);
              // On the furniture: no corner, whatever the selection's rectangles are…
              expect("edge" in at).toBe(true);
              expect(at).toEqual(placeButton({ left: 0, top: 0, right: 1, bottom: 1 }, vp, box));
              // …its right edge on the column's, held inside the window.
              const { edge } = at as { edge: number };
              expect(edge).toBe(Math.min(Math.max(right, 128), vp.width - 8));
            }
          }
        }
      }
      // Both branches were exercised.
      expect(gutter).toBeGreaterThan(20);
      expect(fallback).toBeGreaterThan(20);
    });
  });

  // P9-20 (A P9-W2's X13): where no gutter stands, the pill stands on the page's own bottom furniture — a strip the page already
  // reserves — never on the words. Under 768 px (`md`) the furniture is the phone's thumb bar, from 768 px the foot legend.
  describe("placeButton: the page's bottom furniture where no gutter stands (P9-20, X13)", () => {
    const column = (width: number) => ({ left: 16, top: 250, right: width - 16, bottom: 900 });
    const where = { left: 40, top: 300, right: 200, bottom: 320 };

    // Re-aimed, P9-41 (§1h.66; was: "under 768 px it is 8 px above the thumb bar's top edge: the bar's 56 px and the safe area, then the
    // margin"): the bar branch of the place is gone with the pill it placed — under 768 px the bar holds the control as a cell, so there is
    // no place to compute. What stays is the legend's strip, at every width the box asks (768 and up).
    it("the thumb bar's strip is gone from the place: at no width does the lift name the bar or the safe area — only the legend's strip (re-aimed, P9-41)", () => {
      for (const width of [390, 480, 640, 700, 767, 768, 1024, 1440]) {
        const place = placeButton(where, { width, height: 844 }, column(width));

        expect("top" in place, `${width} px`).toBe(false);
        expect((place as { bottom: string }).bottom, `${width} px`).toBe(`${DOCK_BOTTOM_PX + 8}px`);
      }
    });

    it("from 768 px it is 8 px above the foot legend's top edge (the legend's 28 px, then the margin)", () => {
      // 768 to ~900 the column leaves too little to its right at some widths; the pill takes the legend's strip there.
      for (const width of [768, 800, 1024, 1440]) {
        expect(placeButton(where, { width, height: 900 }, { left: 16, top: 250, right: width - 100, bottom: 900 }), `${width} px`).toEqual({
          edge: width - 100,
          bottom: `${DOCK_BOTTOM_PX + 8}px`,
        });
      }
    });

    it("the breakpoint is the masthead's and the shell's `md`: 767 is the bar's (the box draws no pill), 768 the legend's pill (re-aimed, P9-41: was pure placement on both sides)", () => {
      expect(MASTHEAD_MIN_VIEWPORT_PX).toBe(768);
      const target: ExplainSelection = { ...selection, paragraph: { left: 16, top: 250, right: 700, bottom: 900 } };
      vi.stubGlobal("window", { innerWidth: 767, innerHeight: 844 });
      expect(render({ target })).toBe("");
      vi.stubGlobal("window", { innerWidth: 768, innerHeight: 844 });
      expect(render({ target })).toContain(">Explain this?<");
      expect(placeButton(where, { width: 768, height: 844 }, { left: 16, top: 250, right: 760, bottom: 900 })).toEqual({ edge: 760, bottom: "36px" });
      vi.unstubAllGlobals();
    });

    it("the legend's strip is the legend's own height as Fit scales it (P9-20, BACKLOG-42): 8 px above 28 × zoom", () => {
      const viewport = { width: 1000, height: 900, legend: legendHeightPx(1.378) };

      expect(placeButton(where, viewport, { left: 16, top: 250, right: 900, bottom: 900 })).toEqual({ edge: 900, bottom: `${legendHeightPx(1.378) + 8}px` });
    });

    it("buttonStyle: a gutter place is its corner; a furniture place is its right edge and its lift, `fixed` in the window's own pixels", () => {
      expect(buttonStyle({ left: 906, top: 317 })).toEqual({ left: 906, top: 317 });
      expect(buttonStyle({ edge: 374, bottom: "64px" })).toEqual({ right: "calc(100% - 374px)", bottom: "64px" });
      // The same place for the same input: nothing in it moves with the page's scroll (the box passes the measured rectangles; this one ignores them).
      const style = (top: number) => buttonStyle(placeButton({ left: 40, top, right: 200, bottom: top + 20 }, { width: 390, height: 844 }, column(390)));
      expect(style(100)).toEqual(style(700));
    });
  });

  it("placeCard: 360 px under the selection on a spread; the whole width under it on a phone", () => {
    const spread = placeCard({ left: 300, top: 400, right: 420, bottom: 420 }, { width: 1440, height: 900 });
    const phone = placeCard({ left: 40, top: 300, right: 200, bottom: 320 }, { width: 390, height: 780 });

    expect(spread).toMatchObject({ left: 300, width: 360, top: 428 });
    expect(phone).toMatchObject({ left: 12, width: 366 });
    expect(phone.top).toBe(328);
  });

  it("placeCard: never wider than the window, never off its right edge, flipped above when there is no room below", () => {
    const edge = placeCard({ left: 1300, top: 400, right: 1400, bottom: 420 }, { width: 1440, height: 900 });
    expect(edge.left + edge.width).toBeLessThanOrEqual(1440 - 12);

    const low = placeCard({ left: 300, top: 760, right: 420, bottom: 780 }, { width: 1440, height: 800 });
    expect(low.top).toBeUndefined();
    expect(low.bottom).toBe(800 - 760 + 8);
    expect(low.maxHeight).toBeGreaterThanOrEqual(120);

    const tiny = placeCard({ left: 10, top: 10, right: 30, bottom: 30 }, { width: 300, height: 700 });
    expect(tiny.width).toBe(276);
    // Whatever the room, the card's tallest extent stays in the window.
    for (const rect of [{ left: 0, top: 0, right: 5, bottom: 5 }, { left: 100, top: 690, right: 120, bottom: 700 }, { left: 100, top: 350, right: 120, bottom: 360 }]) {
      const at = placeCard(rect, { width: 1024, height: 700 });
      if (at.top !== undefined) expect(at.top + at.maxHeight).toBeLessThanOrEqual(700 - 12 + 0.001);
      if (at.bottom !== undefined) expect(700 - at.bottom - at.maxHeight).toBeGreaterThanOrEqual(12 - 0.001);
    }
  });
});

describe("explainLlmOverride", () => {
  it("is the reader's own provider and key when they have one", () => {
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "  USER-NOT-A-KEY  " })).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
  });

  it("is nothing for Peer's own model, or a provider with no key", () => {
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "default", feedAiApiKey: "USER-NOT-A-KEY" })).toBeUndefined();
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: "   " })).toBeUndefined();
    expect(explainLlmOverride({ ...defaultProfile, feedAiProvider: "gemini", feedAiApiKey: undefined })).toBeUndefined();
  });
});

describe("requestExplanation — what is sent, and what comes back", () => {
  const paper: Paper = {
    id: "upload:0123456789abcdef", title: "A paper", authors: [], relevanceReason: "", venue: "", source: "other",
    summaryIntro: "", summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
  };
  const args = { paper, selection: { sectionIndex: 1, paragraphIndex: 1, passage: selection.passage }, sectionId: "s2" };

  function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("posts the paper, the passage and where it sits, with no thread, to the paper's own explain route", async () => {
    const fetchMock = stubFetch(200, { answer, cached: false });
    await requestExplanation(args);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/papers/upload%3A0123456789abcdef/explain");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ paper, passage: selection.passage, sectionId: "s2", paragraphIndex: 1, thread: [] });
  });

  it("carries the reader's own key only when there is one", async () => {
    const fetchMock = stubFetch(200, { answer, cached: false });
    await requestExplanation({ ...args, llmOverride: { provider: "gemini", apiKey: "USER-NOT-A-KEY" } });
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];

    expect(JSON.parse(String(init.body)).llmOverride).toEqual({ provider: "gemini", apiKey: "USER-NOT-A-KEY" });
  });

  it("returns the answer", async () => {
    stubFetch(200, { answer, cached: true });

    expect(await requestExplanation(args)).toEqual(answer);
  });

  // P4-00c (§1h.11 (a)): the first answer may carry a table; the browser keeps the rows that are
  // three cells of words, at most four — what a reply's parse keeps — and no key it was not sent.
  it("returns the answer's table: the rows that are three cells of words, at most four, in order", async () => {
    const row = (term: string) => ({ term, here: "what it means in this paper", read: "how to read it" });
    stubFetch(200, { answer: { ...answer, items: [row("a"), { term: "b", here: "x" }, "text", null, row("c"), row("d"), row("e"), row("f")] }, cached: false });
    const got = await requestExplanation(args);

    expect(got).toEqual({ ...answer, items: [row("a"), row("c"), row("d"), row("e")] });
  });

  it("returns an answer with no items key when the table is empty, not a list or has no usable row", async () => {
    for (const items of [[], "table", 5, {}, [{ term: "a" }], [null]]) {
      stubFetch(200, { answer: { ...answer, items }, cached: false });
      expect(await requestExplanation(args), JSON.stringify(items)).toEqual(answer);
    }
  });

  // P4-00c (§1h.11 (d)): the notation the server verified is the notation the reader sees — through the
  // browser's parse and the card's render.
  it("returns the quote with the author's notation untouched, and the card shows it: `f_cell` and `α_1`", async () => {
    const quote = "The ratio f_cell was 0.4 across every cell, and α_1 stayed near 0.2.";
    const notated = { ...answer, here: { ...answer.here, evidence: quote } };
    stubFetch(200, { answer: notated, cached: false });
    const got = await requestExplanation(args);

    expect(got).toEqual(notated);
    const html = renderToStaticMarkup(createElement(ExplainCard, { passage: selection.passage, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer: got as ExplainAnswer }, onClose: () => {} }));
    expect(html).toContain("The ratio f_cell was 0.4 across every cell, and α_1 stayed near 0.2.");
    expect(html).not.toContain("fcell");
  });

  it("is 'unavailable' for an unavailable answer, an outage, a gone upload, a refusal and a network failure", async () => {
    stubFetch(200, { unavailable: true });
    expect(await requestExplanation(args)).toBe("unavailable");
    for (const status of [401, 404, 410, 429, 500, 503]) {
      stubFetch(status, { error: "x" });
      expect(await requestExplanation(args)).toBe("unavailable");
    }
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new TypeError("offline"))));
    expect(await requestExplanation(args)).toBe("unavailable");
  });

  it("is 'unavailable' for an answer that is not the shape it was promised", async () => {
    stubFetch(200, "not json");
    expect(await requestExplanation(args)).toBe("unavailable");
    stubFetch(200, { answer: { meaning: 5 }, cached: false });
    expect(await requestExplanation(args)).toBe("unavailable");
    stubFetch(200, {});
    expect(await requestExplanation(args)).toBe("unavailable");
  });

  it("is 'not_in_paper' for a 422", async () => {
    stubFetch(422, { error: "not_in_paper" });

    expect(await requestExplanation(args)).toBe("not_in_paper");
  });
});
