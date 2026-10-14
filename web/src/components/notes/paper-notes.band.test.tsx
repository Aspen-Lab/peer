import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

// P10-30 rules 1 (BACKLOG-81, BACKLOG-88): the upload page's band says what "Take notes" makes now — the reading note is
// the paper's title and the reader's sticky notes (P10-09e) — in plain words, and a test pins the sentence the reader
// sees (rendered, not read from the source). And the P2-05 comment on `NotesInputs` describes the current note: the
// questions and the report's answers are handed in but the note does not hold them.

const store = vi.hoisted(() => ({ notes: {} as Record<string, unknown> }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));
vi.mock("@/store/notes", () => ({
  useNotesHydrated: () => true,
  useNotesStore: (select: (s: unknown) => unknown) => select({ notes: store.notes, ensureReadingNote: () => "n1" }),
  readingNoteFor: (notes: Record<string, { paperId?: string }>, paperId: string) =>
    Object.values(notes).find((n) => n.paperId === paperId),
  notesCiting: () => [],
}));

import { PaperNotes } from "./paper-notes";

const PAPER = { id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], year: 2026 } as unknown as Paper;
const source = readFileSync(resolve(process.cwd(), "src/components/notes/paper-notes.tsx"), "utf8");

describe("the upload page's band — the sentence the reader sees (BACKLOG-81)", () => {
  it("before any note: a Take notes button and one plain sentence — the note holds the paper's title and your sticky notes", () => {
    store.notes = {};
    const html = renderToStaticMarkup(<PaperNotes paper={PAPER} />);
    expect(html).toContain("Take notes");
    expect(html).toContain("The note holds the paper&#x27;s title and your sticky notes.");
    // Nothing of the old template.
    expect(html).not.toMatch(/abstract|four questions|its card/i);
  });

  it("once the paper has its note the button opens it and the sentence is gone", () => {
    store.notes = { n1: { id: "n1", title: "t", paperId: PAPER.id, blocks: [] } };
    const html = renderToStaticMarkup(<PaperNotes paper={PAPER} />);
    expect(html).toContain("Open your notes");
    expect(html).not.toContain("sticky notes.");
  });
});

describe("the P2-05 comment describes the current note (BACKLOG-88)", () => {
  const start = source.indexOf("/** P2-05:");
  const comment = source.slice(start, source.indexOf("*/", start));

  it("is there", () => {
    expect(start).toBeGreaterThan(-1);
  });

  it("no longer says the questions go into the paper's first note, or quotes the old note's heading", () => {
    expect(comment).not.toContain("go into the paper's first note");
    expect(comment).not.toContain("My questions →");
    expect(comment).not.toContain("what it said");
  });

  it("says the note is the title and the sticky notes, and that the questions and answers are handed in but not placed in it", () => {
    expect(comment).toMatch(/title and (the reader's|your) sticky notes/);
    expect(comment).toMatch(/not (placed|written|read|held)/);
  });
});
