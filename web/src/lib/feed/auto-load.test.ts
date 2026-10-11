import { describe, expect, it } from "vitest";
import { shouldAutoLoad } from "./auto-load";

// P8-01 (BACKLOG-29 = 22; ABC-DEEP-REPORT-READING-HELPER.md §1h.41 (a)): the
// home page re-requested a failing /api/feed without end, because a failed
// papers load left `topicsKey` (set by a success only) different from
// `autoLoadKey` and cleared the loading flag, so the effect fired again at
// once. The decision is this pure function now; the store's `feedFailedKey`
// is the "key already tried" it is given.
const K = "starter";
const K2 = "topics:battery materials";

describe("shouldAutoLoad — the home page's automatic papers load (P8-01)", () => {
  it("loads a key nothing has been built from and nothing has tried", () => {
    expect(
      shouldAutoLoad({ autoLoadKey: K, topicsKey: null, failedKey: null, loading: false }),
    ).toBe(true);
  });

  it("does not load again after a papers load failed for the key (the loop)", () => {
    expect(
      shouldAutoLoad({ autoLoadKey: K, topicsKey: null, failedKey: K, loading: false }),
    ).toBe(false);
    // Also when older papers for another key are still on screen.
    expect(
      shouldAutoLoad({ autoLoadKey: K, topicsKey: K2, failedKey: K, loading: false }),
    ).toBe(false);
  });

  it("loads a different key once the reader has changed their topics", () => {
    expect(
      shouldAutoLoad({ autoLoadKey: K2, topicsKey: null, failedKey: K, loading: false }),
    ).toBe(true);
    expect(
      shouldAutoLoad({ autoLoadKey: K2, topicsKey: K, failedKey: K, loading: false }),
    ).toBe(true);
  });

  it("does not load a key the shown papers were already built from (a success)", () => {
    expect(
      shouldAutoLoad({ autoLoadKey: K, topicsKey: K, failedKey: null, loading: false }),
    ).toBe(false);
  });

  it("never loads while a load is in flight, or with no key to load", () => {
    expect(
      shouldAutoLoad({ autoLoadKey: K, topicsKey: null, failedKey: null, loading: true }),
    ).toBe(false);
    expect(
      shouldAutoLoad({ autoLoadKey: "", topicsKey: null, failedKey: null, loading: false }),
    ).toBe(false);
  });
});
