import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { fileName, toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "./export";
import { sourceOf } from "./cite";
import type { Block, Note } from "./types";

// P10-09b (review 7.3, B13): the note leaves Peer as plain text, Markdown, Word and (through the browser's
// print) PDF. A sticky note's passage (`anchor.quote`) is never a block's text, so no format carries it.

const QUOTE_A = "Seaweed mulch laid on terrace soil keeps more water than straw.";
const QUOTE_B = "A deeper layer of mulch kept the soil damp for nine more days.";
const QUOTE_C = "The effect vanished on the clay plots, which the authors set aside.";

const anchored = (n: number, quote: string): Block =>
  ({ ...block("h3", `Note ${n}`), anchor: { paperId: "p1", paragraphId: `p${n}`, quote, n } }) as unknown as Block;

const PAPER = { id: "p1", title: "Seaweed Mulch", authors: ["Ann Lee"], publishedDate: "2024" };

function note(blocks: Block[], extra: Partial<Note> = {}): Note {
  return {
    id: "n1",
    title: "Seaweed Mulch",
    blocks,
    sources: { lee2024seaweed: sourceOf(PAPER, "lee2024seaweed") },
    createdAt: "2026-10-13T10:00:00.000Z",
    updatedAt: "2026-10-13T10:00:00.000Z",
    paperId: "p1",
    ...extra,
  };
}

const THREE = note([
  block("h2", "What it claims"),
  anchored(1, QUOTE_A),
  block("text", "My **own** words on the first passage."),
  anchored(2, QUOTE_B),
  block("text", "Second, with __underline__ and ==highlight==."),
  anchored(3, QUOTE_C),
  block("bullet", "a point"),
  block("bullet", "another point"),
  block("numbered", "first step"),
  block("numbered", "second step"),
]);

describe("toPlainText", () => {
  const text = toPlainText(THREE);

  it("is the words: the title, headings as lines, bullets as '- ', numbers as '1. ', no markup", () => {
    expect(text.startsWith("Seaweed Mulch\n")).toBe(true);
    expect(text).toContain("\nWhat it claims\n");
    expect(text).toContain("\nNote 1\n");
    expect(text).toContain("My own words on the first passage.");
    expect(text).toContain("Second, with underline and highlight.");
    expect(text).toContain("- a point\n- another point");
    expect(text).toContain("1. first step\n2. second step");
    for (const mark of ["**", "__", "==", "###", "##"]) expect(text).not.toContain(mark);
  });

  it("carries none of the three quoted passages", () => {
    for (const q of [QUOTE_A, QUOTE_B, QUOTE_C]) expect(text).not.toContain(q);
    expect(text).not.toMatch(/anchor|paragraphId/);
  });

  it("reads a citation as author and year, a link as its text and address, and skips empty blocks", () => {
    const n = note([
      block("text", "As [@lee2024seaweed] showed, see [the data](https://example.org/d)."),
      block("text", ""),
      block("divider"),
    ]);
    const t = toPlainText(n);
    expect(t).toContain("As (Lee, 2024) showed, see the data (https://example.org/d).");
    expect(t).not.toMatch(/\n\n\n/);
  });

  it("nests by indent and ends with one newline", () => {
    const t = toPlainText(note([block("bullet", "top"), block("bullet", "inner", { indent: 1 })]));
    expect(t).toContain("- top\n  - inner");
    expect(t.endsWith("\n")).toBe(true);
    expect(t.endsWith("\n\n")).toBe(false);
  });
});

describe("toWordHtml", () => {
  const html = toWordHtml(THREE);

  it("is an HTML document with the Word namespaces, UTF-8, and the title", () => {
    expect(html).toContain('xmlns:w="urn:schemas-microsoft-com:office:word"');
    expect(html).toContain('xmlns:o="urn:schemas-microsoft-com:office:office"');
    expect(html).toContain('<meta charset="utf-8">');
    expect(html).toContain("<title>Seaweed Mulch</title>");
  });

  it("carries headings, lists and the marks as <b> <i> <u> <mark>", () => {
    const marks = toWordHtml(note([block("text", "**b** *i* __u__ ==m== `c`")]));
    for (const tag of ["<b>b</b>", "<i>i</i>", "<u>u</u>", "<mark", ">m</mark>", "<code>c</code>"]) expect(marks).toContain(tag);
    expect(html).toContain("<h2>What it claims</h2>");
    expect(html).toContain("<h3>Note 1</h3>");
    expect(html).toMatch(/<ul>\s*<li>a point<\/li>\s*<li>another point<\/li>\s*<\/ul>/);
    expect(html).toMatch(/<ol>\s*<li>first step<\/li>\s*<li>second step<\/li>\s*<\/ol>/);
  });

  it("escapes what the reader typed", () => {
    const h = toWordHtml(note([block("text", "1 < 2 & <script>x</script>")], { title: "A & B" }));
    expect(h).toContain("1 &lt; 2 &amp; &lt;script&gt;x&lt;/script&gt;");
    expect(h).toContain("<title>A &amp; B</title>");
    expect(h).not.toContain("<script>");
  });

  it("carries none of the three quoted passages", () => {
    for (const q of [QUOTE_A, QUOTE_B, QUOTE_C]) expect(html).not.toContain(q);
    expect(html).not.toMatch(/paragraphId/);
  });
});

describe("toPrintHtml — what the browser prints to PDF", () => {
  const html = toPrintHtml(THREE);

  it("is the note alone: a document of its own with a print stylesheet, the same body as the Word file", () => {
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("@media print");
    expect(html).toContain("<h3>Note 1</h3>");
    expect(html).toContain("<b>own</b>");
    expect(html).toContain("<u>underline</u>");
  });

  it("carries none of the three quoted passages", () => {
    for (const q of [QUOTE_A, QUOTE_B, QUOTE_C]) expect(html).not.toContain(q);
  });
});

describe("toMarkdown keeps the marks as written and no quote", () => {
  it("is the stored text", () => {
    const md = toMarkdown(THREE);
    expect(md).toContain("Second, with __underline__ and ==highlight==.");
    expect(md).toContain("My **own** words");
    expect(md).toContain("### Note 1");
    for (const q of [QUOTE_A, QUOTE_B, QUOTE_C]) expect(md).not.toContain(q);
  });
});

describe("no limit", () => {
  const long = note(Array.from({ length: 200 }, (_, i) => block("text", `${String(i).padStart(3, "0")} ${"x".repeat(96)}`)));

  it("20,000 characters across 200 blocks leave every format whole", () => {
    expect(long.blocks.reduce((n, b) => n + b.text.length, 0)).toBe(20_000);
    for (const out of [toPlainText(long), toMarkdown(long), toWordHtml(long), toPrintHtml(long)]) {
      expect(out).toContain("199 " + "x".repeat(96));
      expect(out).toContain("000 " + "x".repeat(96));
    }
  });
});

describe("fileName takes the new extensions", () => {
  it("names the text and Word files after the title", () => {
    expect(fileName({ title: "Seaweed Mulch" }, "txt")).toBe("Seaweed-Mulch.txt");
    expect(fileName({ title: "Seaweed Mulch" }, "doc")).toBe("Seaweed-Mulch.doc");
    expect(fileName({ title: "Seaweed Mulch" }, "md")).toBe("Seaweed-Mulch.md");
    expect(fileName({ title: "" }, "doc")).toBe("note.doc");
  });
});
