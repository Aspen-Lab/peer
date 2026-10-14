"use client";

// P10-09a (the owner's review 7.1; rubric B7, B8, B10; ruling §1h.78): sticky notes. "Take notes" on a selection
// opens a small numbered window at the right, in the explain dock's column, and the reader writes in it at once.
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
import { quoteHead, stickyParagraphs, stickySpan, stickyText, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { citableFromPaper } from "@/lib/notes/cite";
import type { ReadingNoteExtras } from "@/lib/notes/templates";
import type { Citable, NoteAnchor } from "@/lib/notes/types";
import { paragraphAnchor, type ExplainSelection } from "@/components/reader/paper-body";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import { stackRows, useColumn, useWindows, type FloatingWindow, type StackFrame } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { AnchorSquare, goToPassage, registerPassageHost } from "./note-tags";

/** A sticky writes through into the paper's note no later than this long after the last keystroke. P10-09c: 150 ms, not 250 —
 *  measured in the dev server, last keystroke to the notes window showing it took 301-333 ms with 250 (the window starts its
 *  editor afresh on the change), and the brief's bound is 300 ms from the keystroke to the window. */
export const STICKY_SAVE_MS = 150;

/** The window's height while it is in front. */
const FRONT_HEIGHT_PX = 260;

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
}) {
  return (
    <div
      role="group"
      aria-label={stickyTitle(n)}
      data-sticky={n}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        event.preventDefault();
        onClose();
      }}
      style={{ top, height, zIndex: z }}
      className="fixed right-0 flex w-[min(360px,100vw)] flex-col overflow-hidden border border-border-strong bg-surface shadow-card-hover"
    >
      <div className="flex h-10 shrink-0 items-stretch">
        <button
          type="button"
          data-sticky-header=""
          onClick={onRaise}
          className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors hover:bg-surface-hover"
        >
          <span className="eyebrow shrink-0 text-heading">{stickyTitle(n)}</span>
          <span className="min-w-0 truncate font-reading text-body-sm italic text-text-muted">{`“${quoteHead(quote)}”`}</span>
        </button>
        <button
          type="button"
          aria-label={`Close note ${n}`}
          title="Close — the note stays in your notes"
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          className="grid w-10 shrink-0 place-items-center font-mono text-title leading-none text-text-muted transition-colors hover:bg-surface-hover hover:text-heading"
        >
          ×
        </button>
      </div>
      {front && (
        <div className="flex min-h-0 flex-1 gap-2 border-t border-border-strong p-3">
          <span className="mt-1 shrink-0">
            <AnchorSquare onClick={onGo} />
          </span>
          <textarea
            autoFocus
            value={text}
            aria-label={stickyTitle(n)}
            placeholder="Write here. It is saved in your notes."
            onChange={(event) => onText(event.currentTarget.value)}
            className="min-h-0 flex-1 resize-none bg-transparent font-reading text-body-sm leading-[1.6] text-text outline-none placeholder:text-text-faint/70"
          />
        </div>
      )}
    </div>
  );
}

/** A debounced write: `push` the latest text, it is written once `ms` after the last push; `flush` writes it now. */
export function makeStickyWriter(write: (text: string) => void, ms = STICKY_SAVE_MS) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: string | null = null;
  const flush = () => {
    clearTimeout(timer);
    timer = undefined;
    if (pending === null) return;
    const text = pending;
    pending = null;
    write(text);
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

/**
 * P10-09c (rule 4): the blocks without the sticky's heading and its text blocks when all of those are empty — a sticky
 * opened and never written in leaves nothing behind. The same array when it has words, or is not there. The note's
 * `stickyCount` is not touched (the number is not reused).
 */
export function withoutSticky(blocks: readonly Block[], headerId: string): readonly Block[] {
  const span = stickySpan(blocks, headerId);
  if (!span) return blocks;
  if (blocks.slice(span.start + 1, span.end).some((b) => b.text.trim() !== "")) return blocks;
  return [...blocks.slice(0, span.start), ...blocks.slice(span.end)];
}

/** Closing a sticky: an empty one is taken out of the note; its window leaves the stack. The note keeps everything else. */
export function closeSticky(noteId: string, headerId: string): void {
  const { notes, save } = useNotesStore.getState();
  const note = notes[noteId];
  if (note) {
    const blocks = withoutSticky(note.blocks, headerId);
    if (blocks !== note.blocks) save(noteId, { blocks: [...blocks] });
  }
  useWindows.getState().close(headerId);
}

/**
 * "Take notes" on a selection: the paper's note (made if it is not there, without navigating), the next numbered
 * sticky in it, anchored to the selection's paragraph, and its window opened.
 */
export function takeStickyNote(
  target: Pick<ExplainSelection, "sectionIndex" | "paragraphIndex" | "passage">,
  paper: Citable,
  extras?: ReadingNoteExtras,
): { id: string; n: number } | null {
  const { ensureReadingNote, addSticky } = useNotesStore.getState();
  const noteId = ensureReadingNote(paper, extras);
  const made = addSticky(noteId, {
    paperId: paper.id,
    paragraphId: paragraphAnchor(target.sectionIndex, target.paragraphIndex),
    passage: target.passage,
  });
  if (!made) return null;
  useWindows.getState().open({ id: made.id, kind: "sticky", title: stickyTitle(made.n) });
  return made;
}

/** The page's `takeNote` action. */
export function useTakeNote({
  paper,
  questions,
  forYourQuestions,
}: {
  paper: Paper;
  questions?: readonly string[];
  forYourQuestions?: readonly QuestionAnswers[];
}): (target: ExplainSelection) => void {
  return useCallback(
    (target: ExplainSelection) => {
      takeStickyNote(target, citableFromPaper(paper), { questions, forYourQuestions });
    },
    [paper, questions, forYourQuestions],
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
  const [writer] = useState(() => makeStickyWriter((next) => useNotesStore.getState().setStickyText(noteId, row.id, next)));
  const raise = useWindows((s) => s.raise);
  // P10-09c: the sticky follows its blocks — when the notes window edits them, the text area shows the change, unless a
  // keystroke of the sticky's own is waiting to be written (then its write, a quarter second away, is the newer).
  const stored = useNotesStore((s) => stickyText(readingNoteFor(s.notes, paperId)?.blocks ?? [], row.id));
  const [seen, setSeen] = useState(stored);
  if (stored !== seen) {
    setSeen(stored);
    const next = stickyFollowText({ local: text, stored, pending: writer.pending() });
    if (next !== null) setText(next);
  }

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
  const rows = stickyRows(windows, note.blocks, { ...column, frontHeight: FRONT_HEIGHT_PX, minTop: DOCK_TOP_PX });
  return (
    <>
      {rows.map((row) => (
        <StickyWindow key={row.id} row={row} noteId={note.id} paperId={paper.id} />
      ))}
    </>
  );
}
