import { describe, expect, it } from "vitest";
import { PLAIN_LEVELS } from "@/lib/papers/plain-levels";
import { PEERS_READING, PLAIN } from "./copy";

// P4-01 (blueprint §3.6; §3d 18, the wording rule): every string "Say it plainly" shows is in
// `copy.ts` under `PLAIN`, in these words. Peer's labels are in the label face and say a fact; none
// speaks of an allowance, a quota or a plan (§1h.10), and none says "skip" or "don't read" (§1a.4).

describe("PLAIN — the words of Say it plainly", () => {
  it("names the button as the spec does, and says so while it runs", () => {
    expect(PLAIN.button).toBe("Say it plainly");
    expect(PLAIN.busy).toBe("Saying it plainly…");
  });

  it("names the three levels, one for each, in the order the list has them", () => {
    expect(PLAIN.levels).toEqual({ highschool: "High school", undergrad: "Undergrad", graduate: "Graduate" });
    expect(Object.keys(PLAIN.levels)).toEqual([...PLAIN_LEVELS]);
  });

  it("says in one line why a paragraph has no rewrite, and that the original stays", () => {
    expect(PLAIN.couldNotKeepNumbers).toBe("Peer could not keep this paragraph's numbers exact, so the original stays.");
    expect(PLAIN.unavailable).toBe("Peer could not rewrite this paragraph just now.");
  });

  it("labels the level group and the rewrite for a screen reader", () => {
    expect(PLAIN.levelsLabel).toBe("Reading level");
    expect(PLAIN.rewrite).toBe("The paragraph, said plainly");
  });

  it("marks the rewrite as Peer's with the one line the rest of the page uses, not a new one", () => {
    expect(PEERS_READING).toBe("Peer's reading — not a quote");
  });

  it("is sentence case, with no allowance, quota or plan, and no 'skip' or 'don't read'", () => {
    const strings = [PLAIN.button, PLAIN.busy, PLAIN.levelsLabel, PLAIN.rewrite, PLAIN.couldNotKeepNumbers, PLAIN.unavailable, ...Object.values(PLAIN.levels)];

    for (const text of strings) {
      expect(text).not.toMatch(/^[A-Z ]+$/);
      expect(text).not.toMatch(/\ballowance\b|\bquota\b|\bused up\b|\bplan\b|\bupgrade\b|\bcredit/i);
      expect(text).not.toMatch(/\bskip\b|don.t read/i);
    }
  });
});
