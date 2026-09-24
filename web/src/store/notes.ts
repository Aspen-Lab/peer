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
import type { Note } from "@/lib/notes/types";
import { citedKeys } from "@/lib/notes/blocks";

interface NotesState {
  notes: Record<string, Note>;
  add: (note: Note) => void;
  /** Write the editor's state back. Stamps `updatedAt`. */
  save: (id: string, patch: Partial<Pick<Note, "title" | "blocks" | "sources">>, at?: string) => void;
  remove: (id: string) => void;
}

export const useNotesStore = create<NotesState>()(
  persist(
    (set) => ({
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
