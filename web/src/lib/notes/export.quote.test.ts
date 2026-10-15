import { describe, expect, it } from "vitest";
import { block } from "./blocks";
import { toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "./export";
import type { Block, Note } from "./types";

// P10-09e (rule 2; the owner's 7.3: "引用的文字就算了不要导出"): no export carries a quote block — Markdown (which is also
// the notes page's export and the editor's copy), plain text (the window's copy and .txt), Word and print.
// The blank note's quote block stays out of them the same way. The words around it stay in.

const QUOTE = "A quoted sentence the reader pulled from the paper.";

function noteWith(blocks: Block[]): Note {
  return { id: "n", title: "Invented", blocks, sources: {}, createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z" };
}
const BETWEEN = noteWith([
  block("text", "Words before the quote."),
  block("quote", QUOTE),
  block("text", "Words after the quote."),
]);

describe("a quote block between two text blocks", () => {
  it("is not in the Markdown, and the words around it are, as two paragraphs", () => {
    const md = toMarkdown(BETWEEN);
    expect(md).not.toContain("quoted sentence");
    expect(md).not.toMatch(/^>/m);
    expect(md).toContain("Words before the quote.\n\nWords after the quote.");
  });

  it("is not in the plain text (the copy and the .txt)", () => {
    const text = toPlainText(BETWEEN);
    expect(text).not.toContain("quoted sentence");
    expect(text).toContain("Words before the quote.\n\nWords after the quote.");
  });

  it("is not in the Word file", () => {
    const html = toWordHtml(BETWEEN);
    expect(html).not.toContain("quoted sentence");
    expect(html).not.toContain("<blockquote>");
    expect(html).toContain("<p>Words before the quote.</p>");
    expect(html).toContain("<p>Words after the quote.</p>");
  });

  it("is not in the print page", () => {
    const html = toPrintHtml(BETWEEN);
    expect(html).not.toContain("quoted sentence");
    expect(html).not.toContain("<blockquote>");
    expect(html).toContain("<p>Words after the quote.</p>");
  });

  it("leaves a list that sits around it one list on each side", () => {
    const md = toMarkdown(noteWith([block("bullet", "a"), block("quote", QUOTE), block("bullet", "b")]));
    expect(md).not.toContain("quoted sentence");
    expect(md).toContain("- a\n- b");
  });
});
