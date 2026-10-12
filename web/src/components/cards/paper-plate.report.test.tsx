import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { isSameFigure } from "./paper-plate";

// P9-55 (P9-W3's N6, the keyed first visit): the report's arrival must not move the title.
//
// With a key and no cached report the lead plate held its box from the first paint (P9-49), but the report
// landed 2.2-2.7 s later with a bound figure, the page swapped that figure into the plate, and its caption
// (three lines at 1440 and 390) pushed the title and the decision block down +68.8 px (1440) / +68.7 px (390).
// Holding the caption's lines too would leave a gap under every plate whose figure has no caption. So the plate
// is not the report's to change: it is the figure route's answer for this paper — the picture the briefing's
// tile had, the same with a key and without one — and the report's bound figure is drawn where the report
// draws its sections (the proposal block), once, not swapped into the plate.
//
// The reading page is too large to render here (its own test files say so); what makes the plate independent of
// the report is a few lines of the page, pinned as the neighbouring tests pin theirs.

const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
const from = (start: string, end: string): string => {
  const at = page.indexOf(start);
  expect(at, `the page has ${start}`).toBeGreaterThan(-1);
  return page.slice(at, page.indexOf(end, at));
};

describe("the lead plate is not the report's to change (P9-55)", () => {
  it("is mounted without the report's figure: nothing is handed in that could swap the picture", () => {
    const mount = from("<PaperPlate", "/>");
    expect(mount).not.toMatch(/\bfigure=/);
    expect(mount).toContain("lead");
  });

  it("is held, drawn and captioned from the figure route's answer alone", () => {
    expect(from("const leadPending =", ";")).not.toContain("boundFigure");
    expect(from("const hasPlate =", ";")).not.toContain("boundFigure");
    expect(from("const caption = ", ");")).not.toContain("boundFigure");
    expect(from("const plateIsFigure =", ";")).not.toContain("boundFigure");
  });

  it("has no report figure of its own to hand the plate: the report's figures are drawn by its sections", () => {
    // A boolean, not `expect(page)`: a failure would print the whole page.
    expect(page.includes("boundFigure")).toBe(false);
  });
});

describe("the report's bound figure is drawn where the report draws its sections, once (no picture is lost)", () => {
  it("seeds the set of pictures already shown with the plate's own picture, not with the bound one", () => {
    expect(from("const boundShown =", ";")).toBe("const boundShown = new Set<string>(plateImage ? [plateImage] : [])");
  });

  it("stands a bound figure down only for the picture the plate already draws", () => {
    const take = from("const takeBound =", "};");
    expect(take).toContain("isSameFigure({ imageUrl: plateImage, caption: resolvedFigure.caption }, { imageUrl: url, caption })");
  });

  it("still hands the proposal block the bound figure, and each result its own", () => {
    expect(page.includes("takeBound(report.whatItProposes.figureImageUrl, report.whatItProposes.figureCaption)")).toBe(true);
    expect(page.includes("figure={proposalFigure}")).toBe(true);
    expect(page.includes("keyResults.map((r) => takeBound(r.figureImageUrl, r.figureCaption))")).toBe(true);
    expect(page.includes("figures={resultFigures}")).toBe(true);
  });
});

// A bound figure is drawn once, at the first place the page has it. The plate is the first, but it is the route's
// picture now, so the section stands down for a bound figure only where it IS that picture.
describe("isSameFigure — a bound figure the plate already draws is not drawn again (no picture is lost either way)", () => {
  const HTML = "https://arxiv.org/html/2607.00001v1/x1.png";
  const DATA = "data:image/png;base64,AAAA";
  const ROUTE = "/api/papers/upload%3A0123456789abcdef/figure-image?page=4&fig=4";
  const CAPTION = "Figure 4. A profile of the crust on a sun-facing wall section at the middle height of the wall.";

  it("is the same figure when the URL is the same (an HTML source's own picture)", () => {
    expect(isSameFigure({ imageUrl: HTML, caption: null }, { imageUrl: HTML, caption: "Figure 1." })).toBe(true);
  });

  it("is the same figure for a PDF when the caption is: the route's data: URL and the binder's route URL name one region", () => {
    expect(isSameFigure({ imageUrl: DATA, caption: CAPTION }, { imageUrl: ROUTE, caption: CAPTION })).toBe(true);
    // white space and case are the extractor's, not the figure's
    expect(isSameFigure({ imageUrl: DATA, caption: CAPTION }, { imageUrl: ROUTE, caption: ` ${CAPTION.toUpperCase().replace(/ /g, "  ")}\n` })).toBe(true);
  });

  it("is a different figure when the captions differ: both are drawn, the plate's and the section's", () => {
    expect(isSameFigure({ imageUrl: DATA, caption: "Figure 1. Crust cover by height." }, { imageUrl: ROUTE, caption: CAPTION })).toBe(false);
  });

  it("is never the same when either side has no caption to say so, or the plate has no picture", () => {
    expect(isSameFigure({ imageUrl: DATA, caption: null }, { imageUrl: ROUTE, caption: null })).toBe(false);
    expect(isSameFigure({ imageUrl: DATA, caption: "   " }, { imageUrl: ROUTE, caption: "" })).toBe(false);
    expect(isSameFigure({ imageUrl: DATA, caption: CAPTION }, { imageUrl: ROUTE, caption: null })).toBe(false);
    expect(isSameFigure({ imageUrl: null, caption: CAPTION }, { imageUrl: ROUTE, caption: CAPTION })).toBe(false);
    expect(isSameFigure(null, { imageUrl: ROUTE, caption: CAPTION })).toBe(false);
    expect(isSameFigure({ imageUrl: DATA, caption: CAPTION }, { imageUrl: null, caption: CAPTION })).toBe(false);
    expect(isSameFigure({ imageUrl: DATA, caption: CAPTION }, undefined)).toBe(false);
  });
});
