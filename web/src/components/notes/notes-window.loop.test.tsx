import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { stickySpan } from "@/lib/notes/blocks";
import type { Block, Source } from "@/lib/notes/types";
import { useNotesStore } from "@/store/notes";
import { makeDocWriter } from "./note-editor";
import { settleWindow, storeSeed, type Seed } from "./notes-window";
import { makeStickyWriter } from "./sticky-note";

// P12-65 (M1b, A5 / A8): B P12-52's M1. The notes window is dirty, a sticky key is pending, the page is left: the sticky's flush
// reaches the store, the window's effect makes a merge, its seed save lands after the editor's own flush — and, with the base left
// where it was, every store change the seed itself caused was merged again: `hello stickya bbb` became `...bbb bbb a bbb ...`, the
// note doubling each pass up to the storage quota. No DOM environment exists, so React's passes are replayed here by hand — the
// real store, the real sticky writer, the editor's real writer and the window's own functions (`settleWindow`, `storeSeed`) — in
// the order the browser ran them: a render reads the store; the old editor's unmount flush; the new editor mounts (its `onDoc`);
// the window's reconcile effect on the blocks that render read; the seed save. Whether the page runs them so is what the
// Playwright run of the checkpoint measures; here the order is fixed by hand and the store is the real one.
// Every text is invented.

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const AT = { paperId: "p1", paragraphId: "paper-section-1-p2", passage: "The finest grains crept fastest." };
const source = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

type Doc = { title: string; blocks: Block[]; sources: Record<string, Source> };

function rig() {
  useNotesStore.setState({ notes: {} });
  const st = useNotesStore.getState();
  const noteId = st.ensureReadingNote(PAPER);
  const made = st.addSticky(noteId, AT)!;
  const stored = () => useNotesStore.getState().notes[noteId];
  const content = () => {
    const span = stickySpan(stored().blocks, made.id)!;
    return stored().blocks.slice(span.start + 1, span.end);
  };
  st.setStickyBlocks(noteId, made.id, content().map((x) => ({ ...x, text: "hello sticky" })));
  const textId = content()[0].id;
  const textOf = () => stored().blocks.find((x) => x.id === textId)!.text;
  let saves = 0;
  useNotesStore.subscribe(() => saves++);

  // ── the sticky, as StickyWindow builds its writer ──
  const sticky = makeStickyWriter((next, base) => {
    useNotesStore.getState().setStickyBlocks(noteId, made.id, JSON.parse(next) as Block[], base ? (JSON.parse(base) as Block[]) : undefined);
    return JSON.stringify(content());
  });
  sticky.sync(JSON.stringify(content()));
  let stickyHeld = content();
  const typeInSticky = (words: string) => {
    stickyHeld = stickyHeld.map((x) => ({ ...x, text: x.text + words, stickyId: made.id }));
    sticky.push(JSON.stringify(stickyHeld));
  };

  // ── the notes window: NotesWindow's state, NoteEditor's writer and copy, and React's passes ──
  let fresh: { rev: number; seed: Seed | null } = { rev: 0, seed: null };
  const base: { current: Block[] | null } = { current: null };
  const win = { doc: null as Doc | null };
  let editor = { initial: null as unknown as Doc, doc: null as unknown as Doc, dirty: false, write: makeDocWriter([]) };
  let prevBlocks: Block[] | undefined;
  let prevRev = -1;
  const flushEditor = () => {
    if (!editor.dirty) return;
    const doc = editor.doc;
    editor.write(doc, (b) => useNotesStore.getState().save(noteId, doc, undefined, b));
    editor.dirty = false;
  };
  const mount = (blocks: Block[], sources: Record<string, Source>) => {
    const initial: Doc = { title: stored().title, blocks, sources };
    editor = { initial, doc: initial, dirty: false, write: makeDocWriter(blocks) };
    win.doc = initial; // NoteEditor's onDoc effect
  };
  /** One render and its effects. True when anything it did calls for another. */
  const pass = (): boolean => {
    const snap = stored(); // what this render read
    const f = { ...fresh }; // and its state
    let again = false;
    if (f.rev !== prevRev) {
      if (prevRev >= 0) flushEditor(); // the old editor's unmount flush
      mount(f.seed ? f.seed.blocks : snap.blocks, f.seed ? f.seed.sources : snap.sources);
      again = true;
    }
    if (snap.blocks !== prevBlocks) {
      const step = settleWindow(base, win.doc, snap, f.seed);
      if (step.kind === "restart") fresh = { rev: fresh.rev + 1, seed: null };
      else if (step.kind === "merge") fresh = { rev: fresh.rev + 1, seed: step.seed };
      again = true;
    }
    if (f.rev !== prevRev && f.seed) {
      storeSeed(noteId, f.seed);
      if (fresh.rev === f.rev) fresh = { rev: fresh.rev, seed: null };
    }
    prevBlocks = snap.blocks;
    prevRev = f.rev;
    return again || fresh.rev !== f.rev || stored().blocks !== snap.blocks;
  };
  /** Passes until nothing more is asked of React (or `limit`); how many were run. */
  const settle = (limit = 40): number => {
    let n = 0;
    while (n < limit && pass()) n++;
    return n;
  };
  settle(3); // the window opens on the note
  const typeInWindow = (words: string) => {
    editor.doc = { ...editor.doc, blocks: editor.doc.blocks.map((x) => (x.id === textId ? { ...x, text: x.text + words } : x)) };
    editor.dirty = true;
    win.doc = editor.doc;
  };
  const length = () => stored().blocks.reduce((n, x) => n + x.text.length, 0);
  return { noteId, made, stored, content, textOf, sticky, typeInSticky, typeInWindow, flushEditor, pass, settle, length, saves: () => saves, fresh: () => fresh, base, heldDoc: () => editor.doc };
}

describe("settleWindow — one pass of the window's reconcile effect (P12-65, M1b)", () => {
  const a = { id: "a", type: "text", text: "alpha beta" } as Block;
  const none = {} as Record<string, Source>;

  it("after a merge the base is the merge: the editor that starts from it holds nothing unsaved", () => {
    const base = { current: [a] as Block[] | null };
    const step = settleWindow(base, { blocks: [{ ...a, text: "ALPHA beta" }], sources: none }, { blocks: [{ ...a, text: "alpha BETA" }], sources: none });
    expect(step.kind).toBe("merge");
    if (step.kind !== "merge") return;
    expect(step.seed.blocks.map((x) => x.text)).toEqual(["ALPHA BETA"]);
    expect(base.current).toBe(step.seed.blocks);
    expect(step.seed.from.map((x) => x.text)).toEqual(["alpha BETA"]);
  });

  it("then the merge in the store is not an outside change: keep, not another merge or restart", () => {
    const base = { current: [a] as Block[] | null };
    const mine = { blocks: [{ ...a, text: "ALPHA beta" }], sources: none };
    const step = settleWindow(base, mine, { blocks: [{ ...a, text: "alpha BETA" }], sources: none });
    if (step.kind !== "merge") throw new Error("expected a merge");
    const newEditor = { blocks: step.seed.blocks, sources: none };
    expect(settleWindow(base, newEditor, { blocks: step.seed.blocks, sources: none })).toEqual({ kind: "none" });
    // and the stored copy of it, a new array of the same blocks
    expect(settleWindow(base, newEditor, { blocks: step.seed.blocks.map((x) => ({ ...x })), sources: none })).toEqual({ kind: "none" });
  });

  it("while a seed waits and the note in hand is the one it was made from, no verdict is made; a note that moved on is looked at", () => {
    const from = [{ ...a, text: "y" }];
    const seed: Seed = { blocks: [{ ...a, text: "x y" }], sources: none, from };
    const base = { current: seed.blocks as Block[] | null };
    const mine = { blocks: seed.blocks, sources: none };
    expect(settleWindow(base, mine, { blocks: from, sources: none }, seed)).toEqual({ kind: "none" });
    expect(base.current).toBe(seed.blocks);
    // the old editor's flush or a sticky wrote since: the new editor, still as the seed made it, restarts on what is stored
    const moved = [{ ...a, text: "x y z" }];
    expect(settleWindow(base, mine, { blocks: moved, sources: none }, seed)).toEqual({ kind: "restart" });
    expect(base.current).toBe(moved);
  });

  it("keeps the verdicts it had: same moves the base, keep holds it, a clean editor restarts on the outside's blocks", () => {
    const b = { current: null as Block[] | null };
    expect(settleWindow(b, null, { blocks: [a], sources: none })).toEqual({ kind: "none" });
    expect(b.current).toEqual([a]);
    const edited = [{ ...a, text: "alpha beta!" }];
    expect(settleWindow(b, { blocks: edited, sources: none }, { blocks: edited, sources: none })).toEqual({ kind: "none" });
    expect(b.current).toBe(edited);
    const held = { current: [a] as Block[] | null };
    expect(settleWindow(held, { blocks: edited, sources: none }, { blocks: [a], sources: none })).toEqual({ kind: "none" });
    expect(held.current).toEqual([a]);
    const outside = [{ ...a, text: "alpha beta?" }];
    const clean = { current: [a] as Block[] | null };
    expect(settleWindow(clean, { blocks: [a], sources: none }, { blocks: outside, sources: none })).toEqual({ kind: "restart" });
    expect(clean.current).toBe(outside);
  });
});

describe("storeSeed — the merge is stored only over the note it was made from (P12-65, M1a, M1b)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  /** The window dirty, a sticky key flushed: the window's effect looks at that note and makes its merge. */
  function look() {
    const r = rig();
    const started = r.stored().blocks;
    r.typeInWindow(" bbb");
    r.typeInSticky("a");
    r.sticky.flush();
    const seen = r.stored();
    const step = settleWindow({ current: started }, { blocks: r.stored().blocks.map((x) => (x.id === started.find((y) => y.text === "hello sticky")!.id ? { ...x, text: "hello sticky bbb" } : x)), sources: seen.sources }, seen);
    if (step.kind !== "merge") throw new Error("expected a merge");
    expect(step.seed.blocks.some((x) => x.text === "hello stickya bbb")).toBe(true);
    return { r, step };
  }

  it("stores the merge when nothing has written since it was made", () => {
    const { r, step } = look();
    expect(storeSeed(r.noteId, step.seed)).toBe(true);
    expect(r.textOf()).toBe("hello stickya bbb");
  });

  it("does not store it over the old editor's flush, which already holds both writers' words: they are not merged a second time", () => {
    const { r, step } = look();
    r.flushEditor(); // the old editor's unmount flush, merged into the note
    expect(r.textOf()).toBe("hello stickya bbb");
    expect(storeSeed(r.noteId, step.seed)).toBe(false);
    expect(r.textOf()).toBe("hello stickya bbb");
  });

  it("does not store it over a sticky word written after the look: that word is kept", () => {
    const { r, step } = look();
    r.typeInSticky("z");
    r.sticky.flush();
    expect(r.textOf()).toBe("hello stickyaz");
    expect(storeSeed(r.noteId, step.seed)).toBe(false);
    expect(r.textOf()).toBe("hello stickyaz");
  });
});

describe("the page is left with the window dirty and a sticky key pending — through React's passes (P12-65, M1b)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const BOTH = "hello sticky".length + " bbb".length + "a".length;

  it("B P12-52's M1: the sticky's flush, one render, the window's flush, the renders that follow — both words once, then nothing more is written", () => {
    const r = rig();
    r.typeInWindow(" bbb");
    r.typeInSticky("a");
    const before = r.saves();
    r.sticky.flush();
    r.pass(); // the render of the sticky's flush: the window's effect makes a merge and queues its restart
    r.flushEditor(); // pagehide, second listener: the window's own flush
    const passes = r.settle();
    expect(r.textOf()).toBe("hello stickya bbb");
    expect(r.textOf().length).toBe(BOTH);
    expect(passes).toBeLessThan(6);
    expect(r.saves() - before).toBeLessThanOrEqual(4);
    // however many passes follow, the note stays what the two writers wrote
    const length = r.length();
    const written = r.saves();
    for (let i = 0; i < 50; i++) r.pass();
    expect(r.length()).toBe(length);
    expect(r.saves()).toBe(written);
    expect(r.textOf()).toBe("hello stickya bbb");
  });

  it("the same, with the renders running before the window's flush (a quiet page)", () => {
    const r = rig();
    r.typeInWindow(" bbb");
    r.typeInSticky("a");
    r.sticky.flush();
    r.settle();
    r.flushEditor();
    r.settle();
    expect(r.textOf()).toBe("hello stickya bbb");
  });

  it("a second sticky flush between the look and the seed is kept too", () => {
    const r = rig();
    r.typeInWindow(" bbb");
    r.typeInSticky("a");
    r.sticky.flush();
    r.pass();
    r.typeInSticky("z");
    r.sticky.flush(); // lands before the render that stores the seed
    r.flushEditor();
    r.settle();
    expect(r.textOf()).toBe("hello stickyaz bbb");
    const length = r.length();
    for (let i = 0; i < 50; i++) r.pass();
    expect(r.length()).toBe(length);
  });

  it("a sticky write while the window is dirty and the page stays: merged once, the editor restarts on it, the note stays bounded", () => {
    const r = rig();
    r.typeInWindow(" bbb");
    r.typeInSticky("a");
    r.sticky.flush();
    r.settle();
    expect(r.textOf()).toBe("hello stickya bbb");
    const length = r.length();
    for (let i = 0; i < 50; i++) r.pass();
    expect(r.length()).toBe(length);
  });

  it("a clean window restarts on the sticky's words and writes nothing", () => {
    const r = rig();
    r.typeInSticky("a");
    const before = r.saves();
    r.sticky.flush();
    r.settle();
    expect(r.textOf()).toBe("hello stickya");
    expect(r.saves() - before).toBe(1);
  });
});

describe("whatever lands between the window's look and its seed, the note stays what its writers wrote (P12-65, M1b)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const TYPED = "hello sticky".length + " bbb".length + "a".length + "z".length;
  const cases: [string, (r: ReturnType<typeof rig>) => void][] = [
    ["nothing", () => {}],
    ["the old editor's flush", (r) => r.flushEditor()],
    ["a second sticky flush", (r) => { r.typeInSticky("z"); r.sticky.flush(); }],
    ["a second sticky flush, then the old editor's flush", (r) => { r.typeInSticky("z"); r.sticky.flush(); r.flushEditor(); }],
    ["a stale copy saved with no base, as the editor did before", (r) => useNotesStore.getState().save(r.noteId, { blocks: r.heldDoc().blocks })],
    ["a stale copy with no base, then a second sticky flush", (r) => { useNotesStore.getState().save(r.noteId, { blocks: r.heldDoc().blocks }); r.typeInSticky("z"); r.sticky.flush(); }],
  ];
  for (const [name, between] of cases) {
    it(`${name}: bounded after any number of passes, and quiet`, () => {
      const r = rig();
      r.typeInWindow(" bbb");
      r.typeInSticky("a");
      r.sticky.flush();
      r.pass(); // the look: the window makes its merge
      between(r);
      r.settle();
      expect(r.textOf().length).toBeLessThanOrEqual(TYPED);
      const length = r.length();
      const saves = r.saves();
      for (let i = 0; i < 60; i++) r.pass();
      expect(r.length()).toBe(length);
      expect(r.saves()).toBe(saves);
    });
  }
});

describe("the window's effects go through the two functions (P12-65, M1b) — the source", () => {
  const src = source("./notes-window.tsx");
  it("the reconcile effect asks settleWindow, with the seed that waits; the seed effect stores through storeSeed", () => {
    expect(src).toContain("settleWindow(base, doc.current, note, fresh.seed)");
    expect(src).toContain("storeSeed(note.id, fresh.seed)");
    expect(src).not.toContain("useNotesStore.getState().save(note.id, { blocks: fresh.seed.blocks");
  });
});
