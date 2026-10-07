import { describe, expect, it } from "vitest";
import { ASK } from "./copy";

// P5-02 (blueprint P5): the words of the per-question checkbox in the question box.

describe("ASK.notForRecs — the checkbox beside a question", () => {
  it("says it in plain words, in sentence case", () => {
    expect(ASK.notForRecs).toBe("Not for recommendations");
    expect(ASK.notForRecs).not.toMatch(/^[A-Z ]+$/);
    expect(ASK.notForRecs.slice(1)).toBe(ASK.notForRecs.slice(1).toLowerCase());
  });

  it("says nothing of skipping, an allowance or a plan", () => {
    expect(ASK.notForRecs).not.toMatch(/\bskip\b|don.t read|\ballowance\b|\bquota\b|\bplan\b|\bupgrade\b/i);
  });

  it("is named for the one question it belongs to", () => {
    expect(ASK.notForRecsFor(2)).toBe("Not for recommendations: question 2");
  });
});
