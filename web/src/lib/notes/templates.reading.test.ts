import { describe, expect, it } from "vitest";
import { stickyBlocks } from "./blocks";
import { toMarkdown, toPlainText } from "./export";
import { blankNote, readingNote } from "./templates";
import type { Block, Citable } from "./types";

// P10-09e (rule 1; the owner's 7.3, walk B13 / B14): the note "Take notes" makes for a paper is its title line and,
// after it, the sticky notes and whatever the reader types. No abstract quote, no prompts, no empty sections, no
// "My questions → what it said". The template stays for a note made by hand (the notes page's blank note).

const PAPER: Citable = {
  id: "inv:1",
  title: "Seaweed Mulch on Terrace Soil",
  authors: ["Ann Lee", "Bo Chen"],
  venue: "Journal of Invented Soils",
  publishedDate: "2024-03-01",
  url: "https://example.org/seaweed",
  abstract: "Seaweed mulch keeps water in terrace soil. The effect holds on loam. It vanishes on clay.",
};
const NOW = "2026-10-14T00:00:00.000Z";
const ABSTRACT_WORDS = "Seaweed mulch keeps water";

const shape = (blocks: Block[]) => blocks.map((b) => ({ type: b.type, text: b.text }));

describe("the paper's reading note (P10-09e rule 1)", () => {
  it("is the title line and nothing else", () => {
    const note = readingNote(PAPER, NOW);
    expect(shape(note.blocks)).toEqual([{ type: "h1", text: PAPER.title }]);
    expect(note.paperId).toBe(PAPER.id);
    expect(note.title).toBe(PAPER.title);
  });

  it("carries no abstract, no prompt, no quote block, no empty section", () => {
    const note = readingNote(PAPER, NOW);
    expect(note.blocks.some((b) => b.type === "quote")).toBe(false);
    expect(note.blocks.some((b) => b.hint)).toBe(false);
    expect(note.blocks.some((b) => b.text.includes(ABSTRACT_WORDS))).toBe(false);
    const headings = note.blocks.filter((b) => b.type === "h2").map((b) => b.text);
    for (const old of ["What it claims", "How", "What I think", "Questions"]) expect(headings).not.toContain(old);
  });

  it("makes no 'My questions → what it said' section from the reader's questions", () => {
    const note = readingNote(PAPER, {
      now: NOW,
      questions: ["Does it hold on clay?"],
      forYourQuestions: [
        { question: "Does it hold on clay?", verdict: "answered", answers: [{ text: "x", evidence: "It vanishes on clay.", evidenceWhere: "3", sectionId: "s3", page: 2 }], readNext: [] },
      ],
    });
    expect(shape(note.blocks)).toEqual([{ type: "h1", text: PAPER.title }]);
  });

  it("keeps the paper under its citation key, with no reference line in the blocks", () => {
    const note = readingNote(PAPER, NOW);
    expect(note.sources.lee2024seaweed).toMatchObject({ paperId: PAPER.id, title: PAPER.title });
    expect(note.blocks.some((b) => b.type === "paper")).toBe(false);
  });

  it("takes the stickies after the title, in order, and exports the title and the stickies' words only", () => {
    const note = readingNote(PAPER, NOW);
    const one = stickyBlocks({ paperId: PAPER.id, paragraphId: "p1", quote: "A passage quoted from the paper.", n: 1 });
    const two = stickyBlocks({ paperId: PAPER.id, paragraphId: "p2", quote: "Another passage from the paper.", n: 2 });
    const blocks = [...note.blocks, ...one.blocks, { ...two.blocks[0] }, { ...two.blocks[1], text: "my words on two" }];
    const full = { ...note, blocks };
    expect(shape(blocks).map((b) => b.text)).toEqual([PAPER.title, "Note 1", "", "Note 2", "my words on two"]);
    for (const out of [toMarkdown(full), toPlainText(full)]) {
      expect(out).not.toContain(ABSTRACT_WORDS);
      expect(out).not.toContain("A passage quoted");
      expect(out).not.toContain("What it claims");
      expect(out).not.toContain("Questions");
    }
    // The title is said once in each export, not twice (the note's title and its title line are one title).
    expect(toPlainText(full).split(PAPER.title).length - 1).toBe(1);
    expect(toMarkdown(full).split(PAPER.title).length - 1).toBe(1);
  });

  it("leaves the notes page's blank note as it is", () => {
    const note = blankNote(NOW);
    expect(note.title).toBe("");
    expect(shape(note.blocks)).toEqual([{ type: "text", text: "" }]);
  });
});
