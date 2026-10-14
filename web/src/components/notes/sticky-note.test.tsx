import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { block, stickyTitle } from "@/lib/notes/blocks";
import type { Block } from "@/lib/notes/types";
import { useWindows } from "@/lib/reader/windows";
import { useNotesStore } from "@/store/notes";
import { STICKY_SAVE_MS, StickyWindowView, makeStickyWriter, stickyRows, takeStickyNote } from "./sticky-note";

// P10-09a (review 7.1; rubric B7–B10; ruling §1h.78): "Take notes" opens a numbered sticky at the right, its
// header "Note N" with the passage's first words quoted and a Close (×), a text area focused at once; typing writes
// through (debounced, at most 300 ms) into the paper's note; Escape closes the focused sticky; closing keeps
// everything. Every text is invented.

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the (hook-free) function components expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}

const PAPER = { id: "p1", title: "A Paper", authors: ["Ann Lee"], publishedDate: "2024", abstract: "It tests mulch. It finds more water." };
const QUOTE = "The finest grains crept fastest when the specimens were annealed at the lowest temperature of the series.";

const view = (extra: Partial<Parameters<typeof StickyWindowView>[0]> = {}) => ({
  n: 2, quote: QUOTE, text: "my words", front: true, top: 180, height: 260, z: 62,
  onText: vi.fn(), onClose: vi.fn(), onRaise: vi.fn(), onGo: vi.fn(),
  ...extra,
});

describe("StickyWindowView", () => {
  it("shows Note N, the passage's first words in quotes (at most 80 characters) and a Close", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html).toContain("Note 2");
    expect(html).toContain("“The finest grains crept fastest");
    expect(html).not.toContain("lowest temperature of the series");
    expect(html).toMatch(/aria-label="Close note 2"/);
    expect(html).toContain("×");
  });

  it("is fixed at the right edge, 360 px wide, at its place in the stack", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html).toContain("fixed");
    expect(html).toContain("top:180px");
    expect(html).toContain("height:260px");
    expect(html).toContain("z-index:62");
    expect(html).toMatch(/right-0|right:0/);
    expect(html).toMatch(/w-\[min\(360px|width:min\(360px/);
  });

  it("has a text area focused at once, holding what was written, and the blue square before it", () => {
    const tree = elements(StickyWindowView(view()));
    const area = tree.find((el) => el.type === "textarea")!;
    expect(area.props.autoFocus).toBe(true);
    expect(area.props.value).toBe("my words");
    const onText = view().onText;
    const props = view({ onText });
    const area2 = elements(StickyWindowView(props)).find((el) => el.type === "textarea")!;
    (area2.props.onChange as (e: unknown) => void)({ target: { value: "more" }, currentTarget: { value: "more" } });
    expect(onText).toHaveBeenCalledWith("more");
    const html = renderToStaticMarkup(createElement(StickyWindowView, view()));
    expect(html.indexOf('aria-label="Go to the passage"')).toBeGreaterThan(-1);
    expect(html.indexOf('aria-label="Go to the passage"')).toBeLessThan(html.indexOf("<textarea"));
  });

  it("goes back to the passage from the square, closes from the ×, raises from the header", () => {
    const props = view();
    const buttons = elements(StickyWindowView(props)).filter((el) => el.type === "button");
    const byLabel = (needle: string) => buttons.find((b) => String(b.props["aria-label"] ?? "").includes(needle))!;
    (byLabel("Go to the passage").props.onClick as () => void)();
    expect(props.onGo).toHaveBeenCalled();
    const stop = vi.fn();
    (byLabel("Close note").props.onClick as (e: unknown) => void)({ stopPropagation: stop });
    expect(props.onClose).toHaveBeenCalled();
    const header = buttons.find((b) => b.props["data-sticky-header"] !== undefined)!;
    (header.props.onClick as () => void)();
    expect(props.onRaise).toHaveBeenCalled();
  });

  it("closes on Escape", () => {
    const props = view();
    const root = StickyWindowView(props) as ReactElement<Props>;
    (root.props.onKeyDown as (e: unknown) => void)({ key: "Escape", stopPropagation: () => {}, preventDefault: () => {} });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    (root.props.onKeyDown as (e: unknown) => void)({ key: "a", stopPropagation: () => {}, preventDefault: () => {} });
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it("shows only its header when it is behind another: no text area, no square", () => {
    const html = renderToStaticMarkup(createElement(StickyWindowView, view({ front: false, height: 40 })));
    expect(html).toContain("Note 2");
    expect(html).not.toContain("<textarea");
    expect(html).not.toContain("Go to the passage");
    expect(html).toContain("height:40px");
  });
});

describe("makeStickyWriter — writes through within 300 ms", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the last text once, no later than 300 ms after the last keystroke", () => {
    expect(STICKY_SAVE_MS).toBeLessThanOrEqual(300);
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.push("a");
    writer.push("ab");
    writer.push("abc");
    expect(write).not.toHaveBeenCalled();
    vi.advanceTimersByTime(300);
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("abc");
  });

  it("flushes at once on close, and writes nothing when nothing was typed", () => {
    const write = vi.fn();
    const writer = makeStickyWriter(write);
    writer.flush();
    expect(write).not.toHaveBeenCalled();
    writer.push("x");
    writer.flush();
    expect(write).toHaveBeenCalledWith("x");
    vi.advanceTimersByTime(1000);
    expect(write).toHaveBeenCalledTimes(1);
  });
});

describe("takeStickyNote", () => {
  beforeEach(() => {
    useNotesStore.setState({ notes: {} });
    useWindows.setState({ windows: [], clock: 0 });
  });

  const target = { sectionIndex: 1, paragraphIndex: 2, passage: QUOTE };

  it("makes the paper's note without navigating, adds Note 1 anchored to the paragraph and opens its window", () => {
    const made = takeStickyNote(target, PAPER);
    const notes = Object.values(useNotesStore.getState().notes);
    expect(notes).toHaveLength(1);
    const head = notes[0].blocks.find((b) => b.id === made?.id);
    expect(head).toMatchObject({ type: "h3", text: "Note 1" });
    expect(head?.anchor).toMatchObject({ paperId: "p1", paragraphId: "paper-section-1-p2", n: 1 });
    expect(useWindows.getState().windows).toMatchObject([{ id: made?.id, kind: "sticky", title: "Note 1" }]);
  });

  it("numbers the next ones 2 and 3 in the order made, and the windows stand in the stack", () => {
    takeStickyNote(target, PAPER);
    takeStickyNote({ ...target, paragraphIndex: 0 }, PAPER);
    const third = takeStickyNote({ ...target, paragraphIndex: 1 }, PAPER);
    const note = Object.values(useNotesStore.getState().notes)[0];
    expect(note.stickyCount).toBe(3);
    expect(third?.n).toBe(3);
    expect(useWindows.getState().windows.map((w) => w.title)).toEqual(["Note 1", "Note 2", "Note 3"]);
  });
});

describe("stickyRows", () => {
  const frame = { top: 100, bottom: 900, frontHeight: 260 };
  const heads: Block[] = [1, 2, 3].map((n) => block("h3", stickyTitle(n), { anchor: { paperId: "p1", paragraphId: `paper-section-0-p${n}`, quote: `quote ${n}`, n } }));
  const windows = heads.map((h, i) => ({ id: h.id, kind: "sticky" as const, title: h.text, order: i + 1 }));

  it("turns the open windows into rows with their number and quote, offset by a header each", () => {
    const rows = stickyRows(windows, heads, frame);
    expect(rows.map((r) => [r.n, r.quote, r.top])).toEqual([[1, "quote 1", 100], [2, "quote 2", 140], [3, "quote 3", 180]]);
    expect(rows.map((r) => r.front)).toEqual([false, false, true]);
  });

  it("drops a window whose note block is gone, and the other kinds", () => {
    const rows = stickyRows([...windows, { id: "gone", kind: "sticky", title: "x", order: 9 }, { id: "nn", kind: "notes", title: "n", order: 10 }], heads, frame);
    expect(rows).toHaveLength(3);
  });
});
