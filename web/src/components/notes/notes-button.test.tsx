import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readingNote } from "@/lib/notes/templates";
import type { Note } from "@/lib/notes/types";
import type { Paper } from "@/types";
import { EDGE_TAB_DIVIDER_CLEAR_PX, NOTES_LABEL, NotesButtonView, TAKE_TITLE, notesLabel } from "./notes-button";
import { useNotesStore } from "@/store/notes";
import { openPaperNotes } from "./paper-notes";

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

  // Re-aimed (P12-77 rule 3, E2): was "is one button, fixed at the viewport's right edge, from md up and never on a phone" and held `hidden` and
  // `md:flex`. A phone's reader had only the row near the top of the page, so to open notes they scrolled up to it and "Back to paper" returned
  // them near the top (scrollY 8385 -> 85 at 390 x 844); the fixed tab keeps the place. The tab is now shown at every width (`flex`, no `hidden`),
  // and a phone's press goes to the notes page (`notes-button.phone.flow.test.tsx`).
  it("is one button, fixed at the viewport's right edge, at every width — a phone's too", () => {
    const html = edge(false);

    expect(html.match(/<button\b/g)).toHaveLength(1);
    expect(html).toContain('type="button"');
    // P11-14 (re-aimed, §1c): P7-15 had made `right-0` the dock's width with a fallback of 0px (`right-[var(--explain-dock-width,0px)]`);
    // nothing is reserved now, so with no card standing the tab is on the window's edge again.
    const classes = (/class="([^"]*)"/.exec(html)?.[1] ?? "").split(" ");
    for (const cls of ["fixed", "right-0", "flex"]) expect(classes).toContain(cls);
    for (const cls of ["hidden", "md:flex", "md:hidden"]) expect(classes).not.toContain(cls);
  });

  // P11-14 (re-aimed, §1c): was "stands beside the AI dock when one is open, not under it: its right edge is the dock's left edge"
  // (`right-[var(--explain-dock-width,0px)]`, a property the dock wrote on the document's root). The cards stand in the margin now: while
  // one stands (the explain card, a sticky, the notes window) the tab stands at the margin's left edge, from its rect; with no margin
  // registered, at the card's 360 px; with no card, on the window's edge.
  // Re-aimed again (P12-89, E5): the margin case held `left:1080px`, `translateX(-100%)` and `z-40` — the tab's face over the margin divider's 12 px hit strip, and under the
  // cards. It now stands just inside the margin (the rect's left plus `EDGE_TAB_DIVIDER_CLEAR_PX`, no translation) and over the cards' left edge (`z-[69]`). The case with no
  // margin registered (the card's 360 px from the right edge, no divider there) and the tab alone are as they were.
  it("stands beside the cards when one stands in the margin, right of the divider's strip: just inside the margin's left edge from its rect, else at the card's 360 px", () => {
    const beside = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: false, beside: true, marginLeft: 1080, onOpen: () => {} }));

    // The cards are `z-60` and over; a tab left at `right: 0` would be hidden by them, and one inside the margin has to be over them.
    expect(beside).toContain(`left:${1080 + EDGE_TAB_DIVIDER_CLEAR_PX}px`);
    expect(beside).not.toContain("translateX");
    expect(beside).not.toMatch(/\bright-0\b/);
    expect(beside).toContain("z-[69]");
    expect(beside).not.toContain("z-40");
    const noMargin = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: false, beside: true, onOpen: () => {} }));
    expect(noMargin).toContain("right-[min(360px,100vw)]");
    expect(noMargin).not.toContain("left:");
    const alone = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: false, marginLeft: 1080, onOpen: () => {} }));
    expect(alone).toMatch(/\bright-0\b/);
    expect(alone).not.toContain("left:");
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

// P10-09c (rule 1, re-aimed, §1c): `openPaperNotes` takes the store's `ensureReadingNote` (`ensure`) in place of `add`
// and makes nothing itself; the stubs read the real store, so the assertions on "what was made" read the store's notes.
describe("openPaperNotes — the same open() as the band had (P2-05)", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const stubs = (own?: Pick<Note, "id">) => {
    const pushed: string[] = [];
    const ensure = vi.fn(useNotesStore.getState().ensureReadingNote);
    return { ensure, pushed, made: () => Object.values(useNotesStore.getState().notes), args: { own, ensure, push: (href: string) => pushed.push(href) } };
  };

  it("with a note already made, goes to it and makes nothing", () => {
    const { ensure, made, pushed, args } = stubs({ id: "n-1" });

    openPaperNotes({ ...args, paper, questions: ["Does it hold?"] });

    expect(ensure).not.toHaveBeenCalled();
    expect(made()).toEqual([]);
    expect(pushed).toEqual(["/notes/n-1"]);
  });

  // Re-aimed (§1c, P10-09e rule 1): the note is the paper's title line; the settled questions are not copied into it.
  it("without one, makes the paper's note (its title line; the settled questions are not copied in), then goes to it", () => {
    const { made, pushed, args } = stubs();

    openPaperNotes({ ...args, paper, questions: ["Does a deeper layer keep more water?"], forYourQuestions: [] });

    const notes = made();
    expect(notes).toHaveLength(1);
    expect(notes[0].paperId).toBe(paper.id);
    expect(notes[0].title).toBe(paper.title);
    expect(notes[0].blocks.map((b) => [b.type, b.text])).toEqual([["h1", paper.title]]);
    expect(JSON.stringify(notes[0].blocks)).not.toContain("Does a deeper layer keep more water?");
    expect(pushed).toEqual([`/notes/${notes[0].id}`]);
  });

  it("with no questions the note is the one the card alone makes", () => {
    const { made, args } = stubs();

    openPaperNotes({ ...args, paper });

    const plain = readingNote({ id: paper.id, title: paper.title, authors: paper.authors, abstract: paper.summaryIntro } as never);
    expect(made()[0].blocks.map((b) => b.type)).toEqual(plain.blocks.map((b) => b.type));
  });
});

describe("the source (P7-14, R9)", () => {
  const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

  it("the band's open() is extracted, not rewritten: it asks the store's ensureReadingNote, in paper-notes.tsx", () => {
    const notes = read("src/components/notes/paper-notes.tsx");
    const button = read("src/components/notes/notes-button.tsx");

    // P10-09c (rule 1, re-aimed from "one readingNote call, in paper-notes.tsx", §1c): the template is made in the store,
    // by the one `ensureReadingNote`; neither file makes a note itself.
    expect(notes).not.toMatch(/\breadingNote\(/);
    expect(notes).not.toContain("ensureReadingNoteLocal");
    expect(notes).toContain("s.ensureReadingNote");
    expect(button).not.toContain("readingNote(");
    expect(button).toContain("usePaperNotes");
  });
});

// P10-09b (review 7.2, 7.5; B12): the edge tab opens the paper's whole note as a floating window instead of
// navigating; the phone's row still navigates (the phone is deferred).
describe("P10-09b — the edge tab opens the window, the row still navigates", () => {
  beforeEach(() => useNotesStore.setState({ notes: {} }));
  const stubs = (own?: Pick<Note, "id">) => {
    const pushed: string[] = [];
    let opened = 0;
    return {
      pushed,
      opened: () => opened,
      made: () => Object.values(useNotesStore.getState().notes),
      args: { own, ensure: useNotesStore.getState().ensureReadingNote, push: (href: string) => pushed.push(href), openWindow: () => { opened += 1; } },
    };
  };

  it("with an openWindow, a note already made is opened in the window: nothing made, nothing navigated", () => {
    const { made, pushed, opened, args } = stubs({ id: "n-1" });
    openPaperNotes({ ...args, paper });
    expect(made()).toEqual([]);
    expect(pushed).toEqual([]);
    expect(opened()).toBe(1);
  });

  it("with an openWindow and no note, makes the paper's note first and still does not navigate", () => {
    const { made, pushed, opened, args } = stubs();
    openPaperNotes({ ...args, paper, questions: ["Does a deeper layer keep more water?"] });
    expect(made()).toHaveLength(1);
    expect(made()[0].paperId).toBe(paper.id);
    expect(pushed).toEqual([]);
    expect(opened()).toBe(1);
  });

  // Re-aimed (§1c) from "ensureReadingNoteLocal returns the note it was given, or makes one from the same template":
  // the local copy is deleted; the store's `ensureReadingNote` answers, and pressing twice makes one note.
  it("pressing twice makes one note: the second finds the paper's note the first made", () => {
    const { made, args } = stubs();
    openPaperNotes({ ...args, paper });
    const [first] = made();
    openPaperNotes({ ...args, own: { id: first.id }, paper });
    expect(made()).toEqual([first]);
    const direct = useNotesStore.getState().ensureReadingNote({ id: paper.id, title: paper.title, authors: paper.authors, abstract: paper.summaryIntro } as never);
    expect(direct).toBe(first.id);
  });

  it("the tab's source mounts the window and the edge press toggles it; only the row navigates", () => {
    const src = readFileSync(resolve(process.cwd(), "src/components/notes/notes-button.tsx"), "utf8");
    expect(src).toContain("<NotesWindow");
    expect(src).toMatch(/variant === "edge"/);
    expect(src).toContain("openWindow");
  });

  it("the open tab stands beside the window, not under it", () => {
    // P11-14 (re-aimed): `NotesButton` passes `beside` while the window stands (its card is in the stack); the view no longer reads `shown` for the place.
    const html = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, shown: true, beside: true, onOpen: () => {} }));
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("360px");
    const closed = renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has: true, onOpen: () => {} }));
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).not.toContain("360px");
  });
});

// P10-23 rule 2 (C P10-21's unsettled 3, BACKLOG-86): the tab's tooltip said what the old note held (the card, the
// abstract's opening, four questions). The note is the paper's title and the reader's sticky notes.
describe("the tab's tooltip says what the note is now (P10-23)", () => {
  it("is exported and names the paper's title and the sticky notes, nothing of the old template", () => {
    expect(TAKE_TITLE).toBe("Take notes on this paper: its title, and your sticky notes.");
    expect(TAKE_TITLE).not.toMatch(/abstract|four questions|card/i);
  });

  it("is the title of the edge tab before the paper has a note, and of nothing after", () => {
    const edge = (has: boolean) => renderToStaticMarkup(createElement(NotesButtonView, { variant: "edge", has, onOpen: () => {} }));
    expect(edge(false)).toContain(`title="${TAKE_TITLE}"`);
    expect(edge(true)).not.toContain(TAKE_TITLE);
  });

  it("the comment at the top of the file says it too", () => {
    const source = readFileSync(resolve(process.cwd(), "src/components/notes/notes-button.tsx"), "utf8");
    const prose = source.replace(/^\s*\/\/ ?/gm, " ").replace(/\s+/g, " ");
    expect(prose).not.toContain("the opening of its abstract and the settled questions");
    expect(prose).toContain("the paper's title and your sticky notes");
  });
});
