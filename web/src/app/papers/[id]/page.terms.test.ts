import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-01 (ruling §1h.1; brief item 4): the page's wiring of "Terms to know".
// `Reader` cannot be mounted in this Node-only suite, so — as the upload-skip
// and the P2-05 / P2-09 wiring tests do — this reads the page's source and
// holds each join to its shape: the terms come from the reading the page holds
// through the route's own read and background sections, the model's `terms`
// merge in after them, the strip stands in the panel (the map in the additions), and the body is handed
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

  // P7-13 (R11b): the scope is kept as the string of its section ids (`termScopeKey`), so the scan
  // does not re-run for a route that reads the same sections; the pins are the same two joins, as written now.
  has("const scopeKey = useMemo(() => termScopeKey(routeTermScope(route)), [route]);", "the terms' scope is no longer the merged route's (`routeTermScope(route)`)");
  has("paperDefinedTermsInReading(reading, termScopeOfKey(scopeKey))", "Tier 0 terms no longer come from the reading through the route's scope");
  has("mergeTerms(tier0Terms, report?.terms)", "the model's terms no longer merge in after the Tier 0 ones");
  has("firstOccurrence(reading.body ?? [], markedTerm)", "the clicked term's first use is no longer looked up in the body");
  // P3-02 (§1h.2): the body also reports the reader's selection (`onSelect`),
  // so the line carries one more prop; the term's first use is handed as before.
  // P4-01 (§1h.12 (h)): and "Say it plainly" is handed to it through `plain={plainForBody}`,
  // between the term's mark and the selection — the same pin, the line as it now reads.
  has("<PaperBody reading={reading} route={route} termMark={termMark} plain={plainForBody} onSelect={selectExplain} />", "the body is no longer handed the clicked term's first use");

  // P7-14 (R5, R10): the strip stands in the panel, in the layout's own `terms` slot — under the
  // decision block's tab strip and before the column's common blocks, so it is there under BOTH
  // tabs — and the map is the first thing of Paper digestion, in the additions (it was under the
  // question field in the `ask` slot, which is gone). The page's order of the two is the layout's.
  const slot = text.indexOf("terms={ hasBody ?");
  const common = text.indexOf("common={");
  const additions = text.indexOf("additions={");
  const map = text.indexOf("<ReadingMapView");
  const strip = text.indexOf("<TermsStrip");
  if (map < 0 || strip < 0) problems.push("the map or the strip is no longer mounted");
  else {
    if (!(slot >= 0 && slot < strip && strip < common)) problems.push("the strip no longer stands in the panel's terms slot, under both tabs");
    if (!(additions >= 0 && additions < map)) problems.push("the map is no longer in the additions, under Paper digestion");
  }
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

  it("would notice the strip moved into the additions, under one tab only", () => {
    const stripLine = /\s*<TermsStrip [^>]*\/>\n/.exec(source)![0];
    const moved = source.replace(stripLine, "\n").replace("{reading.map && <ReadingMapView", `${stripLine.trim()}\n{reading.map && <ReadingMapView`);

    expect(moved).not.toBe(source);
    expect(termsProblems(moved)).toEqual(["the strip no longer stands in the panel's terms slot, under both tabs"]);
  });

  it("would notice the map moved out of the additions, back into the panel", () => {
    const mapLine = /\s*\{reading\.map && <ReadingMapView [^\n]*\n/.exec(source)![0];
    const moved = source.replace(mapLine, "\n").replace("terms={\n", `terms={\n${mapLine.trim()}\n`);

    expect(moved).not.toBe(source);
    expect(termsProblems(moved)).toContain("the map is no longer in the additions, under Paper digestion");
  });

  it("would notice the body no longer handed the term's first use", () => {
    // P3-02: with `onSelect` after it, the prop to remove is `termMark` alone. P4-01: `plain` now
    // stands between them, so it is " termMark={termMark}" that goes.
    expect(termsProblems(source.replace(" termMark={termMark} plain={plainForBody} onSelect={selectExplain} />", " plain={plainForBody} onSelect={selectExplain} />"))).toEqual([
      "the body is no longer handed the clicked term's first use",
    ]);
  });

  it("would notice the scope widened past the route's read and background sections", () => {
    const widened = source.replace("paperDefinedTermsInReading(reading, termScopeOfKey(scopeKey))", "paperDefinedTermsInReading(reading)");

    expect(termsProblems(widened)).toEqual(["Tier 0 terms no longer come from the reading through the route's scope"]);
  });
});
