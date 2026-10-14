import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P10-09a (review 7.1, 8.4; ruling §1h.78): the page's wiring of the selection buttons and the sticky notes.
// `Reader` cannot be mounted in this Node-only suite, so — like `page.explain.test.ts` — this reads the sources and
// holds each join to its shape, and runs the checker on mutated copies so it proves it would notice what it guards.

function wiringProblems(page: string, body: string, editor: string): string[] {
  const p = page.replace(/\s+/g, " ");
  const problems: string[] = [];
  const has = (text: string, needle: string, why: string) => {
    if (!text.includes(needle)) problems.push(why);
  };
  has(p, "<SelectionToolbar target={explainTarget} canExplain={selectionCanExplain({ canAsk: explainCanAsk, terms, passage: explainTarget?.passage ?? null })} onExplain={openExplain} onTakeNote={takeNote} />", "the selection buttons are not mounted with the selection, whether the page can explain it, the explain action and the take-note action");
  has(p, "<StickyNotes key={paper.id} paper={paper} reveal={reveal} />", "the sticky notes are not mounted for the paper with the tab reveal");
  has(p, "noteAnchors={noteAnchors}", "the body is not handed the paper's note anchors");
  has(p, "useTakeNote(", "the page has no take-note action");
  if (p.split("<SelectionToolbar").length - 1 !== 1) problems.push("the selection buttons are not mounted exactly once");
  const b = body.replace(/\s+/g, " ");
  has(b, "noteAnchors", "the paper body does not take noteAnchors");
  has(b, "<NoteTag", "the paper body draws no reference tag");
  const e = editor.replace(/\s+/g, " ");
  has(e, "b.type === \"h3\" && b.anchor", "the note editor does not draw the blue square on an anchored heading");
  has(e, "AnchorLink", "the note editor does not use the anchor link");
  return problems;
}

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const page = read("src/app/papers/[id]/page.tsx");
const body = read("src/components/reader/paper-body.tsx");
const editor = read("src/components/notes/note-editor.tsx");

describe("the page's wiring of the selection buttons and the sticky notes", () => {
  it("is right on the sources", () => {
    expect(wiringProblems(page, body, editor)).toEqual([]);
  });

  it("notices each join taken out", () => {
    const cases: [string, () => string[]][] = [
      ["toolbar", () => wiringProblems(page.replace("<SelectionToolbar", "<Nothing"), body, editor)],
      ["stickies", () => wiringProblems(page.replace("<StickyNotes", "<Nothing"), body, editor)],
      ["anchors", () => wiringProblems(page.replace("noteAnchors={noteAnchors}", ""), body, editor)],
      ["tag", () => wiringProblems(page, body.replaceAll("<NoteTag", "<Nothing"), editor)],
      ["square", () => wiringProblems(page, body, editor.replaceAll("AnchorLink", "Nothing"))],
    ];
    for (const [name, run] of cases) expect(run().length, name).toBeGreaterThan(0);
  });
});
