import { beforeEach, describe, expect, it } from "vitest";
import { block, stickySpan } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { mergeWholeNote, useNotesStore } from "./notes";

// P12-65 (M1a, A5 / A8): a whole-note save carries the blocks its saver started from or last wrote (`base`), and the store merges
// by block id into what it holds now. B P12-52's M1: the notes window's flush as the page is left saved its copy over the words a
// sticky had written a moment before. Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };
const PARAGRAPH = "paper-section-1-p2";
const TEXT = "See the tide pools at dawn. Later the tide pools were bare.";

describe("mergeWholeNote — the editor's blocks over a store that moved on", () => {
  const a = block("text", "alpha beta");
  const b = block("text", "gamma");
  const c = block("text", "delta");

  it("is the editor's blocks exactly, in its order, when the store is still what it started from", () => {
    const mine = [c, { ...a, text: "alpha beta, typed" }];
    expect(mergeWholeNote([a, b, c], mine, [a, b, c])).toEqual(mine);
  });

  it("keeps the words each side wrote in different blocks", () => {
    const merged = mergeWholeNote([a, b], [{ ...a, text: "alpha beta, window" }, b], [a, { ...b, text: "gamma, sticky" }]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta, window", "gamma, sticky"]);
  });

  it("keeps both writers' words once when each added to the end of one block", () => {
    const merged = mergeWholeNote([{ ...a, text: "hello sticky" }], [{ ...a, text: "hello sticky bbb" }], [{ ...a, text: "hello stickya" }]);
    expect(merged.map((x) => x.text)).toEqual(["hello stickya bbb"]);
  });

  it("keeps the editor's order for the blocks it holds, and puts a block only the store holds after its neighbour", () => {
    const added = block("text", "written by a sticky");
    const merged = mergeWholeNote([a, b, c], [c, b, a], [a, added, b, c]);
    // the editor's three in its order; the added block follows its neighbour `a`, which the editor moved to the end
    expect(merged.map((x) => x.id)).toEqual([c.id, b.id, a.id, added.id]);
  });

  it("drops a block the editor deleted when the store left it alone, keeps one the store changed", () => {
    const merged = mergeWholeNote([a, b, c], [a], [a, b, { ...c, text: "delta, sticky" }]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta", "delta, sticky"]);
  });

  it("does not bring back a block the store deleted that the editor still holds unchanged", () => {
    const merged = mergeWholeNote([a, b], [{ ...a, text: "alpha beta, typed" }, b], [a]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta, typed"]);
  });

  it("keeps a block the editor added after its neighbour while the store wrote elsewhere", () => {
    const fresh = block("text", "new in the window");
    const merged = mergeWholeNote([a, b], [a, fresh, b], [a, { ...b, text: "gamma, sticky" }]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta", "new in the window", "gamma, sticky"]);
  });
});

describe("save with a base — the store keeps what another writer wrote since", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  function setup() {
    const st = useNotesStore.getState();
    const noteId = st.ensureReadingNote(PAPER);
    const made = st.addSticky(noteId, AT)!;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    const span = () => stickySpan(blocks(), made.id)!;
    const content = () => blocks().slice(span().start + 1, span().end);
    st.setStickyBlocks(noteId, made.id, content().map((x) => ({ ...x, text: "hello sticky" })));
    const textId = content()[0].id;
    const textOf = () => blocks().find((x) => x.id === textId)!.text;
    return { noteId, made, blocks, content, textId, textOf };
  }

  it("a window copy gone stale while the sticky wrote: the sticky's words are still there after the window's save", () => {
    const { noteId, made, blocks, content, textId, textOf } = setup();
    const started = blocks(); // what the window started from
    const window = started.map((x) => (x.id === textId ? { ...x, text: "hello sticky bbb" } : x));
    useNotesStore.getState().setStickyBlocks(noteId, made.id, content().map((x) => ({ ...x, text: "hello stickya" })), content());
    expect(textOf()).toBe("hello stickya");
    useNotesStore.getState().save(noteId, { blocks: window }, undefined, started);
    expect(textOf()).toBe("hello stickya bbb");
  });

  it("without a base the blocks replace the store's, as they did before (the callers that have none)", () => {
    const { noteId, blocks, content, made, textId, textOf } = setup();
    const started = blocks();
    const window = started.map((x) => (x.id === textId ? { ...x, text: "hello sticky bbb" } : x));
    useNotesStore.getState().setStickyBlocks(noteId, made.id, content().map((x) => ({ ...x, text: "hello stickya" })), content());
    useNotesStore.getState().save(noteId, { blocks: window });
    expect(textOf()).toBe("hello sticky bbb");
  });

  it("a base that is what the store holds writes the editor's blocks, order and deletions included", () => {
    const { noteId, blocks } = setup();
    const started = blocks();
    const reversed = [...started].reverse().slice(0, started.length - 1);
    useNotesStore.getState().save(noteId, { blocks: reversed }, undefined, started);
    expect(blocks().map((x) => x.id)).toEqual(reversed.map((x) => x.id));
  });

  it("the editor's own second save measures against the blocks it wrote first, so its words are never merged with themselves", () => {
    const { noteId, blocks, textId, textOf } = setup();
    const first = blocks().map((x) => (x.id === textId ? { ...x, text: "hello sticky one" } : x));
    useNotesStore.getState().save(noteId, { blocks: first }, undefined, blocks());
    const second = first.map((x) => (x.id === textId ? { ...x, text: "hello sticky one two" } : x));
    useNotesStore.getState().save(noteId, { blocks: second }, undefined, first);
    expect(textOf()).toBe("hello sticky one two");
  });

  it("a deleted sticky stays deleted, and an emptied one stays out, for a stale copy that carries its base", () => {
    const st = useNotesStore.getState();
    const { noteId, made, blocks } = setup();
    const other = st.addSticky(noteId, AT)!;
    const stale = blocks();
    st.removeSticky(noteId, made.id);
    st.removeEmptySticky(noteId, other.id);
    useNotesStore.getState().save(noteId, { blocks: [...stale, block("text", "typed in the window")] }, undefined, stale);
    expect(blocks().some((x) => x.id === made.id || x.id === other.id || x.stickyId === made.id)).toBe(false);
    expect(blocks().some((x) => x.text === "typed in the window")).toBe(true);
  });

  it("a highlight made, recoloured or removed in the paper meanwhile is not taken back by the stale copy", () => {
    const { noteId, blocks, textId } = setup();
    const st = useNotesStore.getState();
    const started = blocks();
    const made = st.addHighlight(noteId, { paperId: "p1", paragraphId: PARAGRAPH, passage: "tide pools", paragraphText: TEXT, hint: 8, colour: "green" })!;
    st.setHighlightColour(noteId, made.id, "pink");
    const window = started.map((x) => (x.id === textId ? { ...x, text: "typed in the window" } : x));
    useNotesStore.getState().save(noteId, { blocks: window }, undefined, started);
    const stored = blocks();
    expect(stored.find((x) => x.id === made.id)?.highlight?.colour).toBe("pink");
    expect(stored.find((x) => x.id === textId)?.text).toBe("typed in the window");
  });

  it("a title or sources save with a base but no blocks leaves the blocks alone", () => {
    const { noteId, blocks } = setup();
    const before = blocks();
    useNotesStore.getState().save(noteId, { title: "Renamed" }, undefined, before);
    expect(useNotesStore.getState().notes[noteId].title).toBe("Renamed");
    expect(blocks()).toBe(before);
  });

  it("touches no other note", () => {
    const { noteId, blocks } = setup();
    const foreign = { id: "other", title: "Other", blocks: [block("text", "elsewhere")] as Block[], sources: {}, createdAt: "2026-10-28T00:00:00.000Z", updatedAt: "2026-10-28T00:00:00.000Z" };
    useNotesStore.getState().add(foreign);
    const kept = useNotesStore.getState().notes.other;
    useNotesStore.getState().save(noteId, { blocks: [...blocks(), block("text", "x")] }, undefined, blocks());
    expect(useNotesStore.getState().notes.other).toBe(kept);
  });
});
