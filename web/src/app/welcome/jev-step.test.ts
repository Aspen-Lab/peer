import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import type { UserAiProvider } from "@/types";
import { useProfileStore } from "@/store/profile";
import {
  AiKeyFields,
  AiProviderGuide,
  AiProviderGuideDetails,
  AiProviderRecommendation,
  ApiKeyHelp,
} from "@/components/profile/ai-setup";
import { JevSetup } from "@/components/profile/jev-setup";
import { STEP_META, isStepDone } from "./completeness";

/**
 * Every string and JSX text a file can show a reader, read with the TypeScript
 * parser: no comment, no import path. `within` narrows the walk to the nodes it
 * accepts (and everything under them).
 */
function copyStrings(text: string, within: (node: ts.Node) => boolean = () => true): string[] {
  const file = ts.createSourceFile("scan.tsx", text.replace(/^\uFEFF/, ""), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const strings: string[] = [];
  const collect = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node) ||
      ts.isJsxText(node)
    ) {
      strings.push(node.text);
    }
    ts.forEachChild(node, collect);
  };
  const find = (node: ts.Node) => {
    if (within(node)) collect(node);
    else ts.forEachChild(node, find);
  };
  find(file);
  return strings;
}

/** The copy of the wizard's `key === "ai" && (...)` step, and only that step. */
function aiStepCopy(pageText: string): string[] {
  return copyStrings(
    pageText,
    (node) =>
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      node.left.getText() === 'key === "ai"',
  );
}

// Paper screening with the reader's own Jev key is a short optional block inside
// the wizard's existing `ai` step: no new step, and a Jev key alone does not make
// the `ai` step "done" (that step is about a model that will actually run).

describe("welcome wizard - the Jev block", () => {
  const source = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");

  it("adds no wizard step: the six steps are the ones that were there, less the retired Data step", () => {
    expect(STEP_META.map((step) => step.key)).toEqual([
      "basics",
      "topics",
      "work",
      "radar",
      "ai",
      "persona",
    ]);
  });

  it("mounts the short Jev block inside the ai step, after the model-key fields", () => {
    const aiStart = source.indexOf('key === "ai" && (');
    const aiEnd = source.indexOf('key === "persona" && (');
    expect(aiStart).toBeGreaterThan(-1);
    expect(aiEnd).toBeGreaterThan(aiStart);
    const aiStep = source.slice(aiStart, aiEnd);
    expect(aiStep).toContain('<JevSetup variant="welcome"');
    expect(aiStep.indexOf("<AiKeyFields")).toBeGreaterThan(-1);
    expect(aiStep.indexOf("<JevSetup")).toBeGreaterThan(aiStep.indexOf("<AiKeyFields"));
    expect(source).toMatch(/import \{[^}]*\bJevSetup\b[^}]*\} from "@\/components\/profile\/jev-setup"/);
  });

  it("never reads or writes the key itself: the setup component owns it", () => {
    expect(source).not.toMatch(/jevApiKey|updateJevApiKey/);
  });

  it("a Jev key alone does not complete the ai step, with or without sign-in", () => {
    const withJevOnly = { ...defaultProfile, jevApiKey: "jev-wizard-test-not-a-key-0000" };
    expect(isStepDone("ai", withJevOnly, false, "signed-in")).toBe(false);
    expect(isStepDone("ai", withJevOnly, false, "unconfigured")).toBe(false);
  });

  it("a model key still completes it, and adding a Jev key changes nothing about that", () => {
    const withModelKey = { ...defaultProfile, feedAiProvider: "openai" as const, feedAiApiKey: "user-owned-key" };
    expect(isStepDone("ai", withModelKey, false, "signed-in")).toBe(true);
    expect(isStepDone("ai", { ...withModelKey, jevApiKey: "jev-wizard-test-not-a-key-0000" }, false, "signed-in")).toBe(true);
    expect(isStepDone("ai", withModelKey, false, "signed-out")).toBe(false);
  });
});

// N11 of the branch review: this step said Tavily web scouting "remains limited by
// Peer's daily search schedule", and no such schedule exists in the code now.
//
// P9-44 (BACKLOG-49): the sentence that replaced it said "Tavily web scouting uses its
// own separate search key". No screen of Peer takes that key, and no paper source
// uses it: `feed/pipeline.ts` hands the `web` source no `webSearch` options and
// `store/feed.ts` sends no `searchConnectors`, so the sentence named a key nobody
// could enter for a feature that does not run. The step now says what AI keys are for
// and nothing more.
describe("welcome wizard - the ai step's note about search keys", () => {
  const pageText = readFileSync(join(process.cwd(), "src/app/welcome/page.tsx"), "utf8");
  const flat = pageText.replace(/\s+/g, " ");

  it("names no schedule of Peer's own, because Peer runs no search on a schedule", () => {
    expect(flat).not.toMatch(/search schedule|daily search/i);
  });

  // RE-AIMED (§1c, P9-44). This test was "still says what is true: Tavily web scouting
  // uses its own separate search key", pinning the sentence "AI keys power ranking,
  // summaries, and Deep reports. Tavily web scouting uses its own separate search key."
  // That second sentence is no longer true, so what is pinned is what now is: the
  // sentence is the first one alone, and the step names no search key and no product
  // that is not wired. The reader still reads the first sentence, word for word.
  it("says only what AI keys are for: 'AI keys power ranking, summaries, and Deep reports.' and nothing after it", () => {
    const aiStart = pageText.indexOf('key === "ai" && (');
    const aiEnd = pageText.indexOf('key === "persona" && (');
    expect(aiStart).toBeGreaterThan(-1);
    expect(aiEnd).toBeGreaterThan(aiStart);
    const aiStep = pageText.slice(aiStart, aiEnd);
    const notes = [...aiStep.matchAll(/<p\b[^>]*>([^<]*AI keys power[^<]*)<\/p>/g)].map((m) => m[1].replace(/\s+/g, " ").trim());
    expect(notes).toEqual(["AI keys power ranking, summaries, and Deep reports."]);
  });

  it("the ai step names no search key and no product that is not wired", () => {
    const words = aiStepCopy(pageText).join(" ").replace(/\s+/g, " ");
    expect(words).toContain("AI keys power ranking, summaries, and Deep reports.");
    expect(words).not.toMatch(/tavily|brave|web scout|scouting|search key|search api|search provider|its own separate/i);
  });
});

// P9-44: no step of /welcome says "Tavily" to a reader. The scan reads each file with
// the TypeScript parser, so it sees exactly the strings and JSX text that can reach a
// reader and never a comment (a comment may say why a thing is gone) or an import
// path. The shared components the steps mount are rendered for real, for every
// provider the AI step can show.
describe("welcome wizard - no step says Tavily", () => {
  const TAVILY = /tavily/i;
  const STEP_FILES = [
    "src/app/welcome/page.tsx",
    "src/app/welcome/completeness.ts",
    "src/components/profile/ai-setup.tsx",
    "src/components/profile/jev-setup.tsx",
    "src/components/profile/field-kit.tsx",
    "src/components/profile/school-autocomplete.tsx",
    "src/components/profile/advisor-field.tsx",
  ];

  it.each(STEP_FILES)("%s: no string or JSX text that reaches a reader says Tavily", (path) => {
    const text = readFileSync(join(process.cwd(), path), "utf8");
    expect(copyStrings(text).filter((s) => TAVILY.test(s))).toEqual([]);
  });

  const PROVIDERS: UserAiProvider[] = ["default", "openai", "gemini", "anthropic", "qwen", "deepseek"];

  it.each(PROVIDERS)("the AI step's mounted components, rendered with provider %s, say no Tavily", (provider) => {
    useProfileStore.setState({ profile: { ...defaultProfile, feedAiProvider: provider } });
    const nodes: ReactElement[] = [
      createElement(ApiKeyHelp, { provider }),
      createElement(AiProviderRecommendation),
      createElement(AiKeyFields, {
        provider,
        apiKey: "",
        onProviderChange: () => {},
        onApiKeyChange: () => {},
        idPrefix: "welcome-ai",
        emphasized: true,
        showRegistrationLink: true,
      }),
      createElement(AiProviderGuide, { provider }),
      createElement(JevSetup, { variant: "welcome", idPrefix: "welcome" }),
    ];
    if (provider !== "default") nodes.push(createElement(AiProviderGuideDetails, { provider }));
    for (const node of nodes) {
      const markup = renderToStaticMarkup(node);
      expect(markup.length).toBeGreaterThan(0);
      expect(markup).not.toMatch(TAVILY);
    }
  });
});
