import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { stickySpan } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { useNotesStore } from "@/store/notes";
import { makeDocWriter } from "./note-editor";
import { makeStickyWriter } from "./sticky-note";

// P12-65 (M1a, A5 / A8): the editor's whole-note write carries the blocks it started from or last wrote, so the page leave that
// flushes the notes window after a sticky's own flush merges instead of overwriting (B P12-52, M1). The sequences run through
// the real store and the real sticky writer; the window's editor is its writer (`makeDocWriter`) plus a copy of the blocks.
// Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };
const source = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

describe("makeDocWriter — each write is measured against the one before", () => {
  const a = { id: "a", type: "text", text: "one" } as Block;
  it("hands the blocks the editor started from as the first base, then the blocks it last wrote", () => {
    const write = makeDocWriter([a]);
    const bases: (readonly Block[])[] = [];
    const first = [{ ...a, text: "one two" }];
    const second = [{ ...a, text: "one two three" }];
    write({ blocks: first }, (base) => bases.push(base));
    write({ blocks: second }, (base) => bases.push(base));
    write({ blocks: second }, (base) => bases.push(base));
    expect(bases).toEqual([[a], first, second]);
  });

  it("is one writer for the timer, the page leave and the unmount: the editor's source writes only through it", () => {
    const src = source("./note-editor.tsx");
    expect(src).toContain("docWriter(docRef.current, (base) => saveNote(note.id, docRef.current, undefined, base))");
    expect(src).not.toMatch(/saveNote\(note\.id, docRef\.current\)/);
    expect(src.match(/writeDoc\(\)/g)?.length).toBe(2); // the half-second timer and the leave / unmount flush
  });
});

describe("the page is left with the window dirty and a sticky key pending (B P12-52, M1)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useNotesStore.setState({ notes: {} });
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const st = useNotesStore.getState();
    const noteId = st.ensureReadingNote(PAPER);
    const made = st.addSticky(noteId, AT)!;
    const blocks = () => useNotesStore.getState().notes[noteId].blocks;
    const content = () => {
      const span = stickySpan(blocks(), made.id)!;
      return blocks().slice(span.start + 1, span.end);
    };
    st.setStickyBlocks(noteId, made.id, content().map((x) => ({ ...x, text: "hello sticky" })));
    const textId = content()[0].id;
    const textOf = () => blocks().find((x) => x.id === textId)!.text;
    // the sticky, as StickyWindow builds its writer
    const sticky = makeStickyWriter((next, base) => {
      useNotesStore.getState().setStickyBlocks(noteId, made.id, JSON.parse(next) as Block[], base ? (JSON.parse(base) as Block[]) : undefined);
      return JSON.stringify(content());
    });
    sticky.sync(JSON.stringify(content()));
    // the window's editor: what it started from, the copy it holds, and its writer
    const started = blocks();
    const writer = makeDocWriter(started);
    let held = started;
    const typeInWindow = (words: string) => {
      held = held.map((x) => (x.id === textId ? { ...x, text: x.text + words } : x));
    };
    const flushWindow = () => writer({ blocks: held }, (base) => useNotesStore.getState().save(noteId, { blocks: held }, undefined, base));
    // the sticky holds its own copy while a key of its own is waiting (it does not follow the store then)
    let stickyHeld = content();
    const typeInSticky = (words: string) => {
      stickyHeld = stickyHeld.map((x) => ({ ...x, text: x.text + words, stickyId: made.id }));
      sticky.push(JSON.stringify(stickyHeld));
    };
    return { noteId, blocks, textOf, sticky, typeInWindow, typeInSticky, flushWindow };
  }

  it("the sticky's flush, then the window's: both writers' words are in the note, once, in two saves", () => {
    const { textOf, sticky, typeInWindow, typeInSticky, flushWindow } = setup();
    let saves = 0;
    const unsubscribe = useNotesStore.subscribe(() => saves++);
    typeInWindow(" bbb");
    typeInSticky("a");
    sticky.flush();
    flushWindow();
    unsubscribe();
    expect(textOf()).toBe("hello stickya bbb");
    expect(saves).toBe(2);
    expect(textOf().length).toBe("hello sticky".length + " bbb".length + "a".length);
  });

  it("the window's flush, then the sticky's: the same words, once (the join rule puts a space between words that would touch)", () => {
    const { textOf, sticky, typeInWindow, typeInSticky, flushWindow } = setup();
    typeInWindow(" bbb");
    typeInSticky("a");
    flushWindow();
    sticky.flush();
    expect(textOf()).toBe("hello sticky bbb a");
  });

  it("the window's half-second save and a later flush do not multiply the words either", () => {
    const { textOf, sticky, typeInWindow, typeInSticky, flushWindow } = setup();
    typeInSticky("a");
    typeInWindow(" bbb");
    flushWindow(); // the half-second timer, while the sticky's key waits
    sticky.flush();
    typeInWindow(" ccc");
    flushWindow(); // the page leave
    expect(textOf()).toBe("hello sticky bbb a ccc");
    flushWindow(); // a second leave event finds nothing new
    expect(textOf()).toBe("hello sticky bbb a ccc");
  });

  it("a save without a base still replaces the sticky's word with the stale copy (the contrast; the callers with no base are named on the store's save)", () => {
    const { noteId, textOf, sticky, typeInWindow, typeInSticky } = setup();
    const stale = useNotesStore.getState().notes[noteId].blocks.map((x) => (x.text === "hello sticky" ? { ...x, text: "hello sticky bbb" } : x));
    typeInWindow(" bbb");
    typeInSticky("a");
    sticky.flush();
    useNotesStore.getState().save(noteId, { blocks: stale });
    expect(textOf()).toBe("hello sticky bbb");
  });
});
