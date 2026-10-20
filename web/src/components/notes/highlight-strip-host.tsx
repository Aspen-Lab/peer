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
//   - it goes — the store is cleared, so scrolling back does not bring it up; a click on the mark does — when the mark is more than a screen away
//     (B P11-04 §5: `AWAY_SCREENS` windows beyond the window's top or foot; held at the band's edge up to that) or is gone from the page;
//   - it stands where the selection's three actions stood: 8 px in from the margin's left edge, `placeInMargin` of the mark's first line. Where an
//     open card covers that place it follows the rule the actions follow (O-2, D4): above the mark's first line, left-aligned with it, as the pill
//     was — and returns to the margin only when the card is 12 px further clear. The test and its constants are the toolbar's own;
//   - Escape: the strip's own listener hides it but does not take the key, and on a paper page Escape is "back to the briefing" (the keyboard layer, on
//     `window`). The host takes the key while a strip stands (`takeStripEscape`), as the figure card does for its own: on the document, in the bubble
//     phase, from the moment the host mounts, leaving a key that was handled already and a modal dialog over the page;
//   - the page keys the host by the paper and the host hides the strip when it unmounts, so a strip never follows the reader to the next paper.
//
// It opens no window, reserves no column, stores nothing and sends nothing.

import { useCallback, useEffect, useLayoutEffect, useRef, useSyncExternalStore, type ReactElement } from "react";
import { flushSync } from "react-dom";
import { create } from "zustand";
import { MODAL_OVER_PAGE } from "@/components/reader/explain-dock";
import type { ViewRect } from "@/components/reader/paper-body";
import { CARD_SLACK_PX, MARGIN_INSET_PX, MODE_HYSTERESIS_PX, clearanceFrom, openCardRects, toolbarPlace } from "@/components/reader/selection-toolbar";
import { placeInMargin, useMarginRect, type MarginRect } from "@/lib/reader/margin";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { HighlightStrip, STRIP_MIN_WIDTH_PX, SWATCH_HIT_PX, useHighlightStrip } from "./highlight-strip";
import { highlightMarks } from "./note-tags";

/** How far from the window the mark may be, in windows, before the strip goes (B P11-04 §5: "more than a screen away"). */
export const AWAY_SCREENS = 1;
/** The strip's height on one row: its colours' hit area, its padding (4 + 4) and its border (1 + 1). */
export const STRIP_ROW_PX = SWATCH_HIT_PX + 10;
/** On two rows, which it wraps to in a narrow margin. */
export const STRIP_TWO_ROWS_PX = 2 * SWATCH_HIT_PX + 10;
/** The width that holds the six colours and the remove button on one row (measured on the real page). */
export const STRIP_ONE_ROW_WIDTH_PX = 216;
/** The widest the strip may be above a mark (one row, with room to spare). */
export const STRIP_ABOVE_WIDTH_PX = 240;

/** Where the strip stands: in the margin, level with the mark's first line, or above it where a card covers that place. */
export type StripMode = "margin" | "above";

export interface StripStanding {
  mode: StripMode;
  left: number;
  top: number;
  /** The widest the strip may be (`HighlightStrip`'s `width`): it wraps to a second row rather than pass it. */
  width: number;
}

/**
 * Where the strip stands for a mark whose first line is `mark`, in the window's pixels — or null: the mark is more than `AWAY_SCREENS` windows
 * from the window (the strip goes), or there is no room above it where a card has taken the margin's place. In the margin when no open card comes
 * within `CARD_SLACK_PX` of the place the strip would have there (`MODE_HYSTERESIS_PX` more once it has gone above a card: `mode` is what it was
 * drawn as last); the mark is held inside the margin's band. Pure.
 */
export function stripStanding(input: {
  mark: ViewRect;
  viewport: { width: number; height: number };
  margin: MarginRect;
  /** The open cards' rects (`openCardRects`). */
  cards: readonly ViewRect[];
  mode?: StripMode | null;
}): StripStanding | null {
  const { mark, viewport, margin, cards, mode } = input;
  const reach = viewport.height * AWAY_SCREENS;
  if (mark.bottom < -reach || mark.top > viewport.height + reach) return null;
  const inner = Math.max(0, margin.width - 2 * MARGIN_INSET_PX);
  const room = Math.max(STRIP_MIN_WIDTH_PX, inner);
  const oneRow = room >= STRIP_ONE_ROW_WIDTH_PX;
  const size = { width: Math.min(room, STRIP_ONE_ROW_WIDTH_PX), height: oneRow ? STRIP_ROW_PX : STRIP_TWO_ROWS_PX };
  const left = margin.left + MARGIN_INSET_PX;
  const top = placeInMargin(margin, mark.top, size.height);
  const clear = clearanceFrom({ left, top, right: left + size.width, bottom: top + size.height }, cards);
  if (clear >= (mode === "above" ? CARD_SLACK_PX + MODE_HYSTERESIS_PX : CARD_SLACK_PX)) return { mode: "margin", left, top, width: inner };
  const pill = toolbarPlace({ bounds: mark, viewport, size: { width: STRIP_ABOVE_WIDTH_PX, height: STRIP_ROW_PX } });
  return pill === null ? null : { mode: "above", left: pill.left, top: pill.top, width: STRIP_ABOVE_WIDTH_PX };
}

/** The first line of the highlight's mark on the page now (its own mark and the nested parts of it, in reading order), or null when it is not drawn. */
export function markLine(doc: Pick<Document, "querySelector">, id: string): ViewRect | null {
  const mark = doc.querySelector(highlightMarks(id));
  if (!mark) return null;
  const box = mark.getClientRects()[0] ?? mark.getBoundingClientRect();
  return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
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
  // The mode it is drawn in now: the hysteresis needs to know which way it is switching.
  const mode = useRef<StripMode | null>(null);

  // Where the mark is now, and so where the strip stands (or that it goes). Reads the store, not the render's id: it runs from a frame.
  const place = useCallback((): void => {
    const current = useHighlightStrip.getState().id;
    if (current === null || margin === null) return;
    const line = markLine(document, current);
    const next =
      line === null
        ? null
        : stripStanding({ mark: line, viewport: { width: window.innerWidth, height: window.innerHeight }, margin, cards: openCardRects(document), mode: mode.current });
    if (next === null) {
      mode.current = null;
      useHighlightStrip.getState().hide();
      putPlace(null);
      return;
    }
    mode.current = next.mode;
    putPlace({ ...next, id: current });
  }, [margin]);

  // After every commit: a strip just raised, a margin that moved, a page that re-rendered with its body gone (a tab) — before the paint.
  useLayoutEffect(() => {
    place();
  });

  // While a strip stands: the page's scroll (in the capture phase, so a scrolled pane counts), the window's resize and each change of the window
  // stack (a card opened or closed) ask for a measure in the next frame — one at a time — and the frame repaints before it is drawn.
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
