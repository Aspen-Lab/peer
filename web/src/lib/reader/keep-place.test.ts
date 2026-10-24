import { describe, expect, it, vi } from "vitest";
import { paragraphAtTop } from "@/lib/notes/return-to-paper";
import { COLUMN_SELECTOR, EDGE_PX, MIN_SHIFT_PX, PLACE_LINE_PX, SETTLE_MS, atEdge, heldPlace, keepPlace, layoutKey, shiftToKeep, type KeepPlaceEnv as Env, type View } from "./keep-place";
import { createReflowPage, type SimParagraph } from "@/test-support/reflow-page";

// P11-45 (A P11-43's note "The place is not kept when a boundary is dragged"; ruling §1h.146): the reader's place survives a re-flow.
//
// The rule, from the Theme-A walk (1280 x 720, scrolled to 8,000: a left drag of +60 re-flowed the column 552 to 492 px and moved the top
// paragraph by one, a margin drag of -80 by two): when the text column's width changes, the paragraph at the top of the view and the line of it
// under the masthead stay where they were, to within a line; at scroll 0 and at the page's foot nothing moves; no smooth scroll.
//
// This file holds the arithmetic (`heldPlace`, `shiftToKeep`, `layoutKey`) and the controller (`keepPlace`) over a simulated page that re-flows
// as the browser does (`test-support/reflow-page.ts`: the layout changes and the offset is kept; the observers are told; the scroll event comes at
// the next frame). The real shell, its dividers and the real DOM reads are in `reader-shell.keep-place.flow.test.tsx`.

// ── The page ──

const paragraphs = (): SimParagraph[] =>
  Array.from({ length: 60 }, (_, n) => ({ id: `paper-section-${Math.floor(n / 10) + 1}-p${n % 10}`, chars: n === 24 ? 7000 : 260 + ((n * 137) % 520) }));

const page = (column = 552) => createReflowPage({ paragraphs: paragraphs(), column });
type Page = ReturnType<typeof page>;

/** The simulated page, as the controller's `env`. */
function envOf(p: Page, over: Partial<Env> = {}): Env {
  return {
    view: () => ({ scrollY: p.scrollY, viewportHeight: p.win.innerHeight, scrollHeight: p.scrollHeight, top: p.top() }),
    paragraph: (id) => (p.doc.getElementById(id) ? p.box(id) : null),
    key: () => {
      const style = p.win.getComputedStyle();
      return `${p.columnPx}|${style.getPropertyValue("--reading-scale")}|${style.getPropertyValue("--page-zoom")}`;
    },
    scrollY: () => p.scrollY,
    now: () => p.clock.now,
    scrollBy: (dy) => p.win.scrollBy({ top: dy, behavior: "instant" }),
    onScroll: (run) => {
      p.win.addEventListener("scroll", run);
      return () => p.win.removeEventListener("scroll", run);
    },
    observe: (run) => {
      const observer = new p.ResizeObserver(run);
      observer.observe(p.column);
      return () => observer.disconnect();
    },
    ...over,
  };
}

/** Scroll so that the line under the masthead falls `fraction` of the way down paragraph `id`, and let the scroll event arrive. */
function readAt(p: Page, id: string, fraction: number) {
  const b = p.box(id);
  p.scroll(p.scrollY + b.top + fraction * b.height - 56);
  p.frame();
}

const LINE = 56;

describe("the defect, in the simulated page (a guard: the browser alone keeps the offset and loses the place)", () => {
  it("moves the top paragraph when the column narrows, as the Theme-A walk measured at 1280 x 720", () => {
    const p = page();
    readAt(p, "paper-section-5-p2", 0.5);
    const before = p.top()!;
    p.reflow(492);
    p.frame();
    expect(p.top()!.id).not.toBe(before.id);
  });
});

describe("heldPlace — what is read of the page", () => {
  const view = (over: Partial<View> = {}): View => ({ scrollY: 8000, viewportHeight: 720, scrollHeight: 25000, top: { id: "paper-section-2-p4", top: -300, height: 1200 }, ...over });

  it("is the line's fraction into the paragraph at the top, for a paragraph the line falls in", () => {
    // The line is at 56; the paragraph started 300 above the top of the window: 356 of its 1200 px are above the line.
    expect(heldPlace(view())).toEqual({ id: "paper-section-2-p4", fraction: 356 / 1200, gap: 0 });
  });

  it("is the gap below the line for a paragraph that starts below it", () => {
    expect(heldPlace(view({ top: { id: "paper-section-2-p5", top: 80, height: 200 } }))).toEqual({ id: "paper-section-2-p5", fraction: 0, gap: 24 });
  });

  it("is a paragraph that starts exactly at the line, with no gap and nothing above it", () => {
    expect(heldPlace(view({ top: { id: "paper-section-2-p5", top: 56, height: 200 } }))).toEqual({ id: "paper-section-2-p5", fraction: 0, gap: 0 });
  });

  it("is nothing at the top of the page (scroll 0), where nothing is kept", () => {
    expect(heldPlace(view({ scrollY: 0 }))).toBeNull();
    expect(heldPlace(view({ scrollY: 0.4 }))).toBeNull();
    expect(heldPlace(view({ scrollY: 1 }))).not.toBeNull();
  });

  it("is nothing at the foot of the page, where nothing is kept", () => {
    // 25000 high, a 720 window: the foot is at scroll 24280.
    expect(heldPlace(view({ scrollY: 24280 }))).toBeNull();
    expect(heldPlace(view({ scrollY: 24279.5 }))).toBeNull();
    expect(heldPlace(view({ scrollY: 24270 }))).not.toBeNull();
  });

  it("is nothing without a paragraph at the top (the Summary tab, a page with no body)", () => {
    expect(heldPlace(view({ top: null }))).toBeNull();
  });

  it("is nothing for a paragraph that starts below the window: the reader is looking at something else", () => {
    expect(heldPlace(view({ top: { id: "paper-section-1-p0", top: 900, height: 200 } }))).toBeNull();
  });

  it("reads the line where paragraphAtTop does: a paragraph whose bottom is at the line is above it, one pixel more is the one at the top", () => {
    const doc = (bottom: number) => ({
      querySelectorAll: () => [{ id: "paper-section-1-p0", getBoundingClientRect: () => ({ top: bottom - 100, bottom }) }],
    });
    expect(PLACE_LINE_PX).toBe(LINE);
    expect(paragraphAtTop(doc(PLACE_LINE_PX), PLACE_LINE_PX)).toBeNull();
    expect(paragraphAtTop(doc(PLACE_LINE_PX + 1), PLACE_LINE_PX)).not.toBeNull();
  });
});

describe("atEdge", () => {
  it("is true within a pixel of either end, false between", () => {
    expect(EDGE_PX).toBe(1);
    const at = (scrollY: number) => atEdge({ scrollY, viewportHeight: 700, scrollHeight: 10000 });
    expect([at(0), at(0.9), at(1), at(5000), at(9298), at(9299), at(9300)]).toEqual([true, true, false, false, false, true, true]);
  });
});

describe("shiftToKeep — how far the page has to move", () => {
  it("puts the same fraction of the paragraph above the line: a paragraph twice as tall, twice as much above", () => {
    const held = { id: "paper-section-2-p4", fraction: 0.25, gap: 0 };
    // Now 1000 px tall and starting at -100: 156 of it is above the line; it should be 250. The page has to scroll on by 94.
    expect(shiftToKeep(held, { top: -100, height: 1000 })).toBeCloseTo(94, 6);
    // Where it already is, nothing.
    expect(shiftToKeep(held, { top: LINE - 250, height: 1000 })).toBe(0);
  });

  it("keeps the gap of a paragraph that began below the line", () => {
    const held = { id: "paper-section-2-p5", fraction: 0, gap: 24 };
    expect(shiftToKeep(held, { top: 300, height: 90 })).toBe(300 - (LINE + 24));
    expect(shiftToKeep(held, { top: LINE + 24, height: 90 })).toBe(0);
  });

  it("makes no correction smaller than a pixel", () => {
    expect(MIN_SHIFT_PX).toBe(1);
    const held = { id: "paper-section-2-p4", fraction: 0.5, gap: 0 };
    expect(shiftToKeep(held, { top: LINE - 100 + 0.9, height: 200 })).toBe(0);
    expect(shiftToKeep(held, { top: LINE - 100 + 1, height: 200 })).toBe(1);
  });
});

describe("layoutKey — what makes a re-flow", () => {
  it("changes with the column's width (to a tenth of a pixel), the reading scale and Fit's zoom — and with nothing else", () => {
    const base = layoutKey(552, "1", "1");
    expect(layoutKey(552.04, "1", "1")).toBe(base);
    expect(layoutKey(552, " 1 ", "1")).toBe(base);
    expect(layoutKey(551.9, "1", "1")).not.toBe(base);
    expect(layoutKey(552, "1.1", "1")).not.toBe(base);
    expect(layoutKey(552, "1", "1.33")).not.toBe(base);
  });
});

describe("keepPlace — the paragraph at the top stays at the top", () => {
  const WIDTHS: Array<[string, number]> = [
    ["a left drag of +60 (552 to 492)", 492],
    ["a left drag of -60 (552 to 612)", 612],
    ["a margin drag of -80 (552 to 472)", 472],
    ["the pane's least width (552 to 632)", 632],
    ["the keys' End (552 to 416)", 416],
    ["a collapse (552 to 646)", 646],
  ];

  it.each(WIDTHS)("%s: the same paragraph, the same line, to within a pixel — at three places in each of 56 paragraphs", (_name, width) => {
    for (const [index, spec] of paragraphs().entries()) {
      if (index > 55) continue; // the last few are at the page's foot, where nothing is kept
      for (const fraction of [0.1, 0.5, 0.9]) {
        const p = page();
        readAt(p, spec.id, fraction);
        const before = p.top()!;
        const stop = keepPlace(envOf(p));
        p.reflow(width);
        p.frame();
        const after = p.top()!;
        expect([spec.id, fraction, after.id]).toEqual([spec.id, fraction, before.id]);
        // The point that was under the line is under it (to the pixel): the line nearest the top is the same line.
        const f = (LINE - before.top) / before.height;
        expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
        stop();
      }
    }
  });

  it("keeps the line nearest the top inside a long paragraph: the same fraction of it, not its first line", () => {
    const long = paragraphs()[24].id;
    const p = page();
    readAt(p, long, 0.5);
    const before = p.top()!;
    expect(before.id).toBe(long);
    expect(before.height).toBeGreaterThan(1500);
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    const after = p.top()!;
    expect(after.id).toBe(long);
    expect(after.height).not.toBe(before.height);
    // Half of it is above the line before; half of it is above the line after.
    expect((LINE - after.top) / after.height).toBeCloseTo(0.5, 2);
  });

  it("keeps the gap of a paragraph that starts below the line", () => {
    const p = page();
    // Put a paragraph's top 10 px below the line, in the space between two (the one above it ends 6 px above the line).
    const id = paragraphs()[20].id;
    p.scroll(p.scrollY + p.box(id).top - (LINE + 10));
    p.frame();
    expect(p.top()!.id).toBe(id);
    const gap = p.top()!.top - LINE;
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    expect(p.top()!.id).toBe(id);
    expect(p.top()!.top - LINE).toBeCloseTo(gap, 6);
  });

  it("keeps the place when Fit's zoom changes the page though the column's own width does not move", () => {
    const p = page();
    readAt(p, "paper-section-4-p3", 0.4);
    const before = p.top()!;
    const f = (LINE - before.top) / before.height;
    keepPlace(envOf(p));
    p.setZoom(1.33);
    p.frame();
    expect(p.top()!.id).toBe(before.id);
    expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
    p.setZoom(1);
    p.frame();
    expect(p.top()!.id).toBe(before.id);
    expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
  });

  it("leaves the page alone at scroll 0: no scroll is made", () => {
    const p = page();
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    p.reflow(612);
    p.frame();
    expect(p.calls).toEqual([]);
    expect(p.scrollY).toBe(0);
  });

  it("leaves the page alone at its foot: no scroll is made, whatever the width does", () => {
    const p = page();
    p.scroll(1e9);
    p.frame();
    const y = p.scrollY;
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    // The page is taller and the reader is no longer at its foot; the browser keeps the offset, and the controller adds nothing.
    expect(p.scrollY).toBe(y);
    p.reflow(632);
    p.frame();
    expect(p.calls).toEqual([]);
    expect(p.scrollY).toBe(Math.min(y, p.scrollHeight - 720));
  });

  it("makes no scroll when the column's height changes but its layout does not (the reading arriving, a block opening)", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    keepPlace(envOf(p));
    p.notify();
    p.notify();
    expect(p.calls).toEqual([]);
  });

  it("ignores the observer's first notice (it fires on observe) and any notice before a re-flow", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    const y = p.scrollY;
    keepPlace(envOf(p));
    p.notify();
    expect(p.scrollY).toBe(y);
  });

  it("scrolls at once and never smoothly: the instant behavior, the reduced-motion reader's own", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    keepPlace(envOf(p, { scrollBy: (dy) => p.win.scrollBy({ top: dy, behavior: "instant" }) }));
    p.reflow(492);
    expect(p.calls.length).toBeGreaterThan(0);
    expect(p.calls.every((call) => call.kind === "scrollBy" && call.behavior === "instant")).toBe(true);
  });

  it("makes the correction in the frame of the re-flow, before the scroll event: the observer's callback is the only caller", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    const before = p.top()!;
    const f = (LINE - before.top) / before.height;
    keepPlace(envOf(p));
    p.reflow(492); // no `frame()` yet: the scroll event of this frame has not been delivered
    expect(p.top()!.id).toBe(before.id);
    expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
  });

  it("follows the reader's own scroll: the next re-flow keeps the place they scrolled to, not the one they left", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    // The reader scrolls on, a screenful and a bit, and the column changes again. P11-54 (rule 4): a change within READER_SCROLL_MS of a scroll of theirs made
    // during the settling is not put back against them, so the column changes a moment after (a press, a grab of the separator takes longer than that).
    readAt(p, "paper-section-5-p2", 0.3);
    p.clock.now += 200;
    const before = p.top()!;
    const f = (LINE - before.top) / before.height;
    p.reflow(612);
    p.frame();
    expect(p.top()!.id).toBe(before.id);
    expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
  });

  it("does not read the place again at its own correction's scroll event: a drag's corrections all go back to the one place", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    const reads = vi.fn();
    const env = envOf(p);
    keepPlace({ ...env, view: () => (reads(), env.view()) });
    const afterStart = reads.mock.calls.length;
    p.reflow(520);
    p.frame(); // the correction's scroll event
    expect(reads.mock.calls.length).toBe(afterStart);
    // The reader's own scroll is read.
    p.scroll(p.scrollY + 400);
    p.frame();
    expect(reads.mock.calls.length).toBe(afterStart + 1);
  });

  it("holds through a drag of 60 frames: the point under the line is never a pixel from where it began, and ends where it began", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.37);
    const before = p.top()!;
    const f = (LINE - before.top) / before.height;
    keepPlace(envOf(p));
    let farthest = 0;
    let step = 0;
    let last = p.drift(before.id, f);
    for (let frame = 1; frame <= 60; frame++) {
      p.reflow(552 - frame * 1.3);
      farthest = Math.max(farthest, Math.abs(p.drift(before.id, f)));
      step = Math.max(step, Math.abs(p.drift(before.id, f) - last));
      last = p.drift(before.id, f);
      p.frame();
    }
    expect(farthest).toBeLessThan(1);
    expect(step).toBeLessThan(2);
    for (let frame = 59; frame >= 0; frame--) {
      p.reflow(552 - frame * 1.3);
      p.frame();
    }
    expect(p.top()!.id).toBe(before.id);
    expect(Math.abs(p.drift(before.id, f))).toBeLessThanOrEqual(1);
  });

  it("drops a paragraph that is no longer on the page without failing or scrolling", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    keepPlace(envOf(p, { paragraph: () => null }));
    p.reflow(492);
    expect(p.calls).toEqual([]);
  });

  it("stops listening when it is stopped: no scroll listener, no observer, no correction", () => {
    const p = page();
    readAt(p, "paper-section-3-p4", 0.5);
    const stop = keepPlace(envOf(p));
    expect(p.scrollListeners()).toBe(1);
    expect(p.observed().length).toBe(1);
    stop();
    expect(p.scrollListeners()).toBe(0);
    expect(p.observed().length).toBe(0);
    p.reflow(492);
    expect(p.calls).toEqual([]);
  });

  it("holds the place through the page's settling: for a moment after a re-flow a height that goes on changing is put right (Fit's and the text steps' 0.3 s transition)", () => {
    expect(SETTLE_MS).toBeGreaterThan(350);
    const p = page();
    readAt(p, "paper-section-5-p2", 0.5);
    const before = p.top()!;
    const f = (LINE - before.top) / before.height;
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    // The next frames of the transition: the layout key is the one it was, the content above grows a little each frame.
    for (let frame = 0; frame < 6; frame++) {
      p.clock.now += 50;
      p.growAbove(9);
      p.frame();
      expect(p.top()!.id).toBe(before.id);
      expect(Math.abs(p.drift(before.id, f))).toBeLessThan(1);
    }
  });

  it("lets the browser have a height that changes after the page has settled: no scroll for the reading arriving a second later", () => {
    const p = page();
    readAt(p, "paper-section-5-p2", 0.5);
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    const made = p.calls.length;
    p.clock.now += SETTLE_MS;
    p.growAbove(300);
    p.frame();
    expect(p.calls.length).toBe(made);
  });

  it("ends the hold at the reader's own scroll: what they scrolled to is the place, and a growth after it is not put back to the old one", () => {
    const p = page();
    readAt(p, "paper-section-5-p2", 0.5);
    keepPlace(envOf(p));
    p.reflow(492);
    p.frame();
    readAt(p, "paper-section-3-p1", 0.5);
    const made = p.calls.length;
    p.clock.now += 50;
    p.growAbove(40);
    p.frame();
    expect(p.calls.length).toBe(made);
  });

  it("names the text column the shell draws: [data-reader-centre-inner]", () => {
    expect(COLUMN_SELECTOR).toBe("[data-reader-centre-inner]");
  });
});
