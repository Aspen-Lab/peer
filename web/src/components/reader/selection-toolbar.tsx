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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PaperTerm } from "@/lib/papers/report";
import { setHighlightOffer } from "@/lib/reader/explain-offer";
import { MARGIN_CARD_SELECTOR, placeInMargin, useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import type { ExplainSelection, ViewRect } from "./paper-body";
import { definingTerm } from "./explain-box";
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
}

/** The group's left edge sits this far in from the margin's. */
export const MARGIN_INSET_PX = 8;
/** An open card within this many px of the group covers it. */
export const CARD_SLACK_PX = 4;
/** After the group has gone above a card, it needs this much more room before it returns to the margin. */
export const MODE_HYSTERESIS_PX = 12;

/**
 * The open cards: those the margin will carry (`data-margin-card`) and, until every card in the page carries it, today's own — the
 * explain dock and the sticky and notes windows.
 */
export const OPEN_CARD_SELECTOR = [MARGIN_CARD_SELECTOR, "[data-explain-dock]", "[data-sticky]", "[data-notes-window]"].join(", ");

/** The rects of the cards that stand open, in the window's pixels; a card with no box (hidden) is left out. */
export function openCardRects(root: Pick<ParentNode, "querySelectorAll">): ViewRect[] {
  const rects: ViewRect[] = [];
  for (const card of Array.from(root.querySelectorAll(OPEN_CARD_SELECTOR))) {
    const box = card.getBoundingClientRect();
    if (box.width > 0 && box.height > 0) rects.push({ left: box.left, top: box.top, right: box.right, bottom: box.bottom });
  }
  return rects;
}

/** How far `group` stands from the nearest of `cards`, in px: negative where they overlap, `Infinity` with no card. Pure. */
export function clearanceFrom(group: ViewRect, cards: readonly ViewRect[]): number {
  let nearest = Infinity;
  for (const card of cards) {
    nearest = Math.min(nearest, Math.max(card.left - group.right, group.left - card.right, card.top - group.bottom, group.top - card.bottom));
  }
  return nearest;
}

/**
 * Where the group stands, and in which mode. In the margin when a margin is registered and no open card covers the place the
 * group would have there — the left edge 8 px in from the margin's, the top `placeInMargin` of the selection's first line, the
 * three buttons one under the other. Otherwise above the selection, today's pill (`toolbarPlace`), in a row. A card covers the
 * place when it comes within 4 px of it; once the group has gone above a card (`mode` is what it was drawn as last) it returns to
 * the margin only when the card is 12 px further clear, so a selection scrolling past a card's edge does not flicker. Null where
 * nothing is drawn — a window under 768 px, or a selection wholly out of view. Pure.
 */
export function actionsPlace(input: {
  bounds: ViewRect;
  viewport: { width: number; height: number };
  /** The margin `useMarginRect()` gives; null where there is none. */
  margin: MarginRect | null;
  /** The open cards' rects (`openCardRects`). */
  cards: readonly ViewRect[];
  /** The group's own size in each mode (it is a column in the margin and a row above). */
  sizes: { margin: { width: number; height: number }; above: { width: number; height: number } };
  /** The mode the group is drawn in now, for the hysteresis. */
  mode?: ActionsMode | null;
}): ActionsPlace | null {
  const { bounds, viewport, margin, cards, sizes, mode } = input;
  const pill = toolbarPlace({ bounds, viewport, size: sizes.above });
  if (pill === null) return null;
  if (margin === null) return { mode: "above", ...pill };
  const { width, height } = sizes.margin;
  const left = margin.left + MARGIN_INSET_PX;
  const top = placeInMargin(margin, bounds.top, height);
  const room = clearanceFrom({ left, top, right: left + width, bottom: top + height }, cards);
  if (room >= (mode === "above" ? CARD_SLACK_PX + MODE_HYSTERESIS_PX : CARD_SLACK_PX)) return { mode: "margin", left, top, below: false };
  return { mode: "above", ...pill };
}

const BUTTON =
  "px-3 py-1.5 text-heading transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover";

export function SelectionToolbarView({
  place,
  canExplain,
  onExplain,
  onTakeNote,
  onHighlight,
  innerRef,
}: {
  /** Where it stands; a `mode` of "margin" draws a column, anything else (a place without one is the old pill) a row. */
  place: ToolbarPlace & { mode?: ActionsMode };
  /** The page can explain this selection (`selectionCanExplain`); when it cannot, "Explain this" is not drawn. */
  canExplain: boolean;
  onExplain: () => void;
  onTakeNote: () => void;
  /** P11-13: the third action. Absent, there is no Highlight button (the page has none to hand, or it cannot highlight this selection). */
  onHighlight?: () => void;
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
}

const sameRect = (a: ViewRect, b: ViewRect) => a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

const sameFrame = (a: Frame | null, b: Frame | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.of === b.of &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    sameRect(a.bounds, b.bounds) &&
    a.cards.length === b.cards.length &&
    a.cards.every((card, index) => sameRect(card, b.cards[index])));

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
  /** P11-13: the page can highlight this selection (`canHighlight(target)`: paper-body selections only). */
  canHighlight?: boolean;
}) {
  const [frame, setFrame] = useState<Frame | null>(null);
  // The group's measured size, by mode and number of buttons; until it has been drawn once the estimate stands.
  const [sizes, setSizes] = useState<Record<string, Size>>({});
  // The mode it is drawn in now: the hysteresis needs to know which way it is switching.
  const [mode, setMode] = useState<ActionsMode | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const margin = useMarginRect();
  const actions = offeredActions({ canExplain, onHighlight, canHighlight });
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
      const next: Frame | null = where
        ? { of: target, bounds: where.bounds, viewport: { width: window.innerWidth, height: window.innerHeight }, cards: openCardRects(document) }
        : null;
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
  const place =
    target && frame && frame.of === target
      ? actionsPlace({ bounds: frame.bounds, viewport: frame.viewport, margin, cards: frame.cards, sizes: { margin: sizeOf("margin"), above: sizeOf("above") }, mode })
      : null;

  // The mode it is drawn in, kept for the next measure; a new selection starts fresh.
  const drawnMode = place?.mode ?? null;
  if (!target ? mode !== null : drawnMode !== null && drawnMode !== mode) setMode(target ? drawnMode : null);

  // Its own size, once it is drawn, so the clamp at the right edge and the cards' test are exact.
  useLayoutEffect(() => {
    const el = box.current;
    if (!el || drawnMode === null) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    if (next.width <= 0 || next.height <= 0) return;
    const key = `${drawnMode}:${buttons}`;
    setSizes((current) => (current[key]?.width === next.width && current[key]?.height === next.height ? current : { ...current, [key]: next }));
  }, [drawnMode, buttons]);

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
  return (
    <SelectionToolbarView place={place} canExplain={canExplain} onExplain={onExplain} onTakeNote={() => onTakeNote(target)} onHighlight={highlight} innerRef={(el) => (box.current = el)} />
  );
}
