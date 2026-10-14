"use client";

// P10-09a (the owner's review 7.1; rubric B7, B8, B10; ruling §1h.78): sticky notes. "Take notes" on a selection
// opens a small numbered window at the right, in the explain dock's column, and the reader writes in it at once.
// It imitates a sticky note: it floats while the page scrolls, it can be closed, and what is written in it is
// saved as it is written — through into the paper's own note (`store/notes.ts`: `addSticky`, `setStickyText`),
// as the "Note N" heading carrying the passage's anchor and the reader's paragraphs under it. Closing hides the
// window and loses nothing; a reload shows the windows closed and the note unchanged.
//
// `takeStickyNote` is what the toolbar's "Take notes" does; `StickyNotes` renders the open stickies; the view
// (`StickyWindowView`) has no state, so it is tested as markup and as an element tree.

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Route } from "next";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { quoteHead, stickyText, stickyTitle } from "@/lib/notes/blocks";
import { citableFromPaper } from "@/lib/notes/cite";
import type { ReadingNoteExtras } from "@/lib/notes/templates";
import type { Citable, NoteAnchor } from "@/lib/notes/types";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import { paragraphAnchor, type ExplainSelection } from "@/components/reader/paper-body";
import { useWindows, type FloatingWindow } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { AnchorSquare, goToPassage, registerPassageHost } from "./note-tags";

/** A sticky writes through into the paper's note no later than this long after the last keystroke. */
export const STICKY_SAVE_MS = 250;

/** The window's height while it is in front, and the header's. */
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
  };
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

function StickyWindow({ row, noteId, paperId }: { row: Row; noteId: string; paperId: string }) {
  const router = useRouter();
  const [text, setText] = useState(() => stickyText(readingNoteFor(useNotesStore.getState().notes, paperId)?.blocks ?? [], row.id));
  const [writer] = useState(() => makeStickyWriter((next) => useNotesStore.getState().setStickyText(noteId, row.id, next)));
  const close = useWindows((s) => s.close);
  const raise = useWindows((s) => s.raise);

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
        close(row.id);
      }}
      onRaise={() => raise(row.id)}
      onGo={() => goToPassage(row.anchor, { doc: document, navigate: (href) => router.push(href as Route) })}
    />
  );
}

/** Where the column starts: the dock's top, or just under the explain window when one stands. */
function useColumnTop(active: boolean): number {
  const [top, setTop] = useState(DOCK_TOP_PX);
  useEffect(() => {
    if (!active) return;
    const read = () => {
      const dock = document.querySelector("[data-explain-dock]");
      const bottom = dock ? dock.getBoundingClientRect().bottom : null;
      const next = bottom === null ? DOCK_TOP_PX : bottom > 0 && Number.isFinite(bottom) ? Math.ceil(bottom) + 8 : DOCK_TOP_PX + 400;
      setTop((current) => (current === next ? current : next));
    };
    read();
    const timer = setInterval(read, 250);
    window.addEventListener("resize", read);
    return () => {
      clearInterval(timer);
      window.removeEventListener("resize", read);
    };
  }, [active]);
  return top;
}

export function StickyNotes({ paper, reveal }: { paper: Paper; reveal: (run: () => void) => void }) {
  const windows = useWindows((s) => s.windows);
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));

  // The blue square asks this page to show the paper's text before it scrolls there.
  useEffect(() => registerPassageHost({ paperId: paper.id, reveal }), [paper.id, reveal]);
  // A card must not follow the reader to the next paper.
  useEffect(
    () => () => {
      const { windows: open, close } = useWindows.getState();
      for (const w of open) if (w.kind === "sticky") close(w.id);
    },
    [],
  );

  const stickies = windows.filter((w: FloatingWindow) => w.kind === "sticky");
  const base = useColumnTop(stickies.length > 0);
  if (!note) return null;
  const rows: Row[] = [];
  const ordered = [...stickies].sort((a, b) => a.order - b.order);
  ordered.forEach((w, i) => {
    const head = note.blocks.find((b) => b.id === w.id);
    if (!head?.anchor) return;
    rows.push({ id: w.id, n: head.anchor.n, quote: head.anchor.quote, anchor: head.anchor, front: i === ordered.length - 1, top: base, height: FRONT_HEIGHT_PX, z: 60 + i });
  });
  return (
    <>
      {rows.map((row) => (
        <StickyWindow key={row.id} row={row} noteId={note.id} paperId={paper.id} />
      ))}
    </>
  );
}
