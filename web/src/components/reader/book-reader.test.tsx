import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookReader, BookWheelGesture, BookWheelEntry, bookPageMetrics, bookSpreadOffset, bookWheelDelta, bookWheelReady, widgetCanScroll } from "./book-reader";

describe("book reading", () => {
  it("counts and clamps complete spreads, including the final partial spread", () => {
    expect(bookPageMetrics(1000, 1000, 0)).toEqual({ page: 1, pages: 1 });
    expect(bookPageMetrics(1000, 2064, 1064)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(1000, 1564, 564)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(500, 1020, 520, 20)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(0, 0, 0)).toEqual({ page: 1, pages: 1 });
  });

  it("aligns each spread, including a final spread with only one page", () => {
    const width = 1000, gap = 64;
    const { pages } = bookPageMetrics(width, 1564, 0, gap);
    expect(pages).toBe(2);
    expect(bookSpreadOffset(width, gap, 1)).toBe(0);
    expect(bookSpreadOffset(width, gap, pages)).toBe(1064);
    // The spacer gives the last spread a full viewport, even with one page.
    expect(bookSpreadOffset(width, gap, pages) + width).toBe(2064);
  });

  it("offers book view whenever there is a paper, independently of screen width", () => {
    const desktop = renderToStaticMarkup(<BookReader available>Paper content</BookReader>);
    const narrow = renderToStaticMarkup(<BookReader available={false}>Paper content</BookReader>);
    expect(desktop).toContain('data-active="false"');
    expect(desktop).toContain("Book view");
    expect(desktop).toContain("Paper content");
    expect(narrow).not.toContain("Book view");
    expect(narrow).toContain("Paper content");
  });
  it("turns once for a trackpad gesture, not once per momentum event", () => {
    const gesture = new BookWheelGesture();
    expect(gesture.feed(15, 0)).toBe(0);
    expect(gesture.feed(20, 20)).toBe(0);
    expect(gesture.feed(20, 40)).toBe(1);
    expect(gesture.feed(50, 60)).toBe(0);
    expect(gesture.feed(50, 100)).toBe(0);
    expect(gesture.feed(50, 430)).toBe(1); // a new gesture after a pause
  });

  it("can reverse immediately, and never repeats during the same continuous gesture", () => {
    const gesture = new BookWheelGesture();
    expect(gesture.feed(100, 0)).toBe(1);
    expect(gesture.feed(-100, 30)).toBe(-1);
    expect(gesture.feed(-100, 140)).toBe(0);
    expect(gesture.feed(-100, 260)).toBe(0);
    expect(gesture.feed(-100, 390)).toBe(0);
    expect(gesture.feed(-100, 520)).toBe(0);
    expect(gesture.feed(-100, 720)).toBe(-1); // a new gesture after a pause
  });

  it("absorbs the end of a gesture at a book edge, then lets the page scroll", () => {
    const gesture = new BookWheelGesture();
    expect(gesture.feed(100, 0)).toBe(1);
    expect(gesture.holdAtBoundary(15, 30)).toBe(true);
    expect(gesture.holdAtBoundary(10, 80)).toBe(true);
    expect(gesture.holdAtBoundary(10, 230)).toBe(true);
    expect(gesture.holdAtBoundary(10, 380)).toBe(true);
    expect(gesture.holdAtBoundary(10, 530)).toBe(true);
    expect(gesture.holdAtBoundary(10, 680)).toBe(true);
    expect(gesture.holdAtBoundary(20, 900)).toBe(false);
  });

  it("scrolls the document until the book is mostly in view", () => {
    expect(bookWheelReady({ top: 650, bottom: 1150, height: 500 }, 720)).toBe(false);
    expect(bookWheelReady({ top: 120, bottom: 620, height: 500 }, 720)).toBe(true);
    expect(bookWheelReady({ top: -400, bottom: 100, height: 500 }, 720)).toBe(false);
    // A short viewport can still enter the reader even if the page is taller than it.
    expect(bookWheelReady({ top: 0, bottom: 500, height: 500 }, 300)).toBe(true);
  });

  it("finishes the incoming scroll gesture before capturing page turns", () => {
    const entry = new BookWheelEntry();
    expect(entry.isNew(0)).toBe(true);
    expect(entry.allows(false, 0)).toBe(false);
    expect(entry.isNew(80)).toBe(false);
    expect(entry.allows(true, 80)).toBe(false);
    expect(entry.allows(true, 140)).toBe(false);
    expect(entry.allows(true, 350)).toBe(true);
  });

  it("lets a widget consume wheels only where it can scroll on that axis", () => {
    const formula = { scrollWidth: 400, clientWidth: 400, scrollHeight: 24, clientHeight: 24 };
    const style = { overflowX: "auto", overflowY: "hidden" };
    expect(widgetCanScroll("y", style, formula)).toBe(false);
    expect(widgetCanScroll("x", style, formula)).toBe(false);
    expect(widgetCanScroll("x", style, { ...formula, scrollWidth: 600 })).toBe(true);
    expect(widgetCanScroll("y", { overflowX: "auto", overflowY: "auto" }, { ...formula, scrollHeight: 300 })).toBe(true);
  });

  it("normalizes mouse wheels, trackpads and horizontal input", () => {
    expect(bookWheelDelta({ deltaX: 0, deltaY: 3, deltaMode: 1 }, 600)).toBe(48);
    expect(bookWheelDelta({ deltaX: -55, deltaY: 10, deltaMode: 0 }, 600)).toBe(-55);
    expect(bookWheelDelta({ deltaX: 0, deltaY: 1, deltaMode: 2 }, 600)).toBe(600);
  });

});
