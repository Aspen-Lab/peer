import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  mergeProfileAtSignIn,
  mergePreferenceLedger,
  mergeProfileFromBackup,
  stripCredentialFields,
} from "./merge";

// SIGNIN-MERGE (ABC-JEV-INTEGRATION.md §1af/§1ah/§1aj) — RED list §5.1/§5.2
// of docs/jev-abc/SIGNIN-MERGE-B-20260928T025444Z.md, adapted to this repo's
// own testing convention (no @testing-library/react, no simulated effect —
// see use-batch-acknowledgement.test.ts's header note): the merge DECISION
// itself is what needed proving, so it is tested here, directly and
// headlessly, rather than through a mounted <ProfileSync/>.

function profile(overrides: Partial<UserProfile>): UserProfile {
  return { ...defaultProfile, ...overrides };
}

describe("mergeProfileAtSignIn", () => {
  it("makes no change when there is no account row to merge with (never-created row, or a failed pull) — local stays exactly as it is (§1af RED #1, P3)", () => {
    const local = profile({ researchTopics: ["solid-state batteries"], currentProject: "Fast-charging anodes" });
    expect(mergeProfileAtSignIn(local, null)).toEqual({ patch: {} });
  });

  it("unions list fields — account's own order first, then local's additions, deduped case-insensitively — never drops either side (§1af RED #2)", () => {
    const local = profile({ researchTopics: ["Solid-State Batteries", "battery materials"] });
    const remote: Partial<UserProfile> = { researchTopics: ["battery materials", "electrochemistry"] };
    const { patch } = mergeProfileAtSignIn(local, remote);
    // Account's own list first, in its own order — then local's genuinely
    // new entry appended. "battery materials" is on both sides (case
    // differs) and must appear exactly once.
    expect(patch.researchTopics).toEqual(["battery materials", "electrochemistry", "Solid-State Batteries"]);
  });

  it("never overwrites a non-empty local value with an empty remote one, for a list field", () => {
    const local = profile({ softTopics: ["catalysis"] });
    const remote: Partial<UserProfile> = { softTopics: [] };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch.softTopics).toEqual(["catalysis"]);
  });

  it("single-value: remote's real value fills an empty local field", () => {
    const local = profile({ currentProject: undefined });
    const remote: Partial<UserProfile> = { currentProject: "Solid electrolyte interphase" };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch.currentProject).toBe("Solid electrolyte interphase");
  });

  it("single-value: never overwrites a non-empty local value with an empty remote one", () => {
    const local = profile({ currentProject: "Fast-charging anodes" });
    const remote: Partial<UserProfile> = { currentProject: "" };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch.currentProject).toBe("Fast-charging anodes");
  });

  it("single-value: on a genuine conflict (both sides real and different), local wins once", () => {
    const local = profile({ school: "UIUC" });
    const remote: Partial<UserProfile> = { school: "MIT" };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch.school).toBe("UIUC");
  });

  it("single-value: agreeing values pass through untouched", () => {
    const local = profile({ careerStage: "PhD Year 3" });
    const remote: Partial<UserProfile> = { careerStage: "PhD Year 3" };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch.careerStage).toBe("PhD Year 3");
  });

  it("only merges a field the remote payload actually mentions — a field remote is silent on is left out of the patch entirely (not forced to local either)", () => {
    const local = profile({ displayName: "Aspen" });
    const { patch } = mergeProfileAtSignIn(local, {});
    expect(patch).not.toHaveProperty("displayName");
  });

  it("stays out of feed-tuning knobs not named in the §1aj single-value list — existing install-if-defined behaviour is untouched here", () => {
    const local = profile({ feedFocus: "tight" });
    const remote: Partial<UserProfile> = { feedFocus: "balanced" };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch).not.toHaveProperty("feedFocus");
  });

  it("never reads a credential field off remote even if somehow present — structurally excluded from every list", () => {
    const local = profile({ tavilyApiKey: "local-secret" });
    const remote = { tavilyApiKey: "should-never-appear" } as Partial<UserProfile>;
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch).not.toHaveProperty("tavilyApiKey");
  });

  describe("feedIntent — recomputed from merged flat fields, never merged as a nested structure (§4a)", () => {
    it("clears feedIntent when an intent-input list field is merged", () => {
      const local = profile({
        researchTopics: ["a"],
        feedIntent: {
          version: "feed-intent-v1",
          project: { presence: "omitted" },
          challenge: { presence: "omitted" },
          requiredConcepts: ["stale"],
          preferredConcepts: [],
          exclusions: [],
          methods: [],
          selectedSenseConcepts: [],
        },
      });
      const { patch } = mergeProfileAtSignIn(local, { researchTopics: ["b"] });
      expect(patch).toHaveProperty("feedIntent", undefined);
    });

    it("clears feedIntent when an intent-input single-value field is merged", () => {
      const local = profile({ currentProject: "local project" });
      const { patch } = mergeProfileAtSignIn(local, { currentProject: "remote project" });
      expect(patch).toHaveProperty("feedIntent", undefined);
    });

    it("leaves feedIntent out of the patch when nothing intent-related was merged", () => {
      const local = profile({ displayName: "Aspen" });
      const { patch } = mergeProfileAtSignIn(local, { displayName: "Aspen" });
      expect(patch).not.toHaveProperty("feedIntent");
    });
  });
});

describe("mergePreferenceLedger", () => {
  it("unions per key — a key on only one side survives untouched", () => {
    const merged = mergePreferenceLedger(
      { "concept:a": { key: "concept:a", label: "A", source: "openalex_topic", positive: 1, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" } },
      { "concept:b": { key: "concept:b", label: "B", source: "openalex_topic", positive: 2, negative: 0, lastSeenAt: "2026-09-02T00:00:00.000Z" } },
    );
    expect(Object.keys(merged).sort()).toEqual(["concept:a", "concept:b"]);
  });

  it("on a shared key, keeps whichever entry is genuinely more recent", () => {
    const older = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" };
    const newer = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 5, negative: 0, lastSeenAt: "2026-09-20T00:00:00.000Z" };
    expect(mergePreferenceLedger({ "concept:a": older }, { "concept:a": newer })["concept:a"]).toEqual(newer);
    expect(mergePreferenceLedger({ "concept:a": newer }, { "concept:a": older })["concept:a"]).toEqual(newer);
  });

  it("keeps local on an exact timestamp tie", () => {
    const remote = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" };
    const local = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 9, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" };
    expect(mergePreferenceLedger({ "concept:a": remote }, { "concept:a": local })["concept:a"]).toEqual(local);
  });

  it("keeps local when neither entry has a usable timestamp", () => {
    const remote = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "" };
    const local = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 9, negative: 0, lastSeenAt: "" };
    expect(mergePreferenceLedger({ "concept:a": remote }, { "concept:a": local })["concept:a"]).toEqual(local);
  });
});

// SIGNIN-MERGE (§1af/§4b/§1aj) — P4 "restore from a backup file": a
// deliberately DIFFERENT merge direction from P1 — "backup wins single
// values, union lists" (no "local wins once" conflict rule for scalars,
// since restoring a named file is itself the deliberate user action).
describe("stripCredentialFields", () => {
  it("removes all six credential-like fields, even when every one is present with a real value", () => {
    const stripped = stripCredentialFields({
      displayName: "Aspen",
      tavilyApiKey: "tvly-secret",
      adzunaAppId: "adzuna-id",
      adzunaAppKey: "adzuna-secret",
      usajobsApiKey: "usajobs-secret",
      usajobsUserAgent: "me@example.test",
      feedAiApiKey: "sk-secret",
    });
    expect(stripped).toEqual({ displayName: "Aspen" });
  });
});

describe("mergeProfileFromBackup", () => {
  it("strips credentials again itself, even if a caller forgot to", () => {
    const local = profile({});
    const { patch } = mergeProfileFromBackup(local, {
      displayName: "Restored Name",
      tavilyApiKey: "tvly-secret",
      adzunaAppKey: "adzuna-secret",
      usajobsApiKey: "usajobs-secret",
      feedAiApiKey: "sk-secret",
    });
    expect(patch).not.toHaveProperty("tavilyApiKey");
    expect(patch).not.toHaveProperty("adzunaAppKey");
    expect(patch).not.toHaveProperty("usajobsApiKey");
    expect(patch).not.toHaveProperty("feedAiApiKey");
    expect(patch.displayName).toBe("Restored Name");
  });

  it("backup wins outright for a single-value field, even overriding a non-empty local value (no P1-style conflict rule here)", () => {
    const local = profile({ school: "UIUC" });
    const { patch } = mergeProfileFromBackup(local, { school: "An older school from the backup" });
    expect(patch.school).toBe("An older school from the backup");
  });

  it("unions list fields — the backup does not silently drop a topic added since it was taken", () => {
    const local = profile({ researchTopics: ["battery materials", "added after the backup"] });
    const { patch } = mergeProfileFromBackup(local, { researchTopics: ["battery materials", "from the backup"] });
    expect(patch.researchTopics).toEqual(["battery materials", "from the backup", "added after the backup"]);
  });

  it("unions preferenceLedger per key, same recency rule as the sign-in merge", () => {
    const local = profile({
      preferenceLedger: {
        "concept:a": { key: "concept:a", label: "A", source: "openalex_topic", positive: 9, negative: 0, lastSeenAt: "2026-09-20T00:00:00.000Z" },
      },
    });
    const { patch } = mergeProfileFromBackup(local, {
      preferenceLedger: {
        "concept:a": { key: "concept:a", label: "A", source: "openalex_topic", positive: 1, negative: 0, lastSeenAt: "2026-08-27T00:00:00.000Z" },
        "concept:b": { key: "concept:b", label: "B", source: "openalex_topic", positive: 1, negative: 0, lastSeenAt: "2026-08-27T00:00:00.000Z" },
      },
    });
    // The backup's entry for "concept:a" is OLDER than what's already
    // learned locally, so local's more recent entry survives; "concept:b"
    // only exists in the backup, so it comes back too.
    expect(patch.preferenceLedger?.["concept:a"]?.positive).toBe(9);
    expect(patch.preferenceLedger?.["concept:b"]?.positive).toBe(1);
  });

  it("clears feedIntent when the backup restores an intent-input field, forcing a fresh recompute", () => {
    const local = profile({ currentProject: "current project" });
    const { patch } = mergeProfileFromBackup(local, { currentProject: "restored project" });
    expect(patch).toHaveProperty("feedIntent", undefined);
  });

  it("leaves a field the backup doesn't mention completely out of the patch", () => {
    const local = profile({ displayName: "Aspen" });
    const { patch } = mergeProfileFromBackup(local, { school: "UIUC" });
    expect(patch).not.toHaveProperty("displayName");
  });

  it("counts exactly the fields the backup actually contributed, for the restore control's one-line summary", () => {
    const local = profile({});
    const { restoredFieldCount } = mergeProfileFromBackup(local, {
      displayName: "Aspen",
      school: "UIUC",
      researchTopics: ["battery materials"],
    });
    expect(restoredFieldCount).toBe(3);
  });

  it("a file containing only credential fields restores nothing (count 0, empty patch)", () => {
    const local = profile({});
    const { patch, restoredFieldCount } = mergeProfileFromBackup(local, {
      tavilyApiKey: "tvly-secret",
      feedAiApiKey: "sk-secret",
    });
    expect(patch).toEqual({});
    expect(restoredFieldCount).toBe(0);
  });
});
