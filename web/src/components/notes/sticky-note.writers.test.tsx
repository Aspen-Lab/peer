import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickyText } from "@/lib/notes/blocks";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { makeStickyWriter, registerStickyWriter, removeEmptyStickies, takeStickyNote } from "./sticky-note";

// P10-29 (BACKLOG-71): the sticky's write carries the text it last saw, so the store can merge it with an outside change;
// an empty sticky left open when the reader leaves the page is removed with its anchor. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const QUOTE = "The finest grains crept fastest when the specimens were annealed at the lowest temperature of the series.";
const target = { sectionIndex: 0, paragraphIndex: 1, passage: QUOTE };
const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1")!;
const source = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

describe("makeStickyWriter — carries the text it last saw (P10-29)", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the text with the base it was synced to", () => {
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.sync("stored words");
    writer.push("stored words, more");
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledWith("stored words, more", "stored words");
  });

  it("takes what the store holds after its own write as the next base, so its words are never merged with themselves", () => {
    const writes: [string, string | undefined][] = [];
    const writer = makeStickyWriter((text, base) => {
      writes.push([text, base]);
      return text; // what the store now holds
    });
    writer.sync("");
    writer.push("x");
    vi.advanceTimersByTime(300);
    writer.push("xy");
    vi.advanceTimersByTime(300);
    expect(writes).toEqual([
      ["x", ""],
      ["xy", "x"],
    ]);
  });

  it("two writers on one block within half a second: the sticky's late write keeps the window's words in the store", () => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
    const made = takeStickyNote(target, PAPER)!;
    const id = noteOf().id;
    const stored = () => stickyText(useNotesStore.getState().notes[id].blocks, made.id);
    const writer = makeStickyWriter((text, base) => {
      useNotesStore.getState().setStickyText(id, made.id, text, base);
      return stored();
    });
    writer.sync(stored());
    writer.push("sticky words");
    vi.advanceTimersByTime(300);
    expect(stored()).toBe("sticky words");
    // The window's save lands inside the sticky's next write window.
    writer.push("sticky words and more");
    const edited = useNotesStore.getState().notes[id].blocks.map((b) => (b.text === "sticky words" ? { ...b, text: "window: sticky words" } : b));
    useNotesStore.getState().save(id, { blocks: edited });
    vi.advanceTimersByTime(300);
    expect(stored()).toBe("window: sticky words and more");
  });
});

describe("an empty sticky left open is removed when the reader leaves (P10-29, rule 2)", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });

  it("removes the open stickies that hold no words, with their anchors, and keeps the ones with words", () => {
    const first = takeStickyNote(target, PAPER)!;
    const second = takeStickyNote(target, PAPER)!;
    const third = takeStickyNote(target, PAPER)!;
    useNotesStore.getState().setStickyText(noteOf().id, second.id, "worth keeping");
    removeEmptyStickies("p1");
    const ids = noteOf().blocks.filter((b) => b.anchor).map((b) => b.id);
    expect(ids).toEqual([second.id]);
    expect(noteOf().blocks.some((b) => b.id === first.id || b.id === third.id)).toBe(false);
    expect(stickyText(noteOf().blocks, second.id)).toBe("worth keeping");
  });

  it("does not renumber: the removed numbers stay spent, the next sticky is Note 4", () => {
    takeStickyNote(target, PAPER);
    const second = takeStickyNote(target, PAPER)!;
    takeStickyNote(target, PAPER);
    useNotesStore.getState().setStickyText(noteOf().id, second.id, "words");
    removeEmptyStickies("p1");
    expect(noteOf().blocks.filter((b) => b.anchor).map((b) => b.anchor?.n)).toEqual([2]);
    expect(takeStickyNote(target, PAPER)?.n).toBe(4);
  });

  it("writes a keystroke still waiting first: a sticky typed in and not yet written is not empty", () => {
    vi.useFakeTimers();
    try {
      const made = takeStickyNote(target, PAPER)!;
      const id = noteOf().id;
      const writer = makeStickyWriter((text, base) => useNotesStore.getState().setStickyText(id, made.id, text, base));
      const unregister = registerStickyWriter(made.id, writer);
      writer.push("typed just before leaving");
      removeEmptyStickies("p1");
      expect(stickyText(noteOf().blocks, made.id)).toBe("typed just before leaving");
      unregister();
    } finally {
      vi.useRealTimers();
    }
  });

  it("leaves a paper it has no note for, and stickies that are not open, alone", () => {
    expect(() => removeEmptyStickies("none")).not.toThrow();
    const made = takeStickyNote(target, PAPER)!;
    useWindows.setState({ windows: [], clock: 0 }); // not open
    removeEmptyStickies("p1");
    expect(noteOf().blocks.some((b) => b.id === made.id)).toBe(true);
  });
});

describe("the page's leaving is watched (P10-29, rule 2) — the source", () => {
  const src = source("./sticky-note.tsx");

  it("StickyNotes removes the empty stickies on pagehide and when it unmounts, before it closes the windows", () => {
    const sticky = src.slice(src.indexOf("export function StickyNotes"));
    expect(sticky).toContain('addEventListener("pagehide"');
    expect(sticky).toContain('removeEventListener("pagehide"');
    const removal = sticky.indexOf("removeEmptyStickies(");
    const closing = sticky.indexOf("close(w.id)");
    expect(removal).toBeGreaterThan(-1);
    expect(removal).toBeLessThan(closing);
  });

  it("each open sticky registers its writer, so the leave can write what is typed first", () => {
    expect(src).toContain("registerStickyWriter(row.id, writer)");
  });

  it("the structured sticky's write carries the blocks it last saw (P12 item 1)", () => {
    expect(src).toContain("writer.sync(stored)");
    expect(src).toContain("setStickyBlocks(noteId, row.id, JSON.parse(next) as Block[], base ? JSON.parse(base) as Block[] : undefined)");
  });
});
