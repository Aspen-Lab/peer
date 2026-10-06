import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-01 (ruling §1h.1; brief item 4): the page's wiring of "Terms to know".
// `Reader` cannot be mounted in this Node-only suite, so — as the upload-skip
// and the P2-05 / P2-09 wiring tests do — this reads the page's source and
// holds each join to its shape: the terms come from the reading the page holds
// through the route's own read and background sections, the model's `terms`
// merge in after them, the strip stands under the map, and the body is handed
// the first use of the term the reader clicked. The checker is also run on
// mutated copies of the source, so the test proves it would notice what it
// guards: green on the page, red on each.

/** What is wrong with the terms wiring of a page `source`; empty when it is right. */
function termsProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];
  const has = (needle: string, why: string) => {
    if (!text.includes(needle)) problems.push(why);
  };

  has("const termScope = useMemo(() => routeTermScope(route), [route]);", "the terms' scope is no longer the merged route's (`routeTermScope(route)`)");
  has("paperDefinedTermsInReading(reading, termScope)", "Tier 0 terms no longer come from the reading through the route's scope");
  has("mergeTerms(tier0Terms, report?.terms)", "the model's terms no longer merge in after the Tier 0 ones");
  has("firstOccurrence(reading.body ?? [], markedTerm)", "the clicked term's first use is no longer looked up in the body");
  has("<PaperBody reading={reading} route={route} termMark={termMark} />", "the body is no longer handed the clicked term's first use");

  // The strip stands under the map, inside the `ask` slot, before the words.
  const map = text.indexOf("<ReadingMapView");
  const strip = text.indexOf("<TermsStrip");
  const words = text.indexOf("words={");
  if (map < 0 || strip < 0) problems.push("the map or the strip is no longer mounted");
  else if (!(map < strip && strip < words)) problems.push("the strip no longer stands under the map, inside the ask slot");
  if (text.split("<TermsStrip").length - 1 !== 1) problems.push("the strip is not mounted exactly once");
  if (!/<TermsStrip [^>]*terms=\{terms\}/.test(text)) problems.push("the strip is no longer handed the merged terms");
  if (!/<TermsStrip [^>]*marked=\{markedTerm\} onMark=\{markTerm\}/.test(text)) problems.push("the strip no longer shares the marked term with the page");

  // The clicked term belongs to its paper: it is never carried to another.
  has("clickedTerm?.paperId === paper.id ? clickedTerm.term : null", "the marked term is no longer tied to its paper");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's Terms to know wiring (P3-01)", () => {
  it("is as the ruling says", () => {
    expect(termsProblems(source)).toEqual([]);
  });

  it("would notice the model's terms dropped from the merge", () => {
    expect(termsProblems(source.replace("mergeTerms(tier0Terms, report?.terms)", "mergeTerms(tier0Terms, undefined)"))).toEqual([
      "the model's terms no longer merge in after the Tier 0 ones",
    ]);
  });

  it("would notice the strip mounted above the map", () => {
    const stripLine = /\s*<TermsStrip [^>]*\/>\n/.exec(source)![0];
    const moved = source.replace(stripLine, "\n").replace("{reading.map && <ReadingMapView", `${stripLine.trim()}\n{reading.map && <ReadingMapView`);

    expect(termsProblems(moved)).toEqual(["the strip no longer stands under the map, inside the ask slot"]);
  });

  it("would notice the body no longer handed the term's first use", () => {
    expect(termsProblems(source.replace(" termMark={termMark} />", " />"))).toEqual([
      "the body is no longer handed the clicked term's first use",
    ]);
  });

  it("would notice the scope widened past the route's read and background sections", () => {
    const widened = source.replace("paperDefinedTermsInReading(reading, termScope)", "paperDefinedTermsInReading(reading)");

    expect(termsProblems(widened)).toEqual(["Tier 0 terms no longer come from the reading through the route's scope"]);
  });
});
