import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ExplainAnswer } from "@/lib/papers/explain";
import type { ExplainTurn } from "@/store/explain-threads";
import { SectionLinks } from "./evidence-quote";
import { ExplainCard, type ExplainStatus, type ThreadView } from "./explain-box";

// P12-81 (A P12-72, observation O2; the manager's brief §1h.459 (c)): the Explain card's body scroller keeps the wheel to itself, as the
// sticky note's body (`sticky-note.tsx`), the notes window (`notes-window.tsx`) and the figure card's caption (`figure-card.tsx`) do with
// `overscroll-contain`. A wheel that ran past the end of the Explain card's content chained on to the page (A measured 2,700 px of page
// movement with an Explain card open, against 0 px with a sticky). The Explain card is the one element that scrolls (`overflow-y-auto`, in
// `ExplainCard`), in all four of its places: the dock, the dock in the split margin (`compact`), the card under the selection, and the
// phone's sheet. The class is pinned on that element, the way `figure-card.test.tsx` pins the caption's: the markup is rendered with
// react-dom/server (this project's Vitest has no DOM); the pixels (page movement after the wheel's end) are A's browser measure.
// Every text is invented.

const PASSAGE = "The rafting ratio rose from 0.2 to 0.7 as the specimen crept at 1100 C.";
const answer: ExplainAnswer = { meaning: "A rafting ratio says how much of a sample has turned into plates.", here: { text: "The authors use it to compare alloys on one scale.", peer: true } };
const turns: ExplainTurn[] = [{ role: "reader", text: "Why does a bigger ratio matter?" }, { role: "peer", text: "It changes how the metal carries load.", peer: true }];
const view: ThreadView = { turns, draft: "", pending: false, failed: false, onDraft: () => {}, onSend: () => {} };

const markup = (over: Partial<Parameters<typeof ExplainCard>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: ["1 Introduction", "2 Methods"] },
      createElement(ExplainCard, { passage: PASSAGE, heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer } as ExplainStatus, onClose: () => {}, thread: view, ...over }),
    ),
  );

/** The class list of the card's root element: the one that carries `data-explain-card`. */
const cardClasses = (html: string): string[] => {
  const tag = /<div\b[^>]*\bdata-explain-card=""[^>]*>/.exec(html)?.[0] ?? "";
  const classes = (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").replace(/&amp;/g, "&");
  return classes.split(/\s+/).filter(Boolean);
};

const PLACES = [
  ["the dock", { dock: true }],
  ["the dock in the split margin (compact)", { dock: true, compact: true }],
  ["the card under the selection", {}],
  ["the phone's sheet", { sheet: true }],
] as const;

describe("the Explain card's body scroller keeps the wheel to itself (P12-81, O2)", () => {
  it.each(PLACES)("%s: the scrolling element is `overflow-y-auto overscroll-contain`", (_name, place) => {
    const classes = cardClasses(markup(place));

    expect(classes).toContain("overflow-y-auto");
    expect(classes).toContain("overscroll-contain");
  });

  it("the class is on the element that scrolls, once, and the card's other classes are as they were", () => {
    for (const [name, place] of PLACES) {
      const classes = cardClasses(markup(place));

      expect(classes.filter((c) => c === "overscroll-contain"), name).toHaveLength(1);
      expect(classes.filter((c) => c === "overflow-y-auto"), name).toHaveLength(1);
      // Nothing else changed: still a bordered, opaque, focusable-by-script card with the ragged-right override.
      for (const kept of ["z-[70]", "border", "border-border-strong", "bg-surface", "outline-none", "[&_.reading-justify]:text-left"]) expect(classes, `${name}: ${kept}`).toContain(kept);
    }
  });
});
