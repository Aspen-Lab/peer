import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { readingNote } from "@/lib/notes/templates";
import type { Note } from "@/lib/notes/types";
import type { Paper } from "@/types";
import { NOTES_LABEL, NotesButtonView, notesLabel } from "./notes-button";
import { ensureReadingNoteLocal, openPaperNotes } from "./paper-notes";

// P7-14 (R9, the owner's review): "Your notes" at the far right of the screen, as a button, not a band
// at the top of the column. A small tab fixed at the viewport's right edge (from `md`; on a phone a
// row in the command stack instead), labelled "Notes" — "Open your notes" once the paper has a note.
// The page cannot mount here (router, stores), so the view is tested as markup, `openPaperNotes` as a
// pure function with the router and the store stubbed, and the wiring in `paper-notes.test.ts`.

const paper: Paper = {
  id: "openalex:W1", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw. A deeper layer keeps more soil water.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

describe("the label", () => {
  it("is Notes until the paper has a note, then Open your notes", () => {
    expect(NOTES_LABEL).toEqual({ take: "Notes", open: "Open your notes" });
    expect(notesLabel(false)).toBe("Notes");
    expect(notesLabel(true)).toBe("Open your notes");
  });
});

describe("NotesButtonView — the tab at the right edge", () => {
  const edge = (has: boolean) => renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has, onOpen: () => {} }));

  it("is one button, fixed at the viewport's right edge, from md up and never on a phone", () => {
    const html = edge(false);

    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    // P7-15: `right-0` became the dock's width with a fallback of 0px — the same edge when no dock is open.
    for (const cls of ["fixed", "right-[var(--explain-dock-width,0px)]", "hidden", "md:flex"]) expect(html.split('"').some((attr) => attr.split(" ").includes(cls))).toBe(true);
  });

  it("stands beside the AI dock when one is open, not under it: its right edge is the dock's left edge", () => {
    const html = edge(false);

    // The dock is `z-[70]` and the tab `z-40`, so a tab left at `right: 0` would be hidden by it.
    // `--explain-dock-width` is set on the document's root while the dock is open (explain-dock.ts) and is
    // not set otherwise, when the fallback puts the tab on the window's edge as before.
    expect(html).toContain("right-[var(--explain-dock-width,0px)]");
    expect(html).not.toMatch(/\bright-0\b/);
    expect(html).toContain("z-40");
  });

  it("stands clear of the upper right 400px, where the AI dock will sit", () => {
    const html = edge(false);
    const top = /top-\[([^\]]+)\]/.exec(html)?.[1] ?? "";

    // At least 27rem (432px) from the top whatever the window's height, so a dock in the upper
    // right 400px is never under it.
    expect(top).toMatch(/max\(27rem,/);
    expect(html).not.toMatch(/\btop-0\b|\btop-\d\b/);
  });

  it("is as narrow as a line of type: in the vertical writing mode px pads the top and bottom, so the sides are py", () => {
    const classes = (/class="([^"]*)"/.exec(edge(false))?.[1] ?? "").split(" ");

    // 12px above and below the label, 4px at its sides: a tab about 25px wide, which does not reach into the
    // page's own 24px side margin at a tablet's width (the first version, px-1 py-3, was 41px wide).
    expect(classes).toContain("px-3");
    expect(classes).toContain("py-1");
    expect(classes).not.toContain("px-1");
    expect(classes).not.toContain("py-3");
  });

  it("says Notes, and Open your notes once there is a note; the label is vertical in the label face", () => {
    expect(edge(false)).toContain(">Notes<");
    expect(edge(true)).toContain(">Open your notes<");
    expect(edge(false)).not.toContain("Open your notes");
    expect(edge(false)).toContain("eyebrow");
    expect(edge(false)).toContain("[writing-mode:vertical-rl]");
  });

  it("says what a first press does: it makes the paper's note from its card", () => {
    expect(edge(false)).toMatch(/title="[^"]*note[^"]*"/i);
  });
});

describe("NotesButtonView — the row in the command stack, for a phone", () => {
  const row = (has: boolean) => renderToStaticMarkup(createElement(NotesButtonView, { variant: "row", has, onOpen: () => {} }));

  it("is a full-width command row, hidden from md up (the tab is there instead), a touch target", () => {
    const html = row(false);
    const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");

    expect(classes).toContain("w-full");
    expect(classes).toContain("md:hidden");
    expect(classes).not.toContain("fixed");
    expect(html).toContain("[@media(hover:none)]:min-h-11");
    expect(html).toContain("eyebrow");
  });

  it("has the same two labels", () => {
    expect(row(false)).toContain(">Notes<");
    expect(row(true)).toContain(">Open your notes<");
  });
});

describe("openPaperNotes — the same open() as the band had (P2-05)", () => {
  const stubs = (own?: Pick<Note, "id">) => {
    const added: Note[] = [];
    const pushed: string[] = [];
    return { added, pushed, args: { own, add: (note: Note) => added.push(note), push: (href: string) => pushed.push(href) } };
  };

  it("with a note already made, goes to it and makes nothing", () => {
    const { added, pushed, args } = stubs({ id: "n-1" });

    openPaperNotes({ ...args, paper, questions: ["Does it hold?"] });

    expect(added).toEqual([]);
    expect(pushed).toEqual(["/notes/n-1"]);
  });

  it("without one, makes the paper's note from its card, abstract and settled questions, then goes to it", () => {
    const { added, pushed, args } = stubs();

    openPaperNotes({ ...args, paper, questions: ["Does a deeper layer keep more water?"], forYourQuestions: [] });

    expect(added).toHaveLength(1);
    expect(added[0].paperId).toBe(paper.id);
    expect(added[0].title).toBe(paper.title);
    expect(JSON.stringify(added[0].blocks)).toContain("Does a deeper layer keep more water?");
    expect(pushed).toEqual([`/notes/${added[0].id}`]);
  });

  it("with no questions the note is the one the card alone makes", () => {
    const { added, args } = stubs();

    openPaperNotes({ ...args, paper });

    const plain = readingNote({ id: paper.id, title: paper.title, authors: paper.authors, abstract: paper.summaryIntro } as never);
    expect(added[0].blocks.map((b) => b.type)).toEqual(plain.blocks.map((b) => b.type));
  });
});

describe("the source (P7-14, R9)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("the band's open() is extracted, not rewritten: one readingNote call, in paper-notes.tsx", () => {
    const notes = read("src/components/notes/paper-notes.tsx");
    const button = read("src/components/notes/notes-button.tsx");

    expect(notes.split("readingNote(").length - 1).toBe(1);
    expect(button).not.toContain("readingNote(");
    expect(button).toContain("usePaperNotes");
  });
});

// P10-09b (review 7.2, 7.5; B12): the edge tab opens the paper's whole note as a floating window instead of
// navigating; the phone's row still navigates (the phone is deferred).
describe("P10-09b — the edge tab opens the window, the row still navigates", () => {
  const stubs = (own?: Pick<Note, "id">) => {
    const added: Note[] = [];
    const pushed: string[] = [];
    let opened = 0;
    return { added, pushed, opened: () => opened, args: { own, add: (note: Note) => added.push(note), push: (href: string) => pushed.push(href), openWindow: () => { opened += 1; } } };
  };

  it("with an openWindow, a note already made is opened in the window: nothing made, nothing navigated", () => {
    const { added, pushed, opened, args } = stubs({ id: "n-1" });
    openPaperNotes({ ...args, paper });
    expect(added).toEqual([]);
    expect(pushed).toEqual([]);
    expect(opened()).toBe(1);
  });

  it("with an openWindow and no note, makes the paper's note first and still does not navigate", () => {
    const { added, pushed, opened, args } = stubs();
    openPaperNotes({ ...args, paper, questions: ["Does a deeper layer keep more water?"] });
    expect(added).toHaveLength(1);
    expect(added[0].paperId).toBe(paper.id);
    expect(pushed).toEqual([]);
    expect(opened()).toBe(1);
  });

  it("ensureReadingNoteLocal returns the note it was given, or makes one from the same template", () => {
    const made: Note[] = [];
    const own = { id: "n-1" } as Note;
    expect(ensureReadingNoteLocal({ own, paper, add: (n) => made.push(n) })).toBe(own);
    expect(made).toEqual([]);
    const fresh = ensureReadingNoteLocal({ own: undefined, paper, add: (n) => made.push(n) });
    expect(made).toEqual([fresh]);
    expect(fresh.paperId).toBe(paper.id);
  });

  it("the tab's source mounts the window and the edge press toggles it; only the row navigates", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/notes-button.tsx"), "utf8");
    expect(src).toContain("<NotesWindow");
    expect(src).toMatch(/variant === "edge"/);
    expect(src).toContain("openWindow");
  });

  it("the open tab stands beside the window, not under it", () => {
    const html = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, shown: true, onOpen: () => {} }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("360px");
    const closed = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {} }));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("360px");
  });
});
