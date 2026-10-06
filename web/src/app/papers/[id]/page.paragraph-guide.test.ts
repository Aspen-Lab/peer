import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-03 (ruling §1h.6): the page's wiring of Peer's paragraph gists. `Reader`
// cannot be mounted in this Node-only suite, so — as the explain, Terms to know
// and upload-skip wiring tests do — this reads the page's source and holds each
// join to its shape: the hook asks for the paper the page has finished resolving
// (`ready`), only where there is a body and the reader has switched the paper's
// text on for a model — `providerConfigured && deepReportRequested(...)`, the
// report's own predicate, and nothing else (P3-05, §1h.8 (1): the first version of
// this test pinned the opposite, "a model from anywhere, not deep reports", and the
// pass sent a standalone upload's body on page open with the switch off) — with the
// reader's own key as the explain box sends it; it is called before the page's first
// early return (hook order); and the map is handed what it returns. The checker is also run on
// mutated copies of the source, so the test proves it would notice what it
// guards: green on the page, red on each.

/** The one gate (P3-05, §1h.8 (1)): a model from anywhere, on the report's own deep
 *  predicate, fed what the report hook is fed. Nothing else enables the hook. */
const GATE = "providerConfigured && deepReportRequested(profile, ready ? paper : undefined, aiMode)";
const GATE_PROBLEM = "the hook is not enabled by `providerConfigured && deepReportRequested(profile, ready ? paper : undefined, aiMode)` and nothing else";

/** What is wrong with the gist wiring of a page `source`; empty when it is right. */
function guideProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!text.includes('import { useParagraphGuide } from "@/components/reader/use-paragraph-guide";')) problems.push("the page no longer imports the hook");
  if (!text.includes('import { deepReportRequested, useModelReport } from "@/components/reader/use-model-report";')) problems.push("the page no longer imports the report's deep predicate from the report hook");
  if (text.split("useParagraphGuide({").length - 1 !== 1) problems.push("the hook is not called exactly once");
  const call = /const paragraphGists = useParagraphGuide\(\{[^}]*\}\);/.exec(text)?.[0] ?? "";
  if (!call) problems.push("the page no longer names the hook's result `paragraphGists`");
  else {
    if (!call.includes("paper: ready ? paper : undefined")) problems.push("the hook is asked about a paper whose private attachment is not yet resolved");
    if (!call.includes("hasBody,")) problems.push("the hook is no longer told whether the reading has a body");
    if (/enabled: (.*?), llmOverride:/.exec(call)?.[1] !== GATE) problems.push(GATE_PROBLEM);
    if (!call.includes("llmOverride: explainLlmOverride(profile)")) problems.push("the reader's own key no longer travels as the explain box sends it");
  }

  // Hook order: after the two values it reads, before the page's first early return.
  const at = text.indexOf("const paragraphGists = useParagraphGuide(");
  const defined = (needle: string) => text.indexOf(needle);
  if (at >= 0 && !(defined("const hasBody =") >= 0 && defined("const hasBody =") < at)) problems.push("the hook comes before `hasBody` is known");
  if (at >= 0 && !(defined("const providerConfigured =") >= 0 && defined("const providerConfigured =") < at)) problems.push("the hook comes before `providerConfigured` is known");
  if (at >= 0 && !(defined("const aiMode =") >= 0 && defined("const aiMode =") < at)) problems.push("the hook comes before `aiMode` is known");
  if (!text.includes('const aiMode = aiAvailability(profile, entitlementGrants(entitlement)); const providerConfigured = aiMode !== "none";')) problems.push("`providerConfigured` is no longer read from the one `aiMode` the deep predicate is given");
  const early = text.indexOf("if (!reading) return null;");
  if (at >= 0 && early >= 0 && at > early) problems.push("the hook is called after an early return (hook order)");

  // The map is handed the gists, and is otherwise as it was.
  const map = /<ReadingMapView [^>]*\/>/.exec(text)?.[0] ?? "";
  if (!map) problems.push("the map is no longer mounted");
  else {
    if (!map.includes("gists={paragraphGists}")) problems.push("the map is no longer handed Peer's gists");
    if (!map.includes("route={route}") || !map.includes("map={reading.map}")) problems.push("the map lost its reading or its route");
  }
  return problems;
}

const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's paragraph gist wiring (P3-03)", () => {
  it("is as the ruling says", () => {
    expect(guideProblems(source)).toEqual([]);
  });

  it("would notice the gists no longer handed to the map", () => {
    expect(guideProblems(source.replace(" gists={paragraphGists}", ""))).toContain("the map is no longer handed Peer's gists");
  });

  it("would notice the request enabled by something other than the gate", () => {
    expect(guideProblems(source.replace(`enabled: ${GATE},`, "enabled: true,"))).toContain(GATE_PROBLEM);
  });

  // The P3-03 version of this test treated this as correct (and its mirror image,
  // gating on the deep switch, as the problem): a map that wrote its gists on a model
  // alone sent the paper's body with the Deep report switch off (A's P3-04 F1).
  it("would notice the gate dropped: the request back on a model alone, off the Deep report switch", () => {
    expect(guideProblems(source.replace(`enabled: ${GATE},`, "enabled: providerConfigured,"))).toContain(GATE_PROBLEM);
  });

  it("would notice a second condition on the request, or the predicate fed another paper than the report's", () => {
    expect(guideProblems(source.replace(`enabled: ${GATE},`, `enabled: ${GATE} && hasBody,`))).toContain(GATE_PROBLEM);
    expect(guideProblems(source.replace("deepReportRequested(profile, ready ? paper : undefined, aiMode)", "deepReportRequested(profile, paper, aiMode)"))).toContain(GATE_PROBLEM);
  });

  it("would notice the predicate no longer imported from the report hook", () => {
    expect(guideProblems(source.replace("import { deepReportRequested, useModelReport }", "import { useModelReport }"))).toContain(
      "the page no longer imports the report's deep predicate from the report hook",
    );
  });

  it("would notice the paper asked about before its attachment is resolved", () => {
    expect(guideProblems(source.replace("paper: ready ? paper : undefined,\n    hasBody,", "paper,\n    hasBody,"))).toContain("the hook is asked about a paper whose private attachment is not yet resolved");
  });

  it("would notice the reader's own key dropped", () => {
    expect(guideProblems(source.replace("llmOverride: explainLlmOverride(profile),\n  });\n", "});\n"))).toContain("the reader's own key no longer travels as the explain box sends it");
  });

  it("would notice the hook moved below an early return", () => {
    const call = /\s*const paragraphGists = useParagraphGuide\(\{[^}]*\}\);\n/.exec(source)![0];
    const moved = source.replace(call, "\n").replace("  if (!reading) return null;", `  if (!reading) return null;${call}`);

    expect(guideProblems(moved)).toContain("the hook is called after an early return (hook order)");
  });
});

// One source of truth: the report hook decides its own `deep` with the predicate the
// page hands the gist hook, not with a copy of it.
describe("the report hook and the gist pass read one predicate (P3-05)", () => {
  const hook = readFileSync(resolve(process.cwd(), "src/components/reader/use-model-report.ts"), "utf8").replace(/\s+/g, " ");

  it("decides `deep` with deepReportRequested, and with nothing beside it", () => {
    expect(hook.includes("export function deepReportRequested(")).toBe(true);
    expect(hook.includes("const deep = deepReportRequested(profile, paper, aiMode);")).toBe(true);
    // The expression the predicate stands for lives in one place.
    expect(hook.split("profile.deepReportEnabled").length - 1).toBe(1);
  });
});
