import { describe, expect, it } from "vitest";
import { emptyReason } from "./empty-reason";
import type { FeedEmptyReasonCode } from "./types";

const base = { isLoading: false, papersCount: 0, feedError: null };

// EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb) — the four server-computed
// codes this client build knows about, used to parameterize the "returned
// verbatim" case below without repeating it four times.
const CODES: FeedEmptyReasonCode[] = [
  "sources-unreachable",
  "no-results",
  "no-required-match",
  "already-delivered",
];

describe("emptyReason", () => {
  it("is nothing while loading or when there are papers", () => {
    expect(emptyReason({ ...base, isLoading: true })).toBeNull();
    expect(emptyReason({ ...base, papersCount: 10 })).toBeNull();
  });

  it("keeps an invalid browser intent as a Research-focus requirement", () => {
    expect(emptyReason({ ...base, intentRequired: true })).toBe(
      "intent-required",
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

  // EMPTY-STATE-REASON — the server's own honest reason for an empty paper
  // response, and its precedence against every reason that already existed.
  describe("reasonCode (EMPTY-STATE-REASON)", () => {
    it.each(CODES)("returns %s verbatim when nothing else is loading, non-empty, error or intent-required", (code) => {
      expect(emptyReason({ ...base, reasonCode: code })).toBe(code);
    });

    it("reports a failed fetch as an error even when the server also sent a reasonCode — feedError still wins", () => {
      // Extends the existing "reports a failed fetch as an error" case
      // above: a thrown error and a server-computed code can never both be
      // live for the same real load (a code only ever arrives on a
      // successful 200), but the precedence is coded explicitly here rather
      // than left to accident (guide §3, "what must not change").
      expect(
        emptyReason({
          ...base,
          feedError: "TypeError: Failed to fetch",
          reasonCode: "already-delivered",
        }),
      ).toBe("error");
    });

    it("keeps intent-required ahead of any reasonCode", () => {
      expect(
        emptyReason({ ...base, intentRequired: true, reasonCode: "no-results" }),
      ).toBe("intent-required");
    });

    it("stays null while loading or non-empty, regardless of reasonCode", () => {
      expect(
        emptyReason({ ...base, isLoading: true, reasonCode: "no-results" }),
      ).toBeNull();
      expect(
        emptyReason({ ...base, papersCount: 3, reasonCode: "no-results" }),
      ).toBeNull();
    });

    // The literal "stay silent rather than guess" contract (guide §2): an
    // absent or unrecognized code must fall through to the existing generic
    // sentence, never invent one of the four codes or throw.
    it("falls back to the generic empty state when reasonCode is absent or not one of the known codes — never a guess", () => {
      expect(emptyReason({ ...base, reasonCode: undefined })).toBe("empty");
      expect(
        emptyReason({
          ...base,
          reasonCode: "some-future-code-this-build-does-not-know" as FeedEmptyReasonCode,
        }),
      ).toBe("empty");
    });
  });
});
