import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FeedSync, useFeedSyncStatus } from "./feed-sync";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1aj) — this repo has no
// @testing-library/react and no test anywhere mounts a live effect (see
// web/src/lib/dashboard/use-batch-acknowledgement.test.ts's own header
// note). The actual union-not-replace merge decision (P2/P3) is proven
// directly and headlessly against the store in
// web/src/store/feed.test.ts's "hydrateFromRemote — union, never replace"
// block — FeedSync itself is a thin wrapper around that, entirely inside
// useEffect, which renderToStaticMarkup never runs.

describe("FeedSync — SSR safety", () => {
  it("renders to nothing without throwing", () => {
    expect(() => renderToStaticMarkup(createElement(FeedSync))).not.toThrow();
  });
});

describe("useFeedSyncStatus (P3 — a failed push must be visible, not console-only)", () => {
  it("starts with pushFailed false", () => {
    expect(useFeedSyncStatus.getState().pushFailed).toBe(false);
  });
});
