import { describe, expect, it } from "vitest";
import { BRIEFING_EMPTY } from "./copy";

// EMPTY-STATE-REASON (ABC-JEV-INTEGRATION.md §1bb.1) — the exact ruled copy
// for the four new empty-state reasons, pinned so a future edit to copy.ts
// changes this deliberately, not by accident. `error`/`empty` are the two
// pre-existing reasons and are asserted here only to the extent this item
// touches them (it doesn't — see the "unchanged" case below).

describe("BRIEFING_EMPTY (EMPTY-STATE-REASON)", () => {
  it("gives sources-unreachable the ruled title and line", () => {
    expect(BRIEFING_EMPTY["sources-unreachable"]).toMatchObject({
      title: "Couldn't reach today's paper sources.",
      line: "Refresh to try again.",
    });
  });

  it("gives no-results today's exact existing words, verbatim — not a new sentence", () => {
    // §1bb.1: "(today's words)". Proven by equality against the pre-existing
    // `empty` entry, not by retyping the string a second time, so the two
    // can never quietly drift apart.
    expect(BRIEFING_EMPTY["no-results"].title).toBe(BRIEFING_EMPTY.empty.title);
    expect(BRIEFING_EMPTY["no-results"].line).toBe(BRIEFING_EMPTY.empty.line);
  });

  // EMPTY-STATE-REASON fix round (§1bb CORRECTION, 2026-09-29T16:5xZ) — the
  // original "...matched your Required topics" was ruled false for two of
  // the three causes this code folds in (the reader's own exclusions, and
  // the review-paper filter, can both remove a paper that DID match).
  // Rewritten to the corrected, true-for-all-three-causes wording; the old
  // assertion below is replaced, not deleted around.
  it("gives no-required-match the corrected, always-true title and line", () => {
    expect(BRIEFING_EMPTY["no-required-match"]).toMatchObject({
      title: "None of today's papers passed your Required topics and filters.",
      line: "Try a broader Required topic in Profile.",
    });
  });

  it("gives already-delivered the ruled title", () => {
    // The ruling (§1bb.1) gave only this one sentence for this code — see
    // copy.ts's own ASSUMPTION comment on this entry for why its line
    // reuses B's guide draft verbatim rather than inventing new wording.
    expect(BRIEFING_EMPTY["already-delivered"].title).toBe(
      "You're caught up on these topics.",
    );
    expect(BRIEFING_EMPTY["already-delivered"].line.length).toBeGreaterThan(0);
  });

  it("leaves the two pre-existing reasons (error, empty) unchanged", () => {
    expect(BRIEFING_EMPTY.error).toMatchObject({
      title: "Couldn’t reach the paper sources.",
      line: "Check your connection, then try again.",
      retry: "Try again",
      edit: "Edit topics",
    });
    expect(BRIEFING_EMPTY.empty).toMatchObject({
      title: "Nothing new for these topics today.",
      line: "Peer only sends what is new and relevant. Refresh to look again, or widen your topics.",
      refresh: "Refresh",
      widen: "Widen topics",
    });
  });

  it("every one of the 6 keys carries a non-empty title and line", () => {
    for (const key of Object.keys(BRIEFING_EMPTY) as (keyof typeof BRIEFING_EMPTY)[]) {
      expect(BRIEFING_EMPTY[key].title.length).toBeGreaterThan(0);
      expect(BRIEFING_EMPTY[key].line.length).toBeGreaterThan(0);
    }
  });
});
