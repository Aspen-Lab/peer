import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import type { DigestProvider } from "@/lib/llm/providers/types";
import type { ExtractedDocument } from "./html-text";
import { generateDeepReport } from "./deep-report";

const paper: Paper = {
  id: "openalex:Wtest",
  title: "A test paper with a conclusion",
  authors: ["A. Researcher"],
  relevanceReason: "Matches the declared topic.",
  venue: "Test Venue",
  source: "other",
  summaryIntro: "This paper studies a focused research question.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "The experiment supports the stated conclusion.",
  isSaved: false,
};

// Padding to push total body chars past PASS1_TRIGGER_CHARS (10_000), so
// generateDeepReport actually runs pass 1 instead of skipping straight to
// pass 2 with the raw body.
const FILLER = "This sentence exists only to pad the introduction. ".repeat(250);

const CONCLUSION_MARKER =
  "The superconducting dome narrows sharply as the layer ratio L to d approaches 0.9.";

function doc(): ExtractedDocument {
  return {
    sections: [
      { heading: "Introduction", canonical: "introduction", text: FILLER },
      { heading: "Methods", canonical: "methods", text: "We used a standard protocol." },
      { heading: "Results", canonical: "results", text: "The main result was measured." },
      { heading: "Conclusion", canonical: "conclusion", text: CONCLUSION_MARKER },
    ],
    figureCaptions: [],
    source: "pdf",
    pageCount: 12,
  };
}

/** A fake provider that records every `generateJsonText` call in order. */
function fakeProvider(responses: string[]): {
  provider: DigestProvider;
  calls: { systemPrompt: string; userPrompt: string; tier?: string }[];
} {
  const calls: { systemPrompt: string; userPrompt: string; tier?: string }[] = [];
  let i = 0;
  return {
    calls,
    provider: {
      id: "gemini",
      generateDigest: async () => ({ bullets: [] }),
      testConnection: async () => ({ ok: true }),
      generateJsonText: async (args) => {
        calls.push(args);
        const response = responses[Math.min(i, responses.length - 1)];
        i += 1;
        return response;
      },
    },
  };
}

describe("generateDeepReport — pass 1 reads every canonical bucket (1-14)", () => {
  it("feeds the conclusion section to pass 1, not just introduction/methods/results/discussion", async () => {
    const pass1Response = JSON.stringify({
      noveltyClaims: [],
      keyResults: [CONCLUSION_MARKER],
      methodHighlights: [],
      priorWorkComparisons: [],
    });
    const pass2Response = JSON.stringify({
      skim: [],
      whatItProposes: { summary: "", methods: [] },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          {
            title: "Dome narrowing",
            detail: "The dome narrows near L/d = 0.9.",
            evidence: CONCLUSION_MARKER,
          },
        ],
      },
    });
    const { provider, calls } = fakeProvider([pass1Response, pass2Response]);

    const report = await generateDeepReport({ paper, doc: doc(), provider });

    expect(calls).toHaveLength(2);
    const pass1Prompt = JSON.parse(calls[0].userPrompt) as { sections: Record<string, string> };
    // The bug (pre-1-14): buildPass1Prompt only ever read introduction/
    // methods/results/discussion, so a paper's conclusion bucket never
    // reached the model asked to extract signal from it.
    expect(pass1Prompt.sections.conclusion).toContain(CONCLUSION_MARKER);
    expect(pass1Prompt.sections.methods).toContain("standard protocol");
    expect(pass1Prompt.sections.results).toContain("main result");

    // And the claim quoting the conclusion sentence survives the evidence
    // checker — it's genuinely in doc.sections, just previously never shown
    // to the model that writes the claims.
    expect(report?.resultsAndSignificance.keyResults).toHaveLength(1);
    expect(report?.provenance.droppedClaims).toBe(0);
  });
});
