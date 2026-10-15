import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn() }));

// The sync talks to the account through `apiFetch` alone; the real `ApiError` stays (the store
// that this file imports transitively uses it).
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  apiFetch: mocks.apiFetch,
}));

import { FeedSync, pushLocalSignals, savedPapersFromRows, useFeedSyncStatus } from "./feed-sync";

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

// P9-31 (C1 of stopping jobs and events, the owner's decision §1a.18 (f); B P9-26 §5, rulings
// §1h.60). The two halves of the sign-in sync are exported so they can be run headlessly, the way
// this repo tests an effect: what goes up is papers and read marks only, and what comes down is
// papers only.
const paper: Paper = {
  id: "openalex:W1",
  title: "A saved paper",
  authors: ["Researcher"],
  relevanceReason: "Matches.",
  venue: "Example Journal",
  source: "other",
  summaryIntro: "Intro.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "Result.",
  isSaved: true,
};

describe("FeedSync — papers only (P9-31)", () => {
  beforeEach(() => {
    mocks.apiFetch.mockReset();
    mocks.apiFetch.mockResolvedValue({ ok: true });
  });

  it("pushes saved papers and read marks to the account, and nothing else", async () => {
    // A device whose store still held a saved event and a saved job (an older build's) — the
    // function reads only the two fields it pushes, so neither can reach a request.
    const legacyDevice = {
      savedPapers: [paper],
      readItems: { "openalex:W1": true as const },
      savedEvents: [{ id: "evt-1", name: "Materials Conference" }],
      savedJobs: [{ id: "job-1", roleTitle: "Battery Engineer" }],
    };

    const results = await pushLocalSignals(legacyDevice);

    expect(results.map((r) => (r.status === "fulfilled" ? r.value : "rejected"))).toEqual([true, true]);
    const calls = mocks.apiFetch.mock.calls.map(([path, init]) => ({
      path,
      method: (init as RequestInit).method,
      body: JSON.parse(String((init as RequestInit).body)),
    }));
    expect(calls).toEqual([
      { path: "/api/saved", method: "POST", body: { itemId: "openalex:W1", itemKind: "paper", payload: paper } },
      { path: "/api/read", method: "POST", body: { itemId: "openalex:W1" } },
    ]);
    const wire = JSON.stringify(mocks.apiFetch.mock.calls);
    for (const needle of ["evt-1", "job-1", "Battery Engineer", "Materials Conference"]) {
      expect(wire, needle).not.toContain(needle);
    }
  });

  it("sends nothing for a device with nothing saved or read", async () => {
    expect(await pushLocalSignals({ savedPapers: [], readItems: {} })).toEqual([]);
    expect(mocks.apiFetch).not.toHaveBeenCalled();
  });

  it("keeps only the papers of what the account answers, even from a server that still sends events and jobs", () => {
    const rows = [
      { itemId: "evt-1", itemKind: "event", payload: { id: "evt-1", name: "Materials Conference" }, savedAt: "2026-10-01T00:00:00Z" },
      { itemId: "openalex:W1", itemKind: "paper", payload: paper, savedAt: "2026-10-02T00:00:00Z" },
      { itemId: "job-1", itemKind: "job", payload: { id: "job-1", roleTitle: "Battery Engineer" }, savedAt: "2026-10-03T00:00:00Z" },
    ];

    expect(savedPapersFromRows(rows)).toEqual([paper]);
  });

  it("tells a failed pull (undefined: nothing to merge from) from an empty account (an empty list)", () => {
    expect(savedPapersFromRows(null)).toBeUndefined();
    expect(savedPapersFromRows([])).toEqual([]);
  });
});
