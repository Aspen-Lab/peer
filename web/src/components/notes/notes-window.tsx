"use client";

// P10-09b (the owner's review 7.2, 7.3, 7.5; B12, B13, B15): "Open your notes" opens the paper's whole note as a
// floating window at the right — no navigation. It stands in the margin (P11-14: `MarginCard`'s frame, the margin's left and width)
// and takes the height its text needs down to the foot legend; past that it scrolls inside itself. It is `fixed`,
// so the page scrolling under it never moves it: the sticky pad the reader keeps writing on while they read on.
//
// P10-09c (review 7.1a, B9): it is one of the floating windows (`lib/reader/windows.ts`): it registers there as
// `kind: "notes"` while it stands and leaves when it closes, and the stack places it — in the one cascade with the sticky
// notes, 40 px apart, the raised one in front and whole, the column under the explain window. Behind another window it
// shows its header alone (the editor stays mounted, hidden, so nothing it holds is lost); a press on the header raises it.
//
// P10-09d (X-B1): like the explain window it keeps the text column clear — joining the stack takes the shared reserve
// (`reserveDock`, counted), so the paper's words move out of the column and are never covered; its header and the editor's
// toolbar carry the window's own surface, so nothing of the text scrolling under them shows through.
//
// Its body is the paper's one reading note (`readingNoteFor`, the note the Saved page opens at `/notes/<id>`),
// in the block editor with the formatting toolbar: the sticky notes' "Note N" headings and their text in order,
// and whatever is typed here. There is no character limit anywhere in the path — blocks are strings in the store.
//
// Not done: dragging the window by its header (the column is where it stands), and a phone (the row there still
// navigates to the page).

import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { MarginCard } from "@/components/reader/margin-card";
import type { Paper } from "@/types";
import type { Block, Note, Source } from "@/lib/notes/types";
import { fileName, toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "@/lib/notes/export";
import { downloadFile, printHtml } from "@/lib/notes/print";
import { NOTES_WINDOW_ID, STACK_Z_BASE, holdInPlace, stackRows, useColumn, useWindows } from "@/lib/reader/windows";
import { mergeText, readingNoteFor, useNotesStore } from "@/store/notes";
import { NoteEditor } from "./note-editor";

export type ExportKind = "copy" | "txt" | "md" | "doc" | "pdf";

/** The export menu, in the order it stands. None of these formats carries a sticky note's quoted passage; every one carries a highlight's words (P11-08). */
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
    <MarginCard
      id={NOTES_WINDOW_ID}
      kind="notes"
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
      front={front}
      top={top}
      maxHeight={maxHeight}
      {...(front ? {} : { height })}
      z={z ?? STACK_Z_BASE}
      keepMounted
      // In front the export menu hangs below the header and may pass the window's foot; behind it clips to a header.
      className={front ? "overflow-visible" : undefined}
      header={
        <header className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-border bg-surface pl-4 pr-2">
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
      }
    >
      <div hidden={!front} className="min-h-0 flex-1 overflow-y-auto overscroll-contain bg-surface px-3 pb-4 [&_[role=toolbar]]:bg-surface">
        {children}
      </div>
      <p hidden={!front} className="annotation shrink-0 border-t border-border bg-surface px-4 py-2 text-text-faint">
        Kept in this browser
      </p>
    </MarginCard>
  );
}

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };

const sameBlocks = (a: readonly Block[], b: readonly Block[]) => a === b || JSON.stringify(a) === JSON.stringify(b);

/** A block's kind and marks — everything but its words — as one comparable string. */
const apartFromText = (b: Block) => JSON.stringify(Object.entries(b).filter(([key]) => key !== "text").sort(([x], [y]) => (x < y ? -1 : 1)));

/**
 * P10-29 (BACKLOG-71): one block changed in the window (`m`) and from outside (`t`), both grown from `b`. The words are
 * merged (`mergeText`: what each side added stays; only a rewrite of the same words is the outside one's, written last);
 * the kind and marks are the side's that changed them, the outside's where both did.
 */
function mergeBlock(b: Block, m: Block, t: Block): Block {
  const text = mergeText(b.text, m.text, t.text, "theirs");
  const kept = apartFromText(m) === apartFromText(b) ? t : apartFromText(t) === apartFromText(b) ? m : t;
  return kept.text === text ? kept : { ...kept, text };
}

/**
 * P10-09c (rule 3, BACKLOG-69): the editor's unsaved blocks (`mine`) and a change made to the same note from outside
 * (`theirs` — a sticky writing its words), both grown from `base`, in one list. Block by block, by id: a block only the
 * window changed keeps the window's version, a block only the outside changed keeps the outside's, where both changed
 * one block the words are merged (`mergeBlock`: the outside's only where both rewrote the same words, written last); a block the window added stays after its neighbour, one the
 * outside added stays, one the window deleted is gone. Pure.
 */
export function mergeBlocks(base: readonly Block[], mine: readonly Block[], theirs: readonly Block[]): Block[] {
  const baseBy = new Map(base.map((b) => [b.id, b]));
  const mineBy = new Map(mine.map((b) => [b.id, b]));
  const out: Block[] = [];
  for (const t of theirs) {
    const b = baseBy.get(t.id);
    const m = mineBy.get(t.id);
    if (!m) {
      if (b && sameBlocks([b], [t])) continue; // the window deleted it, the outside left it
      out.push(t);
      continue;
    }
    if (b && !sameBlocks([b], [t]) && !sameBlocks([b], [m])) out.push(mergeBlock(b, m, t));
    else out.push(b && sameBlocks([b], [t]) && !sameBlocks([b], [m]) ? m : t);
  }
  const placed = new Set(out.map((b) => b.id));
  mine.forEach((m, i) => {
    if (baseBy.has(m.id) || placed.has(m.id)) return; // not the window's to add
    const prev = mine[i - 1];
    const at = prev ? out.findIndex((x) => x.id === prev.id) : -1;
    out.splice(at + 1, 0, m);
    placed.add(m.id);
  });
  return out;
}

export type Reconcile = { kind: "same" } | { kind: "keep" } | { kind: "restart"; blocks: Block[] } | { kind: "merge"; blocks: Block[] };

/**
 * What the window does when the note's stored blocks (`theirs`) change under its editor, which was started from
 * `base` and holds `mine` now: nothing when its own save landed (`same`) or the store did not change (`keep`); start
 * the editor afresh on the stored blocks when it holds nothing unsaved (`restart`); else the two merged (`merge`) —
 * which the window then stores itself, after the old editor's own flush on unmount, so neither is lost.
 */
export function reconcileWindow(base: readonly Block[], mine: readonly Block[], theirs: readonly Block[]): Reconcile {
  if (sameBlocks(theirs, mine)) return { kind: "same" };
  if (sameBlocks(theirs, base)) return { kind: "keep" };
  if (sameBlocks(mine, base)) return { kind: "restart", blocks: [...theirs] };
  return { kind: "merge", blocks: mergeBlocks(base, mine, theirs) };
}

export function NotesWindow({ paper, onClose }: { paper: Paper; onClose: () => void }) {
  const note = useNotesStore((s) => readingNoteFor(s.notes, paper.id));
  const windows = useWindows((s) => s.windows);
  const raise = useWindows((s) => s.raise);
  const doc = useRef<Doc | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  // The editor keeps its own copy while it is open; a sticky note written into the same note from outside (P10-09a)
  // changes the stored blocks under it, so the editor is started afresh when they change (`rev`). P10-09c: when it holds
  // unsaved typing of its own at that moment the two are merged first (`seed`) rather than the old editor's flush on
  // unmount writing its stale copy over the sticky's words (BACKLOG-69).
  const [fresh, setFresh] = useState<{ rev: number; seed: { blocks: Block[]; sources: Record<string, Source> } | null }>({ rev: 0, seed: null });
  // The blocks the editor was started from, or last saw stored: what "unsaved" is measured against.
  const base = useRef<Block[] | null>(null);

  // The window is one of the stack's: it joins when it stands and leaves when it closes. P10-09d (X-B1): joining reserves the
  // column and the text reflows, so it joins before the first paint (no frame with the window over the words), and the reader's
  // place — the selected words, else the first paragraph on the screen — is held across the reflow, going and coming.
  useLayoutEffect(() => {
    holdInPlace({ change: () => useWindows.getState().open({ id: NOTES_WINDOW_ID, kind: "notes", title: "Your notes" }) });
    return () => holdInPlace({ change: () => useWindows.getState().close(NOTES_WINDOW_ID) });
  }, []);
  const column = useColumn(true);
  const row = note
    ? stackRows(windows, note.blocks, column).find((r) => r.id === NOTES_WINDOW_ID)
    : undefined;

  useEffect(() => {
    if (!note) return;
    const mine = doc.current;
    const from = base.current ?? note.blocks;
    if (!mine) {
      base.current = note.blocks;
      return;
    }
    const verdict = reconcileWindow(from, mine.blocks, note.blocks);
    if (verdict.kind === "same") base.current = note.blocks;
    else if (verdict.kind === "keep") base.current ??= note.blocks;
    else if (verdict.kind === "restart") {
      base.current = note.blocks;
      setFresh((f) => ({ rev: f.rev + 1, seed: null }));
    } else setFresh((f) => ({ rev: f.rev + 1, seed: { blocks: verdict.blocks, sources: { ...note.sources, ...mine.sources } } }));
    // Only a change of what is stored matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [note?.blocks]);

  // The merge is stored once the old editor has gone (its unmount flush has written its own copy by now), and is what
  // the new editor started from.
  useEffect(() => {
    if (!fresh.seed || !note) return;
    useNotesStore.getState().save(note.id, { blocks: fresh.seed.blocks, sources: fresh.seed.sources });
    setFresh((f) => (f.rev === fresh.rev ? { rev: f.rev, seed: null } : f));
    // Only a new start matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fresh.rev]);

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
        key={`${note.id}:${fresh.rev}`}
        note={(fresh.seed ? { ...note, blocks: fresh.seed.blocks, sources: fresh.seed.sources } : note) as Note}
        compact
        onDoc={(d) => {
          doc.current = d;
        }}
      />
    </NotesWindowView>
  );
}
