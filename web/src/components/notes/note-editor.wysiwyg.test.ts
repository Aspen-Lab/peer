import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { block } from "@/lib/notes/blocks";
import { toMarkdown, toPlainText, toWordHtml } from "@/lib/notes/export";
import { plainInline } from "@/lib/notes/inline";
import type { Note } from "@/lib/notes/types";

// P10-16 (B16, the owner's ruling §1h.90 (a)): the block being edited is the formatted text, not its source. The
// behaviour of the pieces is in `lib/notes/wysiwyg.test.ts` (the DOM goes through a stand-in: this project has no jsdom);
// this file pins that the editor is built from them — the surface is a `contentEditable` element drawn from the source
// and written back to it, the keys and the toolbar act on the words selected in it, undo is a stack of sources, and every
// surface that edits a block is this editor. What only a browser can say is measured in Chromium (the checkpoint).

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const editor = read("src/components/notes/note-editor.tsx");

describe("the editing surface (rule 1)", () => {
  it("a text block being edited is a contentEditable element, not a textarea of its source", () => {
    expect(editor).toContain("contentEditable");
    expect(editor).toContain("<Surface");
    // the one block textarea left is the code block's: nothing in it is markup
    expect(editor).toMatch(/else if \(editing && b\.type === "code"\) \{\s*content = \(\s*<textarea/);
    expect(editor).not.toMatch(/else if \(editing\) \{\s*content = \(\s*<textarea/);
  });

  it("the surface is drawn from the block's source and its DOM written back to it on every input", () => {
    expect(editor).toContain("mountInline(document, el, treeOf(text, cite))");
    expect(editor).toContain("snapshot(el)");
    expect(editor).toContain("onInput=");
    expect(editor).toContain("readsDifferently(");
  });

  it("the surface takes plain text only: a paste is cancelled and its words inserted", () => {
    expect(editor).toMatch(/paste: \(e, id\) => \{[\s\S]*?e\.preventDefault\(\);[\s\S]*?getData\("text\/plain"\)/);
  });

  it("the placeholder is drawn by CSS from the surface's own attribute, so an empty block shows no markup either", () => {
    expect(editor).toContain("data-placeholder");
    expect(editor).toContain("empty:before:content-[attr(data-placeholder)]");
  });

  it("the header says what the editor is now (the textarea per block is gone) and that Markdown stays the format", () => {
    expect(editor).toMatch(/contentEditable/);
    expect(editor).not.toContain("A textarea per block is the robust choice");
    expect(editor).toMatch(/Markdown is the\s*\/\/ format/);
  });
});

describe("the keys and the toolbar act on the selected words (rule 3)", () => {
  it("a mark is applied by plain offsets through markSource and the same words are selected again", () => {
    expect(editor).toContain("markSource(b.text, sel.from, sel.to, mark, label)");
    expect(editor).toMatch(/focusBlock\(id, \{ plain: sel\.from, to: sel\.to \}\)/);
    expect(editor).toContain("getPlainSelection(el)");
  });

  it("with nothing selected the mark is toggled for what is typed next, and that text is written by the editor wearing it", () => {
    expect(editor).toContain("pendingMarks");
    expect(editor).toContain("insertMarked(");
    expect(editor).toContain('ev.inputType === "insertText"');
  });

  it("the caret target can be a plain range, which is how a selection survives a change of marks", () => {
    expect(editor).toMatch(/type Caret = number \| "start" \| "end" \| \{ plain: number; to\?: number \}/);
    expect(editor).toContain("setPlainSelection(el, from, to)");
  });
});

describe("undo and the caret (rule 4)", () => {
  it("⌘/Ctrl Z, Shift Z and Y step the block's own history, and the browser's undo is cancelled", () => {
    expect(editor).toContain("stepHistory(id, letter === \"y\" || e.shiftKey)");
    expect(editor).toContain("stepBack(h)");
    expect(editor).toContain("stepForward(h)");
    expect(editor).toContain('"historyUndo"');
  });

  it("typing, deleting and each mark are remembered; the save and the sticky's write never touch the caret (the surface is drawn again only when its source is not the one it wrote)", () => {
    expect(editor).toContain("remember(id, b.text, edit.text");
    expect(editor).toContain("if (!el || drawn.current === text) return;");
  });

  it("Enter cuts the words at the selection with the marks closed either side; Backspace and Delete join them whole", () => {
    expect(editor).toContain("splitSource(b.text, sel.from, sel.to, label)");
    expect(editor).toContain("joinSources(x.text, y.text, label)");
    expect(editor).toContain("const both = joined(prev, b)");
  });

  it("the caret leaves a block by the visible characters, not the source's", () => {
    expect(editor).toContain("sel.from !== 0");
    expect(editor).toContain("sel.to !== sel.len");
    expect(editor).toContain("caretLines(el)");
  });
});

describe("every surface that edits a block is this editor (rule 5)", () => {
  it("the notes window and the notes page mount NoteEditor", () => {
    expect(read("src/components/notes/notes-window.tsx")).toContain("<NoteEditor");
    expect(read("src/app/notes/[id]/page.tsx")).toContain("<NoteEditor");
  });

  it("the editor has no character limit anywhere", () => {
    expect(editor).not.toMatch(/maxLength|maxlength/);
  });
});

describe("the exports (rule 5)", () => {
  const note: Note = {
    id: "n1",
    title: "Reading",
    blocks: [block("text", "alpha ==__**beta**__== gamma [@rose2024]"), block("h2", "a **bold** heading")],
    sources: { rose2024: { key: "rose2024", paperId: "p1", title: "T", authors: ["Rose"], year: 2024 } as Note["sources"][string] },
    createdAt: "2026-10-14T00:00:00.000Z",
    updatedAt: "2026-10-14T00:00:00.000Z",
  } as Note;

  it("the .md export keeps the marks: Markdown is the format", () => {
    expect(toMarkdown(note)).toContain("alpha ==__**beta**__== gamma [@rose2024]");
    expect(toMarkdown(note)).toContain("## a **bold** heading");
  });

  it("the .txt, Copy and .doc exports show the final look: no marks in the text, marks as Word marks", () => {
    expect(toPlainText(note)).toContain("alpha beta gamma");
    expect(toPlainText(note)).not.toMatch(/\*\*|==|__/);
    expect(toWordHtml(note)).toContain("<u>");
    expect(toWordHtml(note)).not.toMatch(/\*\*|==\w|__\w/);
    expect(plainInline("alpha ==__**beta**__== gamma")).toBe("alpha beta gamma");
  });
});
