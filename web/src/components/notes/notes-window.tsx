"use client";

// P10-09b (the owner's review 7.2, 7.3, 7.5; B12, B13, B15): "Open your notes" opens the paper's whole note as a
// floating window at the right — no navigation. It stands in the dock's column (360 px, flush with the right
// edge) and takes the height its text needs down to the foot legend; past that it scrolls inside itself. It is `fixed`,
// so the page scrolling under it never moves it: the sticky pad the reader keeps writing on while they read on.
//
// P10-09c (review 7.1a, B9): it is one of the floating windows (`lib/reader/windows.ts`): it registers there as
// `kind: "notes"` while it stands and leaves when it closes, and the stack places it — in the one cascade with the sticky
// notes, 40 px apart, the raised one in front and whole, the column under the explain window. Behind another window it
// shows its header alone (the editor stays mounted, hidden, so nothing it holds is lost); a press on the header raises it.
//
// Its body is the paper's one reading note (`readingNoteFor`, the note the Saved page opens at `/notes/<id>`),
// in the block editor with the formatting toolbar: the sticky notes' "Note N" headings and their text in order,
// and whatever is typed here. There is no character limit anywhere in the path — blocks are strings in the store.
//
// Not done: dragging the window by its header (the column is where it stands), and a phone (the row there still
// navigates to the page).

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import type { Paper } from "@/types";
import type { Block, Note, Source } from "@/lib/notes/types";
import { fileName, toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "@/lib/notes/export";
import { downloadFile, printHtml } from "@/lib/notes/print";
import { cn } from "@/lib/cn";
import { NOTES_WINDOW_ID, stackRows, useColumn, useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { NoteEditor } from "./note-editor";

/** The sticky notes' height in front (the stack's frame needs it; the notes window in front takes what the screen leaves). */
const STICKY_FRONT_HEIGHT_PX = 260;

export type ExportKind = "copy" | "txt" | "md" | "doc" | "pdf";

/** The export menu, in the order it stands. None of these formats carries a sticky note's quoted passage. */
export const EXPORT_ITEMS: readonly { id: ExportKind; label: string; detail: string }[] = [
  { id: "copy", label: "Copy", detail: "the note as plain text" },
  { id: "txt", label: "Text (.txt)", detail: "words only, no markup" },
  { id: "md", label: "Markdown (.md)", detail: "Obsidian, Pandoc" },
  { id: "doc", label: "Word (.doc)", detail: "opens in Word" },
  { id: "pdf", label: "PDF (print)", detail: "choose Save as PDF" },
];

export function NotesWindowView({
  top,
  maxHeight,
  height,
  z,
  front = true,
  menuOpen,
  notice,
  onClose,
  onMenu,
  onExport,
  onRaise,
  children,
}: {
  top: number;
  /** In front: the most height the window takes before its body scrolls. */
  maxHeight: number;
  /** Behind another window: a header's height. */
  height?: number;
  /** Its place in the stack. */
  z?: number;
  /** In front and whole; else only its header shows (the note stays mounted, hidden). */
  front?: boolean;
  menuOpen: boolean;
  /** What the last export did ("Copied"), said politely in the header. */
  notice: string | null;
  onClose: () => void;
  onMenu: () => void;
  onExport: (kind: ExportKind) => void;
  /** A press on the header: raise the window to the front. */
  onRaise?: () => void;
  children?: ReactNode;
}) {
  return (
    <section
      aria-label="Your notes"
      data-notes-window=""
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        event.preventDefault();
        // An open export menu closes first; the window next.
        if (menuOpen) onMenu();
        else onClose();
      }}
      className={cn(
        "fixed right-0 flex w-[360px] max-w-[calc(100vw-1rem)] flex-col border border-r-0 border-border-strong bg-surface shadow-card",
        !front && "overflow-hidden",
      )}
      style={front ? { top, maxHeight, zIndex: z } : { top, height, maxHeight, zIndex: z }}
    >
      <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border pl-4 pr-2">
        <h2 className="eyebrow min-w-0 flex-1 text-heading">
          <button
            type="button"
            data-window-header=""
            onClick={onRaise}
            className="flex h-10 w-full items-center text-left transition-colors hover:text-text"
          >
            Your notes
          </button>
        </h2>
        <div className="relative flex items-center gap-2">
          {front && (
            <span className="annotation text-text-faint" aria-live="polite">
              {notice}
            </span>
          )}
          {front && (
            <button
              type="button"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={onMenu}
              className="eyebrow px-2 py-1 text-text-muted transition-colors hover:bg-bg-secondary hover:text-heading"
            >
              Export <span aria-hidden>▾</span>
            </button>
          )}
          {front && menuOpen && (
            <>
              <button type="button" aria-hidden tabIndex={-1} className="fixed inset-0 z-10 cursor-default" onClick={onMenu} />
              <div role="menu" className="absolute right-0 top-full z-20 mt-1 w-56 border border-border-strong bg-surface py-1 shadow-card">
                {EXPORT_ITEMS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    onClick={() => onExport(item.id)}
                    className="block w-full px-3 py-2 text-left hover:bg-bg-secondary/70"
                  >
                    <span className="block text-body-sm text-heading">{item.label}</span>
                    <span className="annotation block text-text-faint">{item.detail}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <button
            type="button"
            aria-label="Close your notes"
            onClick={onClose}
            className="grid h-8 w-8 place-items-center text-body text-text-muted transition-colors hover:bg-bg-secondary hover:text-heading"
          >
            ×
          </button>
        </div>
      </header>
      <div hidden={!front} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-1">
        {children}
      </div>
      <p hidden={!front} className="annotation shrink-0 border-t border-border px-4 py-2 text-text-faint">
        Kept in this browser
      </p>
    </section>
  );
}

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };

export function NotesWindow({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));
  const windows = useWindows((s) => s.windows);
  const raise = useWindows((s) => s.raise);
  const doc = useRef<Doc | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The editor keeps its own copy while it is open; a sticky note written into the same note from outside (P10-09a)
  // changes the stored blocks under it, so the editor is started afresh when they change and it holds nothing unsaved.
  const [rev, setRev] = useState(0);

  // The window is one of the stack's: it joins when it stands and leaves when it closes.
  useEffect(() => {
    useWindows.getState().open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" });
    return () => useWindows.getState().close(NOTES_WINDOW_ID);
  }, []);
  const column = useColumn(true);
  const row = note
    ? stackRows(windows, note.blocks, { ...column, frontHeight: STICKY_FRONT_HEIGHT_PX, minTop: DOCK_TOP_PX }).find((r) => r.id === NOTES_WINDOW_ID)
    : undefined;

  useEffect(() => {
    if (!note || !doc.current) return;
    if (JSON.stringify(note.blocks) !== JSON.stringify(doc.current.blocks)) setRev((r) => r + 1);
    // Only a change of what is stored matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.blocks]);

  const flash = (text: string) => {
    setNotice(text);
    window.setTimeout(() => setNotice((n) => (n === text ? null : n)), 2400);
  };

  // What leaves is the editor's copy as it is now, not the last save: a change is stored half a second after it.
  const runExport = async (kind: ExportKind) => {
    setMenuOpen(false);
    if (!note) return;
    const n: Note = { ...note, ...doc.current, updatedAt: new Date().toISOString() };
    if (kind === "copy") {
      try {
        await navigator.clipboard.writeText(toPlainText(n));
        flash("Copied");
      } catch {
        flash("Copy was blocked — try Text");
      }
    } else if (kind === "txt") downloadFile(toPlainText(n), fileName(n, "txt"), "text/plain;charset=utf-8");
    else if (kind === "md") downloadFile(toMarkdown(n), fileName(n, "md"), "text/markdown;charset=utf-8");
    else if (kind === "doc") downloadFile(toWordHtml(n), fileName(n, "doc"), "application/msword");
    else printHtml(toPrintHtml(n));
  };

  // Not in the stack yet (it registers just after it mounts): nothing to draw for that one frame.
  if (!note || !row) return null;
  return (
    <NotesWindowView
      top={row.top}
      maxHeight={row.height}
      height={row.height}
      z={row.z}
      front={row.front}
      menuOpen={menuOpen}
      notice={notice}
      onClose={onClose}
      onMenu={() => setMenuOpen((o) => !o)}
      onExport={runExport}
      onRaise={() => raise(NOTES_WINDOW_ID)}
    >
      <NoteEditor
        key={`${note.id}:${rev}`}
        note={note as Note}
        compact
        onDoc={(d) => {
          doc.current = d;
        }}
      />
    </NotesWindowView>
  );
}
