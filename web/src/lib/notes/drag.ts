// A paper carried from the rail into the draft.
//
// The editor already moves its own blocks with pointer events, which never
// leave the block list. This is the other gesture: a paper on the shelf,
// picked up in the rail and put down between two paragraphs. That crosses two
// components, so it is the browser's own drag-and-drop rather than ours, and
// what crosses is the `Citable` itself — the editor is then holding the whole
// record and never has to go back to the shelf for it.
//
// `text/plain` rides along so a paper dropped anywhere else — a mail window,
// a terminal, another app — arrives as its title instead of as JSON.

import type { Citable } from "./types";

/** Our own type, so a file or a selection dragged in is not mistaken for one
 *  of ours, and ours is not mistaken for text by the textareas. */
export const PAPER_DRAG = "application/x-peer-paper";

export function writePaperDrag(dt: DataTransfer, paper: Citable): void {
  dt.setData(PAPER_DRAG, JSON.stringify(paper));
  dt.setData("text/plain", paper.title);
  dt.effectAllowed = "copy";
}

/**
 * Whether this drag carries a paper — the only question that can be asked
 * during `dragover`, where the payload itself is withheld until the drop.
 */
export function carriesPaper(dt: DataTransfer | null | undefined): boolean {
  if (!dt) return false;
  return Array.from(dt.types).includes(PAPER_DRAG);
}

/**
 * The paper, on drop. Everything here came through the clipboard, so nothing
 * is trusted: a record without an id or a title cannot be cited and is no
 * paper, and anything that does not parse is simply not a drop we made.
 */
export function readPaperDrag(dt: DataTransfer | null | undefined): Citable | null {
  if (!dt) return null;
  let parsed: unknown;
  try {
    const raw = dt.getData(PAPER_DRAG);
    if (!raw) return null;
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.id !== "string" || !p.id) return null;
  if (typeof p.title !== "string" || !p.title) return null;
  const strings = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
  const text = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined);
  return {
    id: p.id,
    title: p.title,
    authors: strings(p.authors),
    venue: text(p.venue),
    publishedDate: text(p.publishedDate),
    doi: text(p.doi),
    url: text(p.url),
    abstract: text(p.abstract),
  };
}

/**
 * Which gap the pointer is in: the index a dropped block would take. Above
 * the middle of a row is the gap before it; below every row is the end.
 *
 * The same reading the block drag makes, so a paper from the rail lands where
 * the same line was drawn.
 */
export function gapAt(rows: readonly HTMLElement[], y: number): number {
  const at = rows.findIndex((el) => {
    const r = el.getBoundingClientRect();
    return y < r.top + r.height / 2;
  });
  return at === -1 ? rows.length : at;
}
