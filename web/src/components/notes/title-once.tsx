"use client";

// P10-21 rule 1 (A P10-14 X-B3, BACKLOG-82; ruling §1h.93 (d)): the notes page said a reading note's title twice —
// its own title field, then the note's first block, the `h1` that P10-09e's template writes (the notes window shows
// that block as its title line, because the window has no title field). On the page the block is hidden when it is an
// `h1` equal to the note's title. Hidden, not removed: the editor still holds the block and saves it, so the window,
// the exports (which already say the title once) and the stored note are unchanged — only the page's drawing is.
//
// The hiding is one rule keyed on the block's id (`data-row` is the editor's row marker), so it follows the block
// if it is moved and needs no change in the editor. The block is chosen when the note is opened, not on every
// keystroke: renaming the note does not bring the old title back as a heading.

import { useState } from "react";
import type { ReactNode } from "react";
import type { Note } from "@/lib/notes/types";

/** The id of the note's first block when it is an `h1` that repeats the note's title (trimmed, case-folded); else null. */
export function titleBlockId(note: Pick<Note, "title" | "blocks">): string | null {
  const first = note.blocks[0];
  if (!first || first.type !== "h1") return null;
  const title = note.title.trim().toLowerCase();
  if (title === "" || first.text.trim().toLowerCase() !== title) return null;
  return /^[\w-]+$/.test(first.id) ? first.id : null;
}

export function TitleOnce({ note, children }: { note: Pick<Note, "title" | "blocks">; children?: ReactNode }) {
  const [hidden] = useState(() => titleBlockId(note));
  return (
    <>
      {hidden && <style>{`[data-row="${hidden}"]{display:none}`}</style>}
      {children}
    </>
  );
}
