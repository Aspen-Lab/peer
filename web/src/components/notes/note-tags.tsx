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
import { useSyncExternalStore } from "react";
import { stickyTitle } from "@/lib/notes/blocks";
import type { NoteAnchor } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";
import { readingNoteFor, resolveAnchors, useLostPassages, useNotesStore } from "@/store/notes";

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

/**
 * A paragraph's text as runs: plain `text`, a `mark` (its tag follows it) and a `tag` alone (no words to mark). P10-20:
 * a mark holds its words as `inner` runs — plain text and the marks of notes taken inside it — and `depth` counts
 * how many marks stand around it (0 the outer; the drawing shades 1 and deeper alike).
 */
export type PassageSegment =
  | { kind: "text"; from: number; to: number }
  | { kind: "mark"; from: number; to: number; spot: AnchorSpot; inner: PassageSegment[]; depth: number }
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
  if (!held.startsWith(quote)) return null;
  // P10-20: a mark ends at its last word. The white space the selection ran on over (a double-click, a drag) stays a
  // plain run after the tag: the browser may break a line after a space even before a word joiner, which left the tag
  // alone at the start of the next line.
  const last = start + text.slice(start, end).trimEnd().length;
  return last > start ? { start, end: last } : null;
}

/**
 * P10-09f (rule 2), P10-20: cut a paragraph's text for the highlighter. Each note whose range the text still holds
 * marks its own words, in the order they stand; a note whose words lie wholly inside another's is drawn as its own
 * mark inside that one (`inner`; equal ranges: the earlier note is the outer); a later note that only overlaps an
 * earlier one starts its mark where the earlier ends (the pair never cross); a note with no range, or one the text no
 * longer holds, has its tag at the paragraph's end. The text is never changed: the runs and marks, in order, are
 * exactly the paragraph.
 */
export function passageSegments(text: string, spots: readonly AnchorSpot[]): PassageSegment[] {
  const pool: { spot: AnchorSpot; start: number; end: number }[] = [];
  const loose: AnchorSpot[] = [];
  for (const spot of spots) {
    const range = rangeOf(text, spot);
    if (range) pool.push({ spot, ...range });
    else loose.push(spot);
  }
  // Outer before inner: by start, then the longer first, then the earlier note.
  pool.sort((a, b) => a.start - b.start || b.end - a.end || a.spot.n - b.spot.n);
  // The runs of [lo, hi): the pool's ranges that end by `hi`, taken in order, each cutting its own inside the same way.
  const cut = (lo: number, hi: number, depth: number): PassageSegment[] => {
    const out: PassageSegment[] = [];
    let at = lo;
    for (let i = pool.findIndex((one) => one.end <= hi); i >= 0; i = pool.findIndex((one) => one.end <= hi)) {
      const [{ spot, start, end }] = pool.splice(i, 1);
      const from = Math.max(start, at);
      if (from >= end) {
        out.push({ kind: "tag", spot });
        continue;
      }
      if (from > at) out.push({ kind: "text", from: at, to: from });
      const inner = cut(from, end, depth + 1);
      out.push({ kind: "mark", from, to: end, spot, inner, depth });
      at = end;
    }
    if (at < hi || out.length === 0) out.push({ kind: "text", from: at, to: hi });
    return out;
  };
  const out = cut(0, text.length, 0);
  for (const spot of loose) out.push({ kind: "tag", spot });
  return out;
}

/** U+2060, which allows no line break on either side of it. */
const WORD_JOINER = "\u2060";

/** The reference tag after a passage: [N], opens sticky N. */
export function NoteTag({ n, id }: { n: number; id: string }) {
  return (
    <sup className="ml-0.5 select-none whitespace-nowrap align-super">
      {/* P10-20: a word joiner before the tag — no line break between the last marked word and the tag, so a line never opens with "[2]". */}
      {WORD_JOINER}
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

// ── A note whose passage is gone (P10-36) ─────────────────────────────────

/** P10-35's quiet line, said beside a lost note's heading and in its sticky window. */
export const PASSAGE_LOST_LINE = "This passage is not in this version of the paper.";

type Body = readonly { readonly paragraphs: readonly string[] }[];

/** The key of the reading the reading page keeps in this browser (`use-reading.ts`); an entry's key starts with the paper's id. */
const READING_CACHE_KEY = "peer-reading-v2";

let parsedFrom: string | null = null;
let parsed: Record<string, { ts?: unknown; reading?: { body?: unknown } } | undefined> = {};
/** The cache is parsed once per change of its text, not once per heading per render. */
function cachedReadings(raw: string | null) {
  if (raw !== parsedFrom) {
    parsedFrom = raw;
    try {
      const value: unknown = raw ? JSON.parse(raw) : {};
      parsed = value && typeof value === "object" ? (value as typeof parsed) : {};
    } catch {
      parsed = {};
    }
  }
  return parsed;
}

/**
 * The body of the newest reading kept in this browser for a paper (null when there is none, it is unreadable, or its body is
 * not sections of paragraph strings). The notes page has no paper on show, so it asks what the reader last had.
 */
export function storedBodyOf(paperId: string, storage?: Pick<Storage, "getItem">): Body | null {
  try {
    const store = storage ?? (typeof window === "undefined" ? undefined : window.localStorage);
    if (!store) return null;
    let best: { ts: number; body: Body } | null = null;
    for (const [key, entry] of Object.entries(cachedReadings(store.getItem(READING_CACHE_KEY)))) {
      if (!key.startsWith(`${paperId}|`)) continue;
      const body = entry?.reading?.body;
      const sound = Array.isArray(body) && body.every((one) => Array.isArray(one?.paragraphs) && one.paragraphs.every((p: unknown) => typeof p === "string"));
      if (!sound) continue;
      const ts = typeof entry?.ts === "number" ? entry.ts : 0;
      if (!best || ts > best.ts) best = { ts, body: body as Body };
    }
    return best?.body ?? null;
  } catch {
    return null;
  }
}

/**
 * Whether a sticky's passage is found nowhere in the paper: the reading page told the store so (`lost`, by the sticky's
 * heading id), or the body the reader last had does not hold its words (`body`, for the notes page, which has no paper on
 * show). The same search the paper's body makes (`resolveAnchors`). A note with no range has nothing to check.
 */
export function passageIsLost(anchor: NoteAnchor, id: string, lost: Readonly<Record<string, true>>, body: Body | null): boolean {
  if (lost[id] === true) return true;
  if (!body || anchor.start === undefined || anchor.end === undefined) return false;
  const { start, end, quote, n, paragraphId } = anchor;
  return resolveAnchors(body, { [paragraphId]: [{ id, n, start, end, quote }] }).lost.length > 0;
}

/**
 * What stands at a note heading's left: the blue square that goes to the passage — or, when the passage is lost, a quiet
 * square that goes nowhere and the line saying so, beside the heading (at the row's right edge, over no text of its own).
 * `onOpen`, where there is a sticky to open (the reading page), opens the note in place.
 */
export function AnchorMarker({ lost, n, onGo, onOpen }: { lost: boolean; n: number; onGo: () => void; onOpen?: () => void }) {
  if (!lost) return <AnchorSquare onClick={onGo} />;
  const square = { width: SQUARE_PX, height: SQUARE_PX };
  return (
    <>
      {onOpen ? (
        <button
          type="button"
          aria-label={`Open note ${n}`}
          title={PASSAGE_LOST_LINE}
          onMouseDown={(event) => event.preventDefault()}
          onClick={onOpen}
          style={square}
          className="inline-block shrink-0 border-0 bg-text-faint p-0 align-middle opacity-60"
        />
      ) : (
        <span aria-hidden style={square} className="inline-block shrink-0 bg-text-faint align-middle opacity-60" />
      )}
      <span className="pointer-events-none absolute right-0 top-1/2 max-w-[60%] -translate-y-1/2 text-right font-reading text-meta italic leading-tight text-text-faint">
        {PASSAGE_LOST_LINE}
      </span>
    </>
  );
}

const subscribeToStorage = (onChange: () => void) => {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
};

/** The blue square wired to `goToPassage` — for the note editor's heading, which has no page of its own to ask. A note whose passage is lost has no square to go to it (P10-36). */
export function AnchorLink({ anchor }: { anchor: NoteAnchor }) {
  const router = useRouter();
  // The sticky's heading id: the note editor passes the anchor alone, and the store tells the ids apart by it.
  const id = useNotesStore((s) =>
    readingNoteFor(s.notes, anchor.paperId)?.blocks.find((b) => b.type === "h3" && b.anchor?.paperId === anchor.paperId && b.anchor.n === anchor.n)?.id,
  );
  const told = useLostPassages((s) => (id !== undefined && s.lost[id] === true));
  const lost = useSyncExternalStore(
    subscribeToStorage,
    () => told || (id !== undefined && passageIsLost(anchor, id, {}, storedBodyOf(anchor.paperId))),
    () => false,
  );
  return (
    <AnchorMarker
      lost={lost}
      n={anchor.n}
      onGo={() => goToPassage(anchor, { doc: document, navigate: (href) => router.push(href as Route) })}
      onOpen={id !== undefined && host?.paperId === anchor.paperId ? () => useWindows.getState().open({ id, kind: "sticky", title: stickyTitle(anchor.n) }) : undefined}
    />
  );
}
