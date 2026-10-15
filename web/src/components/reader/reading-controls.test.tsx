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
