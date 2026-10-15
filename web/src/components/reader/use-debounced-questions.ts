"use client";

// P7-13 (R11b, the owner's R11): the page's copy of the reader's questions, one that waits for the
// typing to pause.
//
// The page used to subscribe to the question store itself, so every keystroke in "Before you read"
// (the field writes each one through to the store) re-rendered the whole reading page: the route
// over all five questions, the scan for the terms the paper defines, and every child — 290-320 ms a
// key in the browser (P7-03 §10). Here the page subscribes through this hook instead: it reads the
// store with `subscribe`, which costs nothing per keystroke, and hands the page a new value 250 ms
// after the last change. The field's own writes, and the store's persistence, are unchanged; only
// the page's reading of them waits, so the tints, the vague hint and the example tags follow the
// typing 250 ms after it stops, not on every key (§1f.13, §1f.18 (a) as amended).
//
// A settle is not a keystroke: when this paper's `settled` set changes (Submit, Enter on an empty
// last line, a ×, a tick; or the store rehydrating a visit's settled set after mount) the page is
// told at once, with whatever was typed, so the deep report is asked the moment the reader says
// the questions are done.

import { useEffect, useState } from "react";
import { useReadingQuestionsStore, type PaperQuestions } from "@/store/reading-questions";

/** How long the typing must pause before the page reads it. */
export const QUESTIONS_DEBOUNCE_MS = 250;

type ByPaper = Record<string, PaperQuestions>;

/**
 * The reader's questions as the page reads them: this paper's entry (`asked`) and the whole map
 * (`byPaper`, for the example tags drawn from earlier papers). Both are the store's own objects, so
 * an entry that did not change is the same object it was.
 */
export function useDebouncedQuestions(
  paperId: string,
  delayMs: number = QUESTIONS_DEBOUNCE_MS,
): { asked: PaperQuestions | undefined; byPaper: ByPaper } {
  const [byPaper, setByPaper] = useState<ByPaper>(() => useReadingQuestionsStore.getState().byPaper);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cancel = () => {
      if (timer === null) return;
      clearTimeout(timer);
      timer = null;
    };
    // The latest state at the time, not the state of the change that started the wait. The same
    // map as the page already holds sets nothing.
    const publish = () => {
      timer = null;
      setByPaper(useReadingQuestionsStore.getState().byPaper);
    };
    const later = () => {
      cancel();
      timer = setTimeout(publish, delayMs);
    };

    const unsubscribe = useReadingQuestionsStore.subscribe((state, previous) => {
      if (state.byPaper === previous.byPaper) return;
      if (state.byPaper[paperId]?.settled !== previous.byPaper[paperId]?.settled) {
        cancel();
        publish();
        return;
      }
      later();
    });
    // The store may have changed between the page's render and this subscription (it is rehydrated
    // after mount): one look after the wait finds out, and sets nothing when nothing changed.
    later();

    return () => {
      unsubscribe();
      cancel();
    };
  }, [paperId, delayMs]);

  return { asked: byPaper[paperId], byPaper };
}
