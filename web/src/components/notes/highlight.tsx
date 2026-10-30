"use client";

// P11-07 (owner item 8; B P11-04 §5; ruling §1h.112 D4, D5, D8): "Highlight" on a selection. The page's third selection action (beside
// "Explain this" and "Take notes"; the margin's own item draws the button) calls the `onHighlight` this makes:
//
//   1. `canHighlight(target)` — a selection in the paper's body, or (P11-28; ruling §1h.123 (c), which amends D8) in a Summary block or in an
//      answer: the block the selection reports (`paragraphId`: `summary-…`, `answers-block`) takes the place of a paragraph, and the words the
//      range is taken in are the block's own, read from its element (`readBlockText`), not the body the page hands over;
//   2. the paper's note — made the first time, without navigating, as "Take notes" makes it;
//   3. `addHighlight` — the passage, its paragraph, where the selection began (`target.offset`; for a block of the page, where the live selection
//      began in the block's words) so the occurrence the reader selected is the one marked, Yellow (D4: a new highlight is always Yellow); an
//      identical range already highlighted is returned as it is, not made twice;
//   4. the browser's selection cleared, so the mark shows clean and the margin's three actions leave;
//   5. the colour strip raised at the selection's first line (`useHighlightStrip`).
//
// It opens no window, reserves no column and is no stacked card: a highlight is quicker than that. It needs no key and no model (Tier 0)
// and sends nothing anywhere: the highlight is a block of the note in this browser.

import { useCallback } from "react";
import type { Paper } from "@/types";
import type { ReadingMarkStyle } from "@/lib/notes/types";
import type { QuestionAnswers } from "@/lib/papers/report";
import { citableFromPaper } from "@/lib/notes/cite";
import { DEFAULT_HIGHLIGHT_COLOUR } from "@/lib/notes/highlight-colours";
import { paragraphAnchor, type ExplainSelection, type ExplainSource } from "@/components/reader/paper-body";
import { isPageBlockId, readBlockText, selectionStartIn, type BlockText } from "@/lib/notes/anchor-blocks";
import { readingNoteFor, stripTagText, useNotesStore } from "@/store/notes";
import { domTextEnv } from "./block-marks";
import { useHighlightStrip } from "./highlight-strip";

/** A selection as the margin hands it over. `offset` is where it began in the paragraph's text (the selection reader's, P11-09). */
export type HighlightTarget = ExplainSelection & { offset?: number };

/**
 * Whether Highlight is offered for this selection. In the paper's body: it has a paragraph (or, P11-27, a heading or a caption). P11-28 (ruling §1h.123 (c)): in a
 * Summary block or an answer too, when the selection names the block of the page it is in (`paragraphId`: a `summary-…` block, or `answers-block`) — a selection
 * reported under the bare kind (a block with no id of its own) has no element to read the words of. P11-50 (ruling §1h.155 rule 1): not offered for a selection whose two ends
 * are in two blocks of one Summary or answer container (`spansBlocks`, set by the selection reader): a highlight is one block's words (D5), so there is nothing to mark across
 * two, and a button that makes nothing is not offered. Pure.
 */
export function canHighlight(
  target:
    | { source?: ExplainSource; sectionIndex: number; paragraphIndex: number; passage: string; paragraphId?: string; spansBlocks?: boolean }
    | null
    | undefined,
): boolean {
  if (!target) return false;
  if (target.spansBlocks === true) return false;
  if (target.source !== undefined && target.source !== "paper") return target.passage.trim() !== "" && isPageBlockId(target.paragraphId);
  return (
    Number.isInteger(target.sectionIndex) &&
    target.sectionIndex >= 0 &&
    Number.isInteger(target.paragraphIndex) &&
    target.paragraphIndex >= 0 &&
    target.passage.trim() !== ""
  );
}

/** `text` with every run of white space one space, trimmed: how a selection's words are compared. */
const collapsed = (text: string) => text.replace(/\s+/g, " ").trim();

/**
 * P11-28: the words of the page block a selection is in, read from the block's element — and where the reader's selection began in them, when the live selection is the
 * one the target was made from (its words are the target's; a selection made since, or none, gives no hint and the first occurrence of the words stands). Null when the
 * block is not on the page: there is nothing to mark, and nothing is made.
 */
function pageBlockWords(target: HighlightTarget): { words: BlockText; hint: number | undefined } | null {
  const root = typeof document === "undefined" || !target.paragraphId ? null : document.getElementById(target.paragraphId);
  if (!root) return null;
  const words = readBlockText(root, domTextEnv());
  if (target.offset !== undefined) return { words, hint: target.offset };
  const live = typeof window === "undefined" ? null : window.getSelection?.();
  const same = live && live.rangeCount > 0 && !live.isCollapsed && collapsed(live.toString()) === collapsed(target.passage);
  return { words, hint: same ? selectionStartIn(words, live.getRangeAt(0) as never) : undefined };
}

/**
 * Highlight the selection: steps 1 to 5 above. Returns the highlight's block id and whether it was made now (`created`), or null when
 * nothing was made — a selection that is neither the paper's body nor a block of the page, no paragraph text (or, P11-28, no block on the page) to find the
 * words in, or the passage is not found whole in its paragraph or block — in which case the selection is left as it was, no strip is raised, and a note made for it
 * is taken away again.
 */
export function highlightSelection(
  target: HighlightTarget,
  input: {
    paper: Paper;
    questions?: readonly string[];
    forYourQuestions?: readonly QuestionAnswers[];
    /** The paper's body as the page renders it; the paragraph the selection is in gives the highlight its range. */
    body?: readonly { paragraphs: readonly string[] }[];
    style?: ReadingMarkStyle;
  },
): { id: string; created: boolean } | null {
  if (!canHighlight(target)) return null;
  // P11-28: a block of the page — the words and the hint are the block's, read now; its id is the one the selection reported.
  const onPage = target.source !== undefined && target.source !== "paper";
  const page = onPage ? pageBlockWords(target) : null;
  if (onPage && !page) return null;
  // P11-27 (rule 2): the lookup knows a section's paragraphs; the words of a heading or a caption (an index past the paragraphs) are read by the store from the body on
  // show (`addHighlight`), which makes nothing where it has none either.
  const paragraphText = page ? page.words.text : input.body?.[target.sectionIndex]?.paragraphs[target.paragraphIndex];
  const had = readingNoteFor(useNotesStore.getState().notes, input.paper.id) !== undefined;
  const noteId = useNotesStore.getState().ensureReadingNote(citableFromPaper(input.paper), {
    questions: input.questions,
    forYourQuestions: input.forYourQuestions,
  });
  const made = useNotesStore.getState().addHighlight(noteId, {
    paperId: input.paper.id,
    paragraphId: page ? (target.paragraphId as string) : paragraphAnchor(target.sectionIndex, target.paragraphIndex),
    passage: stripTagText(target.passage),
    paragraphText,
    hint: page ? page.hint : target.offset,
    colour: DEFAULT_HIGHLIGHT_COLOUR,
    ...(input.style === "bold" || input.style === "circle" ? { mark: input.style } : {}),
  });
  if (!made) {
    if (!had) useNotesStore.getState().remove(noteId);
    return null;
  }
  if (!made.created && input.style) useNotesStore.getState().setHighlightStyle(noteId, made.id, input.style);
  // The selection's own line is measured before the selection is cleared: `measure` reads the live range.
  const top = target.measure?.()?.bounds.top ?? target.bounds.top;
  if (typeof window !== "undefined") window.getSelection()?.removeAllRanges();
  if (!input.style || input.style === "highlight") useHighlightStrip.getState().show(made.id, top);
  else useHighlightStrip.getState().hide();
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
}): (target: HighlightTarget, style?: ReadingMarkStyle) => void {
  return useCallback(
    (target: HighlightTarget, style?: ReadingMarkStyle) => {
      highlightSelection(target, { paper, questions, forYourQuestions, body, style });
    },
    [paper, questions, forYourQuestions, body],
  );
}
