// The owner (2026-10-14): every reading note made before P10-09e's template is deleted when Peer opens. Such a note
// is tied to a paper (`paperId`) and opens with the old template's paper card (a `paper` block first); P10-09e's
// note opens with the title line (`h1`). A note the reader wrote that is tied to no paper stays, and so does a
// reading note in the new shape even when the reader added a paper block further down.
import { describe, expect, it } from "vitest";
import type { Block, Note } from "@/lib/notes/types";
import { isOldReadingNote, migrateNotes, NOTES_STORE_VERSION } from "./notes";

const at = "2026-10-01T00:00:00.000Z";
const b = (type: Block["type"], text = ""): Block => ({ id: `b-${type}-${text}`, type, text } as Block);
const note = (id: string, blocks: Block[], paperId?: string): Note => ({
  id,
  title: id,
  blocks,
  sources: {},
  ...(paperId ? { paperId } : {}),
  createdAt: at,
  updatedAt: at,
});

const oldReading = note("old", [b("paper"), b("quote", "Opening."), b("h2", "What it claims"), b("bullet", "mine")], "p1");
const newReading = note("new", [b("h1", "A title"), b("h3", "Note 1"), b("text", "words")], "p2");
const newWithCard = note("new-card", [b("h1", "A title"), b("paper"), b("text", "words")], "p3");
const ownNote = note("own", [b("paper"), b("text", "a draft that cites a paper")]);

describe("the old reading notes are deleted when Peer opens (the owner, 2026-10-14)", () => {
  it("knows an old reading note by its paper and its opening paper card", () => {
    expect(isOldReadingNote(oldReading)).toBe(true);
    expect(isOldReadingNote(newReading)).toBe(false);
    expect(isOldReadingNote(newWithCard)).toBe(false);
    expect(isOldReadingNote(ownNote)).toBe(false);
  });

  it("drops only the old reading notes from a store written under version 1", () => {
    const stored = { notes: { old: oldReading, new: newReading, "new-card": newWithCard, own: ownNote } };
    const migrated = migrateNotes(stored, 1) as { notes: Record<string, Note> };
    expect(Object.keys(migrated.notes).sort()).toEqual(["new", "new-card", "own"]);
    expect(migrated.notes.new).toEqual(newReading);
  });

  it("leaves a store already at the current version as it is", () => {
    const stored = { notes: { old: oldReading } };
    expect(migrateNotes(stored, NOTES_STORE_VERSION)).toEqual(stored);
  });

  it("is past version 1, so every browser's stored notes are migrated once", () => {
    expect(NOTES_STORE_VERSION).toBeGreaterThan(1);
  });

  it("survives a store with no notes or a malformed one", () => {
    expect(migrateNotes({}, 1)).toEqual({ notes: {} });
    expect(migrateNotes(undefined, 1)).toEqual({ notes: {} });
  });
});
