// The reader's questions for each paper, kept in this browser (P1-03,
// ruling §1f.9; blueprint §3.1 ① 问).
//
// "What do you want from this paper?" is asked per paper and may be left
// empty. The questions are the reader's own and stay in this browser —
// which is also why signing out does not clear them, the same reasoning as
// notes (`store/notes.ts`). The route that reads `items` runs here, live, as
// the reader types. P2-03 (§1g.11): the *settled* questions — copied from
// `items` when a line is finished (Enter, blur, removal) — travel with the
// one deep-report request that answers them, and with nothing else.
//
// Rehydrated after mount by <StoreHydrator/>, like the other stores, so the
// first client render matches the server's.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";

export const READING_QUESTIONS_STORAGE_KEY = "peer-reading-questions-v1";
export const MAX_QUESTIONS = 5;
export const MAX_QUESTION_CHARS = 200;
/** The most papers whose questions are kept; the oldest go first. */
export const MAX_QUESTION_PAPERS = 200;

export interface PaperQuestions {
  items: string[];
  /** "Just get the gist": route by the generic reading order, no answers. */
  gist: boolean;
  updatedAt: string;
  /** P2-03 (§1g.11 a): the questions as last settled — what a deep report
   *  is asked about. Absent until the first settle (and on an entry saved
   *  before it existed): read it through `settledQuestions`. */
  settled?: string[];
  /** P5-02: the questions (of `items`) the reader marked "Not for
   *  recommendations" — their terms never enter the preference ledger. Absent
   *  when none is marked, and on an entry saved before the mark existed. */
  notForRecs?: string[];
  /** P5-02: which of `settled` were marked when they were settled. */
  settledNotForRecs?: string[];
}

const NONE_SETTLED: readonly string[] = [];

/** The settled questions of an entry — none for an entry without them (one
 *  shared empty list, so a reader of it sees the same value each time). */
export function settledQuestions(entry: PaperQuestions | undefined): readonly string[] {
  return entry?.settled ?? NONE_SETTLED;
}

/** P5-02: the questions of an entry that stay out of the ledger — the marks as
 *  they stand and as they were when the questions last settled, so a question
 *  marked and then edited is never let in by the mark moving. */
export function notForRecommendations(entry: PaperQuestions | undefined): string[] {
  return [...(entry?.notForRecs ?? []), ...(entry?.settledNotForRecs ?? [])];
}

/** The marks that name a question of `kept` (trimmed, case-folded), as the
 *  kept questions' own text. */
function marksAmong(kept: readonly string[], marks: readonly string[] | undefined): string[] {
  const named = new Set((marks ?? []).map((m) => m.trim().toLocaleLowerCase()));
  return kept.filter((q) => named.has(q.toLocaleLowerCase()));
}

const sameList = (a: readonly string[] | undefined, b: readonly string[]) =>
  (a ?? []).length === b.length && b.every((q, i) => a![i] === q);

interface ReadingQuestionsState {
  /** Keyed by the paper's id as the page knows it (`upload:<hash16>` for a
   *  standalone upload). */
  byPaper: Record<string, PaperQuestions>;
  /** The paper asked about most recently — its questions are the "From your
   *  last paper" chips on the next one. */
  lastPaperId: string | null;
  /** Trims, drops empty lines, de-duplicates case-insensitively, keeps at
   *  most five of at most 200 characters, stamps `updatedAt` and
   *  `lastPaperId`. Nothing left and no gist: the paper is forgotten. */
  set: (
    paperId: string,
    items: readonly string[],
    gist: boolean,
    at?: string,
    /** P5-02: the questions marked "Not for recommendations"; when left out the
     *  marks stay on the questions that are still there. */
    notForRecs?: readonly string[],
  ) => void;
  /** P2-03: settle the paper's questions — `settled` becomes its (cleaned)
   *  `items`. A paper with no entry has nothing to settle. `set` never
   *  touches `settled`. */
  settle: (paperId: string) => void;
  clear: (paperId: string) => void;
}

/** The questions as they are kept: trimmed, non-empty, distinct, capped. */
export function cleanQuestions(items: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of items) {
    const question = raw.trim().slice(0, MAX_QUESTION_CHARS).trim();
    if (!question) continue;
    const key = question.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
    if (out.length === MAX_QUESTIONS) break;
  }
  return out;
}

function withoutOldest(byPaper: Record<string, PaperQuestions>): Record<string, PaperQuestions> {
  const entries = Object.entries(byPaper);
  if (entries.length <= MAX_QUESTION_PAPERS) return byPaper;
  entries.sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt));
  return Object.fromEntries(entries.slice(0, MAX_QUESTION_PAPERS));
}

export const useReadingQuestionsStore = create<ReadingQuestionsState>()(
  persist(
    (set) => ({
      byPaper: {},
      lastPaperId: null,
      set: (paperId, items, gist, at = new Date().toISOString(), notForRecs) =>
        set((s) => {
          const kept = cleanQuestions(items);
          if (kept.length === 0 && !gist) {
            if (!s.byPaper[paperId]) return s;
            const byPaper = { ...s.byPaper };
            delete byPaper[paperId];
            return { byPaper };
          }
          const previous = s.byPaper[paperId];
          const settled = previous?.settled;
          const marked = marksAmong(kept, notForRecs ?? previous?.notForRecs);
          return {
            byPaper: withoutOldest({
              ...s.byPaper,
              [paperId]: {
                items: kept,
                gist,
                updatedAt: at,
                ...(settled ? { settled } : {}),
                ...(marked.length ? { notForRecs: marked } : {}),
                ...(previous?.settledNotForRecs ? { settledNotForRecs: previous.settledNotForRecs } : {}),
              },
            }),
            lastPaperId: paperId,
          };
        }),
      settle: (paperId) =>
        set((s) => {
          const entry = s.byPaper[paperId];
          if (!entry) return s;
          const settled = cleanQuestions(entry.items);
          const marked = marksAmong(settled, entry.notForRecs);
          const same =
            entry.settled !== undefined &&
            entry.settled.length === settled.length &&
            entry.settled.every((question, i) => question === settled[i]) &&
            sameList(entry.settledNotForRecs, marked);
          if (same) return s;
          const { settledNotForRecs: _old, ...rest } = entry;
          void _old;
          return {
            byPaper: { ...s.byPaper, [paperId]: { ...rest, settled, ...(marked.length ? { settledNotForRecs: marked } : {}) } },
          };
        }),
      clear: (paperId) =>
        set((s) => {
          if (!s.byPaper[paperId]) return s;
          const byPaper = { ...s.byPaper };
          delete byPaper[paperId];
          return { byPaper };
        }),
    }),
    {
      name: READING_QUESTIONS_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ byPaper: s.byPaper, lastPaperId: s.lastPaperId }),
    },
  ),
);

export function useReadingQuestionsHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useReadingQuestionsStore.persist.onFinishHydration(onChange),
    () => useReadingQuestionsStore.persist.hasHydrated(),
    () => false,
  );
}
