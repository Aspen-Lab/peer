import { afterEach, describe, expect, it, vi } from "vitest";
import type { DigestProvider } from "@/lib/llm/providers/types";
import type { ExtractedFigureCaption } from "./html-text";
import type { PaperReport } from "./report";
import { bindFiguresToReport } from "./figure-binding";

// P5-04c, item 1 (§1h.17 (a); the F1 class of §1h.16 (a)): the semantic match
// sends the paper's title, the query sentence and up to 360 characters of each
// figure caption to the model (for a standalone upload, a private PDF's words),
// and a provider's error may quote that prompt back in its message. So the
// catch logs the kind of the error and never the error. Every string below is
// invented; no real model, no network: a stub provider.

const TITLE = "Quillwort cathodes crack under fast charging";

// The proposal's query shares no word of three or more letters with either
// caption, so the keyword rounds find nothing and the semantic round is asked.
const CAPTIONS: ExtractedFigureCaption[] = [
  { ordinal: 1, label: "Figure 1", caption: "Cracks against charge rate for the quillwort cathode, in grey." },
  { ordinal: 2, label: "Figure 2", caption: "Cross-section micrographs taken after one month, scale bar ten microns." },
];

function report(): PaperReport {
  return {
    skim: [],
    whatItProposes: { summary: "The authors cycle cells in a warm room and open them afterwards.", methods: [] },
    resultsAndSignificance: { summary: "", keyResults: [] },
    provenance: { basis: "model-fulltext", droppedClaims: 0 },
  };
}

function providerThatReplies(reply: (args: { userPrompt: string }) => string | Promise<string>) {
  const generateJsonText = vi.fn(async (args: { systemPrompt: string; userPrompt: string }) => reply(args));
  const provider: DigestProvider = {
    id: "gemini",
    generateDigest: async () => ({ bullets: [] }),
    testConnection: async () => ({ ok: true }),
    generateJsonText,
  };
  return { provider, generateJsonText };
}

/** Every argument of every call, as text, so a leak anywhere in a line is seen. */
function printed(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.flatMap((args) => args.map((arg) => (arg instanceof Error ? `${arg.name}: ${arg.message}` : String(arg))));
}

function lines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((args) => args.map(String).join(" "));
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the semantic match's failure log (P5-04c, §1h.17 (a))", () => {
  it("logs the kind of the error only, never its message, which may quote the prompt back", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const MARKER = "lumen-orchard-marker-6203";
    // A provider that quotes the whole request back in its error, as one that
    // keeps part of an error body in its message can.
    const { provider, generateJsonText } = providerThatReplies(({ userPrompt }) => {
      throw new Error(`provider error 400: ${MARKER} ${userPrompt}`);
    });

    const bound = await bindFiguresToReport({ paper: { title: TITLE }, report: report(), captions: CAPTIONS, provider });

    // The match failed softly: no figure bound, the report otherwise as it came.
    expect(bound.whatItProposes.figureLabel).toBeNull();
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    // The premise: the prompt did hold the paper's title and a caption.
    const prompt = generateJsonText.mock.calls[0][0].userPrompt;
    expect(prompt).toContain(TITLE);
    expect(prompt).toContain("Cracks against charge rate for the quillwort cathode");

    expect(lines(warn)).toEqual(["[figure-binding] semantic match failed: Error"]);
    expect(error).not.toHaveBeenCalled();
    for (const text of [...printed(warn), ...printed(error)]) {
      expect(text).not.toContain(MARKER);
      expect(text).not.toContain(TITLE);
      expect(text).not.toContain("quillwort cathode");
    }
  });

  it("a thrown value that is not an Error is logged by its type alone", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const MARKER = "lumen-orchard-marker-7718";
    const { provider, generateJsonText } = providerThatReplies(() => {
      throw `provider text ${MARKER}`;
    });

    const bound = await bindFiguresToReport({ paper: { title: TITLE }, report: report(), captions: CAPTIONS, provider });

    expect(bound.whatItProposes.figureLabel).toBeNull();
    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(lines(warn)).toEqual(["[figure-binding] semantic match failed: string"]);
    for (const text of [...printed(warn), ...printed(error)]) expect(text).not.toContain(MARKER);
  });

  // The control: the same arrangement with a provider that answers, so the two
  // tests above reach the semantic round on purpose and not by accident.
  it("the same request with a provider that answers binds the figure and logs nothing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const { provider, generateJsonText } = providerThatReplies(() => JSON.stringify({ ordinal: 2, confidence: "high", reason: "It shows the cells opened." }));

    const bound = await bindFiguresToReport({ paper: { title: TITLE }, report: report(), captions: CAPTIONS, provider });

    expect(generateJsonText).toHaveBeenCalledTimes(1);
    expect(bound.whatItProposes.figureLabel).toBe("Figure 2");
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });
});
