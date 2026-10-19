import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ReadingControls } from "./reading-controls";

// P9-23 (A P9-W2's N5): on a phone the five reading controls — Larger / Smaller text, Day / Night, Fit — were
// 28 × 28 px, 4 px apart (the page's own commands are 44 px). They take the shell's touch rule: where there is
// no hover, 44 × 44 (`[@media(hover:none)]:min-h-11` / `:min-w-11`, the classes notes-button.tsx, reader-tabs.tsx
// and the masthead's links already carry) with 8 px between neighbours; with a mouse the size is unchanged.
// Layout is not computed in this node environment; the boxes are measured in the checkpoint
// (docs/reading-helper-abc/P9-23-C-*.md) and this file pins the classes that make them.
//
// The stores start at their defaults and `useSpread` answers its server snapshot (one column), so Fit is
// disabled here; the markup is the strip as the server draws it.

const html = () => renderToStaticMarkup(createElement(ReadingControls));
const tags = (markup: string, tag: string) => markup.match(new RegExp(`<${tag}\\b[^>]*>`, "g")) ?? [];
const classes = (tagText: string) => (/\bclass="([^"]*)"/.exec(tagText)?.[1] ?? "").split(/\s+/).filter(Boolean);
const attr = (tagText: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tagText)?.[1];

const NAMES = ["Larger text", "Smaller text", "Day reading mode", "Night reading mode", "Fit to screen"];

describe("ReadingControls — five buttons, the names they had (N5)", () => {
  it("are the same five buttons with the same names, in the same order, in one labelled group", () => {
    const markup = html();
    const buttons = tags(markup, "button");

    expect(buttons.map((b) => attr(b, "aria-label"))).toEqual(NAMES);
    for (const b of buttons) expect(attr(b, "type")).toBe("button");
    const group = tags(markup, "div")[0] ?? "";
    expect(attr(group, "role")).toBe("group");
    expect(attr(group, "aria-label")).toBe("Reading controls");
  });
});

describe("ReadingControls — touch targets under hover:none (N5)", () => {
  it("makes every one of the five at least 44 × 44 where there is no hover", () => {
    const buttons = tags(html(), "button");

    expect(buttons).toHaveLength(5);
    for (const b of buttons) {
      const cls = classes(b);
      expect(cls, attr(b, "aria-label") ?? "").toContain("[@media(hover:none)]:min-h-11");
      expect(cls, attr(b, "aria-label") ?? "").toContain("[@media(hover:none)]:min-w-11");
    }
  });

  it("puts 8 px (gap-2) rather than 4 px (gap-1) between neighbouring targets where there is no hover", () => {
    const group = classes(tags(html(), "div")[0] ?? "");

    expect(group).toContain("[@media(hover:none)]:gap-2");
    // With a mouse the strip is the one it was.
    expect(group).toContain("gap-1");
  });

  it("leaves the mouse's size alone: the same 28 px square, and no touch size outside hover:none", () => {
    for (const b of tags(html(), "button")) {
      const cls = classes(b);
      expect(cls).toContain("h-7");
      expect(cls).toContain("w-7");
      // The 44 px floor must stay behind the media query; a bare min-h-11 would grow the mouse's buttons too.
      expect(cls).not.toContain("min-h-11");
      expect(cls).not.toContain("min-w-11");
    }
  });
});

// P11-16 (B P11-01 §2.3): in the three-pane page the strip stands at the top of the left pane (the layout draws it there, with `spread`), so
// Fit has a layout to balance and is enabled, and the strip takes no gap above it — the pane's header row has its own. In one column and
// wherever the strip is drawn without `spread`, it is the strip it was.
describe("ReadingControls — in the left pane (P11-16)", () => {
  const pane = () => renderToStaticMarkup(createElement(ReadingControls, { spread: true }));

  it("enables Fit: the three panes are a layout it can balance", () => {
    const fit = tags(pane(), "button").find((b) => attr(b, "aria-label") === "Fit to screen") ?? "";

    expect(fit).not.toBe("");
    expect(fit).not.toContain('disabled=""');
    expect(attr(fit, "title")).toBeUndefined();
  });

  it("is the same five buttons in the same order, with the same sizes", () => {
    const buttons = tags(pane(), "button");

    expect(buttons.map((b) => attr(b, "aria-label"))).toEqual(NAMES);
    for (const b of buttons) {
      expect(classes(b)).toEqual(expect.arrayContaining(["h-7", "w-7", "[@media(hover:none)]:min-h-11", "[@media(hover:none)]:min-w-11"]));
    }
  });

  it("takes no gap above it in the pane, and keeps the one column's 20px gap without `spread`", () => {
    expect(classes(tags(pane(), "div")[0] ?? "")).not.toContain("mt-5");
    expect(classes(tags(html(), "div")[0] ?? "")).toContain("mt-5");
  });

  it("leaves Fit disabled in one column, as before", () => {
    const fit = tags(html(), "button").find((b) => attr(b, "aria-label") === "Fit to screen") ?? "";

    expect(fit).toContain("disabled");
    expect(attr(fit, "title")).toBe("Fit needs the two-column layout");
  });
});
