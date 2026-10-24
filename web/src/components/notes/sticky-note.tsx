"use client";

// P10-09a (the owner's review 7.1; rubric B7, B8, B10; ruling §1h.78): sticky notes. "Take notes" on a selection
// opens a small numbered window at the right, in the margin, and the reader writes in it at once. P11-14 (B P11-03 §3.2): it is a
// card of the margin's stack — `MarginCard` is its frame (the margin's left and width, the 40 px header with its title, quote head and X);
// the first one opens level with its selection and later cards cascade from there (R-open).
// It imitates a sticky note: it floats while the page scrolls, it can be closed, and what is written in it is
// saved as it is written — through into the paper's own note (`store/notes.ts`: `addSticky`, `setStickyText`),
// as the "Note N" heading carrying the passage's anchor and the reader's paragraphs under it. Closing hides the
// window and loses nothing — except a sticky that was never written in, which leaves nothing behind (P10-09c); a reload
// shows the windows closed and the note unchanged. P10-09c: a sticky follows its blocks when the notes window edits them.
//
// `takeStickyNote` is what the toolbar's "Take notes" does; `StickyNotes` renders the open stickies; the view
// (`StickyWindowView`) has no state, so it is tested as markup and as an element tree.

import { useCallback, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { block, quoteHead, stickyParagraphs, stickySpan, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { citableFromPaper } from "@/lib/notes/cite";
import type { ReadingNoteExtras } from "@/lib/notes/templates";
import type { Citable, NoteAnchor } from "@/lib/notes/types";
import { paragraphAnchor, type ExplainSelection } from "@/components/reader/paper-body";
import { isFrontCard, useFrontEscape } from "@/components/reader/front-escape";
import { ReaderToast, useReaderToast } from "@/components/reader/reader-toast";
import { MarginCard } from "@/components/reader/margin-card";
import { hashTarget, summaryBlockFromHash } from "@/components/reader/use-reader-tab";
import { stackRows, useColumn, useWindows, type FloatingWindow, type StackFrame } from "@/lib/reader/windows";
import { readingNoteFor, stripTagText, useLostPassages, useNotesStore, withoutSticky } from "@/store/notes";

export { withoutSticky };
import { ANSWERS_BLOCK_ID, AnchorSquare, PASSAGE_LOST_LINE, goToPassage, registerPassageHost } from "./note-tags";
import { WysiwygField } from "./wysiwyg-field";
import { NoteEditor } from "./note-editor";

/** A sticky writes through into the paper's note no later than this long after the last keystroke. P10-09c: 150 ms, not 250 —
 *  measured in the dev server, last keystroke to the notes window showing it took 301-333 ms with 250 (the window starts its
 *  editor afresh on the change), and the brief's bound is 300 ms from the keystroke to the window. */
export const STICKY_SAVE_MS = 150;

export function StickyWindowView({
  n,
  quote,
  text,
  front,
  active = front,
  top,
  height,
  z,
  onText,
  onClose,
  onSave = onClose,
  onDelete = onClose,
  children,
  onRaise,
  onGo,
  lost = false,
}: {
  n: number;
  quote: string;
  text: string;
  /** In front and whole; else only its header shows. */
  front: boolean;
  active?: boolean;
  top: number;
  height: number;
  z: number;
  onText: (text: string) => void;
  onClose: () => void;
  onSave?: () => void;
  onDelete?: () => void;
  children?: ReactNode;
  onRaise: () => void;
  onGo: () => void;
  /** P10-35: the paper on show does not hold the passage this note was taken on: no square to go to it, one quiet line says so. */
  lost?: boolean;
}) {
  return (
    <MarginCard
      id={`sticky-${n}`}
      kind="sticky"
      role="group"
      aria-label={stickyTitle(n)}
      data-sticky={n}
      onKeyDown={(event) => {
        // Only the front card answers (P11-17c rule 1): one with only its header showing, behind another, lets the key go on to the document,
        // where the front card takes it.
        if (event.key !== "Escape" || !active) return;
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }}
      front={front}
      top={top}
      height={height}
      z={z}
      title={stickyTitle(n)}
      headline={`“${quoteHead(stripTagText(quote))}”`}
      closeAt="end"
      closeLabel={`Close note ${n}`}
      closeTitle="Close — the note stays in your notes"
      onRaise={onRaise}
      onClose={onClose}
      headerAttrs={{ "data-sticky-header": "" }}
      header={<div className="flex min-h-10 shrink-0 items-stretch border-b border-border-strong">
        <button type="button" data-margin-header="" data-sticky-header="" onClick={onRaise}
          className="flex min-w-0 flex-1 flex-col justify-center px-2 py-1 text-left hover:bg-surface-hover">
          <span className="eyebrow text-heading">{stickyTitle(n)}</span>
          <span className="truncate font-reading text-body-sm italic text-text-muted">“{quoteHead(stripTagText(quote))}”</span>
        </button>
        <button type="button" aria-label={`Save note ${n}`} onClick={onSave}
          className="shrink-0 px-2 text-body-sm text-heading hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-heading">Save</button>
        <button type="button" aria-label={`Delete note ${n}`} onClick={onDelete}
          className="shrink-0 px-2 text-body-sm text-text-muted hover:bg-surface-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-heading">Delete</button>
      </div>}
    >
      <div className="flex min-h-0 flex-1 gap-2 border-t border-border-strong p-3">
        {!lost && !children && (
          <span className="mt-1 shrink-0">
            <AnchorSquare onClick={onGo} />
          </span>
        )}
        {children ?? <WysiwygField
          autoFocus
          value={text}
          ariaLabel={stickyTitle(n)}
          placeholder="Write here. It is saved in your notes."
          onChange={onText}
          className="min-h-0 flex-1 overflow-y-auto font-reading text-body-sm leading-[1.6] text-text"
        />}
      </div>
      {lost && <p className="shrink-0 px-3 pb-2 font-reading text-body-sm italic text-text-faint">{PASSAGE_LOST_LINE}</p>}
    </MarginCard>
  );
}

/**
 * A debounced write: `push` the latest text, it is written once `ms` after the last push; `flush` writes it now.
 * P10-29 (BACKLOG-71): a write carries the text the sticky last saw stored (`base`, set by `sync`), so the store can merge it
 * with words the notes window wrote into the same blocks meanwhile. `write` may return what the store holds after the write:
 * that is the next base (the sticky never merges its own words with themselves).
 */
export function makeStickyWriter(write: (text: string, base?: string) => string | void, ms = STICKY_SAVE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | null = null;
  let base: string | undefined;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending === null) return;
    const text = pending;
    pending = null;
    const stored = base === undefined ? write(text) : write(text, base);
    if (typeof stored === "string") base = stored;
  };
  return {
    push(text: string) {
      pending = text;
      clearTimeout(timer);
      timer = setTimeout(flush, ms);
    },
    flush,
    cancel() {
      clearTimeout(timer);
      timer = undefined;
      pending = null;
    },
    /** A keystroke is waiting to be written. */
    pending: () => pending !== null,
    /** The text the store held when the sticky last took it: what the next write is measured against. */
    sync(stored: string) {
      base = stored;
    },
  };
}

/**
 * P10-09c (rule 3): what a sticky's text area should show when its blocks in the paper's note are `stored`: the stored
 * text when it changed outside (the notes window edited the blocks) and the sticky holds no keystroke of its own that is not
 * yet written; null — keep what is there — otherwise. The store keeps paragraphs (no blank lines, no trailing spaces), so
 * the text area's own words are compared as paragraphs: what the sticky wrote itself is never "taken back".
 */
export function stickyFollowText({ local, stored, pending }: { local: string; stored: string; pending: boolean }): string | null {
  if (pending) return null;
  return stickyParagraphs(local).join("\n") === stored ? null : stored;
}

/** The writers of the stickies that stand open, by heading id: leaving the page writes what is typed in them first. */
const openWriters = new Map<string, Pick<ReturnType<typeof makeStickyWriter>, "flush">>();

/** A standing sticky's writer, registered while it stands; the returned function takes it out again. */
export function registerStickyWriter(headerId: string, writer: Pick<ReturnType<typeof makeStickyWriter>, "flush">): () => void {
  openWriters.set(headerId, writer);
  return () => {
    if (openWriters.get(headerId) === writer) openWriters.delete(headerId);
  };
}

/**
 * P10-29 (BACKLOG-71, rule 2): the reader leaves the page (a route change, a tab closed where `pagehide` fires) with stickies
 * open: what is typed and not yet written is written first, then each open sticky with no words is taken out of the paper's
 * note with its anchor — no tag for a note that says nothing. A sticky with any words stays; the numbers of the others do not move.
 */
export function removeEmptyStickies(paperId: string): void {
  const note = readingNoteFor(useNotesStore.getState().notes, paperId);
  if (!note) return;
  for (const w of useWindows.getState().windows) {
    if (w.kind !== "sticky") continue;
    openWriters.get(w.id)?.flush();
    useNotesStore.getState().removeEmptySticky(note.id, w.id);
  }
}

/** Closing a sticky: an empty one is taken out of the note; its window leaves the stack. The note keeps everything else. */
export function closeSticky(noteId: string, headerId: string): void {
  useNotesStore.getState().removeEmptySticky(noteId, headerId);
  useWindows.getState().close(headerId);
}

/**
 * P11-14 rule 2, defect (c) (B P11-03 §1.3): where a sticky's anchor points. A paper selection is at its paragraph
 * (`paper-section-1-p2`); a Summary or answer selection has no paragraph of the paper — its `sectionIndex` and `paragraphIndex` are −1,
 * and `paper-section--1-p-1` pointed nowhere — so it is anchored by the container's own `paragraphId` that the selection carries, else
 * by its source's name. Pure.
 */
export function stickyAnchorId(target: Pick<ExplainSelection, "sectionIndex" | "paragraphIndex"> & Partial<Pick<ExplainSelection, "passage" | "source" | "paragraphId">>): string {
  if (target.source === undefined || target.source === "paper") return paragraphAnchor(target.sectionIndex, target.paragraphIndex);
  return target.paragraphId || target.source;
}

/**
 * "Take notes" on a selection: the paper's note (made if it is not there, without navigating), the next numbered
 * sticky in it, anchored to the selection's paragraph (or, for a Summary or answer selection, its own block — `stickyAnchorId`),
 * and its window opened — level with the selection's first line when it is the first card of the margin (R-open).
 */
export function takeStickyNote(
  // P10-09f: `paragraphText` is the paragraph as the body renders it; with it the anchor records where the words stand.
  target: Pick<ExplainSelection, "sectionIndex" | "paragraphIndex" | "passage"> &
    Partial<Pick<ExplainSelection, "measure" | "bounds" | "source" | "paragraphId" | "segments" | "unavailableReason" | "selectionStillHolds">> & { paragraphText?: string },
  paper: Citable,
  extras?: ReadingNoteExtras,
): { id: string; n: number } | null {
  if (target.unavailableReason || (target.segments && target.measure && !target.measure())) return null;
  if (target.selectionStillHolds && !target.selectionStillHolds()) return null;
  const { ensureReadingNote, addSticky } = useNotesStore.getState();
  const noteId = ensureReadingNote(paper, extras);
  const made = addSticky(noteId, {
    paperId: paper.id,
    paragraphId: stickyAnchorId(target),
    // P10-24: the words, never a note tag's text.
    passage: stripTagText(target.passage),
    paragraphText: target.paragraphText,
    ...(target.segments ? { segments: target.segments.map((s) => ({ paragraphId: s.paragraphId, quote: s.quote, start: s.start, end: s.end, source: s.source, kind: s.kind })) } : {}),
  });
  if (!made) return null;
  // R-open: the first card of an empty margin opens level with the selection's first line, as the selection is now.
  const anchorTop = target.measure?.()?.bounds.top ?? target.bounds?.top;
  useWindows.getState().open({ id: made.id, kind: "sticky", title: stickyTitle(made.n), ...(anchorTop !== undefined ? { anchorTop } : {}) });
  return made;
}

/** The page's `takeNote` action. */
export function useTakeNote({
  paper,
  questions,
  forYourQuestions,
  body,
}: {
  paper: Paper;
  questions?: readonly string[];
  forYourQuestions?: readonly QuestionAnswers[];
  /** P10-09f: the paper's body as the page renders it; the paragraph the selection is in gives the anchor its range. */
  body?: readonly { paragraphs: readonly string[] }[];
}): (target: ExplainSelection) => void {
  return useCallback(
    (target: ExplainSelection) => {
      const paragraphText = body?.[target.sectionIndex]?.paragraphs[target.paragraphIndex];
      takeStickyNote({ ...target, paragraphText }, citableFromPaper(paper), { questions, forYourQuestions });
    },
    [paper, questions, forYourQuestions, body],
  );
}

// ── The open stickies ─────────────────────────────────────────────────────

interface Row {
  id: string;
  n: number;
  quote: string;
  anchor: NoteAnchor;
  front: boolean;
  top: number;
  height: number;
  z: number;
}

/** The paragraph a page's `#hash` names (the notes page's blue square arrives with one), or null. */
export function passageFromHash(hash: string): string | null {
  let id = hash.replace(/^#/, "");
  try {
    id = decodeURIComponent(id);
  } catch {
    return null;
  }
  return /^paper-section-\d+-p\d+$/.test(id) ? id : null;
}

/**
 * P11-20 (rule 1): the block a page's `#hash` names that is not a paragraph of the paper — a Summary block (`summary-proposal`) or the answers' block
 * (`answers-block`), which the notes page's blue square arrives with for a note taken there — or null.
 */
export function blockFromHash(hash: string): string | null {
  const summary = summaryBlockFromHash(hash);
  if (summary !== null) return summary;
  return hashTarget(hash) === ANSWERS_BLOCK_ID ? ANSWERS_BLOCK_ID : null;
}

/** The part of an image the arrival waits on: whether it has loaded or failed, and to be told when it does. */
export interface ArrivalImage {
  complete: boolean;
  addEventListener(type: "load" | "error", run: () => void): void;
  removeEventListener(type: "load" | "error", run: () => void): void;
}

/** The part of the page the arrival reads: the block by its id, and the images on the page. */
export interface ArrivalDoc {
  getElementById(id: string): HTMLElement | null;
  images?: ArrayLike<ArrivalImage>;
}

/** The window the arrival is landed again in: the animation frame, the scroll, and the reader's own moves of the page. */
export interface ArrivalEnv {
  /** Runs `run` at the next animation frame; returns how to cancel it. */
  frame(run: () => void): () => void;
  scrollY(): number;
  /** Told when the reader moves the page themselves (wheel, touch, a key, a press); returns how to stop being told. */
  onUserMove(told: () => void): () => void;
  /** P11-20 follow-up (rule 1b): told when nodes are added to or removed from the page, so an arrival lands as soon as its target is drawn instead of at
   *  the poll's next look; returns how to stop being told. Absent where there is no page to watch (a test, a server). */
  onTreeChange?(told: () => void): () => void;
}

export const browserArrival: ArrivalEnv = {
  frame: (run) => {
    const id = requestAnimationFrame(run);
    return () => cancelAnimationFrame(id);
  },
  scrollY: () => window.scrollY,
  onUserMove: (told) => {
    const events = ["wheel", "touchmove", "keydown", "mousedown"] as const;
    for (const type of events) window.addEventListener(type, told, { passive: true });
    return () => {
      for (const type of events) window.removeEventListener(type, told);
    };
  },
  onTreeChange: (told) => {
    if (typeof MutationObserver === "undefined") return () => {};
    const watching = new MutationObserver(told);
    watching.observe(document.documentElement, { childList: true, subtree: true });
    return () => watching.disconnect();
  },
};

/** A block lands this far below the top of the window (`scroll-mt-20`, 5rem), and is not landed again if it is within `LAND_SLACK_PX` of it. */
export const LAND_TOP_PX = 80;
export const LAND_SLACK_PX = 2;
/** The one extra landing comes no later than this long after the first scroll, settled or not. */
export const RELAND_WITHIN_MS = 2000;

/**
 * P11-20 follow-up (item 3b): land a Summary block or the answers' block again once the page has settled. The page settles late — on a phone the one
 * column's figure card, 197 px at the top for an upload with no picture, is taken out of the page about a second after the Summary shows, in the middle of
 * the arrival's smooth scroll, which keeps its first target and ends 186 px past the block. So, after the images on the page have loaded or failed (the
 * card goes when its picture fails) and two frames in which the scroll has not moved (after it has moved at all), the block is scrolled to once more, at once, if it is not where it
 * should be: at most one extra correction, no later than `RELAND_WITHIN_MS` after the first scroll, and none if the reader has moved the page themselves.
 * Returns how to stop.
 */
export function landAgain(id: string, doc: ArrivalDoc, env: ArrivalEnv): () => void {
  let finished = false;
  let cancelFrame = () => {};
  const cleanups: (() => void)[] = [() => cancelFrame()];
  const finish = (land: boolean) => {
    if (finished) return;
    finished = true;
    for (const cleanup of cleanups.splice(0)) cleanup();
    if (!land) return;
    const block = doc.getElementById(id);
    if (block && Math.abs(block.getBoundingClientRect().top - LAND_TOP_PX) > LAND_SLACK_PX) block.scrollIntoView({ block: "start", behavior: "instant" });
  };
  cleanups.push(env.onUserMove(() => finish(false)));
  const deadline = setTimeout(() => finish(true), RELAND_WITHIN_MS);
  cleanups.push(() => clearTimeout(deadline));

  // Two frames with the scroll where it is — once it has moved: a smooth scroll starts a frame or more late (the first paint of a long page is slow), and
  // a scroll that has not started is not one that has stopped. A block that is already in place needs no movement; one that is not waits for it, or for the limit.
  const twoStillFrames = () => {
    const startY = env.scrollY();
    let last = startY;
    let still = 0;
    let moved = false;
    const inPlace = () => {
      const block = doc.getElementById(id);
      return block !== null && Math.abs(block.getBoundingClientRect().top - LAND_TOP_PX) <= LAND_SLACK_PX;
    };
    const next = () => {
      const y = env.scrollY();
      if (y !== startY) moved = true;
      still = y === last ? still + 1 : 0;
      last = y;
      if (still >= 2 && (moved || inPlace())) finish(true);
      else cancelFrame = env.frame(next);
    };
    cancelFrame = env.frame(next);
  };
  const waiting = Array.from(doc.images ?? []).filter((image) => !image.complete);
  let left = waiting.length;
  if (left === 0) twoStillFrames();
  for (const image of waiting) {
    const settled = () => {
      image.removeEventListener("load", settled);
      image.removeEventListener("error", settled);
      left -= 1;
      if (left === 0 && !finished) twoStillFrames();
    };
    image.addEventListener("load", settled);
    image.addEventListener("error", settled);
    cleanups.push(() => {
      image.removeEventListener("load", settled);
      image.removeEventListener("error", settled);
    });
  }
  return () => finish(false);
}

/**
 * The arrival of the notes page's blue square: the address names a paragraph of the paper, a Summary block or the answers' block. Lands on it as soon as
 * it is on the page — P11-20 follow-up (rule 1b): when the page's tree changes (`onTreeChange`: the commit that draws the target, which a timer queued behind
 * a long page's work does not wait for), and once more as the page is mounted, with the poll of old, a look every quarter second for forty looks, as the outer
 * bound (the body, the report and the answers come after the page does; for a Summary block the tab was chosen by `use-reader-tab.ts`) — and goes to it
 * once with `go`, and lands it again once the page has settled (`landAgain`, item 3b: for a Summary block and the answers' block from the first, for a paragraph
 * since rule 1b — landing as soon as it is drawn exposes the page's late settling to a paragraph too: on a phone it overshot by 197 px).
 * Returns how to stop waiting, or undefined where the address names nothing.
 */
export function followHash(hash: string, doc: ArrivalDoc, go: (id: string) => void, env: ArrivalEnv = browserArrival): (() => void) | undefined {
  const paragraph = passageFromHash(hash);
  const id = paragraph ?? blockFromHash(hash);
  if (!id) return undefined;
  let tries = 0;
  let over = false;
  let again: (() => void) | undefined;
  let unwatch: (() => void) | undefined;
  const timer = setInterval(() => {
    tries += 1;
    look();
    if (tries >= 40) stopWaiting();
  }, 250);
  const stopWaiting = () => {
    over = true;
    clearInterval(timer);
    unwatch?.();
    unwatch = undefined;
  };
  const look = () => {
    if (over || doc.getElementById(id) === null) return;
    stopWaiting();
    go(id);
    again = landAgain(id, doc, env);
  };
  unwatch = env.onTreeChange?.(look);
  // Already drawn? Asked once the page's own effects have all run (a Summary block's host is registered by the page, after this effect).
  queueMicrotask(look);
  return () => {
    stopWaiting();
    again?.();
  };
}

/** The open stickies as rows of the stack: each with its number and quote from its "Note N" heading in the paper's
 *  note (a window whose heading is gone is dropped), placed as cascaded cards. P10-09c: the cascade holds every window
 *  of the column — the notes window too — so the stickies' tops leave a slot for its header (`stackRows`). */
export function stickyRows(windows: readonly FloatingWindow[], blocks: readonly Block[], frame: StackFrame): Row[] {
  const place = new Map(stackRows(windows, blocks, frame).map((row) => [row.id, row]));
  const rows: Row[] = [];
  for (const w of windows) {
    if (w.kind !== "sticky") continue;
    const anchor = blocks.find((b) => b.id === w.id)?.anchor;
    const at = place.get(w.id);
    if (anchor && at) rows.push({ id: w.id, n: anchor.n, quote: anchor.quote, anchor, front: at.front, top: at.top, height: at.height, z: at.z });
  }
  return rows.sort((a, b) => a.z - b.z);
}

function stickyContent(blocks: readonly Block[], id: string): Block[] {
  const span = stickySpan(blocks, id);
  return span ? blocks.slice(span.start + 1, span.end) : [];
}

function StickyWindow({ row, noteId, onSaved }: { row: Row; noteId: string; onSaved: () => void }) {
  const router = useRouter();
  const note = useNotesStore((s) => s.notes[noteId]);
  const windows = useWindows((s) => s.windows);
  const active = isFrontCard(windows, row.id);
  const [content, setContent] = useState(() => stickyContent(note?.blocks ?? [], row.id));
  const [editorVersion, setEditorVersion] = useState(0);
  const [writer] = useState(() => {
    const made = makeStickyWriter((next, base) => {
      useNotesStore.getState().setStickyBlocks(noteId, row.id, JSON.parse(next) as Block[], base ? JSON.parse(base) as Block[] : undefined);
      return JSON.stringify(stickyContent(useNotesStore.getState().notes[noteId]?.blocks ?? [], row.id));
    });
    made.sync(JSON.stringify(stickyContent(note?.blocks ?? [], row.id)));
    return made;
  });
  const raise = useWindows((s) => s.raise);
  // P10-35: the paper on show does not hold this note's passage.
  const lost = useLostPassages((s) => s.lost[row.id] === true);
  // P10-09c: the sticky follows its blocks — when the notes window edits them, the text area shows the change, unless a
  // keystroke of the sticky's own is waiting to be written (then its write, a quarter second away, is the newer).
  const stored = JSON.stringify(stickyContent(note?.blocks ?? [], row.id));
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    // P10-29: with no keystroke of its own waiting, what is stored now is what the next write is measured against.
    if (!writer.pending()) writer.sync(stored);
    if (!writer.pending() && stored !== JSON.stringify(content)) {
      setContent(JSON.parse(stored) as Block[]);
      setEditorVersion((v) => v + 1);
    }
  }

  useEffect(() => registerStickyWriter(row.id, writer), [row.id, writer]);

  // What is typed and not yet written is written when the window goes behind, closes or is left.
  useEffect(() => {
    if (!active) writer.flush();
  }, [active, writer]);
  useEffect(() => () => writer.flush(), [writer]);

  if (!note) return null;
  return (
    <StickyWindowView
      n={row.n}
      quote={row.quote}
      text={content.map((b) => b.text).join("\n")}
      front={row.front}
      active={active}
      top={row.top}
      height={row.height}
      z={row.z}
      onText={(next) => {
        const blocks = next.split("\n").map((text) => block("text", text));
        setContent(blocks);
        writer.push(JSON.stringify(blocks));
      }}
      onClose={() => {
        writer.flush();
        closeSticky(noteId, row.id);
      }}
      onSave={() => {
        writer.flush();
        useNotesStore.getState().saveSticky(noteId, row.id);
        useWindows.getState().close(row.id);
        onSaved();
      }}
      onDelete={() => {
        writer.cancel();
        useNotesStore.getState().removeSticky(noteId, row.id);
        useWindows.getState().close(row.id);
      }}
      lost={lost}
      onRaise={() => raise(row.id)}
      onGo={() => goToPassage(row.anchor, { doc: document, navigate: (href) => router.push(href as Route) })}
    >
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain">
        <NoteEditor key={editorVersion} compact transient autoFocus
          leadingMarker={lost ? undefined : <AnchorSquare onClick={() => goToPassage(row.anchor, { doc: document, navigate: (href) => router.push(href as Route) })} />}
          note={{ ...note, blocks: content }}
          onDoc={(doc) => {
            const owned = doc.blocks.map((b) => ({ ...b, stickyId: row.id }));
            const next = JSON.stringify(owned);
            if (next === JSON.stringify(content)) return;
            setContent(owned);
            writer.push(next);
          }} />
      </div>
    </StickyWindowView>
  );
}

export function StickyNotes({ paper, reveal }: { paper: Paper; reveal: (run: () => void) => void }) {
  const [toast, showToast] = useReaderToast();
  const windows = useWindows((s) => s.windows);
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));

  // The blue square asks this page to show the paper's text before it scrolls there.
  useEffect(() => registerPassageHost({ paperId: paper.id, reveal }), [paper.id, reveal]);
  // The notes page's blue square comes here with `#paper-section-1-p2`, `#summary-proposal` or `#answers-block`: once it is on the page, scroll to it. A layout
  // effect (P11-20, rule 1b), so the watch stands in the commit that draws the body, and lands it before the paint, not after the passive effects that follow it.
  useLayoutEffect(
    () =>
      followHash(window.location.hash, document, (id) =>
        goToPassage({ paperId: paper.id, paragraphId: id, quote: "", n: 0 }, { doc: document, navigate: () => {} }),
      ),
    [paper.id],
  );
  // P10-29 (BACKLOG-71): a sticky left open and empty when the reader leaves the page is taken out of the note, with its anchor:
  // on a route change (this unmount — it must run before the cards are closed below) and where the tab closes (`pagehide`).
  useEffect(() => {
    const leave = () => removeEmptyStickies(paper.id);
    window.addEventListener("pagehide", leave);
    return () => {
      window.removeEventListener("pagehide", leave);
      leave();
    };
  }, [paper.id]);
  // A card must not follow the reader to the next paper.
  useEffect(
    () => () => {
      const { windows: open, close } = useWindows.getState();
      for (const w of open) if (w.kind === "sticky") close(w.id);
    },
    [],
  );

  // A sticky whose "Note N" heading has left the paper's note (the notes window deleted it) is not drawn; it is taken out of the stack
  // too, so every view of the stack — this one, the notes window's, the explain card's — counts the same windows and agrees on every position.
  useEffect(() => {
    if (!note) return;
    for (const w of windows) {
      if (w.kind === "sticky" && !note.blocks.some((b) => b.id === w.id && b.type === "h3" && b.anchor)) useWindows.getState().close(w.id);
    }
  }, [windows, note]);

  // P11-17c rule 1: Escape closes the sticky that is the front card of the stack, wherever the focus is (the card's own key handler, above,
  // answers only a key pressed inside it). The card behind it answers nothing: one Escape, one card. Which sticky is in front is asked when
  // the key comes (`front-escape.ts`), so the listener stands for as long as any sticky does.
  const noteId = note?.id;
  const closeFront = useCallback(
    (id: string) => {
      if (!noteId) return;
      openWriters.get(id)?.flush();
      closeSticky(noteId, id);
    },
    [noteId],
  );
  useFrontEscape({ kind: "sticky" }, noteId !== undefined && windows.some((w: FloatingWindow) => w.kind === "sticky"), closeFront);

  const column = useColumn(windows.some((w: FloatingWindow) => w.kind === "sticky"));
  if (!note) return null;
  const rows = stickyRows(windows, note.blocks, column);
  return (
    <>
      {rows.map((row) => (
        <StickyWindow key={row.id} row={row} noteId={note.id} onSaved={() => showToast("Note saved")} />
      ))}
      <ReaderToast toast={toast} />
    </>
  );
}
