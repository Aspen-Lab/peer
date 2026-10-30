import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import * as toolbarModule from "./selection-toolbar";
import {
  OPEN_CARD_SELECTOR,
  SELECTION_LABELS,
  SelectionToolbar,
  SelectionToolbarView,
  actionsPlace,
  offeredActions,
  openCardRects,
  selectionCanExplain,
  toolbarPlace,
  type ActionsMode,
} from "./selection-toolbar";
import { MARGIN_CARD_SELECTOR, placeInMargin, type MarginRect } from "@/lib/reader/margin";
import { STACK_Z_BASE } from "@/lib/reader/windows";
import type { PaperTerm } from "@/lib/papers/report";

// P10-09a (review 7.1, 8.4; rubric B3; ruling §1h.78): selecting text shows one small pill just above the
// selection's first line, with two buttons: "Explain this" and "Take notes". It never covers the selected words,
// stays inside the window and clear of the masthead, and is not drawn under 768 px (the thumb bar has the explain
// cell there; "Take notes" on a phone is deferred). Every text is invented.

type Props = Record<string, unknown> & { children?: ReactNode };
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  return [element, ...elements(element.props.children)];
}

const SIZE = { width: 220, height: 32 };
const VIEW = { width: 1440, height: 1000 };
const bounds = { left: 300, top: 400, right: 520, bottom: 440 };

describe("reading mark actions", () => {
  it("offers bold and circle only when the caller says the passage can be marked", () => {
    const actions = offeredActions({ canExplain: false, onHighlight: () => {}, canHighlight: true, onBold: () => {}, onCircle: () => {}, canFormat: true });
    expect(actions).toEqual(["note", "highlight", "bold", "circle"]);
    expect(offeredActions({ canExplain: false, onBold: () => {}, onCircle: () => {}, canFormat: false })).toEqual(["note"]);
    const html = renderToStaticMarkup(createElement(SelectionToolbarView, { place: { left: 0, top: 0, below: false }, canExplain: false, onExplain: () => {}, onTakeNote: () => {}, onBold: () => {}, onCircle: () => {} }));
    expect(html).toContain("data-selection-bold");
    expect(html).toContain("data-selection-circle");
  });
});

describe("toolbarPlace", () => {
  it("stands just above the selection's first line, left-aligned with it", () => {
    const place = toolbarPlace({ bounds, viewport: VIEW, size: SIZE });
    expect(place).toEqual({ left: 300, top: 400 - 32 - 6, below: false });
  });

  it("keeps inside the window at the right edge", () => {
    const place = toolbarPlace({ bounds: { ...bounds, left: 1400, right: 1430 }, viewport: VIEW, size: SIZE });
    expect(place!.left + SIZE.width).toBeLessThanOrEqual(VIEW.width - 8);
    expect(place!.left).toBeGreaterThanOrEqual(8);
  });

  it("goes under the selection, not over its words, when the masthead leaves no room above", () => {
    const high = { left: 300, top: 60, right: 520, bottom: 84 };
    const place = toolbarPlace({ bounds: high, viewport: VIEW, size: SIZE })!;
    expect(place.below).toBe(true);
    expect(place.top).toBeGreaterThanOrEqual(high.bottom);
  });

  it("never covers the selected words wherever it stands", () => {
    for (const top of [52, 60, 90, 400, 900]) {
      const sel = { left: 300, top, right: 520, bottom: top + 22 };
      const place = toolbarPlace({ bounds: sel, viewport: VIEW, size: SIZE })!;
      const overlapsRows = place.top < sel.bottom && place.top + SIZE.height > sel.top;
      expect(overlapsRows).toBe(false);
    }
  });

  it("is not drawn under 768 px", () => {
    expect(toolbarPlace({ bounds, viewport: { width: 390, height: 800 }, size: SIZE })).toBeNull();
    expect(toolbarPlace({ bounds, viewport: { width: 767, height: 800 }, size: SIZE })).toBeNull();
    expect(toolbarPlace({ bounds, viewport: { width: 768, height: 800 }, size: SIZE })).not.toBeNull();
  });
});

describe("SelectionToolbarView", () => {
  it("is one pill with two buttons, Explain this and Take notes", () => {
    // P11-13 (rule 1): the labels gain "Highlight" — the third action, drawn only where the page hands a handler (below).
    expect(SELECTION_LABELS).toEqual({ explain: "Explain this", note: "Take notes", highlight: "Highlight" });
    const html = renderToStaticMarkup(createElement(SelectionToolbarView, { place: { left: 300, top: 362, below: false }, canExplain: true, onExplain: () => {}, onTakeNote: () => {} }));
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toContain(">Explain this<");
    expect(html).toContain(">Take notes<");
    expect(html).toContain("fixed");
    expect(html).toContain("left:300px");
    expect(html).toContain("top:362px");
  });

  it("calls the page's explain action and the take-note action, and keeps the selection when pressed", () => {
    const onExplain = vi.fn();
    const onTakeNote = vi.fn();
    const tree = SelectionToolbarView({ place: { left: 0, top: 0, below: false }, canExplain: true, onExplain, onTakeNote });
    const buttons = elements(tree).filter((el) => el.type === "button");
    expect(buttons).toHaveLength(2);
    for (const button of buttons) {
      const preventDefault = vi.fn();
      (button.props.onMouseDown as (e: unknown) => void)({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    }
    (buttons[0].props.onClick as () => void)();
    (buttons[1].props.onClick as () => void)();
    expect(onExplain).toHaveBeenCalledTimes(1);
    expect(onTakeNote).toHaveBeenCalledTimes(1);
  });
});

describe("SelectionToolbar", () => {
  it("draws nothing without a selection", () => {
    expect(renderToStaticMarkup(createElement(SelectionToolbar, { target: null, canExplain: true, onExplain: () => {}, onTakeNote: () => {} }))).toBe("");
  });
});

// P10-08b (rule 3; P10-08's unsettled 2): the pill offers "Explain this" only when the page can explain. With no key
// and no term of the paper's own inside the selection the explain action does nothing (a locked block is hidden, never
// shown broken — §1b), so the pill shows "Take notes" alone; with a key, both; with no key and a defined term, both
// (the Tier 0 definition). The page hands the toolbar one boolean, `canExplain`, made by `selectionCanExplain` from the
// same `definingTerm` check the explain box uses.
const AT = { left: 300, top: 362, below: false };

describe("SelectionToolbarView — Explain this only when the page can explain (P10-08b, rule 3)", () => {
  const view = (canExplain: boolean) =>
    renderToStaticMarkup(createElement(SelectionToolbarView, { place: AT, onExplain: () => {}, onTakeNote: () => {}, canExplain }));

  it("shows Take notes alone when the page cannot explain", () => {
    const html = view(false);
    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain(">Take notes<");
    expect(html).not.toContain("Explain this");
    expect(html).not.toContain("data-selection-explain");
  });

  it("shows both when the page can explain", () => {
    const html = view(true);
    expect(html.match(/<button\b/g)).toHaveLength(2);
    expect(html).toContain(">Explain this<");
    expect(html).toContain(">Take notes<");
  });

  it("keeps the note button whole when it stands alone: the same action, the press keeps the selection, no divider on its left", () => {
    const onTakeNote = vi.fn();
    const tree = SelectionToolbarView({ place: AT, onExplain: () => {}, onTakeNote, canExplain: false });
    const buttons = elements(tree).filter((el) => el.type === "button");
    expect(buttons).toHaveLength(1);
    const preventDefault = vi.fn();
    (buttons[0].props.onMouseDown as (e: unknown) => void)({ preventDefault });
    (buttons[0].props.onClick as () => void)();
    expect(preventDefault).toHaveBeenCalled();
    expect(onTakeNote).toHaveBeenCalledTimes(1);
    expect(String(buttons[0].props.className)).not.toContain("border-l");
  });
});

describe("selectionCanExplain — the three states (P10-08b, rule 3)", () => {
  const can = selectionCanExplain;
  const rafting: PaperTerm = { term: "rafting ratio", definition: "How much of the gauge length the plates cover.", evidence: "We define the rafting ratio as the fraction of the gauge length covered by plates." };
  const peerOnly: PaperTerm = { term: "creep", definition: "Slow deformation under load.", peer: true };
  const passage = "The rafting ratio rose as the specimen crept.";

  it("is false with no key and no term of the paper's own inside the selection", () => {
    expect(can({ canAsk: false, terms: [], passage })).toBe(false);
    expect(can({ canAsk: false, terms: [peerOnly], passage: "Slow creep under load" })).toBe(false);
    expect(can({ canAsk: false, terms: [rafting], passage: "Tungsten slowed plate formation." })).toBe(false);
  });

  it("is true with a key, whatever the selection holds", () => {
    expect(can({ canAsk: true, terms: [], passage })).toBe(true);
    expect(can({ canAsk: true, terms: [rafting], passage: "Tungsten slowed plate formation." })).toBe(true);
  });

  it("is true with no key and a defined term inside the selection (the Tier 0 definition)", () => {
    expect(can({ canAsk: false, terms: [peerOnly, rafting], passage })).toBe(true);
  });

  it("is false with no selection", () => {
    expect(can({ canAsk: true, terms: [rafting], passage: null })).toBe(false);
    expect(can({ canAsk: false, terms: [rafting], passage: null })).toBe(false);
  });
});

describe("the page's hand-off (P10-08b, rule 3)", () => {
  const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8").replace(/\s+/g, " ");

  it("gives the toolbar the one boolean, made from the same key flag and terms the explain box gets", () => {
    expect(page).toContain("canExplain={selectionCanExplain({ canAsk: explainCanAsk, terms, passage: explainTarget?.passage ?? null })}");
    expect(page).toContain("<ExplainBox key={paper.id} target={explainTarget} terms={terms} canAsk={explainCanAsk}");
  });

  // P11-27 rule 2, RE-AIMED (§1c) twice: the view was handed the page's boolean less a heading's or a caption's selection (`explainable`: `canExplain && target?.block ===
  // undefined`); P11-42 rule 2 (ruling §1h.139 (b)) hands it the page's boolean whole, for a heading's and a caption's selection as for a paragraph's (the flow test pins all three).
  it("hands the boolean on to the pill it draws, and keeps the explain check the box's own", () => {
    const toolbar = readFileSync(resolve(process.cwd(), "src/components/reader/selection-toolbar.tsx"), "utf8").replace(/\s+/g, " ");
    expect(toolbar).toContain("const explainable = canExplain;");
    expect(toolbar).not.toContain("target?.block");
    expect(toolbar).toContain("<SelectionToolbarView place={place} canExplain={explainable}");
    expect(toolbar).toContain("definingTerm(input.terms, input.passage)");
  });
});

// ── P11-13 (owner items 5 and 8; B P11-03 §2; ruling §1h.113) ────────────────────────────────────────────────────────────────
// The selection's actions stand in the right margin, level with the selection's first line: Explain this, Take notes and
// Highlight, one under the other. Where there is no margin (a window under 1024 px, a page without the shell), or an open card
// covers the place, the group is today's pill above the selection, now with the three buttons side by side. Under 768 px nothing
// is drawn (the thumb bar has the cells). `margin.ts` (C P11-10) is the margin's code; this file only reads it. Every text and
// number is invented.

const MARGIN: MarginRect = { left: 1080, width: 360, top: 48, bottom: 960 };
const SIZES = { margin: { width: 112, height: 90 }, above: { width: 285, height: 32 } };
// P11-27 (§1c): `actionsPlace` takes no cards and no mode any more (the group stands in the margin over whatever card is there); the helper still lets a
// test list a card, or the mode the group was drawn in, to show they change nothing.
type Box = { left: number; top: number; right: number; bottom: number };
type PlaceOver = Partial<Parameters<typeof actionsPlace>[0]> & { cards?: readonly Box[]; mode?: ActionsMode | null };
const place = (over: PlaceOver = {}) => actionsPlace({ bounds, viewport: VIEW, margin: MARGIN, sizes: SIZES, ...over } as Parameters<typeof actionsPlace>[0]);
/** A card rect `gap` px under the group that a selection at `top` gets in the margin (the group's foot is `top + 90`). */
const cardUnder = (top: number, gap: number) => ({ left: MARGIN.left, top: top + SIZES.margin.height + gap, right: MARGIN.left + MARGIN.width, bottom: top + SIZES.margin.height + gap + 200 });

describe("actionsPlace — the group in the margin at the selection's height (P11-13, rule 2)", () => {
  it("stands in the margin, 8 px in from its left edge, level with the selection's first line", () => {
    expect(place()).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 400, below: false });
  });

  it("takes its height from `placeInMargin`, the margin's own rule: held at the band's top under the masthead, at its foot near the bottom", () => {
    const high = place({ bounds: { left: 300, top: 30, right: 520, bottom: 54 } })!;
    expect(high.mode).toBe("margin");
    expect(high.top).toBe(MARGIN.top);
    expect(high.top).toBe(placeInMargin(MARGIN, 30, SIZES.margin.height));

    const low = place({ bounds: { left: 300, top: 940, right: 520, bottom: 962 } })!;
    expect(low.mode).toBe("margin");
    expect(low.top).toBe(MARGIN.bottom - SIZES.margin.height);
    expect(low.top).toBe(placeInMargin(MARGIN, 940, SIZES.margin.height));
    // …and the whole group stays inside the band.
    expect(low.top + SIZES.margin.height).toBeLessThanOrEqual(MARGIN.bottom);
  });

  it("follows the margin when it moves (a divider drag): the left edge is always the margin's plus 8", () => {
    expect(place({ margin: { ...MARGIN, left: 900, width: 540 } })!.left).toBe(908);
    expect(place({ margin: { ...MARGIN, left: 1180, width: 260 } })!.left).toBe(1188);
  });

  it("is today's pill, horizontal, above the selection when there is no margin: the same place `toolbarPlace` gives", () => {
    const got = place({ margin: null })!;
    expect(got).toEqual({ mode: "above", ...toolbarPlace({ bounds, viewport: VIEW, size: SIZES.above })! });
    expect(got).toEqual({ mode: "above", left: 300, top: 400 - 32 - 6, below: false });
    // The masthead leaves no room above: under the last line, as `toolbarPlace` has it.
    const high = place({ margin: null, bounds: { left: 300, top: 60, right: 520, bottom: 84 } })!;
    expect(high.mode).toBe("above");
    expect(high.below).toBe(true);
  });

  it("draws nothing under 768 px, with a margin or without one", () => {
    for (const width of [390, 600, 767]) {
      expect(place({ viewport: { width, height: 800 } })).toBeNull();
      expect(place({ viewport: { width, height: 800 }, margin: null })).toBeNull();
    }
    expect(place({ viewport: { width: 768, height: 800 }, margin: null })).not.toBeNull();
  });

  it("is hidden while the selection is wholly out of view, in the margin as in the pill", () => {
    for (const margin of [MARGIN, null]) {
      expect(place({ margin, bounds: { left: 300, top: 10, right: 520, bottom: 48 } })).toBeNull();
      expect(place({ margin, bounds: { left: 300, top: 1000, right: 520, bottom: 1022 } })).toBeNull();
      expect(place({ margin, bounds: { left: 300, top: 40, right: 520, bottom: 70 } })).not.toBeNull();
    }
  });

  // P11-27 rule 1, RE-AIMED (§1c) — ruling §1h.122 amends §1h.113 (b) O-2: the group no longer goes above the selection when a card covers its place; it stands
  // in the margin over the card. The fixtures are the ones that sent it above (the card over the group, 3 px and 4 px under it, over it, every card), the
  // expectation is the group where it would have stood with no card at all. The four tests keep their cards and flip their answers.
  describe("an open card that covers the group (re-aimed: the group stays in the margin, over it)", () => {
    const covering = { left: MARGIN.left, top: 380, right: MARGIN.left + MARGIN.width, bottom: 700 };
    const LEVEL = { mode: "margin", left: MARGIN.left + 8, top: 400, below: false };

    it("stays in the margin, the same place as with no card (it was the pill above the selection, until the card was gone)", () => {
      expect(place({ cards: [covering] })).toEqual(LEVEL);
      expect(place({ cards: [covering] })).toEqual(place({ cards: [] }));
    });

    it("is not moved by a card 3 px or 4 px under it, or 3 px or 4 px over it (it used to count a card within 4 px as covering)", () => {
      for (const gap of [3, 4]) expect(place({ cards: [cardUnder(400, gap)] })).toEqual(LEVEL);
      const over = (gap: number) => ({ left: MARGIN.left, top: 100, right: MARGIN.left + MARGIN.width, bottom: 400 - gap });
      for (const gap of [3, 4]) expect(place({ cards: [over(gap)] })).toEqual(LEVEL);
    });

    it("is not troubled by a card at the other side of the window, or one nowhere near", () => {
      expect(place({ cards: [{ left: 20, top: 380, right: 300, bottom: 700 }] })!.mode).toBe("margin");
      expect(place({ cards: [{ left: MARGIN.left, top: 600, right: MARGIN.left + MARGIN.width, bottom: 900 }] })!.mode).toBe("margin");
    });

    it("is not moved by any card of several, not only the first", () => {
      expect(place({ cards: [{ left: 20, top: 380, right: 300, bottom: 700 }, covering] })).toEqual(LEVEL);
    });
  });

  // RE-AIMED (§1c): the tests that pinned the 12 px of hysteresis between the margin and the pill ("goes above at once when covered, and comes back to the margin
  // only after 12 px more of room", "keeps one mode through a scroll past the card's edge, and changes twice at most") now pin that with one mode there is nothing to switch
  // between: the mode the group was drawn in before (`mode`, no longer an input) changes nothing, and a selection scrolling past a card's edge never changes mode.
  // "is 12 px" (the constant's value) is retired with the constant: its absence is pinned in the P11-27 block below.
  describe("no hysteresis: one mode with a margin, whatever mode it was drawn in before (re-aimed)", () => {
    it("does not depend on the mode it was drawn in: with a card 3, 10, 15 or 16 px from it, from the margin, from above, or fresh", () => {
      const at = (mode: ActionsMode | null, gap: number) => place({ mode, cards: [cardUnder(400, gap)] })!.mode;
      for (const mode of ["margin", "above", null] as const) for (const gap of [3, 4, 10, 15, 16]) expect(at(mode, gap), `${mode} ${gap}`).toBe("margin");
    });

    it("keeps one mode through a scroll past the card's edge: it never changes", () => {
      // A card at the top of the margin ends at y 500; the selection's first line scrolls from 520 up to 503 and back to 516.
      const card = { left: MARGIN.left, top: 48, right: MARGIN.left + MARGIN.width, bottom: 500 };
      const path = [520, 510, 505, 503, 506, 512, 515, 516, 520, 505, 503];
      const seen = path.map((top) => place({ cards: [card], bounds: { left: 300, top, right: 520, bottom: top + 22 } })!.mode);
      expect(seen).toEqual(path.map(() => "margin"));
    });
  });
});

describe("openCardRects — the cards that stand open (P11-13, rule 2)", () => {
  const el = (box: { left: number; top: number; right: number; bottom: number }) => ({
    getBoundingClientRect: () => ({ ...box, width: box.right - box.left, height: box.bottom - box.top }),
  });

  // P11-17c rule 4, RE-AIMED (§1c) from "asks for the margin's cards, the explain dock and the sticky and notes windows, until they all carry the
  // margin's attribute": every card of the margin carries `data-margin-card` now (`margin-card.markers.test.tsx` pins each, in the markup), so
  // the legacy list — `[data-explain-dock]`, `[data-sticky]`, `[data-notes-window]` — is retired and the selector is the margin's alone.
  it("asks for the margin's cards by their one marker, and for no legacy marker", () => {
    expect(OPEN_CARD_SELECTOR).toBe(MARGIN_CARD_SELECTOR);
    expect(OPEN_CARD_SELECTOR).not.toContain("[data-explain-dock]");
    expect(OPEN_CARD_SELECTOR).not.toContain("[data-sticky]");
    expect(OPEN_CARD_SELECTOR).not.toContain("[data-notes-window]");
  });

  it("reads each one's rect, and leaves out a card with no box (hidden)", () => {
    const asked: string[] = [];
    const root = {
      querySelectorAll: (selector: string) => {
        asked.push(selector);
        return [el({ left: 1080, top: 48, right: 1440, bottom: 88 }), el({ left: 0, top: 0, right: 0, bottom: 0 }), el({ left: 1080, top: 88, right: 1440, bottom: 400 })];
      },
    };
    expect(openCardRects(root as never)).toEqual([
      { left: 1080, top: 48, right: 1440, bottom: 88 },
      { left: 1080, top: 88, right: 1440, bottom: 400 },
    ]);
    expect(asked).toEqual([OPEN_CARD_SELECTOR]);
  });

  it("is empty when no card is open", () => {
    expect(openCardRects({ querySelectorAll: () => [] } as never)).toEqual([]);
  });
});

describe("offeredActions — which of the three buttons are on offer (P11-13, rule 1)", () => {
  const handler = () => {};

  it("is Explain this, Take notes and Highlight, in that order, when the page can explain and has a highlight to hand", () => {
    expect(offeredActions({ canExplain: true, onHighlight: handler, canHighlight: true })).toEqual(["explain", "note", "highlight"]);
  });

  it("leaves Explain this out when the page cannot explain (P10-08b, unchanged), and Highlight out until the page passes a handler and says it can", () => {
    expect(offeredActions({ canExplain: false, onHighlight: handler, canHighlight: true })).toEqual(["note", "highlight"]);
    expect(offeredActions({ canExplain: true })).toEqual(["explain", "note"]);
    expect(offeredActions({ canExplain: true, onHighlight: handler })).toEqual(["explain", "note"]);
    expect(offeredActions({ canExplain: true, onHighlight: handler, canHighlight: false })).toEqual(["explain", "note"]);
    expect(offeredActions({ canExplain: true, canHighlight: true })).toEqual(["explain", "note"]);
    expect(offeredActions({ canExplain: false })).toEqual(["note"]);
  });
});

describe("SelectionToolbarView — the three actions, in the margin and above (P11-13, rules 1 and 2)", () => {
  const IN_MARGIN = { mode: "margin" as const, left: 1088, top: 400, below: false };
  const ABOVE = { mode: "above" as const, left: 300, top: 362, below: false };
  const view = (over: Record<string, unknown> = {}) =>
    createElement(SelectionToolbarView, { place: IN_MARGIN, canExplain: true, onExplain: () => {}, onTakeNote: () => {}, onHighlight: () => {}, ...over } as never);

  it("holds Explain this, Take notes and Highlight, in that order, when the page hands a highlight", () => {
    for (const mode of [IN_MARGIN, ABOVE]) {
      const html = renderToStaticMarkup(view({ place: mode }));
      expect(html.match(/<button\b/g)).toHaveLength(3);
      expect(html.indexOf(">Explain this<")).toBeGreaterThan(-1);
      expect(html.indexOf(">Explain this<")).toBeLessThan(html.indexOf(">Take notes<"));
      expect(html.indexOf(">Take notes<")).toBeLessThan(html.indexOf(">Highlight<"));
      expect(html).toContain("data-selection-highlight");
    }
  });

  it("has no Highlight until the page passes a handler (it is not wired yet), and no Explain this where the page cannot explain", () => {
    const none = renderToStaticMarkup(view({ onHighlight: undefined }));
    expect(none.match(/<button\b/g)).toHaveLength(2);
    expect(none).not.toContain("Highlight");
    expect(none).not.toContain("data-selection-highlight");

    const noExplain = renderToStaticMarkup(view({ canExplain: false }));
    expect(noExplain.match(/<button\b/g)).toHaveLength(2);
    expect(noExplain).toContain(">Take notes<");
    expect(noExplain).toContain(">Highlight<");
    expect(noExplain).not.toContain("Explain this");
  });

  it("stands one under the other at the margin's height: fixed at the place, a vertical toolbar named Selection actions", () => {
    const html = renderToStaticMarkup(view());
    expect(html).toContain("left:1088px");
    expect(html).toContain("top:400px");
    expect(html).toContain("fixed");
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Selection actions"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain("flex-col");
    expect(html).toContain('data-mode="margin"');
  });

  it("is today's horizontal pill above the selection otherwise: a row, no vertical orientation", () => {
    const html = renderToStaticMarkup(view({ place: ABOVE }));
    expect(html).toContain("left:300px");
    expect(html).toContain("top:362px");
    expect(html).toContain('data-mode="above"');
    expect(html).not.toContain("flex-col");
    expect(html).not.toContain('aria-orientation="vertical"');
    // A place without a mode (the old `ToolbarPlace`) is the pill as it was.
    const old = renderToStaticMarkup(view({ place: { left: 300, top: 362, below: false } }));
    expect(old).toContain('data-mode="above"');
  });

  it("calls the three handlers, each from its own button, and every press keeps the selection", () => {
    const onExplain = vi.fn();
    const onTakeNote = vi.fn();
    const onHighlight = vi.fn();
    const tree = SelectionToolbarView({ place: IN_MARGIN, canExplain: true, onExplain, onTakeNote, onHighlight });
    const buttons = elements(tree).filter((el) => el.type === "button");
    expect(buttons).toHaveLength(3);
    for (const button of buttons) {
      const preventDefault = vi.fn();
      (button.props.onMouseDown as (e: unknown) => void)({ preventDefault });
      expect(preventDefault).toHaveBeenCalled();
    }
    (buttons[2].props.onClick as () => void)();
    expect([onExplain.mock.calls.length, onTakeNote.mock.calls.length, onHighlight.mock.calls.length]).toEqual([0, 0, 1]);
    (buttons[0].props.onClick as () => void)();
    (buttons[1].props.onClick as () => void)();
    expect([onExplain.mock.calls.length, onTakeNote.mock.calls.length, onHighlight.mock.calls.length]).toEqual([1, 1, 1]);
  });

  it("uses the same uncluttered action buttons in a row and in the margin", () => {
    for (const markup of [renderToStaticMarkup(view()), renderToStaticMarkup(view({ place: ABOVE }))]) {
      expect(markup.match(/class="reader-selection-action"/g)).toHaveLength(3);
      expect(markup).not.toContain("border-t");
      expect(markup).not.toContain("border-l");
    }
  });
});

describe("the toolbar's use of the margin (P11-13; ruling §1h.113 (d))", () => {
  const toolbar = readFileSync(resolve(process.cwd(), "src/components/reader/selection-toolbar.tsx"), "utf8").replace(/\s+/g, " ");

  it("reads the margin through C P11-10's contract — useMarginRect and placeInMargin — and builds no margin of its own", () => {
    expect(toolbar).toContain('from "@/lib/reader/margin"');
    expect(toolbar).toContain("useMarginRect()");
    expect(toolbar).toContain("placeInMargin(");
    expect(toolbar).not.toContain("readMargin");
    expect(toolbar).not.toContain("registerMargin");
  });

  it("reserves nothing and writes nothing on the page: the margin is empty until a selection, and the toolbar leaves it so", () => {
    expect(toolbar).not.toContain("reserveDock");
    expect(toolbar).not.toContain("setProperty");
    expect(toolbar).not.toContain("--explain-dock");
  });
});

// ── P11-27 rule 1 (owner item 5: "在选中的文字的同一高度的右侧margin部分显示"; round 1's walk X-1; ruling §1h.122, which amends §1h.113 (b) O-2) ──────────────────
// The group never leaves the margin: with a margin registered it stands there, level with the selection's first line, whatever card stands at that height —
// over the card, above it in z-order, on its own surface (the theme's surface, its border, a shadow), never over the centre column's words. The pill above
// the selection is for a window with no margin (under 1024 px) and nothing else. Cards the caller still lists are ignored by the place. Every number is invented.
describe("actionsPlace — over a card the group stays in the margin (P11-27 rule 1; ruling §1h.122)", () => {
  const LEVEL = { mode: "margin", left: MARGIN.left + 8, top: 400, below: false };
  const covering = { left: MARGIN.left, top: 380, right: MARGIN.left + MARGIN.width, bottom: 700 };

  it("stands in the margin, level with the first line, with a card standing at that height — the Explain card's whole height, a sticky's, a figure's", () => {
    expect(place({ cards: [covering] })).toEqual(LEVEL);
    expect(place({ cards: [{ ...covering, top: 48, bottom: 860 }] })).toEqual(LEVEL);
    expect(place({ cards: [{ ...covering, top: 300, bottom: 560 }] })).toEqual(LEVEL);
  });

  it("stands where it stood with a card 3 px under it, a card 3 px over it, a card on its very rect, and every card at once", () => {
    expect(place({ cards: [cardUnder(400, 3)] })).toEqual(LEVEL);
    expect(place({ cards: [cardUnder(400, 0)] })).toEqual(LEVEL);
    expect(place({ cards: [{ left: MARGIN.left, top: 100, right: MARGIN.left + MARGIN.width, bottom: 397 }] })).toEqual(LEVEL);
    expect(place({ cards: [{ left: MARGIN.left, top: 400, right: MARGIN.left + 112, bottom: 490 }] })).toEqual(LEVEL);
    expect(place({ cards: [covering, cardUnder(400, 3), { left: MARGIN.left, top: 48, right: MARGIN.left + MARGIN.width, bottom: 120 }] })).toEqual(LEVEL);
  });

  it("is never the pill above while a margin stands: at every first-line height, with a card over the whole band", () => {
    const wall = [{ left: MARGIN.left, top: MARGIN.top, right: MARGIN.left + MARGIN.width, bottom: MARGIN.bottom }];
    for (let top = 56; top <= 940; top += 12) {
      const got = place({ cards: wall, bounds: { left: 300, top, right: 520, bottom: top + 22 } })!;
      expect(got.mode, String(top)).toBe("margin");
      expect(got.top, String(top)).toBe(placeInMargin(MARGIN, top, SIZES.margin.height));
    }
  });

  it("never leaves the margin sideways, so never stands over the centre column's words: its left is the margin's plus 8, its right inside the margin", () => {
    for (const margin of [MARGIN, { ...MARGIN, left: 1000, width: 280 }, { ...MARGIN, left: 1180, width: 260 }]) {
      const got = place({ margin, cards: [{ left: margin.left, top: 380, right: margin.left + margin.width, bottom: 700 }] })!;
      expect(got.left).toBe(margin.left + 8);
      expect(got.left + SIZES.margin.width).toBeLessThanOrEqual(margin.left + margin.width);
    }
  });

  it("is the pill above the selection where there is no margin, with a card or without one: below 1024 nothing changes", () => {
    const got = place({ margin: null, cards: [covering] })!;
    expect(got).toEqual({ mode: "above", ...toolbarPlace({ bounds, viewport: VIEW, size: SIZES.above })! });
    expect(place({ margin: null, viewport: { width: 1000, height: 800 } })!.mode).toBe("above");
  });

  it("has retired the O-2 fallback: no slack to a card, no hysteresis between two modes", async () => {
    const toolbar = (await import("./selection-toolbar")) as Record<string, unknown>;
    expect(toolbar.CARD_SLACK_PX).toBeUndefined();
    expect(toolbar.MODE_HYSTERESIS_PX).toBeUndefined();
  });
});

describe("SelectionToolbarView — the group's own surface over a card (P11-27 rule 1)", () => {
  const IN_MARGIN = { mode: "margin" as const, left: 1088, top: 400, below: false };
  const html = (over: Record<string, unknown> = {}) =>
    renderToStaticMarkup(createElement(SelectionToolbarView, { place: IN_MARGIN, canExplain: true, onExplain: () => {}, onTakeNote: () => {}, onHighlight: () => {}, ...over } as never));
  const classes = (markup: string) => (markup.match(/^<div[^>]*class="([^"]*)"/)?.[1] ?? "").split(/\s+/);

  it("stands above every card of the stack in z-order: its z is over the stack's, whose first card is `STACK_Z_BASE` and one more for each card", () => {
    const z = Number(classes(html()).find((c) => c.startsWith("z-["))?.match(/\d+/)?.[0]);
    expect(z).toBeGreaterThan(STACK_Z_BASE + 9);
    // …and under the page's dialogs (the figure's lightbox and the key sheet stand at z-[80]).
    expect(z).toBeLessThan(80);
  });

  it("is its own surface: the theme's surface colour (opaque, no tint from the card under it), a border and a shadow", () => {
    const c = classes(html());
    expect(c).toContain("bg-surface");
    expect(c).toContain("border");
    expect(c).toContain("border-border-strong");
    expect(c).toContain("shadow-card-hover");
    for (const token of c) expect(token).not.toMatch(/^bg-surface\/|^opacity-|^backdrop-/);
  });

  it("says when it stands over a card, and says nothing when it does not", () => {
    expect(html({ overCard: true })).toContain("data-over-card");
    expect(html({ overCard: false })).not.toContain("data-over-card");
    expect(html()).not.toContain("data-over-card");
  });
});

// ── P11-38 rule 2 (owner item 5, "一旦点击其中一个，就会显示其中一个的功能"; round 2's Theme-B walk X-5; ruling §1h.138 (a)) ──────────────────────────────────────
// The group still stands in the margin level with the selection's first line, over a card's body where it must, but it never stands over a card's header row:
// its X, its title, its controls (Open as page, Export, zoom). Where the level place would cover one, the group stands on the header's free part if it fits whole,
// else just below the header; it never leaves the margin sideways (X-1 stays gone). Below 1024 px (no margin) nothing changes. The headers are read from the
// cards in the page (`readHeaders`), the place is made from them (`actionsPlace`'s `headers`, `clearOfHeaders`). Every number is invented.
// Reached through the module's namespace, so the suite type-checks against the code as it stood before the rule.
type Zone = { box: Box; parts: Box[] };
type Cleared = { left: number; top: number; how: string };
const toolbarApi = toolbarModule as unknown as {
  clearOfHeaders?: (input: { margin: MarginRect; size: { width: number; height: number }; left: number; top: number; headers: readonly Zone[] }) => Cleared;
  readHeaders?: (root: unknown) => Zone[];
};
const sized = (box: Box) => ({ ...box, width: box.right - box.left, height: box.bottom - box.top });
const sq = (left: number, top: number, right: number, bottom: number): Box => ({ left, top, right, bottom });
/** Where the group stands with `headers` on the page: the place `actionsPlace` makes for the default selection (first line at 400). */
const placeWith = (headers: Zone[], over: Record<string, unknown> = {}) => place({ headers, ...over } as never) as (ReturnType<typeof place> & { clear?: string }) | null;

describe("actionsPlace — never over a card's header (P11-38 rule 2; ruling §1h.138 (a))", () => {
  // A sticky's header, 40 px tall at the card's top (380): the title, a long quote head, the X at the end.
  const sticky = (headline: Box = sq(1148, 392, 1330, 408)): Zone => ({
    box: sq(1080, 380, 1440, 420),
    parts: [sq(1092, 392, 1140, 408), headline, sq(1400, 380, 1440, 420)],
  });
  // The explain card's header (P11-38, follow-up): its top row only — the big X and the title, from the card's top (390) to the row's foot (443). The quoted passage under
  // the row is the card's content, like a sticky's text. `title` is what the title's words cover: the element is as wide as the row, the words are not.
  const explainRow = (title: Box = sq(1145, 417, 1424, 433)): Zone => ({ box: sq(1080, 390, 1440, 443), parts: [sq(1097, 407, 1133, 443), title] });
  const explain: Zone = explainRow();

  it("stands where it stood when no header is under it: level with the first line, the keys of the place as they were", () => {
    const LEVEL = { mode: "margin", left: MARGIN.left + 8, top: 400, below: false };
    expect(placeWith([])).toEqual(LEVEL);
    expect(placeWith([{ box: sq(1080, 600, 1440, 640), parts: [sq(1092, 612, 1140, 628)] }])).toEqual(LEVEL);
    expect(placeWith([{ box: sq(1080, 300, 1440, 340), parts: [sq(1092, 312, 1140, 328)] }])).toEqual(LEVEL);
  });

  it("stands over a card's body, level with the line, when only the body is under it", () => {
    expect(placeWith([{ box: sq(1080, 300, 1440, 340), parts: [sq(1092, 312, 1140, 328)] }])?.top).toBe(400);
  });

  it("stands just below a sticky's header when the level place would cover its title (the line is inside the header: it moves less than the header is tall)", () => {
    const got = placeWith([sticky()])!;
    expect(got).toEqual({ mode: "margin", left: MARGIN.left + 8, top: 420, below: false, clear: "below" });
    expect(got.top - 400).toBeLessThanOrEqual(40);
  });

  // P11-38 follow-up, RE-AIMED (§1c): was "stands just below the explain card's header block — its X, its title and the quote — whatever height of it the line is at" (a
  // block 122 px tall: the group moved up to 118 px). The header is the top row only now (the quote is the card's content), 53 px from the card's top to the row's foot.
  it("stands just below the explain card's top row — its X and its title — whatever height of it the line is at: it moves less than the row is tall", () => {
    // (From a line at the row's foot only the X's last pixel is in the group's reach: the group stands to the right of it, on the row's free part.)
    for (const line of [391, 400, 430]) {
      const got = placeWith([explain], { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })!;
      expect(got.top, String(line)).toBe(443);
      expect(got.clear, String(line)).toBe("below");
      expect(got.top - line, String(line)).toBeLessThanOrEqual(explain.box.bottom - explain.box.top);
    }
  });

  it("leaves the quote under the row to the group: a line at the quote's height stands level over it", () => {
    for (const line of [443, 455, 480]) expect(placeWith([explain], { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })?.top, String(line)).toBe(line);
  });

  // P11-49 rule 2, RE-AIMED (ruling §1h.149): was "stands level with the line, beside the title's words, when they leave room: the explain card's row has a free part, and the move
  // is nothing" (the group 90 px tall level with a line inside a 53-px row, its foot over the quote under it). The header's free part is a place only if the whole group fits
  // inside the row; the row is 53 px, the group 90, so a short title leaves no place and the group stands just below the row, as it does for a long one.
  it("stands just below the explain card's row, not level beside the title's words, though they leave room: the row (53 px) is shorter than the group (90), so its free part is no place", () => {
    const short = explainRow(sq(1145, 417, 1226, 433));
    for (const line of [391, 400, 430]) {
      const got = placeWith([short], { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })!;
      expect(got, String(line)).toEqual({ mode: "margin", left: 1088, top: 443, below: false, clear: "below" });
    }
  });

  // P11-49 rule 2, RE-AIMED (ruling §1h.149): was "stands on the header's free part, level with the line, when it fits whole beside the title and the X (a short quote head leaves
  // room)" — the group 90 px tall level with a line inside a 40-px header, running 70 px below the row over the card's body. The free part is a place only if the whole group fits inside
  // the header row: a 40-px row does not hold a 90-px group, however much room it leaves beside the title, so the group stands just below the header.
  it("stands just below the header, not on its free part, when the title and the X leave room beside them: the header (40 px) is shorter than the group (90)", () => {
    const got = placeWith([sticky(sq(1148, 392, 1190, 408))])!;
    expect(got).toEqual({ mode: "margin", left: 1088, top: 420, below: false, clear: "below" });
    expect(got.top).toBeGreaterThanOrEqual(420);
  });

  it("stands below it, not on the free part, when the free part is narrower than the group", () => {
    const got = placeWith([sticky(sq(1148, 392, 1300, 408))])!;
    expect(got.clear).toBe("below");
    expect(got.top).toBe(420);
  });

  const stack: Zone[] = [
    sticky(),
    { box: sq(1080, 420, 1440, 460), parts: [sq(1092, 432, 1140, 448), sq(1148, 432, 1330, 448), sq(1400, 420, 1440, 460)] },
    { box: sq(1080, 460, 1440, 500), parts: [sq(1092, 472, 1140, 488), sq(1148, 472, 1330, 488), sq(1400, 460, 1440, 500)] },
    { box: sq(1080, 500, 1440, 536), parts: [sq(1090, 506, 1120, 530), sq(1130, 506, 1200, 530)] },
  ];

  // P11-38 follow-up, RE-AIMED (§1c): was "clears a whole stack of headers, one under the other: below the last of them, the front card's zoom row included" with the line at 400 and
  // `top` 536 (a move of 136 px). The group takes the nearest clear place now: above the stack's first header is 110 px from the line, below its last is 136, so it stands above.
  it("clears a whole stack of headers, one under the other, in the nearest clear place: above the first header at the top of the stack, below the last, the front card's zoom row included, lower in it", () => {
    const high = placeWith(stack)!;
    expect(high.clear).toBe("above");
    expect(high.top).toBe(380 - SIZES.margin.height);
    for (const line of [470, 480]) {
      const low = placeWith(stack, { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })!;
      expect(low.clear, String(line)).toBe("below");
      expect(low.top, String(line)).toBe(536);
    }
  });

  // P11-38 follow-up, RE-AIMED (§1c): was "moves down just far enough when the line is above the header and the group's foot would reach into it" (the header at 440, the line at 400:
  // below, 80 px). Above the header is 50 px from that line, so the group stands there; a line nearer the header's foot still goes below.
  it("moves just far enough when the line is above the header and the group's foot would reach into it: up when that is the shorter move, down when it is not", () => {
    const header: Zone = { box: sq(1080, 440, 1440, 480), parts: [sq(1092, 452, 1140, 468), sq(1148, 452, 1330, 468), sq(1400, 440, 1440, 480)] };
    const up = placeWith([header])!;
    expect(up.clear).toBe("above");
    expect(up.top).toBe(440 - SIZES.margin.height);
    const down = placeWith([header], { bounds: { left: 300, top: 430, right: 520, bottom: 452 } })!;
    expect(down.clear).toBe("below");
    expect(down.top).toBe(480);
  });

  it("takes the nearest clear place, and below when above and below are the same distance from the line", () => {
    const header: Zone = { box: sq(1080, 440, 1440, 480), parts: [sq(1092, 452, 1140, 468), sq(1148, 452, 1330, 468), sq(1400, 440, 1440, 480)] };
    // above is `440 − 90 = 350`, below is `480`: equally far from a line at 415.
    const tie = placeWith([header], { bounds: { left: 300, top: 415, right: 520, bottom: 437 } })!;
    expect(tie.clear).toBe("below");
    expect(tie.top).toBe(480);
    // …and for every line where the group's reach holds the header's title the move is the shorter of the two (a line higher or lower reaches only the X at the far end: the
    // group stands level, to the left of it).
    for (let line = 365; line <= 465; line += 5) {
      const got = placeWith([header], { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })!;
      const nearest = Math.min(Math.abs(480 - line), Math.abs(440 - SIZES.margin.height - line));
      expect(Math.abs(got.top - line), String(line)).toBe(nearest);
      expect(got.clear === "below" || got.clear === "above", String(line)).toBe(true);
    }
  });

  // P11-49 rule 2, RE-AIMED (ruling §1h.149): was "prefers the header's free part to either: the move is nothing, whatever the distance to the header's edges" (the group 90 tall on a
  // 40-px header's free part, `clear: "free"`, `top` the line). A group taller than the row has no free part to stand on: of just above and just below the nearer wins — here below,
  // 40 px from a line at the header's top, 10 px from one at its foot.
  it("has no free part to prefer for a group taller than the row: the move is to the header's foot, the nearer of just above and just below, whatever the line inside the header", () => {
    for (const line of [380, 390, 400, 410]) {
      const got = placeWith([sticky(sq(1148, 392, 1190, 408))], { bounds: { left: 300, top: line, right: 520, bottom: line + 22 } })!;
      expect(got.clear, String(line)).toBe("below");
      expect(got.top, String(line)).toBe(420);
    }
  });

  it("stands just above the header when there is no room below it in the band", () => {
    const got = placeWith([{ box: sq(1080, 900, 1440, 940), parts: [sq(1092, 912, 1140, 928), sq(1148, 912, 1330, 928), sq(1400, 900, 1440, 940)] }], { bounds: { left: 300, top: 880, right: 520, bottom: 902 } })!;
    expect(got.clear).toBe("above");
    expect(got.top).toBe(900 - SIZES.margin.height);
  });

  it("stays level, saying it is held, when no place in the band is clear of the headers", () => {
    const wall: Zone = { box: sq(1080, 48, 1440, 960), parts: [sq(1090, 48, 1430, 960)] };
    const got = placeWith([wall])!;
    expect(got.top).toBe(400);
    expect(got.clear).toBe("held");
  });

  it("never leaves the margin sideways, so never stands over the centre column's words, whatever header it clears", () => {
    for (const margin of [MARGIN, { ...MARGIN, left: 1000, width: 280 }, { ...MARGIN, left: 1180, width: 260 }]) {
      const dx = margin.left - MARGIN.left;
      const shift = (z: Zone): Zone => ({ box: { ...z.box, left: z.box.left + dx, right: z.box.right + dx }, parts: z.parts.map((p) => ({ ...p, left: p.left + dx, right: p.right + dx })) });
      for (const zone of [sticky(), sticky(sq(1148, 392, 1190, 408)), explain]) {
        const got = placeWith([shift(zone)], { margin })!;
        expect(got.mode).toBe("margin");
        expect(got.left).toBeGreaterThanOrEqual(margin.left + 8);
        expect(got.left + SIZES.margin.width).toBeLessThanOrEqual(margin.left + margin.width);
      }
    }
  });

  it("is the pill above the selection where there is no margin, headers or none: below 1024 nothing changes (rule 3)", () => {
    const pill = { mode: "above", ...toolbarPlace({ bounds, viewport: VIEW, size: SIZES.above })! };
    expect(placeWith([sticky(), explain], { margin: null })).toEqual(pill);
    expect(placeWith([], { margin: null })).toEqual(pill);
  });

  it("is the pure `clearOfHeaders` underneath: the same answers for a box of the group's size at the level place", () => {
    const got = toolbarApi.clearOfHeaders!({ margin: MARGIN, size: SIZES.margin, left: MARGIN.left + 8, top: 400, headers: [sticky()] });
    expect(got).toEqual({ left: MARGIN.left + 8, top: 420, how: "below" });
    expect(toolbarApi.clearOfHeaders!({ margin: MARGIN, size: SIZES.margin, left: MARGIN.left + 8, top: 400, headers: [] })).toEqual({ left: MARGIN.left + 8, top: 400, how: "level" });
  });
});

describe("readHeaders — a card's header and what it holds, read from the page (P11-38 rule 2)", () => {
  type Fake = { tag: string; box: Box; text?: string; kids?: Fake[] };
  const node = (spec: Fake): Record<string, unknown> => {
    const kids = (spec.kids ?? []).map(node);
    return {
      tagName: spec.tag.toUpperCase(),
      childNodes: [...(spec.text ? [{ nodeType: 3, nodeValue: spec.text }] : []), ...kids.map(() => ({ nodeType: 1, nodeValue: null }))],
      children: kids,
      textContent: [spec.text ?? "", ...kids.map((kid) => String(kid.textContent))].join(""),
      getBoundingClientRect: () => sized(spec.box),
    };
  };
  const card = (kind: string, box: Box, head: Fake | null, zoom?: Fake) => ({
    getAttribute: (name: string) => (name === "data-margin-card" ? kind : null),
    getBoundingClientRect: () => sized(box),
    firstElementChild: head ? node(head) : null,
    querySelector: (selector: string) => (selector === "[data-figure-zoom-row]" && zoom ? node(zoom) : null),
  });
  const root = (...cards: unknown[]) => ({ querySelectorAll: () => cards });
  const read = (...cards: unknown[]) => toolbarApi.readHeaders!(root(...cards));

  // A sticky's header as the page draws it: a row; a raise button over the title and the quote head; the X.
  const stickyHead: Fake = {
    tag: "div",
    box: sq(1080, 380, 1440, 420),
    kids: [
      { tag: "button", box: sq(1080, 380, 1400, 420), kids: [{ tag: "span", box: sq(1092, 392, 1140, 408), text: "NOTE 1" }, { tag: "span", box: sq(1148, 392, 1190, 408), text: "Quote" }] },
      { tag: "button", box: sq(1400, 380, 1440, 420), kids: [{ tag: "span", box: sq(1410, 390, 1430, 410), text: "×" }] },
    ],
  };

  it("takes the card's first element as its header and the text and the controls in it as what the header holds — not the raise button's empty width", () => {
    const [zone] = read(card("sticky", sq(1080, 380, 1440, 640), stickyHead));
    expect(zone.box).toEqual(sq(1080, 380, 1440, 420));
    expect(zone.parts).toEqual(expect.arrayContaining([sq(1092, 392, 1140, 408), sq(1148, 392, 1190, 408), sq(1410, 390, 1430, 410)]));
    expect(zone.parts).not.toContainEqual(sq(1080, 380, 1400, 420));
  });

  it("counts an icon-only control (the big X, an svg in a button) as a part", () => {
    const x: Fake = { tag: "button", box: sq(1097, 407, 1133, 443), kids: [{ tag: "svg", box: sq(1105, 415, 1125, 435) }] };
    const [zone] = read(card("explain", sq(1080, 390, 1440, 920), { tag: "div", box: sq(1081, 391, 1440, 513), kids: [{ tag: "div", box: sq(1097, 407, 1424, 443), kids: [x, { tag: "p", box: sq(1145, 417, 1424, 433), text: "Explain this" }] }, { tag: "p", box: sq(1097, 455, 1424, 500), text: "the quoted words" }] }));
    expect(zone.box).toEqual(sq(1081, 391, 1440, 513));
    expect(zone.parts).toEqual(expect.arrayContaining([sq(1097, 407, 1133, 443), sq(1145, 417, 1424, 433), sq(1097, 455, 1424, 500)]));
  });

  it("adds the figure's zoom row as a second header: its controls are the card's controls", () => {
    const zones = read(card("figure", sq(1080, 48, 1440, 860), { tag: "div", box: sq(1080, 48, 1440, 88), kids: [{ tag: "span", box: sq(1092, 60, 1140, 76), text: "Figure 3" }] }, { tag: "div", box: sq(1080, 88, 1440, 124), kids: [{ tag: "button", box: sq(1090, 94, 1118, 118), text: "−" }, { tag: "button", box: sq(1200, 94, 1228, 118), text: "+" }] }));
    expect(zones.map((zone) => zone.box)).toEqual([sq(1080, 48, 1440, 88), sq(1080, 88, 1440, 124)]);
    expect(zones[1].parts).toEqual([sq(1090, 94, 1118, 118), sq(1200, 94, 1228, 118)]);
  });

  // P11-38 follow-up: the explain card's header is its top row (the one that holds the big X: `[data-explain-close]`'s parent), from the card's top to the row's foot; the quoted
  // passage under it is the card's content. The card that is behind another shows that row alone, as its first element. A card whose X is not found keeps its first element.
  const explainCard = (behind: boolean) => {
    const x = { tagName: "BUTTON", childNodes: [], children: [{ tagName: "svg", childNodes: [], children: [], getBoundingClientRect: () => sized(sq(1105, 415, 1125, 435)) }], parentElement: null as unknown, getBoundingClientRect: () => sized(sq(1097, 407, 1133, 443)) };
    const title = { tagName: "P", childNodes: [{ nodeType: 3, nodeValue: "Explain this" }], children: [], getBoundingClientRect: () => sized(sq(1145, 417, 1424, 433)) };
    const quote = { tagName: "P", childNodes: [{ nodeType: 3, nodeValue: "the quoted words" }], children: [], getBoundingClientRect: () => sized(sq(1097, 455, 1424, 500)) };
    const row = { tagName: "DIV", childNodes: [], children: [x, title], getBoundingClientRect: () => sized(sq(1097, 407, 1424, 443)) };
    x.parentElement = row;
    const block = { tagName: "DIV", childNodes: [], children: [row, quote], getBoundingClientRect: () => sized(sq(1081, 391, 1440, 513)) };
    return {
      getAttribute: (name: string) => (name === "data-margin-card" ? "explain" : null),
      getBoundingClientRect: () => sized(sq(1080, 390, 1440, 920)),
      firstElementChild: behind ? row : block,
      querySelector: (selector: string) => (selector === "[data-explain-close]" ? x : null),
    };
  };

  it("takes the explain card's top row as its header — from the card's top to the row's foot — and the X and the title as what it holds: the quote under it is the card's content", () => {
    for (const behind of [false, true]) {
      const [zone] = read(explainCard(behind));
      expect(zone.box, String(behind)).toEqual(sq(1080, 390, 1440, 443));
      expect(zone.parts, String(behind)).toEqual(expect.arrayContaining([sq(1097, 407, 1133, 443), sq(1145, 417, 1424, 433)]));
      expect(zone.parts, String(behind)).not.toContainEqual(sq(1097, 455, 1424, 500));
      expect(zone.parts.every((part) => part.bottom <= 443), String(behind)).toBe(true);
    }
  });

  it("measures a title by its words, not by its box: the element is as wide as the row, the words are as wide as they are (the free part is what the words leave)", () => {
    const title: Record<string, unknown> = { tagName: "P", childNodes: [{ nodeType: 3, nodeValue: "Explain this" }], children: [], getBoundingClientRect: () => sized(sq(1145, 417, 1424, 433)) };
    title.ownerDocument = {
      createRange: () => {
        let of: unknown = null;
        return { selectNodeContents: (node: unknown) => void (of = node), getBoundingClientRect: () => (of === title ? sized(sq(1145, 417, 1226, 433)) : sized(sq(0, 0, 0, 0))) };
      },
    };
    const head = { tagName: "DIV", childNodes: [], children: [title], getBoundingClientRect: () => sized(sq(1080, 380, 1440, 440)) };
    const [zone] = read({ getAttribute: () => "sticky", getBoundingClientRect: () => sized(sq(1080, 380, 1440, 640)), firstElementChild: head, querySelector: () => null });
    expect(zone.parts).toEqual([sq(1145, 417, 1226, 433)]);
  });

  it("keeps a control's own box, whatever its words cover: a press anywhere on a button is the button's", () => {
    const control: Record<string, unknown> = { tagName: "BUTTON", childNodes: [{ nodeType: 3, nodeValue: "×" }], children: [], getBoundingClientRect: () => sized(sq(1400, 380, 1440, 420)) };
    control.ownerDocument = { createRange: () => ({ selectNodeContents: () => {}, getBoundingClientRect: () => sized(sq(1415, 392, 1425, 408)) }) };
    const head = { tagName: "DIV", childNodes: [], children: [control], getBoundingClientRect: () => sized(sq(1080, 380, 1440, 420)) };
    const [zone] = read({ getAttribute: () => "sticky", getBoundingClientRect: () => sized(sq(1080, 380, 1440, 640)), firstElementChild: head, querySelector: () => null });
    expect(zone.parts).toEqual([sq(1400, 380, 1440, 420)]);
  });

  it("reads every card of the margin, and leaves out a card with no header, a header with no box, and a part with no box", () => {
    const zones = read(
      card("sticky", sq(1080, 380, 1440, 640), stickyHead),
      card("notes", sq(1080, 100, 1440, 300), null),
      card("sticky", sq(1080, 700, 1440, 860), { tag: "div", box: sq(0, 0, 0, 0), kids: [{ tag: "span", box: sq(0, 0, 0, 0), text: "NOTE 2" }] }),
      { getBoundingClientRect: () => sized(sq(1080, 100, 1440, 300)) },
    );
    expect(zones).toHaveLength(1);
    expect(zones[0].box).toEqual(sq(1080, 380, 1440, 420));
  });

  it("is empty with no card open, and asks the page through the margin's one selector", () => {
    const asked: string[] = [];
    expect(toolbarApi.readHeaders!({ querySelectorAll: (selector: string) => (asked.push(selector), []) })).toEqual([]);
    expect(asked).toEqual([MARGIN_CARD_SELECTOR]);
  });
});

describe("SelectionToolbarView — says when it was moved off a header (P11-38 rule 2)", () => {
  const view = (place: Record<string, unknown>) =>
    renderToStaticMarkup(createElement(SelectionToolbarView, { place, canExplain: true, onExplain: () => {}, onTakeNote: () => {}, onHighlight: () => {} } as never));

  it("carries the way it cleared the header, and nothing when it stands level", () => {
    expect(view({ mode: "margin", left: 1088, top: 420, below: false, clear: "below" })).toContain('data-header-clear="below"');
    expect(view({ mode: "margin", left: 1194, top: 400, below: false, clear: "free" })).toContain('data-header-clear="free"');
    expect(view({ mode: "margin", left: 1088, top: 400, below: false })).not.toContain("data-header-clear");
  });
});

describe("the group's own size (P11-38 follow-up)", () => {
  const toolbar = readFileSync(resolve(process.cwd(), "src/components/reader/selection-toolbar.tsx"), "utf8").replace(/\s+/g, " ");

  // `offsetHeight` rounds: a group 88.28 px tall was taken for 88, and standing just above a header (its foot at the header's top) it reached 0.28 px into it.
  it("reads its size from its rect, not from the rounded `offsetWidth` and `offsetHeight`, so the place just above a header is clear of it to the pixel", () => {
    expect(toolbar).toContain("getBoundingClientRect()");
    expect(toolbar).not.toContain("offsetHeight");
    expect(toolbar).not.toContain("offsetWidth");
  });
});
