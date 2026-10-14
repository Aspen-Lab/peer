"use client";

// P10-09b (the owner's review 7.2, 7.3, 7.5; B12, B13, B15): "Open your notes" opens the paper's whole note as a
// floating window at the right — no navigation. It stands in the dock's column (360 px, flush with the right
// edge), at the dock's top while no explain window stands and under that window's bottom while one does, and
// takes the height its text needs down to the foot legend; past that it scrolls inside itself. It is `fixed`, so the
// page scrolling under it never moves it: the sticky pad the reader keeps writing on while they read on.
//
// Its body is the paper's one reading note (`readingNoteFor`, the note the Saved page opens at `/notes/<id>`),
// in the block editor with the formatting toolbar: the sticky notes' "Note N" headings and their text in order,
// and whatever is typed here. There is no character limit anywhere in the path — blocks are strings in the store.
//
// Not done this round: dragging the window by its header (the column is where it stands), stacking with the sticky
// notes (P10-09a's `windows.ts`), and a phone (the row there still navigates to the page).

import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { DOCK_TOP_PX, PAGE_ZOOM_ROOT, PAGE_ZOOM_VAR, legendHeightPx } from "@/components/reader/explain-dock";
import type { Paper } from "@/types";
import type { Block, Note, Source } from "@/lib/notes/types";
import { fileName, toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "@/lib/notes/export";
import { downloadFile, printHtml } from "@/lib/notes/print";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { NoteEditor } from "./note-editor";

/** The gap between the explain window's bottom and this window's top, and between this window's bottom and the legend. */
export const NOTES_WINDOW_GAP_PX = 8;

/** The least height the window keeps for writing when the explain window stands low: it is lifted instead. */
export const NOTES_WINDOW_MIN_HEIGHT_PX = 240;

/**
 * Where the window stands, in the window's own pixels: its top, and the most height it takes before it scrolls.
 * `explainBottom` is the bottom edge of the explain window when one stands (else null), `legend` the foot legend's
 * height on screen (`legendHeightPx`). The window never stands above the dock's top, and is lifted — not
 * squeezed — when the explain window leaves less than a writable height above the legend.
 */
export function notesWindowBox({
  viewportHeight,
  explainBottom,
  legend,
}: {
  viewportHeight: number;
  explainBottom: number | null;
  legend: number;
}): { top: number; maxHeight: number } {
  const floor = viewportHeight - legend - NOTES_WINDOW_GAP_PX;
  const wanted = explainBottom === null ? DOCK_TOP_PX : explainBottom + NOTES_WINDOW_GAP_PX;
  const top = Math.max(DOCK_TOP_PX, Math.min(wanted, floor - NOTES_WINDOW_MIN_HEIGHT_PX));
  return { top, maxHeight: Math.max(NOTES_WINDOW_MIN_HEIGHT_PX, floor - top) };
}

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
  menuOpen,
  notice,
  onClose,
  onMenu,
  onExport,
  children,
}: {
  top: number;
  maxHeight: number;
  menuOpen: boolean;
  /** What the last export did ("Copied"), said politely in the header. */
  notice: string | null;
  onClose: () => void;
  onMenu: () => void;
  onExport: (kind: ExportKind) => void;
  children: ReactNode;
}) {
  return (
    <section
      aria-label="Your notes"
      data-notes-window=""
      className="fixed right-0 z-[70] flex w-[360px] max-w-[calc(100vw-1rem)] flex-col border border-r-0 border-border-strong bg-surface shadow-card"
      style={{ top, maxHeight }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="eyebrow text-heading">Your notes</h2>
        <div className="relative flex items-center gap-2">
          <span className="annotation text-text-faint" aria-live="polite">
            {notice}
          </span>
          <button
            type="button"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={onMenu}
            className="eyebrow px-2 py-1 text-text-muted transition-colors hover:bg-bg-secondary hover:text-heading"
          >
            Export <span aria-hidden>▾</span>
          </button>
          {menuOpen && (
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
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-1">{children}</div>
      <p className="annotation shrink-0 border-t border-border px-4 py-2 text-text-faint">Kept in this browser</p>
    </section>
  );
}

/** Measure the window's surroundings: the explain window's bottom, the legend's height, the viewport's. */
function measure(): { viewportHeight: number; explainBottom: number | null; legend: number } {
  const dock = document.querySelector<HTMLElement>("[data-explain-dock]");
  const r = dock?.getBoundingClientRect();
  const root = document.querySelector<HTMLElement>(PAGE_ZOOM_ROOT);
  const zoom = root ? Number.parseFloat(getComputedStyle(root).getPropertyValue(PAGE_ZOOM_VAR)) : Number.NaN;
  return {
    viewportHeight: window.innerHeight,
    explainBottom: r && r.height > 0 ? r.bottom : null,
    legend: legendHeightPx(zoom),
  };
}

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };

export function NotesWindow({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));
  const [box, setBox] = useState(() => notesWindowBox({ viewportHeight: 900, explainBottom: null, legend: 28 }));
  const doc = useRef<Doc | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The editor keeps its own copy while it is open; a sticky note written into the same note from outside (P10-09a)
  // changes the stored blocks under it, so the editor is started afresh when they change and it holds nothing unsaved.
  const [rev, setRev] = useState(0);

  useEffect(() => {
    const place = () => {
      const next = notesWindowBox(measure());
      setBox((b) => (b.top === next.top && b.maxHeight === next.maxHeight ? b : next));
    };
    place();
    window.addEventListener("resize", place);
    // The explain window moves with the paragraph the reader selects and with the window's size: its bottom is read
    // again a few times a second rather than watched, which is cheap and never wrong for long.
    const t = window.setInterval(place, 250);
    return () => {
      window.removeEventListener("resize", place);
      window.clearInterval(t);
    };
  }, []);

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

  if (!note) return null;
  return (
    <NotesWindowView
      top={box.top}
      maxHeight={box.maxHeight}
      menuOpen={menuOpen}
      notice={notice}
      onClose={onClose}
      onMenu={() => setMenuOpen((o) => !o)}
      onExport={runExport}
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
