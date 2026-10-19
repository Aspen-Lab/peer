import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MARGIN_SELECTOR } from "@/lib/reader/margin";
import { useReaderPanesStore } from "@/store/reader-panes";
import { CENTRE_ID, LEFT_PANE_ID, MARGIN_ID, ReaderShell, type ReaderShellLeft } from "./reader-shell";

// P11-10 rule 3 (B P11-01 §2, §6; ruling §1h.113 (a)): the shell's markup — the grid, the three panes in reading order, the left pane's
// two slot shapes, the empty margin, the two dividers. A server render: the window is 1440 css px wide (`SERVER_VIEWPORT_PX`) and the
// reader has chosen nothing unless a test says so. The behaviour — rail, peek, pin, resize — is in `reader-shell.rail.test.tsx`. Every
// block here is a marker.

const mark = (name: string): ReactNode => createElement("i", { "data-mark": name }, name);
const SPLIT: ReaderShellLeft = { fixed: mark("FIXED"), scroll: mark("SCROLL") };
const WHOLE: ReaderShellLeft = { whole: mark("WHOLE") };

const render = (left: ReaderShellLeft = SPLIT) => renderToStaticMarkup(createElement(ReaderShell, { left, centre: mark("CENTRE") }));
const tagWith = (html: string, attribute: string) => {
  const at = html.indexOf(attribute);
  return html.slice(html.lastIndexOf("<", at), html.indexOf(">", at) + 1);
};
const count = (html: string, text: string) => html.split(text).length - 1;

const NO_CHOICE: { leftPinned?: boolean; leftWidth?: number; marginWidth?: number } = { leftPinned: undefined, leftWidth: undefined, marginWidth: undefined };

/** What the reader chose, as a server render sees it: through the store's INITIAL state (the shell's server snapshot), which is what a
 *  hydrating render reads before <StoreHydrator/> has loaded the browser's copy. */
function choose(patch: typeof NO_CHOICE) {
  useReaderPanesStore.setState({ ...NO_CHOICE, ...patch });
  vi.spyOn(useReaderPanesStore, "getInitialState").mockReturnValue(useReaderPanesStore.getState());
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  useReaderPanesStore.setState(NO_CHOICE);
});
afterEach(() => {
  vi.restoreAllMocks();
  useReaderPanesStore.setState(NO_CHOICE);
});

describe("ReaderShell — the grid", () => {
  it("is the one full-width grid, with the pane widths as custom properties in px", () => {
    const html = render();
    const root = tagWith(html, "data-reader-shell");
    expect(root).toContain('class="reader-shell"');
    expect(root).toContain("--left-pane-w:320px");
    expect(root).toContain("--margin-w:360px");
    expect(root).toContain('data-left-state="pinned"');
  });

  it("puts the left pane, the divider, the centre, the divider and the margin in that order — the DOM order is the visual order", () => {
    const html = render();
    const order = [
      html.indexOf("data-reader-left-cell"),
      html.indexOf('data-reader-divider="left"'),
      html.indexOf("data-reader-centre"),
      html.indexOf('data-reader-divider="margin"'),
      html.indexOf("data-reader-margin"),
    ];
    expect(order.every((at) => at > 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // Five tracks' worth of children, no more: the grid is `left 12 centre 12 margin`.
    const directChildren = (html.match(/<(div|aside)[^>]*(data-reader-left-cell|data-reader-divider|data-reader-centre="|data-reader-margin)/g) ?? []).length;
    expect(directChildren).toBe(5);
  });

  it("shows each block exactly once, in every state (one DOM node per block)", () => {
    for (const pinned of [undefined, true, false]) {
      choose({ leftPinned: pinned });
      for (const left of [SPLIT, WHOLE]) {
        const html = render(left);
        for (const name of "whole" in left ? ["WHOLE", "CENTRE"] : ["FIXED", "SCROLL", "CENTRE"]) {
          expect([pinned, name, count(html, `data-mark="${name}"`)]).toEqual([pinned, name, 1]);
        }
      }
    }
  });
});

describe("ReaderShell — the left pane", () => {
  it("holds a fixed zone and a scroll zone, in that order, in the pane", () => {
    const html = render(SPLIT);
    const pane = html.slice(html.indexOf('id="' + LEFT_PANE_ID + '"'));
    const fixed = pane.indexOf("data-reader-left-fixed");
    const scroll = pane.indexOf("data-reader-left-scroll");
    expect(fixed).toBeGreaterThan(0);
    expect(scroll).toBeGreaterThan(fixed);
    expect(pane.indexOf('data-mark="FIXED"')).toBeGreaterThan(fixed);
    expect(pane.indexOf('data-mark="FIXED"')).toBeLessThan(scroll);
    expect(pane.indexOf('data-mark="SCROLL"')).toBeGreaterThan(scroll);
    expect(tagWith(html, "data-reader-left=")).toContain('data-mode="split"');
  });

  it("holds the whole content when it is given one, with no zones: the pane scrolls as one", () => {
    const html = render(WHOLE);
    expect(html).not.toContain("data-reader-left-fixed");
    expect(html).not.toContain("data-reader-left-scroll");
    expect(html.indexOf('data-mark="WHOLE"')).toBeGreaterThan(html.indexOf('id="' + LEFT_PANE_ID + '"'));
    expect(tagWith(html, "data-reader-left=")).toContain('data-mode="whole"');
  });

  it("is pinned on a first visit at 1440: not inert, the pin button collapses it, no rail button in sight", () => {
    const html = render();
    const pane = tagWith(html, "data-reader-left=");
    expect(pane).toContain('data-state="pinned"');
    expect(pane).not.toContain("inert");
    const pin = tagWith(html, "reader-pin-button");
    expect(pin).toContain('aria-label="Collapse sidebar"');
    expect(pin).toContain('aria-expanded="true"');
    expect(pin).toContain(`aria-controls="${LEFT_PANE_ID}"`);
    expect(tagWith(html, "data-reader-rail")).toContain("hidden");
  });

  it("is the rail when the reader collapsed it: inert, the rail button shown and labelled, no left divider but a plain gap", () => {
    choose({ leftPinned: false });
    const html = render();
    const pane = tagWith(html, "data-reader-left=");
    expect(pane).toContain('data-state="rail"');
    expect(pane).toContain("inert");
    expect(tagWith(html, "<div class=\"reader-shell\"")).toContain('data-left-state="rail"');
    const rail = tagWith(html, "data-reader-rail");
    expect(rail).not.toContain("hidden");
    expect(rail).toContain('aria-label="Show sidebar"');
    expect(rail).toContain('aria-expanded="false"');
    expect(rail).toContain(`aria-controls="${LEFT_PANE_ID}"`);
    expect(html).not.toContain('data-reader-divider="left"');
    expect(html).toContain("reader-divider-rest");
    expect(tagWith(html, "reader-pin-button")).toContain('aria-label="Pin sidebar"');
  });

  it("keeps the blocks in the DOM when it is the rail (nothing unmounts)", () => {
    choose({ leftPinned: false });
    const html = render();
    expect(html).toContain('data-mark="FIXED"');
    expect(html).toContain('data-mark="SCROLL"');
  });
});

describe("ReaderShell — the centre", () => {
  it("holds the paper's text inside a capped, centred inner box", () => {
    const html = render();
    const centre = html.slice(html.indexOf('id="' + CENTRE_ID + '"'));
    expect(tagWith(html, "data-reader-centre=")).toContain("reader-centre");
    expect(centre.indexOf("data-reader-centre-inner")).toBeGreaterThan(0);
    expect(centre.indexOf('data-mark="CENTRE"')).toBeGreaterThan(centre.indexOf("data-reader-centre-inner"));
  });
});

describe("ReaderShell — a hydrating render", () => {
  it("reads the store's initial state, not the widths <StoreHydrator/> has loaded since: the markup of the server's render matches", () => {
    useReaderPanesStore.setState({ leftPinned: false, leftWidth: 400, marginWidth: 450 });
    const html = render();
    expect(tagWith(html, "data-reader-shell")).toContain("--left-pane-w:320px");
    expect(tagWith(html, "data-reader-shell")).toContain("--margin-w:360px");
    expect(tagWith(html, "data-reader-shell")).toContain('data-left-state="pinned"');
  });
});

describe("ReaderShell — the margin", () => {
  it("is an empty aside named Margin: no children, no text, before anything is selected (item 5)", () => {
    const html = render();
    const aside = html.slice(html.indexOf("<aside"), html.indexOf("</aside>") + "</aside>".length);
    expect(aside).toMatch(/^<aside [^>]*><\/aside>$/);
    expect(aside).toContain('aria-label="Margin"');
    expect(aside).toContain("data-reader-margin");
    expect(aside).toContain(`id="${MARGIN_ID}"`);
  });

  it("is what MARGIN_SELECTOR finds", () => {
    expect(MARGIN_SELECTOR).toBe("[data-reader-margin]");
    expect(render()).toContain("data-reader-margin=");
  });

  it("is not collapsible: no state, no toggle, no hidden margin — there is always one aside, and two dividers around the centre", () => {
    for (const pinned of [undefined, true, false]) {
      choose({ leftPinned: pinned });
      const html = render();
      expect(count(html, "<aside")).toBe(1);
      expect(html).toContain('data-reader-divider="margin"');
      expect(html).not.toMatch(/margin[^"]*collaps|collaps[^"]*margin/i);
    }
  });
});

describe("ReaderShell — the dividers", () => {
  it("are two separators, each named, each reporting its pane's width, each controlling its pane", () => {
    const html = render();
    const left = tagWith(html, 'data-reader-divider="left"');
    const margin = tagWith(html, 'data-reader-divider="margin"');
    expect(left).toContain('role="separator"');
    expect(left).toContain('aria-label="Resize left panel"');
    expect(left).toContain('aria-valuenow="320"');
    expect(left).toContain(`aria-controls="${LEFT_PANE_ID}"`);
    expect(margin).toContain('role="separator"');
    expect(margin).toContain('aria-label="Resize margin"');
    expect(margin).toContain('aria-valuenow="360"');
    expect(margin).toContain(`aria-controls="${MARGIN_ID}"`);
  });

  it("report the remembered widths, and write them as the grid's custom properties", () => {
    choose({ leftPinned: true, leftWidth: 400, marginWidth: 450 });
    const html = render();
    expect(tagWith(html, "data-reader-shell")).toContain("--left-pane-w:400px");
    expect(tagWith(html, "data-reader-shell")).toContain("--margin-w:450px");
    expect(tagWith(html, 'data-reader-divider="left"')).toContain('aria-valuenow="400"');
    expect(tagWith(html, 'data-reader-divider="margin"')).toContain('aria-valuenow="450"');
  });

  it("the range of each is what the window leaves: at 1440 the left pane may reach 480, the margin 560", () => {
    const html = render();
    expect(tagWith(html, 'data-reader-divider="left"')).toContain('aria-valuemax="480"');
    expect(tagWith(html, 'data-reader-divider="margin"')).toContain('aria-valuemax="560"');
  });
});
