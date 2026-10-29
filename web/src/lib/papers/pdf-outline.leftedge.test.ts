import { describe, expect, it } from "vitest";
import { joinProse, type PdfLine } from "./pdf-outline";

// C P12-76 (M8; B P12-73): `joinProse` reads a line as an indent when it stands more than six points right of the left edge, and that edge
// is the page's own, not the section's. A page set at another origin (its text starts at x = -26 where the others' start at 40) is more than
// the tenth of the lines that sets the section's quantile, so, taken over the whole section, every line of every normal page read as an indent
// and began a paragraph of its own. Every text is invented ("a survey of shore snails"): no sentence of any paper, no owner's PDF.

/** A line of the section: `x` the page's origin, `indent` how far a paragraph's first line is set in. */
function at(page: number, y: number, x: number, text: string): PdfLine {
  return { page, text, x, y, size: 10, font: "body" };
}

/** Three pages: the first and the last at origin 40 (a paragraph's first line at 52), the middle one at origin -26 (at -14). */
function threePages(middleOrigin = -26): PdfLine[] {
  const m = middleOrigin;
  return [
    at(1, 700, 52, "Snails on the exposed shore were counted at low tide on twelve"),
    at(1, 688, 40, "mornings in spring, and each count was repeated by a second"),
    at(1, 676, 40, "observer who had not seen the first tally."),
    at(1, 664, 52, "Crabs were weighed after each count and returned to the pool"),
    at(1, 652, 40, "they came from, with the date written on the tag and the"),
    at(2, 700, m, "tide, so that no pool was visited twice in one hour."),
    at(2, 688, m + 12, "Limpets were scored by size class and the scores were summed"),
    at(2, 676, m, "for each rock face before the tide came back over the shelf."),
    at(2, 664, m + 12, "The shelf was surveyed again in autumn with the same crew"),
    at(2, 652, m, "and the same quadrats, and no pool was dropped between visits."),
    at(3, 700, 52, "Barnacle cover was read from photographs taken straight down at each"),
    at(3, 688, 40, "quadrat, and the cover was scored by two readers working apart."),
    at(3, 676, 52, "Where the readers differed by more than ten points the quadrat was read again."),
    at(3, 664, 40, "Their scores are in the supplementary table."),
  ];
}

const WHOLE = [
  "Snails on the exposed shore were counted at low tide on twelve mornings in spring, and each count was repeated by a second observer who had not seen the first tally.",
  "Crabs were weighed after each count and returned to the pool they came from, with the date written on the tag and the tide, so that no pool was visited twice in one hour.",
  "Limpets were scored by size class and the scores were summed for each rock face before the tide came back over the shelf.",
  "The shelf was surveyed again in autumn with the same crew and the same quadrats, and no pool was dropped between visits.",
  "Barnacle cover was read from photographs taken straight down at each quadrat, and the cover was scored by two readers working apart.",
  "Where the readers differed by more than ten points the quadrat was read again. Their scores are in the supplementary table.",
];

describe("joinProse - the left edge is each page's own, not the section's (C P12-76, M8)", () => {
  it("(a) a page set at x = -26 does not make every line of the other pages an indent: the paragraphs are whole", () => {
    // The last paragraph is two sentences: the line "Their scores..." stands at the page's own edge and goes on.
    expect(joinProse(threePages()).split("\n\n")).toEqual(WHOLE);
  });

  it("keeps an indent on the odd page itself: its own paragraph starts are still read", () => {
    // On the page at origin -26 the lines at -14 are indents, and they begin "Limpets..." and "The shelf...".
    const paragraphs = joinProse(threePages()).split("\n\n");
    expect(paragraphs).toHaveLength(6);
    expect(paragraphs[2].startsWith("Limpets")).toBe(true);
    expect(paragraphs[3].startsWith("The shelf")).toBe(true);
  });

  it("reads the mirror case the same way: one page at a larger origin does not make its own lines indents", () => {
    // Pages 1 and 3 at origin 40, page 2 at origin 90 (and its indents at 102): before, the edge was 40 and every line of page 2 broke.
    const paragraphs = joinProse(threePages(90)).split("\n\n");
    expect(paragraphs).toEqual(WHOLE);
  });

  it("gives the same paragraphs for pages at one origin as before (the edge of the page is the edge of the section)", () => {
    expect(joinProse(threePages(40)).split("\n\n")).toEqual(WHOLE);
  });

  it("still breaks a paragraph at a gap on the odd page, as it always did", () => {
    // A gap of 32 where the pitch is 12 (more than 1.6 pitches, less than a float's three) before "for each rock face": a new paragraph there.
    const gapped = threePages().map((l) => (l.page === 2 && l.y <= 676 ? { ...l, y: l.y - 20 } : l));
    const paragraphs = joinProse(gapped).split("\n\n");
    expect(paragraphs).toHaveLength(7);
    expect(paragraphs[2]).toBe("Limpets were scored by size class and the scores were summed");
    expect(paragraphs[3].startsWith("for each rock face")).toBe(true);
  });
});
