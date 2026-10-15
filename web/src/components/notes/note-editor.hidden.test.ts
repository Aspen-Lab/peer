import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { block, wordCount } from "@/lib/notes/blocks";
import { readingNote } from "@/lib/notes/templates";
import type { Block, Citable } from "@/lib/notes/types";
import { nearestVisibleTextual, slotAfterHidden, visibleWordCount } from "./note-editor";

// P10-23 (C P10-21's unsettled 1 and 4; ruling §1h.95): `/notes/<id>` hides a reading note's first `h1` block (the
// title it repeats, P10-21). Hidden is not unreachable: the editor's keys treated it as the neighbouring block. Now the
// page hands the editor `hiddenBlockId`; the caret never moves into it, no key joins text into it or out of it, and the
// page's word count leaves it out. No DOM in this runtime: the choices are pure functions, the wiring is read from the
// source, and what only a browser can say was measured in Chromium (the checkpoint).

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const editor = read("src/components/notes/note-editor.tsx");
const PAPER: Citable = { id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], year: 2026 } as unknown as Citable;

const title = block("h1", "Seaweed mulch and soil water");
const a = block("text", "first visible words");
const rule = block("divider");
const b = block("text", "second visible words");
const blocks: Block[] = [title, a, rule, b];

describe("nearestVisibleTextual — the caret's neighbour, never the hidden block", () => {
  it("going up from the first visible block finds nothing (the caret then goes to the title field)", () => {
    expect(nearestVisibleTextual(blocks, 1, -1, title.id)).toBe(-1);
  });

  it("without a hidden block it is the old rule: the first block's neighbour above is -1, and a block above is found", () => {
    expect(nearestVisibleTextual(blocks, 0, -1, null)).toBe(-1);
    expect(nearestVisibleTextual(blocks, 1, -1, null)).toBe(0);
    expect(nearestVisibleTextual(blocks, 1, -1, undefined)).toBe(0);
  });

  it("from the title field (index -1) going down it is the first visible textual block", () => {
    expect(nearestVisibleTextual(blocks, -1, 1, title.id)).toBe(1);
    expect(nearestVisibleTextual(blocks, -1, 1, null)).toBe(0);
  });

  it("goes past non-textual blocks and past a hidden block wherever it stands", () => {
    expect(nearestVisibleTextual(blocks, 1, 1, title.id)).toBe(3);
    expect(nearestVisibleTextual(blocks, 3, -1, title.id)).toBe(1);
    const moved: Block[] = [a, title, b];
    expect(nearestVisibleTextual(moved, 0, 1, title.id)).toBe(2);
    expect(nearestVisibleTextual(moved, 2, -1, title.id)).toBe(0);
  });

  it("a note whose only textual block is the hidden one has no neighbour at all", () => {
    expect(nearestVisibleTextual([title, rule], -1, 1, title.id)).toBe(-1);
  });
});

describe("slotAfterHidden — where a new first block goes when the title field's Enter finds none", () => {
  it("is after the hidden block, so the title stays first in the stored note", () => {
    expect(slotAfterHidden([title], title.id)).toBe(1);
    expect(slotAfterHidden([title, rule], title.id)).toBe(1);
  });

  it("is 0 when nothing is hidden or the hidden block is not at the top", () => {
    expect(slotAfterHidden([a, b], null)).toBe(0);
    expect(slotAfterHidden([a, title], title.id)).toBe(0);
  });
});

describe("visibleWordCount — the notes page's count leaves the hidden title out", () => {
  const note = readingNote(PAPER, "2026-10-14T00:00:00.000Z");
  const withText = { ...note, blocks: [...note.blocks, block("text", "three small words")] };

  it("the title's words (5) are not counted: only the reader's three", () => {
    expect(wordCount(withText)).toBe(8);
    expect(visibleWordCount(withText, withText.blocks[0].id)).toBe(3);
  });

  it("counts everything when nothing is hidden (the window, a note whose first block is not its title)", () => {
    expect(visibleWordCount(withText, null)).toBe(8);
    expect(visibleWordCount(withText, undefined)).toBe(8);
  });
});

describe("the editor's keys use them (wiring)", () => {
  const code = editor.replace(/\/\/.*$/gm, "");

  it("takes hiddenBlockId, which the window does not pass", () => {
    expect(editor).toMatch(/hiddenBlockId\?: string \| null/);
    expect(read("src/components/notes/notes-window.tsx")).not.toContain("hiddenBlockId");
  });

  it("every caret move that looks for a neighbour skips it: Enter / ArrowDown in the title, the arrows between blocks", () => {
    expect(code).toContain("nearestVisibleTextual(docRef.current.blocks, from, step, hiddenBlockId)");
    expect(code).toMatch(/const first = nearestTextual\(-1, 1\)/);
    expect(code).toMatch(/const target = nearestTextual\(i, back \? -1 : 1\)/);
  });

  it("Backspace at the start of the first visible block does nothing: it never joins into the hidden block", () => {
    expect(code).toMatch(/if \(i === 0 \|\| blocks\[i - 1\]\.id === hiddenBlockId\) \{/);
    expect(code).toMatch(/const next = blocks\[i \+ 1\];\s*if \(!next \|\| !isTextual\(next\.type\) \|\| next\.id === hiddenBlockId\) return;/);
  });

  it("the move-block key does not carry the first visible block above the hidden one", () => {
    expect(code).toMatch(/if \(e\.key === "ArrowUp" && blocks\[i - 1\]\?\.id === hiddenBlockId\) return;/);
  });

  it("the title field's Enter, with no visible block, adds one after the hidden block", () => {
    expect(code).toContain("insertAt(slotAfterHidden(docRef.current.blocks, hiddenBlockId), added)");
  });

  it("the footer's count is the visible one", () => {
    expect(code).toContain("visibleWordCount(doc, hiddenBlockId)");
    expect(code).not.toMatch(/useMemo\(\(\) => wordCount\(doc\)/);
  });
});

describe("the notes page hands the editor the hidden block's id", () => {
  const page = read("src/app/notes/[id]/page.tsx");
  const once = read("src/components/notes/title-once.tsx");

  it("TitleOnce gives its children the id it hides (a function child), and the page passes it on", () => {
    expect(once).toMatch(/typeof children === "function" \? children\(hidden\) : children/);
    expect(page).toMatch(/<TitleOnce key=\{note\.id\} note=\{note\}>\s*\{\(hiddenBlockId\) => <NoteEditor key=\{note\.id\} note=\{note\} hiddenBlockId=\{hiddenBlockId\} \/>\}\s*<\/TitleOnce>/);
  });
});
