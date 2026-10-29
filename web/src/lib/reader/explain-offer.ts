// Whether a settled selection has an "Explain this?" control on offer — the one flag between the explain box and the thumb bar
// (P9-41, ruling §1h.66; C P9-20's checkpoint §7 / §8 item 1).
//
// Below 768 px the control is a cell of the thumb bar's rail, not a pill over the paper's words: a fixed pill above the bar
// covered 1,790 to 2,473 px² of the lines that scroll under its corner, wherever it stood. The two halves live in different
// parts of the tree — the bar is in the shell's layout, the box is in the paper's page — so the box says, and the bar listens.
//
// Why a module-level store and not the `readerActions` channel the bar already imports (`reader-keys.ts`): that channel is a
// registry of imperative handlers (`next`, `explain`, …) read at the moment of a press; it holds no state and tells nobody when
// it changes, and the bar must DRAW differently while a selection stands. So the state is this one boolean with a subscription;
// the action stays the channel's — the cell calls the page's own `explain`, the same one the `e` key and the pill called, so the
// press has one meaning wherever it comes from. Nothing about the selection is held here (not its words, not its place).
//
// The box is the only writer: it publishes while the selection is settled, is the reader's to explain (a key, or a defined term of
// the paper), is on the screen, and the viewport is under 768 px; it takes the offer back when any of that stops being true and
// when the page is left. The bar is the only reader. A server render never sets it, so the server markup has no cell.
//
// P11-13 (B P11-03 §2.5; ruling §1h.113 (b) O-5): a second flag of the same kind for the bar's Highlight cell. The explain box keeps
// publishing its own; the selection toolbar (`selection-toolbar.tsx`) is the writer of this one, while a settled selection on the
// screen has a Highlight on offer (the page handed a handler and says the selection can be highlighted) and the viewport is under
// 768 px. The two are independent: the bar shows the cells that are on offer. Take notes on a phone stays deferred.

import { useSyncExternalStore } from "react";

/** One boolean with subscribers: the shape both flags share. */
function createOffer() {
  let on = false;
  const listeners = new Set<() => void>();
  return {
    get: () => on,
    set(next: boolean) {
      if (on === next) return;
      on = next;
      listeners.forEach((listener) => listener());
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const explain = createOffer();
const highlight = createOffer();
const note = createOffer();

/** Selection Take notes uses the same imperative page action as its keyboard route. */
export function setNoteOffer(next: boolean): void { note.set(next); }
export function noteOffered(): boolean { return note.get(); }
export function subscribeNoteOffer(listener: () => void): () => void { return note.subscribe(listener); }
export function useNoteOffer(): boolean { return useSyncExternalStore(subscribeNoteOffer, noteOffered, noteOffered); }

/** Whether a control is on offer for a settled selection right now. */
export function explainOffered(): boolean {
  return explain.get();
}

/** The box's word: a control is on offer (`true`) or it is not. Saying what is already so tells nobody. */
export function setExplainOffer(next: boolean): void {
  explain.set(next);
}

/** Call `listener` after each change; returns what stops it. */
export function subscribeExplainOffer(listener: () => void): () => void {
  return explain.subscribe(listener);
}

/** The bar's read. The server's answer is the live one too: nothing sets the flag on a server, and on the client it is false when the
 *  bar first renders (the box that sets it mounts after), so hydration agrees. */
export function useExplainOffer(): boolean {
  return useSyncExternalStore(subscribeExplainOffer, explainOffered, explainOffered);
}

/** Whether a Highlight is on offer for a settled selection right now (P11-13). */
export function highlightOffered(): boolean {
  return highlight.get();
}

/** The selection toolbar's word: a Highlight is on offer (`true`) or it is not. Saying what is already so tells nobody. */
export function setHighlightOffer(next: boolean): void {
  highlight.set(next);
}

/** Call `listener` after each change of the highlight offer; returns what stops it. */
export function subscribeHighlightOffer(listener: () => void): () => void {
  return highlight.subscribe(listener);
}

/** The bar's read of the highlight offer; the same server and hydration rule as `useExplainOffer`. */
export function useHighlightOffer(): boolean {
  return useSyncExternalStore(subscribeHighlightOffer, highlightOffered, highlightOffered);
}
