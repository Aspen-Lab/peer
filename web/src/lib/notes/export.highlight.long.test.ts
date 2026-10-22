import { describe, expect, it } from "vitest";
import { block, highlightBlock, readHighlight } from "./blocks";
import { toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "./export";
import type { Note } from "./types";

// P11-47 (round 3, Theme B walk, weighed (f); ruling §1h.148 rule 1): "every export carries" a highlight's words — whatever their number. A highlight of a whole
// paragraph (a triple click: 3,000 characters or more) leaves in Markdown, plain text and Copy, Word and print (PDF) with every character, on one line, and
// the note around it is whole. The exports never cut a highlight's words (they had no cap; this pins that they never grow one). Every text is invented.

function sentences(n: number): string {
  let out = "";
  for (let k = 0; out.length < n; k += 1) out += `${out ? " " : ""}In plot ${k} the crew counted the invented tide pools twice.`;
  return out;
}
const WORDS = sentences(3200);
const long = (words = WORDS) => highlightBlock({ paperId: "p1", paragraphId: "paper-section-1-p2", quote: words, start: 4, end: 4 + words.length, colour: "yellow" });
const note = (blocks: Note["blocks"]): Note => ({ id: "n", title: "Invented", blocks, sources: {}, createdAt: "2026-10-21T00:00:00.000Z", updatedAt: "2026-10-21T00:00:00.000Z" });
const BETWEEN = note([block("text", "Words before."), long(), block("text", "Words after.")]);

describe("a highlight of 3,200 characters leaves in every format whole", () => {
  it("is read back whole by the sanitiser, with no length limit of its own", () => {
    expect(readHighlight(long())?.quote).toBe(WORDS);
    expect(readHighlight(long(sentences(40000)))?.quote.length).toBeGreaterThan(40000);
  });

  it("Markdown: ==words== in a paragraph of its own, every character", () => {
    expect(toMarkdown(BETWEEN)).toContain(`Words before.\n\n==${WORDS}==\n\nWords after.`);
  });

  it("plain text and Copy: the words in a paragraph of their own, every character", () => {
    expect(toPlainText(BETWEEN)).toContain(`Words before.\n\n${WORDS}\n\nWords after.`);
  });

  it("Word and print (PDF): one <mark> holding every character", () => {
    for (const html of [toWordHtml(BETWEEN), toPrintHtml(BETWEEN)]) {
      expect(html).toContain(`<p>Words before.</p>\n<p><mark style="background:#ffe600;color:#000000;mso-highlight:yellow">${WORDS}</mark></p>\n<p>Words after.</p>`);
    }
  });

  it("the length of the words in each format is the length of the quote: nothing is cut", () => {
    const md = /==(.*)==/.exec(toMarkdown(BETWEEN))?.[1] ?? "";
    expect(md.length).toBe(WORDS.length);
    const markup = /<mark[^>]*>(.*)<\/mark>/.exec(toPrintHtml(BETWEEN))?.[1] ?? "";
    expect(markup.length).toBe(WORDS.length);
  });
});
