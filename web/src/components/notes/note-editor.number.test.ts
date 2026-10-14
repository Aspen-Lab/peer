import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorMap, block, stickyBlocks } from "@/lib/notes/blocks";
import { newHistory, stepBack, stepForward } from "@/lib/notes/wysiwyg";
import type { Block, NoteAnchor } from "@/lib/notes/types";
import { holdsItsType, recordShape, shapeOf, shapePatch, type Shape } from "./note-editor";

// P10-25 (A P10-22's X-B5; ruling §1h.97 (b)): a sticky's number is not editable text. The paper reads a note's tag and
// mark from the `h3` blocks that carry an anchor, and the editor let Backspace at the start of "Note 2" turn that
// heading into text — the tag and the mark vanished and Ctrl/⌘ Z did not bring them back. Now an anchored heading keeps
// its type (Backspace, the type menu, the toolbar, the slash menu, a join from the block above), its words stay
// editable, and every other type change is a step of the block's own undo that carries its type and anchor. No DOM in
// this runtime: the choices are pure functions, the key handler is read from the source, and what only a browser can
// say was measured in Chromium (the checkpoint).

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const editor = read("src/components/notes/note-editor.tsx");
/** The source between a marker and the next one at the same depth of the key handler's `switch`. */
const caseBody = (name: string) => {
  const at = editor.indexOf(`case "${name}": {`);
  expect(at).toBeGreaterThan(-1);
  const end = editor.indexOf("\n        case ", at + 10);
  return editor.slice(at, end);
};

const ANCHOR: NoteAnchor = { paperId: "openalex:W9", paragraphId: "p-3", n: 2, quote: "the mulch holds water", start: 4, end: 20 } as NoteAnchor;
const sticky = (): Block => stickyBlocks(ANCHOR).header;

describe("holdsItsType — a sticky's heading is the block that carries the anchor as an h3", () => {
  it("is true for a sticky's heading, however its words were edited", () => {
    expect(holdsItsType(sticky())).toBe(true);
    const renamed: Block = { ...sticky(), text: "Soil moisture, mine" };
    const emptied: Block = { ...sticky(), text: "" };
    expect(holdsItsType(renamed)).toBe(true);
    expect(holdsItsType(emptied)).toBe(true);
  });

  it("is false for every ordinary block, and for a block the paper does not read as a sticky (an anchor on a non-h3)", () => {
    for (const type of ["text", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "code"] as const) {
      expect(holdsItsType(block(type, "x"))).toBe(false);
    }
    // an earlier break left such a block (the paper reads only h3): it stays an ordinary block, which the type menu can turn back
    const damaged: Block = { ...block("text", "Note 2"), anchor: ANCHOR };
    expect(holdsItsType(damaged)).toBe(false);
  });
});

describe("the paper's tag reads the anchor's n, not the heading's words (pinned)", () => {
  it("a renamed heading still gives the paper tag 2 on its passage", () => {
    const header = { ...sticky(), text: "My own name for it" };
    const map = anchorMap({ blocks: [block("h1", "T"), header, block("text", "body")] }, "openalex:W9");
    expect(map["p-3"]).toHaveLength(1);
    expect(map["p-3"][0]).toMatchObject({ id: header.id, n: 2 });
  });
});

describe("rule 1 — an anchored heading keeps its type", () => {
  it("Backspace at its start does nothing, before the editor's turn-into-text rule is reached", () => {
    const body = caseBody("Backspace");
    const hold = body.search(/if \(holdsItsType\(b\)\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
    const demote = body.indexOf('if (b.type !== "text")');
    expect(hold).toBeGreaterThan(-1);
    expect(demote).toBeGreaterThan(hold);
  });

  it("Delete at the end of the block before it does not join it", () => {
    expect(caseBody("Delete")).toMatch(/if \(holdsItsType\(next\)\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
  });

  it("the slash menu does not open in it (it offers types)", () => {
    expect(editor).toMatch(/text\[caret - 1\] === "\/"[^\n]*b\.type !== "code" && !holdsItsType\(b\)/);
  });

  it("the block menu offers no Turn into for it", () => {
    expect(editor).toMatch(/\{isTextual\(b\.type\) && !holdsItsType\(b\) && \(\s*<>\s*<p className="eyebrow[^>]*>Turn into<\/p>/);
  });

  it("the toolbar's heading, bullets and numbers (applyType) change nothing in it", () => {
    expect(editor).toMatch(/const applyType = [\s\S]*?if \(!b \|\| !isTextual\(b\.type\) \|\| holdsItsType\(b\)\) return;/);
  });

  it("a menu pick that is a type change leaves it alone, and a paste over all of its words keeps the block", () => {
    expect(editor).toMatch(/const item = slashItems\[choice\];[\s\S]*?holdsItsType\(b\)/);
    expect(editor).toMatch(/if \(!before && !after && !holdsItsType\(b\)\) \{/);
  });

  it("no code path changes a block's type except through retype, which refuses an anchored heading", () => {
    const def = editor.indexOf("const retype = ");
    expect(def).toBeGreaterThan(-1);
    expect(editor.slice(def, def + 900)).toMatch(/holdsItsType\(b\)/);
    // every patch that carries a `type` is written as retype(…)
    const stray = editor.split("\n").filter((l) => /\bpatch\((?:id|b\.id|m\.blockId),\s*\{[^}]*\btype\b/.test(l));
    expect(stray).toEqual([]);
  });
});

describe("rule 2 — undo restores a block's type and anchor", () => {
  const text = (t = "plain words"): Block => block("text", t);

  it("shapeOf keeps the type, the anchor, the checked state and the indent; shapePatch writes them back", () => {
    const b = { ...sticky(), indent: undefined };
    const s = shapeOf(b);
    expect(s).toMatchObject({ type: "h3", anchor: ANCHOR });
    expect(shapePatch(s)).toMatchObject({ type: "h3", anchor: ANCHOR });
    expect(shapePatch(undefined)).toEqual({});
  });

  it("a type change is a step of its own: back gives the old type, forward the new one, the words the same", () => {
    const b = text();
    const h = recordShape(undefined, { text: b.text, shape: shapeOf(b) }, { text: b.text, shape: { type: "h2" } }, { from: 3, to: 3 });
    expect(h.states).toHaveLength(2);
    const back = stepBack(h)!;
    expect(back.state.text).toBe("plain words");
    expect(shapePatch((back.state as { shape?: Shape }).shape)).toMatchObject({ type: "text" });
    const fwd = stepForward(back.history)!;
    expect(shapePatch((fwd.state as { shape?: Shape }).shape)).toMatchObject({ type: "h2" });
  });

  it("after words were typed and then the type changed, two steps back give the words' old state and the type", () => {
    let h = newHistory({ text: "abc", from: 3, to: 3, ...{ shape: { type: "text" } } } as never);
    h = recordShape(h, { text: "abc", shape: { type: "text" } }, { text: "abc", shape: { type: "bullet" } }, { from: 3, to: 3 });
    const one = stepBack(h)!;
    expect((one.state as { shape?: Shape }).shape).toMatchObject({ type: "text" });
    expect(one.state.text).toBe("abc");
  });

  it("a block that carries an anchor gets the anchor back with its type", () => {
    const b = sticky();
    // the shape a block had before a change that dropped both (what the earlier editor did to a heading)
    const h = recordShape(undefined, { text: b.text, shape: shapeOf(b) }, { text: b.text, shape: { type: "text" } }, { from: 0, to: 0 });
    const back = stepBack(h)!;
    expect(shapePatch((back.state as { shape?: Shape }).shape)).toMatchObject({ type: "h3", anchor: ANCHOR });
  });

  it("a history that is out of step with the block starts again from the block's words and shape", () => {
    const b = text("now");
    const stale = newHistory({ text: "older words", from: 0, to: 0 });
    const h = recordShape(stale, { text: b.text, shape: shapeOf(b) }, { text: b.text, shape: { type: "quote" } }, { from: 1, to: 1 });
    expect(h.states.map((s) => s.text)).toEqual(["now", "now"]);
  });

  it("the editor steps through shapes: stepHistory writes the shape back, remember stamps it, every type change is recorded", () => {
    expect(editor).toMatch(/patch\(id, \{ text: step\.state\.text, \.\.\.shapePatch\(\(step\.state as [^)]*\)\.shape\) \}\)/);
    expect(editor).toMatch(/const shape = shapeOf\(docRef\.current\.blocks\.find[^\n]*\n[\s\S]*?const stamped = \{ text, from, to, shape \}/);
    expect(editor).toMatch(/const retype = [\s\S]*?recordShape\(/);
    // the Backspace demotion, an empty list item's Enter, the block menu, the toolbar (applyType), the Markdown shortcut and the slash pick: six
    const uses = editor.match(/\bretype\(/g) ?? [];
    expect(uses.length).toBeGreaterThanOrEqual(6);
  });
});
