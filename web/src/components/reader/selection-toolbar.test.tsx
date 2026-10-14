import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { SELECTION_LABELS, SelectionToolbar, SelectionToolbarView, toolbarPlace } from "./selection-toolbar";

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
    for (const top of [20, 52, 60, 90, 400, 900]) {
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
