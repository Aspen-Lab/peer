import { describe, expect, it } from "vitest";
import { reportOutcome } from "./report-outcome";

describe("reportOutcome", () => {
  it("shows a model-written report", () => {
    expect(reportOutcome({ noLlm: undefined }, true)).toBe("shown");
    expect(reportOutcome({}, false)).toBe("shown");
  });

  it("is an absence when no model was asked (tier0, or no key on the JSON path)", () => {
    expect(reportOutcome({ noLlm: true }, false)).toBe("absent");
    expect(reportOutcome(null, false)).toBe("absent");
  });

  it("is a failure when the model was asked and sent back the empty report", () => {
    // A tier1 stream whose provider threw, or a paywalled deep read whose
    // shallow retry produced nothing: `emptyReport("fallback")` after a
    // non-tier0 mode. The page must say the model could not finish.
    expect(reportOutcome({ noLlm: true }, true)).toBe("failed");
    expect(reportOutcome(null, true)).toBe("failed");
  });
});
