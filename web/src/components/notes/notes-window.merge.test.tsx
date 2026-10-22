import { beforeEach, describe, expect, it } from "vitest";
import { block, highlightBlock, readHighlight } from "@/lib/notes/blocks";
import type { Block, HighlightColourId } from "@/lib/notes/types";
import { useNotesStore } from "@/store/notes";
import { reconcileWindow, mergeBlocks } from "./notes-window";

// P10-29 (BACKLOG-71): the window's unsaved blocks and an outside change to the same block, together — the words each side
// added stay; only a rewrite of the same words is the outside one's (written last), and the window's editor then restarts
// on the merge, so it shows the newer text before the next keystroke.

describe("mergeBlocks — the same block edited in the window and from outside (P10-29)", () => {
  const a = block("text", "alpha beta");
  const b = block("text", "gamma");

  it("keeps the window's words and the sticky's words when they changed different places of one block", () => {
    const merged = mergeBlocks([a, b], [{ ...a, text: "ALPHA beta" }, b], [{ ...a, text: "alpha BETA" }, b]);
    expect(merged.map((x) => x.text)).toEqual(["ALPHA BETA", "gamma"]);
  });

  it("keeps both when each added words at the end of the same block", () => {
    const merged = mergeBlocks([a], [{ ...a, text: "alpha beta window" }], [{ ...a, text: "alpha beta sticky" }]);
    expect(merged.map((x) => x.text)).toEqual(["alpha beta sticky window"]);
  });

  it("a rewrite of the same words is the outside one's; the block beside it keeps the window's edit", () => {
    const merged = mergeBlocks([a, b], [{ ...a, text: "mine" }, { ...b, text: "gamma, window" }], [{ ...a, text: "theirs" }, b]);
    expect(merged.map((x) => x.text)).toEqual(["theirs", "gamma, window"]);
  });

  it("keeps the window's kind of block when the outside changed only the words", () => {
    const merged = mergeBlocks([a], [{ ...a, type: "h2" }], [{ ...a, text: "alpha beta, sticky" }]);
    expect(merged).toEqual([{ ...a, type: "h2", text: "alpha beta, sticky" }]);
  });

  it("reconcileWindow merges it rather than restarting on the outside's block alone", () => {
    const v = reconcileWindow([a], [{ ...a, text: "ALPHA beta" }], [{ ...a, text: "alpha BETA" }]);
    expect(v.kind).toBe("merge");
    expect(v.kind === "merge" && v.blocks.map((x) => x.text)).toEqual(["ALPHA BETA"]);
  });
});

// P11-08 (owner item 8; B P11-04 §7 I11): a highlight is made, or recoloured, from the paper's page while the notes window holds
// words not yet saved. The window's write must not take it away (the window's stale copy has no such highlight, or the old
// colour), and must not paint over the new colour: the outside's highlight is kept as it stands. A highlight's `text` is empty
// and the window never edits it, so the whole of the merge for one is the rule "a block only the outside changed, or added, is the
// outside's". Every text is invented.

const light = (id: string, colour: HighlightColourId = "yellow", start = 4): Block => ({
  ...highlightBlock({ paperId: "p1", paragraphId: "paper-section-1-p2", quote: "tide pools at dawn", start, end: start + 18, colour }),
  id,
});
const colourOf = (blocks: readonly Block[], id: string) => readHighlight(blocks.find((x) => x.id === id))?.colour;

describe("mergeBlocks — a highlight made or recoloured in the paper while the window holds unsaved words (P11-08, I11)", () => {
  const a = block("text", "alpha beta");
  const b = block("text", "gamma");
  const typed = (x: Block): Block => ({ ...x, text: `${x.text}, typed in the window` });

  it("keeps a highlight the paper added, and the words the window typed", () => {
    const h = light("h1");
    const merged = mergeBlocks([a, b], [typed(a), b], [a, b, h]);
    expect(merged.map((x) => x.id)).toEqual([a.id, b.id, "h1"]);
    expect(merged[0].text).toBe("alpha beta, typed in the window");
    expect(merged[2]).toEqual(h);
  });

  it("keeps a highlight the paper added between two blocks where the paper put it", () => {
    const h = light("h1");
    const merged = mergeBlocks([a, b], [typed(a), b], [a, h, b]);
    expect(merged.map((x) => x.id)).toEqual([a.id, "h1", b.id]);
  });

  it("keeps every highlight the paper added, and a block the window added stays after its neighbour", () => {
    const fresh = block("text", "new in the window");
    const merged = mergeBlocks([a], [a, fresh], [a, light("h1"), light("h2", "green", 30)]);
    expect(merged.map((x) => x.id)).toEqual([a.id, fresh.id, "h1", "h2"]);
  });

  it("keeps the colour the paper gave, over the stale copy's old one", () => {
    const merged = mergeBlocks([a, light("h1")], [typed(a), light("h1")], [a, light("h1", "green")]);
    expect(merged.map((x) => x.id)).toEqual([a.id, "h1"]);
    expect(colourOf(merged, "h1")).toBe("green");
    expect(merged[0].text).toBe("alpha beta, typed in the window");
  });

  it("keeps the new colour whatever else the window did to the other blocks (it deleted one, retyped one)", () => {
    const merged = mergeBlocks([a, b, light("h1")], [{ ...a, type: "h2" }, light("h1")], [a, b, light("h1", "ink")]);
    expect(colourOf(merged, "h1")).toBe("ink");
    expect(merged.find((x) => x.id === a.id)?.type).toBe("h2");
    expect(merged.some((x) => x.id === b.id)).toBe(false);
  });

  it("leaves a highlight the window and the paper both left alone exactly as it was", () => {
    const h = light("h1", "pink");
    const merged = mergeBlocks([a, h], [typed(a), h], [a, h]);
    expect(merged[1]).toBe(h);
  });

  it("does not bring back a highlight the paper removed (the stale copy still holds it)", () => {
    const merged = mergeBlocks([a, light("h1")], [typed(a), light("h1")], [a]);
    expect(merged.map((x) => x.id)).toEqual([a.id]);
  });

  it("does not remove a highlight the stale copy never had, even when it removed blocks of its own", () => {
    const merged = mergeBlocks([a, b], [a], [a, b, light("h1")]);
    expect(merged.map((x) => x.id)).toEqual([a.id, "h1"]);
  });

  it("reconcileWindow merges rather than restarting or keeping, and the merge holds the paper's highlight", () => {
    const h = light("h1", "blue");
    const verdict = reconcileWindow([a], [typed(a)], [a, h]);
    expect(verdict.kind).toBe("merge");
    expect(verdict.kind === "merge" && verdict.blocks.map((x) => x.id)).toEqual([a.id, "h1"]);
    expect(verdict.kind === "merge" && colourOf(verdict.blocks, "h1")).toBe("blue");
    expect(verdict.kind === "merge" && verdict.blocks[0].text).toBe("alpha beta, typed in the window");
  });

  it("restarts the editor on the stored blocks when the window holds nothing unsaved: the new highlight shows at once", () => {
    const verdict = reconcileWindow([a], [a], [a, light("h1")]);
    expect(verdict.kind).toBe("restart");
    expect(verdict.kind === "restart" && verdict.blocks.map((x) => x.id)).toEqual([a.id, "h1"]);
  });
});

describe("the store's own highlight actions, against the window's stale copy (P11-08, I11)", () => {
  const PAPER = "p1";
  const PARAGRAPH = "paper-section-1-p2";
  const TEXT = "See the tide pools at dawn. Later the tide pools were bare.";
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
  });

  function seeded(): { id: string; base: Block[] } {
    const first = block("text", "my first words");
    useNotesStore.getState().add({ id: "note-1", title: "Invented", blocks: [first], sources: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z", paperId: PAPER });
    return { id: "note-1", base: [first] };
  }

  it("a highlight added by addHighlight survives the window's merge, in the colour it was made in", () => {
    const { id, base } = seeded();
    const mine = [{ ...base[0], text: "my first words, and more typed in the window" }];
    const made = useNotesStore.getState().addHighlight(id, { paperId: PAPER, paragraphId: PARAGRAPH, passage: "tide pools", paragraphText: TEXT, hint: 38, colour: "green" });
    expect(made?.created).toBe(true);
    const theirs = useNotesStore.getState().notes[id].blocks;
    const verdict = reconcileWindow(base, mine, theirs);
    expect(verdict.kind).toBe("merge");
    if (verdict.kind !== "merge") return;
    expect(verdict.blocks.map((x) => x.type)).toEqual(["text", "highlight"]);
    expect(verdict.blocks[0].text).toBe("my first words, and more typed in the window");
    expect(readHighlight(verdict.blocks[1])).toMatchObject({ colour: "green", start: 38, end: 48, quote: "tide pools" });
  });

  it("a highlight recoloured by setHighlightColour keeps its new colour through the window's merge", () => {
    const { id } = seeded();
    const made = useNotesStore.getState().addHighlight(id, { paperId: PAPER, paragraphId: PARAGRAPH, passage: "tide pools", paragraphText: TEXT, hint: 8 })!;
    const stale = useNotesStore.getState().notes[id].blocks; // what the window started from, and still holds
    useNotesStore.getState().setHighlightColour(id, made.id, "pink");
    const theirs = useNotesStore.getState().notes[id].blocks;
    const mine = stale.map((x) => (x.type === "text" ? { ...x, text: "typed in the window" } : x));
    const verdict = reconcileWindow(stale, mine, theirs);
    expect(verdict.kind).toBe("merge");
    if (verdict.kind !== "merge") return;
    expect(colourOf(verdict.blocks, made.id)).toBe("pink");
    expect(verdict.blocks.find((x) => x.type === "text")?.text).toBe("typed in the window");
  });

  it("the window's whole write — its stale flush, then the merge — leaves the highlight in the stored note", () => {
    const { id, base } = seeded();
    const mine = [{ ...base[0], text: "typed in the window" }];
    const made = useNotesStore.getState().addHighlight(id, { paperId: PAPER, paragraphId: PARAGRAPH, passage: "tide pools", paragraphText: TEXT, hint: 8, colour: "orange" })!;
    const verdict = reconcileWindow(base, mine, useNotesStore.getState().notes[id].blocks);
    if (verdict.kind !== "merge") throw new Error("expected a merge");
    // the old editor's unmount flush writes its stale copy, then the window stores the merge
    useNotesStore.getState().save(id, { blocks: mine });
    useNotesStore.getState().save(id, { blocks: verdict.blocks });
    const stored = useNotesStore.getState().notes[id].blocks;
    expect(stored.map((x) => x.id)).toEqual([base[0].id, made.id]);
    expect(colourOf(stored, made.id)).toBe("orange");
    expect(stored[0].text).toBe("typed in the window");
  });
});
