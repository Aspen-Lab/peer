import { beforeEach, describe, expect, it } from "vitest";
import { notesCiting, readingNoteFor, useNotesStore } from "./notes";
import { block } from "@/lib/notes/blocks";
import { sourceOf } from "@/lib/notes/cite";
import type { Note } from "@/lib/notes/types";

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024" };

function note(id: string, extra: Partial<Note> = {}): Note {
  return {
    id,
    title: id,
    blocks: [block("text")],
    sources: {},
    createdAt: "2026-09-18T00:00:00.000Z",
    updatedAt: "2026-09-18T00:00:00.000Z",
    ...extra,
  };
}

describe("notes store", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("adds, saves with a new stamp, and removes", () => {
    const { add, save, remove } = useNotesStore.getState();
    add(note("a"));
    save("a", { title: "Renamed" }, "2026-09-19T10:00:00.000Z");
    expect(useNotesStore.getState().notes.a).toMatchObject({
      title: "Renamed",
      updatedAt: "2026-09-19T10:00:00.000Z",
    });
    save("missing", { title: "x" });
    expect(Object.keys(useNotesStore.getState().notes)).toEqual(["a"]);
    remove("a");
    expect(useNotesStore.getState().notes).toEqual({});
  });

  it("finds a paper's backlinks by what is cited, not by what was once added", () => {
    const sources = { lee2024paper: sourceOf(PAPER, "lee2024paper") };
    const notes = {
      cites: note("cites", { sources, blocks: [block("text", "As [@lee2024paper] shows")] }),
      card: note("card", { sources, blocks: [block("paper", "", { cite: "lee2024paper" })] }),
      stale: note("stale", { sources, blocks: [block("text", "citation since deleted")] }),
    };
    expect(notesCiting(notes, "p1").map((n) => n.id).sort()).toEqual(["card", "cites"]);
  });

  it("finds a paper's own reading notes", () => {
    const notes = { mine: note("mine", { paperId: "p1" }), other: note("other") };
    expect(readingNoteFor(notes, "p1")?.id).toBe("mine");
    expect(readingNoteFor(notes, "p2")).toBeUndefined();
  });
});
