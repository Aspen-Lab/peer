import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SELECTION_LABELS, SelectionToolbar, SelectionToolbarView, toolbarPlace } from "./selection-toolbar";
import * as toolbarModule from "./selection-toolbar";
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
    expect(SELECTION_LABELS).toEqual({ explain: "Explain this", note: "Take notes" });
    const html = renderToStaticMarkup(createElement(SelectionToolbarView, { place: { left: 300, top: 362, below: false }, onExplain: () => {}, onTakeNote: () => {} }));
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
    const tree = SelectionToolbarView({ place: { left: 0, top: 0, below: false }, onExplain, onTakeNote });
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
    expect(renderToStaticMarkup(createElement(SelectionToolbar, { target: null, onExplain: () => {}, onTakeNote: () => {} }))).toBe("");
  });
});

// P10-08b (rule 3; P10-08's unsettled 2): the pill offers "Explain this" only when the page can explain. With no key
// and no term of the paper's own inside the selection the explain action does nothing (a locked block is hidden, never
// shown broken — §1b), so the pill shows "Take notes" alone; with a key, both; with no key and a defined term, both
// (the Tier 0 definition). The page hands the toolbar one boolean, `canExplain`, made by `selectionCanExplain` from the
// same `definingTerm` check the explain box uses.
type ViewProps = { place: { left: number; top: number; below: boolean }; onExplain: () => void; onTakeNote: () => void; canExplain: boolean };
const AT = { left: 300, top: 362, below: false };

describe("SelectionToolbarView — Explain this only when the page can explain (P10-08b, rule 3)", () => {
  const view = (canExplain: boolean) =>
    renderToStaticMarkup(createElement(SelectionToolbarView as unknown as (props: ViewProps) => ReactElement, { place: AT, onExplain: () => {}, onTakeNote: () => {}, canExplain }));

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
    const tree = (SelectionToolbarView as unknown as (props: ViewProps) => ReactElement)({ place: AT, onExplain: () => {}, onTakeNote, canExplain: false });
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
  const can = (toolbarModule as unknown as Record<string, (args: { canAsk: boolean; terms: readonly PaperTerm[]; passage: string | null }) => boolean>).selectionCanExplain;
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
});
