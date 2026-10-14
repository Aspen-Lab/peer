import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-01 (ruling §1h.1; brief item 4): the page's wiring of the paper's own defined terms. (P10-02, ruling §1h.78:
// "Terms to know", the strip that listed them, is deleted; the terms still feed the Tier 0 definition in "Explain this".)
// `Reader` cannot be mounted in this Node-only suite, so — as the upload-skip
// and the P2-05 / P2-09 wiring tests do — this reads the page's source and
// holds each join to its shape: the terms come from the reading the page holds
// through the route's own read and background sections, the model's `terms`
// merge in after them, and the explain box is handed the result. The checker is also run on
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
  // P3-02 (§1h.2): the body also reports the reader's selection (`onSelect`); P4-01: "Say it plainly" is handed
  // to it through `plain={plainForBody}`. P10-02 (ruling §1h.78): the term the reader clicked in "Terms to know"
  // is gone with the strip, and the body is handed no `termMark`.
  has("<PaperBody reading={reading} route={route} plain={plainForBody} onSelect={selectExplain} noteAnchors={noteAnchors} />", "the body is no longer handed its props as the page gives them");
  if (/termMark|markedTerm|markTerm|clickedTerm/.test(text)) problems.push("the page still keeps a clicked term for the body to mark");

  // P10-02: "Terms to know" is deleted. Nothing on the page mounts the strip or hands the layout a `terms` slot;
  // the merged terms still go where the paper's own definitions are used — the explain box (Tier 0) — and the
  // plate keeps its own `plateTerms`.
  if (text.includes("TermsStrip") || text.includes("terms-strip")) problems.push("the Terms to know strip is back on the page");
  if (/ terms=\{ ?hasBody/.test(text)) problems.push("the layout is handed a `terms` slot again");
  if (!/<ExplainBox [^>]*terms=\{terms\}/.test(text)) problems.push("the explain box is no longer handed the merged terms (the Tier 0 definition)");

  // P10-04 (review 3.1): the map is in the layout's own `map` slot — under the strip, under both tabs — not in
  // the additions; the page mounts it exactly once.
  const mapSlot = text.indexOf("map={hasBody && reading.map ?");
  const mapMount = text.indexOf("<ReadingMapView");
  const additions = text.indexOf("additions={");
  if (mapMount < 0) problems.push("the map is no longer mounted");
  else if (!(mapSlot >= 0 && mapSlot < mapMount && mapMount < additions)) problems.push("the map is no longer in the layout's map slot, under the strip, under both tabs");
  if (text.split("<ReadingMapView").length - 1 !== 1) problems.push("the map is not mounted exactly once");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's defined-terms wiring (P3-01; P10-02: no strip)", () => {
  it("is as the ruling says", () => {
    expect(termsProblems(source)).toEqual([]);
  });

  it("would notice the model's terms dropped from the merge", () => {
    expect(termsProblems(source.replace("mergeTerms(tier0Terms, report?.terms)", "mergeTerms(tier0Terms, undefined)"))).toEqual([
      "the model's terms no longer merge in after the Tier 0 ones",
    ]);
  });

  it("would notice the strip mounted again", () => {
    const back = source.replace("<ExplainBox ", "<TermsStrip terms={terms} /><ExplainBox ");

    expect(back).not.toBe(source);
    expect(termsProblems(back)).toEqual(["the Terms to know strip is back on the page"]);
  });

  it("would notice a clicked term kept for the body again", () => {
    expect(termsProblems(source.replace("plain={plainForBody} onSelect", "termMark={termMark} plain={plainForBody} onSelect"))).toEqual(
      expect.arrayContaining(["the page still keeps a clicked term for the body to mark"]),
    );
  });

  it("would notice the map moved back into the additions, under one tab only", () => {
    const mapLine = /\s*map=\{hasBody && reading\.map \? <ReadingMapView [^\n]*\n/.exec(source)![0];
    const moved = source.replace(mapLine, "\n").replace("<PaperBody reading={reading}", `{reading.map && <ReadingMapView map={reading.map} />}\n<PaperBody reading={reading}`);

    expect(moved).not.toBe(source);
    expect(termsProblems(moved)).toContain("the map is no longer in the layout's map slot, under the strip, under both tabs");
  });

  it("would notice the explain box no longer handed the merged terms", () => {
    const cut = source.replace(" terms={terms} canAsk=", " canAsk=");

    expect(cut).not.toBe(source);
    expect(termsProblems(cut)).toEqual(["the explain box is no longer handed the merged terms (the Tier 0 definition)"]);
  });

  it("would notice the scope widened past the route's read and background sections", () => {
    const widened = source.replace("paperDefinedTermsInReading(reading, termScopeOfKey(scopeKey))", "paperDefinedTermsInReading(reading)");

    expect(termsProblems(widened)).toEqual(["Tier 0 terms no longer come from the reading through the route's scope"]);
  });
});
