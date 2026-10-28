import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickySpan, stickyText } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { STICKY_SAVE_MS, makeStickyWriter, stickyFollow, takeStickyNote } from "./sticky-note";

// P12-66 rule 3 (ruling §1h.437): nothing else changes. The follow itself — a keystroke of the sticky's own that waits is never overwritten, what the
// sticky wrote is never taken back, a change of the notes window is taken once the sticky is idle, the stored blocks become the base of the next
// write — and the 150 ms writer are as they were before the focus moved into the decision. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const QUOTE = "The finest grains crept fastest when the specimens were annealed at the lowest temperature of the series.";

const writerOf = (pending: boolean) => ({ pending: () => pending, sync: vi.fn() });
const stored = JSON.stringify([{ id: "b1", type: "text", text: "hello sticky bbb" }]);
const shown = [{ id: "b1", type: "text", text: "hello sticky" }] as Block[];

describe("stickyFollow — the follow as it was (P12-66, rule 3)", () => {
  it("takes the stored blocks as the base of its next write, and follows nothing while a keystroke of its own waits", () => {
    const idle = writerOf(false);
    stickyFollow({ stored, content: shown, writer: idle, held: false });
    expect(idle.sync).toHaveBeenCalledWith(stored);
    const waiting = writerOf(true);
    expect(stickyFollow({ stored, content: shown, writer: waiting, held: true })).toBeNull();
    expect(waiting.sync).not.toHaveBeenCalled();
  });

  it("does not start the editor afresh when the store holds what the editor shows, whether or not it holds the focus", () => {
    expect(stickyFollow({ stored: JSON.stringify(shown), content: shown, writer: writerOf(false), held: true })).toBeNull();
    expect(stickyFollow({ stored: JSON.stringify(shown), content: shown, writer: writerOf(false), held: false })).toBeNull();
  });

  it("starts it afresh on the stored blocks themselves, whoever holds the focus", () => {
    for (const held of [true, false]) {
      expect(stickyFollow({ stored, content: shown, writer: writerOf(false), held })?.content).toEqual(JSON.parse(stored));
    }
  });
});

describe("a sticky and the notes window on one note — the follow and the writer as before (P12-66, rule 3)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });
  afterEach(() => vi.useRealTimers());

  it("the writer is still 150 ms behind the last keystroke", () => {
    expect(STICKY_SAVE_MS).toBe(150);
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.push("a");
    vi.advanceTimersByTime(STICKY_SAVE_MS - 1);
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it("the sticky's own write is never taken back, and a change of the window is taken once the sticky is idle", () => {
    const made = takeStickyNote({ sectionIndex: 0, paragraphIndex: 1, passage: QUOTE }, PAPER)!;
    const noteId = readingNoteFor(useNotesStore.getState().notes, "p1")!.id;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    const contentOf = () => {
      const span = stickySpan(blocks(), made.id)!;
      return blocks().slice(span.start + 1, span.end);
    };
    useNotesStore.getState().setStickyText(noteId, made.id, "hello sticky");
    const writer = makeStickyWriter((next, base) => {
      useNotesStore.getState().setStickyBlocks(noteId, made.id, JSON.parse(next) as Block[], base ? (JSON.parse(base) as Block[]) : undefined);
      return JSON.stringify(contentOf());
    });
    writer.sync(JSON.stringify(contentOf()));
    const mine = contentOf().map((b) => ({ ...b, text: "hello sticky mine", stickyId: made.id }));
    writer.push(JSON.stringify(mine));
    vi.advanceTimersByTime(STICKY_SAVE_MS);
    expect(stickyFollow({ stored: JSON.stringify(contentOf()), content: mine, writer, held: true })).toBeNull();
    const span = stickySpan(blocks(), made.id)!;
    useNotesStore.getState().save(noteId, { blocks: blocks().map((b, i) => (i > span.start && i < span.end ? { ...b, text: "hello sticky mine, and theirs" } : b)) });
    const step = stickyFollow({ stored: JSON.stringify(contentOf()), content: mine, writer, held: false });
    expect(step?.content.map((b) => b.text)).toEqual(["hello sticky mine, and theirs"]);
    expect(stickyText(blocks(), made.id)).toBe("hello sticky mine, and theirs");
  });
});
