import { describe, expect, it } from "vitest";
import { emptyReason } from "./empty-reason";

const base = { isLoading: false, papersCount: 0, topicsCount: 2, feedError: null };

describe("emptyReason", () => {
  it("is nothing while loading or when there are papers", () => {
    expect(emptyReason({ ...base, isLoading: true })).toBeNull();
    expect(emptyReason({ ...base, papersCount: 10 })).toBeNull();
  });

  it("asks for topics before anything else", () => {
    // Even with a stale error around, a reader with no topics is being
    // onboarded, not debugged.
    expect(emptyReason({ ...base, topicsCount: 0, feedError: "boom" })).toBe(
      "no-topics",
    );
  });

  it("reports a failed fetch as an error, not as an empty briefing", () => {
    // The live bug: a dead connection rendered as "0 papers today · synced
    // just now · Set up profile".
    expect(emptyReason({ ...base, feedError: "TypeError: Failed to fetch" })).toBe(
      "error",
    );
  });

  it("calls a clean empty result empty", () => {
    expect(emptyReason(base)).toBe("empty");
  });
});
