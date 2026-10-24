import { beforeEach, expect, it } from "vitest";
import { anchorMap } from "@/lib/notes/blocks";
import { toMarkdown, toPlainText, toPrintHtml } from "@/lib/notes/export";
import { useNotesStore } from "./notes";

const paper = { id: "range-paper", title: "Invented range paper", authors: [] };
const segments = [
  { paragraphId: "paper-section-0-p0", quote: "tide pools", start: 15, end: 25, paragraphText: "tide pools and tide pools", source: "paper" as const },
  { paragraphId: "paper-section-0-p1", quote: "Second whole paragraph.", start: 0, end: 23, paragraphText: "Second whole paragraph.", source: "paper" as const },
  { paragraphId: "summary-method", quote: "selected ending", start: 5, end: 20, paragraphText: "Only selected ending remains.", source: "summary" as const },
];
beforeEach(() => useNotesStore.setState({ notes: {} }));
it("makes one persisted group for ordered actual segments, idempotently, with every mark", () => {
  const store = useNotesStore.getState();
  const id = store.ensureReadingNote(paper);
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments });
  expect(made?.created).toBe(true);
  expect(store.addHighlightGroup(id, { paperId: paper.id, segments })).toEqual({ id: made!.id, created: false });
  const stored = JSON.parse(JSON.stringify(useNotesStore.getState().notes[id]));
  expect(stored.blocks.filter((b: { type: string }) => b.type === "highlight")).toHaveLength(1);
  const marks = anchorMap(stored, paper.id);
  expect(Object.keys(marks)).toEqual(segments.map((s) => s.paragraphId));
  segments.forEach((s) => expect(marks[s.paragraphId][0]).toMatchObject({ id: made!.id, start: s.start, end: s.end, quote: s.quote }));
});
it("validates the entire group before making any change, including exact occurrence offsets", () => {
  const store = useNotesStore.getState();
  const id = store.ensureReadingNote(paper);
  const before = useNotesStore.getState().notes[id];
  expect(store.addHighlightGroup(id, { paperId: paper.id, segments: [...segments, { ...segments[0], start: 2 }] })).toBeNull();
  expect(store.addHighlightGroup(id, { paperId: paper.id, segments: [] })).toBeNull();
  expect(useNotesStore.getState().notes[id]).toBe(before);
});
it("recolours/removes all segments together after reload while exports keep every word in order", () => {
  const store = useNotesStore.getState();
  const id = store.ensureReadingNote(paper);
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  useNotesStore.setState({ notes: JSON.parse(JSON.stringify(useNotesStore.getState().notes)) });
  store.setHighlightColour(id, made.id, "blue");
  const note = useNotesStore.getState().notes[id];
  const marks = anchorMap(note, paper.id);
  expect(Object.values(marks).flat().every((s) => s.colour === "blue")).toBe(true);
  for (const output of [toMarkdown(note), toPlainText(note), toPrintHtml(note)]) {
    let last = -1;
    for (const s of segments) { const at = output.indexOf(s.quote); expect(at).toBeGreaterThan(last); last = at; }
  }
  store.removeHighlight(id, made.id);
  expect(Object.keys(anchorMap(useNotesStore.getState().notes[id], paper.id))).toHaveLength(0);
});
