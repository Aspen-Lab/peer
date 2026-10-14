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

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { PaperTerm } from "@/lib/papers/report";
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

export const SELECTION_LABELS = { explain: "Explain this", note: "Take notes" } as const;

/** The room between the pill and the selection's first line. */
export const TOOLBAR_GAP_PX = 6;
/** The room kept between the pill and the window's edge. */
const EDGE_PX = 8;
/** What the pill measures before it has been drawn once. */
const FIRST_SIZE = { width: 200, height: 32 };

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

const BUTTON =
  "px-3 py-1.5 text-heading transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:bg-surface-hover";

export function SelectionToolbarView({
  place,
  canExplain,
  onExplain,
  onTakeNote,
  innerRef,
}: {
  place: ToolbarPlace;
  /** The page can explain this selection (`selectionCanExplain`); when it cannot, "Explain this" is not drawn. */
  canExplain: boolean;
  onExplain: () => void;
  onTakeNote: () => void;
  innerRef?: (el: HTMLDivElement | null) => void;
}) {
  // A press must not move the selection: the words stay highlighted while the pill is used.
  const keep = (event: { preventDefault: () => void }) => event.preventDefault();
  return (
    <div
      ref={innerRef}
      role="toolbar"
      aria-label="Selection actions"
      data-selection-toolbar=""
      style={{ left: place.left, top: place.top }}
      className="fixed z-[70] flex items-stretch whitespace-nowrap border border-border-strong bg-surface font-mono text-caption shadow-card-hover"
    >
      {canExplain && (
        <button type="button" data-selection-explain="" onMouseDown={keep} onClick={onExplain} className={BUTTON}>
          {SELECTION_LABELS.explain}
        </button>
      )}
      <button type="button" data-selection-note="" onMouseDown={keep} onClick={onTakeNote} className={canExplain ? `${BUTTON} border-l border-border-strong` : BUTTON}>
        {SELECTION_LABELS.note}
      </button>
    </div>
  );
}

interface Frame {
  /** The selection this was measured for: a frame for another selection is not used. */
  of: ExplainSelection;
  bounds: ViewRect;
  viewport: { width: number; height: number };
}

const sameFrame = (a: Frame | null, b: Frame | null) =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.of === b.of &&
    a.viewport.width === b.viewport.width &&
    a.viewport.height === b.viewport.height &&
    a.bounds.left === b.bounds.left &&
    a.bounds.top === b.bounds.top &&
    a.bounds.right === b.bounds.right &&
    a.bounds.bottom === b.bounds.bottom);

export function SelectionToolbar({
  target,
  canExplain,
  onExplain,
  onTakeNote,
}: {
  target: ExplainSelection | null;
  /** The page can explain this selection (`selectionCanExplain`). */
  canExplain: boolean;
  onExplain: () => void;
  onTakeNote: (target: ExplainSelection) => void;
}) {
  const [frame, setFrame] = useState<Frame | null>(null);
  const [size, setSize] = useState(FIRST_SIZE);
  const box = useRef<HTMLDivElement | null>(null);

  // Where the selection is now, and again after each scroll or resize.
  useEffect(() => {
    if (!target) return;
    const measure = () => {
      const where = target.measure ? target.measure() : target;
      const next: Frame | null = where ? { of: target, bounds: where.bounds, viewport: { width: window.innerWidth, height: window.innerHeight } } : null;
      setFrame((current) => (sameFrame(current, next) ? current : next));
    };
    measure();
    window.addEventListener("scroll", measure, true);
    window.addEventListener("resize", measure);
    return () => {
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("resize", measure);
    };
  }, [target]);

  const place = target && frame && frame.of === target ? toolbarPlace({ bounds: frame.bounds, viewport: frame.viewport, size }) : null;

  // Its own size, once it is drawn, so the clamp at the right edge is exact.
  const shown = place !== null;
  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const next = { width: el.offsetWidth, height: el.offsetHeight };
    if (next.width > 0 && next.height > 0) setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
  }, [shown]);

  if (!target || !place) return null;
  return <SelectionToolbarView place={place} canExplain={canExplain} onExplain={onExplain} onTakeNote={() => onTakeNote(target)} innerRef={(el) => (box.current = el)} />;
}
