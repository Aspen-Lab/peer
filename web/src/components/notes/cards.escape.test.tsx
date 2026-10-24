import { describe, expect, it, vi } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { NotesWindowView } from "./notes-window";
import { StickyWindowView } from "./sticky-note";

// P11-17c rule 1 (C P11-15 "For the manager" 1): a card's own Escape — the key pressed with the focus INSIDE the card, where its React
// `onKeyDown` takes it — is the front card's alone. A card that is behind another shows its header only; a focus that is on that header
// (Tab reaches it) must not close it, and the key goes on to the document, where the front card takes it (`front-card.escape.flow.test.tsx`).
// The views are hook-free, so their handlers are called as React calls them. Invented text.

type Props = Record<string, unknown> & { children?: ReactNode };
const key = (name: string) => ({ key: name, defaultPrevented: false, stopPropagation: vi.fn(), preventDefault: vi.fn() });
const handlerOf = (root: unknown) => ((root as ReactElement<Props>).props.onKeyDown as (event: ReturnType<typeof key>) => void);

describe("a sticky's own Escape (the focus inside it)", () => {
  const props = (over: Partial<Parameters<typeof StickyWindowView>[0]> = {}) => ({
    n: 2, quote: "The finest grains crept fastest.", text: "my words", front: true, top: 180, height: 260, z: 62,
    onText: vi.fn(), onClose: vi.fn(), onRaise: vi.fn(), onGo: vi.fn(),
    ...over,
  });

  it("in front: closes, and takes the key (prevented and stopped), so the page's back does not run", () => {
    const view = props();
    const event = key("Escape");
    handlerOf(StickyWindowView(view))(event);
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
  });

  it("behind another card: does not close, and leaves the key for the card in front", () => {
    const view = props({ front: false, height: 40 });
    const event = key("Escape");
    handlerOf(StickyWindowView(view))(event);
    expect(view.onClose).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it("every other key is nobody's here, in front or behind", () => {
    for (const front of [true, false]) {
      const view = props({ front });
      const event = key("a");
      handlerOf(StickyWindowView(view))(event);
      expect(view.onClose).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
    }
  });
});

describe("the notes window's own Escape (the focus inside it)", () => {
  const make = (over: { front?: boolean; height?: number; menuOpen?: boolean } = {}) => {
    const onClose = vi.fn();
    const onMenu = vi.fn();
    const view = { top: 48, maxHeight: 900, menuOpen: false, notice: null, onClose, onMenu, onExport: vi.fn(), ...over };
    return { root: NotesWindowView({ ...view, children: null }) as ReactElement<Props>, onClose, onMenu };
  };

  it("in front: closes the window, or only the open export menu first; takes the key", () => {
    const closing = make();
    const event = key("Escape");
    handlerOf(closing.root)(event);
    expect([closing.onClose.mock.calls.length, closing.onMenu.mock.calls.length]).toEqual([1, 0]);
    expect(event.preventDefault).toHaveBeenCalledTimes(1);
    expect(event.stopPropagation).toHaveBeenCalledTimes(1);
    const menu = make({ menuOpen: true });
    handlerOf(menu.root)(key("Escape"));
    expect([menu.onClose.mock.calls.length, menu.onMenu.mock.calls.length]).toEqual([0, 1]);
  });

  it("behind another card: neither closes nor shuts the menu, and leaves the key for the card in front", () => {
    for (const menuOpen of [false, true]) {
      const behind = make({ front: false, height: 40, menuOpen });
      const event = key("Escape");
      handlerOf(behind.root)(event);
      expect(behind.onClose).not.toHaveBeenCalled();
      expect(behind.onMenu).not.toHaveBeenCalled();
      expect(event.preventDefault).not.toHaveBeenCalled();
      expect(event.stopPropagation).not.toHaveBeenCalled();
    }
  });
});
