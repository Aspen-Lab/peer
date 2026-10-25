import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), ...(await import("@/test-support/staged-runtime")).stagedRuntime.hooks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/store/notes", () => ({ useNotesStore: (select: (state: object) => unknown) => select({ notes: [], save: vi.fn() }), newestFirst: (x: unknown) => x }));
vi.mock("@/store/feed", () => ({ useFeedStore: (select: (state: object) => unknown) => select({ savedPapers: [], papers: [], library: [] }) }));
vi.mock("@/lib/notes/wysiwyg", async (original) => ({ ...await original<typeof import("@/lib/notes/wysiwyg")>(), getPlainSelection: (el: { selection: object }) => el.selection, plainLength: () => 16, setPlainSelection: (el: { selection: object }, from: number, to = from) => { el.selection = { from, to }; } }));
import type { ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { NoteEditor } from "./note-editor";
import { NoteToolbar, NoteToolbarView } from "./note-toolbar";
import { block } from "@/lib/notes/blocks";
import type { BlockType, Note } from "@/lib/notes/types";
import { Surface, type SurfaceApi } from "./wysiwyg-field";

type Props = Record<string, unknown>;
function nodes(tree: unknown): ReactElement<Props>[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return [];
  const el = tree as ReactElement<Props>;
  return [el, ...nodes(el.props.children)];
}
let active: unknown;
beforeEach(() => {
  vi.stubGlobal("HTMLTextAreaElement", class {});
  vi.stubGlobal("document", { body: {}, execCommand: () => false, get activeElement() { return active; } });
  vi.stubGlobal("window", { innerHeight: 900 });
});
afterEach(() => vi.unstubAllGlobals());

function mount(type: BlockType = "text") {
  const b = block(type, "alpha beta gamma");
  const note: Note = { id: "one", title: "n", blocks: [b], sources: {}, createdAt: "", updatedAt: "" };
  const surface = { contains: (node: unknown) => node === surface, value: b.text, selectionStart: 6, selectionEnd: 10, setSelectionRange: (from: number, to: number) => { surface.selectionStart = from; surface.selectionEnd = to; }, selection: { from: 6, to: 10 }, focus: vi.fn(() => { active = surface; }), getBoundingClientRect: () => ({ top: 100, bottom: 130 }) };
  if (type === "code") Object.setPrototypeOf(surface, HTMLTextAreaElement.prototype);
  const button = { focus: vi.fn(() => { active = button; }), closest: () => toolbar };
  const toolbar = { contains: (node: unknown) => node === button, querySelector: () => button };
  const column = { contains: (node: unknown) => node === button || node === surface, querySelector: (selector: string) => selector.includes("button") ? button : toolbar, querySelectorAll: () => [] };
  // The real editor's row API is exercised; only DOM layout/selection are stand-ins.
  const run = stagedRuntime.mount(() => NoteEditor({ note, compact: true, transient: true }), (tree) => {
    for (const el of nodes(tree)) {
      if (el.props.api) (el.props.api as { current: { register: (id: string, el: unknown) => void } }).current.register(b.id, surface);
      if (String(el.props.className).includes("aria-disabled=true") && el.props.ref) (el.props.ref as { current: unknown }).current = column;
    }
  });
  const row = () => nodes(run.value).find(el => el.props.api)!.props;
  const api = () => (row().api as { current: { key: (e: unknown, id: string) => void; edit: (id: string, caret: object) => void; blur: (id: string, target?: unknown) => void } }).current;
  const event = (key: string, extra = {}) => ({ key, currentTarget: surface, nativeEvent: {}, shiftKey: false, altKey: false, ctrlKey: false, metaKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn(), ...extra });
  stagedRuntime.event(() => api().edit(b.id, { plain: 6, to: 10 }));
  return { run, surface, button, toolbar, column, api, event, id: b.id, row, columnProps: () => nodes(run.value).find(el => el.props.onBlurCapture)!.props, toolbarProps: () => nodes(run.value).find(el => el.type === NoteToolbar)!.props };
}

for (const type of ["text", "h2", "quote"] as const) for (const shiftKey of [false, true]) {
  it(`${type} ${shiftKey ? "Shift+Tab" : "Tab"} preserves inherited indentation or native heading exit`, () => {
    const h = mount(type); const event = h.event("Tab", { shiftKey });
    stagedRuntime.event(() => h.api().key(event, h.id));
    if (type === "h2") expect(event.preventDefault).not.toHaveBeenCalled();
    else {
      expect(event.preventDefault).toHaveBeenCalledOnce();
      expect((h.row().block as { indent?: number }).indent ?? 0).toBe(shiftKey ? 0 : 1);
    }
    expect((h.row().block as { text: string }).text).toBe("alpha beta gamma"); h.run.unmount();
  });
}
it("Alt+F10 reaches Format and retains the selected block until focus exits", () => {
  const h = mount(); const event = h.event("F10", { altKey: true });
  stagedRuntime.event(() => h.api().key(event, h.id));
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(h.button.focus).toHaveBeenCalledOnce();
  stagedRuntime.event(() => h.api().blur(h.id, h.button));
  expect(h.toolbarProps().enabled).toBe(true);
  h.surface.selection = null as unknown as typeof h.surface.selection;
  stagedRuntime.event(() => (h.toolbarProps().onMark as (m: string) => void)("strong"));
  expect((h.row().block as { text: string }).text).toBe("alpha **beta** gamma");
  expect(active).toBe(h.surface); h.run.unmount();
});
for (const type of ["bullet", "numbered", "todo"] as const) {
  it(`${type} retains bounded Tab nesting and Alt+F10 leaves words untouched`, () => {
    const h = mount(type);
    for (let i = 0; i < 20; i++) stagedRuntime.event(() => h.api().key(h.event("Tab"), h.id));
    const indent = (h.row().block as { indent: number }).indent;
    expect(indent).toBeGreaterThan(0); expect(indent).toBeLessThan(20);
    stagedRuntime.event(() => h.api().key(h.event("Tab", { shiftKey: true }), h.id));
    expect((h.row().block as { indent: number }).indent).toBe(indent - 1);
    stagedRuntime.event(() => h.api().key(h.event("F10", { altKey: true }), h.id));
    expect(active).toBe(h.button);
    expect((h.row().block as { text: string }).text).toBe("alpha beta gamma"); h.run.unmount();
  });
}
it("code retains Tab spaces, native Shift+Tab and the Format route", () => {
  const h = mount("code"); const forward = h.event("Tab");
  stagedRuntime.event(() => h.api().key(forward, h.id));
  expect(forward.preventDefault).toHaveBeenCalledOnce();
  expect((h.row().block as { text: string }).text).toBe("alpha    gamma");
  const back = h.event("Tab", { shiftKey: true });
  stagedRuntime.event(() => h.api().key(back, h.id)); expect(back.preventDefault).not.toHaveBeenCalled();
  stagedRuntime.event(() => h.api().key(h.event("F10", { altKey: true }), h.id));
  expect(active).toBe(h.button); h.run.unmount();
});
it("Alt+F10 returns the toolbar's original selection and Escape is left to its card", () => {
  const h = mount(); stagedRuntime.event(() => h.api().key(h.event("F10", { altKey: true }), h.id));
  stagedRuntime.event(() => h.api().blur(h.id, h.button));
  const onReturn = h.toolbarProps().onReturn as () => void;
  const view = NoteToolbarView({ active: "text", enabled: true, onMark: vi.fn(), onType: vi.fn(), onReturn });
  const key = (view.props as { onKeyDown: (event: unknown) => void }).onKeyDown;
  const escape = h.event("Escape"); key(escape);
  expect(escape.preventDefault).not.toHaveBeenCalled(); expect(escape.stopPropagation).not.toHaveBeenCalled();
  stagedRuntime.event(() => key(h.event("F10", { altKey: true })));
  expect(active).toBe(h.surface); expect(h.surface.selection).toEqual({ from: 6, to: 10 }); h.run.unmount();
});
it("external focus clears Format ownership instead of applying a stale selection", () => {
  const h = mount(); stagedRuntime.event(() => h.api().key(h.event("F10", { altKey: true }), h.id));
  stagedRuntime.event(() => h.api().blur(h.id, h.button));
  const outside = {}; active = outside;
  stagedRuntime.event(() => (h.columnProps().onBlurCapture as (event: unknown) => void)({ currentTarget: h.column, relatedTarget: outside }));
  expect(h.toolbarProps().enabled).toBe(false);
  stagedRuntime.event(() => (h.toolbarProps().onMark as (mark: string) => void)("strong"));
  expect((h.row().block as { text: string }).text).toBe("alpha beta gamma"); expect(active).toBe(outside); h.run.unmount();
});
for (const method of ["pointer", "shortcut"] as const) {
  it(`retains ${method} formatting of the current selection`, () => {
    const h = mount();
    stagedRuntime.event(() => {
      if (method === "pointer") (h.toolbarProps().onMark as (mark: string) => void)("strong");
      else h.api().key(h.event("b", { ctrlKey: true }), h.id);
    });
    expect((h.row().block as { text: string }).text).toBe("alpha **beta** gamma");
    expect(active).toBe(h.surface); h.run.unmount();
  });
}
it("advertises Format only on a surface whose owner supplies that toolbar", () => {
  for (const formatShortcut of [false, true]) {
    const api = { current: { register: vi.fn(), input: vi.fn(), key: vi.fn(), paste: vi.fn(), caret: vi.fn(), blur: vi.fn(), typing: () => false } satisfies SurfaceApi };
    const run = stagedRuntime.mount(() => Surface({ id: "field", text: "", sources: {}, api, label: "Text", placeholder: "", formatShortcut }));
    expect(run.value.props["aria-keyshortcuts"]).toBe(formatShortcut ? "Alt+F10" : undefined);
    expect(run.value.props.title).toBe(formatShortcut ? "Alt+F10 moves between this block and Format." : undefined);
    run.unmount();
  }
});
it("disables inapplicable inline marks on literal code, retaining text marks and code type changes", () => {
  for (const active of ["code", "text"] as const) {
    const buttons = nodes(NoteToolbarView({ active, enabled: true, onMark: vi.fn(), onType: vi.fn() })).filter(el => el.type === "button");
    for (const label of ["Bold", "Italic", "Underline", "Highlight", "Code"]) {
      expect(buttons.find(el => el.props["aria-label"] === label)!.props.disabled).toBe(active === "code");
    }
    for (const label of ["Heading", "Bulleted list", "Numbered list"]) {
      expect(buttons.find(el => el.props["aria-label"] === label)!.props.disabled).toBe(false);
    }
  }
});
