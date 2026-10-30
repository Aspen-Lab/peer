import { excerpt, readHighlight } from "@/lib/notes/blocks";
import type { Note } from "@/lib/notes/types";

/** A paper's saved passages, in the order the reader marked them. */
export function markedPassages(note: Pick<Note, "blocks">): string[] {
  return note.blocks.flatMap((block) => {
    const quote = readHighlight(block)?.quote.trim();
    return quote ? [quote] : [];
  });
}

/** Search the actual note and marked passages, even if the note has no typed text yet. */
export function noteSearchText(note: Note): string {
  return [note.title, excerpt(note, 400), ...markedPassages(note)].join(" ").toLowerCase();
}
