import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { block, highlightBlock, readHighlight } from "@/lib/notes/blocks";
import { HIGHLIGHT_COLOURS, highlightPaint } from "@/lib/notes/highlight-colours";
import type { Block, HighlightColourId, HighlightSpot } from "@/lib/notes/types";
import { BlockMenu } from "./note-editor";
import { PASSAGE_LOST_LINE, FLASH_MS, SQUARE_PX } from "./note-tags";
import {
  HighlightRow,
  HighlightRowView,
  WORDS_LINES,
  blockAccepts,
  goToHighlight,
  highlightGoal,
  highlightIsLost,
  withHighlightColour,
} from "./highlight-row";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => {} }) }));

// P11-08 (owner item 8; B P11-04 §2.4; rulings §1h.111 (d), §1h.112): the highlight's row in the notes — one component for the
// notes window and for /notes/<id>, both of which draw the paper's note with the one NoteEditor. Left to right: a 14-px square in
// the highlight's colour that goes to the passage and flashes it; the words on their colour, two lines at most; a colour button
// named by the colour's name that opens the six swatches; and a ×. A passage the paper no longer holds says so and has no square
// to go to it. The block menu offers Delete and nothing else; Duplicate, turn-into and the type menu leave a highlight alone.
// No DOM in this runtime: the markup is rendered, the handlers are read off the element tree, the editor's wiring from its source.
// Every text is invented.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the (hook-free) function components expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}
const byLabel = (tree: ReactNode, label: string) => elements(tree).filter((e) => e.props["aria-label"] === label);
const textOf = (node: ReactNode): string => elements(node).map((e) => (typeof e.props.children === "string" ? e.props.children : "")).join("");

const WORDS = "Seaweed mulch kept the terrace soil damp for nine more days.";
const SPOT: HighlightSpot = { paperId: "p1", paragraphId: "paper-section-1-p2", quote: WORDS, start: 4, end: 4 + WORDS.length, colour: "yellow" };
const light = (colour: HighlightColourId = "yellow", id = "h1"): Block => ({ ...highlightBlock({ ...SPOT, colour }), id });

const view = (over: Partial<Parameters<typeof HighlightRowView>[0]> = {}) =>
  createElement(HighlightRowView, {
    id: "h1",
    spot: { quote: WORDS, colour: "yellow" },
    lost: false,
    open: false,
    onGo: () => {},
    onToggle: () => {},
    onPick: () => {},
    onRemove: () => {},
    ...over,
  });

describe("HighlightRowView — the four parts, left to right", () => {
  it("is a 14-px square in the highlight's colour that goes to the passage, named for what it does", () => {
    const tree = view();
    const squares = byLabel(tree, "Go to the passage");
    expect(squares).toHaveLength(1);
    expect(squares[0].type).toBe("button");
    expect(SQUARE_PX).toBe(14);
    expect(squares[0].props.style).toMatchObject({ width: 14, height: 14, backgroundColor: "#ffe600" });
  });

  it("is the words on their colour, ink and fill from the colour table, the whole passage in the page", () => {
    const words = elements(view()).filter((e) => e.props["data-highlight-words"] === "");
    expect(words).toHaveLength(1);
    expect(words[0].props.style).toMatchObject({ backgroundColor: "#ffe600", color: "#000000" });
    expect(textOf(words[0])).toBe(WORDS);
  });

  it("cuts the words at two lines with an ellipsis, in the style and not in the text", () => {
    expect(WORDS_LINES).toBe(2);
    const long = Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ");
    const html = renderToStaticMarkup(view({ spot: { quote: long, colour: "blue" } }));
    expect(html).toMatch(/class="[^"]*\bline-clamp-2\b/);
    expect(html).toContain(long);
    expect(html).toContain(`title="${long}"`);
  });

  it("is a colour button named by the colour's name, closed, and a × that removes", () => {
    const tree = view({ spot: { quote: WORDS, colour: "orange" } });
    const colour = byLabel(tree, "Orange");
    expect(colour).toHaveLength(1);
    expect(colour[0].type).toBe("button");
    expect(colour[0].props["aria-expanded"]).toBe(false);
    expect(textOf(colour[0])).toContain("Orange");
    const remove = byLabel(tree, "Remove highlight");
    expect(remove).toHaveLength(1);
    expect(remove[0].type).toBe("button");
    expect(textOf(remove[0])).toBe("×");
  });

  it("puts them in the order square, words, colour, ×", () => {
    const html = renderToStaticMarkup(view());
    const at = (needle: string) => html.indexOf(needle);
    expect(at('aria-label="Go to the passage"')).toBeGreaterThan(-1);
    expect(at('aria-label="Go to the passage"')).toBeLessThan(at("data-highlight-words"));
    expect(at("data-highlight-words")).toBeLessThan(at('aria-label="Yellow"'));
    expect(at('aria-label="Yellow"')).toBeLessThan(at('aria-label="Remove highlight"'));
  });

  it("paints every preset's square, words and ink from the table, and names the button for it", () => {
    for (const { id, name, fill } of HIGHLIGHT_COLOURS) {
      const tree = view({ spot: { quote: WORDS, colour: id } });
      expect(byLabel(tree, "Go to the passage")[0].props.style).toMatchObject({ backgroundColor: fill });
      const words = elements(tree).find((e) => e.props["data-highlight-words"] === "")!;
      expect(words.props.style).toEqual({ backgroundColor: highlightPaint(id, 0).bg, color: highlightPaint(id, 0).ink });
      expect(byLabel(tree, name)).toHaveLength(1);
    }
    const ink = elements(view({ spot: { quote: WORDS, colour: "ink" } })).find((e) => e.props["data-highlight-words"] === "")!;
    expect(ink.props.style).toMatchObject({ color: "#ffffff" });
  });

  it("carries the block's id on its root, for the editor and for a test to find it", () => {
    expect(renderToStaticMarkup(view({ id: "block-77" }))).toContain('data-highlight-row="block-77"');
  });
});

describe("HighlightRowView — what each part does", () => {
  it("goes to the passage on the square, toggles the swatches on the colour button, removes on the ×", () => {
    const onGo = vi.fn();
    const onToggle = vi.fn();
    const onRemove = vi.fn();
    const tree = view({ onGo, onToggle, onRemove });
    (byLabel(tree, "Go to the passage")[0].props.onClick as () => void)();
    (byLabel(tree, "Yellow")[0].props.onClick as () => void)();
    (byLabel(tree, "Remove highlight")[0].props.onClick as () => void)();
    expect(onGo).toHaveBeenCalledTimes(1);
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it("keeps the selection and the focus where they were when the buttons are pressed (the page's words stay selected)", () => {
    const tree = view();
    for (const label of ["Go to the passage", "Yellow", "Remove highlight"]) {
      const preventDefault = vi.fn();
      (byLabel(tree, label)[0].props.onMouseDown as (e: unknown) => void)({ preventDefault });
      expect(preventDefault, label).toHaveBeenCalled();
    }
  });

  it("opens P11-07's swatches under the row: six named colours, the current one checked, a pick recolours", () => {
    expect(renderToStaticMarkup(view())).not.toContain('role="radiogroup"');
    const onPick = vi.fn();
    const tree = view({ open: true, onPick, spot: { quote: WORDS, colour: "green" } });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(6);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
    expect(byLabel(tree, "Green").find((e) => e.props.role === "radio")?.props["aria-checked"]).toBe(true);
    expect(byLabel(tree, "Green").find((e) => e.props.role !== "radio")?.props["aria-expanded"]).toBe(true);
    const pink = elements(tree).find((e) => e.props.role === "radio" && e.props["data-highlight-colour"] === "pink")!;
    (pink.props.onClick as () => void)();
    expect(onPick).toHaveBeenCalledWith("pink");
  });
});

describe("HighlightRowView — a passage the paper no longer holds", () => {
  it("says so in the quiet line, with no square to go to it, and keeps the words, the colour and the ×", () => {
    const tree = view({ lost: true });
    const html = renderToStaticMarkup(tree);
    expect(html).toContain(PASSAGE_LOST_LINE);
    expect(byLabel(tree, "Go to the passage")).toHaveLength(0);
    expect(html).not.toContain("Go to the passage");
    expect(html).toContain(WORDS);
    expect(byLabel(tree, "Yellow")).toHaveLength(1);
    expect(byLabel(tree, "Remove highlight")).toHaveLength(1);
  });

  it("holds the square's place with a quiet, inert one, so the rows keep their line", () => {
    const tree = view({ lost: true });
    const inert = elements(tree).filter((e) => e.type === "span" && e.props["aria-hidden"] === true && (e.props.style as { width?: number } | undefined)?.width === 14);
    expect(inert).toHaveLength(1);
    expect(inert[0].props.onClick).toBeUndefined();
  });

  it("draws no line for a passage the paper holds", () => {
    expect(renderToStaticMarkup(view())).not.toContain(PASSAGE_LOST_LINE);
  });
});

describe("HighlightRowView — a highlight that holds no readable words", () => {
  it("shows a quiet row with no square and no colour, and a × to take it out", () => {
    const tree = view({ spot: null });
    const html = renderToStaticMarkup(tree);
    expect(byLabel(tree, "Go to the passage")).toHaveLength(0);
    expect(html).not.toContain("data-highlight-words");
    expect(html).not.toContain("aria-expanded");
    expect(html).toContain("no words");
    expect(byLabel(tree, "Remove highlight")).toHaveLength(1);
  });

  it("is what the connected row draws for a block whose highlight is missing or malformed, and never throws", () => {
    const bare: Block = { ...block("text"), type: "highlight" };
    const broken = { ...light(), highlight: { paperId: 4, quote: null } as unknown as HighlightSpot };
    for (const b of [bare, broken]) {
      const html = renderToStaticMarkup(createElement(HighlightRow, { block: b, onColour: () => {}, onRemove: () => {} }));
      expect(html).toContain("no words");
      expect(html).toContain('aria-label="Remove highlight"');
    }
  });
});

describe("HighlightRow — the connected row", () => {
  it("draws the highlight stored in its block: its words, its colour, the square, closed", () => {
    const html = renderToStaticMarkup(createElement(HighlightRow, { block: light("pink", "h9"), onColour: () => {}, onRemove: () => {} }));
    expect(html).toContain('data-highlight-row="h9"');
    expect(html).toContain(WORDS);
    expect(html).toContain('aria-label="Go to the passage"');
    expect(html).toContain('aria-label="Pink"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain('role="radiogroup"');
    expect(html).not.toContain(PASSAGE_LOST_LINE);
  });

  it("reads a stored colour the table does not know as Yellow", () => {
    const odd = { ...light(), highlight: { ...SPOT, colour: "mauve" as HighlightColourId } };
    const html = renderToStaticMarkup(createElement(HighlightRow, { block: odd, onColour: () => {}, onRemove: () => {} }));
    expect(html).toContain('aria-label="Yellow"');
    expect(html).toContain("background-color:#ffe600");
  });
});

describe("goToHighlight — to the passage, flashing it", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  type Mark = { attrs: Record<string, string>; classes: Set<string>; classList: { add: (...c: string[]) => void; remove: (...c: string[]) => void } };
  const mark = (attrs: Record<string, string>): Mark => {
    const classes = new Set<string>();
    return { attrs, classes, classList: { add: (...c) => c.forEach((x) => classes.add(x)), remove: (...c) => c.forEach((x) => classes.delete(x)) } };
  };
  function paragraph(marks: Mark[], id = SPOT.paragraphId) {
    const classes = new Set<string>();
    const el = {
      scrollIntoView: vi.fn(),
      classList: { add: (...c: string[]) => c.forEach((x) => classes.add(x)), remove: (...c: string[]) => c.forEach((x) => classes.delete(x)) },
      querySelectorAll: (selector: string) => {
        const wanted = [...selector.matchAll(/mark\[(data-[a-z-]+)="([^"]*)"\]/g)].map((m) => ({ attr: m[1], value: m[2] }));
        return marks.filter((one) => wanted.some(({ attr, value }) => one.attrs[attr] === value));
      },
    };
    return { el, classes, doc: { getElementById: (want: string) => (want === id ? el : null) } as unknown as Document };
  }

  it("asks for the paper, the paragraph and the highlight's block id, and nothing of a sticky", () => {
    expect(highlightGoal("h1", SPOT)).toEqual({ paperId: "p1", paragraphId: "paper-section-1-p2", highlightId: "h1" });
  });

  it("scrolls the paragraph in and flashes this highlight's marks, not another's", () => {
    vi.useFakeTimers();
    const mine = mark({ "data-highlight": "h1" });
    const part = mark({ "data-highlight-part": "h1" });
    const other = mark({ "data-highlight": "h2" });
    const { el, classes, doc } = paragraph([mine, part, other]);
    goToHighlight("h1", SPOT, { doc, navigate: vi.fn() });
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: "start" }));
    expect(mine.classes.size).toBeGreaterThan(0);
    expect(part.classes.size).toBeGreaterThan(0);
    expect(other.classes.size).toBe(0);
    expect(classes.size).toBe(0);
    vi.advanceTimersByTime(FLASH_MS + 1);
    expect(mine.classes.size).toBe(0);
    expect(part.classes.size).toBe(0);
  });

  it("goes to the paper's page at the paragraph when it is not on this page (the notes page)", () => {
    const navigate = vi.fn();
    goToHighlight("h1", SPOT, { doc: { getElementById: () => null } as unknown as Document, navigate });
    expect(navigate).toHaveBeenCalledWith("/papers/p1#paper-section-1-p2");
  });
});

describe("highlightIsLost — whether the paper still holds the words", () => {
  const BODY = [{ paragraphs: ["x", "See the tide pools at dawn. Later the tide pools were bare."] }];
  const spot = (over: Partial<HighlightSpot>): HighlightSpot => ({ paperId: "p1", paragraphId: "paper-section-0-p1", quote: "tide pools", start: 8, end: 18, colour: "yellow", ...over });

  it("is false while the paragraph holds the words where the highlight says, and when no body is known", () => {
    expect(highlightIsLost("h1", spot({}), {}, BODY)).toBe(false);
    expect(highlightIsLost("h1", spot({ quote: "never in the paper" }), {}, null)).toBe(false);
  });

  it("is false when the words moved but are still in the paper (a repair finds them)", () => {
    expect(highlightIsLost("h1", spot({ paragraphId: "paper-section-0-p0", start: 0, end: 10 }), {}, BODY)).toBe(false);
  });

  it("is true when the body does not hold the words anywhere, and when the reading page has told the store so", () => {
    expect(highlightIsLost("h1", spot({ quote: "never in this paper" , end: 27 }), {}, BODY)).toBe(true);
    expect(highlightIsLost("h1", spot({}), { h1: true }, BODY)).toBe(true);
    expect(highlightIsLost("h1", spot({}), { h2: true }, BODY)).toBe(false);
  });
});

describe("withHighlightColour — the editor's copy, recoloured", () => {
  const a = block("text", "alpha");
  const b = block("text", "gamma");

  it("changes the named highlight's colour and nothing else: every other block is the very same object", () => {
    const blocks = [a, light("yellow", "h1"), b, light("blue", "h2")];
    const next = withHighlightColour(blocks, "h1", "green");
    expect(next).not.toBe(blocks);
    expect(readHighlight(next[1])?.colour).toBe("green");
    expect(next[1]).toEqual({ ...blocks[1], highlight: { ...SPOT, colour: "green" } });
    expect(next[0]).toBe(a);
    expect(next[2]).toBe(b);
    expect(next[3]).toBe(blocks[3]);
    expect(readHighlight(blocks[1])?.colour).toBe("yellow");
  });

  it("is the same array for a colour it already has, an unknown colour, a block that is not a highlight, and an id that is not there", () => {
    const blocks = [a, light("yellow", "h1")];
    expect(withHighlightColour(blocks, "h1", "yellow")).toBe(blocks);
    expect(withHighlightColour(blocks, "h1", "mauve" as HighlightColourId)).toBe(blocks);
    expect(withHighlightColour(blocks, a.id, "green")).toBe(blocks);
    expect(withHighlightColour(blocks, "nowhere", "green")).toBe(blocks);
  });

  it("writes down yellow for a highlight whose stored colour the table does not know", () => {
    const odd = { ...light(), highlight: { ...SPOT, colour: "mauve" as HighlightColourId } };
    expect(readHighlight(withHighlightColour([odd], "h1", "yellow")[0])?.colour).toBe("yellow");
    expect(withHighlightColour([odd], "h1", "yellow")[0].highlight?.colour).toBe("yellow");
  });

  it("leaves a block without a readable highlight alone", () => {
    const bare: Block = { ...block("text"), type: "highlight", id: "h1" };
    const blocks = [bare];
    expect(withHighlightColour(blocks, "h1", "green")).toBe(blocks);
  });
});

describe("the block menu — Delete only for a highlight", () => {
  const MENU_ACTIONS = ["up", "down", "duplicate", "text", "h1", "h2", "h3", "bullet", "numbered", "todo", "quote", "code", "divider", "paper"];

  it("accepts Delete and no other action for a highlight; every action for every other block", () => {
    expect(blockAccepts("highlight", "delete")).toBe(true);
    for (const action of MENU_ACTIONS) expect(blockAccepts("highlight", action), action).toBe(false);
    for (const type of ["text", "h1", "bullet", "quote", "code", "divider", "paper"] as const) {
      for (const action of [...MENU_ACTIONS, "delete"]) expect(blockAccepts(type, action), `${type}/${action}`).toBe(true);
    }
  });

  const menu = (b: Block) => renderToStaticMarkup(createElement(BlockMenu, { top: 0, block: b, onAction: () => {}, onClose: () => {} }));

  it("draws Delete alone for a highlight: no Move, no Duplicate, no Turn into", () => {
    const html = menu(light());
    expect(html).toContain(">Delete<");
    expect(html.match(/role="menuitem"/g)).toHaveLength(1);
    for (const gone of ["Duplicate", "Move up", "Move down", "Turn into", "Heading 1", "Bulleted list"]) expect(html, gone).not.toContain(gone);
  });

  it("still draws everything for a text block", () => {
    const html = menu(block("text", "words"));
    for (const there of ["Delete", "Duplicate", "Move up", "Move down", "Turn into", "Heading 1"]) expect(html, there).toContain(there);
  });
});

describe("the note editor draws it, for the window and for /notes/<id>", () => {
  const editor = read("src/components/notes/note-editor.tsx");
  const rowCode = editor.slice(editor.indexOf("const Row = memo("), editor.indexOf("// ── The editor"));

  it("draws a highlight block as a HighlightRow, beside the divider and the paper card", () => {
    expect(rowCode).toMatch(/b\.type === "divider"/);
    expect(rowCode).toMatch(/b\.type === "paper"/);
    expect(rowCode).toMatch(/b\.type === "highlight"\) \{[\s\S]*?content = \(?\s*<HighlightRow block=\{b\}/);
    expect(rowCode.indexOf('b.type === "paper"')).toBeLessThan(rowCode.indexOf('b.type === "highlight"'));
    expect(rowCode.indexOf('b.type === "highlight"')).toBeLessThan(rowCode.indexOf("editing && b.type === \"code\""));
  });

  it("recolours and removes through the editor's own copy of the note, and takes the block menu's actions through blockAccepts", () => {
    expect(editor).toMatch(/highlightColour: \(id, colour\) => \{[^}]*withHighlightColour\(docRef\.current\.blocks, id, colour\)/);
    expect(editor).toMatch(/highlightRemove: \(id\) => blockAction\(id, "delete"\)/);
    expect(editor).toMatch(/const blockAction = [^\n]*\n\s*setBlockMenu\(null\);[\s\S]*?if \(!blockAccepts\(b\.type, action\)\) return;/);
    expect(editor).toMatch(/blockAccepts\(b\.type, "duplicate"\)/);
  });

  it("is the one editor both the notes window and /notes/<id> draw the paper's note with", () => {
    expect(read("src/components/notes/notes-window.tsx")).toMatch(/<NoteEditor\b/);
    expect(read("src/app/notes/[id]/page.tsx")).toMatch(/<NoteEditor\b/);
  });
});
