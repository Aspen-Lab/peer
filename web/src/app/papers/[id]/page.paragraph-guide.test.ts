import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P3-03 (ruling §1h.6): the page's wiring of Peer's paragraph gists. `Reader`
// cannot be mounted in this Node-only suite, so — as the explain, Terms to know
// and upload-skip wiring tests do — this reads the page's source and holds each
// join to its shape: the hook asks for the paper the page has finished resolving
// (`ready`), only where there is a body and the reader has a model from anywhere
// (`providerConfigured`, not deep reports), with the reader's own key as the
// explain box sends it; it is called before the page's first early return (hook
// order); and the map is handed what it returns. The checker is also run on
// mutated copies of the source, so the test proves it would notice what it
// guards: green on the page, red on each.

/** What is wrong with the gist wiring of a page `source`; empty when it is right. */
function guideProblems(source: string): string[] {
  const text = source.replace(/\s+/g, " ");
  const problems: string[] = [];

  if (!text.includes('import { useParagraphGuide } from "@/components/reader/use-paragraph-guide";')) problems.push("the page no longer imports the hook");
  if (text.split("useParagraphGuide({").length - 1 !== 1) problems.push("the hook is not called exactly once");
  const call = /const paragraphGists = useParagraphGuide\(\{[^}]*\}\);/.exec(text)?.[0] ?? "";
  if (!call) problems.push("the page no longer names the hook's result `paragraphGists`");
  else {
    if (!call.includes("paper: ready ? paper : undefined")) problems.push("the hook is asked about a paper whose private attachment is not yet resolved");
    if (!call.includes("hasBody,")) problems.push("the hook is no longer told whether the reading has a body");
    if (!call.includes("enabled: providerConfigured")) problems.push("the hook is no longer enabled by `providerConfigured` (a model from anywhere)");
    if (/deepReport/i.test(call)) problems.push("the gist request is gated on deep reports");
    if (!call.includes("llmOverride: explainLlmOverride(profile)")) problems.push("the reader's own key no longer travels as the explain box sends it");
  }

  // Hook order: after the two values it reads, before the page's first early return.
  const at = text.indexOf("const paragraphGists = useParagraphGuide(");
  const defined = (needle: string) => text.indexOf(needle);
  if (at >= 0 && !(defined("const hasBody =") >= 0 && defined("const hasBody =") < at)) problems.push("the hook comes before `hasBody` is known");
  if (at >= 0 && !(defined("const providerConfigured =") >= 0 && defined("const providerConfigured =") < at)) problems.push("the hook comes before `providerConfigured` is known");
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

  it("would notice the request enabled by something other than a model from anywhere", () => {
    expect(guideProblems(source.replace("enabled: providerConfigured,", "enabled: true,"))).toContain("the hook is no longer enabled by `providerConfigured` (a model from anywhere)");
  });

  it("would notice the request gated on deep reports", () => {
    expect(guideProblems(source.replace("enabled: providerConfigured,", "enabled: providerConfigured && deepReportEnabled,"))).toContain("the gist request is gated on deep reports");
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
