import { describe, expect, it } from "vitest";
import { COMMIT_PX, lockAxis, progress, resist, shouldCommit } from "./swipe";

describe("lockAxis", () => {
  it("is undecided inside the slop", () => {
    expect(lockAxis(4, 3)).toBeNull();
    expect(lockAxis(-9, 9)).toBeNull();
  });

  it("gives a mostly-horizontal drag to the card", () => {
    expect(lockAxis(24, 6)).toBe("x");
    expect(lockAxis(-30, 12)).toBe("x");
  });

  it("gives a mostly-vertical drag to the scroller, even after slop", () => {
    // A diagonal scroll must never move the card sideways.
    expect(lockAxis(12, 40)).toBe("y");
    expect(lockAxis(11, 11)).toBe("y");
  });
});

describe("resist", () => {
  it("is linear up to the threshold and keeps its sign", () => {
    expect(resist(40)).toBe(40);
    expect(resist(-40)).toBe(-40);
    expect(resist(COMMIT_PX)).toBe(COMMIT_PX);
  });

  it("rubber-bands past the threshold", () => {
    const past = resist(COMMIT_PX + 100);
    expect(past).toBeGreaterThan(COMMIT_PX);
    expect(past).toBeLessThan(COMMIT_PX + 100);
    expect(resist(-(COMMIT_PX + 100))).toBe(-past);
  });
});

describe("progress", () => {
  it("runs 0..1 toward the threshold and saturates", () => {
    expect(progress(0)).toBe(0);
    expect(progress(COMMIT_PX / 2)).toBe(0.5);
    expect(progress(-COMMIT_PX * 3)).toBe(1);
  });
});

describe("shouldCommit", () => {
  it("commits on distance in the direction of travel", () => {
    expect(shouldCommit(COMMIT_PX, 0)).toBe("right");
    expect(shouldCommit(-COMMIT_PX, 0)).toBe("left");
  });

  it("commits a fast flick short of the distance", () => {
    expect(shouldCommit(30, 0.9)).toBe("right");
    expect(shouldCommit(-30, -0.9)).toBe("left");
  });

  it("does not commit a slow, short drag", () => {
    expect(shouldCommit(50, 0.1)).toBeNull();
  });

  it("does not commit a flick back toward the origin", () => {
    // Finger went right 50px, then snapped back fast: the release velocity is
    // negative. That is a cancel, not a left swipe.
    expect(shouldCommit(50, -1.2)).toBeNull();
  });

  it("does not commit a flick that never left the slop", () => {
    expect(shouldCommit(4, 2)).toBeNull();
  });
});
