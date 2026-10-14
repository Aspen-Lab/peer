import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InlineText } from "./inline-text";
import { NoteToolbarView, TOOLBAR_ITEMS, markForKey, typeAfterToggle } from "./note-toolbar";

// P10-09b (review 7.6, B16): the formatting toolbar above the blocks. Buttons act on the selection in the
// focused block through the editor's inline-markdown model; the keys are ⌘/Ctrl+B I E U and ⌘/Ctrl+Shift+H.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const key = (k: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) => ({
  key: k, metaKey: false, ctrlKey: true, shiftKey: false, altKey: false, ...extra,
});

describe("the keys", () => {
  it("B bold, I italic, E code, U underline — with ⌘ or Ctrl", () => {
    expect(markForKey(key("b"))).toBe("strong");
    expect(markForKey(key("i"))).toBe("em");
    expect(markForKey(key("e"))).toBe("code");
    expect(markForKey(key("u"))).toBe("underline");
    expect(markForKey(key("B", { ctrlKey: false, metaKey: true }))).toBe("strong");
  });

  it("Shift+H is the highlight, and only with Shift", () => {
    expect(markForKey(key("h", { shiftKey: true }))).toBe("mark");
    expect(markForKey(key("H", { shiftKey: true }))).toBe("mark");
    expect(markForKey(key("h"))).toBeNull();
  });

  it("is nothing without the modifier, or with Alt, or for any other letter", () => {
    expect(markForKey(key("b", { ctrlKey: false }))).toBeNull();
    expect(markForKey(key("b", { altKey: true }))).toBeNull();
    expect(markForKey(key("b", { shiftKey: true }))).toBeNull();
    expect(markForKey(key("k"))).toBeNull();
  });
});

describe("the buttons", () => {
  const view = (props: Partial<Parameters<typeof NoteToolbarView>[0]> = {}) =>
    renderToStaticMarkup(createElement(NoteToolbarView, { active: "text", enabled: true, onMark: () => {}, onType: () => {}, ...props }));

  it("are bold, italic, underline, highlight, code, heading, bullets and numbering, in that order", () => {
    expect(TOOLBAR_ITEMS.map((i) => i.label)).toEqual([
      "Bold", "Italic", "Underline", "Highlight", "Code", "Heading", "Bulleted list", "Numbered list",
    ]);
    const html = view();
    let at = -1;
    for (const { label } of TOOLBAR_ITEMS) {
      const next = html.indexOf(`aria-label="${label}"`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it("are buttons that keep the caret where it was (mousedown does not take focus) and name their keys", () => {
    const html = view();
    expect(html.match(/<button\b/g)).toHaveLength(TOOLBAR_ITEMS.length);
    expect(html.match(/type="button"/g)).toHaveLength(TOOLBAR_ITEMS.length);
    expect(html).toMatch(/title="Bold \([^"]*B\)"/);
    expect(html).toMatch(/title="Underline \([^"]*U\)"/);
    expect(html).toMatch(/title="Highlight \([^"]*H\)"/);
    expect(read("src/components/notes/note-toolbar.tsx")).toContain("onMouseDown");
    expect(read("src/components/notes/note-toolbar.tsx")).toContain("preventDefault");
  });

  it("show the list the focused block is in as pressed", () => {
    const html = view({ active: "bullet" });
    expect(html).toMatch(/aria-label="Bulleted list"[^>]*aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Numbered list"[^>]*aria-pressed="false"/);
  });

  it("are disabled when no block holds the caret", () => {
    const html = view({ enabled: false, active: null });
    expect(html.match(/disabled=""/g)).toHaveLength(TOOLBAR_ITEMS.length);
  });

  it("a second press on the same list turns the block back into text", () => {
    expect(typeAfterToggle("text", "bullet")).toBe("bullet");
    expect(typeAfterToggle("bullet", "bullet")).toBe("text");
    expect(typeAfterToggle("numbered", "bullet")).toBe("bullet");
    expect(typeAfterToggle("h2", "h2")).toBe("text");
  });
});

describe("the marks render", () => {
  const html = renderToStaticMarkup(
    createElement(InlineText, { text: "a __under__ and ==lit== and **__both__**", sources: {}, noteId: () => null, onMissingNote: () => {} }),
  );

  it("underline as <u>, highlight as <mark>, and nest inside bold", () => {
    expect(html).toContain("<u");
    expect(html).toContain(">under</u>");
    expect(html).toContain("<mark");
    expect(html).toContain(">lit</mark>");
    expect(html).toMatch(/<strong[^>]*>.*<u[^>]*>both<\/u>.*<\/strong>/);
    expect(html).not.toContain("__");
    expect(html).not.toContain("==");
  });

  it("every run still says where it starts in the source, so a click lands the caret", () => {
    expect(html).toContain('data-inner="4"');
  });
});

describe("the editor wires them", () => {
  const editor = read("src/components/notes/note-editor.tsx");

  it("mounts the toolbar above the blocks and takes the keys from markForKey", () => {
    expect(editor).toContain("<NoteToolbar");
    expect(editor).toContain("markForKey(");
    expect(editor).toContain("markEdit(");
    expect(editor.indexOf("<NoteToolbar")).toBeLessThan(editor.indexOf("{doc.blocks.map((b, i) => ("));
  });

  it("the notes page gets the same toolbar, because it mounts the same editor", () => {
    const page = read("src/app/notes/[id]/page.tsx");
    expect(page).toContain("<NoteEditor");
    expect(page).not.toContain("compact");
  });
});
