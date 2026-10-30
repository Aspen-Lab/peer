import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { block, highlightBlock } from "./blocks";
import { toMarkdown, toPlainText, toPrintHtml, toWordHtml } from "./export";
import { HIGHLIGHT_COLOURS, inkFor } from "./highlight-colours";
import { parseInline } from "./inline";
import type { Block, HighlightColourId, Note } from "./types";

// P11-08 (owner item 8; the owner's answer, ruling §1h.111 (d): "a highlight's words are in the overall note and in every
// export"; B P11-04 §2.5): a highlight leaves in every format, and only a highlight does — a sticky's quoted passage (P10 7.3)
// and a quote block's words stay out, as export.anchor.test.ts and export.quote.test.ts keep saying. Markdown is `==words==` in
// a paragraph of its own; plain text (and so Copy) is the words in a paragraph of their own; Word and PDF are a `<mark>` with
// the colour and the ink written into it, and Word's own yellow highlighter for Yellow only. Every text is invented.

const WORDS = "Seaweed mulch kept the terrace soil damp for nine more days.";
const STICKY_QUOTE = "The finest grains crept fastest, a sentence the sticky was taken on.";
const QUOTED = "A quoted sentence the reader pulled from the paper.";

const light = (colour: HighlightColourId = "yellow", words = WORDS, paragraphId = "paper-section-1-p2"): Block =>
  highlightBlock({ paperId: "p1", paragraphId, quote: words, start: 4, end: 4 + words.length, colour });

function noteWith(blocks: Block[]): Note {
  return { id: "n", title: "Invented", blocks, sources: {}, createdAt: "2026-10-19T00:00:00.000Z", updatedAt: "2026-10-19T00:00:00.000Z" };
}
const BETWEEN = noteWith([block("text", "Words before."), light(), block("text", "Words after.")]);
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("Markdown — a highlight is its own paragraph, ==words==", () => {
  it("stands between the blocks around it as a paragraph of its own", () => {
    expect(toMarkdown(BETWEEN)).toContain(`Words before.\n\n==${WORDS}==\n\nWords after.`);
  });

  it("is written by every colour the same way: the colour is not Markdown's to carry", () => {
    for (const { id } of HIGHLIGHT_COLOURS) {
      expect(toMarkdown(noteWith([light(id)]))).toContain(`\n\n==${WORDS}==\n`);
    }
  });

  it("exports bold and circled marks without mislabelling them as highlights", () => {
    const bold = light(); bold.highlight!.mark = "bold";
    const circled = light(); circled.highlight!.mark = "circle";
    const md = toMarkdown(noteWith([bold, circled]));
    expect(md).toContain(`**${WORDS}**`);
    expect(md).toContain(`◯ ${WORDS}`);
    expect(md).not.toContain(`==${WORDS}==`);
  });

  it("makes a note of highlights alone a note with a body, not an empty report", () => {
    const md = toMarkdown(noteWith([light("green", "First passage of the paper."), light("blue", "Second passage of the paper.")]));
    expect(md).toContain("==First passage of the paper.==\n\n==Second passage of the paper.==");
  });

  it("keeps the order of the note, a sticky's heading among the highlights", () => {
    const sticky = block("h3", "Note 1", { anchor: { paperId: "p1", paragraphId: "paper-section-1-p2", quote: STICKY_QUOTE, n: 1 } });
    const md = toMarkdown(noteWith([light("yellow", "Before the sticky."), sticky, block("text", "my words"), light("pink", "After the sticky.")]));
    expect(md.indexOf("==Before the sticky.==")).toBeLessThan(md.indexOf("### Note 1"));
    expect(md.indexOf("### Note 1")).toBeLessThan(md.indexOf("my words"));
    expect(md.indexOf("my words")).toBeLessThan(md.indexOf("==After the sticky.=="));
  });

  it("writes the dialect's own escapes for a star, an underscore and an equals sign, so the words come back as one mark", () => {
    const words = "p < 0.05* for run_two and a==b";
    const md = toMarkdown(noteWith([light("yellow", words)]));
    expect(md).toContain("==p < 0.05\\* for run\\_two and a\\=\\=b==");
    const line = md.split("\n").find((one) => one.startsWith("=="))!;
    const tokens = parseInline(line);
    expect(tokens).toHaveLength(1);
    expect(tokens[0].kind).toBe("mark");
  });

  it("collapses a line break in the words: a mark is one line", () => {
    expect(toMarkdown(noteWith([light("yellow", "two\nlines  of   words")]))).toContain("==two lines of words==");
  });

  it("writes nothing for a highlight that holds no readable words, and the note around it is whole", () => {
    const bare: Block = { ...block("text"), type: "highlight" };
    const empty = { ...light(), highlight: { ...light().highlight!, quote: "" } };
    const md = toMarkdown(noteWith([block("text", "Words before."), bare, empty, block("text", "Words after.")]));
    expect(md).not.toContain("==");
    expect(md).toContain("Words before.\n\nWords after.");
  });
});

describe("plain text and Copy — the words in a paragraph of their own", () => {
  it("is the words alone between the blocks around it, with no mark", () => {
    const text = toPlainText(BETWEEN);
    expect(text).toContain(`Words before.\n\n${WORDS}\n\nWords after.`);
    expect(text).not.toContain("==");
  });

  it("is what Copy copies, and the .txt (both are toPlainText)", () => {
    const window = read("src/components/notes/notes-window.tsx");
    expect(window).toMatch(/kind === "copy"\)\s*\{\s*try\s*\{\s*await navigator\.clipboard\.writeText\(toPlainText\(n\)\)/);
    expect(window).toMatch(/kind === "txt"\) downloadFile\(toPlainText\(n\)/);
  });

  it("makes a note of highlights alone a note with a body", () => {
    const text = toPlainText(noteWith([light("orange", "Only passage.")]));
    expect(text).toContain("Invented\n\nOnly passage.");
  });

  it("writes nothing for a highlight with no readable words", () => {
    const bare: Block = { ...block("text"), type: "highlight" };
    expect(toPlainText(noteWith([block("text", "Words before."), bare, block("text", "Words after.")]))).toContain("Words before.\n\nWords after.");
  });
});

describe.each([
  ["Word", toWordHtml],
  ["print (PDF)", toPrintHtml],
])("%s — a <mark> that carries its own colour and ink", (_name, html) => {
  it("is a paragraph holding one mark, the fill and the ink written into its style; Yellow also names Word's highlighter", () => {
    expect(html(BETWEEN)).toContain(
      `<p>Words before.</p>\n<p><mark style="background:#ffe600;color:#000000;mso-highlight:yellow">${WORDS}</mark></p>\n<p>Words after.</p>`,
    );
  });

  it("gives each preset its fill and the ink best on it, and mso-highlight to Yellow only", () => {
    for (const { id, fill } of HIGHLIGHT_COLOURS) {
      const page = html(noteWith([light(id)]));
      expect(page).toContain(`<p><mark style="background:${fill};color:${inkFor(fill)}`);
      expect(page.includes("mso-highlight:yellow")).toBe(id === "yellow");
    }
  });

  it("writes the Ink preset's words in white", () => {
    expect(html(noteWith([light("ink")]))).toContain(`<mark style="background:#1e40af;color:#ffffff">${WORDS}</mark>`);
  });

  it("escapes the words: they are the paper's, not markup", () => {
    const page = html(noteWith([light("yellow", 'a <b> & "c"')]));
    expect(page).toContain("a &lt;b&gt; &amp; &quot;c&quot;");
    expect(page).not.toContain("<b>");
  });

  it("reads a colour the table does not know as Yellow, and draws nothing for a highlight without words", () => {
    const odd = { ...light(), highlight: { ...light().highlight!, colour: "mauve" as HighlightColourId } };
    expect(html(noteWith([odd]))).toContain(`<mark style="background:#ffe600;color:#000000;mso-highlight:yellow">${WORDS}</mark>`);
    const bare: Block = { ...block("text"), type: "highlight" };
    expect(html(noteWith([block("text", "Words before."), bare]))).not.toContain("<mark");
  });

  it("leaves the inline highlight of a text block as it was, the one yellow", () => {
    expect(html(noteWith([block("text", "a ==marked== word")]))).toContain('<mark style="background:#ffe066;mso-highlight:yellow">marked</mark>');
  });
});

describe("only a highlight's words leave — a sticky's quote and a quote block's words stay out (P10 7.3)", () => {
  const sticky = block("h3", "Note 1", { anchor: { paperId: "p1", paragraphId: "paper-section-1-p2", quote: STICKY_QUOTE, n: 1 } });
  const MIXED = noteWith([sticky, block("text", "my own words"), block("quote", QUOTED), light("green")]);

  it("has the highlight's words and neither the sticky's quote nor the quoted words, in all four formats", () => {
    for (const out of [toMarkdown(MIXED), toPlainText(MIXED), toWordHtml(MIXED), toPrintHtml(MIXED)]) {
      expect(out).toContain(WORDS);
      expect(out).toContain("my own words");
      expect(out).not.toContain("finest grains");
      expect(out).not.toContain("quoted sentence");
    }
  });

  it("does not let the highlight's place in the paper into any format", () => {
    for (const out of [toMarkdown(MIXED), toPlainText(MIXED), toWordHtml(MIXED), toPrintHtml(MIXED)]) {
      expect(out).not.toContain("paper-section-1-p2");
      expect(out).not.toMatch(/paragraphId|"start"|"end"/);
    }
  });

  it("gives a highlight no entry in the references and no citation of its own", () => {
    expect(toMarkdown(MIXED)).not.toContain("## References");
  });
});

describe("the words about the exports say a highlight's words are in them", () => {
  it("the header of export.ts says so, and keeps saying a sticky's quote and a quote block are not", () => {
    const head = read("src/lib/notes/export.ts").split("\nimport ")[0].replace(/\n\/\/ ?/g, " ");
    expect(head).toMatch(/highlight/i);
    expect(head).toMatch(/sticky note's quoted passage/);
    expect(head).toMatch(/`quote` block/);
  });

  it("the comment above the export menu says every format carries a highlight's words", () => {
    const window = read("src/components/notes/notes-window.tsx");
    const comment = window.slice(0, window.indexOf("export const EXPORT_ITEMS")).split("\n").filter((line) => line.startsWith("/**")).pop() ?? "";
    expect(comment).toMatch(/sticky note's quoted passage/);
    expect(comment).toMatch(/highlight/i);
  });
});
