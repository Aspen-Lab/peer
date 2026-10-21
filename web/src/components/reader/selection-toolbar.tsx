"use client";

// P10-09a (the owner's review 7.1 and 8.4; rubric B3; ruling §1h.78): select any words in the paper and a small
// pill stands just above the selection's first line, in the label face, with two buttons: "Explain this" and
// "Take notes" — the highlighter and the sticky note. It is the one place either is offered on a screen wide
// enough for a pointer; it goes when the selection goes, and it never covers the words.
//
// The page hands it the selection it already holds (`explainTarget`), the explain action (the one `e` calls)
// and the take-note action. The pill is placed in the window's pixels (fixed, outside the zoomed container),
// measured again as the page scrolls and the window resizes, from the selection's own `measure()`.
//
// P10-08b (P10-08's unsettled 2; §1b): "Explain this" is offered only when the page can explain. With no model key and no
// term of the paper's own inside the selection the explain action does nothing (a locked block is hidden, never shown
// broken), so the pill shows "Take notes" alone; with a key, or with a defined term inside the selection (the Tier 0
// definition), both. The page hands it one boolean, `canExplain`, made by `selectionCanExplain` from the same
// `definingTerm` check the explain box uses.
//
// Under 768 px the pill is not drawn: the thumb bar's cell is the explain control there (§1h.66), and "Take
// notes" on a phone is deferred. The press keeps the selection: `mousedown` is not allowed to move the caret.
//
// P11-13 (the owner's items 5 and 8; B P11-03 §2; ruling §1h.113): three actions, not two — Explain this, Take notes and
// Highlight. Highlight is drawn only where the page hands a handler (`onHighlight`) and says the selection can be highlighted
// (`canHighlight`); until the page passes them it is absent. Highlight needs no key: it is a Tier 0 act.
//
// P11-13 (rule 2): the three stand in the right margin (`lib/reader/margin.ts`, C P11-10), one under the other, level with the
// selection's first line, 8 px in from the margin's left edge (`actionsPlace`). Where there is no margin — a window under 1024 px,
// a page without the shell — or an open card covers that place (4 px of slack, 12 px of hysteresis against a flicker), the group
// is today's pill above the selection, in a row. Under 768 px nothing is drawn. The margin is empty with no selection and the
// toolbar reserves nothing: it draws only while a settled selection stands, and measures again as the page scrolls and resizes,
// when the margin is resized, whenever the window stack changes and when the page reflows (the dock's reserve; defect (b)).
//
// P11-27 rule 1 (owner item 5; round 1's walk X-1, BACKLOG-96; ruling §1h.122, which amends §1h.113 (b) O-2): the group never leaves the margin. With a margin
// registered it stands there, level with the selection's first line, whatever card stands at that height — over the card, above it in z-order (`z-[70]`, over the
// stack's cards), on its own surface (the theme's surface, a border, a shadow), its buttons whole — and never over the centre column's words. The pill above the
// selection (and its slack to a card and its hysteresis between two modes) is gone where a margin stands; it is the group of a window with no margin (under 1024 px)
// and nothing else. `data-over-card` says when the group stands over a card, so the page and a measurement can tell.
//
// P11-27 rule 2 (X-4): a selection in a figure's caption or a section's heading is offered Take notes and Highlight like a paragraph's. Explain this was not offered
// for it then: the explain route found a passage in the paper's paragraphs only (`lib/papers/explain.ts`, `locatePassage`), so it answered "not in the paper".
// P11-42 (ruling §1h.139 (b)) offers it there too: the three actions stand for a caption's or a heading's selection as for a paragraph's.
//
// P11-38 rule 1 (owner item 5, "一旦点击其中一个，就会显示其中一个的功能"; round 2's walk X-5; ruling §1h.138 (a)): a press of Explain this ends the group's job, as Take notes and
// Highlight already do (they clear the selection, so the group goes with it). Once pressed — by the button, or by `e`, which the toolbar sees as the Explain card
// now holding the selection's passage — the group is gone until the reader makes a NEW selection. The press also ends the selection, as Take notes and Highlight do
// (`dropSelection`: the browser's ranges go, and with them the page's hold on it): the card keeps its quote and keeps level with the paragraph (the page's selection
// measures its own copy of the range), and Escape's first press is the card's — the page counts a selection as standing while it holds one (P11-40, ruling §1h.138 (c)),
// so a quiet selection left behind the group would take the first Escape. A new selection object from the page, a drag that selects the same words again (the press
// changed the selection and one stands when it ends) and a double click end the wait; a press that changes no selection — a button, a tab — does not. In a window with
// no margin (under 1024 px) nothing changes: the pill stands, and the selection with it.
//
// P11-38 rule 2 (same ruling): the group still stands in the margin level with the first line, over a card's body where it must, but never over a card's header — its
// X, its title, its controls (Open as page, Export, zoom). The headers are read from the page, with the card rects (`openCards`: a card's first element is its header, the figure
// card's zoom row a second one; what a header holds is its text and its controls). Where the level place would cover one the group stands on the header's free part, level
// with the line, if it fits whole there (`clearOfHeaders`); else in the nearest clear place — just above the header or just below it (below the last of a stack of them), whichever
// moves it less from the line. The explain card's header is its top row (the X and the title), not the quote under it. `data-header-clear` says which. It never leaves the
// margin sideways, so the centre column's words stay uncovered (X-1 stays gone).
//
// P11-49 rule 1 (round 3, Theme B readers r1 and r2; ruling §1h.149): over a card the group covers no control, wherever the control stands: the header row, the notes window's
// formatting row, a sticky's buttons, the figure card's zoom row, the explain card's link, input and Send. A card's controls are read from the page by what an element IS —
// `CONTROL_SELECTOR`: buttons, links, form fields, the roles that stand for them, a toolbar as a row — never from a list of the app's own attributes, which goes stale the day a
// card gains a button; one drawn (a label, an icon or a painted surface of its own), seen through the card and the scrolling bodies it stands in, not a hit area nor the picture's
// button (the picture is the card's content). A writing surface is not one: its words are the card's words. The card's words are read too, as the line boxes they stand in
// (`wordsOf`).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PaperTerm } from "@/lib/papers/report";
import { setHighlightOffer } from "@/lib/reader/explain-offer";
import { MARGIN_CARD_SELECTOR, placeInMargin, useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import type { ExplainSelection, ViewRect } from "./paper-body";
import { definingTerm, previewOf } from "./explain-box";
import { DOCK_TOP_PX, MASTHEAD_MIN_VIEWPORT_PX } from "./explain-dock";

/**
 * Whether the page can explain the selection `passage`: it has a model key (`canAsk`), or the paper's own definition of a term
 * lies inside the passage (`definingTerm`, the explain box's own check — the Tier 0 answer). No selection: no. Pure.
 */
export function selectionCanExplain(input: { canAsk: boolean; terms: readonly PaperTerm[]; passage: string | null }): boolean {
  if (input.passage === null) return false;
  return input.canAsk || definingTerm(input.terms, input.passage) !== null;
}

export const SELECTION_LABELS = { explain: "Explain this", note: "Take notes", highlight: "Highlight" } as const;

export type SelectionAction = "explain" | "note" | "highlight";

/**
 * Which of the three actions are on offer, in the order they stand: Explain this when the page can explain (P10-08b), Take notes
 * always, Highlight only when the page hands a handler and says the selection can be highlighted. Pure.
 */
export function offeredActions(input: { canExplain: boolean; onHighlight?: unknown; canHighlight?: boolean }): SelectionAction[] {
  const highlight = typeof input.onHighlight === "function" && input.canHighlight === true;
  return [...(input.canExplain ? (["explain"] as const) : []), "note", ...(highlight ? (["highlight"] as const) : [])];
}

/** The room between the pill and the selection's first line. */
export const TOOLBAR_GAP_PX = 6;
/** The room kept between the pill and the window's edge. */
const EDGE_PX = 8;

export interface ToolbarPlace {
  left: number;
  top: number;
  /** The pill stands under the selection, because there is no room above it. */
  below: boolean;
}

/**
 * Where the pill stands: just above the selection's first line (`bounds.top - height - 6`), left-aligned with the
 * selection and kept inside the window; under the selection's last line instead when the masthead leaves no room
 * above. Null where it is not drawn — a window under 768 px, or a selection scrolled out of view. Pure.
 */
export function toolbarPlace(input: {
  bounds: ViewRect;
  viewport: { width: number; height: number };
  size: { width: number; height: number };
}): ToolbarPlace | null {
  const { bounds, viewport, size } = input;
  if (viewport.width < MASTHEAD_MIN_VIEWPORT_PX) return null;
  if (bounds.bottom <= DOCK_TOP_PX || bounds.top >= viewport.height) return null;
  const left = Math.max(EDGE_PX, Math.min(bounds.left, viewport.width - size.width - EDGE_PX));
  const above = bounds.top - size.height - TOOLBAR_GAP_PX;
  if (above >= DOCK_TOP_PX + 4) return { left, top: above, below: false };
  const under = Math.min(bounds.bottom + TOOLBAR_GAP_PX, viewport.height - size.height - EDGE_PX);
  return { left, top: under, below: true };
}

/** Where the group stands: in the margin, level with the first line, or above the selection as the pill. */
export type ActionsMode = "margin" | "above";

export interface ActionsPlace extends ToolbarPlace {
  mode: ActionsMode;
  /** P11-38, P11-49: set when the group was moved off a card's header or control (`clearOfHeaders`): slid aside along the margin, on a header's free part, just below or just above, or held where it was with nowhere clear. Absent when it stands level. */
  clear?: Exclude<Clearance, "level">;
}

/** The group's left edge sits this far in from the margin's. */
export const MARGIN_INSET_PX = 8;

/**
 * The open cards: those the margin carries, by their one marker, `data-margin-card`. P11-17c rule 4: every card of the margin carries it —
 * the explain card in front and behind, a sticky, the notes window and the figure (`margin-card.markers.test.tsx` pins each, in the markup) —
 * so the legacy list (`[data-explain-dock]`, `[data-sticky]`, `[data-notes-window]`) that stood beside it is retired. A new kind of card
 * carries the marker, or the selection's actions are drawn over it.
 */
export const OPEN_CARD_SELECTOR = MARGIN_CARD_SELECTOR;

// ── The open cards, and their headers ────────────────────────────────────

/** A card's header as the page draws it: its whole box, and what it holds that must stay readable and reachable — its text and its controls. In the window's pixels. */
export interface HeaderZone {
  box: ViewRect;
  parts: readonly ViewRect[];
}

/** The figure card's second row of controls, under its 40-px header: a header too (zoom is one of the controls the group must not cover). */
const ZOOM_ROW_SELECTOR = "[data-figure-zoom-row]";
/** The explain card's X: its parent is the card's top row. */
const EXPLAIN_CLOSE_SELECTOR = "[data-explain-close]";
/** The elements that are a control, though they hold no text: the X is an icon. */
const CONTROLS = new Set(["button", "a", "input", "select", "textarea", "svg"]);

interface BoxLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
interface RangeLike {
  selectNodeContents(node: unknown): void;
  getBoundingClientRect(): BoxLike;
  getClientRects?(): ArrayLike<BoxLike>;
}
/** The part of a computed style the readers ask: whether an element clips what it holds, and whether it paints anything of its own. */
interface StyleLike {
  visibility?: string;
  overflowX?: string;
  overflowY?: string;
  backgroundColor?: string;
  backgroundImage?: string;
  borderTopWidth?: string;
  borderTopStyle?: string;
  borderTopColor?: string;
}
interface ElementLike {
  tagName?: string;
  childNodes?: ArrayLike<{ nodeType: number; nodeValue: string | null }>;
  children?: ArrayLike<ElementLike>;
  parentElement?: ElementLike | null;
  ownerDocument?: { createRange?(): RangeLike; defaultView?: { getComputedStyle?(element: unknown): StyleLike } | null } | null;
  textContent?: string | null;
  getBoundingClientRect(): BoxLike;
  getClientRects?(): ArrayLike<BoxLike>;
  querySelector?(selector: string): ElementLike | null;
}
interface CardLike extends ElementLike {
  firstElementChild?: ElementLike | null;
  getAttribute?(name: string): string | null;
  querySelectorAll?(selector: string): ArrayLike<ElementLike>;
}

const toRect = (box: BoxLike): ViewRect => ({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });

/** The part of `rect` inside `bound`, or null when nothing of it is (a box with no size, a part clipped away). */
function clipped(rect: ViewRect, bound: ViewRect): ViewRect | null {
  const left = Math.max(rect.left, bound.left);
  const top = Math.max(rect.top, bound.top);
  const right = Math.min(rect.right, bound.right);
  const bottom = Math.min(rect.bottom, bound.bottom);
  return right > left && bottom > top ? { left, top, right, bottom } : null;
}

/** A hair, in px: rects that overlap by less than this are taken as touching (a foot at `header.top − height + height` is not a sub-pixel inside the header). */
const HAIR_PX = 1e-3;

/** Whether two rects share some area; rects that touch along an edge do not. */
const meets = (a: ViewRect, b: ViewRect) => a.left < b.right - HAIR_PX && b.left < a.right - HAIR_PX && a.top < b.bottom - HAIR_PX && b.top < a.bottom - HAIR_PX;

/** Whether `inner` lies wholly inside `outer`. */
const within = (inner: ViewRect, outer: ViewRect) => inner.left >= outer.left - HAIR_PX && inner.right <= outer.right + HAIR_PX && inner.top >= outer.top - HAIR_PX && inner.bottom <= outer.bottom + HAIR_PX;


/**
 * What a header holds, as rects inside its `zone`: every element with text of its own (a title, a quote head, a link) and every control with none (the big X, an icon).
 * A control is measured by its box (a press anywhere on a button is the button's); a text by its words — the title of the explain card's row is an element as wide as the row,
 * its words are not, and what they leave is the row's free part. An element that only holds others — the header's row, the button that raises the card over its title —
 * holds nothing itself: the empty width of the raise button is the header's free part.
 */
function partsOf(header: ElementLike, zone: ViewRect): ViewRect[] {
  const parts: ViewRect[] = [];
  const add = (element: ElementLike, words: boolean) => {
    const box = toRect(element.getBoundingClientRect());
    const range = words ? element.ownerDocument?.createRange?.() : undefined;
    let ink: ViewRect | null = null;
    if (range) {
      range.selectNodeContents(element);
      ink = clipped(toRect(range.getBoundingClientRect()), box);
    }
    const part = clipped(ink ?? box, zone);
    if (part) parts.push(part);
  };
  const visit = (element: ElementLike): boolean => {
    const own = Array.from(element.childNodes ?? []).some((child) => child.nodeType === 3 && (child.nodeValue ?? "").trim() !== "");
    const control = CONTROLS.has((element.tagName ?? "").toLowerCase());
    let inside = false;
    for (const child of Array.from(element.children ?? [])) if (visit(child)) inside = true;
    if (own) {
      add(element, !control);
      return true;
    }
    if (inside) return true;
    if (control) add(element, false);
    return false;
  };
  visit(header);
  return parts;
}

/** A header's zone: its row's box inside the card — from the card's top and across its width when `fromTop` (the explain card's row stands in the card's padding), else the row's own — and what the row holds. */
function zoneOf(row: ElementLike, card: ViewRect, fromTop = false): HeaderZone | null {
  const rowBox = toRect(row.getBoundingClientRect());
  const box = clipped(fromTop ? { left: card.left, top: card.top, right: card.right, bottom: rowBox.bottom } : rowBox, card);
  const parts = box ? partsOf(row, box) : [];
  return box ? { box, parts } : null;
}

// ── What else a card holds: its controls, and its words ──────────────────
//
// P11-49 (ruling §1h.149): the group and the strip cover no control of a card, wherever it stands, and as few of the card's words as they can. A card's controls are
// read from the page by what an element IS, never by where the app put it (a list of data attributes goes stale the day a card gains a button): every element of the card
// that a person presses, types in or reads a toolbar from. The rest of a card is its words (and its picture).

/**
 * The elements that are controls: buttons, links, form fields and the roles that stand for them, and a toolbar as a row. A writing surface (`[contenteditable]`, `[role=textbox]`)
 * is not one: its words are the reader's own words in the card, covered as little as may be like any other (`wordsOf`); its toolbar is a `[role=toolbar]`, which is.
 */
export const CONTROL_SELECTOR =
  "button, [role=button], [role=link], [role=menuitem], [role=tab], [role=switch], [role=checkbox], [role=radio], [role=slider], [role=combobox], [role=toolbar], a[href], input, select, textarea, summary";

/** Tags that clip nothing and hold no words of the card's (an icon's strokes, a script). */
const NOT_WORDS = new Set(["svg", "style", "script", "textarea", "canvas"]);
/** The form fields: a control by what they are, whatever is or is not inside them. */
const FIELDS = new Set(["input", "select", "textarea"]);

const styleOf = (element: ElementLike): StyleLike | null => element.ownerDocument?.defaultView?.getComputedStyle?.(element) ?? null;

/** Whether a computed colour paints nothing: `transparent`, or any notation with an alpha of 0. */
const colourless = (colour: string | undefined) => colour === undefined || colour === "" || colour === "transparent" || /(?:,|\/)\s*0(?:\.0+)?%?\s*\)$/.test(colour);

/** Whether an element paints a surface of its own: a background colour or image, or a border. */
const paints = (style: StyleLike) =>
  !colourless(style.backgroundColor) ||
  (style.backgroundImage !== undefined && style.backgroundImage !== "" && style.backgroundImage !== "none") ||
  (Number.parseFloat(style.borderTopWidth ?? "0") > 0 && style.borderTopStyle !== "none" && !colourless(style.borderTopColor));

/** Whether an element is hidden from sight though it keeps its box (`visibility: hidden`, as a closed menu may be). */
const hiddenFromSight = (style: StyleLike | null) => style !== null && style.visibility === "hidden";

/**
 * Whether a control is drawn: a form field, or something with a label (text), an icon (an `svg`) or a surface of its own (a painted background, a border). A button that is
 * only a hit area — the click that writes at the end of a note, the veil behind a menu, the button that holds the figure's picture and paints nothing of its own, the
 * picture being the card's content — shows nothing a person could press, so the group may stand over it. With no computed style to ask, it is counted.
 */
function drawn(element: ElementLike): boolean {
  if (hiddenFromSight(styleOf(element))) return false;
  if (FIELDS.has((element.tagName ?? "").toLowerCase())) return true;
  if ((element.textContent ?? "").trim() !== "") return true;
  if (element.querySelector?.("svg")) return true;
  const style = styleOf(element);
  return style === null || paints(style);
}

/** The box an element's contents are seen through: the card's own, narrowed by every ancestor between the two that clips (a scrolling body, a truncated line). */
function seenThrough(element: ElementLike, card: ElementLike, cardBox: ViewRect): ViewRect | null {
  let bound: ViewRect | null = cardBox;
  for (let up = element.parentElement ?? null; bound && up && up !== card; up = up.parentElement ?? null) {
    const style = styleOf(up);
    const clips = style !== null && ((style.overflowX ?? "visible") !== "visible" || (style.overflowY ?? "visible") !== "visible");
    if (clips) bound = clipped(toRect(up.getBoundingClientRect()), bound);
  }
  return bound;
}

/**
 * A card's controls, as rects in the window's pixels: `CONTROL_SELECTOR` asked of the card, each drawn one at the line boxes it has (a link that wraps is two), seen through
 * the card and the scrolling bodies it stands in (a control scrolled out of sight is not under the group). A control inside one of the card's header rows is left to the
 * row (`zones`): the row's `parts` are what it holds, and its free part is the row's. Pure of the page but for the card it is given.
 */
function controlsOf(card: CardLike, cardBox: ViewRect, zones: readonly HeaderZone[]): ViewRect[] {
  const found = card.querySelectorAll?.(CONTROL_SELECTOR);
  const out: ViewRect[] = [];
  for (const element of Array.from(found ?? [])) {
    if (!drawn(element)) continue;
    const bound = seenThrough(element, card, cardBox);
    if (!bound) continue;
    const lines = Array.from(element.getClientRects?.() ?? []);
    for (const box of lines.length > 0 ? lines : [element.getBoundingClientRect()]) {
      const part = clipped(toRect(box), bound);
      if (part && !zones.some((zone) => within(part, zone.box))) out.push(part);
    }
  }
  return out;
}

/**
 * A card's words, as the line boxes they stand in (a text node that wraps is one rect for each line), in the window's pixels, seen through the card and its scrolling bodies.
 * A subtree whose box is wholly out of sight is not walked, so a long note costs what is on screen. Needs the page's ranges; without them (a test's stand-in) there are none.
 */
function wordsOf(card: CardLike, cardBox: ViewRect): ViewRect[] {
  const range = card.ownerDocument?.createRange?.();
  if (!range?.getClientRects) return [];
  const out: ViewRect[] = [];
  const visit = (element: ElementLike, bound: ViewRect) => {
    if (NOT_WORDS.has((element.tagName ?? "").toLowerCase())) return;
    const box = toRect(element.getBoundingClientRect());
    let seen: ViewRect | null = bound;
    const style = styleOf(element);
    if (style !== null && ((style.overflowX ?? "visible") !== "visible" || (style.overflowY ?? "visible") !== "visible")) seen = clipped(box, bound);
    else if (box.right > box.left && box.bottom > box.top && !meets(box, bound)) seen = null;
    if (!seen) return;
    for (const node of Array.from(element.childNodes ?? [])) {
      if (hiddenFromSight(style) || node.nodeType !== 3 || (node.nodeValue ?? "").trim() === "") continue;
      range.selectNodeContents(node);
      for (const line of Array.from(range.getClientRects?.() ?? [])) {
        const part = clipped(toRect(line), seen);
        if (part) out.push(part);
      }
    }
    for (const child of Array.from(element.children ?? [])) visit(child, seen);
  };
  visit(card, cardBox);
  return out;
}

export interface OpenCards {
  /** The cards' rects, in the window's pixels; a card with no box (hidden) is left out. */
  rects: ViewRect[];
  /** Their headers: each card's first element (the 40-px header of a sticky, the notes window and the figure; the explain card's X, title and quote), and the figure's zoom row. */
  headers: HeaderZone[];
  /** What the Explain card's header says (its title and the opening words of the passage it explains), for the card that stands. */
  explainHeads: string[];
  /** P11-49: the controls the headers do not hold — a toolbar and its buttons, a sticky's button, the explain card's link, its input and Send (`controlsOf`). Empty when not asked for. */
  controls: ViewRect[];
  /** P11-49: the card's words, as the line boxes they stand in (`wordsOf`). Empty when not asked for. */
  words: ViewRect[];
}

/**
 * The cards of the margin that stand open — through their one marker, in one query — with their rects and their headers; and, unless `shallow`, the controls and the words
 * they hold (P11-49), which the group's and the strip's place is made from. A caller that wants the rects or the headers alone asks `shallow`.
 */
export function openCards(root: Pick<ParentNode, "querySelectorAll">, shallow = false): OpenCards {
  const open: OpenCards = { rects: [], headers: [], explainHeads: [], controls: [], words: [] };
  for (const node of Array.from(root.querySelectorAll(OPEN_CARD_SELECTOR))) {
    const card = node as unknown as CardLike;
    const box = card.getBoundingClientRect();
    if (!(box.width > 0 && box.height > 0)) continue;
    const rect = toRect(box);
    open.rects.push(rect);
    const first = card.firstElementChild ?? null;
    const explain = card.getAttribute?.("data-margin-card") === "explain";
    // The explain card's header is its top row — the one that holds the big X — not the block it stands in, which holds the quoted passage too: the quote is the card's content,
    // like a sticky's text. A card behind another shows that row alone, as its first element.
    const topRow = explain ? card.querySelector?.(EXPLAIN_CLOSE_SELECTOR)?.parentElement ?? null : null;
    const zones: HeaderZone[] = [];
    for (const [row, fromTop] of [[topRow ?? first, topRow !== null], [card.querySelector?.(ZOOM_ROW_SELECTOR) ?? null, false]] as const) {
      const zone = row ? zoneOf(row, rect, fromTop) : null;
      if (zone) zones.push(zone);
    }
    open.headers.push(...zones);
    if (!shallow) {
      open.controls.push(...controlsOf(card, rect, zones));
      open.words.push(...wordsOf(card, rect));
    }
    if (first && explain) open.explainHeads.push(first.textContent ?? "");
  }
  return open;
}

/** The rects of the cards that stand open, in the window's pixels; a card with no box (hidden) is left out. */
export function openCardRects(root: Pick<ParentNode, "querySelectorAll">): ViewRect[] {
  return openCards(root, true).rects;
}

/** The headers of the cards that stand open: where the group must not stand. */
export function readHeaders(root: Pick<ParentNode, "querySelectorAll">): HeaderZone[] {
  return openCards(root, true).headers;
}

/** What the open cards hold that the group and the strip must not cover (their headers' rows and what they hold, their controls) and should cover as little of as they can (their words). */
export interface CardObstacles {
  headers: HeaderZone[];
  controls: ViewRect[];
  words: ViewRect[];
}

/** P11-49: the open cards' headers, controls and words, in the window's pixels, read from the page in one query by the margin's marker (and one per card). */
export function readCardObstacles(root: Pick<ParentNode, "querySelectorAll">): CardObstacles {
  const { headers, controls, words } = openCards(root);
  return { headers, controls, words };
}

/** Ends the selection the way Take notes and Highlight do: the browser's ranges go, and the page's hold on the selection goes after them. */
function dropSelection(): void {
  if (typeof window !== "undefined") window.getSelection?.()?.removeAllRanges();
}

const squash = (text: string) => text.replace(/\s+/g, " ").trim();

/** Whether the Explain card that stands (the words of its header) is explaining `passage`: its opening words are in the header. */
export function explainHeadHolds(heads: readonly string[], passage: string): boolean {
  const wanted = squash(previewOf(passage));
  return wanted !== "" && heads.some((head) => squash(head).includes(wanted));
}

/** How far `group` stands from the nearest of `cards`, in px: negative where they overlap, `Infinity` with no card. Pure. */
export function clearanceFrom(group: ViewRect, cards: readonly ViewRect[]): number {
  let nearest = Infinity;
  for (const card of cards) {
    nearest = Math.min(nearest, Math.max(card.left - group.right, group.left - card.right, card.top - group.bottom, group.top - card.bottom));
  }
  return nearest;
}

/** The room kept between the group and a part of a header or a control when it is slid along the margin to clear it. */
export const HEADER_GAP_PX = 4;

/**
 * How a place was made clear of the cards: `level` — it did not need to be; `aside` — level with the line, slid along the margin to clear a control or to cover fewer of a
 * card's words; `free` — wholly inside a header row, on what the row's text and controls leave; `below` / `above` — just under or over a header or a control, whichever is nearer the
 * line; `held` — nowhere was clear, so it stays level.
 */
export type Clearance = "level" | "aside" | "free" | "below" | "above" | "held";

/**
 * P11-38 rule 2: the place for a box of `size` that would stand at (`left`, `top`) — the margin's left edge and the first line's height — made clear of the headers.
 * Level (`top` and `left` as given) when the box is over no header. Otherwise on a header's free part: the same top, the left moved along the margin to the nearest place where
 * the box fits whole between what the headers hold at that height (`parts`: the X, the title's words, the controls — and a few pixels from each): a move of nothing. Otherwise the
 * nearest clear place above or below: just above a header or just below one — below the last of a stack of them, above the first — wholly inside the band; the nearer to `top`
 * wins, and just below when they are as near. Otherwise held where it was: nothing is clear. It never leaves the margin sideways. Pure.
 *
 * P11-49 rule 1 (ruling §1h.149): the same for the cards' `controls` — a toolbar's row and its buttons, a sticky's button, the explain card's link, input and Send. A box is clear
 * only of a control's whole box, wherever the control stands: the places above are made of what the headers hold and what the controls are, and the edges of the controls are
 * places too (just above one, just below one). Level with the line, slid along the margin past a control, it is `aside`.
 */
export function clearOfHeaders(input: {
  margin: MarginRect;
  size: { width: number; height: number };
  left: number;
  top: number;
  headers: readonly HeaderZone[];
  /** P11-49: the controls of the open cards that no header holds (`readCardObstacles`). */
  controls?: readonly ViewRect[];
}): { left: number; top: number; how: Clearance } {
  const { margin, size, left, top, headers } = input;
  const controls = input.controls ?? [];
  const at = (x: number, y: number): ViewRect => ({ left: x, top: y, right: x + size.width, bottom: y + size.height });
  const onHeader = (box: ViewRect) => headers.some((zone) => meets(box, zone.box));
  const onControl = (box: ViewRect) => controls.some((control) => meets(box, control));
  if (!onHeader(at(left, top)) && !onControl(at(left, top))) return { left, top, how: "level" };

  // The free part: where the box would stand on a header or a control, the places along the margin where it fits whole between what the headers hold at this height (a few pixels
  // from each part) and the controls. A header holding nothing at this height — the box would meet only its padding or its border — has none: the box stands under it.
  const reach = at(left, top);
  const blocked = [...headers.flatMap((zone) => zone.parts), ...controls]
    .filter((part) => part.top < reach.bottom && reach.top < part.bottom)
    .map((part): [number, number] => [part.left - HEADER_GAP_PX, part.right + HEADER_GAP_PX])
    .sort((a, b) => a[0] - b[0]);
  if (blocked.length > 0) {
    const from = margin.left + MARGIN_INSET_PX;
    const to = margin.left + margin.width - MARGIN_INSET_PX;
    const gaps: Array<[number, number]> = [];
    let cursor = from;
    for (const [start, end] of blocked) {
      if (start > cursor) gaps.push([cursor, Math.min(start, to)]);
      cursor = Math.max(cursor, end);
    }
    if (cursor < to) gaps.push([cursor, to]);
    let free: number | null = null;
    for (const [start, end] of gaps) {
      if (end - start < size.width) continue;
      const x = Math.min(Math.max(left, start), end - size.width);
      if (free === null || Math.abs(x - left) < Math.abs(free - left)) free = x;
    }
    if (free !== null) return { left: free, top, how: onHeader(at(free, top)) ? "free" : "aside" };
  }

  // Otherwise the nearest clear place: just above or just below a header or a control (below the last of a stack: the places are the edges of the headers and the controls, and a
  // place is clear when the box is over no header and no control there), wholly inside the band; the nearer to `top` wins, and just below when they are as near.
  const inBand = (y: number) => y >= margin.top && y + size.height <= margin.bottom;
  let best: number | null = null;
  for (const y of [...headers.flatMap((zone) => [zone.box.bottom, zone.box.top - size.height]), ...controls.flatMap((control) => [control.bottom, control.top - size.height])]) {
    if (!inBand(y) || onHeader(at(left, y)) || onControl(at(left, y))) continue;
    if (best === null || Math.abs(y - top) < Math.abs(best - top) || (Math.abs(y - top) === Math.abs(best - top) && y > best)) best = y;
  }
  if (best !== null) return { left, top: best, how: best > top ? "below" : "above" };
  return { left, top, how: "held" };
}

/**
 * Where the group stands, and in which mode. With a margin registered — always in the margin, whatever stands there: the left edge 8 px in from the margin's,
 * the top `placeInMargin` of the selection's first line, the three buttons one under the other. An open card at that height does not move it (P11-27 rule 1;
 * ruling §1h.122): the group stands over the card. With no margin (a window under 1024 px, a page without the shell) it is today's pill above the selection
 * (`toolbarPlace`), in a row. Null where nothing is drawn — a window under 768 px, or a selection wholly out of view. Pure.
 *
 * P11-38 rule 2: with the open cards' `headers` the level place is made clear of them (`clearOfHeaders`): the group never stands over a card's X, title or controls.
 */
export function actionsPlace(input: {
  bounds: ViewRect;
  viewport: { width: number; height: number };
  /** The margin `useMarginRect()` gives; null where there is none. */
  margin: MarginRect | null;
  /** The group's own size in each mode (it is a column in the margin and a row above). */
  sizes: { margin: { width: number; height: number }; above: { width: number; height: number } };
  /** P11-38: the open cards' headers, where the group must not stand (the margin's mode only: the pill above the selection is as it was). */
  headers?: readonly HeaderZone[];
  controls?: readonly ViewRect[];
  words?: readonly ViewRect[];
}): ActionsPlace | null {
  const { bounds, viewport, margin, sizes } = input;
  const pill = toolbarPlace({ bounds, viewport, size: sizes.above });
  if (pill === null) return null;
  if (margin === null) return { mode: "above", ...pill };
  const level = { left: margin.left + MARGIN_INSET_PX, top: placeInMargin(margin, bounds.top, sizes.margin.height) };
  const spot = clearOfHeaders({ margin, size: sizes.margin, ...level, headers: input.headers ?? [], controls: input.controls ?? [] });
  return { mode: "margin", left: spot.left, top: spot.top, below: false, ...(spot.how === "level" ? {} : { clear: spot.how }) };
}

const BUTTON =
  "px-3 py-1.5 text-heading transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover";

export function SelectionToolbarView({
  place,
  canExplain,
  onExplain,
  onTakeNote,
  onHighlight,
  overCard = false,
  innerRef,
}: {
  /** Where it stands; a `mode` of "margin" draws a column, anything else (a place without one is the old pill) a row. `clear` says it was moved off a card's header or control (P11-38, P11-49). */
  place: ToolbarPlace & { mode?: ActionsMode; clear?: ActionsPlace["clear"] };
  /** The page can explain this selection (`selectionCanExplain`); when it cannot, "Explain this" is not drawn. */
  canExplain: boolean;
  onExplain: () => void;
  onTakeNote: () => void;
  /** P11-13: the third action. Absent, there is no Highlight button (the page has none to hand, or it cannot highlight this selection). */
  onHighlight?: () => void;
  /** P11-27: the group stands over an open card of the margin (it is above it in z-order, on its own surface). */
  overCard?: boolean;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  // A press must not move the selection: the words stay highlighted while the pill is used.
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();
  const column = place.mode === "margin";
  // A divider between the buttons: over each but the first in the column, on the left of each but the first in the row.
  const divider = column ? "border-t border-border-strong text-left" : "border-l border-border-strong";
  let drawn = 0;
  const button = () => (drawn++ === 0 ? (column ? `${BUTTON} text-left` : BUTTON) : `${BUTTON} ${divider}`);
  return (
    <div
      ref={innerRef}
      role="toolbar"
      aria-label="Selection actions"
      {...(column ? { "aria-orientation": "vertical" as const } : {})}
      data-selection-toolbar=""
      data-mode={column ? "margin" : "above"}
      {...(overCard ? { "data-over-card": "" } : {})}
      {...(place.clear ? { "data-header-clear": place.clear } : {})}
      style={{ left: place.left, top: place.top }}
      className={`fixed z-[70] flex ${column ? "flex-col" : ""} items-stretch whitespace-nowrap border border-border-strong bg-surface font-mono text-caption shadow-card-hover`}
    >
      {canExplain && (
        <button type="button" data-selection-explain="" onMouseDown={keep} onClick={onExplain} className={button()}>
          {SELECTION_LABELS.explain}
        </button>
      )}
      <button type="button" data-selection-note="" onMouseDown={keep} onClick={onTakeNote} className={button()}>
        {SELECTION_LABELS.note}
      </button>
      {onHighlight && (
        <button type="button" data-selection-highlight="" onMouseDown={keep} onClick={onHighlight} className={button()}>
          {SELECTION_LABELS.highlight}
        </button>
      )}
    </div>
  );
}

interface Frame {
  /** The selection this was measured for: a frame for another selection is not used. */
  of: ExplainSelection;
  bounds: ViewRect;
  viewport: { width: number; height: number };
  /** The open cards' rects at the same moment. */
  cards: ViewRect[];
  /** P11-38: their headers, and whether the Explain card that stands holds the selection's passage. */
  headers: HeaderZone[];
  /** P11-49: their controls (outside the headers), which the place is made from. */
  controls: ViewRect[];
  explained: boolean;
}

const sameRect = (a: ViewRect, b: ViewRect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

const sameHeader = (a: HeaderZone, b: HeaderZone) => sameRect(a.box, b.box) && a.parts.length === b.parts.length && a.parts.every((part, index) => sameRect(part, b.parts[index]));

const sameRects = (a: readonly ViewRect[], b: readonly ViewRect[]) => a.length === b.length && a.every((rect, index) => sameRect(rect, b[index]));

const sameFrame = (a: Frame | null, b: Frame | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.of === b.of &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    sameRect(a.bounds, b.bounds) &&
    a.cards.length === b.cards.length &&
    a.cards.every((card, index) => sameRect(card, b.cards[index])) &&
    a.explained === b.explained &&
    a.headers.length === b.headers.length &&
    a.headers.every((header, index) => sameHeader(header, b.headers[index])) &&
    sameRects(a.controls, b.controls));

type Size = { width: number; height: number };

/** What the group measures before it has been drawn in a mode with this many buttons (a button is about 28 px tall and 100 wide). */
const estimate = (mode: ActionsMode, buttons: number): Size => (mode === "margin" ? { width: 112, height: 29 * buttons + 1 } : { width: 100 * buttons, height: 30 });

export function SelectionToolbar({
  target,
  canExplain,
  onExplain,
  onTakeNote,
  onHighlight,
  canHighlight = false,
}: {
  target: ExplainSelection | null;
  /** The page can explain this selection (`selectionCanExplain`). */
  canExplain: boolean;
  onExplain: () => void;
  onTakeNote: (target: ExplainSelection) => void;
  /** P11-13: the page's highlight (C P11-07's `useHighlight`). Until the page passes it there is no Highlight button. */
  onHighlight?: (target: ExplainSelection) => void;
  /** P11-13: the page can highlight this selection (`canHighlight(target)`: a paragraph, a heading or a caption of the paper's body, a Summary block or an answer). */
  canHighlight?: boolean;
}) {
  const [frame, setFrame] = useState<Frame | null>(null);
  // The group's measured size, by mode and number of buttons; until it has been drawn once the estimate stands.
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  // P11-38 rule 1: the selection Explain this was pressed for. While it is the selection that stands the group is put away; any other selection is a new one.
  const [pressed, setPressed] = useState<ExplainSelection | null>(null);
  // …and, for a press the button did not see (`e`), whether the Explain card held the selection's passage the last time the page was read.
  const explainedWas = useRef<{ of: ExplainSelection; explained: boolean } | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const margin = useMarginRect();
  // P11-42 (rule 2; ruling §1h.139 (b)): Explain this is offered for a selection in a heading or a caption as for a paragraph's — the page's word stands. The route finds
  // such a passage now (`lib/papers/explain.ts`, `locatePassage` with `blocks`); the header's note on P11-27 rule 2 (not offered for it) is retired by this.
  const explainable = canExplain;
  const actions = offeredActions({ canExplain: explainable, onHighlight, canHighlight });
  const buttons = actions.length;

  // Where the selection is now, with the cards that stand open beside it; and again after each scroll or resize, each change of the
  // window stack (a sticky opened, raised or closed — once its card has been drawn), each reflow of the page (the dock's reserve is
  // written on the root element and moves the text without a scroll or a resize: the pill went stale after it, P11-03's defect (b))
  // and each resize of the margin (a divider drag moves the text column, and so the selection). Nothing is listened to while no
  // selection stands.
  useEffect(() => {
    if (!target) return;
    const measure = () => {
      const where = target.measure ? target.measure() : target;
      const open = where ? openCards(document) : null;
      const next: Frame | null =
        where && open
          ? {
              of: target,
              bounds: where.bounds,
              viewport: { width: window.innerWidth, height: window.innerHeight },
              cards: open.rects,
              headers: open.headers,
              controls: open.controls,
              explained: explainHeadHolds(open.explainHeads, target.passage),
            }
          : null;
      // P11-38 rule 1, `e`: the key (and the thumb bar's cell) call the page's explain action, not the button. What the toolbar sees of it is the Explain card now holding
      // the selection's passage where it did not the last time the page was read — whenever the stack changes. A card that held the passage when the selection came (the same
      // words selected again) is not a press.
      if (next) {
        const was = explainedWas.current;
        explainedWas.current = { of: target, explained: next.explained };
        if (was !== null && was.of === target && next.explained && !was.explained) {
          setPressed(target);
          if (margin !== null) dropSelection();
        }
      }
      setFrame((current) => (sameFrame(current, next) ? current : next));
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    let pending: number | null = null;
    const stopStack = useWindows.subscribe(() => {
      if (pending !== null) window.cancelAnimationFrame(pending);
      pending = window.requestAnimationFrame(() => {
        pending = null;
        measure();
      });
    });
    const reflow = typeof MutationObserver === "undefined" ? null : new MutationObserver(measure);
    reflow?.observe(document.documentElement, { attributes: true, attributeFilter: ["style"] });
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
      stopStack();
      if (pending !== null) window.cancelAnimationFrame(pending);
      reflow?.disconnect();
    };
  }, [target, margin]);

  const sizeOf = (which: ActionsMode): Size => sizes[`${which}:${buttons}`] ?? estimate(which, buttons);
  const placed =
    target && frame && frame.of === target
      ? actionsPlace({ bounds: frame.bounds, viewport: frame.viewport, margin, sizes: { margin: sizeOf("margin"), above: sizeOf("above") }, headers: frame.headers, controls: frame.controls })
      : null;
  // P11-38 rule 1: in the margin the group is gone once Explain this has been pressed for the selection that stands; the pill above the selection (a window with no margin) is as it was.
  const place = placed !== null && placed.mode === "margin" && target !== null && pressed === target ? null : placed;
  const drawnMode = place?.mode ?? null;

  // P11-27 rule 1: whether the group stands over an open card of the margin — it does not stand clear of one, it stands over it.
  const group = place?.mode === "margin" ? sizeOf("margin") : null;
  const overCard =
    place !== null && group !== null && frame !== null
      ? clearanceFrom({ left: place.left, top: place.top, right: place.left + group.width, bottom: place.top + group.height }, frame.cards) < 0
      : false;

  // Its own size, once it is drawn, so the clamp at the right edge and the cards' test are exact.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || drawnMode === null) return;
    const rect = el.getBoundingClientRect();
    const next = { width: rect.width, height: rect.height };
    if (next.width <= 0 || next.height <= 0) return;
    const key = `${drawnMode}:${buttons}`;
    setSizes((current) => (current[key]?.width === next.width && current[key]?.height === next.height ? current : { ...current, [key]: next }));
  }, [drawnMode, buttons]);

  // P11-38 rule 1, a new drag: the page keeps the same selection object when the words selected are the same, so a drag over the words Explain this was pressed for would
  // never be news. A press that changed the selection (a `selectionchange` between the press and its release) and left one standing is a new selection: the wait ends — in a
  // timer, queued after the page's own read of the release, so a different selection arrives first. A click that collapses it, a press inside a card and one that
  // changes nothing (a button, a tab) do not end it. Listening only while the group is put away.
  useEffect(() => {
    if (pressed === null || pressed !== target) return;
    let armed = false;
    let changed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const outside = (node: unknown) => (node as Element | null)?.closest?.(`[data-selection-toolbar], [data-highlight-strip], ${OPEN_CARD_SELECTOR}`) == null;
    const onDown = (event: Event) => {
      const press = event as PointerEvent;
      armed = press.button === 0 && press.isPrimary !== false && outside(press.target);
      changed = false;
    };
    const onChange = () => {
      if (armed) changed = true;
    };
    const onUp = () => {
      const made = armed && changed;
      armed = false;
      changed = false;
      if (!made) return;
      timer = setTimeout(() => {
        const standing = typeof window.getSelection === "function" ? window.getSelection() : null;
        if (standing !== null && !standing.isCollapsed) setPressed(null);
      }, 0);
    };
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("selectionchange", onChange);
    document.addEventListener("pointerup", onUp, true);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("selectionchange", onChange);
      document.removeEventListener("pointerup", onUp, true);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pressed, target]);

  // P11-13 (rule 3): under 768 px the group is not drawn; the thumb bar's Highlight cell stands for it (`explain-offer.ts`) while a
  // settled selection on the screen has a highlight on offer — the explain box says the same of its own cell. Taken back when any of
  // that stops being true and when the page is left.
  const onBar =
    target !== null && frame !== null && frame.of === target && actions.includes("highlight") && frame.viewport.width < MASTHEAD_MIN_VIEWPORT_PX && frame.bounds.bottom > 0 && frame.bounds.top < frame.viewport.height;
  useEffect(() => {
    setHighlightOffer(onBar);
  }, [onBar]);
  useEffect(() => () => setHighlightOffer(false), []);

  if (!target || !place) return null;
  const highlight = actions.includes("highlight") ? () => onHighlight?.(target) : undefined;
  // P11-38 rule 1: the press explains, and ends the group's job and the selection (in the margin; the pill above the selection is as it was).
  const explain = () => {
    onExplain();
    setPressed(target);
    if (place.mode === "margin") dropSelection();
  };
  return (
    <SelectionToolbarView place={place} canExplain={explainable} onExplain={explain} onTakeNote={() => onTakeNote(target)} onHighlight={highlight} overCard={overCard} innerRef={(el) => (box.current = el)} />
  );
}
