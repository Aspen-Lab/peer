import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import {
  CARD_SLACK_PX,
  MODE_HYSTERESIS_PX,
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

  it("hands the boolean on to the pill it draws, and keeps the explain check the box's own", () => {
    const toolbar = readFileSync(resolve(process.cwd(), "src/components/reader/selection-toolbar.tsx"), "utf8").replace(/\s+/g, " ");
    expect(toolbar).toContain("<SelectionToolbarView place={place} canExplain={canExplain}");
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
const place = (over: Partial<Parameters<typeof actionsPlace>[0]> = {}) =>
  actionsPlace({ bounds, viewport: VIEW, margin: MARGIN, cards: [], sizes: SIZES, ...over });
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

  describe("an open card that covers the group (4 px of slack)", () => {
    const covering = { left: MARGIN.left, top: 380, right: MARGIN.left + MARGIN.width, bottom: 700 };

    it("sends the group above the selection, the pill, until the card is gone", () => {
      const got = place({ cards: [covering] })!;
      expect(got.mode).toBe("above");
      expect(got).toEqual({ mode: "above", ...toolbarPlace({ bounds, viewport: VIEW, size: SIZES.above })! });
      expect(place({ cards: [] })!.mode).toBe("margin");
    });

    it("counts a card within 4 px as covering, and one 4 px or more clear as not", () => {
      expect(CARD_SLACK_PX).toBe(4);
      // The group is 400–490 high; a card whose top is 3 px under its foot is covering, 4 px under is clear.
      expect(place({ cards: [cardUnder(400, 3)] })!.mode).toBe("above");
      expect(place({ cards: [cardUnder(400, 4)] })!.mode).toBe("margin");
      // The same above it: a card whose bottom is 3 px over the group's top covers, 4 px over does not.
      const over = (gap: number) => ({ left: MARGIN.left, top: 100, right: MARGIN.left + MARGIN.width, bottom: 400 - gap });
      expect(place({ cards: [over(3)] })!.mode).toBe("above");
      expect(place({ cards: [over(4)] })!.mode).toBe("margin");
    });

    it("is not troubled by a card at the other side of the window, or one nowhere near", () => {
      expect(place({ cards: [{ left: 20, top: 380, right: 300, bottom: 700 }] })!.mode).toBe("margin");
      expect(place({ cards: [{ left: MARGIN.left, top: 600, right: MARGIN.left + MARGIN.width, bottom: 900 }] })!.mode).toBe("margin");
    });

    it("looks at every card, not only the first", () => {
      expect(place({ cards: [{ left: 20, top: 380, right: 300, bottom: 700 }, covering] })!.mode).toBe("above");
    });
  });

  describe("12 px of hysteresis when it switches (a selection scrolling past a card's edge does not flicker)", () => {
    it("is 12 px", () => {
      expect(MODE_HYSTERESIS_PX).toBe(12);
    });

    it("goes above at once when covered, and comes back to the margin only after 12 px more of room", () => {
      const at = (mode: ActionsMode | null, gap: number) => place({ mode, cards: [cardUnder(400, gap)] })!.mode;
      // Standing in the margin (or fresh): the nominal rule, 4 px.
      expect(at("margin", 3)).toBe("above");
      expect(at("margin", 4)).toBe("margin");
      expect(at(null, 3)).toBe("above");
      expect(at(null, 4)).toBe("margin");
      // Standing above: it stays until the card is 4 + 12 = 16 px clear.
      expect(at("above", 3)).toBe("above");
      expect(at("above", 10)).toBe("above");
      expect(at("above", 15)).toBe("above");
      expect(at("above", 16)).toBe("margin");
    });

    it("keeps one mode through a scroll past the card's edge, and changes twice at most", () => {
      // A card at the top of the margin ends at y 500; the selection's first line scrolls from 520 up to 503 and back to 516.
      const card = { left: MARGIN.left, top: 48, right: MARGIN.left + MARGIN.width, bottom: 500 };
      const path = [520, 510, 505, 503, 506, 512, 515, 516, 520, 505, 503];
      let mode: ActionsMode | null = null;
      const seen: ActionsMode[] = [];
      for (const top of path) {
        const got: NonNullable<ReturnType<typeof actionsPlace>> = place({ mode, cards: [card], bounds: { left: 300, top, right: 520, bottom: top + 22 } })!;
        mode = got.mode;
        seen.push(got.mode);
      }
      expect(seen).toEqual(["margin", "margin", "margin", "above", "above", "above", "above", "margin", "margin", "margin", "above"]);
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

  it("keeps a divider between the buttons that fits its direction: above the next in the column, left of it in the row", () => {
    const column = renderToStaticMarkup(view());
    expect(column).toContain("border-t");
    expect(column).not.toContain("border-l");
    const row = renderToStaticMarkup(view({ place: ABOVE }));
    expect(row).toContain("border-l");
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
