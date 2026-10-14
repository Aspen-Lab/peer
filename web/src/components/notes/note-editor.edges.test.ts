import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { anchorMap, block, stickyBlocks } from "@/lib/notes/blocks";
import { pressMark } from "@/lib/notes/wysiwyg";
import type { Block, NoteAnchor } from "@/lib/notes/types";
import * as editorModule from "./note-editor";

// P10-28 (BACKLOG-90, 79, 85; ruling §1h.99 (a)): the notes editor's edges. A sticky's heading is whole (Delete at its
// end, Duplicate, the toolbar, a heading an old Backspace left as text); a second mark key keeps the selection; undo
// covers a block split and a join. No DOM in this runtime: the choices are pure functions (read from the module by
// name, so a missing one fails the test and not the compiler), the key handler is read from the source, and what only
// a browser can say was measured in Chromium (the checkpoint).

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const editor = read("src/components/notes/note-editor.tsx");
const caseBody = (name: string) => {
  const at = editor.indexOf(`case "${name}": {`);
  expect(at, `case "${name}" in the key handler`).toBeGreaterThan(-1);
  const end = editor.indexOf("\n        case ", at + 10);
  return editor.slice(at, end);
};
/** A function the editor module should export. */
function exported<T>(name: string): T {
  const f = (editorModule as Record<string, unknown>)[name];
  if (typeof f !== "function") throw new Error(`note-editor.tsx should export ${name}`);
  return f as T;
}

const ANCHOR: NoteAnchor = { paperId: "openalex:W9", paragraphId: "p-3", n: 2, quote: "the mulch holds water", start: 4, end: 20 };
const sticky = (): Block => stickyBlocks(ANCHOR).header;

describe("rule 1 — a sticky's heading is whole (BACKLOG-90)", () => {
  it("Delete at the end of the anchored heading does not pull the next block's words into it", () => {
    const body = caseBody("Delete");
    const hold = body.search(/if \(holdsItsType\(b\)\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
    const join = body.indexOf("joined(b, next)");
    expect(hold).toBeGreaterThan(-1);
    expect(join).toBeGreaterThan(hold);
    // and the other direction stays as P10-25 left it
    expect(body).toMatch(/if \(holdsItsType\(next\)\) \{\s*e\.preventDefault\(\);\s*return;\s*\}/);
  });

  it("Duplicate copies the words without the anchor: one note, one mark", () => {
    const duplicateBlock = exported<(b: Block, id: string) => Block>("duplicateBlock");
    const head = { ...sticky(), text: "My own name for it" };
    const copy = duplicateBlock(head, "copy-1");
    expect(copy).toMatchObject({ id: "copy-1", type: "h3", text: "My own name for it" });
    expect("anchor" in copy).toBe(false);
    const map = anchorMap({ blocks: [head, copy] }, "openalex:W9");
    expect(map["p-3"]).toHaveLength(1);
    expect(map["p-3"][0].id).toBe(head.id);
    // an ordinary block is copied as it is
    const item: Block = { ...block("todo", "x"), checked: true, indent: 1 };
    expect(duplicateBlock(item, "c2")).toEqual({ ...item, id: "c2" });
    // the block menu's Duplicate goes through it
    expect(editor).toMatch(/action === "duplicate"\) \{\s*insertAt\(i \+ 1, duplicateBlock\(b, block\(\)\.id\)\);/);
  });

  it("an anchored block that is not an h3 (left by the old Backspace) is an h3 again on load, the anchor kept", () => {
    const repairAnchored = exported<(blocks: Block[]) => Block[]>("repairAnchored");
    const demoted: Block = { ...sticky(), type: "text", text: "Note 2" };
    const listed: Block = { ...sticky(), type: "bullet", text: "Note 3", indent: 1, checked: true };
    const plain = block("text", "body");
    const ok = sticky();
    const out = repairAnchored([plain, demoted, listed, ok]);
    expect(out[1]).toMatchObject({ id: demoted.id, type: "h3", text: "Note 2", anchor: ANCHOR });
    expect(out[2]).toMatchObject({ id: listed.id, type: "h3", anchor: ANCHOR });
    expect(out[2].indent).toBeUndefined();
    expect(out[2].checked).toBeUndefined();
    expect(out[0]).toBe(plain);
    expect(out[3]).toBe(ok);
    // the paper reads the tag again
    expect(anchorMap({ blocks: out }, "openalex:W9")["p-3"]).toHaveLength(3);
    // nothing to repair: the same array comes back
    const same = [plain, ok];
    expect(repairAnchored(same)).toBe(same);
    // the editor reads its blocks through it
    expect(editor).toMatch(/repairAnchored\(initial\.current\.blocks\)/);
  });

  it("the toolbar's heading and list buttons are aria-disabled while the caret is in an anchored heading", () => {
    expect(editor).toMatch(/holdsItsType\(editingBlock\)/);
    expect(editor).toContain('setAttribute("aria-disabled", "true")');
    expect(editor).toContain('removeAttribute("aria-disabled")');
    // greyed
    expect(editor).toMatch(/\[aria-disabled=true\]\]:opacity-/);
  });
});

describe("rule 2 — a mark keeps the selection (BACKLOG-79)", () => {
  /** What the key path does: the same selection each time (the editor selects the same words again after a mark). */
  const press = (src: string, sel: { from: number; to: number }, marks: Parameters<typeof pressMark>[2][]): string => {
    let s = src;
    for (const m of marks) {
      const out = pressMark(s, sel, m, null);
      expect(out.kind).toBe("edit");
      if (out.kind === "edit") s = out.text;
    }
    return s;
  };

  it("two marks in a row on the same words nest, and never write an empty pair", () => {
    const sel = { from: 0, to: 1 };
    expect(press("x", sel, ["strong", "em"])).toBe("***x***");
    expect(press("x", sel, ["mark", "strong"])).toMatch(/^(==\*\*x\*\*==|\*\*==x==\*\*)$/);
    for (const marks of [["strong", "em"], ["em", "strong"], ["underline", "mark"], ["mark", "strong", "em"]] as const) {
      const s = press("x", sel, [...marks]);
      expect(s).not.toMatch(/\*\*\*\*|====|____|``/);
      expect(s).toContain("x");
    }
  });

  it("the editor selects the same words again after a mark, so the next key lands on them and not on a caret", () => {
    const apply = editor.slice(editor.indexOf("const applyMark = "), editor.indexOf("const applyType = "));
    expect(apply).toMatch(/patch\(id, \{ text: out\.text \}\);\s*focusBlock\(id, \{ plain: sel\.from, to: sel\.to \}\);/);
    // the layout effect that places the selection honours a range
    expect(editor).toMatch(/const to = typeof c === "object" && c\.to !== undefined \? Math\.min\(c\.to, total\) : from;\s*setPlainSelection\(el, from, to\);/);
    // a key that finds nothing selected toggles for the next typed text; it never writes an empty pair
    expect(apply).toMatch(/out\.kind === "pending"/);
  });
});

describe("rule 3 — undo covers a block split and a join (BACKLOG-85)", () => {
  const sample = (): Block[] => {
    const a: Block = { ...block("bullet", "alpha beta"), indent: 1 };
    const b: Block = { ...block("todo", "task"), checked: true, indent: 2 };
    return [block("h1", "Title"), a, b, block("text", "tail")];
  };
  type Log = { past: unknown[]; future: unknown[] };
  type Step = { before: Block[]; after: Block[]; caretBack: { id: string; plain: number }; caretForward: { id: string; plain: number } };
  type Result = { log: Log; blocks: Block[]; caret: { id: string; plain: number } } | null;
  const lib = () => ({
    newLog: exported<() => Log>("newStructureLog"),
    record: exported<(log: Log, step: Step) => Log>("recordStructure"),
    step: exported<(log: Log, blocks: readonly Block[], focusId: string, forward: boolean) => Result>("stepStructure"),
  });

  it("Enter in the middle of a block is one step: Ctrl/⌘ Z gives the block back as it was (text, type, indent), Ctrl/⌘ Y splits it again", () => {
    const { newLog, record, step } = lib();
    const blocks = sample();
    const a = blocks[1];
    const head: Block = { ...a, text: "alpha" };
    const tail = block("bullet", " beta", { indent: 1 });
    const after = [blocks[0], head, tail, blocks[2], blocks[3]];
    const log = record(newLog(), { before: [a], after: [head, tail], caretBack: { id: a.id, plain: 5 }, caretForward: { id: tail.id, plain: 0 } });
    const back = step(log, after, tail.id, false)!;
    expect(back.blocks).toEqual(blocks);
    expect(back.caret).toEqual({ id: a.id, plain: 5 });
    const fwd = step(back.log, back.blocks, a.id, true)!;
    expect(fwd.blocks).toEqual(after);
    expect(fwd.caret).toEqual({ id: tail.id, plain: 0 });
  });

  it("Backspace joining two blocks is one step: undo gives both back with their own text, type, anchor, checked and indent", () => {
    const { newLog, record, step } = lib();
    const head = sticky();
    const second: Block = { ...block("todo", "second words"), checked: true, indent: 3 };
    const first: Block = { ...block("text", "first words"), indent: 1 };
    const blocks = [head, first, second];
    const joinedBlock: Block = { ...first, text: "first wordssecond words" };
    const log = record(newLog(), { before: [first, second], after: [joinedBlock], caretBack: { id: second.id, plain: 0 }, caretForward: { id: first.id, plain: 11 } });
    const back = step(log, [head, joinedBlock], first.id, false)!;
    expect(back.blocks).toEqual(blocks);
    expect(back.blocks[0].anchor).toEqual(ANCHOR);
    expect(back.blocks[2]).toMatchObject({ type: "todo", checked: true, indent: 3, text: "second words" });
    expect(back.caret).toEqual({ id: second.id, plain: 0 });
  });

  it("a step is refused when the blocks are no longer as the step left them, or the caret is in another block, or the log is empty", () => {
    const { newLog, record, step } = lib();
    const blocks = sample();
    const a = blocks[1];
    const head = { ...a, text: "alpha" };
    const tail = block("bullet", " beta", { indent: 1 });
    const log = record(newLog(), { before: [a], after: [head, tail], caretBack: { id: a.id, plain: 5 }, caretForward: { id: tail.id, plain: 0 } });
    const after = [blocks[0], head, tail, blocks[2], blocks[3]];
    expect(step(newLog(), after, tail.id, false)).toBeNull();
    expect(step(log, after, blocks[3].id, false)).toBeNull();
    expect(step(log, [blocks[0], head, { ...tail, text: " beta, typed on" }, blocks[2]], tail.id, false)).toBeNull();
    expect(step(log, after, tail.id, true)).toBeNull();
  });

  it("a new step drops what was ahead of it", () => {
    const { newLog, record, step } = lib();
    const a = block("text", "one two");
    const [h1, t1] = [{ ...a, text: "one" }, block("text", " two")];
    const s1: Step = { before: [a], after: [h1, t1], caretBack: { id: a.id, plain: 3 }, caretForward: { id: t1.id, plain: 0 } };
    const undone = step(record(newLog(), s1), [h1, t1], t1.id, false)!;
    expect(undone.log.future).toHaveLength(1);
    const again = record(undone.log, { before: [a], after: [{ ...a, text: "on" }, block("text", "e two")], caretBack: { id: a.id, plain: 2 }, caretForward: { id: a.id, plain: 0 } });
    expect(again.future).toHaveLength(0);
  });

  it("the key handler logs a split (Enter), a join (Backspace, Delete) and tries the structure when the block's own steps are spent", () => {
    expect(caseBody("Enter")).toMatch(/recordStructure\(/);
    expect(caseBody("Backspace")).toMatch(/recordStructure\(/);
    expect(caseBody("Delete")).toMatch(/recordStructure\(/);
    expect(editor).toMatch(/stepHistory\(id, letter === "y" \|\| e\.shiftKey\)\s*\|\|\s*stepBlocks\(id, letter === "y" \|\| e\.shiftKey\)/);
  });
});
