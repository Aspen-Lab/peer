// A note, out of Peer: Markdown for Obsidian or Pandoc, BibTeX for LaTeX.
//
// The Markdown keeps citations as `[@key]` — Pandoc's syntax — and the .bib
// carries the same keys, so `pandoc draft.md --citeproc --bibliography
// draft.bib` turns a draft into a paper with its references formatted. In
// Obsidian the same file reads as a note, front matter and all. Template
// prompts are UI, never content: they do not leave.

import type { Block, Note, Source } from "./types";
import { citedKeys, isList, isTextual, listNumber } from "./blocks";
import { authorYear } from "./cite";

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

function linkOf(s: Source): string | undefined {
  return s.url ?? (s.doi ? `https://doi.org/${s.doi}` : undefined);
}

/** One reference, as the list at the end of the note gives it. A work whose
 *  record names no author leads with its title, as the author-date styles
 *  set it — "(2026). A First Course…" reads as a line that lost its start. */
export function reference(s: Source): string {
  const year = `(${s.year ?? "n.d."}).`;
  const venue = s.venue ? ` *${s.venue}*.` : "";
  const link = linkOf(s);
  const lead = s.authors.length > 0 ? `${s.authors.join(", ")} ${year} ${s.title}.` : `${s.title}. ${year}`;
  return `${lead}${venue}${link ? ` ${link}` : ""}`;
}

function blockMarkdown(b: Block, blocks: Block[], i: number, sources: Record<string, Source>): string | null {
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
    case "quote":
      return text
        .split("\n")
        .map((line) => `> ${line}`.trimEnd())
        .join("\n");
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
export function fileName(note: Pick<Note, "title">, ext: "md" | "bib"): string {
  const base =
    note.title
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "note";
  return `${base}.${ext}`;
}
