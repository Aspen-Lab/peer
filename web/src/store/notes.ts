// The reader's notes, kept in this browser.
//
// Local-first, the way Obsidian keeps a vault: a note is written, saved and
// read on this device, and leaves it only when the reader exports it. Nothing
// here is sent to Peer's server — which is also why signing out does not
// clear it: an account never brought these here, so the sign-out reset
// (lib/feed/session-step.ts) has no claim on them. /privacy says so.
//
// Rehydrated after mount by <StoreHydrator/>, like the other stores, so the
// first client render matches the server's.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Citable, Note } from "@/lib/notes/types";
import { citedKeys, stickyBlocks, stickyQuote, withStickyText } from "@/lib/notes/blocks";
import { readingNote, type ReadingNoteExtras } from "@/lib/notes/templates";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";

/**
 * P10-09f (review 7.1c; rule 1): where a selection's words stand in the paragraph's text — the first occurrence of the
 * passage (white space in the passage matches any white space in the paragraph; the selection arrives collapsed).
 * A formula's TeX is not prose: no match starts or ends inside one. Null when the passage is not found whole.
 */
export function locatePassage(paragraph: string, passage: string): { start: number; end: number } | null {
  const words = passage.split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const masked = paragraph.replace(new RegExp(`${MATH_OPEN}[^${MATH_CLOSE}]*${MATH_CLOSE}`, "g"), (math) => "\u0000".repeat(math.length));
  const found = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+")).exec(masked);
  return found ? { start: found.index, end: found.index + found[0].length } : null;
}

interface NotesState {
  notes: Record<string, Note>;
  add: (note: Note) => void;
  /** Write the editor's state back. Stamps `updatedAt`. */
  save: (id: string, patch: Partial<Pick<Note, "title" | "blocks" | "sources">>, at?: string) => void;
  remove: (id: string) => void;
  /** P10-09a: the paper's own note — made from its template the first time, without navigating — and its id.
   *  Both "Take notes" paths (a sticky, the notes window) call it. */
  ensureReadingNote: (paper: Citable, extras?: ReadingNoteExtras) => string;
  /** P10-09a (ruling §1h.78 (f)): append sticky `stickyCount + 1` to the note: an `h3` "Note N" carrying the
   *  anchor, and an empty text block. Null for a note that is not there. */
  addSticky: (
    noteId: string,
    at: {
      paperId: string;
      paragraphId: string;
      passage: string;
      /** P10-09f: the paragraph's text as the body renders it; the anchor then records where the passage stands in it. */
      paragraphText?: string;
    },
  ) => { id: string; n: number } | null;
  /** P10-09a: write a sticky's text through into its own blocks (one per paragraph); nothing else changes. */
  setStickyText: (noteId: string, headerId: string, text: string) => void;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: {},
      add: (note) => set((s) => ({ notes: { ...s.notes, [note.id]: note } })),
      save: (id, patch, at = new Date().toISOString()) =>
        set((s) => {
          const note = s.notes[id];
          if (!note) return s;
          return { notes: { ...s.notes, [id]: { ...note, ...patch, updatedAt: at } } };
        }),
      remove: (id) =>
        set((s) => {
          if (!s.notes[id]) return s;
          const notes = { ...s.notes };
          delete notes[id];
          return { notes };
        }),
      ensureReadingNote: (paper, extras) => {
        const own = readingNoteFor(get().notes, paper.id);
        if (own) return own.id;
        const note = readingNote(paper, extras);
        set((s) => ({ notes: { ...s.notes, [note.id]: note } }));
        return note.id;
      },
      addSticky: (noteId, at) => {
        const note = get().notes[noteId];
        if (!note) return null;
        const used = note.blocks.reduce((most, b) => Math.max(most, b.anchor?.n ?? 0), 0);
        const n = Math.max(note.stickyCount ?? 0, used) + 1;
        const place = at.paragraphText === undefined ? null : locatePassage(at.paragraphText, at.passage);
        const { header, blocks } = stickyBlocks({ paperId: at.paperId, paragraphId: at.paragraphId, quote: stickyQuote(at.passage), n, ...(place ?? {}) });
        set((s) => {
          const current = s.notes[noteId];
          if (!current) return s;
          const updatedAt = new Date().toISOString();
          return { notes: { ...s.notes, [noteId]: { ...current, blocks: [...current.blocks, ...blocks], stickyCount: n, updatedAt } } };
        });
        return { id: header.id, n };
      },
      setStickyText: (noteId, headerId, text) =>
        set((s) => {
          const note = s.notes[noteId];
          if (!note) return s;
          const blocks = withStickyText(note.blocks, headerId, text);
          if (blocks.length === note.blocks.length && blocks.every((b, i) => b === note.blocks[i])) return s;
          return { notes: { ...s.notes, [noteId]: { ...note, blocks, updatedAt: new Date().toISOString() } } };
        }),
    }),
    {
      name: "peer-notes",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ notes: s.notes }),
    },
  ),
);

export function useNotesHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useNotesStore.persist.onFinishHydration(onChange),
    () => useNotesStore.persist.hasHydrated(),
    () => false,
  );
}

export function newestFirst(notes: Record<string, Note>): Note[] {
  return Object.values(notes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The notes that cite this paper — its backlinks. */
export function notesCiting(notes: Record<string, Note>, paperId: string): Note[] {
  return newestFirst(notes).filter((note) =>
    citedKeys(note).some((key) => note.sources[key]?.paperId === paperId),
  );
}

/** The paper's own reading notes, if it has been given some. */
export function readingNoteFor(notes: Record<string, Note>, paperId: string): Note | undefined {
  return newestFirst(notes).find((note) => note.paperId === paperId);
}
