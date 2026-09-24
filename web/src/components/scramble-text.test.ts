import { describe, expect, it } from "vitest";
import { resolveRevealMode } from "./scramble-text";

describe("resolveRevealMode", () => {
  it("plays the decode animation when the system allows motion", () => {
    expect(resolveRevealMode(false)).toBe("scramble");
  });

  it("falls back to a gentle fade when the system asks for reduced motion", () => {
    // Reduced motion must still show the text building up — just without the
    // rapid character flashing the setting exists to suppress.
    expect(resolveRevealMode(true)).toBe("fade");
  });
});
