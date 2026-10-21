"use client";

// P11-17b rule 2 (owner item 8; B P11-04 §5–§6; ruling §1h.112 D3): the margin's host of the highlight's colour strip.
//
// C P11-07 built the strip (`HighlightStrip`: six colours and a remove button, closed by Escape, by a press elsewhere and by the next selection)
// and the store that names the highlight it is for (`useHighlightStrip`, raised by the Highlight action and by a click on a mark). Nothing mounted
// it. This is its host, mounted once by the page, keyed by the paper (as the figure host is):
//
//   - while the store names a highlight and the page has a margin (`useMarginRect()`, null under 1024 css px: there is no strip then — the mark
//     is still drawn and the colour is changed from the notes window), it renders `HighlightStrip` for the paper's reading note (`readingNoteFor`),
//     with the margin's `left` and `width`;
//   - `top` is the mark's first line NOW, not the height the click or the selection reported: the host reads `mark[data-highlight="<id>"]`'s first
//     client rect after each commit and again on scroll and on resize, one animation frame each (`requestAnimationFrame`, one pending at a time),
//     and repaints inside that frame (`flushSync`), so the strip stays level with its mark while the page moves under it;
//   - it goes — the store is cleared, so scrolling back does not bring it up; a click on the mark does — as soon as no part of its mark is inside the
//     window (P11-27 rule 3; ruling §1h.123: it was held at the band's edge for a window's height beyond, a strip hovering with nothing beside it, which two
//     readers of round 1 costed) or when the mark is gone from the page. "Inside the window" is what the selection's actions use: below the masthead's foot
//     (the margin band's top) and above the window's foot; the whole mark counts (`markBox`), so a mark whose first line has scrolled out but whose later
//     line has not keeps its strip, held at the band's top;
//   - it stands where the selection's three actions stand: 8 px in from the margin's left edge, `placeInMargin` of the mark's first line — in the margin,
//     level with the mark, whatever card stands at that height (P11-27 rule 1; ruling §1h.122, which amends §1h.113 (b) O-2: the strip once stood above the
//     mark over the line above it, where a card covered that place). It stands over the card — `z-[70]`, over the stack's cards, on its own surface —
//     and never over the centre column's words;
//   - but never over a card's header (P11-38 rule 2; ruling §1h.138 (a); owner item 5): its X, its title, its controls. The headers are read from the page when the
//     strip is placed (`readHeaders`, the selection toolbar's reader) and again when the stack of cards changes (a card opened, raised or closed: a frame is asked
//     for, as for a scroll). Where the level place would cover one the strip stands on the header's free part if it fits whole, else just below the header
//     (`clearOfHeaders`, the same function the three actions use);
//   - and over no control of a card, wherever it stands (P11-49 rule 1; ruling §1h.149): the host reads each card's controls with its headers (`readCardObstacles`) and the strip
//     takes the place the three actions take (`clearOfHeaders`): clear of every control, slid along the margin past one, or just above or below it;
//   - Escape: the strip's own listener hides it but does not take the key, and on a paper page Escape is "back to the briefing" (the keyboard layer, on
//     `window`). The host takes the key while a strip stands (`takeStripEscape`), as the figure card does for its own: on the document, in the bubble
//     phase, from the moment the host mounts, leaving a key that was handled already and a modal dialog over the page;
//   - the page keys the host by the paper and the host hides the strip when it unmounts, so a strip never follows the reader to the next paper.
//
// It opens no window, reserves no column, stores nothing and sends nothing.

import { useCallback, useEffect, useLayoutEffect, useSyncExternalStore, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { MODAL_OVER_PAGE } from "@/components/reader/explain-dock";
import type { ViewRect } from "@/components/reader/paper-body";
import { MARGIN_INSET_PX, clearOfHeaders, readCardObstacles, type CardObstacles, type Clearance } from "@/components/reader/selection-toolbar";
import { placeInMargin, useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { HighlightStrip, STRIP_MIN_WIDTH_PX, SWATCH_HIT_PX, useHighlightStrip } from "./highlight-strip";
import { highlightMarks } from "./note-tags";

/** The strip's height on one row: its colours' hit area, its padding (4 + 4) and its border (1 + 1). */
export const STRIP_ROW_PX = SWATCH_HIT_PX + 10;
/** On two rows, which it wraps to in a narrow margin. */
export const STRIP_TWO_ROWS_PX = 2 * SWATCH_HIT_PX + 10;
/** The width that holds the six colours and the remove button on one row (measured on the real page). */
export const STRIP_ONE_ROW_WIDTH_PX = 216;

/** Where the strip stands: in the margin, level with the mark's first line (P11-27 rule 1: it is never above the mark any more). */
export type StripMode = "margin";

export interface StripStanding {
  mode: StripMode;
  left: number;
  top: number;
  /** The widest the strip may be (`HighlightStrip`'s `width`): it wraps to a second row rather than pass it. */
  width: number;
  /** P11-38, P11-49: set when the strip was moved off a card's header or control (`clearOfHeaders`): slid aside along the margin, on a header's free part, just below it, just above it, or held with nowhere clear. Absent when it stands level. */
  clear?: Exclude<Clearance, "level">;
}

/**
 * Where the strip stands for a mark whose first line is `mark` (and whose whole box is `box`, the first line's when not given), in the window's pixels — or
 * null: no part of the mark is inside the window (P11-27 rule 3; ruling §1h.123) — its box ends at or above the masthead's foot (the margin band's top) or
 * starts at or below the window's foot, the bounds the selection's actions are hidden by. Otherwise in the margin, level with the mark's first line, 8 px in from
 * the margin's left edge, whatever card stands at that height (P11-27 rule 1); held inside the margin's band while the first line is out of it and a later one
 * is not. P11-38 rule 2, P11-49 rule 1 (ruling §1h.149): made clear of the open cards' `headers` and `controls` (`clearOfHeaders`): on a header's free part, else the nearest clear place, never over an X, a title or a control. Pure.
 */
export function stripStanding(input: {
  mark: ViewRect;
  box?: ViewRect;
  viewport: { width: number; height: number };
  margin: MarginRect;
  /** P11-38: the open cards' headers (`readCardObstacles`), where the strip must not stand but whole inside a row's free part. */
  headers?: CardObstacles["headers"];
  /** P11-49: their controls, which the strip never covers. */
  controls?: CardObstacles["controls"];
}): StripStanding | null {
  const { mark, viewport, margin } = input;
  const box = input.box ?? mark;
  // The mark's extent: the box, and the first line too (the box is the whole of the mark, so it holds it, but a caller's box may be the first line's alone).
  if (Math.max(box.bottom, mark.bottom) <= margin.top || Math.min(box.top, mark.top) >= viewport.height) return null;
  const inner = Math.max(0, margin.width - 2 * MARGIN_INSET_PX);
  const room = Math.max(STRIP_MIN_WIDTH_PX, inner);
  const oneRow = room >= STRIP_ONE_ROW_WIDTH_PX;
  const height = oneRow ? STRIP_ROW_PX : STRIP_TWO_ROWS_PX;
  const level = { left: margin.left + MARGIN_INSET_PX, top: placeInMargin(margin, mark.top, height) };
  const spot = clearOfHeaders({ margin, size: { width: oneRow ? STRIP_ONE_ROW_WIDTH_PX : room, height }, ...level, headers: input.headers ?? [], controls: input.controls ?? [] });
  return { mode: "margin", left: spot.left, top: spot.top, width: inner, ...(spot.how === "level" ? {} : { clear: spot.how }) };
}

/** The first line of the highlight's mark on the page now (its own mark and the nested parts of it, in reading order), or null when it is not drawn. */
export function markLine(doc: Pick<Document, "querySelector">, id: string): ViewRect | null {
  const mark = doc.querySelector(highlightMarks(id));
  if (!mark) return null;
  const box = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
}

/**
 * The whole of the highlight's mark on the page now: from the top of its first piece's first line (a nested part comes before the mark's own words) to the bottom
 * of the last line of its own mark, or null when it is not drawn. P11-27 rule 3: the strip stays while any of it is in the window. The numbers are copied.
 */
export function markBox(doc: Pick<Document, "querySelector">, id: string): ViewRect | null {
  const first = doc.querySelector(highlightMarks(id));
  if (!first) return null;
  const own = doc.querySelector(`mark[data-highlight="${id.replace(/["\\]/g, "\\$&")}"]`) ?? first;
  const head = first.getClientRects()[0] ?? first.getBoundingClientRect();
  const lines = own.getClientRects();
  const tail = lines[lines.length - 1] ?? own.getBoundingClientRect();
  return {
    left: Math.min(head.left, tail.left),
    top: Math.min(head.top, tail.top),
    right: Math.max(head.right, tail.right),
    bottom: Math.max(head.bottom, tail.bottom),
  };
}

/**
 * The Escape that hides the strip: while a strip stands, take the key (so the page's own Escape, "back to the briefing", never sees it) and
 * hide it. Leaves a key that was handled already (`defaultPrevented`), a modal dialog over the page, every other key and a page with no strip.
 * Returns whether it took the key.
 */
export function takeStripEscape(
  event: Pick<KeyboardEvent, "key" | "defaultPrevented" | "preventDefault" | "stopPropagation">,
  doc: Pick<Document, "querySelector">,
): boolean {
  if (event.key !== "Escape" || event.defaultPrevented) return false;
  if (doc.querySelector("[data-highlight-strip]") === null) return false;
  if (doc.querySelector(MODAL_OVER_PAGE)) return false;
  event.preventDefault();
  event.stopPropagation();
  useHighlightStrip.getState().hide();
  return true;
}

interface Placed extends StripStanding {
  /** The highlight this was measured for: a place measured for another is not used. */
  id: string;
}

const sameStanding = (a: Placed | null, b: Placed) => a !== null && a.id === b.id && a.mode === b.mode && a.left === b.left && a.top === b.top && a.width === b.width;

/**
 * Where the strip stands, as a small store the host reads (like `useMarginStore`): the place is measured from the page — the mark's box — and
 * told to React by the store, not by a state set in an effect. One host stands at a time (the page keys it by the paper); it empties the store
 * when it unmounts. Not persisted, not per-user data.
 */
const usePlace = create<{ placed: Placed | null }>()(() => ({ placed: null }));

function putPlace(next: Placed | null): void {
  const was = usePlace.getState().placed;
  if (next === null ? was !== null : !sameStanding(was, next)) usePlace.setState({ placed: next });
}

export function HighlightStripHost({ paperId }: { paperId: string }): ReactElement | null {
  const id = useSyncExternalStore(
    useHighlightStrip.subscribe,
    () => useHighlightStrip.getState().id,
    () => null,
  );
  const margin = useMarginRect();
  const noteId = useSyncExternalStore(
    useNotesStore.subscribe,
    () => readingNoteFor(useNotesStore.getState().notes, paperId)?.id,
    () => undefined,
  );
  const placed = useSyncExternalStore(
    usePlace.subscribe,
    () => usePlace.getState().placed,
    () => null,
  );

  // Where the mark is now, and so where the strip stands (or that it goes). Reads the store, not the render's id: it runs from a frame.
  const place = useCallback((): void => {
    const current = useHighlightStrip.getState().id;
    if (current === null || margin === null) return;
    const line = markLine(document, current);
    const box = line === null ? null : markBox(document, current);
    const cards = line === null || typeof document.querySelectorAll !== "function" ? { headers: [], controls: [] } : readCardObstacles(document);
    const next =
      line === null ? null : stripStanding({ mark: line, ...(box ? { box } : {}), viewport: { width: window.innerWidth, height: window.innerHeight }, margin, headers: cards.headers, controls: cards.controls });
    if (next === null) {
      useHighlightStrip.getState().hide();
      putPlace(null);
      return;
    }
    putPlace({ ...next, id: current });
  }, [margin]);

  // After every commit: a strip just raised, a margin that moved, a page that re-rendered with its body gone (a tab) — before the paint.
  useLayoutEffect(() => {
    place();
  });

  // While a strip stands: the page's scroll (in the capture phase, so a scrolled pane counts), the window's resize and a change of the stack of cards (one opened,
  // raised or closed: its header may be where the strip stands now — P11-38 rule 2) ask for a measure in the next frame — one at a time — and the frame repaints
  // before it is drawn. A card opening or closing at the mark's height moves the strip only off its header (P11-27 rule 1: never above the mark).
  useEffect(() => {
    if (id === null || margin === null) return;
    let pending: number | null = null;
    const run = () => {
      pending = null;
      flushSync(place);
    };
    const schedule = () => {
      if (pending === null) pending = window.requestAnimationFrame(run);
    };
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    const stopStack = useWindows.subscribe(schedule);
    return () => {
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
      stopStack();
      if (pending !== null) window.cancelAnimationFrame(pending);
    };
  }, [id, margin, place]);

  // Escape, from the moment the host mounts, so it is the first of the document's Escape listeners when a card is open as well.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => void takeStripEscape(event, document);
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // The page keys the host by the paper: a strip never follows the reader to the next one.
  useEffect(
    () => () => {
      useHighlightStrip.getState().hide();
      putPlace(null);
    },
    [],
  );

  if (id === null || margin === null || noteId === undefined || placed === null || placed.id !== id) return null;
  return <HighlightStrip noteId={noteId} blockId={id} top={placed.top} left={placed.left} width={placed.width} />;
}
