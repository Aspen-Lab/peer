import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("react", async (original) => {
  const react = await original<typeof import("react")>();
  const { stagedRuntime } = await import("@/test-support/staged-runtime");
  return { ...react, ...stagedRuntime.hooks,
    useSyncExternalStore: <T,>(_subscribe: unknown, read: () => T) => read() };
});
vi.mock("react-dom", async () => {
  const { createElement } = await import("react");
  return { createPortal: (children: unknown, target: unknown, key: string) => createElement("test-portal", { target, key }, children as ReactNode) };
});
vi.mock("@/store/reading-prefs", async (original) => {
  const actual = await original<typeof import("@/store/reading-prefs")>();
  const read = <T,>(select: (state: ReturnType<typeof actual.useReadingPrefsStore.getState>) => T) => select(actual.useReadingPrefsStore.getState());
  return { ...actual, useReadingPrefsStore: Object.assign(read, actual.useReadingPrefsStore) };
});

import { type ReactElement, type ReactNode } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { createReflowPage } from "@/test-support/reflow-page";
import { readReadingInteraction, restoreReadingInteraction, resolveTextPosition, textPosition } from "@/lib/reader/reading-position";
import { ReaderLayout } from "./reader-layout";
import { ReaderShell } from "./reader-shell";

type ElementTree = ReactElement<Record<string, unknown>>;
function elements(node: unknown): ElementTree[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as ElementTree;
  return [el, ...["children", "centre", "header"].flatMap((key) => elements(el.props[key]))];
}

// DOM-shaped text/input replacement and native-clamp ordering, driven by the
// actual ReaderLayout hook lifetime, rather than another ReaderShell-only test.
function open(index = 32) {
  const ids = Array.from({ length: 65 }, (_, i) => `paper-section-0-p${i}`);
  const page = createReflowPage({ paragraphs: ids.map((id) => ({ id, chars: 230 })), column: 646, head: 500 });
  type Block = { id: string; textContent: string; nodes: TextNode[]; contains(node: unknown): boolean; closest(selector: string): Block | null;
    getBoundingClientRect(): ReturnType<typeof page.column.getBoundingClientRect> };
  type TextNode = { nodeType: number; data: string; length: number; parentElement: Block; isConnected: boolean; block: Block };
  const blocks = new Map<string, Block>();
  const listeners = new Map<string, Set<() => void>>();
  const fire = (name: string) => listeners.get(name)?.forEach((run) => run());
  const add = (name: string, run: () => void) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(run); };
  const remove = (name: string, run: () => void) => listeners.get(name)?.delete(run);
  const prose = "Invented abcdefghijklmnopqrstuvwxyz. ".repeat(7).slice(0, 230);
  const replaceText = () => ids.forEach((id) => {
    blocks.get(id)?.nodes.forEach((node) => { node.isConnected = false; });
    const block: Block = { id, textContent: prose, nodes: [], contains: (node) => block.nodes.includes(node as TextNode), closest: (selector) => selector === "#paper-body [id]" ? block : null,
      getBoundingClientRect: () => ({ ...page.box(id), bottom: page.box(id).top + page.box(id).height, left: 0, width: page.columnPx }) };
    block.nodes = [prose.slice(0, 80), prose.slice(80)].map((data) => ({ nodeType: 3, data, length: data.length, parentElement: block, block, isConnected: true }));
    blocks.set(id, block);
  });
  replaceText();
  const canonical = (node: TextNode, offset: number) => node.block.nodes.slice(0, node.block.nodes.indexOf(node)).reduce((n, text) => n + text.length, offset);
  const glyph = (node: TextNode, offset: number) => ({ top: page.box(node.block.id).top + Math.floor(canonical(node, offset) / Math.floor(page.columnPx / 8.6)) * 29 + 4, height: 18 });
  const selected = { anchorNode: null as TextNode | null, focusNode: null as TextNode | null, anchorOffset: 0, focusOffset: 0,
    get isCollapsed() { return this.anchorNode === this.focusNode && this.anchorOffset === this.focusOffset; },
    setBaseAndExtent(anchor: TextNode, start: number, focus: TextNode, end: number) { Object.assign(this, { anchorNode: anchor, anchorOffset: start, focusNode: focus, focusOffset: end }); } };
  const body = {};
  let field = makeField();
  function makeField() {
    return { id: "reader-question", tagName: "TEXTAREA", value: "Invented unsent question", selectionStart: 7, selectionEnd: 18,
      selectionDirection: "backward" as const, focus: vi.fn(() => { doc.activeElement = field; }),
      setSelectionRange: vi.fn((start: number, end: number) => { field.selectionStart = start; field.selectionEnd = end; }) };
  }
  const doc = {
    ...page.doc, body, activeElement: body as object,
    getElementById: (id: string) => id === field.id ? field : blocks.get(id) ?? null,
    querySelectorAll: () => [...blocks.values()], getSelection: () => selected,
    createElement: () => ({ style: { setProperty() {}, display: "" }, parentElement: null, nextSibling: null, setAttribute() {}, removeAttribute() {} }),
    createTreeWalker(block: Block) { let at = 0; return { nextNode: () => block.nodes[at++] ?? null }; },
    createRange() {
      let block: Block | null = null, end: TextNode | null = null, finish = 0, start: TextNode | null = null, offset = 0;
      return { selectNodeContents(value: Block) { block = value; }, setEnd(node: TextNode, at: number) { end = node; finish = at; },
        setStart(node: TextNode, at: number) { start = node; offset = at; },
        toString: () => block && end ? block.textContent.slice(0, canonical(end, finish)) : "",
        getBoundingClientRect: () => start ? glyph(start, offset) : { top: 0, height: 0 } };
    },
    caretPositionFromPoint(x: number, y: number) {
      const block = [...blocks.values()].find((value) => { const box = page.box(value.id); return box.top <= y && box.top + box.height > y; });
      if (!block) return null;
      const at = Math.min(229, Math.max(0, Math.floor((y - page.box(block.id).top) / 29) * Math.floor(page.columnPx / 8.6) + Math.floor(x / 8.6)));
      return { offsetNode: block.nodes[at < 80 ? 0 : 1], offset: at < 80 ? at : at - 80 };
    },
    addEventListener: add, removeEventListener: remove,
  };
  const win = { ...page.win, get scrollY() { return page.scrollY; },
    addEventListener(name: string, run: () => void) { if (name === "scroll") page.win.addEventListener(name, run); else add(name, run); },
    removeEventListener(name: string, run: () => void) { if (name === "scroll") page.win.removeEventListener(name, run); else remove(name, run); } };
  vi.stubGlobal("document", doc); vi.stubGlobal("window", win); vi.stubGlobal("ResizeObserver", page.ResizeObserver);
  vi.stubGlobal("performance", { now: () => page.clock.now });
  let spread = true;
  const owner = { querySelector: (selector: string) => selector === "[data-reader-centre-inner]" ? (spread ? page.column : null) : page.column };
  const parents = new Map<string, object>();
  const targets: unknown[][] = [];
  const ancestry: Array<ElementTree | undefined> = [];
  const mounted = stagedRuntime.mount(() => ReaderLayout({ spread, plate: null, title: null, decision: null,
    common: "common", tabs: "tabs", tab: "digestion", words: "words", additions: "paper", next: "next" }), (tree) => {
    const all = elements(tree);
    for (const el of all) {
      if (el.props["data-reader-layout"] !== undefined) (el.props.ref as { current: unknown }).current = owner;
      if (el.props["data-reader-slot"] !== undefined) {
        const name = `${spread}:${el.props["data-reader-slot"]}`;
        if (!parents.has(name)) parents.set(name, { insertBefore(host: { parentElement: object; nextSibling: object }, marker: object) { host.parentElement = this; host.nextSibling = marker; } });
        (el.props.ref as (node: unknown) => void)({ parentElement: parents.get(name) });
      }
    }
    targets.push(all.filter((el) => el.type === "test-portal").map((el) => el.props.target));
    ancestry.push(all.find((el) => el.type === ReaderShell));
  });
  stagedRuntime.flush();
  const block = blocks.get(ids[index])!;
  const point = block.nodes[1];
  page.scroll(page.scrollY + glyph(point, 20).top - 56); page.frame();
  const starting = glyph(point, 20).top;
  const select = (backward: boolean) => {
    const first = blocks.get(ids[2])!.nodes[0], last = blocks.get(ids[3])!.nodes[1];
    selected.setBaseAndExtent(backward ? last : first, backward ? 27 : 4, backward ? first : last, backward ? 4 : 27);
    fire("selectionchange");
    return readReadingInteraction(doc as unknown as Document).selection;
  };
  return { page, doc, blocks, targets, ancestry, select, selected, get field() { return field; }, starting,
    current: () => glyph(blocks.get(ids[index])!.nodes[1], 20).top,
    focus() { doc.activeElement = field; fire("focusin"); },
    change(next: boolean, px: number, intervene?: () => void) {
      fire("resize"); spread = next;
      page.reflow(px, false); replaceText(); field = makeField(); doc.activeElement = body;
      selected.anchorNode = selected.focusNode = null;
      stagedRuntime.rerender(); stagedRuntime.flush(); intervene?.(); page.frame(); page.notify();
    },
    act: fire, stop: () => mounted.unmount(),
  };
}

afterEach(() => { vi.unstubAllGlobals(); });
describe("P12-15 ReaderLayout lifetime with reconstructed text and inputs", () => {
  it("keeps the shell/centre ancestor chain mounted in both modes so captured native Ranges never lose their ancestors", () => {
    const page = open(); page.change(false, 350); page.change(true, 646);
    expect(page.ancestry.map((el) => el?.type)).toEqual([ReaderShell, ReaderShell, ReaderShell]);
    page.stop();
  });
  it.each([2, 32, 59])("keeps the logical glyph at long anchor%i across side/one-column/side and releases observers", (index) => {
    const page = open(index);
    for (const [side, width] of [[false, 350], [true, 646]] as const) {
      page.change(side, width);
      expect(Math.abs(page.current() - page.starting)).toBeLessThanOrEqual(1);
    }
    expect(page.targets).toHaveLength(3);
    expect(page.targets[1]).toEqual(page.targets[0]); expect(page.targets[2]).toEqual(page.targets[0]);
    const calls = page.page.calls.length;
    page.page.notify(); page.page.notify(); expect(page.page.calls).toHaveLength(calls);
    page.stop(); expect(page.page.scrollListeners()).toBe(0); expect(page.page.observed()).toHaveLength(0);
  });
  it.each([false, true])("preserves cross-block selection endpoints and direction backward=%s", (backward) => {
    const page = open(); const saved = page.select(backward);
    page.change(false, 350);
    expect(readReadingInteraction(page.doc as unknown as Document).selection).toEqual(saved);
    page.change(true, 646);
    expect(readReadingInteraction(page.doc as unknown as Document).selection).toEqual(saved);
    page.stop();
  });
  it("restores only a replaced stable-ID question's focus/caret/draft", () => {
    const page = open(); page.focus(); const original = page.field;
    page.change(false, 350);
    expect(page.field).not.toBe(original); expect(page.doc.activeElement).toBe(page.field);
    expect(page.field.focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(page.field.setSelectionRange).toHaveBeenCalledWith(7, 18, "backward");
    expect(page.field.value).toBe(original.value); page.stop();
  });
  it("never refocuses or resets a stable editor that already has focus", () => {
    const page = open(); page.focus();
    const saved = readReadingInteraction(page.doc as unknown as Document);
    restoreReadingInteraction(saved, page.doc as unknown as Document);
    expect(page.field.focus).not.toHaveBeenCalled(); expect(page.field.setSelectionRange).not.toHaveBeenCalled(); page.stop();
  });
  it("a newer reader focus during settling wins over the saved question focus", () => {
    const page = open(); page.focus(); const other = { tagName: "BUTTON" };
    page.change(false, 350, () => { page.doc.activeElement = other; page.act("pointerdown"); page.act("focusin"); });
    expect(page.doc.activeElement).toBe(other); expect(page.field.focus).not.toHaveBeenCalled(); page.stop();
  });
  it("resolves an inline-node boundary and honestly rejects missing or changed text", () => {
    const page = open(); const block = page.blocks.get("paper-section-0-p32")!;
    const point = textPosition(block.nodes[1] as unknown as Node, 0, page.doc as unknown as Document)!;
    const resolved = resolveTextPosition(point, page.doc as unknown as Document);
    expect(resolved?.offset).toBe(0); expect(resolved?.node).toBe(block.nodes[1]);
    block.textContent += "changed"; expect(resolveTextPosition(point, page.doc as unknown as Document)).toBeNull();
    page.blocks.delete(block.id); expect(resolveTextPosition(point, page.doc as unknown as Document)).toBeNull(); page.stop();
  });
});
