import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import * as dock from "./explain-dock";
import * as windows from "@/lib/reader/windows";
import * as margin from "@/lib/reader/margin";

// P11-14 rule 3 (B P11-01 §3.1, §4 C4; ruling §1h.113): the reserve is retired. The margin is a grid track of the reader's shell, so
// nothing is reserved when a card opens and the paper's words never move: no `--explain-dock` on the document's root, no padding on
// <main>, no scroll compensation after a reflow that no longer happens. These are the source-shape pins of that; the behaviour is
// pinned in `explain-box.stack.flow.test.tsx` and `windows.test.ts`.

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

describe("the reserve is gone from the dock's module", () => {
  it("explain-dock.ts exports no reserveDock, DOCK_VAR, DOCK_WIDTH_VAR or DOCK_RESERVE_PX", () => {
    for (const name of ["reserveDock", "DOCK_VAR", "DOCK_WIDTH_VAR", "DOCK_RESERVE_PX"]) expect(dock).not.toHaveProperty(name);
  });

  it("explain-dock.ts writes no custom property on the document's root", () => {
    const source = read("src/components/reader/explain-dock.ts");
    expect(source).not.toContain("reserveDock");
    expect(source).not.toContain("--explain-dock");
    expect(source).not.toContain("setProperty");
  });

  it("keeps what the margin still stands on: the band's numbers and the height guard", () => {
    expect(dock.DOCK_TOP_PX).toBe(48);
    expect(dock.DOCK_MIN_VIEWPORT_PX).toBe(1024);
    expect(typeof dock.columnBottomPx).toBe("function");
    expect(typeof dock.settleHeight).toBe("function");
  });
});

describe("the stack no longer binds a reserve or holds the reader's place", () => {
  it("windows.ts exports no bindWindowsReserve, holdInPlace or readingAnchorTop", () => {
    for (const name of ["bindWindowsReserve", "holdInPlace", "readingAnchorTop"]) expect(windows).not.toHaveProperty(name);
  });

  it("windows.ts has no reserve of any kind at its module's end", () => {
    const source = read("src/lib/reader/windows.ts");
    expect(source).not.toContain("reserveDock");
    expect(source).not.toContain("scrollBy");
    expect(source).not.toContain("getSelection");
  });

  it("the sticky notes and the notes window open and close in the stack plainly, without measuring and scrolling around it", () => {
    for (const path of ["src/components/notes/sticky-note.tsx", "src/components/notes/notes-window.tsx"]) {
      const source = read(path);
      expect(source, path).not.toContain("holdInPlace");
      expect(source, path).not.toContain("readingAnchorTop");
    }
  });
});

describe("the explain box reserves nothing and scrolls nothing when it opens or closes", () => {
  const box = read("src/components/reader/explain-box.tsx");

  it("has no reserveDock and no scroll compensation of the dock's reflow", () => {
    expect(box).not.toContain("reserveDock");
    expect(box).not.toContain("reserved.current");
    expect(box).not.toMatch(/window\.scrollBy\(\{ top: after - before/);
  });

  it("still scrolls for the phone's sheet (revealShift), which has nothing to do with the dock", () => {
    expect(box).toContain("revealShift(");
    expect(box).toMatch(/window\.scrollBy\(\{ top: shift \}\)/);
  });
});

describe("the page keeps no gutter for the dock", () => {
  it("globals.css has no .peer-main-content rule and no --explain-dock property", () => {
    const css = read("src/app/globals.css");
    expect(css).not.toContain("peer-main-content");
    expect(css).not.toContain("--explain-dock");
  });

  it("the shell's <main> does not carry the class", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).not.toContain("peer-main-content");
    expect(layout).toMatch(/<main className="flex-1">/);
  });
});

describe("the Notes edge tab stands at the margin while a card stands", () => {
  const tab = read("src/components/notes/notes-button.tsx");

  it("reads no --explain-dock-width: it is placed from the margin's rect", () => {
    expect(tab).not.toContain("--explain-dock-width");
    expect(tab).not.toContain("explain-dock-width");
    expect(tab).toMatch(/useMarginRect\(\)/);
  });

  it("is the margin's contract that names the rect the tab reads", () => {
    expect(typeof margin.useMarginRect).toBe("function");
  });
});

// P11-14 rule 4 (O-8, BACKLOG-66): the explain card is a card of the stack, so the two sides no longer read each other's DOM: the column
// reading `[data-explain-dock]` every 250 ms (`useColumn`, `columnTop`), and the card shrinking to leave the column its room
// (`dockInStack`, `stackRoom`) are retired.
describe("the explain card joins the stack — the dock's reading of it is gone (P11-14 rule 4)", () => {
  it("explain-dock.ts has no dockInStack, windows.ts no stackRoom or columnTop", () => {
    expect(dock).not.toHaveProperty("dockInStack");
    expect(windows).not.toHaveProperty("stackRoom");
    expect(windows).not.toHaveProperty("columnTop");
  });

  it("windows.ts reads no explain dock from the page", () => {
    const source = read("src/lib/reader/windows.ts");
    expect(source).not.toContain("data-explain-dock");
    expect(source).not.toContain("setInterval");
  });

  it("explain-box.tsx neither shrinks for the stack nor reads its need", () => {
    const box = read("src/components/reader/explain-box.tsx");
    expect(box).not.toContain("dockInStack");
    expect(box).not.toContain("stackRoom");
    expect(box).toContain("EXPLAIN_WINDOW_ID");
  });

  it("the card is one of the stack's, and the stickies and the notes window no longer step round it", () => {
    for (const path of ["src/components/notes/sticky-note.tsx", "src/components/notes/notes-window.tsx"]) {
      const source = read(path);
      expect(source, path).not.toContain("ceiling");
      expect(source, path).not.toContain("columnTop");
    }
  });
});
