import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

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

  it("still hands the proposal block the bound figure, and each result its own", () => {
    expect(page.includes("takeBound(report.whatItProposes.figureImageUrl, report.whatItProposes.figureCaption)")).toBe(true);
    expect(page.includes("figure={proposalFigure}")).toBe(true);
    expect(page.includes("keyResults.map((r) => takeBound(r.figureImageUrl, r.figureCaption))")).toBe(true);
    expect(page.includes("figures={resultFigures}")).toBe(true);
  });
});
