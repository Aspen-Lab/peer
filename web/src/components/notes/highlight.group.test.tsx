import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { highlightSelection, canHighlight, type HighlightTarget } from "./highlight";
import { useNotesStore, readingNoteFor } from "@/store/notes";
import { anchorMap } from "@/lib/notes/blocks";
import type { Paper } from "@/types";
const paper = { id: "p", title: "Invented paper", authors: [] } as unknown as Paper;
const rect = { left: 1, right: 30, top: 100, bottom: 120 };
const target: HighlightTarget = { sectionIndex: 0, paragraphIndex: 0, source: "paper", paragraphId: "paper-section-0-p0", passage: "first\n\nlast", bounds: rect, rect,
  segments: [{ paragraphId: "paper-section-0-p0", quote: "first", paragraphText: "first words", start: 0, end: 5, source: "paper" }, { paragraphId: "summary-method", quote: "last", paragraphText: "last words", start: 0, end: 4, source: "summary" }] };
const cleared = vi.fn();
beforeEach(() => { useNotesStore.setState({ notes: {} }); cleared.mockClear(); vi.stubGlobal("document", { getElementById: () => ({}) }); vi.stubGlobal("window", { getSelection: () => ({ removeAllRanges: cleared }) }); });
afterEach(() => vi.unstubAllGlobals());
it("one actual cross-block action makes one group with every selected range", () => {
  expect(canHighlight(target)).toBe(true);
  const made = highlightSelection(target, { paper });
  const note = readingNoteFor(useNotesStore.getState().notes, paper.id)!;
  expect(note.blocks.filter((b) => b.type === "highlight")).toHaveLength(1);
  expect(Object.values(anchorMap(note, paper.id)).flat().map((s) => s.id)).toEqual([made!.id, made!.id]);
  expect(cleared).toHaveBeenCalledTimes(1);
});
it("unavailable, detached and changed targets leave no note or partial group", () => {
  for (const extra of [{ unavailableReason: "Formula" }, { selectionStillHolds: () => false }, { measure: () => null }]) {
    expect(highlightSelection({ ...target, ...extra }, { paper })).toBeNull();
    expect(Object.keys(useNotesStore.getState().notes)).toHaveLength(0);
  }
  expect(cleared).not.toHaveBeenCalled();
});
