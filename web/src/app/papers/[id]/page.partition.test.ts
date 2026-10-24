import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P10-07b (B P10-05 §3.1, §4; ruling §1h.79 (c)): the page's wiring of the partition. `Reader`
// cannot be mounted in this Node-only suite, so — as the paragraph-guide wiring test does — this
// reads the page's source and holds each join to its shape: the map is handed the partition's
// overlay (memoised on the reading and the partition), the route the map AND the
// body read has the group marks folded in (so the two never disagree on a paragraph), the fold runs
// after the guide hook has answered (the partition is a `const` of that call), the earlier merged
// route is what the terms scope reads, and the line P10-07a left (`void paragraphPartition;`) is gone.
// The checker is also run on mutated copies of the source, so the test proves it would notice what
// it guards: green on the page, red on each.

function partitionProblems(raw: string): string[] {
  const text = raw.replace(/\s+/g, " ");
  const problems: string[] = [];
  const at = (needle: string) => text.indexOf(needle);

  if (!/import \{[^}]*\bpartitionedMap\b[^}]*\bwithPartitionMarks\b[^}]*\} from "@\/lib\/papers\/reading-partition";/.test(text)) problems.push("the page no longer imports partitionedMap and withPartitionMarks");
  if (text.includes("void paragraphPartition;")) problems.push("the partition is still read into nothing");

  const hook = at("= useParagraphGuide({");
  const shown = at("const shownMap = useMemo(");
  const route = at("const route = useMemo(");
  const merged = at("const mergedRoute = useMemo(");
  if (shown < 0 || !/const shownMap = useMemo\( ?\(\) => \(?reading\?\.map \? partitionedMap\(reading\.map, reading\.body, paragraphPartition\) : undefined\)?, \[reading, paragraphPartition\],? ?\);/.test(text))
    problems.push("the map's overlay is not `partitionedMap(reading.map, reading.body, paragraphPartition)`, memoised on the reading and the partition");
  if (shown >= 0 && hook >= 0 && shown < hook) problems.push("the overlay is made before the partition is known");

  if (merged < 0 || !/const mergedRoute = useMemo\( ?\(\) => mergeQuestionRoute\(tier0Route, questionRouteOverlay\(report\?\.forYourQuestions\)\), \[tier0Route, report\?\.forYourQuestions\],? ?\);/.test(text))
    problems.push("the merged route (Tier 0 and the model's overlay) is no longer its own memo");
  if (route < 0 || !/const route = useMemo\( ?\(\) => withPartitionMarks\(mergedRoute, reading\?\.map, reading\?\.body, paragraphPartition\), \[mergedRoute, reading\?\.map, reading\?\.body, paragraphPartition\],? ?\);/.test(text))
    problems.push("the route is not the merged route with the group marks folded in, memoised on the merged route, the map, the body and the partition");
  if (route >= 0 && hook >= 0 && route < hook) problems.push("the fold is made before the partition is known");
  if (!text.includes("termScopeKey(routeTermScope(mergedRoute))")) problems.push("the terms scope no longer reads the merged route");

  const map = /<ReadingMapView [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!map.includes("map={shownMap}") || !map.includes("route={route}")) problems.push("the map is not handed the overlay and the folded route");
  if (!/hasBody && shownMap \?/.test(text)) problems.push("the map is no longer mounted only where there is a body and a map");
  // Re-aimed (P11-17b, rule 2): the tag now carries an arrow function (`onHighlightClick`), whose `=>` ends a `[^>]*`; it ends at the first `/>`.
  const body = /<PaperBody [\s\S]*?\/>/.exec(text)?.[0] ?? "";
  if (!body.includes("reading={reading}") || !body.includes("route={route}")) problems.push("the body no longer reads the one route");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's partition wiring (P10-07b)", () => {
  it("is as the brief says", () => {
    expect(partitionProblems(source)).toEqual([]);
  });

  it("would notice the overlay not made, or handed the unpartitioned map", () => {
    expect(partitionProblems(source.replace("map={shownMap}", "map={reading.map}"))).toContain("the map is not handed the overlay and the folded route");
    expect(partitionProblems(source.replace("partitionedMap(reading.map, reading.body, paragraphPartition)", "reading.map"))).toContain(
      "the map's overlay is not `partitionedMap(reading.map, reading.body, paragraphPartition)`, memoised on the reading and the partition",
    );
  });

  it("would notice the overlay's memo left without the partition among its keys", () => {
    expect(partitionProblems(source.replace("[reading, paragraphPartition],\n  );\n  const route", "[reading],\n  );\n  const route"))).not.toEqual([]);
  });

  it("would notice the group marks not folded into the route", () => {
    expect(partitionProblems(source.replace("withPartitionMarks(mergedRoute, reading?.map, reading?.body, paragraphPartition)", "mergedRoute"))).toContain(
      "the route is not the merged route with the group marks folded in, memoised on the merged route, the map, the body and the partition",
    );
  });

  it("would notice the body reading another route than the map", () => {
    expect(partitionProblems(source.replace("<PaperBody reading={reading} route={route}", "<PaperBody reading={reading} route={mergedRoute}"))).toContain("the body no longer reads the one route");
  });

  it("would notice the partition read into nothing again", () => {
    expect(partitionProblems(source.replace("const shownMap = useMemo(", "void paragraphPartition;\n  const shownMap = useMemo("))).toContain("the partition is still read into nothing");
  });

  it("would notice the overlay or the fold moved above the hook that answers with the partition", () => {
    const hookCall = /\n {2}const \{ gists: paragraphGists, partition: paragraphPartition \} = useParagraphGuide\(\{[^}]*\}\);\n/.exec(source)![0];
    const moved = source.replace(hookCall, "\n").replace("  const projectText = useMemo(", `${hookCall}  const projectText = useMemo(`);

    expect(partitionProblems(moved)).toEqual(expect.arrayContaining(["the overlay is made before the partition is known"]));
  });
});
