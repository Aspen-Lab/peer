import { beforeEach, expect, it } from "vitest";
import { anchorMap } from "@/lib/notes/blocks";
import { toMarkdown, toPlainText, toPrintHtml } from "@/lib/notes/export";
import { repairAnchors, resolveAnchors, useNotesStore } from "./notes";

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
it("compares the entire ordered range, not just its first segment", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const a = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  const b = store.addHighlightGroup(id, { paperId: paper.id, segments: segments.slice(0, 2) })!;
  expect(a.id).not.toBe(b.id);
  expect(useNotesStore.getState().notes[id].blocks.filter((b) => b.type === "highlight")).toHaveLength(2);
});
it("repairs every moved segment separately and keeps loss reports stable for a partly lost group", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  const before = useNotesStore.getState().notes[id];
  const result = resolveAnchors([{ paragraphs: ["gone", "gone", "tide pools and tide pools", "Second whole paragraph."] }], anchorMap(before, paper.id));
  expect(result.fixes).toHaveLength(2);
  repairAnchors(result.fixes);
  const spot = useNotesStore.getState().notes[id].blocks.find((b) => b.id === made.id)!.highlight!;
  expect(spot.paragraphId).toBe("paper-section-0-p2");
  expect(spot.segments!.map((s) => s.paragraphId)).toEqual(["paper-section-0-p2", "paper-section-0-p3", "summary-method"]);
  const absent = resolveAnchors([{ paragraphs: ["gone"] }], anchorMap(useNotesStore.getState().notes[id], paper.id));
  expect(absent.lost).toEqual([made.id]);
  expect(spot.segments).toHaveLength(3);
});
it("retains a newly added group when a full-note editor saves an older snapshot", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const snapshot = JSON.parse(JSON.stringify(useNotesStore.getState().notes[id].blocks));
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  store.save(id, { blocks: snapshot });
  expect(useNotesStore.getState().notes[id].blocks.filter((b) => b.id === made.id)).toHaveLength(1);
  expect(Object.keys(anchorMap(useNotesStore.getState().notes[id], paper.id))).toHaveLength(3);
});
it("a stale full-note save cannot resurrect a removed group or roll back its atomic colour", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  const snapshot = JSON.parse(JSON.stringify(useNotesStore.getState().notes[id].blocks));
  store.setHighlightColour(id, made.id, "pink");
  store.save(id, { blocks: snapshot });
  expect(Object.values(anchorMap(useNotesStore.getState().notes[id], paper.id)).flat().every((s) => s.colour === "pink")).toBe(true);
});
it("a stale full-note save cannot resurrect a removed group", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const made = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  const snapshot = JSON.parse(JSON.stringify(useNotesStore.getState().notes[id].blocks));
  store.removeHighlight(id, made.id);
  store.save(id, { blocks: snapshot });
  expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === made.id)).toBe(false);
});
it("a scoped structured sticky writer preserves group metadata and saved-empty semantics", () => {
  const store = useNotesStore.getState(), id = store.ensureReadingNote(paper);
  const group = store.addHighlightGroup(id, { paperId: paper.id, segments })!;
  const sticky = store.addSticky(id, { paperId: paper.id, paragraphId: segments[0].paragraphId, passage: segments[0].quote, paragraphText: segments[0].paragraphText })!;
  store.saveSticky(id, sticky.id);
  store.setStickyBlocks(id, sticky.id, [{ id: "nested", type: "bullet", indent: 2, text: "My words", stickyId: sticky.id }]);
  expect(useNotesStore.getState().notes[id].blocks.find((b) => b.id === group.id)!.highlight!.segments).toHaveLength(3);
  expect(useNotesStore.getState().notes[id].blocks.find((b) => b.id === sticky.id)!.stickySaved).toBe(true);
  store.removeSticky(id, sticky.id);
  store.setStickyBlocks(id, sticky.id, [{ id: "late", type: "text", text: "late writer" }]);
  expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === "late")).toBe(false);
  expect(useNotesStore.getState().notes[id].blocks.find((b) => b.id === group.id)!.highlight!.segments).toHaveLength(3);
});
