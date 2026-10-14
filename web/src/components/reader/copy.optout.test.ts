import { describe, expect, it } from "vitest";
import { ASK, STANDING } from "./copy";

// P5-02 (blueprint P5) had the words of the per-question opt-out checkbox in the question box.
// P10-03 (round P10, review 2.3, 2.4, 2.5): the checkbox is gone — those three tests ("says it in plain words, in
// sentence case", "says nothing of skipping, an allowance or a plan", "is named for the one question it belongs
// to") are re-aimed below to what replaced it: the box's words carry no such control, and the Profile's switch
// ("Use my questions to tune recommendations") says the same thing in plain words.

describe("ASK — the question bar's words", () => {
  it("carries no per-question opt-out, no line names and no 'five questions'", () => {
    const keys = Object.keys(ASK);
    expect(keys).not.toEqual(expect.arrayContaining(["notForRecs"]));
    for (const gone of ["notForRecs", "notForRecsFor", "line", "remove"]) expect(keys).not.toContain(gone);
    expect(JSON.stringify(ASK)).not.toMatch(/Not for\s+recommendations|five questions|Up\s+to\s+five/i);
  });

  it("labels the bar exactly 'What you want to learn about this paper:' and nothing says the old label", () => {
    expect(ASK.heading).toBe("What you want to learn about this paper:");
    expect(JSON.stringify(ASK)).not.toContain(["Before", "you read"].join(" "));
  });

  // On a 390-px screen the placeholder shares the bar with Submit; a longer one wrapped and grew the empty bar to two rows.
  it("has a placeholder short enough to stay on one row beside Submit at 390 px", () => {
    expect(ASK.placeholder).toBe("What should this paper answer?");
    expect(ASK.placeholder.length).toBeLessThanOrEqual(32);
  });

  it("names the dropdown and keeps its group labels and the gist item", () => {
    expect(ASK.suggestions).toBe("Suggested questions");
    expect(ASK.fromEarlier).toBe("From your earlier questions");
    expect(ASK.fromProfile).toBe("From your profile");
    expect(ASK.chips.gist).toBe("Just get the gist");
    expect(ASK.submit).toBe("Submit");
  });
});

describe("STANDING — the switch beside the standing questions (P10-03, review 2.3)", () => {
  it("says it in plain words, in sentence case", () => {
    expect(STANDING.tuneLabel).toBe("Use my questions to tune recommendations");
    expect(STANDING.tuneLabel).not.toMatch(/^[A-Z ]+$/);
    expect(STANDING.tuneLabel.slice(1)).toBe(STANDING.tuneLabel.slice(1).toLowerCase());
  });

  it("says nothing of skipping, an allowance or a plan", () => {
    for (const text of [STANDING.tuneLabel, STANDING.tuneHint]) {
      expect(text).not.toMatch(/\bskip\b|don.t read|\ballowance\b|\bquota\b|\bplan\b|\bupgrade\b/i);
    }
  });

  it("is one line under the label, and says what off means", () => {
    expect(STANDING.tuneHint).toBe("Peer learns a little from the words of the questions you submit on papers. Off: it learns nothing from them.");
    expect(STANDING.tuneHint).not.toContain("\n");
  });
});
