import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReactElement, ReactNode } from "react";
import { tabId } from "@/components/reader/reader-tabs";
import { READER_TABS } from "@/components/reader/use-reader-tab";
import { RETURN_KEY, backTarget, decideRestore, peekPlace, rememberPlace, restoreStep, type PlaceDoc } from "@/lib/notes/return-to-paper";
import * as windowModule from "./notes-window";

// P11-25 (the owner's item 3, ruling §1h.121 (c)): from 768 px "Open your notes" opens the floating window, so the
// notes page, and its "← Back to paper", were reachable only from the phone's row, the upload-fallback band and Saved.
// The window's header now carries "Open as page": a link to the paper's note on its page that first records the
// paper's tab and place (C P11-06's `rememberPlace`, the phone row's own record) and closes the window as the page
// opens. The window cannot mount in this runtime (no DOM), so its header is rendered, the press is a pure function
// over handed-in steps (run here against P11-06's fake document and storage), and the wiring is read from the source.
//
// Written red on the base, which has none of it. The names this change adds are read loosely below so that this file
// type-checks there too; the change that adds them types them.

type ViewProps = Parameters<typeof windowModule.NotesWindowView>[0];
type El = ReactElement<Record<string, unknown> & { children?: ReactNode }>;
type Click = { button: number; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean };
type Ids = { paperId: string; noteId: string };
type Steps = { remember: (ids: Ids) => boolean | void; close: () => void };
const added = windowModule as unknown as { openAsPage?: (ids: Ids, click: Click, steps: Steps) => boolean };
const openAsPage = (ids: Ids, click: Click, steps: Steps): boolean => added.openAsPage!(ids, click, steps);

const { NotesWindowView } = windowModule;

const PAPER = "openalex:W9";
const NOTE = "n1";
const PAGE = "/notes/n1";

const plain: Click = { button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false };

const base: ViewProps = { top: 220, maxHeight: 700, menuOpen: false, notice: null, onClose: () => {}, onMenu: () => {}, onExport: () => {}, onRaise: () => {} };
const withPage = (props: Partial<ViewProps> = {}, extra: Record<string, unknown> = { pageHref: PAGE, onOpenPage: () => {} }) =>
  ({ ...base, ...props, ...extra }) as ViewProps;
const html = (props: ViewProps) => renderToStaticMarkup(createElement(NotesWindowView, props, createElement("p", null, "THE NOTE")));

function walk(node: ReactNode): El[] {
  if (Array.isArray(node)) return node.flatMap(walk);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const el = node as El;
  return [el, ...walk(el.props.header as ReactNode), ...walk(el.props.children)];
}

describe("the window's header carries Open as page", () => {
  it("is a link to the note's page, labelled and named for a screen reader, between the title and Close", () => {
    const out = html(withPage());

    expect(out).toMatch(/<a [^>]*href="\/notes\/n1"/);
    expect(out).toContain(">Open as page<");
    expect(/<a [^>]*aria-label="([^"]*)"/.exec(out)?.[1]).toMatch(/^Open as page/);
    const title = out.indexOf(">Your notes</button>");
    const link = out.indexOf(">Open as page<");
    const close = out.indexOf('aria-label="Close your notes"');
    expect(title).toBeGreaterThan(-1);
    expect(link).toBeGreaterThan(title);
    expect(close).toBeGreaterThan(link);
  });

  it("is an anchor with an href, so Tab reaches it and Enter presses it; nothing takes it out of the tab order", () => {
    const out = html(withPage());
    const anchor = /<a [^>]*>/.exec(out)?.[0] ?? "";

    expect(anchor).toContain("href=");
    expect(anchor).not.toMatch(/tabindex="-1"|aria-hidden|disabled/i);
    expect(out).not.toMatch(/<button[^>]*>\s*Open as page/);
  });

  it("is drawn in front only, as Export is: behind another window the header shows the title and Close alone", () => {
    const behind = html(withPage({ front: false, height: 40 }));

    expect(behind).not.toContain("Open as page");
    expect(behind).toContain('aria-label="Close your notes"');
    expect(html(withPage({ front: true }))).toContain("Open as page");
  });

  it("is drawn only when the window is handed the note's page; a header without one is as it was", () => {
    const out = html(withPage({}, {}));

    expect(out).not.toContain("Open as page");
    expect(out).not.toMatch(/<a /);
    expect(out).toContain(">Export");
    expect(out).toContain('aria-label="Close your notes"');
  });

  it("hands the press to the window, and does not stop the link's own navigation", () => {
    const seen: unknown[] = [];
    const press = { ...plain, preventDefault: () => seen.push("prevented") };
    const tree = NotesWindowView(withPage({}, { pageHref: PAGE, onOpenPage: (event: unknown) => seen.push(event) }));
    const link = walk(tree as ReactNode).find((el) => el.props.href === PAGE)!;

    (link.props.onClick as (event: unknown) => void)(press);

    expect(seen).toEqual([press]);
  });
});

/** A document at `tab` with these paragraphs, as `return-to-paper.test.ts` draws one. */
function fakeDoc(tab: "summary" | "digestion", paragraphs: { id: string; top: number; bottom: number }[]): PlaceDoc {
  return {
    documentElement: { scrollHeight: 12_536 },
    getElementById: (id: string) => {
      const known = READER_TABS.find((name) => tabId(name) === id);
      return known ? { getAttribute: (attr: string) => (attr === "aria-selected" ? String(known === tab) : null) } : null;
    },
    querySelectorAll: () => paragraphs.map((p) => ({ id: p.id, getBoundingClientRect: () => ({ top: p.top, bottom: p.bottom }) })),
  };
}

function fakeStorage(broken = false) {
  const data = new Map<string, string>();
  const guard = () => {
    if (broken) throw new Error("storage blocked");
  };
  return {
    data,
    getItem: (key: string) => (guard(), data.get(key) ?? null),
    setItem: (key: string, value: string) => (guard(), void data.set(key, value)),
    removeItem: (key: string) => (guard(), void data.delete(key)),
  };
}

/** The window's press as the page runs it, with `rememberPlace` reading this document, scroll and storage. */
function press(tab: "summary" | "digestion", scrollY: number, click: Click = plain, storage = fakeStorage()) {
  const doc = fakeDoc(tab, tab === "summary" ? [] : [
    { id: "paper-section-3-p2", top: -300, bottom: -50 },
    { id: "paper-section-3-p3", top: -12, bottom: 240 },
    { id: "paper-section-4-p1", top: 262, bottom: 520 },
  ]);
  const order: string[] = [];
  const taken = openAsPage({ paperId: PAPER, noteId: NOTE }, click, {
    remember: (ids) => {
      order.push("remember");
      return rememberPlace(ids, { win: { scrollY }, doc, storage });
    },
    close: () => order.push("close"),
  });
  return { taken, order, storage };
}

describe("the press records the place as the phone's row does, then closes the window", () => {
  it("records the paper, the note, the tab on show, the scroll and the paragraph at the top of the view — before the window closes", () => {
    const { taken, order, storage } = press("digestion", 3400);

    expect(taken).toBe(true);
    expect(order).toEqual(["remember", "close"]);
    expect([...storage.data.keys()]).toEqual([RETURN_KEY]);
    expect(peekPlace(PAPER, storage)).toEqual({
      paperId: PAPER,
      noteId: NOTE,
      tab: "digestion",
      scrollY: 3400,
      height: 12_536,
      paragraphId: "paper-section-3-p3",
      paragraphTop: -12,
    });
  });

  it("is the record the notes page reads: its top-left says Back to paper, to this paper, and only for this note", () => {
    const { storage } = press("digestion", 3400);
    const raw = storage.getItem(RETURN_KEY);

    expect(backTarget(NOTE, raw)).toEqual({ label: "Back to paper", href: "/papers/openalex%3AW9", fromPaper: true });
    expect(backTarget("another-note", raw).label).toBe("Saved");
  });

  it("records the Summary as the Summary, with no paragraph (the Summary draws none)", () => {
    const { storage } = press("summary", 240);

    expect(peekPlace(PAPER, storage)).toMatchObject({ tab: "summary", scrollY: 240, paragraphId: null });
  });

  it("is a record the paper's page restores: the tab the reader left, then the scroll they left", () => {
    for (const left of ["digestion", "summary"] as const) {
      const { storage } = press(left, left === "digestion" ? 3400 : 240);
      const record = peekPlace(PAPER, storage)!;
      const other = left === "digestion" ? "summary" : "digestion";

      expect(restoreStep(record, { ready: true, hasBody: true, tab: other })).toEqual({ kind: "select", tab: left });
      expect(restoreStep(record, { ready: true, hasBody: true, tab: left })).toEqual({ kind: "place" });
      expect(decideRestore(record, { height: record.height, paragraphTop: null })).toEqual({ kind: "scroll", top: record.scrollY });
    }
  });

  it("goes on when nothing could be kept (storage blocked): the window still closes and the page still opens, as Saved", () => {
    const { taken, order, storage } = press("digestion", 3400, plain, fakeStorage(true));

    expect(taken).toBe(true);
    expect(order).toEqual(["remember", "close"]);
    expect(peekPlace(PAPER, storage)).toBeNull();
  });

  it("leaves a modified or non-primary press to the browser (a new tab): nothing recorded, the window stays", () => {
    for (const change of [{ metaKey: true }, { ctrlKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const { taken, order, storage } = press("digestion", 3400, { ...plain, ...change });

      expect(taken).toBe(false);
      expect(order).toEqual([]);
      expect(storage.data.size).toBe(0);
    }
  });
});

describe("the window is wired to it (read from the source: the window needs the notes store and the router)", () => {
  const win = readFileSync(resolve(__dirname, "notes-window.tsx"), "utf8");

  it("hands the view the note's page, and presses through openAsPage for this paper and this note, recording with rememberPlace and closing with onClose", () => {
    expect(win).toMatch(/import \{[^}]*\brememberPlace\b[^}]*\} from "@\/lib\/notes\/return-to-paper"/);
    expect(win).toMatch(/pageHref=\{`\/notes\/\$\{note\.id\}`\}/);
    expect(win).toMatch(/onOpenPage=\{\(event\)\s*=>\s*openAsPage\(\{\s*paperId:\s*paper\.id,\s*noteId:\s*note\.id\s*\},\s*event,\s*\{\s*remember:\s*rememberPlace,\s*close:\s*onClose\s*\}\)\}/);
  });

  it("is one record and one press: rememberPlace is called once, inside openAsPage, and the window never calls the router itself", () => {
    expect(win.match(/\brememberPlace\(/g)).toBeNull();
    expect(win.match(/\bsteps\.remember\(/g)).toHaveLength(1);
    expect(win).not.toMatch(/useRouter|router\.push/);
  });
});
