"use client";

// P10-09a (the owner's review 7.1c; rubric B11; ruling §1h.78): the tie between a sticky note and the passage it was
// taken on, in both directions.
//
//   The tag — a small superscript [N] after the passage, like a citation mark, in the label face. Pressing it
//   opens that sticky. It is not selectable (`select-none`): the words of the passage stay the paper's.
//
//   P10-09f (review 7.1c; walk X-B3): the words themselves stay marked. The paragraph draws the anchored range in a
//   `<mark data-note="N">` (the highlighter token) with the tag right after the marked words, not at the paragraph's
//   end — `passageSegments` cuts the paragraph's text into plain runs and marked ranges for that; a range the text no
//   longer holds draws no mark and its tag stands at the paragraph's end. The square then flashes the mark.
//
//   The blue square — at the left of the sticky's text, and of the note's "Note N" heading, a small blue square
//   that scrolls the paper back to the passage, and marks it for a moment. On the reading page that is a scroll
//   (the reading page registers itself as the host, so the paper's text is brought on if the other tab is on show);
//   anywhere else — the notes page — it goes to the paper's page at the paragraph (`#paper-section-1-p2`).

import { useRouter } from "next/navigation";
import type { Route } from "next";
import { stickyTitle } from "@/lib/notes/blocks";
import type { NoteAnchor } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";

/** How long the passage stays marked after the square scrolls to it. */
export const FLASH_MS = 1500;
/** The square's side: at least 12 px. */
export const SQUARE_PX = 14;
/** The blue of the square: one blue that reads on the light and the dark page. */
export const SQUARE_BLUE = "#3b82f6";

const FLASH_CLASSES = ["bg-accent-dim", "outline", "outline-2", "outline-offset-4", "outline-accent", "transition-colors"];
/** The flash on the marked words: the mark keeps its highlighter ground and gains an outline. */
const MARK_FLASH_CLASSES = ["outline", "outline-2", "outline-offset-2", "outline-accent", "transition-colors"];

// ── The marked words in the paragraph ─────────────────────────────────────

/** A sticky's place in its paragraph: the anchor map's entry (`start` / `end` / `quote` only when the anchor has a range). */
export interface AnchorSpot {
  id: string;
  n: number;
  start?: number;
  end?: number;
  quote?: string;
}

/** A paragraph's text as runs: plain `text`, a `mark` (its tag follows it), and a `tag` alone (no words to mark). */
export type PassageSegment =
  | { kind: "text"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; spot: AnchorSpot }
  | { kind: "tag"; spot: AnchorSpot };

/** Whether position `at` lies inside a formula (`⟦…⟧`) of the text: a mark must never cut one. */
function insideFormula(text: string, at: number): boolean {
  if (at <= 0) return false;
  const open = text.lastIndexOf(MATH_OPEN, at - 1);
  return open > text.lastIndexOf(MATH_CLOSE, at - 1) && text.indexOf(MATH_CLOSE, at) >= 0;
}

/** The range of a note the text still holds: in the text, not empty, whole formulas, and the words the anchor was taken on. */
function rangeOf(text: string, spot: AnchorSpot): { start: number; end: number } | null {
  const { start, end, quote } = spot;
  if (start === undefined || end === undefined || quote === undefined) return null;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > text.length) return null;
  if (insideFormula(text, start) || insideFormula(text, end)) return null;
  const held = text.slice(start, end).replace(/\s+/g, " ").trim();
  return held.startsWith(quote) ? { start, end } : null;
}

/**
 * P10-09f (rule 2): cut a paragraph's text for the highlighter. Each note whose range the text still holds marks its
 * own words, in the order they stand; a later, overlapping note's mark starts where the earlier one ends (no
 * nesting); a note whose words lie wholly inside earlier marks keeps its tag only, after that mark; a note with no
 * range, or one the text no longer holds, has its tag at the paragraph's end. The text is never changed: the runs
 * and marks, in order, are exactly the paragraph.
 */
export function passageSegments(text: string, spots: readonly AnchorSpot[]): PassageSegment[] {
  const ranged: { spot: AnchorSpot; start: number; end: number }[] = [];
  const loose: AnchorSpot[] = [];
  for (const spot of spots) {
    const range = rangeOf(text, spot);
    if (range) ranged.push({ spot, ...range });
    else loose.push(spot);
  }
  ranged.sort((a, b) => a.start - b.start || a.spot.n - b.spot.n);
  const out: PassageSegment[] = [];
  let at = 0;
  for (const { spot, start, end } of ranged) {
    const from = Math.max(start, at);
    if (from >= end) {
      out.push({ kind: "tag", spot });
      continue;
    }
    if (from > at) out.push({ kind: "text", from: at, to: from });
    out.push({ kind: "mark", from, to: end, spot });
    at = end;
  }
  if (at < text.length || out.length === 0) out.push({ kind: "text", from: at, to: text.length });
  for (const spot of loose) out.push({ kind: "tag", spot });
  return out;
}

/** The reference tag after a passage: [N], opens sticky N. */
export function NoteTag({ n, id }: { n: number; id: string }) {
  return (
    <sup className="ml-0.5 select-none align-super">
      <button
        type="button"
        aria-label={`Open note ${n}`}
        onClick={() => useWindows.getState().open({ id, kind: "sticky", title: stickyTitle(n) })}
        className="select-none px-px font-mono text-meta leading-none text-text-muted underline-offset-2 hover:text-heading hover:underline"
      >
        {`[${n}]`}
      </button>
    </sup>
  );
}

/** The small blue square, as a button; what it does is the caller's. */
export function AnchorSquare({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      aria-label="Go to the passage"
      title="Go to the passage"
      onMouseDown={(event) => event.preventDefault()}
      onClick={onClick}
      style={{ width: SQUARE_PX, height: SQUARE_PX, backgroundColor: SQUARE_BLUE }}
      className="inline-block shrink-0 border-0 p-0 align-middle opacity-90 transition-opacity hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-heading"
    />
  );
}

// ── Going back to the passage ─────────────────────────────────────────────

/** The reading page, while it is mounted: the paper it shows, and how to make sure its text is on show. */
export interface PassageHost {
  paperId: string;
  reveal: (run: () => void) => void;
}

let host: PassageHost | null = null;

/** The reading page registers itself; the returned function takes it off again (identity-guarded). */
export function registerPassageHost(next: PassageHost): () => void {
  host = next;
  return () => {
    if (host === next) host = null;
  };
}

function flash(el: Element, classes: readonly string[] = FLASH_CLASSES): void {
  el.classList.add(...classes);
  setTimeout(() => el.classList.remove(...classes), FLASH_MS);
}

/**
 * Scroll the paper to the sticky's passage and mark it for `FLASH_MS`; when the paper is not on this page, go to
 * its page at the paragraph. The reading page of that paper (registered) first brings the paper's text on show.
 */
export function goToPassage(
  anchor: NoteAnchor,
  env: { doc: Pick<Document, "getElementById">; navigate: (href: string) => void },
): void {
  const run = (): boolean => {
    const el = env.doc.getElementById(anchor.paragraphId);
    if (!el) return false;
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    // P10-09f (rule 3): the paragraph is scrolled to as before; the flash lands on the marked words when the paragraph
    // draws a mark for this note, else on the whole paragraph.
    const mark = anchor.start !== undefined ? el.querySelector(`mark[data-note="${anchor.n}"]`) : null;
    if (mark) flash(mark, MARK_FLASH_CLASSES);
    else flash(el);
    return true;
  };
  if (host && host.paperId === anchor.paperId) {
    host.reveal(() => {
      run();
    });
    return;
  }
  if (!run()) env.navigate(`/papers/${anchor.paperId}#${anchor.paragraphId}`);
}

/** The blue square wired to `goToPassage` — for the note editor's heading, which has no page of its own to ask. */
export function AnchorLink({ anchor }: { anchor: NoteAnchor }) {
  const router = useRouter();
  return <AnchorSquare onClick={() => goToPassage(anchor, { doc: document, navigate: (href) => router.push(href as Route) })} />;
}
