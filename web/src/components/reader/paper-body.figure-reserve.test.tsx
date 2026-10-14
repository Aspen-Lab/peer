import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { figureMatClass } from "./paper-body";

// P10-19 (X-A7, BACKLOG-78): the paper's figures are lazy pictures with no height until they arrive. Ten of them
// above a heading are 5,000 px the page does not know of when a map row's jump is aimed. A figure whose picture has
// not arrived keeps the room a picture of the largest height (32rem) will take; the first paint is as it was.

describe("a figure's mat keeps the room of its picture until the picture arrives (P10-19)", () => {
  it("the first paint is the mat as it was", () => {
    expect(figureMatClass(false)).toBe("bg-[var(--plate-mat)] p-3 sm:p-4");
  });

  it("a picture that has not arrived: the mat is as tall as its largest picture, padding included", () => {
    const pending = figureMatClass(true);
    expect(pending).toContain("bg-[var(--plate-mat)] p-3 sm:p-4");
    expect(pending).toContain("min-h-[calc(32rem+1.5rem)]");
    expect(pending).toContain("sm:min-h-[calc(32rem+2rem)]");
  });

  it("the figure asks for it only while its picture is on the way, and drops it on load", () => {
    const source = readFileSync(new URL("./paper-body.tsx", import.meta.url), "utf8");
    const figure = source.slice(source.indexOf("function Figure("), source.indexOf("function NotedText("));
    expect(figure).toMatch(/figureMatClass\(waiting\)/);
    expect(figure).toMatch(/onLoad=\{\(\) => setWaiting\(false\)\}/);
    expect(figure).toMatch(/onError=\{\(\) => setFailed\(true\)\}/);
    expect(figure).toMatch(/\.complete/);
  });
});
