import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { DOCK_TOP_PX, DOCK_WIDTH_PX } from "@/components/reader/explain-dock";
import { block } from "@/lib/notes/blocks";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import type { Paper } from "@/types";
import { ensureReadingNoteLocal } from "./paper-notes";
import {
  EXPORT_ITEMS,
  NOTES_WINDOW_GAP_PX,
  NOTES_WINDOW_MIN_HEIGHT_PX,
  NotesWindowView,
  notesWindowBox,
} from "./notes-window";

// P10-09b (review 7.2, 7.3, 7.5; B12, B13, B15): "Open your notes" opens the paper's whole note as a floating
// window in the dock's column. The window cannot mount in this runtime (no DOM), so its geometry is a pure
// function, its markup is rendered, and its wiring is read from the source.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const paper: Paper = {
  id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw. A deeper layer keeps more soil water.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

describe("where the window stands", () => {
  it("is the dock's column: 360 wide, at the right edge, its top the dock's top while no explain window stands", () => {
    const box = notesWindowBox({ viewportHeight: 1000, explainBottom: null, legend: 32 });
    expect(DOCK_WIDTH_PX).toBe(360);
    expect(box.top).toBe(DOCK_TOP_PX);
    expect(box.maxHeight).toBe(1000 - DOCK_TOP_PX - 32 - NOTES_WINDOW_GAP_PX);
  });

  it("stands under the explain window when one stands, with a gap, and takes what is left above the legend", () => {
    const box = notesWindowBox({ viewportHeight: 1000, explainBottom: 500, legend: 32 });
    expect(box.top).toBe(500 + NOTES_WINDOW_GAP_PX);
    expect(box.maxHeight).toBe(1000 - box.top - 32 - NOTES_WINDOW_GAP_PX);
  });

  it("is lifted, never shrunk below a height you can write in, when the explain window is low", () => {
    const box = notesWindowBox({ viewportHeight: 1000, explainBottom: 960, legend: 32 });
    expect(box.maxHeight).toBe(NOTES_WINDOW_MIN_HEIGHT_PX);
    expect(box.top).toBe(1000 - 32 - NOTES_WINDOW_GAP_PX - NOTES_WINDOW_MIN_HEIGHT_PX);
  });

  it("never stands above the masthead", () => {
    expect(notesWindowBox({ viewportHeight: 300, explainBottom: null, legend: 32 }).top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
  });
});

describe("NotesWindowView", () => {
  const view = (props: Partial<Omit<Parameters<typeof NotesWindowView>[0], "children">> = {}) =>
    renderToStaticMarkup(
      createElement(NotesWindowView, { top: 48, maxHeight: 900, menuOpen: false, notice: null, onClose: () => {}, onMenu: () => {}, onExport: () => {}, children: createElement("p", null, "THE NOTE"), ...props }),
    );

  it("is fixed at the right edge, 360 wide, above the page, and scrolls inside itself", () => {
    const html = view();
    expect(html).toContain("fixed");
    expect(html).toContain("right-0");
    expect(html).toContain("w-[360px]");
    expect(html).toContain("top:48px");
    expect(html).toContain("max-height:900px");
    expect(html).toContain("overflow-y-auto");
    expect(html).toContain("THE NOTE");
    expect(html).toContain('aria-label="Your notes"');
  });

  it("has the header Your notes, a Close, and the export control", () => {
    const html = view();
    expect(html).toContain(">Your notes<");
    expect(html).toContain('aria-label="Close your notes"');
    expect(html).toContain(">Export");
    expect(html).not.toContain('role="menu"');
  });

  it("opens the export menu: copy, text, Markdown, Word, PDF (print) — in that order", () => {
    expect(EXPORT_ITEMS.map((i) => i.label)).toEqual(["Copy", "Text (.txt)", "Markdown (.md)", "Word (.doc)", "PDF (print)"]);
    const html = view({ menuOpen: true });
    let at = -1;
    for (const { label } of EXPORT_ITEMS) {
      const next = html.indexOf(`>${label.replace("(", "(")}<`);
      expect(next).toBeGreaterThan(at);
      at = next;
    }
  });

  it("says what the last export did", () => {
    expect(view({ notice: "Copied" })).toContain("Copied");
  });
});

describe("no limit, stays put (B15)", () => {
  const win = read("src/components/notes/notes-window.tsx");
  const editor = read("src/components/notes/note-editor.tsx");

  it("no character cap anywhere in the path", () => {
    for (const src of [win, editor, read("src/store/notes.ts"), read("src/lib/notes/export.ts")]) {
      expect(src).not.toMatch(/maxLength|maxlength/);
    }
    expect(win).not.toMatch(/\.slice\(0,\s*\d{2,}\)/);
  });

  it("holds 200 blocks of 100 characters in the store, whole", () => {
    useNotesStore.setState({ notes: {} });
    const note = ensureReadingNoteLocal({ own: undefined, paper, add: useNotesStore.getState().add });
    const blocks = Array.from({ length: 200 }, (_, i) => block("text", `${String(i).padStart(3, "0")} ${"y".repeat(96)}`));
    useNotesStore.getState().save(note.id, { blocks });
    const kept = useNotesStore.getState().notes[note.id];
    expect(kept.blocks).toHaveLength(200);
    expect(kept.blocks.reduce((n, b) => n + b.text.length, 0)).toBe(20_000);
  });

  it("the window is fixed and scrolls inside itself; the page's scroll does not move it", () => {
    expect(win).toContain("fixed");
    expect(win).toContain("overflow-y-auto");
    expect(win).not.toMatch(/scrollY|window\.scrollTo|addEventListener\("scroll"/);
  });
});

describe("one note, in the window and on the page (B14)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));

  it("the window opens the note readingNoteFor finds, which is the one the Saved page opens", () => {
    const made = ensureReadingNoteLocal({ own: undefined, paper, add: useNotesStore.getState().add });
    expect(readingNoteFor(useNotesStore.getState().notes, paper.id)?.id).toBe(made.id);
    const again = ensureReadingNoteLocal({ own: readingNoteFor(useNotesStore.getState().notes, paper.id), paper, add: useNotesStore.getState().add });
    expect(again.id).toBe(made.id);
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([made.id]);
  });

  it("the window reads it with readingNoteFor and edits it with the block editor", () => {
    const win = read("src/components/notes/notes-window.tsx");
    expect(win).toContain("readingNoteFor(");
    expect(win).toContain("<NoteEditor");
    expect(read("src/app/saved/page.tsx")).toContain("router.push(`/notes/${own.id}`)");
    expect(read("src/app/notes/[id]/page.tsx")).toContain("<NoteEditor");
  });
});

describe("export in the window", () => {
  const win = read("src/components/notes/notes-window.tsx");

  it("uses the five formats' own functions and the print path", () => {
    for (const fn of ["toPlainText(", "toMarkdown(", "toWordHtml(", "toPrintHtml(", "printHtml("]) expect(win).toContain(fn);
    expect(win).toContain("application/msword");
  });
});
