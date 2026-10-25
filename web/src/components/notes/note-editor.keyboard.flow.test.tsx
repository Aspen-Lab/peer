import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("react", async (original) => ({ ...await original<typeof import("react")>(), ...(await import("@/test-support/staged-runtime")).stagedRuntime.hooks }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/store/notes", () => ({ useNotesStore: (select: (state: object) => unknown) => select({ notes: [], save: vi.fn() }), newestFirst: (x: unknown) => x }));
vi.mock("@/store/feed", () => ({ useFeedStore: (select: (state: object) => unknown) => select({ savedPapers: [], papers: [], library: [] }) }));
vi.mock("@/lib/notes/wysiwyg", async (original) => ({ ...await original<typeof import("@/lib/notes/wysiwyg")>(), getPlainSelection: (el: { selection: object }) => el.selection, plainLength: () => 16, setPlainSelection: (el: { selection: object }, from: number, to = from) => { el.selection = { from, to }; } }));
import type { ReactElement } from "react";
import { stagedRuntime } from "@/test-support/staged-runtime";
import { NoteEditor } from "./note-editor";
import { NoteToolbar } from "./note-toolbar";
import { block } from "@/lib/notes/blocks";
import type { BlockType, Note } from "@/lib/notes/types";

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
  vi.stubGlobal("document", { body: {}, get activeElement() { return active; } });
  vi.stubGlobal("window", { innerHeight: 900 });
});
afterEach(() => vi.unstubAllGlobals());

function mount(type: BlockType = "text") {
  const b = block(type, "alpha beta gamma");
  const note: Note = { id: "one", title: "n", blocks: [b], sources: {}, createdAt: "", updatedAt: "" };
  const surface = { selection: { from: 6, to: 10 }, focus: vi.fn(() => { active = surface; }), getBoundingClientRect: () => ({ top: 100, bottom: 130 }) };
  const button = { focus: vi.fn(() => { active = button; }), closest: () => toolbar };
  const toolbar = { contains: (node: unknown) => node === button, querySelector: () => button };
  const column = { contains: (node: unknown) => node === button || node === surface, querySelector: () => toolbar, querySelectorAll: () => [] };
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
  return { run, surface, button, toolbar, column, api, event, id: b.id, row, toolbarProps: () => nodes(run.value).find(el => el.type === NoteToolbar)!.props };
}

for (const type of ["text", "h2", "quote"] as const) for (const shiftKey of [false, true]) {
  it(`${type} ${shiftKey ? "Shift+Tab" : "Tab"} allows native focus exit without editing words`, () => {
    const h = mount(type); const event = h.event("Tab", { shiftKey });
    stagedRuntime.event(() => h.api().key(event, h.id));
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect((h.row().block as { text: string }).text).toBe("alpha beta gamma"); h.run.unmount();
  });
}
it("Alt+F10 reaches Format and retains the selected block until focus exits", () => {
  const h = mount(); const event = h.event("F10", { altKey: true });
  stagedRuntime.event(() => h.api().key(event, h.id));
  expect(event.preventDefault).toHaveBeenCalledOnce(); expect(h.button.focus).toHaveBeenCalledOnce();
  stagedRuntime.event(() => h.api().blur(h.id, h.button));
  expect(h.toolbarProps().enabled).toBe(true);
  stagedRuntime.event(() => (h.toolbarProps().onMark as (m: string) => void)("strong"));
  expect((h.row().block as { text: string }).text).toBe("alpha **beta** gamma");
  expect(active).toBe(h.surface); h.run.unmount();
});
