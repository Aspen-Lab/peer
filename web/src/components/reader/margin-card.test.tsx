import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createElement } from "react";
import type { ReactElement, ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { MARGIN_CARD_SELECTOR } from "@/lib/reader/margin";
import { WINDOW_HEADER_PX } from "@/lib/reader/windows";
import { MarginCardHeader, MarginCardShell, marginCardFrame } from "./margin-card";

// P11-14 rule 2 (B P11-03 §3.2; ruling §1h.113 (d)): the one frame every card in the margin stands in — the sticky notes, the notes
// window, the figure card, the explain card's header. A 40 px header with the title, the headline and the X; the X at the start or at the
// end; whole when in front, only its header when behind; `data-margin-card`; `position: fixed` at the margin's left and width. Every text
// here is invented. The shell is hook-free (the page's `MarginCard` adds `useMarginRect()` to it), so it is tested as markup and as a tree.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

type Props = Record<string, unknown> & { children?: ReactNode };
/** The element tree with the function components (all hook-free here) expanded. */
function elements(node: ReactNode): ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== "object" || !("props" in node)) return [];
  const element = node as ReactElement<Props>;
  if (typeof element.type === "function") return [element, ...elements((element.type as (p: Props) => ReactNode)(element.props))];
  return [element, ...elements(element.props.children)];
}

const shell = (extra: Partial<Parameters<typeof MarginCardShell>[0]> = {}): Parameters<typeof MarginCardShell>[0] => ({
  id: "s1",
  kind: "sticky",
  title: "Note 2",
  headline: "“The finest grains”",
  closeAt: "end",
  closeLabel: "Close note 2",
  front: true,
  top: 180,
  height: 260,
  z: 62,
  frame: null,
  onRaise: vi.fn(),
  onClose: vi.fn(),
  children: createElement("p", null, "THE BODY"),
  ...extra,
});
const html = (extra: Partial<Parameters<typeof MarginCardShell>[0]> = {}) => renderToStaticMarkup(createElement(MarginCardShell, shell(extra)));

describe("marginCardFrame — where a card stands across the page", () => {
  it("is the margin's left and width when a shell has registered one", () => {
    expect(marginCardFrame({ left: 1080, width: 360 })).toEqual({ left: 1080, width: 360 });
    expect(marginCardFrame({ left: 912.5, width: 431 })).toEqual({ left: 912.5, width: 431 });
  });

  it("is the right edge, 360 px wide at most, where there is no margin (a page without the shell; 640 to 1023 px)", () => {
    expect(marginCardFrame(null)).toEqual({ right: 0, width: "min(360px, 100vw)" });
  });
});

describe("MarginCardShell — the frame", () => {
  it("is fixed, carries data-margin-card with its kind, and stands at its top, height and z", () => {
    const out = html();
    expect(out).toContain("fixed");
    expect(out).toContain('data-margin-card="sticky"');
    expect(out).toContain("top:180px");
    expect(out).toContain("height:260px");
    expect(out).toContain("z-index:62");
    expect(MARGIN_CARD_SELECTOR).toBe("[data-margin-card]");
  });

  it("stands at the margin's left and width, and has no right-0 or w-[…] class", () => {
    const out = html({ frame: { left: 1080, width: 360 } });
    expect(out).toContain("left:1080px");
    expect(out).toContain("width:360px");
    expect(out).not.toContain("right:0");
    const classes = /class="([^"]*)"/.exec(out)?.[1] ?? "";
    expect(classes).not.toMatch(/\bright-0\b/);
    expect(classes).not.toMatch(/\bw-\[/);
  });

  it("with no margin it keeps the right edge, 360 px at most, as the stickies always stood", () => {
    const out = html({ frame: null });
    expect(out).toContain("right:0");
    expect(out).toContain("width:min(360px, 100vw)");
    expect(out).not.toContain("left:");
  });

  it("takes a max-height instead of a height when it is given one (a window that is as tall as its text, up to the room)", () => {
    const out = html({ height: undefined, maxHeight: 640 });
    expect(out).toContain("max-height:640px");
    expect(out).not.toMatch(/[^-]height:260px/);
  });

  it("passes the root's own attributes on: the sticky's data-sticky and group role, the keydown handler", () => {
    const onKeyDown = vi.fn();
    const root = MarginCardShell(shell({ role: "group", "aria-label": "Note 2", "data-sticky": 2, onKeyDown } as never)) as ReactElement<Props>;
    expect(root.props.role).toBe("group");
    expect(root.props["aria-label"]).toBe("Note 2");
    expect(root.props["data-sticky"]).toBe(2);
    expect(root.props.onKeyDown).toBe(onKeyDown);
  });
});

describe("MarginCardHeader — 40 px with the title, the headline and the X", () => {
  it("is a header tall: the stack's cascade step", () => {
    expect(WINDOW_HEADER_PX).toBe(40);
    expect(html()).toMatch(/class="[^"]*\bh-10\b/);
  });

  it("shows the title, then the headline in its quotes, and the X with its label", () => {
    const out = html();
    expect(out).toContain("Note 2");
    expect(out).toContain("“The finest grains”");
    expect(out).toMatch(/aria-label="Close note 2"/);
    expect(out.indexOf("Note 2")).toBeLessThan(out.indexOf("“The finest grains”"));
  });

  it("has the X at the end for a sticky, a note and a figure, and at the start for the explain card (O-7)", () => {
    const end = html({ closeAt: "end" });
    expect(end.indexOf("Close note 2")).toBeGreaterThan(end.indexOf("Note 2"));
    const start = html({ closeAt: "start", kind: "explain", closeLabel: "Close" });
    expect(start.indexOf('aria-label="Close"')).toBeLessThan(start.indexOf("Note 2"));
    // The explain card's X is the big highlighted one: the accent colour, 36 px.
    expect(start).toMatch(/bg-accent/);
    expect(start).toMatch(/\bh-9\b/);
    expect(end).not.toMatch(/bg-accent/);
  });

  it("a press on the header raises the card; the X closes it and does not raise it", () => {
    const props = shell();
    const buttons = elements(MarginCardShell(props)).filter((el) => el.type === "button");
    const header = buttons.find((b) => b.props["data-margin-header"] !== undefined)!;
    expect(header).toBeDefined();
    (header.props.onClick as () => void)();
    expect(props.onRaise).toHaveBeenCalledTimes(1);
    const stop = vi.fn();
    const close = buttons.find((b) => b.props["aria-label"] === "Close note 2")!;
    (close.props.onClick as (e: unknown) => void)({ stopPropagation: stop });
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(stop).toHaveBeenCalled();
    expect(props.onRaise).toHaveBeenCalledTimes(1);
  });

  it("carries the attributes a kind needs on its header button and its X (data-sticky-header, data-explain-close)", () => {
    const out = renderToStaticMarkup(
      createElement(MarginCardHeader, {
        title: "Explain this",
        headline: "Specimens",
        closeAt: "start",
        closeLabel: "Close",
        onRaise: () => {},
        onClose: () => {},
        headerAttrs: { "data-explain-header": "" },
        closeAttrs: { "data-explain-close": "" },
      }),
    );
    expect(out).toContain("data-explain-header");
    expect(out).toContain("data-explain-close");
  });
});

describe("MarginCardShell — front and behind", () => {
  it("in front it shows its body under the header", () => {
    const out = html();
    expect(out).toContain("THE BODY");
    expect(out.indexOf("THE BODY")).toBeGreaterThan(out.indexOf("Note 2"));
  });

  it("behind another card it shows its header alone, a header tall, and does not render its body", () => {
    const out = html({ front: false, height: WINDOW_HEADER_PX });
    expect(out).toContain("Note 2");
    expect(out).toContain("height:40px");
    expect(out).not.toContain("THE BODY");
    expect(out).toMatch(/aria-label="Close note 2"/);
  });

  it("a card that keeps its body mounted behind another (the notes window's editor) still renders it", () => {
    const out = html({ front: false, height: WINDOW_HEADER_PX, keepMounted: true });
    expect(out).toContain("THE BODY");
  });
});

describe("the cards take the frame, not their own right-0 and 360 px (P11-14 rule 2)", () => {
  const sticky = read("src/components/notes/sticky-note.tsx");
  const notes = read("src/components/notes/notes-window.tsx");

  it("sticky-note.tsx stands in the MarginCard and has neither right-0 nor w-[min(360px…]", () => {
    expect(sticky).toContain("MarginCard");
    expect(sticky).not.toMatch(/\bright-0\b/);
    expect(sticky).not.toMatch(/w-\[min\(360px/);
  });

  it("notes-window.tsx takes the card's frame and has neither right-0 nor w-[360px]", () => {
    expect(notes).toContain("MarginCard");
    expect(notes).not.toMatch(/\bright-0\b/);
    expect(notes).not.toMatch(/w-\[360px\]/);
  });
});
