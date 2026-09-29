import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { defaultProfile } from "@/types";
import { ProfileSync, remoteProfilePayload, useProfileSyncStatus } from "./profile-sync";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1ah/§1aj) — this repo has no
// @testing-library/react and no test anywhere mounts a live effect (see
// web/src/lib/dashboard/use-batch-acknowledgement.test.ts's own header note
// on the same convention, and src/components/account/account-section.test.tsx
// for the presentational-render equivalent). The actual merge DECISION this
// component makes at sign-in (P1) is proven directly and headlessly in
// web/src/lib/profile/merge.test.ts — ProfileSync itself is a thin wrapper
// around that, entirely inside useEffect, which renderToStaticMarkup never
// runs (React server rendering skips effects entirely). What IS testable at
// this component's own boundary without a DOM: it renders without throwing,
// and the small pure/exported pieces it contributes to the fix — the closed
// credential-redaction gap (§1aj) and the visible push-failure status (P3).

describe("ProfileSync — SSR safety", () => {
  it("renders to nothing without throwing", () => {
    expect(() => renderToStaticMarkup(createElement(ProfileSync))).not.toThrow();
  });
});

describe("remoteProfilePayload — credential redaction (§1aj)", () => {
  it("never includes tavily*/adzuna*/usajobs*/feedAi*, even when the local profile holds real values for all of them", () => {
    const profile = {
      ...defaultProfile,
      tavilyEnabled: true,
      tavilyApiKey: "tvly-secret",
      adzunaAppId: "adzuna-id",
      adzunaAppKey: "adzuna-secret",
      usajobsApiKey: "usajobs-secret",
      usajobsUserAgent: "me@example.test",
      feedAiProvider: "openai" as const,
      feedAiApiKey: "sk-secret",
    };
    const payload = remoteProfilePayload(profile);
    for (const key of [
      "tavilyEnabled",
      "tavilyApiKey",
      "adzunaAppId",
      "adzunaAppKey",
      "usajobsApiKey",
      "usajobsUserAgent",
      "feedAiProvider",
      "feedAiApiKey",
    ]) {
      expect(payload).not.toHaveProperty(key);
    }
  });

  it("still carries ordinary profile fields through", () => {
    const profile = {
      ...defaultProfile,
      displayName: "Aspen",
      researchTopics: ["battery materials"],
    };
    const payload = remoteProfilePayload(profile);
    expect(payload.displayName).toBe("Aspen");
    expect(payload.researchTopics).toEqual(["battery materials"]);
  });
});

describe("useProfileSyncStatus (P3 — a failed push must be visible, not console-only)", () => {
  it("starts with pushFailed false", () => {
    expect(useProfileSyncStatus.getState().pushFailed).toBe(false);
  });
});
