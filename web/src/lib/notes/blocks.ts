// What can be done to a note's blocks, as pure functions — the editor calls
// these and renders the result, so every rule here is testable without a DOM.

import type { Block, BlockType, Note, Source } from "./types";
import { citedIn, plainInline } from "./inline";
import { authorYear } from "./cite";

export const MAX_INDENT = 4;

/** Blocks that hold words and take a caret. A divider and a paper card are
 *  placed, not typed in. */
export function isTextual(type: BlockType): boolean {
  return type !== "divider" && type !== "paper";
}

export function isList(type: BlockType): boolean {
  return type === "bullet" || type === "numbered" || type === "todo";
}

/** Kinds that nest. A heading at an indent is a heading that has lost its
 *  place, so headings, code, dividers and cards stay at the margin. */
export function canIndent(type: BlockType): boolean {
  return type === "text" || type === "quote" || isList(type);
}

let seq = 0;
export function newId(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID();
  seq += 1;
  return `b${Date.now().toString(36)}${seq.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function block(type: BlockType = "text", text = "", extra: Partial<Omit<Block, "id" | "type" | "text">> = {}): Block {
  return { id: newId(), type, text, ...extra };
}

/** What Enter makes after a block of this type: a list goes on being a list,
 *  anything else hands back to plain text. */
export function nextType(type: BlockType): BlockType {
  return isList(type) ? type : "text";
}

/**
 * Markdown typed at the start of a plain block turns it into another kind,
 * the way both Notion and Obsidian read it. The prefix was the command, so it
 * goes. A divider (`---`) is the editor's to make, because it also needs a
 * fresh block after it.
 */
export function shortcut(text: string): { type: BlockType; text: string; checked?: boolean } | null {
  const rules: [RegExp, BlockType, boolean?][] = [
    [/^### /, "h3"],
    [/^## /, "h2"],
    [/^# /, "h1"],
    [/^[-*+] /, "bullet"],
    [/^1[.)] /, "numbered"],
    [/^\[ ?\] /, "todo"],
    [/^\[x\] /i, "todo", true],
    [/^> /, "quote"],
    [/^```/, "code"],
  ];
  for (const [re, type, checked] of rules) {
    const m = text.match(re);
    if (m) return { type, text: text.slice(m[0].length), ...(checked ? { checked: true } : {}) };
  }
  return null;
}

/** The number a numbered block shows: its place in the run of numbered blocks
 *  at its own indent. A nested child does not break the run; anything else at
 *  the same level, or the parent above it, starts a new one. */
export function listNumber(blocks: Block[], index: number): number {
  const indent = blocks[index].indent ?? 0;
  let n = 1;
  for (let i = index - 1; i >= 0; i--) {
    const p = blocks[i];
    const pi = p.indent ?? 0;
    if (pi > indent) continue;
    if (pi < indent || p.type !== "numbered") break;
    n++;
  }
  return n;
}

/** Move the block at `from` into the gap `gap` (0 = before the first block,
 *  length = after the last), counted in the list as it was. */
export function moveBlock(blocks: Block[], from: number, gap: number): Block[] {
  if (from < 0 || from >= blocks.length) return blocks;
  const to = gap > from ? gap - 1 : gap;
  if (to === from) return blocks;
  const next = blocks.slice();
  const [moved] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, moved);
  return next;
}

export function indentBlock(blocks: Block[], index: number, delta: number): Block[] {
  const b = blocks[index];
  if (!b || !canIndent(b.type)) return blocks;
  const indent = Math.max(0, Math.min(MAX_INDENT, (b.indent ?? 0) + delta));
  if (indent === (b.indent ?? 0)) return blocks;
  const next = blocks.slice();
  next[index] = { ...b, indent: indent || undefined };
  return next;
}

/**
 * Markdown pasted into a note, as blocks. Headings, lists (nested by their
 * leading spaces), to-dos, quotes, fenced code and rules come across as their
 * own kinds; consecutive lines of prose join into one paragraph, as Markdown
 * reads them — which is also what repairs text copied out of a PDF, where
 * every line ends in a hard break.
 */
export function parseMarkdown(md: string): Block[] {
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  const out: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) out.push(block("text", para.join(" ")));
    para = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (/^\s*```/.test(raw)) {
      flush();
      const body: string[] = [];
      for (i++; i < lines.length && !/^\s*```/.test(lines[i]); i++) body.push(lines[i]);
      out.push(block("code", body.join("\n")));
      continue;
    }
    const line = raw.trim();
    if (!line) {
      flush();
      continue;
    }
    const lead = (raw.match(/^\s*/)?.[0] ?? "").replace(/\t/g, "    ").length;
    const indent = Math.min(MAX_INDENT, Math.floor(lead / 2)) || undefined;
    let m: RegExpMatchArray | null;
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line)) {
      flush();
      out.push(block("divider"));
    } else if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      out.push(block(`h${Math.min(3, m[1].length)}` as BlockType, m[2]));
    } else if ((m = line.match(/^[-*+]\s+\[( |x|X)\]\s+(.*)$/))) {
      flush();
      out.push(block("todo", m[2], { indent, ...(m[1] !== " " ? { checked: true } : {}) }));
    } else if ((m = line.match(/^[-*+]\s+(.*)$/))) {
      flush();
      out.push(block("bullet", m[1], { indent }));
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      flush();
      out.push(block("numbered", m[1], { indent }));
    } else if ((m = line.match(/^>\s?(.*)$/))) {
      flush();
      const last = out[out.length - 1];
      if (last?.type === "quote" && /^\s*>/.test(lines[i - 1] ?? "")) last.text += `\n${m[1]}`;
      else out.push(block("quote", m[1]));
    } else {
      para.push(line);
    }
  }
  flush();
  return out.map((b) => (b.indent ? b : { ...b, indent: undefined }));
}

/** Every key the note cites, in order of first appearance — the order its
 *  references are listed in. A paper card cites its paper too. */
export function citedKeys(note: Pick<Note, "blocks">): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (key: string) => {
    if (!seen.has(key)) {
      seen.add(key);
      out.push(key);
    }
  };
  for (const b of note.blocks) {
    if (b.type === "paper" && b.cite) add(b.cite);
    else if (isTextual(b.type)) citedIn(b.text).forEach(add);
  }
  return out;
}

function citeReader(sources: Record<string, Source>) {
  return (key: string) => (sources[key] ? authorYear(sources[key]) : key);
}

/** The first words of the note's prose, for its card on the shelf. */
export function excerpt(note: Pick<Note, "blocks" | "sources">, max = 200): string {
  const read = citeReader(note.sources);
  const text = note.blocks
    .filter((b) => isTextual(b.type) && b.type !== "code" && !b.type.startsWith("h"))
    .map((b) => plainInline(b.text, read).trim())
    .filter(Boolean)
    .join(" ");
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

export function wordCount(note: Pick<Note, "blocks" | "sources">): number {
  const read = citeReader(note.sources);
  return note.blocks
    .filter((b) => isTextual(b.type))
    .map((b) => plainInline(b.text, read))
    .join(" ")
    .split(/\s+/)
    .filter(Boolean).length;
}

/** A note nobody has written in yet: no title, and nothing but empty text.
 *  "Write" reuses one rather than leaving a trail of blank notes behind. */
export function isUntouched(note: Pick<Note, "title" | "blocks">): boolean {
  return (
    !note.title.trim() &&
    note.blocks.every((b) => isTextual(b.type) && b.type === "text" && !b.text.trim() && !b.cite)
  );
}
