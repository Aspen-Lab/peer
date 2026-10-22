import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readBlockText } from "@/lib/notes/anchor-blocks";
import { readHighlight } from "@/lib/notes/blocks";
import { contrast, highlightPaint } from "@/lib/notes/highlight-colours";
import { readingNoteFor, useNotesStore } from "@/store/notes";
import { TextDomNode, el, show, textNodesOf } from "@/test-support/fake-text-dom";
import { BLOCK_MARK_ATTRIBUTE, BlockMarks, domTextEnv, markClickOf, paintBlock, spotsForBlock, unpaintBlock, watchBlock, type MarkSpot, type PaintEnv } from "./block-marks";

// P11-28 (owner item 8; round 1 Theme B readers r1, r2; ruling §1h.123 (c)): the marks of a highlight on a Summary block or an answer. The page draws their
// words from many components, so the marks cannot be drawn by each of them: a painter reads the block's words (`anchor-blocks.ts`), finds each highlight's
// words in them (by the stored range while the block still holds them there, else by the quote), and wraps those words in `<mark data-highlight>` — the
// same element the paper's body draws, so the colour strip's host, the square's flash and a click on a mark find it unchanged. React owns the block's text
// nodes: the painter never moves one (a text node is split, and only the new pieces go into a mark), and it puts the words back as they were before every
// paint, so a re-render of the block never meets a node that is not where it left it. No DOM here: `test-support/fake-text-dom.ts`. Every text is invented.

const TEXT = "The deeper layers held more water, and the shallow ones less.";
const ID = "summary-proposal";
const env: PaintEnv = { createMark: () => new TextDomNode(1, "MARK") as never };
const spot = (id: string, quote: string, over: Partial<MarkSpot> = {}): MarkSpot => {
  const start = over.start ?? TEXT.indexOf(quote);
  return { id, paragraphId: ID, colour: "yellow", order: 0, start, end: start + quote.length, quote, ...over };
};
const block = (words = TEXT) => el("div", { id: ID }, words);
const marks = (root: TextDomNode) => root.querySelectorAll("mark");

beforeEach(() => useNotesStore.setState({ notes: {} }));

describe("paintBlock — the words wrapped in a mark", () => {
  it("wraps the highlight's words in `<mark data-highlight>`, in its colour with black words, and changes no word of the block", () => {
    const root = block();
    const out = paintBlock(root as never, [spot("h1", "held more water")], env);
    expect(show(root)).toBe("<div>The deeper layers <mark h=h1>held more water</mark>, and the shallow ones less.</div>");
    expect(root.textContent).toBe(TEXT);
    expect(out).toEqual({ drawn: ["h1"], fixes: [], text: TEXT });
    const [mark] = marks(root);
    expect(mark.attrs).toMatchObject({ "data-highlight": "h1", [BLOCK_MARK_ATTRIBUTE]: "" });
    expect(mark.styles).toEqual({ "background-color": "#ffe600", color: "#000000" });
  });

  it("wears the words black or white, whichever has the higher contrast on the fill, at 4.5 : 1 or more, for every preset", () => {
    for (const colour of ["yellow", "green", "blue", "pink", "orange", "ink"] as const) {
      const root = block();
      paintBlock(root as never, [spot("h1", "held more water", { colour })], env);
      const { "background-color": bg, color } = marks(root)[0].styles;
      expect({ colour, bg, color }).toEqual({ colour, bg: highlightPaint(colour, 0).bg, color: highlightPaint(colour, 0).ink });
      expect(["#000000", "#ffffff"]).toContain(color);
      expect(contrast(bg, color), colour).toBeGreaterThanOrEqual(4.5);
    }
    const dark = block();
    paintBlock(dark as never, [spot("h1", "held more water", { colour: "ink" })], env);
    expect(marks(dark)[0].styles.color).toBe("#ffffff");
  });

  it("runs across the elements inside the block: one mark in each text node the words are in, all the same highlight", () => {
    const root = el("div", { id: ID }, "Soil ", el("b", {}, "water rose"), " fast");
    paintBlock(root as never, [spot("h1", "Soil water rose", { start: 0, end: 15 })], env);
    expect(show(root)).toBe("<div><mark h=h1>Soil </mark><b><mark h=h1>water rose</mark></b> fast</div>");
    expect(root.textContent).toBe("Soil water rose fast");
  });

  it("marks two highlights that overlap as a mark inside a mark: the inner one in the deeper shade", () => {
    const root = block();
    paintBlock(root as never, [spot("A", "layers held more", { order: 0 }), spot("B", "more water", { colour: "blue", order: 1 })], env);
    expect(show(root)).toBe("<div>The deeper <mark h=A>layers held </mark><mark h=A><mark h=B>more</mark></mark><mark h=B> water</mark>, and the shallow ones less.</div>");
    const only = marks(root).find((m) => m.getAttribute("data-highlight") === "B" && m.parentNode === root)!;
    expect(only.styles["background-color"]).toBe(highlightPaint("blue", 0).bg);
    const nested = marks(root).find((m) => m.parentNode?.nodeName === "MARK" && m.getAttribute("data-highlight") === "B")!;
    expect(nested.styles).toEqual({ "background-color": highlightPaint("blue", 1).bg, color: highlightPaint("blue", 1).ink });
    expect(root.textContent).toBe(TEXT);
  });

  it("marks the same words once for each highlight, one inside the other, when two cover exactly the same", () => {
    const root = block();
    paintBlock(root as never, [spot("A", "held more water", { order: 0 }), spot("B", "held more water", { colour: "pink", order: 1 })], env);
    expect(show(root)).toBe("<div>The deeper layers <mark h=A><mark h=B>held more water</mark></mark>, and the shallow ones less.</div>");
  });

  it("never moves a text node React owns: the first piece of every split stays in its parent, in its place", () => {
    const root = block();
    const [node] = textNodesOf(root);
    paintBlock(root as never, [spot("h1", "held more water")], env);
    expect(node.parentNode).toBe(root);
    expect(root.childNodes[0]).toBe(node);
    expect(node.data).toBe("The deeper layers ");
  });

  it("paints again from the words as they were: a second paint (a new colour) leaves one mark, and no word doubled", () => {
    const root = block();
    paintBlock(root as never, [spot("h1", "held more water")], env);
    paintBlock(root as never, [spot("h1", "held more water", { colour: "green" })], env);
    expect(marks(root)).toHaveLength(1);
    expect(marks(root)[0].styles["background-color"]).toBe("#8fe388");
    expect(root.textContent).toBe(TEXT);
  });

  it("is undone whole by unpaintBlock: the block holds one text node again, with every word it had", () => {
    const root = block();
    const [node] = textNodesOf(root);
    paintBlock(root as never, [spot("h1", "held more water"), spot("h2", "shallow ones", { colour: "pink", order: 1 })], env);
    expect(marks(root)).toHaveLength(2);
    unpaintBlock(root as never);
    expect(marks(root)).toHaveLength(0);
    expect(textNodesOf(root)).toEqual([node]);
    expect(node.data).toBe(TEXT);
    unpaintBlock(root as never);
    expect(node.data).toBe(TEXT);
  });

  it("when React has written new words into the node meanwhile, the next paint drops the stale pieces and paints on the new words", () => {
    const root = block();
    const [node] = textNodesOf(root);
    paintBlock(root as never, [spot("h1", "held more water")], env);
    // a re-render sets the node's value (what React does to a text child whose string changed): the pieces the painter made are now stale
    node.data = "A fresh sentence that held more water today.";
    const out = paintBlock(root as never, [spot("h1", "held more water")], env);
    expect(root.textContent).toBe("A fresh sentence that held more water today.");
    expect(show(root)).toBe("<div>A fresh sentence that <mark h=h1>held more water</mark> today.</div>");
    expect(out.drawn).toEqual(["h1"]);
  });

  it("when React has taken the node away, the stale pieces go with the next paint", () => {
    const root = block();
    const [node] = textNodesOf(root);
    paintBlock(root as never, [spot("h1", "held more water")], env);
    root.removeChild(node);
    paintBlock(root as never, [], env);
    expect(root.childNodes).toEqual([]);
  });

  it("draws nothing for words the block no longer holds, and never other words in their place", () => {
    const root = block("Nothing alike is said here.");
    const before = TextDomNode.splits;
    const out = paintBlock(root as never, [spot("h1", "held more water", { start: 4, end: 19 })], env);
    expect(out).toEqual({ drawn: [], fixes: [], text: "Nothing alike is said here." });
    expect(show(root)).toBe("<div>Nothing alike is said here.</div>");
    expect(TextDomNode.splits).toBe(before);
  });

  it("finds the words again by the quote when the block has changed, and says where it found them, so the note can be repaired", () => {
    const root = block(`A new opening sentence. ${TEXT}`);
    const out = paintBlock(root as never, [spot("h1", "held more water")], env);
    expect(show(root)).toBe("<div>A new opening sentence. The deeper layers <mark h=h1>held more water</mark>, and the shallow ones less.</div>");
    expect(out.fixes).toEqual([{ id: "h1", was: { paragraphId: ID, start: 18, end: 33 }, paragraphId: ID, start: 42, end: 57 }]);
  });

  it("with no highlight to draw and none drawn, reads nothing and touches nothing", () => {
    const root = block();
    const isBlock = vi.fn(() => false);
    const before = TextDomNode.splits;
    expect(paintBlock(root as never, [], { ...env, isBlock })).toEqual({ drawn: [], fixes: [], text: null });
    expect(isBlock).not.toHaveBeenCalled();
    expect(TextDomNode.splits).toBe(before);
    expect(show(root)).toBe("<div>" + TEXT + "</div>");
  });

  it("takes the marks of a block that no longer has a highlight away, with no highlight to draw", () => {
    const root = block();
    paintBlock(root as never, [spot("h1", "held more water")], env);
    paintBlock(root as never, [], env);
    expect(marks(root)).toHaveLength(0);
    expect(root.textContent).toBe(TEXT);
  });
});

describe("spotsForBlock — the highlights the paper's note keeps for one block", () => {
  const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"] };
  const add = (paperId: string, paragraphId: string, passage: string, paragraphText = TEXT) => {
    const noteId = useNotesStore.getState().ensureReadingNote({ ...PAPER, id: paperId });
    return useNotesStore.getState().addHighlight(noteId, { paperId, paragraphId, passage, paragraphText })!;
  };

  it("are the paper's highlights with that block's id, in the order they were made, with their colour and range", () => {
    const first = add("p1", ID, "held more water");
    add("p1", "answers-block", "deeper layers");
    const second = add("p1", ID, "shallow ones");
    add("p2", ID, "more water");
    const spots = spotsForBlock(useNotesStore.getState().notes, "p1", ID);
    expect(spots.map((s) => [s.id, s.quote, s.colour, s.start, s.end])).toEqual([
      [first.id, "held more water", "yellow", 18, 33],
      [second.id, "shallow ones", "yellow", TEXT.indexOf("shallow ones"), TEXT.indexOf("shallow ones") + 12],
    ]);
    expect(spots.every((s) => s.paragraphId === ID)).toBe(true);
    expect(spots[0].order).toBeLessThan(spots[1].order);
    expect(spotsForBlock(useNotesStore.getState().notes, "p1", "answers-block")).toHaveLength(1);
    expect(spotsForBlock(useNotesStore.getState().notes, "p3", ID)).toEqual([]);
    expect(spotsForBlock({}, "p1", ID)).toEqual([]);
  });
});

describe("watchBlock — the marks follow the note and the block", () => {
  const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"] };
  const noteOf = () => readingNoteFor(useNotesStore.getState().notes, "p1")!;
  const highlightOf = (id: string) => readHighlight(noteOf().blocks.find((b) => b.id === id)!)!;
  const make = (passage: string, paragraphId = ID, paragraphText = TEXT) => {
    const noteId = useNotesStore.getState().ensureReadingNote(PAPER);
    return useNotesStore.getState().addHighlight(noteId, { paperId: "p1", paragraphId, passage, paragraphText })!;
  };
  // A watcher follows the one store: each test stops what it started, or the next test's note would be repaired for this test's block.
  const started: Array<() => void> = [];
  afterEach(() => {
    while (started.length > 0) started.pop()!();
  });
  function watched(root: TextDomNode) {
    let told: () => void = () => {};
    const stop = vi.fn();
    const forget = vi.fn();
    const stopWatching = watchBlock(root as never, { paperId: "p1", blockId: ID }, { ...env, observe: (_root, cb) => ((told = cb), { stop, forget }) });
    started.push(stopWatching);
    return { stopWatching, changed: () => told(), stop, forget };
  }

  it("draws the highlights the note already has when it starts", () => {
    make("held more water");
    const root = block();
    watched(root);
    expect(marks(root)).toHaveLength(1);
  });

  it("draws a highlight the moment it is added to the note, in the same turn (the colour strip is raised right after, and looks for the mark)", () => {
    const root = block();
    watched(root);
    expect(marks(root)).toHaveLength(0);
    const made = make("held more water");
    expect(marks(root).map((m) => m.getAttribute("data-highlight"))).toEqual([made.id]);
  });

  it("repaints when the colour is changed, from the strip or from the notes window, and takes the mark away when the highlight is removed", () => {
    const made = make("held more water");
    const root = block();
    watched(root);
    useNotesStore.getState().setHighlightColour(noteOf().id, made.id, "pink");
    expect(marks(root)[0].styles["background-color"]).toBe("#ff9ec7");
    useNotesStore.getState().removeHighlight(noteOf().id, made.id);
    expect(marks(root)).toHaveLength(0);
    expect(root.textContent).toBe(TEXT);
  });

  it("leaves alone a change of the note that is no change of this block's highlights (a word typed in the notes window)", () => {
    make("held more water");
    const root = block();
    watched(root);
    const before = TextDomNode.splits;
    useNotesStore.getState().save(noteOf().id, { title: "A new title" });
    expect(TextDomNode.splits).toBe(before);
    expect(marks(root)).toHaveLength(1);
  });

  it("draws a highlight of another block nowhere in this one", () => {
    make("held more water", "answers-block");
    const root = block();
    watched(root);
    expect(marks(root)).toHaveLength(0);
  });

  it("waits for the block: with the words not on the page, the highlight stays in the note, and the mark is drawn when the block is drawn with the same words", () => {
    const made = make("held more water");
    const root = block("Loading the summary…");
    const watching = watched(root);
    expect(marks(root)).toHaveLength(0);
    expect(noteOf().blocks.some((b) => b.id === made.id)).toBe(true);
    // the block is drawn (React writes the words in), the observer tells the painter
    textNodesOf(root)[0].data = TEXT;
    watching.changed();
    expect(marks(root)).toHaveLength(1);
    expect(show(root)).toBe("<div>The deeper layers <mark h=" + made.id + ">held more water</mark>, and the shallow ones less.</div>");
  });

  it("repaints from the words as they are when the block changes under it, and tells the observer to forget its own changes", () => {
    const made = make("held more water");
    const root = block();
    const watching = watched(root);
    watching.forget.mockClear();
    textNodesOf(root)[0].data = "Opening words. A fresh sentence that held more water today.";
    watching.changed();
    expect(root.textContent).toBe("Opening words. A fresh sentence that held more water today.");
    expect(marks(root).map((m) => m.textContent)).toEqual(["held more water"]);
    expect(watching.forget).toHaveBeenCalled();
    expect(highlightOf(made.id).quote).toBe("held more water");
  });

  it("leaves the marks as they are when the block changes and its words do not (the square's flash puts a class on a mark): drawing again would take away what it flashed", () => {
    make("held more water");
    const root = block();
    const watching = watched(root);
    const [mark] = marks(root);
    const before = TextDomNode.splits;
    mark.setAttribute("class", "outline outline-2 outline-accent");
    root.setAttribute("class", "bg-accent-dim");
    watching.changed();
    expect(marks(root)).toEqual([mark]);
    expect(mark.attrs.class).toBe("outline outline-2 outline-accent");
    expect(TextDomNode.splits).toBe(before);
  });

  it("draws again, whole, when React put a fresh node of the same words where its node was: the pieces the painter left would double the words", () => {
    make("held more water");
    const root = block();
    const watching = watched(root);
    const [original] = textNodesOf(root);
    root.removeChild(original);
    root.insertBefore(new TextDomNode(3, "#text", TEXT), root.childNodes[0]);
    expect(root.textContent.length).toBeGreaterThan(TEXT.length);
    watching.changed();
    expect(root.textContent).toBe(TEXT);
    expect(marks(root)).toHaveLength(1);
    expect(show(root)).toMatch(/^<div>The deeper layers <mark h=[^>]+>held more water<\/mark>, and the shallow ones less\.<\/div>$/);
  });

  it("repairs the note's range when it found the words elsewhere, so the next load needs no search", async () => {
    const made = make("held more water");
    const root = block(`A new opening sentence. ${TEXT}`);
    watched(root);
    await Promise.resolve();
    expect(highlightOf(made.id)).toMatchObject({ paragraphId: ID, start: 42, end: 57, quote: "held more water" });
  });

  it("watches the block only while it has a highlight to draw: no observer for a block with none, one from the first, taken off again with the last", () => {
    const observe = vi.fn(() => ({ stop: vi.fn(), forget: vi.fn() }));
    const root = block();
    started.push(watchBlock(root as never, { paperId: "p1", blockId: ID }, { ...env, observe }));
    expect(observe).not.toHaveBeenCalled();
    const made = make("held more water");
    expect(observe).toHaveBeenCalledTimes(1);
    const watch = observe.mock.results[0].value as { stop: ReturnType<typeof vi.fn> };
    make("shallow ones");
    expect(observe).toHaveBeenCalledTimes(1);
    useNotesStore.getState().removeHighlight(noteOf().id, made.id);
    expect(watch.stop).not.toHaveBeenCalled();
    for (const b of noteOf().blocks.filter((x) => x.type === "highlight")) useNotesStore.getState().removeHighlight(noteOf().id, b.id);
    expect(watch.stop).toHaveBeenCalledTimes(1);
    expect(marks(root)).toHaveLength(0);
  });

  it("stops: the marks are taken away, the observer is stopped, and the note's changes are no longer followed", () => {
    const made = make("held more water");
    const root = block();
    const watching = watched(root);
    watching.stopWatching();
    expect(marks(root)).toHaveLength(0);
    expect(root.textContent).toBe(TEXT);
    expect(watching.stop).toHaveBeenCalled();
    useNotesStore.getState().setHighlightColour(noteOf().id, made.id, "green");
    expect(marks(root)).toHaveLength(0);
  });
});

describe("markClickOf — a click on a drawn highlight", () => {
  const root = el("div", { id: ID }, "See ", el("mark", { "data-highlight": "outer", [BLOCK_MARK_ATTRIBUTE]: "" }, "the ", el("mark", { "data-highlight": "inner", [BLOCK_MARK_ATTRIBUTE]: "" }, "deeper layers")), " and ", el("mark", { "data-highlight": "linked", [BLOCK_MARK_ATTRIBUTE]: "" }, el("a", {}, "a link")), " and plain.");
  const outer = root.querySelector('mark[data-highlight="outer"]')!;
  const inner = root.querySelector('mark[data-highlight="inner"]')!;
  const link = root.querySelector("a")!;
  const collapsed = { isCollapsed: true };

  it("names the highlight whose mark was clicked: the innermost of two", () => {
    expect(markClickOf(outer.childNodes[0], collapsed)).toBe("outer");
    expect(markClickOf(inner.childNodes[0], collapsed)).toBe("inner");
    expect(markClickOf(inner, null)).toBe("inner");
  });

  it("is nothing for a click that is on no mark, on a link or a button inside a mark (it keeps its own click), or that ends a drag (a selection that is not collapsed)", () => {
    expect(markClickOf(root.childNodes[0], collapsed)).toBeNull();
    expect(markClickOf(link.childNodes[0], collapsed)).toBeNull();
    expect(markClickOf(inner, { isCollapsed: false })).toBeNull();
    expect(markClickOf(null, collapsed)).toBeNull();
    expect(markClickOf({}, collapsed)).toBeNull();
  });
});

describe("domTextEnv — the page's answers to the text model", () => {
  const styled = (styles: (node: TextDomNode) => Record<string, string>) => vi.stubGlobal("getComputedStyle", (node: TextDomNode) => ({ display: "inline", textTransform: "none", ...styles(node) }));
  afterEach(() => vi.unstubAllGlobals());

  it("has the model's defaults where there is no browser's style", () => {
    expect(domTextEnv()).toEqual({});
  });

  it("reads a text node as its style draws it: capitals, lower case, a capital to each word — and as it is for none", () => {
    const data = "How it's a-b.\nÉcole";
    const drawn = { uppercase: "HOW IT'S A-B.\nÉCOLE", lowercase: "how it's a-b.\nécole", capitalize: "How It's A-B.\nÉcole", none: data };
    for (const [transform, expected] of Object.entries(drawn)) {
      styled(() => ({ textTransform: transform }));
      const parent = el("span", {}, data);
      expect(domTextEnv().textOf!(parent.childNodes[0] as never), transform).toBe(expected);
    }
  });

  it("reads a block by the display its style gives: a line of its own unless inline, a hidden element and a formula as such", () => {
    styled((node) => (node.nodeName === "SPAN" ? { display: "inline" } : node.nodeName === "ASIDE" ? { display: "none" } : { display: "block" }));
    const root = el("div", {}, el("p", {}, "one"), el("span", {}, "two"), el("aside", {}, "gone"), el("p", { class: "katex" }, "x"), el("p", {}, "three"));
    const env = domTextEnv();
    expect(env.isBlock!(root.childNodes[0] as never)).toBe(true);
    expect(env.isBlock!(root.childNodes[1] as never)).toBe(false);
    expect(env.isHidden!(root.childNodes[2] as never)).toBe(true);
    expect(env.isHidden!(root.childNodes[0] as never)).toBe(false);
    expect(env.isFormula!(root.childNodes[3] as never)).toBe(true);
    expect(env.isFormula!(root.childNodes[4] as never)).toBe(false);
    expect(readBlockText(root as never, env).text).toBe("one two \u0000 three");
  });
});

describe("BlockMarks — the component a block mounts", () => {
  it("draws nothing: the block's markup is what it was", () => {
    expect(renderToStaticMarkup(createElement(BlockMarks, { id: ID }))).toBe("");
  });

  it("sends nothing anywhere: a highlight is a block of the note in this browser", () => {
    const src = readFileSync(resolve(__dirname, "./block-marks.ts"), "utf8").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|\/api\/|apiKey|canAsk|useProfile/i);
  });
});
