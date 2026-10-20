import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { NotesWindowView } from "@/components/notes/notes-window";
import { StickyWindowView } from "@/components/notes/sticky-note";
import { MARGIN_CARD_SELECTOR } from "@/lib/reader/margin";
import type { ExplainAnswer } from "@/lib/papers/explain";
import { ExplainCard } from "./explain-box";
import { FigureCardView, type FigureCardZoom } from "./figure-card";
import { OPEN_CARD_SELECTOR } from "./selection-toolbar";

// P11-17c rule 4 (C P11-13): the selection's actions find the cards that are open by ONE marker, `data-margin-card`. This pins that every card
// of the margin carries it, each rendered as the page draws it — the explain card in front and behind (the dock's two shapes), a sticky, the
// notes window and the figure — with its kind, so that `OPEN_CARD_SELECTOR` can be the margin's marker alone and no card goes unseen by the
// toolbar. A card that lost the attribute would stand in the margin and the selection's actions would be drawn over it. Invented text.

const MARKER = /\bdata-margin-card="([a-z]+)"/;
const kindOf = (html: string) => MARKER.exec(html)?.[1];

const answer: ExplainAnswer = { meaning: "A share of a sample turned to plates.", here: { text: "It compares alloys.", peer: true } };
const explain = (over: Record<string, unknown>) =>
  renderToStaticMarkup(createElement(ExplainCard, { passage: "The rafting ratio rose from 0.2 to 0.7.", heading: "2 Methods", term: null, termWhere: null, canAsk: true, status: { kind: "answer", answer }, onClose: () => {}, ...over } as never));

const zoom: FigureCardZoom = {
  scale: 1, zoomed: false, dragging: false, canZoomIn: true, canZoomOut: false, zoomIn: vi.fn(), zoomOut: vi.fn(), reset: vi.fn(),
  surface: {} as never, style: { width: 300, height: 200 } as never,
};

describe("every card of the margin carries data-margin-card, with its kind", () => {
  it("the explain card in front (the dock) and behind (a header under another card)", () => {
    expect(kindOf(explain({ dock: true }))).toBe("explain");
    expect(kindOf(explain({ dock: true, behind: true, onRaise: () => {} }))).toBe("explain");
  });

  it("a sticky note, in front and behind", () => {
    const props = { n: 2, quote: "The finest grains crept.", text: "words", top: 180, height: 260, z: 62, onText: () => {}, onClose: () => {}, onRaise: () => {}, onGo: () => {} };
    expect(kindOf(renderToStaticMarkup(createElement(StickyWindowView, { ...props, front: true })))).toBe("sticky");
    expect(kindOf(renderToStaticMarkup(createElement(StickyWindowView, { ...props, front: false, height: 40 })))).toBe("sticky");
  });

  it("the notes window, in front and behind", () => {
    const props = { top: 48, maxHeight: 900, menuOpen: false, notice: null, onClose: () => {}, onMenu: () => {}, onExport: () => {} };
    expect(kindOf(renderToStaticMarkup(createElement(NotesWindowView, props, "THE NOTE")))).toBe("notes");
    expect(kindOf(renderToStaticMarkup(createElement(NotesWindowView, { ...props, front: false, height: 40 }, "THE NOTE")))).toBe("notes");
  });

  it("the figure card, in front and behind", () => {
    const props = { label: "Figure 3", caption: "Invented caption.", src: "/api/figure/p1/3", top: 48, height: 812, z: 60, frame: { left: 1000, width: 400 }, zoom, onClose: () => {}, onRaise: () => {} };
    expect(kindOf(renderToStaticMarkup(createElement(FigureCardView, { ...props, front: true })))).toBe("figure");
    expect(kindOf(renderToStaticMarkup(createElement(FigureCardView, { ...props, front: false, height: 40 })))).toBe("figure");
  });

  it("the explain card outside the dock (the card under the selection, the sheet) is not a card of the margin and does not carry it", () => {
    expect(kindOf(explain({}))).toBeUndefined();
    expect(kindOf(explain({ sheet: true }))).toBeUndefined();
  });
});

describe("the toolbar reads that one marker", () => {
  it("OPEN_CARD_SELECTOR is MARGIN_CARD_SELECTOR, and every card above matches it", () => {
    expect(OPEN_CARD_SELECTOR).toBe(MARGIN_CARD_SELECTOR);
    expect(MARGIN_CARD_SELECTOR).toBe("[data-margin-card]");
  });
});
