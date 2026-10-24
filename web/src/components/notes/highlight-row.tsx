"use client";

// P11-08 (owner item 8; B P11-04 §2.4; rulings §1h.111 (d), §1h.112): the highlight's row in the paper's note. "This highlight record is kept
// as a note in the paper's overall note" — a highlight is a block of its own (`type: "highlight"`, its words and place in `highlight`), and
// the notes window and /notes/<id> both draw the paper's note with the one `NoteEditor`, which draws this row beside its divider and paper
// card rows. So one component serves both.
//
// Left to right: a 14-px square in the highlight's colour that goes to the passage and flashes it (the sticky heading's blue square, for a
// highlight); the words, on their colour, two lines at most and an ellipsis where they are cut; a colour button named for the colour that
// opens the six swatches (P11-07's `HighlightSwatches`, the strip's own) under the row; and a ×. A passage the paper on show no longer holds
// has the quiet line P10-35 wrote for a lost sticky and no square to go to it. The block menu offers Delete only: a highlight has no words to
// turn into a heading or a list, and a copy of it would be a second mark over the same words.
//
// Three parts: `HighlightRowView` (the markup, no state — what the tests read), `HighlightRow` (connected: whether the passage is lost, whether
// the swatches are open, the router for the notes page's go-to) and the pure helpers the editor uses (`withHighlightColour`, `blockAccepts`).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent, Ref } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import { highlightQuote, highlightSegments, readHighlight } from "@/lib/notes/blocks";
import { highlightColour, highlightPaint, isHighlightColour } from "@/lib/notes/highlight-colours";
import type { Block, BlockType, HighlightColourId, HighlightSpot } from "@/lib/notes/types";
import { useLostPassages } from "@/store/notes";
import { HighlightSwatches } from "./highlight-strip";
import { PASSAGE_LOST_LINE, goToPassage, passageIsLost, storedBodyOf, type HighlightGoal } from "./note-tags";

/** The most lines of its words the row shows (the `line-clamp-2` below); the rest is cut with an ellipsis. The whole passage stays in the page, and in the tooltip. */
export const WORDS_LINES = 2;

// ── Going to the passage ──────────────────────────────────────────────────

/** The place `goToPassage` takes a highlight to: its paper, its paragraph, and its block id (the paper's marks are found by it). */
export function highlightGoal(id: string, spot: Pick<HighlightSpot, "paperId" | "paragraphId">): HighlightGoal {
  return { paperId: spot.paperId, paragraphId: spot.paragraphId, highlightId: id };
}

/** Scroll the paper to the highlight and flash its marks; from the notes page, go to the paper's page at the paragraph. */
export function goToHighlight(id: string, spot: Pick<HighlightSpot, "paperId" | "paragraphId">, env: Parameters<typeof goToPassage>[1]): void {
  goToPassage(highlightGoal(id, spot), env);
}

/**
 * Whether the paper on show no longer holds a highlight's words: the reading page told the store so (`lost`, by the block's id), or the
 * paper body the reader last had (`body`, for the notes page, which has no paper on show) holds them nowhere. The same search the paper's
 * body makes for a sticky's passage; a body that is not known never calls a highlight lost.
 */
export function highlightIsLost(
  id: string,
  spot: Pick<HighlightSpot, "paperId" | "paragraphId" | "quote" | "start" | "end">,
  lost: Readonly<Record<string, true>>,
  body: Parameters<typeof passageIsLost>[3],
): boolean {
  const { paperId, paragraphId, quote, start, end } = spot;
  return passageIsLost({ paperId, paragraphId, quote, n: 0, start, end }, id, lost, body);
}

const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/** `highlightIsLost` for a row: told by the reading page, or found in the stored body; never on the server's render or the first one. */
function useHighlightLost(id: string, spot: HighlightSpot | null): boolean {
  const told = useLostPassages((s) => s.lost[id] === true);
  return useSyncExternalStore(
    subscribeToStorage,
    () => told || (spot !== null && highlightSegments(spot).some((segment) => highlightIsLost(id, { ...segment, paperId: spot.paperId }, {}, storedBodyOf(spot.paperId)))),
    () => false,
  );
}

// ── What the editor asks of a highlight ───────────────────────────────────

/**
 * The editor's blocks with one highlight in a new colour, and nothing else changed (every other block is the same object); the same array
 * when there is nothing to do: not a highlight, no readable one, an unknown colour, or the colour it already has. A stored colour the table
 * does not know reads as Yellow, and choosing Yellow writes it down. The same rule as the store's `setHighlightColour`.
 */
export function withHighlightColour(blocks: Block[], id: string, colour: HighlightColourId): Block[] {
  if (!isHighlightColour(colour)) return blocks;
  let touched = false;
  const next = blocks.map((b) => {
    const spot = b.id === id ? readHighlight(b) : null;
    if (!spot || b.highlight?.colour === colour) return b;
    touched = true;
    return { ...b, highlight: { ...spot, colour } };
  });
  return touched ? next : blocks;
}

/**
 * Whether the block menu (and so `blockAction`) takes an action on a block of this type. A highlight takes Delete and nothing else — not
 * Move, not Duplicate (a second mark over the same words), not a turn into a heading or a list (it has no words to turn); every other
 * block takes them all.
 */
export function blockAccepts(type: BlockType, action: string): boolean {
  return type !== "highlight" || action === "delete";
}

// ── What closes the swatches ──────────────────────────────────────────────

/**
 * The swatches open under the row, in its flow, so closing them moves every row below up. A press on another row's button (its square,
 * its ×) must still be a click on it: closed on `pointerdown`, the row would move away between the press and the release, and the click
 * would land on nothing. So it closes on the `click` itself, seen in the capture phase — the page's layout has not moved yet when the
 * click that is on its way to a button below is dispatched, and the button gets it. Returns the function that removes the listener.
 */
export function watchOutsideClick(
  doc: Pick<Document, "addEventListener" | "removeEventListener">,
  rules: { inside: (target: EventTarget | null) => boolean; close: () => void },
): () => void {
  const onClick = (event: Event) => {
    if (!rules.inside(event.target)) rules.close();
  };
  doc.addEventListener("click", onClick, true);
  return () => doc.removeEventListener("click", onClick, true);
}

// ── The row ───────────────────────────────────────────────────────────────

/** A press on one of the row's buttons must not move the page's selection or the editor's focus: they are used as a pen is. */
const keep = (event: { preventDefault: () => void }) => event.preventDefault();

export interface HighlightRowViewProps {
  /** The highlight's block id. */
  id: string;
  /** Its words and colour, or null for a block that holds no readable highlight (stored data is read with care, B P11-04 I8). */
  spot: Pick<HighlightSpot, "quote" | "colour"> | null;
  /** The paper no longer holds its words. */
  lost: boolean;
  /** The six swatches are open under the row. */
  open: boolean;
  onGo: () => void;
  onToggle: () => void;
  onPick: (colour: HighlightColourId) => void;
  onRemove: () => void;
  rootRef?: Ref<HTMLDivElement>;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
}

export function HighlightRowView({ id, spot, lost, open, onGo, onToggle, onPick, onRemove, rootRef, onKeyDown }: HighlightRowViewProps) {
  const named = spot ? highlightColour(spot.colour) : null;
  const paint = spot ? highlightPaint(spot.colour, 0) : null;
  return (
    <div ref={rootRef} data-highlight-row={id} onKeyDown={onKeyDown} className="min-w-0">
      <div className="flex items-start gap-2 font-reading text-body-sm leading-[1.5]">
        {spot && named && !lost ? (
          <button
            type="button"
            aria-label="Go to the passage"
            title="Go to the passage"
            onMouseDown={keep}
            onClick={onGo}
            style={{ width: "1em", height: "1em", marginTop: "calc(0.25em + 2px)", fontSize: "inherit", backgroundColor: named.fill }}
            className="shrink-0 border border-border-strong p-0 opacity-90 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heading"
          />
        ) : (
          // A passage that is gone has no square to go to it; this holds its place so the rows keep their line (P10-36).
          <span aria-hidden style={{ width: "1em", height: "1em", marginTop: "calc(0.25em + 2px)" }} className="inline-block shrink-0 bg-text-faint opacity-60" />
        )}
        <div className="min-w-0 flex-1">
          {spot && paint ? (
            <p title={spot.quote} className="line-clamp-2 break-words py-[2px] font-reading text-body-sm leading-[1.5]">
              <span data-highlight-words="" style={{ backgroundColor: paint.bg, color: paint.ink }} className="box-decoration-clone px-0.5">
                {spot.quote}
              </span>
            </p>
          ) : (
            <p className="py-[2px] font-reading text-body-sm italic leading-[1.5] text-text-faint">This highlight has no words.</p>
          )}
          {spot && lost && <p className="font-reading text-meta italic leading-tight text-text-faint">{PASSAGE_LOST_LINE}</p>}
        </div>
        {spot && named && (
          <button
            type="button"
            data-highlight-colour-button=""
            aria-label={named.name}
            aria-expanded={open}
            title={`${named.name} — change the colour`}
            onMouseDown={keep}
            onClick={onToggle}
            className="flex h-6 shrink-0 items-center gap-1 px-1.5 font-mono text-caption text-text-muted transition-colors hover:bg-bg-secondary hover:text-heading focus-visible:bg-bg-secondary focus-visible:outline-none"
          >
            <span>{named.name}</span>
            <span aria-hidden>▾</span>
          </button>
        )}
        <button
          type="button"
          aria-label="Remove highlight"
          title="Remove highlight"
          onMouseDown={keep}
          onClick={onRemove}
          className="grid h-6 w-6 shrink-0 place-items-center text-body text-text-muted transition-colors hover:bg-bg-secondary hover:text-heading focus-visible:bg-bg-secondary focus-visible:outline-none"
        >
          ×
        </button>
      </div>
      {open && spot && (
        // Under the words (a square and its gap in): in the row's flow, so the window's scroll never clips it.
        <div className="mt-1 pl-[22px]">
          <HighlightSwatches value={spot.colour} onPick={onPick} />
        </div>
      )}
    </div>
  );
}

/**
 * The highlight's row for a block of the paper's note. `onColour` and `onRemove` act on the editor's own copy of the note (it saves them
 * with the rest, half a second on), so the row never writes under the editor.
 */
export function HighlightRow({ block, onColour, onRemove }: { block: Block; onColour: (colour: HighlightColourId) => void; onRemove: () => void }) {
  const router = useRouter();
  const spot = readHighlight(block);
  const lost = useHighlightLost(block.id, spot);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);

  // The swatches close on a click anywhere but on the row (the colour button and the swatches are inside it).
  useEffect(() => {
    if (!open) return;
    return watchOutsideClick(document, { inside: (target) => root.current !== null && target !== null && root.current.contains(target as Node), close: () => setOpen(false) });
  }, [open]);

  // Opened, the current colour has the keyboard (the swatches are a radio group: arrows move the choice).
  useEffect(() => {
    if (open) root.current?.querySelector<HTMLElement>("[data-highlight-colour][data-current]")?.focus({ preventScroll: true });
  }, [open]);

  return (
    <HighlightRowView
      id={block.id}
      spot={spot ? { quote: highlightQuote(spot), colour: spot.colour } : null}
      lost={lost}
      open={open && spot !== null}
      onGo={() => {
        if (spot) goToHighlight(block.id, spot, { doc: document, navigate: (href) => router.push(href as Route) });
      }}
      onToggle={() => setOpen((was) => !was)}
      onPick={onColour}
      onRemove={onRemove}
      rootRef={root}
      onKeyDown={(event) => {
        // Escape closes the swatches first, not the notes window around them.
        if (event.key !== "Escape" || !open) return;
        event.preventDefault();
        event.stopPropagation();
        setOpen(false);
        root.current?.querySelector<HTMLElement>("[data-highlight-colour-button]")?.focus({ preventScroll: true });
      }}
    />
  );
}
