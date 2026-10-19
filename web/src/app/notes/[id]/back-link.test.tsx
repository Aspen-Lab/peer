import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NotesBackLink, NotesBackLinkView } from "./back-link";

// P11-06 (the owner's item 3, rule 1): the notes page's top-left button reads "Back to paper" and goes to the
// paper when the page was opened from one, and stays "Saved" (the Saved library) any other way. What the target
// is, is `backTarget`'s (return-to-paper.test.ts); this file is the button that shows it, and the one place the
// note editor's bar takes it from. The page cannot be mounted here, so the view is markup and the join is source.

describe("the button", () => {
  it('reads "Back to paper" and links to the paper when the note was opened from it', () => {
    const html = renderToStaticMarkup(createElement(NotesBackLinkView, { target: { label: "Back to paper", href: "/papers/openalex%3AW9", fromPaper: true } }));

    expect(html).toContain('href="/papers/openalex%3AW9"');
    expect(html).toContain("Back to paper");
    expect(html).not.toContain("Saved");
    expect(html).not.toContain('href="/saved"');
  });

  it('reads "Saved" and links to the Saved library otherwise, as it always did', () => {
    const html = renderToStaticMarkup(createElement(NotesBackLinkView, { target: { label: "Saved", href: "/saved", fromPaper: false } }));

    expect(html).toContain('href="/saved"');
    expect(html).toContain("← Saved");
    expect(html).not.toContain("Back to paper");
  });

  it("is the same small mono-label link in both, so only its words and its place change", () => {
    const a = renderToStaticMarkup(createElement(NotesBackLinkView, { target: { label: "Saved", href: "/saved", fromPaper: false } }));
    const b = renderToStaticMarkup(createElement(NotesBackLinkView, { target: { label: "Back to paper", href: "/papers/x", fromPaper: true } }));

    const cls = (html: string) => /class="([^"]*)"/.exec(html)?.[1];
    expect(cls(a)).toBeTruthy();
    expect(cls(a)).toBe(cls(b));
  });

  it("is drawn as Saved on the server and before the browser's tab storage has been asked", () => {
    const html = renderToStaticMarkup(createElement(NotesBackLink, { noteId: "note-1" }));

    expect(html).toContain("← Saved");
    expect(html).not.toContain("Back to paper");
  });
});

describe("where it stands", () => {
  it("is the note editor's bar link, in place of the fixed Saved link; nothing else of the bar changes", () => {
    const editor = readFileSync(resolve(__dirname, "../../../components/notes/note-editor.tsx"), "utf8");

    expect(editor).toMatch(/<NotesBackLink noteId=\{note\.id\} \/>/);
    expect(editor).not.toMatch(/<Link href="\/saved"[^>]*>\s*← Saved/);
    // The editor's other ways to Saved (deleting a note goes there) are untouched.
    expect(editor).toContain('router.push("/saved")');
  });

  it("leaves the page's own not-found state alone: it names no paper, so its way out stays Saved", () => {
    const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

    expect(page).toMatch(/<Link href="\/saved" className=\{COMMAND\}>\s*← Saved/);
  });
});
