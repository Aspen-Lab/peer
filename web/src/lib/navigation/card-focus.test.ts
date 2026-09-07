import { describe, expect, it } from "vitest";
import { NONE, indexAfterRemoval, stepIndex } from "./card-focus";

describe("stepIndex", () => {
  it("lands on the first card from nothing, in either direction", () => {
    expect(stepIndex(NONE, +1, 10)).toBe(0);
    expect(stepIndex(NONE, -1, 10)).toBe(0);
  });

  it("steps and clamps without wrapping", () => {
    expect(stepIndex(3, +1, 10)).toBe(4);
    expect(stepIndex(3, -1, 10)).toBe(2);
    expect(stepIndex(9, +1, 10)).toBe(9);
    expect(stepIndex(0, -1, 10)).toBe(0);
  });

  it("has nothing to focus in an empty list", () => {
    expect(stepIndex(NONE, +1, 0)).toBe(NONE);
    expect(stepIndex(4, +1, 0)).toBe(NONE);
  });
});

describe("indexAfterRemoval", () => {
  it("keeps the ring in place so the next card slides under it", () => {
    expect(indexAfterRemoval(3, 9)).toBe(3);
  });

  it("steps back when the last card was the one removed", () => {
    expect(indexAfterRemoval(9, 9)).toBe(8);
  });

  it("clears when the list empties", () => {
    expect(indexAfterRemoval(0, 0)).toBe(NONE);
    expect(indexAfterRemoval(NONE, 5)).toBe(NONE);
  });
});
