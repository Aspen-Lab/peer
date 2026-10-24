import { beforeEach, expect, it } from "vitest";
import { takeStickyNote } from "./sticky-note";
import { useNotesStore, readingNoteFor } from "@/store/notes";
import { useWindows } from "@/lib/reader/windows";
import { toMarkdown, toPlainText, toPrintHtml } from "@/lib/notes/export";
const paper = { id: "range-note", title: "Invented range", authors: [] };
const target = { sectionIndex: 0, paragraphIndex: 0, source: "paper" as const, passage: "selected first\n\nselected last",
  segments: [{ paragraphId: "paper-section-0-p0", quote: "selected first", start: 4, end: 18, paragraphText: "not selected first remains", source: "paper" as const }, { paragraphId: "summary-method", quote: "selected last", start: 0, end: 13, paragraphText: "selected last remains", source: "summary" as const }] };
beforeEach(() => { useNotesStore.setState({ notes: {} }); useWindows.setState({ windows: [], clock: 0 }); });
it("makes one source-aware sticky, primary anchor first, complete provenance outside exports", () => {
  const made = takeStickyNote(target, paper)!;
  const store = useNotesStore.getState(), note = readingNoteFor(store.notes, paper.id)!;
  const header = note.blocks.find((b) => b.id === made.id)!;
  expect(note.stickyCount).toBe(1);
  expect(header.anchor).toMatchObject({ paragraphId: "paper-section-0-p0", quote: "selected first", start: 4, end: 18 });
  expect(header.anchor!.segments).toHaveLength(2);
  expect(JSON.stringify(header.anchor)).not.toContain("remains");
  store.setStickyText(note.id, made.id, "My own words");
  const written = useNotesStore.getState().notes[note.id];
  for (const text of [toMarkdown(written), toPlainText(written), toPrintHtml(written)]) {
    expect(text).toContain("My own words");
    expect(text).not.toContain("selected first");
    expect(text).not.toContain("selected last");
  }
});
it("does not invent a note for unavailable or stale ranges", () => {
  expect(takeStickyNote({ ...target, unavailableReason: "Formula" }, paper)).toBeNull();
  expect(takeStickyNote({ ...target, selectionStillHolds: () => false }, paper)).toBeNull();
  expect(Object.keys(useNotesStore.getState().notes)).toHaveLength(0);
});
