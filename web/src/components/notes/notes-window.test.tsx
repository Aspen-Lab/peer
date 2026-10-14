import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { DOCK_TOP_PX, DOCK_WIDTH_PX } from "@/components/reader/explain-dock";
import { block } from "@/lib/notes/blocks";
import { citableFromPaper } from "@/lib/notes/cite";
import { NOTES_MIN_FRONT_PX, stackLayout } from "@/lib/reader/windows";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import type { Paper } from "@/types";
import { EXPORT_ITEMS, NotesWindowView, mergeBlocks, reconcileWindow } from "./notes-window";

// P10-09b (review 7.2, 7.3, 7.5; B12, B13, B15): "Open your notes" opens the paper's whole note as a floating
// window in the dock's column. The window cannot mount in this runtime (no DOM), so its geometry is a pure
// function, its markup is rendered, and its wiring is read from the source.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const paper: Paper = {
  id: "openalex:W9", title: "Seaweed mulch and soil water", authors: [], relevanceReason: "", venue: "", source: "other",
  summaryIntro: "Seaweed mulch laid on terrace soil is tested against straw. A deeper layer keeps more soil water.",
  summaryExperimentKeywords: [], summaryResultDiscussion: "", isSaved: false,
};

// P10-09c (rule 2): the window's own box (`notesWindowBox`, P10-09b) is gone — it stands in the stack's column
// (`lib/reader/windows.ts`), where these four cases are answered by `stackLayout` (re-aimed, §1c; also in windows.test.ts).
describe("where the window stands — in the stack's column", () => {
  const notes = { id: "notes-window", kind: "notes" as const, title: "Your notes", order: 1 };
  const alone = (top: number, bottom: number) => stackLayout([notes], { top, bottom, frontHeight: 260, minTop: DOCK_TOP_PX })[0];

  it("is the dock's column: 360 wide, at the right edge, its top the dock's top while no explain window stands", () => {
    const row = alone(DOCK_TOP_PX, 1000 - 32 - 8);
    expect(DOCK_WIDTH_PX).toBe(360);
    expect(row.top).toBe(DOCK_TOP_PX);
    expect(row.height).toBe(1000 - DOCK_TOP_PX - 32 - 8);
  });

  it("stands under the explain window when one stands, with a gap, and takes what is left above the legend", () => {
    const row = alone(500 + 8, 960);
    expect(row.top).toBe(500 + 8);
    expect(row.height).toBe(960 - row.top);
  });

  it("is lifted, never shrunk below a height you can write in, when the explain window is low", () => {
    const row = alone(960 + 8, 960);
    expect(row.height).toBe(NOTES_MIN_FRONT_PX);
    expect(row.top).toBe(960 - NOTES_MIN_FRONT_PX);
  });

  it("never stands above the masthead", () => {
    expect(alone(DOCK_TOP_PX, 300 - 40).top).toBeGreaterThanOrEqual(DOCK_TOP_PX);
  });
});

describe("NotesWindowView", () => {
  const view = (props: Partial<Omit<Parameters<typeof NotesWindowView>[0], "children">> = {}) =>
    renderToStaticMarkup(
      createElement(NotesWindowView, { top: 48, maxHeight: 900, menuOpen: false, notice: null, onClose: () => {}, onMenu: () => {}, onExport: () => {}, ...props }, createElement("p", null, "THE NOTE")),
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

// P10-09c (rule 2): in the stack the window is a card — whole when in front, its header alone when behind another.
type ViewProps = Parameters<typeof NotesWindowView>[0];
type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
function walk(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [el, ...walk(el.props.children)];
}
const base: ViewProps = { top: 220, maxHeight: 700, menuOpen: false, notice: null, onClose: () => {}, onMenu: () => {}, onExport: () => {}, onRaise: () => {} };

describe("NotesWindowView — a card in the stack (P10-09c)", () => {
  const html = (props: Partial<ViewProps>) => renderToStaticMarkup(createElement(NotesWindowView, { ...base, ...props }, createElement("p", null, "THE NOTE")));

  it("stands at its place in the stack, under the explain window (z below 70) and over the masthead", () => {
    const out = html({ z: 63 });
    expect(out).toContain("top:220px");
    expect(out).toContain("z-index:63");
    expect(out).not.toContain("z-[70]");
  });

  it("in front it is whole; behind another it shows its header alone, a header tall, the note kept (hidden), no Export", () => {
    const front = html({ front: true });
    expect(front).toContain("max-height:700px");
    expect(front).toContain(">Export");
    expect(front).not.toContain(' hidden=""');
    const behind = html({ front: false, height: 40 });
    expect(behind).toContain("height:40px");
    expect(behind).toContain(">Your notes<");
    expect(behind).toContain('aria-label="Close your notes"');
    expect(behind).toContain("THE NOTE");
    expect(behind).toContain(' hidden=""');
    expect(behind).not.toContain(">Export");
  });

  it("a press on the header raises the window", () => {
    let raised = 0;
    const tree = NotesWindowView({ ...base, onRaise: () => { raised += 1; }, children: null });
    const header = walk(tree).find((el) => el.props["data-window-header"] !== undefined)!;
    (header.props.onClick as () => void)();
    expect(raised).toBe(1);
  });

  it("Escape closes the window, or only the open export menu first", () => {
    let closed = 0;
    let menu = 0;
    const key = { key: "Escape", stopPropagation: () => {}, preventDefault: () => {} };
    const closing = NotesWindowView({ ...base, onClose: () => { closed += 1; }, onMenu: () => { menu += 1; }, children: null }) as El;
    (closing.props.onKeyDown as (e: unknown) => void)(key);
    expect([closed, menu]).toEqual([1, 0]);
    (closing.props.onKeyDown as (e: unknown) => void)({ ...key, key: "a" });
    expect(closed).toBe(1);
    const withMenu = NotesWindowView({ ...base, menuOpen: true, onClose: () => { closed += 1; }, onMenu: () => { menu += 1; }, children: null }) as El;
    (withMenu.props.onKeyDown as (e: unknown) => void)(key);
    expect([closed, menu]).toEqual([1, 1]);
  });
});

describe("the window is in the stack of floating windows (P10-09c, rule 2)", () => {
  const win = read("src/components/notes/notes-window.tsx");

  it("registers as kind notes when it stands and leaves when it closes; places itself from the stack, not by its own box", () => {
    expect(win).toContain("NOTES_WINDOW_ID");
    expect(win).toMatch(/kind:\s*"notes"/);
    expect(win).toContain("useWindows");
    expect(win).toContain("stackRows(");
    expect(win).toContain("useColumn(");
    expect(win).not.toContain("notesWindowBox");
    expect(win).not.toContain("legendHeightPx");
  });
});

describe("mergeBlocks — the window's unsaved blocks and an outside change, together (P10-09c)", () => {
  const a = block("text", "alpha");
  const b = block("text", "beta");
  const c = block("text", "gamma");

  it("keeps what the window changed and what was changed outside, each in its own block", () => {
    const mine = [a, { ...b, text: "beta, edited in the window" }, c];
    const theirs = [{ ...a, text: "alpha, from the sticky" }, b, c];
    expect(mergeBlocks([a, b, c], mine, theirs).map((x) => x.text)).toEqual(["alpha, from the sticky", "beta, edited in the window", "gamma"]);
  });

  it("keeps a block added in the window after its neighbour, a block added outside, and drops what the window deleted", () => {
    const mine = [a, block("text", "window's new"), c];
    const out = block("text", "outside's new");
    const merged = mergeBlocks([a, b, c], mine, [a, b, c, out]);
    expect(merged.map((x) => x.text)).toEqual(["alpha", "window's new", "gamma", "outside's new"]);
  });

  it("where both changed the same block, the outside one stands (it was written last)", () => {
    const merged = mergeBlocks([a], [{ ...a, text: "mine" }], [{ ...a, text: "theirs" }]);
    expect(merged.map((x) => x.text)).toEqual(["theirs"]);
  });
});

describe("reconcileWindow — what the window does when the stored blocks change under its editor (P10-09c)", () => {
  const a = block("text", "alpha");
  const b = block("text", "beta");

  it("does nothing when its own save landed, or when the store did not really change", () => {
    expect(reconcileWindow([a], [a, b], [a, b]).kind).toBe("same");
    expect(reconcileWindow([a], [a, b], [a]).kind).toBe("keep");
  });

  it("starts the editor afresh on an outside change when it holds nothing unsaved", () => {
    const v = reconcileWindow([a], [a], [a, b]);
    expect(v).toEqual({ kind: "restart", blocks: [a, b] });
  });

  it("merges when it holds unsaved typing and the store changed too", () => {
    const mine = [{ ...a, text: "alpha!" }];
    const v = reconcileWindow([a], mine, [a, b]);
    expect(v.kind).toBe("merge");
    expect(v.kind === "merge" && v.blocks.map((x) => x.text)).toEqual(["alpha!", "beta"]);
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
    const id = useNotesStore.getState().ensureReadingNote(citableFromPaper(paper));
    const note = useNotesStore.getState().notes[id];
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
    // P10-09c (rule 1, re-aimed from `ensureReadingNoteLocal`, §1c): the store's one `ensureReadingNote`.
    const { ensureReadingNote } = useNotesStore.getState();
    const made = ensureReadingNote(citableFromPaper(paper));
    expect(readingNoteFor(useNotesStore.getState().notes, paper.id)?.id).toBe(made);
    expect(ensureReadingNote(citableFromPaper(paper))).toBe(made);
    expect(Object.keys(useNotesStore.getState().notes)).toEqual([made]);
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
