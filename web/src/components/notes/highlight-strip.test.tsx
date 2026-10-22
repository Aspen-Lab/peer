import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { readHighlight } from "@/lib/notes/blocks";
import { HIGHLIGHT_COLOURS } from "@/lib/notes/highlight-colours";
import { useNotesStore } from "@/store/notes";
import {
  HighlightStrip,
  HighlightStripView,
  HighlightSwatches,
  STRIP_MIN_WIDTH_PX,
  SWATCH_HIT_PX,
  nextSwatch,
  pickHighlightColour,
  removeStripHighlight,
  stripPlace,
  useHighlightStrip,
} from "./highlight-strip";

// P11-07 (owner item 8; B P11-04 §5; ruling §1h.112 D3): the colour strip — the six presets as a radio group (named, the current one
// ringed, a 24-px hit area each), a remove button, wrapping to two rows in a narrow margin — and the store that says which highlight
// it is for. What closes it is in highlight-strip.close.test.tsx. Every text is invented.

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the (hook-free) function components expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}
const radios = (tree: ReactNode) => elements(tree).filter((e) => e.props.role === "radio");
const sourceOf = (name: string) => readFileSync(resolve(__dirname, name), "utf8");

const PAPER_ID = "p1";
const PARAGRAPH = "paper-section-1-p2";
const TEXT = "See the tide pools at dawn. Later the tide pools were bare.";

beforeEach(() => {
  useNotesStore.setState({ notes: {} });
  useHighlightStrip.setState({ id: null, top: 0 });
});

describe("useHighlightStrip — which highlight, and how high", () => {
  it("starts with no strip, shows one at a height, replaces it, and hides it", () => {
    expect(useHighlightStrip.getState().id).toBeNull();
    useHighlightStrip.getState().show("h1", 240);
    expect(useHighlightStrip.getState()).toMatchObject({ id: "h1", top: 240 });
    useHighlightStrip.getState().show("h2", 310);
    expect(useHighlightStrip.getState()).toMatchObject({ id: "h2", top: 310 });
    useHighlightStrip.getState().hide();
    expect(useHighlightStrip.getState().id).toBeNull();
  });

  it("tells its readers only of a change: the same show, and a hide with none up, are silent", () => {
    const seen = vi.fn();
    const stop = useHighlightStrip.subscribe(seen);
    useHighlightStrip.getState().hide();
    expect(seen).not.toHaveBeenCalled();
    useHighlightStrip.getState().show("h1", 100);
    useHighlightStrip.getState().show("h1", 100);
    expect(seen).toHaveBeenCalledTimes(1);
    useHighlightStrip.getState().show("h1", 140); // the same highlight, the page scrolled: it moves
    expect(seen).toHaveBeenCalledTimes(2);
    useHighlightStrip.getState().hide();
    useHighlightStrip.getState().hide();
    expect(seen).toHaveBeenCalledTimes(3);
    stop();
  });
});

describe("HighlightSwatches — the six presets", () => {
  it("is a radio group of six named colours, in the table's order", () => {
    const html = renderToStaticMarkup(createElement(HighlightSwatches, { value: "yellow", onPick: () => {} }));
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(6);
    const names = [...html.matchAll(/aria-label="([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual(["Highlight colour", "Yellow", "Green", "Blue", "Pink", "Orange", "Ink"]);
    expect(HIGHLIGHT_COLOURS.map((one) => one.name)).toEqual(names.slice(1));
  });

  it("paints each button's square in its preset's fill", () => {
    const html = renderToStaticMarkup(createElement(HighlightSwatches, { value: "yellow", onPick: () => {} }));
    for (const one of HIGHLIGHT_COLOURS) expect(html).toContain(`background-color:${one.fill}`);
  });

  it("gives every colour a hit area of 24 px square", () => {
    expect(SWATCH_HIT_PX).toBe(24);
    const html = renderToStaticMarkup(createElement(HighlightSwatches, { value: "blue", onPick: () => {} }));
    expect(html.match(new RegExp(`width:${SWATCH_HIT_PX}px;height:${SWATCH_HIT_PX}px`, "g"))).toHaveLength(6);
  });

  it("checks and rings the current one only, and only that one is in the tab order", () => {
    for (const current of HIGHLIGHT_COLOURS) {
      const tree = createElement(HighlightSwatches, { value: current.id, onPick: () => {} });
      const buttons = radios(tree);
      const checked = buttons.filter((b) => b.props["aria-checked"] === true);
      expect(checked.map((b) => b.props["data-highlight-colour"])).toEqual([current.id]);
      expect(buttons.filter((b) => b.props.tabIndex === 0).map((b) => b.props["data-highlight-colour"])).toEqual([current.id]);
      expect(buttons.filter((b) => b.props["data-current"] === "").map((b) => b.props["data-highlight-colour"])).toEqual([current.id]);
      const html = renderToStaticMarkup(tree);
      expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
      expect(html.match(/outline-heading/g)).toHaveLength(1); // the ring
    }
  });

  it("picks the colour pressed", () => {
    const onPick = vi.fn();
    const buttons = radios(createElement(HighlightSwatches, { value: "yellow", onPick }));
    (buttons[3].props.onClick as () => void)();
    expect(onPick).toHaveBeenCalledWith("pink");
  });

  it("does not take the selection or the focus from the page when pressed", () => {
    const buttons = radios(createElement(HighlightSwatches, { value: "yellow", onPick: () => {} }));
    const preventDefault = vi.fn();
    (buttons[0].props.onMouseDown as (e: unknown) => void)({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();
  });

  it("moves the choice with the arrow keys, wrapping, as a radio group does, and ignores other keys", () => {
    expect(nextSwatch("yellow", "ArrowRight")).toBe("green");
    expect(nextSwatch("ink", "ArrowRight")).toBe("yellow");
    expect(nextSwatch("yellow", "ArrowLeft")).toBe("ink");
    expect(nextSwatch("blue", "ArrowDown")).toBe("pink");
    expect(nextSwatch("blue", "ArrowUp")).toBe("green");
    expect(nextSwatch("blue", "Home")).toBe("yellow");
    expect(nextSwatch("blue", "End")).toBe("ink");
    for (const key of ["Enter", " ", "Tab", "a", "Escape"]) expect(nextSwatch("blue", key)).toBeNull();

    const onPick = vi.fn();
    const focus = vi.fn();
    const preventDefault = vi.fn();
    const buttons = radios(createElement(HighlightSwatches, { value: "blue", onPick }));
    const event = (key: string) => ({ key, preventDefault, currentTarget: { parentElement: { querySelector: () => ({ focus }) } } });
    (buttons[2].props.onKeyDown as (e: unknown) => void)(event("ArrowRight"));
    expect(onPick).toHaveBeenCalledWith("pink");
    expect(focus).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    (buttons[2].props.onKeyDown as (e: unknown) => void)(event("Tab"));
    expect(onPick).toHaveBeenCalledTimes(1);
    expect(preventDefault).toHaveBeenCalledTimes(1);
  });
});

describe("stripPlace — where the strip stands", () => {
  it("is at the mark's top and the margin's left, as wide as the margin", () => {
    expect(stripPlace({ top: 300, left: 900, width: 260, viewportHeight: 800 })).toEqual({ left: 900, top: 300, maxWidth: 260 });
  });

  it("is never narrower than its six colours: the margin narrower than that does not squeeze them", () => {
    expect(STRIP_MIN_WIDTH_PX).toBeGreaterThanOrEqual(SWATCH_HIT_PX * 6);
    expect(stripPlace({ top: 300, left: 900, width: 100, viewportHeight: 800 }).maxWidth).toBe(STRIP_MIN_WIDTH_PX);
  });

  it("stays inside the window: a mark scrolled above it or below it leaves the strip at the edge", () => {
    const above = stripPlace({ top: -120, left: 900, width: 260, viewportHeight: 800 });
    const below = stripPlace({ top: 5000, left: 900, width: 260, viewportHeight: 800 });
    expect(above.top).toBeGreaterThanOrEqual(0);
    expect(above.top).toBeLessThanOrEqual(12);
    expect(below.top).toBeLessThan(800 - 2 * SWATCH_HIT_PX);
    expect(below.top).toBeGreaterThan(600);
  });
});

describe("HighlightStripView", () => {
  const place = { left: 900, top: 300, maxWidth: 260 };

  it("is a toolbar named Highlight: the six colours and a Remove button, fixed at its place, wrapping inside the margin's width", () => {
    const html = renderToStaticMarkup(createElement(HighlightStripView, { colour: "green", place, onPick: () => {}, onRemove: () => {}, blockId: "h1" }));
    expect(html).toContain('role="toolbar"');
    expect(html).toContain('aria-label="Highlight"');
    expect(html).toContain('data-highlight-id="h1"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toContain('aria-label="Remove highlight"');
    expect(html).toContain(">Remove<");
    expect(html).toMatch(/left:900px/);
    expect(html).toMatch(/top:300px/);
    expect(html).toMatch(/max-width:260px/);
    expect(html).toMatch(/width:max-content/);
    expect(html).toMatch(/class="[^"]*\bfixed\b/);
    expect(html).toMatch(/class="[^"]*\bflex-wrap\b/); // two rows when the margin is narrow, not an overflow
    expect(html).toMatch(/class="[^"]*\bz-\[70\]/); // over a stacked card, as the old pill was
  });

  it("checks the colour it was given", () => {
    const tree = createElement(HighlightStripView, { colour: "orange", place, onPick: () => {}, onRemove: () => {} });
    expect(radios(tree).filter((b) => b.props["aria-checked"] === true).map((b) => b.props["data-highlight-colour"])).toEqual(["orange"]);
  });

  it("removes on the button, and recolours on a swatch", () => {
    const onPick = vi.fn();
    const onRemove = vi.fn();
    const tree = createElement(HighlightStripView, { colour: "green", place, onPick, onRemove });
    const remove = elements(tree).find((e) => e.props["data-highlight-remove"] === "")!;
    (remove.props.onClick as () => void)();
    expect(onRemove).toHaveBeenCalledTimes(1);
    (radios(tree)[5].props.onClick as () => void)();
    expect(onPick).toHaveBeenCalledWith("ink");
  });
});

describe("HighlightStrip — connected to the paper's note", () => {
  const props = (noteId: string, blockId: string) => ({ noteId, blockId, top: 300, left: 900, width: 260 });
  function makeHighlight(colour: "yellow" | "blue" = "yellow") {
    const noteId = useNotesStore.getState().ensureReadingNote({ id: PAPER_ID, title: "A Paper", authors: ["Ann Lee"] });
    const made = useNotesStore.getState().addHighlight(noteId, { paperId: PAPER_ID, paragraphId: PARAGRAPH, passage: "the tide pools", paragraphText: TEXT, hint: 4, colour })!;
    return { noteId, blockId: made.id };
  }

  it("shows the highlight's own colour as the checked one", () => {
    const { noteId, blockId } = makeHighlight("blue");
    const html = renderToStaticMarkup(createElement(HighlightStrip, props(noteId, blockId)));
    expect(html).toContain('data-highlight-id="' + blockId + '"');
    expect(html).toMatch(/data-highlight-colour="blue"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-highlight-colour="blue"/);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(1);
  });

  it("draws nothing when the highlight is gone: removed, or never there", () => {
    const { noteId, blockId } = makeHighlight();
    useNotesStore.getState().removeHighlight(noteId, blockId);
    expect(renderToStaticMarkup(createElement(HighlightStrip, props(noteId, blockId)))).toBe("");
    expect(renderToStaticMarkup(createElement(HighlightStrip, props("missing", "missing")))).toBe("");
  });

  it("recolours the highlight in the note — the paper's mark and the notes row read it from there — and stays up", () => {
    const { noteId, blockId } = makeHighlight();
    useHighlightStrip.getState().show(blockId, 300);
    pickHighlightColour(noteId, blockId, "pink");
    expect(readHighlight(useNotesStore.getState().notes[noteId].blocks.find((b) => b.id === blockId))?.colour).toBe("pink");
    expect(useHighlightStrip.getState().id).toBe(blockId);
    // the strip drawn again shows the new choice
    expect(renderToStaticMarkup(createElement(HighlightStrip, props(noteId, blockId)))).toMatch(/data-highlight-colour="pink"[^>]*aria-checked="true"|aria-checked="true"[^>]*data-highlight-colour="pink"/);
  });

  it("removes the highlight from the note and puts the strip away", () => {
    const { noteId, blockId } = makeHighlight();
    useHighlightStrip.getState().show(blockId, 300);
    removeStripHighlight(noteId, blockId);
    expect(useNotesStore.getState().notes[noteId].blocks.some((b) => b.id === blockId)).toBe(false);
    expect(useHighlightStrip.getState().id).toBeNull();
  });
});

describe("the strip's source", () => {
  it("never closes on a timer, and sends nothing", () => {
    const src = sourceOf("./highlight-strip.tsx").replace(/\/\/.*$/gm, "");
    expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame/);
    expect(src).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|\/api\//);
  });
});
