import { beforeEach, describe, expect, it } from "vitest";
import { block, stickySpan } from "@/lib/notes/blocks";
import { useNotesStore } from "./notes";

const paper = { id: "structured-paper", title: "Invented notes", authors: [] };
const at = { paperId: paper.id, paragraphId: "paper-section-0-p0", passage: "Invented passage" };
describe("structured sticky ownership", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  it("owns lists and headings without absorbing another note, and deletes all its content", () => {
    const store = useNotesStore.getState();
    const id = store.ensureReadingNote(paper);
    const one = store.addSticky(id, at)!;
    const two = store.addSticky(id, at)!;
    store.setStickyBlocks(id, one.id, [block("bullet", "parent"), block("bullet", "child", { indent: 1 }), block("h2", "Own heading")]);
    const before = useNotesStore.getState().notes[id];
    const span = stickySpan(before.blocks, one.id)!;
    expect(before.blocks.slice(span.start + 1, span.end).map((b) => b.type)).toEqual(["bullet", "bullet", "h2"]);
    expect(before.blocks[span.end].id).toBe(two.id);
    store.removeSticky(id, one.id);
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === one.id || b.stickyId === one.id)).toBe(false);
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === two.id)).toBe(true);
    store.save(id, { blocks: before.blocks });
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === one.id || b.stickyId === one.id)).toBe(false);
  });
  it("keeps an explicitly saved empty note, but Escape cleanup drops an unsaved empty note", () => {
    const store = useNotesStore.getState();
    const id = store.ensureReadingNote(paper);
    const one = store.addSticky(id, at)!;
    const two = store.addSticky(id, at)!;
    store.saveSticky(id, one.id);
    store.removeEmptySticky(id, one.id);
    store.removeEmptySticky(id, two.id);
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === one.id)).toBe(true);
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === two.id)).toBe(false);
  });
  it("merges concurrent words while retaining list metadata and ignores writes after deletion", () => {
    const store = useNotesStore.getState();
    const id = store.ensureReadingNote(paper);
    const one = store.addSticky(id, at)!;
    const original = block("bullet", "base");
    store.setStickyBlocks(id, one.id, [original]);
    store.setStickyBlocks(id, one.id, [{ ...original, text: "base outside" }], [original]);
    store.setStickyBlocks(id, one.id, [{ ...original, text: "mine base", indent: 1 }], [original]);
    const kept = useNotesStore.getState().notes[id].blocks.find((b) => b.id === original.id)!;
    expect(kept.text).toContain("mine");
    expect(kept.text).toContain("outside");
    expect(kept.type).toBe("bullet");
    expect(kept.indent).toBe(1);
    store.removeSticky(id, one.id);
    store.setStickyBlocks(id, one.id, [original]);
    expect(useNotesStore.getState().notes[id].blocks.some((b) => b.id === one.id || b.id === original.id)).toBe(false);
  });
});
