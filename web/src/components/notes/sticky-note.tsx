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

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { quoteHead, stickyParagraphs, stickyText, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { citableFromPaper } from "@/lib/notes/cite";
import type { ReadingNoteExtras } from "@/lib/notes/templates";
import type { Citable, NoteAnchor } from "@/lib/notes/types";
import { paragraphAnchor, type ExplainSelection } from "@/components/reader/paper-body";
import { MarginCard } from "@/components/reader/margin-card";
import { holdInPlace, readingAnchorTop, stackRows, useColumn, useWindows, type FloatingWindow, type StackFrame } from "@/lib/reader/windows";
import { readingNoteFor, stripTagText, useLostPassages, useNotesStore, withoutSticky } from "@/store/notes";

export { withoutSticky };
import { AnchorSquare, PASSAGE_LOST_LINE, goToPassage, registerPassageHost } from "./note-tags";
import { WysiwygField } from "./wysiwyg-field";

/** A sticky writes through into the paper's note no later than this long after the last keystroke. P10-09c: 150 ms, not 250 —
 *  measured in the dev server, last keystroke to the notes window showing it took 301-333 ms with 250 (the window starts its
 *  editor afresh on the change), and the brief's bound is 300 ms from the keystroke to the window. */
export const STICKY_SAVE_MS = 150;

export function StickyWindowView({
  n,
  quote,
  text,
  front,
  top,
  height,
  z,
  onText,
  onClose,
  onRaise,
  onGo,
  lost = false,
}: {
  n: number;
  quote: string;
  text: string;
  /** In front and whole; else only its header shows. */
  front: boolean;
  top: number;
  height: number;
  z: number;
  onText: (text: string) => void;
  onClose: () => void;
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
        if (event.key !== "Escape") return;
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
    >
      <div className="flex min-h-0 flex-1 gap-2 border-t border-border-strong p-3">
        {!lost && (
          <span className="mt-1 shrink-0">
            <AnchorSquare onClick={onGo} />
          </span>
        )}
        <WysiwygField
          autoFocus
          value={text}
          ariaLabel={stickyTitle(n)}
          placeholder="Write here. It is saved in your notes."
          onChange={onText}
          className="min-h-0 flex-1 overflow-y-auto font-reading text-body-sm leading-[1.6] text-text"
        />
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
export function closeSticky(noteId: string, headerId: string, scroll?: (dy: number) => void): void {
  useNotesStore.getState().removeEmptySticky(noteId, headerId);
  // The last window to leave frees the column (P10-09d): the words move back, and the reader's place is held.
  holdInPlace({ change: () => useWindows.getState().close(headerId), scroll });
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
    Partial<Pick<ExplainSelection, "measure" | "bounds" | "source" | "paragraphId">> & { paragraphText?: string },
  paper: Citable,
  extras?: ReadingNoteExtras,
  scroll?: (dy: number) => void,
): { id: string; n: number } | null {
  const { ensureReadingNote, addSticky } = useNotesStore.getState();
  const noteId = ensureReadingNote(paper, extras);
  const made = addSticky(noteId, {
    paperId: paper.id,
    paragraphId: stickyAnchorId(target),
    // P10-24: the words, never a note tag's text.
    passage: stripTagText(target.passage),
    paragraphText: target.paragraphText,
  });
  if (!made) return null;
  // R-open: the first card of an empty margin opens level with the selection's first line, as the selection is now.
  const anchorTop = target.measure?.()?.bounds.top ?? target.bounds?.top;
  // P10-09d (X-B1): the first window of the stack reserves the column and the text reflows; the selected words (else the first
  // paragraph on the screen) stay where the eyes are, as the explain window's reflow holds them (P7-15).
  holdInPlace({
    measure: () => target.measure?.()?.bounds.top ?? readingAnchorTop(),
    change: () => useWindows.getState().open({ id: made.id, kind: "sticky", title: stickyTitle(made.n), ...(anchorTop !== undefined ? { anchorTop } : {}) }),
    scroll,
  });
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

function StickyWindow({ row, noteId, paperId }: { row: Row; noteId: string; paperId: string }) {
  const router = useRouter();
  const [text, setText] = useState(() => stickyText(readingNoteFor(useNotesStore.getState().notes, paperId)?.blocks ?? [], row.id));
  const [writer] = useState(() => {
    const made = makeStickyWriter((next, base) => {
      useNotesStore.getState().setStickyText(noteId, row.id, next, base);
      return stickyText(useNotesStore.getState().notes[noteId]?.blocks ?? [], row.id);
    });
    made.sync(stickyText(readingNoteFor(useNotesStore.getState().notes, paperId)?.blocks ?? [], row.id));
    return made;
  });
  const raise = useWindows((s) => s.raise);
  // P10-35: the paper on show does not hold this note's passage.
  const lost = useLostPassages((s) => s.lost[row.id] === true);
  // P10-09c: the sticky follows its blocks — when the notes window edits them, the text area shows the change, unless a
  // keystroke of the sticky's own is waiting to be written (then its write, a quarter second away, is the newer).
  const stored = useNotesStore((s) => stickyText(readingNoteFor(s.notes, paperId)?.blocks ?? [], row.id));
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    // P10-29: with no keystroke of its own waiting, what is stored now is what the next write is measured against.
    if (!writer.pending()) writer.sync(stored);
    const next = stickyFollowText({ local: text, stored, pending: writer.pending() });
    if (next !== null) setText(next);
  }

  useEffect(() => registerStickyWriter(row.id, writer), [row.id, writer]);

  // What is typed and not yet written is written when the window goes behind, closes or is left.
  useEffect(() => {
    if (!row.front) writer.flush();
  }, [row.front, writer]);
  useEffect(() => () => writer.flush(), [writer]);

  return (
    <StickyWindowView
      n={row.n}
      quote={row.quote}
      text={text}
      front={row.front}
      top={row.top}
      height={row.height}
      z={row.z}
      onText={(next) => {
        setText(next);
        writer.push(next);
      }}
      onClose={() => {
        writer.flush();
        closeSticky(noteId, row.id);
      }}
      lost={lost}
      onRaise={() => raise(row.id)}
      onGo={() => goToPassage(row.anchor, { doc: document, navigate: (href) => router.push(href as Route) })}
    />
  );
}

export function StickyNotes({ paper, reveal }: { paper: Paper; reveal: (run: () => void) => void }) {
  const windows = useWindows((s) => s.windows);
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));

  // The blue square asks this page to show the paper's text before it scrolls there.
  useEffect(() => registerPassageHost({ paperId: paper.id, reveal }), [paper.id, reveal]);
  // The notes page's blue square comes here with `#paper-section-1-p2`: once the body is on the page, scroll to it.
  useEffect(() => {
    const id = passageFromHash(window.location.hash);
    if (!id) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      const found = document.getElementById(id) !== null;
      if (!found && tries < 40) return;
      clearInterval(timer);
      if (found) goToPassage({ paperId: paper.id, paragraphId: id, quote: "", n: 0 }, { doc: document, navigate: () => {} });
    }, 250);
    return () => clearInterval(timer);
  }, [paper.id]);
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

  const column = useColumn(windows.some((w: FloatingWindow) => w.kind === "sticky"));
  if (!note) return null;
  const rows = stickyRows(windows, note.blocks, column);
  return (
    <>
      {rows.map((row) => (
        <StickyWindow key={row.id} row={row} noteId={note.id} paperId={paper.id} />
      ))}
    </>
  );
}
