import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TABS } from "./copy";
import { ReaderTabs, TABPANEL_ID, nextTab, tabId } from "./reader-tabs";

// P7-14 (R10, the owner's review): "Summary" and "Paper digestion", a tab strip under the
// decision block. No DOM in this project's Vitest: rendered with react-dom/server; the keys go
// through the pure `nextTab`.

const NOOP = () => {};
const render = (tab: "summary" | "digestion") =>
  renderToStaticMarkup(createElement(ReaderTabs, { tab, onSelect: NOOP }));
const tabs = (html: string) => [...html.matchAll(/<button\b[^>]*role="tab"[^>]*>((?:(?!<\/button>).)*)<\/button>/g)];
const tag = (button: RegExpMatchArray) => button[0].slice(0, button[0].indexOf(">") + 1);

describe("the labels", () => {
  it("are the owner's words, from the copy", () => {
    expect(TABS.summary).toBe("Summary");
    expect(TABS.digestion).toBe("Paper digestion");
  });
});

describe("ReaderTabs — the strip", () => {
  it("is a tablist of two tabs, Summary then Paper digestion, named for a screen reader", () => {
    const html = render("digestion");

    expect(html).toMatch(/<div\b[^>]*role="tablist"[^>]*aria-label="[^"]+"/);
    expect(tabs(html).map((button) => button[1])).toEqual(["Summary", "Paper digestion"]);
    for (const button of tabs(html)) expect(tag(button)).toContain('type="button"');
  });

  it("marks the tab on show selected, and only that one, and makes only it a tab stop", () => {
    for (const [active, other] of [["digestion", "summary"], ["summary", "digestion"]] as const) {
      const html = render(active);
      const byId = (id: string) => tabs(html).find((button) => tag(button).includes(`id="${id}"`));
      const on = byId(tabId(active))!;
      const off = byId(tabId(other))!;

      expect(tag(on)).toContain('aria-selected="true"');
      expect(tag(on)).toContain('tabindex="0"');
      expect(tag(off)).toContain('aria-selected="false"');
      expect(tag(off)).toContain('tabindex="-1"');
    }
  });

  it("points every tab at the one panel, whose id the layout gives the tabs' blocks", () => {
    const html = render("digestion");

    expect(TABPANEL_ID).toBe("reader-tabpanel");
    for (const button of tabs(html)) expect(tag(button)).toContain(`aria-controls="${TABPANEL_ID}"`);
    expect(tabId("summary")).not.toBe(tabId("digestion"));
  });

  it("uses legible unwrapped labels and is a touch target on a phone", () => {
    const html = render("digestion");

    for (const button of tabs(html)) {
      expect(tag(button)).toContain("whitespace-nowrap");
      expect(tag(button)).toContain("[@media(hover:none)]:min-h-11");
    }
  });

  it("draws the selected tab with a bar under it, not by colour alone, and the other without one", () => {
    for (const active of ["summary", "digestion"] as const) {
      const html = render(active);
      const byId = (id: string) => tag(tabs(html).find((button) => tag(button).includes(`id="${id}"`))!);
      const other = active === "summary" ? "digestion" : "summary";

      expect(byId(tabId(active))).toContain("reader-tab-selected");
      expect(byId(tabId(other))).not.toContain("reader-tab-selected");
    }
  });
});

describe("nextTab — the arrow keys", () => {
  it("ArrowRight and ArrowDown go to the next tab, and wrap", () => {
    expect(nextTab("ArrowRight", "summary")).toBe("digestion");
    expect(nextTab("ArrowDown", "summary")).toBe("digestion");
    expect(nextTab("ArrowRight", "digestion")).toBe("summary");
  });

  it("ArrowLeft and ArrowUp go to the previous tab, and wrap", () => {
    expect(nextTab("ArrowLeft", "digestion")).toBe("summary");
    expect(nextTab("ArrowUp", "digestion")).toBe("summary");
    expect(nextTab("ArrowLeft", "summary")).toBe("digestion");
  });

  it("Home goes to the first, End to the last", () => {
    expect(nextTab("Home", "digestion")).toBe("summary");
    expect(nextTab("End", "summary")).toBe("digestion");
  });

  it("every other key is the page's: null", () => {
    for (const key of ["Enter", " ", "Tab", "Escape", "a", "j", "k", "t", "q"]) {
      expect(nextTab(key, "summary")).toBeNull();
    }
  });
});
