import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { block } from "@/lib/notes/blocks";
import { readingNote } from "@/lib/notes/templates";
import type { Citable, Note } from "@/lib/notes/types";
import { TitleOnce, titleBlockId } from "./title-once";

// P10-21 rule 1 (A P10-14 X-B3, BACKLOG-82; ruling §1h.93 (d)): `/notes/<id>` said the title twice — the page's own
// title field, then the note's first block, the `h1` P10-09e's template writes. The page hides that block when it is an
// `h1` equal to the title; the notes window (blocks alone) and the exports are untouched. No DOM in this runtime: the
// choice is a pure function, the hiding is a rule in the markup (a selector on the row's `data-row`), the wiring is read
// from the source.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const PAPER: Citable = { id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], year: 2026 } as unknown as Citable;
const note = (over: Partial<Note> = {}): Note => ({ ...readingNote(PAPER, "2026-10-14T00:00:00.000Z"), ...over });

describe("titleBlockId — which block repeats the title", () => {
  it("is the first block of a reading note: an h1 equal to the note's title", () => {
    const reading = note();
    expect(reading.blocks[0].type).toBe("h1");
    expect(titleBlockId(reading)).toBe(reading.blocks[0].id);
  });

  it("compares trimmed and case-folded, and is null otherwise", () => {
    const h1 = block("h1", "  Seaweed Mulch and soil water ");
    expect(titleBlockId({ title: "seaweed mulch and soil water", blocks: [h1, block("text", "x")] })).toBe(h1.id);
    expect(titleBlockId({ title: "Another title", blocks: [h1] })).toBeNull();
    expect(titleBlockId({ title: "Seaweed mulch and soil water", blocks: [block("h2", "Seaweed mulch and soil water")] })).toBeNull();
    expect(titleBlockId({ title: "Seaweed mulch and soil water", blocks: [block("text", "Seaweed mulch and soil water")] })).toBeNull();
    // Only the first block: an h1 further down is the reader's own heading.
    expect(titleBlockId({ title: "T", blocks: [block("text", "x"), block("h1", "T")] })).toBeNull();
  });

  it("is null for an empty title or an empty h1, and for a note with no block", () => {
    expect(titleBlockId({ title: "", blocks: [block("h1", "")] })).toBeNull();
    expect(titleBlockId({ title: "   ", blocks: [block("h1", " ")] })).toBeNull();
    expect(titleBlockId({ title: "T", blocks: [] })).toBeNull();
  });
});

describe("TitleOnce — the page hides the repeated block, only that one", () => {
  const html = (n: Note) => renderToStaticMarkup(createElement(TitleOnce, { note: n }, createElement("p", null, "THE EDITOR")));

  it("writes a rule that hides the title block's row, and renders the editor beside it", () => {
    const reading = note();
    const out = html(reading);
    expect(out).toContain("THE EDITOR");
    expect(out).toContain(`[data-row="${reading.blocks[0].id}"]{display:none}`);
  });

  it("writes no rule for a note whose first block is not its title", () => {
    expect(html(note({ title: "Renamed" }))).not.toContain("display:none");
    expect(html(note({ blocks: [block("text", "x")] }))).not.toContain("display:none");
  });

  it("keeps the choice made when the page opened: renaming the note does not bring the block back", () => {
    // The decision is read from the note once (per mounted note); the store's later copy of the title is not consulted.
    const source = read("src/components/notes/title-once.tsx");
    expect(source).toMatch(/useState\(\(\) => titleBlockId\(/);
  });
});

describe("the notes page", () => {
  const page = read("src/app/notes/[id]/page.tsx");

  it("hands the editor to TitleOnce, keyed by the note, and leaves the window's NoteEditor alone", () => {
    expect(page).toContain('import { TitleOnce } from "@/components/notes/title-once"');
    expect(page).toMatch(/<TitleOnce key=\{note\.id\} note=\{note\}>\s*<NoteEditor key=\{note\.id\} note=\{note\} \/>\s*<\/TitleOnce>/);
    expect(read("src/components/notes/notes-window.tsx")).not.toContain("TitleOnce");
  });
});
