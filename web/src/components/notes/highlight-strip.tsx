"use client";

// P11-07 (owner item 8; B P11-04 §5; ruling §1h.112 D3, D4): the highlight's colour strip. After a highlight is made, and by a
// click on its mark, one small strip stands in the right margin, level with the mark's first line: the six colours (a radio group,
// each named, the current one ringed, a 24-px hit area each) and a button that removes the highlight. It is not a window and not a
// card. It goes on Escape, on a press anywhere else, and when the next selection is made — never on a timer.
//
// Three parts: `HighlightSwatches` (the six colours alone — the notes window's row reuses it for its colour button),
// `HighlightStripView` (the strip's markup, no state) and `HighlightStrip` (connected: it reads the highlight's colour from the
// paper's note and listens for what closes it). `useHighlightStrip` says which highlight the strip is for and how high it stands;
// the margin mounts `<HighlightStrip>` while it names one. The strip and the marks are drawn from the store, so a colour chosen
// here repaints the paper and the notes row in the same render.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { create } from "zustand";
import { readHighlight } from "@/lib/notes/blocks";
import { HIGHLIGHT_COLOURS } from "@/lib/notes/highlight-colours";
import type { HighlightColourId } from "@/lib/notes/types";
import { useNotesStore } from "@/store/notes";

/** The hit area of one colour: a square this many pixels on a side. */
export const SWATCH_HIT_PX = 24;
/** The painted square inside it. */
export const SWATCH_PX = 16;
/** The room kept between the strip and the window's edge. */
export const STRIP_EDGE_PX = 8;
/** The strip's own width at the narrowest: its six colours and their padding; narrower than that it would overflow, not wrap. */
export const STRIP_MIN_WIDTH_PX = SWATCH_HIT_PX * HIGHLIGHT_COLOURS.length + 8;
/** Room kept under the strip's top for its two rows (it wraps to two when the margin is narrow). */
const STRIP_RESERVE_PX = 2 * SWATCH_HIT_PX + 16;

// ── Which highlight the strip is for ──────────────────────────────────────

interface StripState {
  /** The highlight's block id, or null: no strip. */
  id: string | null;
  /** Where its top stands, in the window's pixels (the mark's first line). */
  top: number;
  show: (id: string, top: number) => void;
  hide: () => void;
}

/** The strip's state: raised for one highlight at one height, or hidden. Not persisted, not per-user data. */
export const useHighlightStrip = create<StripState>()((set, get) => ({
  id: null,
  top: 0,
  show: (id, top) => {
    const now = get();
    if (now.id !== id || now.top !== top) set({ id, top });
  },
  hide: () => {
    if (get().id !== null) set({ id: null });
  },
}));

// ── The six colours ───────────────────────────────────────────────────────

/** The colour a key moves to from `current`: the arrows step (and wrap), Home and End go to the ends; any other key none. Pure. */
export function nextSwatch(current: HighlightColourId, key: string): HighlightColourId | null {
  const ids = HIGHLIGHT_COLOURS.map((one) => one.id);
  const at = ids.indexOf(current);
  switch (key) {
    case "ArrowRight":
    case "ArrowDown":
      return ids[(at + 1) % ids.length];
    case "ArrowLeft":
    case "ArrowUp":
      return ids[(at - 1 + ids.length) % ids.length];
    case "Home":
      return ids[0];
    case "End":
      return ids[ids.length - 1];
    default:
      return null;
  }
}

/** A press must not move the selection or take the focus from the page: the buttons are used with the mouse as a pen is. */
const keep = (event: { preventDefault: () => void }) => event.preventDefault();

/**
 * The presets as a radio group: each button is named for its colour (`aria-label`, and a tooltip), the current one is checked and
 * ringed, and each has a hit area of `SWATCH_HIT_PX` square. The arrow keys move the choice, as a radio group's do.
 */
export function HighlightSwatches({
  value,
  onPick,
  label = "Highlight colour",
}: {
  value: HighlightColourId;
  onPick: (colour: HighlightColourId) => void;
  label?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} data-highlight-swatches="" className="flex items-center">
      {HIGHLIGHT_COLOURS.map((one) => {
        const current = one.id === value;
        return (
          <button
            key={one.id}
            type="button"
            role="radio"
            aria-checked={current}
            aria-label={one.name}
            title={one.name}
            data-highlight-colour={one.id}
            data-current={current ? "" : undefined}
            tabIndex={current ? 0 : -1}
            style={{ width: SWATCH_HIT_PX, height: SWATCH_HIT_PX }}
            onMouseDown={keep}
            onClick={() => onPick(one.id)}
            onKeyDown={(event) => {
              const next = nextSwatch(value, event.key);
              if (!next) return;
              event.preventDefault();
              onPick(next);
              event.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-highlight-colour="${next}"]`)?.focus();
            }}
            className="flex shrink-0 cursor-pointer items-center justify-center focus-visible:bg-surface-hover focus-visible:outline-none"
          >
            <span
              aria-hidden="true"
              style={{ width: SWATCH_PX, height: SWATCH_PX, backgroundColor: one.fill }}
              className={current ? "block outline outline-2 outline-offset-1 outline-heading" : "block border border-border-strong"}
            />
          </button>
        );
      })}
    </div>
  );
}

// ── The strip ─────────────────────────────────────────────────────────────

export interface StripPlace {
  left: number;
  top: number;
  /** The widest the strip may be; its content wraps to a second row rather than pass it. */
  maxWidth: number;
}

/** Where the strip stands: at the mark's top, kept inside the window; as wide as the margin, but never narrower than its six colours. Pure. */
export function stripPlace(input: { top: number; left: number; width: number; viewportHeight: number }): StripPlace {
  const lowest = Math.max(STRIP_EDGE_PX, input.viewportHeight - STRIP_RESERVE_PX - STRIP_EDGE_PX);
  return {
    left: input.left,
    top: Math.min(Math.max(input.top, STRIP_EDGE_PX), lowest),
    maxWidth: Math.max(STRIP_MIN_WIDTH_PX, input.width),
  };
}

export function HighlightStripView({
  colour,
  place,
  onPick,
  onRemove,
  innerRef,
  blockId,
}: {
  colour: HighlightColourId;
  place: StripPlace;
  onPick: (colour: HighlightColourId) => void;
  onRemove: () => void;
  innerRef?: (el: HTMLDivElement | null) => void;
  blockId?: string;
}) {
  return (
    <div
      ref={innerRef}
      role="toolbar"
      aria-label="Highlight"
      data-highlight-strip=""
      data-highlight-id={blockId}
      style={{ left: place.left, top: place.top, maxWidth: place.maxWidth, width: "max-content" }}
      className="fixed z-[70] flex flex-wrap items-center gap-x-1 border border-border-strong bg-surface p-1 font-mono text-caption shadow-card-hover"
    >
      <HighlightSwatches value={colour} onPick={onPick} />
      <button
        type="button"
        data-highlight-remove=""
        aria-label="Remove highlight"
        onMouseDown={keep}
        onClick={onRemove}
        style={{ height: SWATCH_HIT_PX }}
        className="cursor-pointer px-2 text-text-muted transition-colors hover:bg-surface-hover hover:text-heading focus-visible:bg-surface-hover focus-visible:outline-none"
      >
        Remove
      </button>
    </div>
  );
}

/** Recolour the highlight, from the strip. The strip stays up: the reader may try another. */
export function pickHighlightColour(noteId: string, blockId: string, colour: HighlightColourId): void {
  useNotesStore.getState().setHighlightColour(noteId, blockId, colour);
}

/** Remove the highlight, from the strip; the strip goes with it. */
export function removeStripHighlight(noteId: string, blockId: string): void {
  useNotesStore.getState().removeHighlight(noteId, blockId);
  useHighlightStrip.getState().hide();
}

// ── What closes it ────────────────────────────────────────────────────────

type Listening = Pick<Document, "addEventListener" | "removeEventListener">;

/**
 * The three things that close the strip, and nothing else (never a timer): Escape; a press anywhere but on the strip (seen in the
 * capture phase, so it comes before the click that may raise another strip from a mark); and the next selection (a
 * `selectionchange` that leaves words selected — the one the Highlight button itself makes clears the selection first, so it is
 * not one). Returns the function that removes the listeners.
 */
export function watchStripClose(
  doc: Listening,
  rules: { inside: (target: EventTarget | null) => boolean; hide: () => void; selected: () => boolean },
): () => void {
  const onKey = (event: KeyboardEvent) => {
    if (event.key === "Escape") rules.hide();
  };
  const onPress = (event: PointerEvent) => {
    if (!rules.inside(event.target)) rules.hide();
  };
  const onChange = () => {
    if (rules.selected()) rules.hide();
  };
  doc.addEventListener("keydown", onKey);
  doc.addEventListener("pointerdown", onPress, true);
  doc.addEventListener("selectionchange", onChange);
  return () => {
    doc.removeEventListener("keydown", onKey);
    doc.removeEventListener("pointerdown", onPress, true);
    doc.removeEventListener("selectionchange", onChange);
  };
}

/** Whether the page has words selected right now. */
function wordsSelected(): boolean {
  const selection = typeof window === "undefined" ? null : window.getSelection();
  return selection !== null && !selection.isCollapsed && selection.toString().trim() !== "";
}

/** Listen for what closes the strip while it stands; `ref` is the strip's own element. */
export function useStripClose(ref: { current: Pick<HTMLElement, "contains"> | null }, hide: () => void): void {
  useEffect(
    () =>
      watchStripClose(document, {
        inside: (target) => ref.current !== null && target !== null && ref.current.contains(target as Node),
        hide,
        selected: wordsSelected,
      }),
    [ref, hide],
  );
}

/** The highlight's colour in the paper's note, read live; null when the note or the highlight is gone. */
function useHighlightColour(noteId: string, blockId: string): HighlightColourId | null {
  const read = () => readHighlight(useNotesStore.getState().notes[noteId]?.blocks.find((b) => b.id === blockId))?.colour ?? null;
  return useSyncExternalStore(useNotesStore.subscribe, read, read);
}

/**
 * The strip for one highlight, in the margin: `top` is the mark's first line in the window's pixels, `left` and `width` the margin's
 * (it wraps to two rows when `width` is narrow). Mounted by the margin while `useHighlightStrip` names a highlight. It hides itself
 * when its highlight is gone (removed from the notes window, say).
 */
export function HighlightStrip({
  noteId,
  blockId,
  top,
  left,
  width,
}: {
  noteId: string;
  blockId: string;
  top: number;
  left: number;
  width: number;
}) {
  const colour = useHighlightColour(noteId, blockId);
  const el = useRef<HTMLDivElement | null>(null);
  const hide = useHighlightStrip.getState().hide;
  useStripClose(el, hide);
  useEffect(() => {
    if (colour === null) hide();
  }, [colour, hide]);
  if (colour === null) return null;
  const viewportHeight = typeof window === "undefined" ? 800 : window.innerHeight;
  return (
    <HighlightStripView
      colour={colour}
      blockId={blockId}
      place={stripPlace({ top, left, width, viewportHeight })}
      onPick={(next) => pickHighlightColour(noteId, blockId, next)}
      onRemove={() => removeStripHighlight(noteId, blockId)}
      innerRef={(node) => {
        el.current = node;
      }}
    />
  );
}
