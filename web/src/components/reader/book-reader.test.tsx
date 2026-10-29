import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { BookReader, bookPageMetrics } from "./book-reader";

describe("book reading", () => {
  it("counts and clamps complete spreads, including the final partial spread", () => {
    expect(bookPageMetrics(1000, 1000, 0)).toEqual({ page: 1, pages: 1 });
    expect(bookPageMetrics(1000, 2064, 1064)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(1000, 1564, 564)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(500, 1020, 520, 20)).toEqual({ page: 2, pages: 2 });
    expect(bookPageMetrics(0, 0, 0)).toEqual({ page: 1, pages: 1 });
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
});
