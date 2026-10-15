// A note, out of Peer: Markdown for Obsidian or Pandoc, BibTeX for LaTeX.
//
// P10-09b (review 7.3): and, from the notes window, plain text, Word and (through the browser's print) PDF — one
// body, four dressings. Word is an HTML file with the Word namespaces that Word opens as a document (no docx
// library); the PDF is the browser's print of `toPrintHtml`, which holds the note alone. A sticky note's quoted
// passage is `anchor.quote` on its heading block and is never any block's text, so none of these reads it; and
// P10-09e (review 7.3, "the quoted text is not exported"): a `quote` block a note holds is skipped by every one.
//
// The Markdown keeps citations as `[@key]` — Pandoc's syntax — and the .bib
// carries the same keys, so `pandoc draft.md --citeproc --bibliography
// draft.bib` turns a draft into a paper with its references formatted. In
// Obsidian the same file reads as a note, front matter and all. Template
// prompts are UI, never content: they do not leave.

import type { Block, Note, Source } from "./types";
import { isWrapping, parseInline } from "./inline";
import { citedKeys, isList, isTextual, listNumber } from "./blocks";
import { authorYear, externalLink } from "./cite";

function yaml(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** The reader's own calendar day, not UTC's: a note written on the evening
 *  of the 18th is dated the 18th wherever it was written. */
function day(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10);
  const two = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`;
}

/** A link only for an address that means something outside the app: a DOI, or an `http(s)` URL that is not the app's
 *  own `/api/` path (P10-09e, rule 4). */
function linkOf(s: Source): string | undefined {
  return externalLink(s.url) ?? (s.doi ? `https://doi.org/${s.doi}` : undefined);
}

/** One reference, as the list at the end of the note gives it. A work whose
 *  record names no author leads with its title, as the author-date styles
 *  set it — "(2026). A First Course…" reads as a line that lost its start. */
export function reference(s: Source): string {
  const venue = s.venue ? ` *${s.venue}*.` : "";
  const link = linkOf(s);
  // An unknown year is left out, not written "(n.d.)" (P10-09e, rule 4).
  const year = s.year ? `(${s.year}).` : "";
  const lead =
    s.authors.length > 0
      ? `${s.authors.join(", ")}${year ? ` ${year}` : "."} ${s.title}.`
      : `${s.title}.${year ? ` ${year}` : ""}`;
  return `${lead}${venue}${link ? ` ${link}` : ""}`;
}

/** P10-09e: a reading note opens on an `h1` that is the note's own title; the export already says the title once, so
 *  that line is not said a second time. */
function isTitleLine(note: Pick<Note, "title" | "blocks">, b: Block, i: number): boolean {
  const title = note.title.trim();
  return i === 0 && b.type === "h1" && title !== "" && b.text.trim() === title;
}

function blockMarkdown(b: Block, blocks: Block[], i: number, sources: Record<string, Source>): string | null {
  // P10-09e (review 7.3): quoted text is not exported — a quote block leaves no line, in any format.
  if (b.type === "quote") return null;
  const pad = "    ".repeat(b.indent ?? 0);
  if (isTextual(b.type) && !b.text.trim()) return null;
  // Prose loses trailing spaces (a citation typed at a line's end leaves
  // one); code keeps every character it was given.
  const text = b.type === "code" ? b.text : b.text.replace(/[ \t]+$/gm, "");
  // A line break inside a list item has to stay inside the item.
  const item = (t: string) => t.replace(/\n/g, `\n${pad}  `);
  switch (b.type) {
    case "text":
      return text;
    case "h1":
      return `# ${text}`;
    case "h2":
      return `## ${text}`;
    case "h3":
      return `### ${text}`;
    case "bullet":
      return `${pad}- ${item(text)}`;
    case "numbered":
      return `${pad}${listNumber(blocks, i)}. ${item(text)}`;
    case "todo":
      return `${pad}- [${b.checked ? "x" : " "}] ${item(text)}`;
    case "code":
      return `\`\`\`\n${b.text}\n\`\`\``;
    case "divider":
      return "---";
    case "paper": {
      const s = b.cite ? sources[b.cite] : undefined;
      if (!s) return null;
      const link = linkOf(s);
      return `> [@${s.key}] ${authorYear(s)}. *${s.title}*.${s.venue ? ` ${s.venue}.` : ""}${link ? ` <${link}>` : ""}`;
    }
  }
}

export function toMarkdown(note: Note): string {
  const parts: string[] = [
    "---",
    `title: ${yaml(note.title.trim() || "Untitled")}`,
    `created: ${day(note.createdAt)}`,
    `updated: ${day(note.updatedAt)}`,
    "---",
    "",
  ];
  let body = "";
  let prev: Block | null = null;
  note.blocks.forEach((b, i) => {
    if (isTitleLine(note, b, i)) return;
    const md = blockMarkdown(b, note.blocks, i, note.sources);
    if (md === null) return;
    // A list is one list: its items sit on consecutive lines.
    body += body ? (prev && isList(prev.type) && isList(b.type) ? "\n" : "\n\n") : "";
    body += md;
    prev = b;
  });
  if (body) parts.push(body);

  const keys = citedKeys(note).filter((k) => note.sources[k]);
  if (keys.length > 0) {
    parts.push("", "## References", "");
    for (const k of keys) parts.push(`- [@${k}] ${reference(note.sources[k])}`);
  }
  return `${parts.join("\n").trimEnd()}\n`;
}

const HONORIFIC = /^(dr|prof|mr|mrs|ms|mx)\.\s*/i;

function bib(s: string): string {
  return s.replace(/([&%$#_{}])/g, "\\$1");
}

/** BibTeX for every source the note cites — `@misc`, which every style
 *  accepts, carrying the venue as `howpublished`. */
export function toBibtex(note: Note): string {
  return citedKeys(note)
    .map((k) => note.sources[k])
    .filter((s): s is Source => Boolean(s))
    .map((s) => {
      const fields: [string, string][] = [["title", `{${bib(s.title)}}`]];
      const authors = s.authors.map((a) => a.replace(HONORIFIC, "").trim()).filter(Boolean);
      if (authors.length > 0) fields.push(["author", bib(authors.join(" and "))]);
      if (s.year) fields.push(["year", String(s.year)]);
      if (s.venue) fields.push(["howpublished", bib(s.venue)]);
      if (s.doi) fields.push(["doi", s.doi]);
      const link = linkOf(s);
      if (link) fields.push(["url", link]);
      return `@misc{${s.key},\n${fields.map(([k, v]) => `  ${k} = {${v}},`).join("\n")}\n}`;
    })
    .join("\n\n")
    .concat("\n");
}

/** A file name from the note's title. */
export function fileName(note: Pick<Note, "title">, ext: "md" | "bib" | "txt" | "doc"): string {
  const base =
    note.title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note";
  return `${base}.${ext}`;
}

// ── Plain text ────────────────────────────────────────────────────────────

/** A block's inline Markdown as words: marks dropped (nested ones too), a citation as author and year, a link as its
 *  text and address, a note link as its title. */
function wordsOf(src: string, sources: Record<string, Source>): string {
  return parseInline(src)
    .map((t) => {
      if (isWrapping(t)) return wordsOf(t.text, sources);
      switch (t.kind) {
        case "cite":
          return `(${t.keys.map((k) => (sources[k] ? authorYear(sources[k]) : k)).join("; ")})`;
        case "wiki":
          return t.target;
        case "link":
          return t.text === t.href ? t.text : `${t.text} (${t.href})`;
        default:
          return t.text;
      }
    })
    .join("");
}

function blockText(b: Block, blocks: Block[], i: number, sources: Record<string, Source>): string | null {
  if (b.type === "quote") return null; // P10-09e: quoted text is not exported
  if (isTextual(b.type) && !b.text.trim()) return null;
  const pad = "  ".repeat(b.indent ?? 0);
  const words = b.type === "code" ? b.text : wordsOf(b.text.replace(/[ \t]+$/gm, ""), sources);
  const item = (t: string) => t.replace(/\n/g, `\n${pad}  `);
  switch (b.type) {
    case "text":
    case "h1":
    case "h2":
    case "h3":
    case "code":
      return words;
    case "bullet":
      return `${pad}- ${item(words)}`;
    case "numbered":
      return `${pad}${listNumber(blocks, i)}. ${item(words)}`;
    case "todo":
      return `${pad}- [${b.checked ? "x" : " "}] ${item(words)}`;
    case "divider":
      return "---";
    case "paper": {
      const s = b.cite ? sources[b.cite] : undefined;
      return s ? `${authorYear(s)}. ${s.title}.${s.venue ? ` ${s.venue}.` : ""}` : null;
    }
  }
}

/**
 * The note as plain text: the title, then the blocks' words without markup — headings as lines, bullets as `- `,
 * numbers as `1. `, a list on consecutive lines, everything else a paragraph — and the references the note cites.
 */
export function toPlainText(note: Note): string {
  const parts: string[] = [];
  const title = note.title.trim();
  if (title) parts.push(title);
  let body = "";
  let prev: Block | null = null;
  note.blocks.forEach((b, i) => {
    if (isTitleLine(note, b, i)) return;
    const text = blockText(b, note.blocks, i, note.sources);
    if (text === null) return;
    body += body ? (prev && isList(prev.type) && isList(b.type) ? "\n" : "\n\n") : "";
    body += text;
    prev = b;
  });
  if (body) parts.push(body);
  const keys = citedKeys(note).filter((k) => note.sources[k]);
  if (keys.length > 0) parts.push(["References", ...keys.map((k) => `- ${reference(note.sources[k]).replace(/\*/g, "")}`)].join("\n"));
  return `${parts.join("\n\n").trimEnd()}\n`;
}

// ── Word and print ────────────────────────────────────────────────────────

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Word reads the highlighter from `mso-highlight`; the background is for every other reader of the file. */
const HIGHLIGHT = 'style="background:#ffe066;mso-highlight:yellow"';

function htmlOf(src: string, sources: Record<string, Source>): string {
  return parseInline(src)
    .map((t) => {
      switch (t.kind) {
        case "strong":
          return `<b>${htmlOf(t.text, sources)}</b>`;
        case "em":
          return `<i>${htmlOf(t.text, sources)}</i>`;
        case "underline":
          return `<u>${htmlOf(t.text, sources)}</u>`;
        case "mark":
          return `<mark ${HIGHLIGHT}>${htmlOf(t.text, sources)}</mark>`;
        case "code":
          return `<code>${esc(t.text)}</code>`;
        case "link":
        case "url":
          return `<a href="${esc(t.href)}">${esc(t.text)}</a>`;
        case "cite":
          return esc(`(${t.keys.map((k) => (sources[k] ? authorYear(sources[k]) : k)).join("; ")})`);
        case "wiki":
          return esc(t.target);
        default:
          return esc(t.text).replace(/\n/g, "<br>");
      }
    })
    .join("");
}

function bodyHtml(note: Note): string {
  const out: string[] = [];
  const title = note.title.trim();
  if (title) out.push(`<h1>${esc(title)}</h1>`);
  // Lists nest by indent: `open` holds the tags of the lists open now, one per level, each with its item left open.
  const open: ("ul" | "ol")[] = [];
  const closeTo = (depth: number) => {
    while (open.length > depth) out.push(`</li>\n</${open.pop()}>\n`);
  };
  note.blocks.forEach((b, i) => {
    if (isTitleLine(note, b, i) || b.type === "quote") return;
    if (isTextual(b.type) && !b.text.trim()) return;
    if (b.type === "bullet" || b.type === "numbered" || b.type === "todo") {
      const depth = Math.min(b.indent ?? 0, open.length) + 1;
      const tag = b.type === "numbered" ? "ol" : "ul";
      closeTo(depth);
      if (open.length === depth && open[depth - 1] !== tag) closeTo(depth - 1);
      if (open.length === depth) out.push("</li>\n");
      else {
        out.push(`<${tag}>\n`);
        open.push(tag);
      }
      const box = b.type === "todo" ? (b.checked ? "\u2611 " : "\u2610 ") : "";
      out.push(`<li>${box}${htmlOf(b.text, note.sources)}`);
      return;
    }
    closeTo(0);
    switch (b.type) {
      case "text":
        out.push(`<p>${htmlOf(b.text, note.sources)}</p>\n`);
        break;
      case "h1":
      case "h2":
      case "h3":
        out.push(`<${b.type}>${htmlOf(b.text, note.sources)}</${b.type}>\n`);
        break;
      case "code":
        out.push(`<pre>${esc(b.text)}</pre>\n`);
        break;
      case "divider":
        out.push("<hr>\n");
        break;
      case "paper": {
        const s = b.cite ? note.sources[b.cite] : undefined;
        if (s) out.push(`<blockquote>${esc(authorYear(s))}. <i>${esc(s.title)}</i>.${s.venue ? ` ${esc(s.venue)}.` : ""}</blockquote>\n`);
        break;
      }
    }
  });
  closeTo(0);
  const keys = citedKeys(note).filter((k) => note.sources[k]);
  if (keys.length > 0) {
    out.push("<h2>References</h2>\n<ul>\n");
    for (const k of keys) out.push(`<li>${htmlOf(reference(note.sources[k]), note.sources)}</li>\n`);
    out.push("</ul>\n");
  }
  return out.join("");
}

const STYLES = `
body { font-family: Georgia, "Times New Roman", serif; font-size: 11pt; line-height: 1.5; color: #1d1d1d; }
h1 { font-size: 20pt; margin: 0 0 12pt; }
h2 { font-size: 15pt; margin: 18pt 0 6pt; }
h3 { font-size: 12pt; margin: 14pt 0 4pt; }
p, li { margin: 0 0 6pt; }
blockquote { margin: 6pt 0 6pt 18pt; padding-left: 10pt; border-left: 2pt solid #bbb; color: #555; }
pre, code { font-family: Consolas, "Courier New", monospace; font-size: 10pt; }
pre { background: #f1f1f1; padding: 6pt 8pt; white-space: pre-wrap; }
mark { background: #ffe066; }
hr { border: 0; border-top: 1pt solid #bbb; margin: 12pt 0; }
a { color: #1d1d1d; }`;

/**
 * The note as a Word document: HTML with the Word namespaces, which Word opens and saves as its own. Headings, lists,
 * <b> <i> <u> <mark>. Saved as `<title>.doc`, `application/msword`.
 */
export function toWordHtml(note: Note): string {
  const title = esc(note.title.trim() || "Untitled");
  return `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
<head>
<meta charset="utf-8">
<title>${title}</title>
<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->
<style>${STYLES}
</style>
</head>
<body>
${bodyHtml(note)}</body>
</html>
`;
}

/**
 * The note alone, as a page the browser prints: the same body as the Word file with a print stylesheet. Printed to
 * PDF by the reader (`print.ts` prints it from a hidden frame, so nothing else on the page is in it).
 */
export function toPrintHtml(note: Note): string {
  const title = esc(note.title.trim() || "Untitled");
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STYLES}
body { margin: 0; padding: 0; }
@page { margin: 18mm; }
@media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } h1, h2, h3 { break-after: avoid; } blockquote, pre { break-inside: avoid; } }
</style>
</head>
<body>
${bodyHtml(note)}</body>
</html>
`;
}
