import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { toMarkdown, toPlainText, toWordHtml } from "./export";
import { isWrapping, parseInline } from "./inline";
import type { Block, Note } from "./types";

// P12-77 rule 2 (O2), the Markdown that leaves the app: CommonMark, Obsidian and Pandoc read the stored `__x__` as bold, so an underlined word came
// out of the window's Export, the notes page's and the rail's download bold. `blockMarkdown` (the one place all three get their Markdown from)
// now writes each underline `<u>x</u>`, and nothing else about the Markdown changes by a byte: bold, italic, code, highlight, the headings, the
// list markers and the indent of a two-level list. The stored text, and what the toolbar writes, is untouched (`MARKERS.underline` is `__`).
// Every text here is invented.

const note = (blocks: Block[]): Note => ({
  id: "n1",
  title: "Seaweed mulch and soil water",
  blocks,
  sources: {},
  createdAt: "2026-10-28T09:00:00.000Z",
  updatedAt: "2026-10-28T09:00:00.000Z",
});

const HEAD = ['---', 'title: "Seaweed mulch and soil water"', "created: 2026-10-28", "updated: 2026-10-28", "---", ""];

/** One note with bold, italic, underline and a two-level list — the measure of the brief. */
const stored = (under: (word: string) => string) =>
  note([
    block("text", `A **bold** word, an *italic* word and an ${under("underlined")} word.`),
    block("bullet", `First item with ${under("under")} and **bold**`),
    block("bullet", `Nested item with *italic* and ${under("under")}`, { indent: 1 }),
  ]);

describe("the Markdown carries an underline as <u>…</u> (O2)", () => {
  it("one note with bold, italic, underline and a two-level list: only the underline differs from the stored text, byte for byte", () => {
    const md = toMarkdown(stored((w) => `__${w}__`));

    expect(md).toBe(
      [
        ...HEAD,
        "A **bold** word, an *italic* word and an <u>underlined</u> word.",
        "",
        "- First item with <u>under</u> and **bold**",
        "  - Nested item with *italic* and <u>under</u>",
        "",
      ].join("\n"),
    );
  });

  it("a note with no underline is written exactly as it was: the stored text, the list markers and the indent", () => {
    const md = toMarkdown(stored((w) => w));

    expect(md).toBe(
      [
        ...HEAD,
        "A **bold** word, an *italic* word and an underlined word.",
        "",
        "- First item with under and **bold**",
        "  - Nested item with *italic* and under",
        "",
      ].join("\n"),
    );
  });

  it("a note stored either way gives the same Markdown: an old `__x__` is covered, a pasted `<u>x</u>` stays", () => {
    expect(toMarkdown(stored((w) => `__${w}__`))).toBe(toMarkdown(stored((w) => `<u>${w}</u>`)));
  });

  it("every block that holds prose: headings, paragraph, bullet, number, to-do, nested marks", () => {
    const md = toMarkdown(
      note([
        block("h1", "A __first__ heading"),
        block("h2", "A __second__ heading"),
        block("h3", "A __third__ heading"),
        block("text", "**__both__** and __**both**__ and ==__lit__=="),
        block("numbered", "one __u__"),
        block("todo", "task __u__", { checked: true }),
      ]),
    );

    expect(md).toContain("# A <u>first</u> heading");
    expect(md).toContain("## A <u>second</u> heading");
    expect(md).toContain("### A <u>third</u> heading");
    expect(md).toContain("**<u>both</u>** and <u>**both**</u> and ==<u>lit</u>==");
    expect(md).toContain("1. one <u>u</u>");
    expect(md).toContain("- [x] task <u>u</u>");
    expect(md).not.toContain("__");
  });

  it("leaves a code block, a code run and a link's address as they are: a `__` there was never an underline", () => {
    const md = toMarkdown(
      note([block("code", "def __init__(self):\n    pass"), block("text", "`__x__` and [__a__](https://example.org/a__b__c) and snake__case__name")]),
    );

    expect(md).toContain("```\ndef __init__(self):\n    pass\n```");
    expect(md).toContain("`__x__` and [__a__](https://example.org/a__b__c) and snake__case__name");
  });

  it("is read back as the underline it was: the written Markdown parses to the same shape and the same words", () => {
    const shape = (s: string): unknown[] => parseInline(s).map((t) => (isWrapping(t) ? [t.kind, shape(t.text)] : t.kind === "text" ? t.text : t.kind));
    const lines = toMarkdown(stored((w) => `__${w}__`)).split("\n").filter((l) => l.includes("<u>"));

    expect(lines).toHaveLength(3);
    for (const line of lines) expect(JSON.stringify(shape(line)), line).toContain('"underline"');
    expect(shape("First item with <u>under</u> and **bold**")).toEqual(shape("First item with __under__ and **bold**"));
  });
});

describe("the other exports are not the Markdown's business (O2)", () => {
  const n = stored((w) => `__${w}__`);

  it("plain text has the words only, Word holds a real <u>, and neither is changed by this", () => {
    expect(toPlainText(n)).toContain("an underlined word.");
    expect(toPlainText(n)).not.toMatch(/<u>|__/);
    expect((toWordHtml(n).match(/<u>underlined<\/u>/g) ?? []).length).toBe(1);
    expect(toWordHtml(n)).not.toContain("&lt;u&gt;");
  });

  it("the stored note is not rewritten by an export", () => {
    toMarkdown(n);

    expect(n.blocks[0].text).toBe("A **bold** word, an *italic* word and an __underlined__ word.");
  });
});

describe("every Markdown route gets it from toMarkdown (O2)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("the notes window's Export, the notes page's Export and the rail's download all call toMarkdown, and write no Markdown of their own", () => {
    for (const file of ["src/components/notes/notes-window.tsx", "src/components/notes/note-editor.tsx", "src/components/notes/notes-rail.tsx"]) {
      const source = read(file);

      expect(source, file).toMatch(/toMarkdown\(/);
      expect(source, file).not.toMatch(/portableUnderline|blockMarkdown/);
    }
  });

  it("blockMarkdown is where the underline is written, and only for prose: a code block keeps every character it was given", () => {
    const source = read("src/lib/notes/export.ts");

    expect(source).toMatch(/b\.type === "code" \? b\.text : portableUnderline\(/);
  });
});
