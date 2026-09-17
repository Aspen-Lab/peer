import { describe, expect, it } from "vitest";
import { emptyReason } from "./empty-reason";

const base = { isLoading: false, papersCount: 0, feedError: null };

describe("emptyReason", () => {
  it("is nothing while loading or when there are papers", () => {
    expect(emptyReason({ ...base, isLoading: true })).toBeNull();
    expect(emptyReason({ ...base, papersCount: 10 })).toBeNull();
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
