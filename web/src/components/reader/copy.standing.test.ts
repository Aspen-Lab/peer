import { describe, expect, it } from "vitest";
import { STANDING } from "./copy";

// P5-01 (blueprint P5): the words of the standing questions — on the Profile page and as the group in the
// dropdown of a paper's question bar (P10-03: "What you want to learn about this paper:"). Peer's words are
// English and sentence case; none speaks of an allowance, a quota or a plan (§1h.10), and none says "skip" or
// "don't read" (§1a.4).

describe("STANDING — the words of the standing questions", () => {
  it("names the Profile row, the dropdown group and the controls", () => {
    expect(STANDING.label).toBe("Standing questions");
    expect(STANDING.chipGroup).toBe("Your standing questions");
    expect(STANDING.add).toBe("Add a question");
    expect(STANDING.placeholder).toBe("A question you bring to most papers");
    expect(STANDING.line(2)).toBe("Standing question 2");
    expect(STANDING.remove(2)).toBe("Remove standing question 2");
  });

  it("says in one sentence what they are, and that they are never filled in for the reader", () => {
    expect(STANDING.hint).toBe(
      "Questions you bring to most papers, five at most. On a paper they are listed under the question bar while you type; Peer never fills one in for you.",
    );
  });

  it("is sentence case, with no allowance, quota or plan, and no 'skip' or 'don't read'", () => {
    const strings = [
      STANDING.label,
      STANDING.chipGroup,
      STANDING.add,
      STANDING.placeholder,
      STANDING.hint,
      STANDING.line(1),
      STANDING.remove(1),
    ];
    for (const text of strings) {
      expect(text).not.toMatch(/^[A-Z ]+$/);
      expect(text).not.toMatch(/\ballowance\b|\bquota\b|\bused up\b|\bplan\b|\bupgrade\b|\bcredit/i);
      expect(text).not.toMatch(/\bskip\b|don.t read/i);
      // Sentence case: inside a sentence no word is capitalised (the quoted box name is lower case).
      for (const sentence of text.split(/(?<=[.?!])\s+/)) {
        const inside = sentence.replace(/^\S+/, "").replace(/\bPeer\b/g, "");
        expect(inside).not.toMatch(/\s[A-Z][a-z]/);
      }
    }
  });
});
