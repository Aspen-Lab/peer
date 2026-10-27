import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P12-53 (ruling §1h.428; B P12-42 §8.5): the page's wiring of the model's structure review. `Reader` cannot be
// mounted in this Node-only suite, so — as the paragraph-guide and partition wiring tests do — this reads the page's
// source and holds each join to its shape: the rules' draft is made from the reading's own map and body; the hook
// asks for the paper the page has finished resolving, only where there is a body and a draft, and whenever the
// reader has a model — `providerConfigured`, NOT the deep-report switch (§1h.428 (a)) — with the reader's own key
// as the explain box sends it; it is called before the page's first early return (hook order) and after the
// guide hook; the review is laid over the map right AFTER the partition overlay (`shownMap`), and the view is
// handed that (`reviewedMap`); and without a review the map is the overlay as it was. The checker is also run on
// mutated copies of the source, so the test proves it would notice what it guards: green on the page, red on each.

const GATE = "providerConfigured";
const GATE_PROBLEM = "the hook is not enabled by `providerConfigured` and nothing else";

function reviewProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!text.includes('import { useStructureReview } from "@/components/reader/use-structure-review";')) problems.push("the page no longer imports the hook");
  if (!/import \{ applyStructureReview, structureDraftOf \} from "@\/lib\/papers\/structure-review";/.test(text)) problems.push("the page no longer imports the draft and the overlay");
  if (text.split("useStructureReview({").length - 1 !== 1) problems.push("the hook is not called exactly once");

  const draft = "const structureDraft = useMemo(() => structureDraftOf(reading?.map, reading?.body), [reading?.map, reading?.body]);";
  if (!text.includes(draft)) problems.push("the draft is not made from the reading's own map and body, memoised on both");

  const call = /const structureReview = useStructureReview\(\{[^}]*\}\);/.exec(text)?.[0] ?? "";
  if (!call) problems.push("the page no longer names the hook's answer `structureReview`");
  else {
    if (!call.includes("paper: ready ? paper : undefined")) problems.push("the hook is asked about a paper whose private attachment is not yet resolved");
    if (!call.includes("hasBody,")) problems.push("the hook is no longer told whether the reading has a body");
    if (!call.includes("draftDigest: structureDraft?.digest,")) problems.push("the hook is no longer told the digest of the draft it is to review");
    if (/enabled: (.*?), llmOverride:/.exec(call)?.[1] !== GATE) problems.push(GATE_PROBLEM);
    if (!call.includes("llmOverride: explainLlmOverride(profile)")) problems.push("the reader's own key no longer travels as the explain box sends it");
  }

  const overlay = "const reviewedMap = useMemo( () => (shownMap && structureDraft ? applyStructureReview(shownMap, structureDraft, structureReview) : shownMap), [shownMap, structureDraft, structureReview], );";
  if (!text.includes(overlay)) problems.push("the review is not laid over the partition's overlay (`shownMap`), memoised on the overlay, the draft and the review");

  // Order: the guide hook, the partition overlay, the route fold; then the draft, the hook, the review's overlay;
  // all before the page's first early return.
  const at = (needle: string) => text.indexOf(needle);
  const guide = at("= useParagraphGuide({");
  const shown = at("const shownMap = useMemo(");
  const route = at("const route = useMemo(");
  const drafted = at("const structureDraft = useMemo(");
  const hook = at("const structureReview = useStructureReview({");
  const reviewed = at("const reviewedMap = useMemo(");
  const project = at("const projectText = useMemo(");
  const early = at("if (!reading) return null;");
  if (!(guide >= 0 && guide < shown && shown < route && route < drafted && drafted < hook && hook < reviewed)) problems.push("the review is not made after the partition's overlay and the route fold");
  if (reviewed >= 0 && project >= 0 && reviewed > project) problems.push("the review is not made before the page's later memos");
  if (reviewed >= 0 && early >= 0 && reviewed > early) problems.push("the hook is called after an early return (hook order)");
  for (const needle of ["const hasBody =", "const providerConfigured ="]) {
    if (!(at(needle) >= 0 && at(needle) < hook)) problems.push(`the hook comes before \`${needle.replace("const ", "").replace(" =", "")}\` is known`);
  }

  // The view is handed the reviewed map, only where there is a body and a map, and the route is as it was.
  const map = /<ReadingMapView [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!map.includes("map={reviewedMap}")) problems.push("the map is not handed the reviewed map");
  if (!/map=\{hasBody && reviewedMap \? <ReadingMapView/.test(text)) problems.push("the map is no longer mounted only where there is a body and a map");
  if (!map.includes("route={route}")) problems.push("the map lost its route");
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's structure review wiring (P12-53)", () => {
  it("is as the ruling says", () => {
    expect(reviewProblems(source)).toEqual([]);
  });

  it("would notice the map handed the overlay without the review, or the review laid over something else", () => {
    expect(reviewProblems(source.replace("map={reviewedMap}", "map={shownMap}"))).toContain("the map is not handed the reviewed map");
    expect(reviewProblems(source.replace("applyStructureReview(shownMap, structureDraft, structureReview)", "applyStructureReview(reading.map, structureDraft, structureReview)"))).toContain(
      "the review is not laid over the partition's overlay (`shownMap`), memoised on the overlay, the draft and the review",
    );
  });

  it("would notice the request enabled by something other than the reader's model: the deep-report switch is not its gate", () => {
    expect(reviewProblems(source.replace("enabled: providerConfigured,\n    llmOverride: explainLlmOverride(profile),\n  });\n  const reviewedMap", "enabled: true,\n    llmOverride: explainLlmOverride(profile),\n  });\n  const reviewedMap"))).toContain(GATE_PROBLEM);
    expect(
      reviewProblems(
        source.replace("enabled: providerConfigured,\n    llmOverride: explainLlmOverride(profile),\n  });\n  const reviewedMap", "enabled: providerConfigured && deepReportRequested(profile, ready ? paper : undefined, aiMode),\n    llmOverride: explainLlmOverride(profile),\n  });\n  const reviewedMap"),
      ),
    ).toContain(GATE_PROBLEM);
  });

  it("would notice the paper asked about before its attachment is resolved, or the draft's digest dropped", () => {
    expect(reviewProblems(source.replace("paper: ready ? paper : undefined,\n    hasBody,\n    draftDigest", "paper,\n    hasBody,\n    draftDigest"))).toContain(
      "the hook is asked about a paper whose private attachment is not yet resolved",
    );
    expect(reviewProblems(source.replace("draftDigest: structureDraft?.digest,", ""))).toContain("the hook is no longer told the digest of the draft it is to review");
  });

  it("would notice the reader's own key dropped", () => {
    expect(reviewProblems(source.replace("llmOverride: explainLlmOverride(profile),\n  });\n  const reviewedMap", "});\n  const reviewedMap"))).toContain(
      "the reader's own key no longer travels as the explain box sends it",
    );
  });

  it("would notice the review made above the partition's overlay, or below an early return", () => {
    const block = /\n {2}\/\/ P12-53 \(§1h\.428; B P12-42\)[\s\S]*?\[shownMap, structureDraft, structureReview\],\n {2}\);\n/.exec(source)![0];
    const above = source.replace(block, "\n").replace("  const shownMap = useMemo(", `${block}  const shownMap = useMemo(`);
    const below = source.replace(block, "\n").replace("  if (!reading) return null;", `  if (!reading) return null;${block}`);

    expect(reviewProblems(above)).toContain("the review is not made after the partition's overlay and the route fold");
    expect(reviewProblems(below)).toContain("the hook is called after an early return (hook order)");
  });
});
