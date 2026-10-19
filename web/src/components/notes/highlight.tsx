"use client";

// P11-07 (owner item 8; B P11-04 §5; ruling §1h.112 D4, D5, D8): "Highlight" on a selection. The page's third selection action (beside
// "Explain this" and "Take notes"; the margin's own item draws the button) calls the `onHighlight` this makes:
//
//   1. `canHighlight(target)` — only a selection in the paper's body; a Summary or an answer has no paragraph to mark (D8);
//   2. the paper's note — made the first time, without navigating, as "Take notes" makes it;
//   3. `addHighlight` — the passage, its paragraph, where the selection began (`target.offset`) so the occurrence the reader
//      selected is the one marked, Yellow (D4: a new highlight is always Yellow); an identical range already highlighted is
//      returned as it is, not made twice;
//   4. the browser's selection cleared, so the mark shows clean and the margin's three actions leave;
//   5. the colour strip raised at the selection's first line (`useHighlightStrip`).
//
// It opens no window, reserves no column and is no stacked card: a highlight is quicker than that. It needs no key and no model (Tier 0)
// and sends nothing anywhere: the highlight is a block of the note in this browser.

import { useCallback } from "react";
import type { Paper } from "@/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { citableFromPaper } from "@/lib/notes/cite";
import { DEFAULT_HIGHLIGHT_COLOUR } from "@/lib/notes/highlight-colours";
import { paragraphAnchor, type ExplainSelection, type ExplainSource } from "@/components/reader/paper-body";
import { readingNoteFor, stripTagText, useNotesStore } from "@/store/notes";
import { useHighlightStrip } from "./highlight-strip";

/** A selection as the margin hands it over. `offset` is where it began in the paragraph's text (the selection reader's, P11-09). */
export type HighlightTarget = ExplainSelection & { offset?: number };

/** Whether Highlight is offered for this selection: it is in the paper's body, not in the Summary or an answer. Pure. */
export function canHighlight(
  target: { source?: ExplainSource; sectionIndex: number; paragraphIndex: number; passage: string } | null | undefined,
): boolean {
  if (!target) return false;
  if (target.source !== undefined && target.source !== "paper") return false;
  return (
    Number.isInteger(target.sectionIndex) &&
    target.sectionIndex >= 0 &&
    Number.isInteger(target.paragraphIndex) &&
    target.paragraphIndex >= 0 &&
    target.passage.trim() !== ""
  );
}

/**
 * Highlight the selection: steps 1 to 5 above. Returns the highlight's block id and whether it was made now (`created`), or null when
 * nothing was made — not the paper's body, no paragraph text to find the words in, or the passage is not found whole in its paragraph —
 * in which case the selection is left as it was, no strip is raised, and a note made for it is taken away again.
 */
export function highlightSelection(
  target: HighlightTarget,
  input: {
    paper: Paper;
    questions?: readonly string[];
    forYourQuestions?: readonly QuestionAnswers[];
    /** The paper's body as the page renders it; the paragraph the selection is in gives the highlight its range. */
    body?: readonly { paragraphs: readonly string[] }[];
  },
): { id: string; created: boolean } | null {
  if (!canHighlight(target)) return null;
  const paragraphText = input.body?.[target.sectionIndex]?.paragraphs[target.paragraphIndex];
  if (paragraphText === undefined) return null;
  const had = readingNoteFor(useNotesStore.getState().notes, input.paper.id) !== undefined;
  const noteId = useNotesStore.getState().ensureReadingNote(citableFromPaper(input.paper), {
    questions: input.questions,
    forYourQuestions: input.forYourQuestions,
  });
  const made = useNotesStore.getState().addHighlight(noteId, {
    paperId: input.paper.id,
    paragraphId: paragraphAnchor(target.sectionIndex, target.paragraphIndex),
    passage: stripTagText(target.passage),
    paragraphText,
    hint: target.offset,
    colour: DEFAULT_HIGHLIGHT_COLOUR,
  });
  if (!made) {
    if (!had) useNotesStore.getState().remove(noteId);
    return null;
  }
  // The selection's own line is measured before the selection is cleared: `measure` reads the live range.
  const top = target.measure?.()?.bounds.top ?? target.bounds.top;
  if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  useHighlightStrip.getState().show(made.id, top);
  return made;
}

/** The page's `onHighlight` action: the same shape as `useTakeNote`. */
export function useHighlight({
  paper,
  questions,
  forYourQuestions,
  body,
}: {
  paper: Paper;
  questions?: readonly string[];
  forYourQuestions?: readonly QuestionAnswers[];
  /** The paper's body as the page renders it. */
  body?: readonly { paragraphs: readonly string[] }[];
}): (target: HighlightTarget) => void {
  return useCallback(
    (target: HighlightTarget) => {
      highlightSelection(target, { paper, questions, forYourQuestions, body });
    },
    [paper, questions, forYourQuestions, body],
  );
}
