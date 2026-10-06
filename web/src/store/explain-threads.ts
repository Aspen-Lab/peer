// What "Explain this?" answered, kept in this browser (P3-02; ruling §1h.2;
// P3-02b's thread will live here too).
//
// Per paper and per passage: the passage, where it sits, the two-part answer,
// and — reserved for P3-02b's back-and-forth — the thread so far (always empty
// in P3-02). Opening a passage the reader already asked about shows its answer
// at once with no request. Nothing here is ever sent anywhere but the explain
// route (and P3-02b sends the thread only when the reader presses Enter); the
// server keeps none of it.
//
// A passage is the paper's own text, so for an uploaded PDF it is private
// text, in the reader's own browser — the same place their notes and questions
// are. Signing out does not clear it, as with those. It is bounded so it
// cannot fill the browser's storage: ≤32 passages per paper, the answers of
// ≤24 papers, oldest dropped first.
//
// Rehydrated after mount by <StoreHydrator/>, like the other stores.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizeForMatch } from "@/lib/papers/evidence";
import type { ExplainAnswer } from "@/lib/papers/explain";

export const EXPLAIN_THREADS_STORAGE_KEY = "peer-explain-threads-v1";
export const MAX_EXPLAIN_PASSAGES = 32;
export const MAX_EXPLAIN_PAPERS = 24;

/** One message of the thread (P3-02b). */
export interface ExplainTurn {
  role: "reader" | "peer";
  text: string;
}

export interface ExplainThread {
  /** The passage as the reader selected it (clipped), the key's source. */
  passage: string;
  /** Where it sits in the body, as the browser knew it when it asked. */
  sectionId: string;
  paragraphIndex: number;
  answer: ExplainAnswer;
  /** P3-02b's thread. Always `[]` in P3-02. */
  turns: ExplainTurn[];
  /** When the answer was kept (ISO). */
  at: string;
}

/**
 * The key a passage is kept under: a short hash of the passage as the
 * verifier reads it (case, whitespace and hyphen breaks folded), so the same
 * words selected again find their answer. Two 32-bit string hashes (FNV-1a and
 * djb2) and the length — a synchronous, dependency-free key, not a security
 * boundary: a collision is harmless because `explanationFor` also compares
 * the words.
 */
export function passageHash(passage: string): string {
  const text = normalizeForMatch(passage);
  let fnv = 0x811c9dc5;
  let djb = 5381;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 0x01000193);
    djb = ((djb << 5) + djb + code) | 0;
  }
  return `${text.length.toString(36)}-${(fnv >>> 0).toString(36)}-${(djb >>> 0).toString(36)}`;
}

type ByPaper = Record<string, Record<string, ExplainThread>>;

/** The kept answer for `passage` on `paperId`, if the same words were asked. */
export function explanationFor(byPaper: ByPaper, paperId: string, passage: string): ExplainThread | undefined {
  const found = byPaper[paperId]?.[passageHash(passage)];
  if (!found) return undefined;
  return normalizeForMatch(found.passage) === normalizeForMatch(passage) ? found : undefined;
}

interface ExplainThreadsState {
  byPaper: ByPaper;
  /** Keep (or replace) the answer for a passage; the thread already kept for it stays. */
  remember: (paperId: string, entry: Omit<ExplainThread, "turns" | "at">, at?: string) => void;
  forget: (paperId: string, hash: string) => void;
  clearPaper: (paperId: string) => void;
}

function newest(threads: Record<string, ExplainThread>): string {
  return Object.values(threads).reduce((latest, thread) => (thread.at > latest ? thread.at : latest), "");
}

/** At most 24 papers: those whose newest answer is oldest go first. */
function withoutOldestPapers(byPaper: ByPaper): ByPaper {
  const papers = Object.entries(byPaper);
  if (papers.length <= MAX_EXPLAIN_PAPERS) return byPaper;
  papers.sort((a, b) => newest(b[1]).localeCompare(newest(a[1])));
  return Object.fromEntries(papers.slice(0, MAX_EXPLAIN_PAPERS));
}

/** At most 32 passages: the oldest answers go first. */
function withoutOldestPassages(threads: Record<string, ExplainThread>): Record<string, ExplainThread> {
  const entries = Object.entries(threads);
  if (entries.length <= MAX_EXPLAIN_PASSAGES) return threads;
  entries.sort((a, b) => b[1].at.localeCompare(a[1].at));
  return Object.fromEntries(entries.slice(0, MAX_EXPLAIN_PASSAGES));
}

export const useExplainThreadsStore = create<ExplainThreadsState>()(
  persist(
    (set) => ({
      byPaper: {},
      remember: (paperId, entry, at = new Date().toISOString()) =>
        set((s) => {
          const key = passageHash(entry.passage);
          const threads = s.byPaper[paperId] ?? {};
          const turns = threads[key]?.turns ?? [];
          return {
            byPaper: withoutOldestPapers({
              ...s.byPaper,
              [paperId]: withoutOldestPassages({ ...threads, [key]: { ...entry, turns, at } }),
            }),
          };
        }),
      forget: (paperId, hash) =>
        set((s) => {
          const threads = s.byPaper[paperId];
          if (!threads?.[hash]) return s;
          const rest = { ...threads };
          delete rest[hash];
          const byPaper = { ...s.byPaper };
          if (Object.keys(rest).length === 0) delete byPaper[paperId];
          else byPaper[paperId] = rest;
          return { byPaper };
        }),
      clearPaper: (paperId) =>
        set((s) => {
          if (!s.byPaper[paperId]) return s;
          const byPaper = { ...s.byPaper };
          delete byPaper[paperId];
          return { byPaper };
        }),
    }),
    {
      name: EXPLAIN_THREADS_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ byPaper: s.byPaper }),
    },
  ),
);

export function useExplainThreadsHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useExplainThreadsStore.persist.onFinishHydration(onChange),
    () => useExplainThreadsStore.persist.hasHydrated(),
    () => false,
  );
}
