import { describe, expect, it } from "vitest";
import { defaultProfile, type UserProfile } from "@/types";
import {
  mergeProfileAtSignIn,
  mergePreferenceLedger,
  mergeProfileFromBackup,
  stripCredentialFields,
  dirtySingleValueFields,
  singleValueSnapshot,
  listUnionChanged,
  preferenceLedgerChanged,
  threeWayMergeList,
  LIST_FIELDS,
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

  // PROFILE-SYNC (§1bk.8 AMENDMENT): this used to prove feedFocus (a "feed
  // knob") stayed OUTSIDE the single-value merge. That premise is exactly
  // what the amendment overturns — feedFocus is now IN SINGLE_VALUE_FIELDS
  // (it has a real server column an unconditional push could overwrite),
  // so it is covered by the "(a) fresh device"/"(d) two devices" tests
  // below instead. What genuinely stays outside the merge is a field with
  // NO server column at all — deepReportEnabled, confirmed absent from both
  // ProfileRow and profilePatchToRow in web/src/app/api/profile/route.ts
  // (checkpoint §11.1) — so pushing it unconditionally cannot overwrite
  // anything on the account, and the existing install-if-defined behaviour
  // for it is genuinely untouched.
  it("stays out of the single-value merge when a field has no server column at all to protect (deepReportEnabled) — existing install-if-defined behaviour is untouched there", () => {
    const local = profile({ deepReportEnabled: false });
    const remote: Partial<UserProfile> = { deepReportEnabled: true };
    const { patch } = mergeProfileAtSignIn(local, remote);
    expect(patch).not.toHaveProperty("deepReportEnabled");
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

// PROFILE-SYNC (ABC-JEV-INTEGRATION.md §1bk) — the FOLLOW-UP section of
// docs/jev-abc/ACCOUNT-SESSION-SYNC-B-20260929T220146Z.md proved the merge
// above ping-pongs a stale device's OWN old value back over a newer real
// account edit, on every reload — "local wins once" was a per-call rule,
// not a per-account rule. `defaultProfile` ships non-empty placeholders for
// 8 single-value fields (displayName "Peer Member", careerStage
// "PhD Year 3", industryVsAcademia "both", phdYear 3, colorTheme
// "system:ember", digestHourLocal 8, digestChannel "inapp", digestFrequency
// "daily"), which the old rule could not tell apart from a genuine edit.
// These cases are built on the REAL `defaultProfile` (the existing suite's
// blind spot per B's Task 2 finding: every prior "local wins" case above
// uses a field whose factory default is empty/undefined, never the actual
// untouched defaultProfile object).

describe("dirtySingleValueFields (§1bk)", () => {
  it("is empty for a completely untouched profile — a fresh device has nothing dirty to push", () => {
    expect(dirtySingleValueFields(defaultProfile, null).size).toBe(0);
  });

  it("bootstrap rule (no lastSynced yet): local differs from defaultProfile → dirty", () => {
    const local = profile({ displayName: "Alice Chen" });
    expect(dirtySingleValueFields(local, null).has("displayName")).toBe(true);
  });

  it("bootstrap rule (no lastSynced yet): local equals defaultProfile → not dirty", () => {
    const local = profile({ displayName: defaultProfile.displayName });
    expect(dirtySingleValueFields(local, null).has("displayName")).toBe(false);
  });

  it("with a lastSynced entry: local still equals what it last confirmed → not dirty, even though it differs from defaultProfile", () => {
    const local = profile({ careerStage: "Postdoc" });
    expect(dirtySingleValueFields(local, { careerStage: "Postdoc" }).has("careerStage")).toBe(false);
  });

  it("with a lastSynced entry: local has moved on from what it last confirmed → dirty", () => {
    const local = profile({ careerStage: "Postdoc" });
    expect(dirtySingleValueFields(local, { careerStage: "PhD Year 5" }).has("careerStage")).toBe(true);
  });

  it("judges each field independently", () => {
    const local = profile({ displayName: "Alice Chen", careerStage: "Postdoc" });
    const lastSynced: Partial<UserProfile> = { displayName: "Alice Chen", careerStage: "PhD Year 5" };
    const dirty = dirtySingleValueFields(local, lastSynced);
    expect(dirty.has("displayName")).toBe(false);
    expect(dirty.has("careerStage")).toBe(true);
  });

  it("a lastSynced object with no entry at all for a field falls back to the bootstrap rule for that field specifically", () => {
    const local = profile({ displayName: "Alice Chen", careerStage: defaultProfile.careerStage });
    const dirty = dirtySingleValueFields(local, { displayName: "Alice Chen" }); // no careerStage entry
    expect(dirty.has("displayName")).toBe(false); // matches its own lastSynced entry
    expect(dirty.has("careerStage")).toBe(false); // matches defaultProfile — bootstrap, not dirty
  });
});

describe("mergeProfileAtSignIn — dirty-tracked merge (§1bk, supersedes the bare 'local wins once' rule)", () => {
  it("(a) fresh device with factory defaults takes the account's real values for every originally-affected field", () => {
    const local = { ...defaultProfile };
    const remote: Partial<UserProfile> = {
      displayName: "Alice Chen",
      careerStage: "Postdoc",
      industryVsAcademia: "academia",
      phdYear: 5,
      colorTheme: "dark:rose",
      digestHourLocal: 19,
      digestChannel: "email",
      digestFrequency: "weekly",
    };
    const { patch } = mergeProfileAtSignIn(local, remote, null);
    expect(patch.displayName).toBe("Alice Chen");
    expect(patch.careerStage).toBe("Postdoc");
    expect(patch.industryVsAcademia).toBe("academia");
    expect(patch.phdYear).toBe(5);
    expect(patch.colorTheme).toBe("dark:rose");
    expect(patch.digestHourLocal).toBe(19);
    expect(patch.digestChannel).toBe("email");
    expect(patch.digestFrequency).toBe("weekly");
  });

  it("(a continued) — dirtySingleValueFields confirms nothing on this device was ever dirty, i.e. nothing above was a device edit to protect", () => {
    expect(dirtySingleValueFields(defaultProfile, null).size).toBe(0);
  });

  it("(b) a stale previously-synced device takes the account's newer value instead of ping-ponging its own old one back", () => {
    const local = profile({ displayName: "Alice", digestChannel: "email" });
    const lastSynced: Partial<UserProfile> = { displayName: "Alice", digestChannel: "email" }; // this device's own last-confirmed values
    const remote: Partial<UserProfile> = { displayName: "Alice V2", digestChannel: "both" };
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.displayName).toBe("Alice V2");
    expect(patch.digestChannel).toBe("both");
  });

  it("(b continued) repeating the same stale call again still adopts the account's value — no ping-pong across repeated loads", () => {
    const local = profile({ displayName: "Alice" });
    const lastSynced: Partial<UserProfile> = { displayName: "Alice" };
    const remote: Partial<UserProfile> = { displayName: "Alice V2" };
    expect(mergeProfileAtSignIn(local, remote, lastSynced).patch.displayName).toBe("Alice V2");
    expect(mergeProfileAtSignIn(local, remote, lastSynced).patch.displayName).toBe("Alice V2");
  });

  it("a genuine, not-yet-synced local edit still wins over whatever the account currently has (dirty relative to lastSynced)", () => {
    const local = profile({ displayName: "Alice V3" }); // edited on this device since its last sync
    const lastSynced: Partial<UserProfile> = { displayName: "Alice" }; // what this device last confirmed
    const remote: Partial<UserProfile> = { displayName: "Alice V2" }; // a DIFFERENT device's edit, already on the account
    expect(mergeProfileAtSignIn(local, remote, lastSynced).patch.displayName).toBe("Alice V3");
  });

  it("(d) two devices editing different fields both land — this device's own dirty field wins, the field it never touched takes the account's value", () => {
    const local = profile({ displayName: "Alice V2", digestChannel: "email" });
    const lastSynced: Partial<UserProfile> = { displayName: "Alice", digestChannel: "email" };
    const remote: Partial<UserProfile> = { displayName: "Alice", digestChannel: "both" }; // the OTHER device's edit
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.displayName).toBe("Alice V2");
    expect(patch.digestChannel).toBe("both");
  });

  it("(e) the same field edited on two devices — whichever device's sync completes last wins (matches today's steady-state last-write-wins, not a regression)", () => {
    // Device X already pushed "Bob". Device Y is about to reconcile with
    // its own, more recent, not-yet-confirmed edit "Carol".
    const local = profile({ displayName: "Carol" });
    const lastSynced: Partial<UserProfile> = { displayName: "Alice" }; // device Y's own last-confirmed value, before ITS edit
    const remote: Partial<UserProfile> = { displayName: "Bob" }; // device X's edit, already on the account
    expect(mergeProfileAtSignIn(local, remote, lastSynced).patch.displayName).toBe("Carol");
  });

  it("(transition, recovery) a device still holding the real value restores it over a default-corrupted account, on its first post-fix load", () => {
    const local = profile({ displayName: "Alice Chen" }); // real value, never yet run through the fixed code (no lastSynced)
    const remote: Partial<UserProfile> = { displayName: defaultProfile.displayName }; // corrupted to the placeholder by the old bug
    expect(mergeProfileAtSignIn(local, remote, null).patch.displayName).toBe("Alice Chen");
  });

  it("(transition, default-only device) a device that never edited anything never disturbs a value another device just restored", () => {
    const local = { ...defaultProfile }; // never touched, no lastSynced
    const remote: Partial<UserProfile> = { displayName: "Alice Chen" }; // just restored by the other device
    expect(mergeProfileAtSignIn(local, remote, null).patch.displayName).toBe("Alice Chen");
  });

  // PROFILE-SYNC (§1bk.8 AMENDMENT) — the manager's check of round 1: the
  // dirty rule covered only the original 14 single-value fields, so a
  // fresh or stale device could still overwrite the account's feed knobs
  // (feedFocus, feedFreshness, paperCount, feedSourceMix, feedImportance,
  // feedMethodMode, feedDiscoveryMode, the three feedAvoid* switches) and
  // digestEnabled. These mirror scenarios (a)/(b) above exactly, for the
  // amendment's 11 fields.
  it("(amendment, fresh device) a fresh device with default feed knobs takes the account's real values for them", () => {
    const local = { ...defaultProfile };
    const remote: Partial<UserProfile> = {
      paperCount: 5,
      feedAvoidReviews: false,
      digestEnabled: false,
      feedFocus: "tight",
      feedFreshness: "month",
      feedSourceMix: "preprints",
      feedImportance: "highlyCited",
      feedMethodMode: "mustMatch",
      feedDiscoveryMode: "adjacent",
      feedAvoidOldPapers: true,
      feedAvoidBroadSurveys: false,
    };
    const { patch } = mergeProfileAtSignIn(local, remote, null);
    expect(patch.paperCount).toBe(5);
    expect(patch.feedAvoidReviews).toBe(false);
    expect(patch.digestEnabled).toBe(false);
    expect(patch.feedFocus).toBe("tight");
    expect(patch.feedFreshness).toBe("month");
    expect(patch.feedSourceMix).toBe("preprints");
    expect(patch.feedImportance).toBe("highlyCited");
    expect(patch.feedMethodMode).toBe("mustMatch");
    expect(patch.feedDiscoveryMode).toBe("adjacent");
    expect(patch.feedAvoidOldPapers).toBe(true);
    expect(patch.feedAvoidBroadSurveys).toBe(false);
  });

  it("(amendment, stale device) a stale device with an older paperCount/feedAvoidReviews takes the account's newer value instead of ping-ponging its own old one back", () => {
    const local = profile({ paperCount: 10, feedAvoidReviews: true }); // this device's old values
    const lastSynced: Partial<UserProfile> = { paperCount: 10, feedAvoidReviews: true }; // what it last confirmed
    const remote: Partial<UserProfile> = { paperCount: 5, feedAvoidReviews: false }; // the account's newer values
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.paperCount).toBe(5);
    expect(patch.feedAvoidReviews).toBe(false);
    // Neither field is dirty relative to lastSynced, so neither would be
    // pushed back at the account — proven directly on the dirty set too.
    const dirty = dirtySingleValueFields(local, lastSynced);
    expect(dirty.has("paperCount")).toBe(false);
    expect(dirty.has("feedAvoidReviews")).toBe(false);
  });
});

// LIST-REMOVAL-SYNC (ABC-JEV-INTEGRATION.md §1bq) — a removal on one device
// must stick across every other device instead of coming back through plain
// union the moment another device that still holds the old item loads.
// `threeWayMergeList`'s own decision table proven directly first (the 7-row
// table in its own doc comment), then through the real `mergeProfileAtSignIn`.
describe("threeWayMergeList (§1bq.1)", () => {
  it("keeps an item present in base, remote and local — untouched by anyone", () => {
    expect(threeWayMergeList(["a"], ["a"], ["a"])).toEqual(["a"]);
  });

  it("drops an item removed HERE (in base and remote, not local)", () => {
    expect(threeWayMergeList(["a", "b"], ["a"], ["a", "b"])).toEqual(["a"]);
  });

  it("drops an item removed ELSEWHERE (in base and local, not remote) — adopts the other side's removal instead of resurrecting it", () => {
    expect(threeWayMergeList(["a"], ["a", "b"], ["a", "b"])).toEqual(["a"]);
  });

  it("keeps an item missing from base but present on remote only", () => {
    expect(threeWayMergeList(["a", "new-remote"], ["a"], ["a"])).toEqual(["a", "new-remote"]);
  });

  it("keeps an item missing from base but present on local only — a genuine new addition", () => {
    expect(threeWayMergeList(["a"], ["a", "new-local"], ["a"])).toEqual(["a", "new-local"]);
  });

  it("with no base at all, reduces to exactly plain union — the accepted cost, with no special-case branch needed", () => {
    expect(threeWayMergeList(["a", "b"], ["b", "c"], undefined)).toEqual(["a", "b", "c"]);
    expect(threeWayMergeList(["a", "b"], ["b", "c"], [])).toEqual(["a", "b", "c"]);
  });

  it("order: remote's own order first, then local's genuinely-new items in local's own order — unchanged from unionStrings", () => {
    expect(threeWayMergeList(["z", "a"], ["a", "m"], ["a"])).toEqual(["z", "a", "m"]);
  });

  it("compares by the same normalized key unionStrings uses (trim + toLocaleLowerCase) — for keeping AND for dropping", () => {
    expect(
      threeWayMergeList(
        ["Solid-State Electrolytes"],
        ["  solid-state electrolytes  "],
        ["Solid-State Electrolytes"],
      ),
    ).toEqual(["Solid-State Electrolytes"]);
    // A case/whitespace-only difference is the SAME item for a REMOVAL too —
    // dropped from remote's own base-held copy, not treated as two items.
    expect(threeWayMergeList([], ["  Solid-State Electrolytes "], ["solid-state electrolytes"])).toEqual([]);
  });

  it("a stale, UNEDITED device (local === base) never shrinks the account's newer, longer list (§1bk.8's guarantee, extended to lists)", () => {
    const base = ["a", "b"];
    const local = ["a", "b"]; // this device never touched the list since its last sync
    const remote = ["a", "b", "c"]; // another device added "c" since
    expect(threeWayMergeList(remote, local, base)).toEqual(["a", "b", "c"]);
  });
});

describe("mergeProfileAtSignIn — three-way list merge (§1bq)", () => {
  it("a removal on THIS device sticks on its own next load — the account already reflects it, this device's push already confirmed it", () => {
    const local = profile({ researchTopics: ["alpha"] }); // this device already removed "beta" itself
    const remote: Partial<UserProfile> = { researchTopics: ["alpha"] }; // the account already reflects the removal (this device's own earlier push)
    const lastSynced: Partial<UserProfile> = { researchTopics: ["alpha", "beta"] }; // this device's own last-confirmed snapshot, from before the removal
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.researchTopics).toEqual(["alpha"]);
  });

  it("device 2 (still holding a since-removed item, never edited it) adopts the removal instead of resurrecting it on load — the exact bug LIST-REMOVAL-SYNC fixes", () => {
    const local = profile({ researchTopics: ["alpha", "beta"] }); // device 2 never touched this list
    const remote: Partial<UserProfile> = { researchTopics: ["alpha"] }; // device 1 removed "beta" and pushed
    const lastSynced: Partial<UserProfile> = { researchTopics: ["alpha", "beta"] }; // device 2's own last sync, before the removal
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.researchTopics).toEqual(["alpha"]); // NOT ["alpha", "beta"] — the old (plain-union) bug
  });

  it("an addition still reaches a device that has not edited this field — unchanged direction, still safe", () => {
    const local = profile({ researchTopics: ["alpha"] });
    const remote: Partial<UserProfile> = { researchTopics: ["alpha", "gamma"] }; // another device added "gamma"
    const lastSynced: Partial<UserProfile> = { researchTopics: ["alpha"] };
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch.researchTopics).toEqual(["alpha", "gamma"]);
  });

  // LIST-REMOVAL-SYNC (§1bq.2) — MANAGER ADDITION, binding: "no information"
  // is not "empty". softTopics is derived only from feed_intent — a row
  // with no card returns it as an own property with value `undefined` (not
  // an array; profileRowToProfile always assigns the key). Neither must be
  // treated as a confirmed-empty remote list, or a naive three-way merge
  // would classify every base-held item as "removed elsewhere" and wipe it.
  it("(§1bq.2) softTopics on a row with no feed_intent card is 'no information' — local survives untouched, even with a base that once held less", () => {
    const local = profile({ softTopics: ["catalysis", "battery recycling"] });
    // hasOwnProperty is true, value is undefined — exactly profileRowToProfile's
    // shape (route.ts: `softTopics: intent?.preferredConcepts`) when no card exists.
    const remote = { softTopics: undefined } as unknown as Partial<UserProfile>;
    const lastSynced: Partial<UserProfile> = { softTopics: ["catalysis"] }; // this device's own prior, smaller base
    const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(patch).not.toHaveProperty("softTopics"); // left out entirely — local's CURRENT value survives as-is, nothing dropped
  });

  it("(§1bq.2) preferredJournals with no column at all (never an own property on remote) survives a second AND a third load", () => {
    const local = profile({ preferredJournals: ["Advanced Materials", "Nature Energy"] });
    const remote: Partial<UserProfile> = {}; // remote never mentions preferredJournals — no column, per route.ts (profileRowToProfile never assigns this key)
    const lastSynced: Partial<UserProfile> = { preferredJournals: ["Advanced Materials"] };
    const second = mergeProfileAtSignIn(local, remote, lastSynced);
    expect(second.patch).not.toHaveProperty("preferredJournals");
    const third = mergeProfileAtSignIn(local, remote, lastSynced); // same inputs again — nothing about the account ever changes this field, since it has no column
    expect(third.patch).not.toHaveProperty("preferredJournals");
  });

  it("all 7 LIST_FIELDS behave the same way — table-driven over the exported array, not just researchTopics/softTopics", () => {
    for (const field of LIST_FIELDS) {
      const local = profile({ [field]: ["kept-item"] } as Partial<UserProfile>);
      const remote = { [field]: ["kept-item"] } as Partial<UserProfile>;
      const lastSynced = { [field]: ["kept-item", "removed-elsewhere"] } as Partial<UserProfile>;
      const { patch } = mergeProfileAtSignIn(local, remote, lastSynced);
      expect((patch as Record<string, unknown>)[field]).toEqual(["kept-item"]);
    }
  });
});

describe("listUnionChanged (§1bk ruling 2)", () => {
  it("is false when the union added nothing beyond remote's own list", () => {
    expect(listUnionChanged(["a", "b"], ["a", "b"])).toBe(false);
  });
  it("is true when the union added a genuinely new local entry", () => {
    expect(listUnionChanged(["a"], ["a", "b"])).toBe(true);
  });
  it("treats a missing/null remote as empty — any local content counts as a change; no local content does not", () => {
    expect(listUnionChanged(undefined, ["a"])).toBe(true);
    expect(listUnionChanged(null, [])).toBe(false);
  });
});

describe("singleValueSnapshot (§1bk, widened by §1bk.8 AMENDMENT and again by LIST-REMOVAL-SYNC §1bq.1)", () => {
  it("picks exactly SINGLE_VALUE_FIELDS — the original 14 plus the amendment's 11 feed knobs/digestEnabled — nothing else", () => {
    const snap = singleValueSnapshot(
      profile({ researchTopics: ["x"], displayName: "Alice", feedFocus: "tight", digestEnabled: false }),
    );
    expect(snap.displayName).toBe("Alice");
    // PROFILE-SYNC (§1bk.8 AMENDMENT): feedFocus/digestEnabled are now
    // tracked single-value fields — this assertion is the exact reverse of
    // round 1's (round 1 asserted `not.toHaveProperty("digestEnabled")`,
    // which the amendment overturns).
    expect(snap.feedFocus).toBe("tight");
    expect(snap.digestEnabled).toBe(false);
    // LIST-REMOVAL-SYNC (§1bq.1) — CHANGED: `singleValueSnapshot` now folds
    // in every LIST_FIELDS key too (the three-way merge's own per-device
    // "base"), so this is the exact REVERSE of the old assertion here
    // (`not.toHaveProperty("researchTopics")`) — deliberately overturned,
    // not weakened: the new assertion is strictly more specific (an exact
    // value, not just presence).
    expect(snap.researchTopics).toEqual(["x"]);
    expect(snap).not.toHaveProperty("preferenceLedger"); // its own structure, not single-value
    // deepReportEnabled has no server column at all (checkpoint §11.1) —
    // genuinely outside SINGLE_VALUE_FIELDS, not merely unset here.
    expect(snap).not.toHaveProperty("deepReportEnabled");
  });

  // LIST-REMOVAL-SYNC (§1bq.1) — the new behaviour, proven directly: every
  // LIST_FIELDS key is captured verbatim, not just researchTopics above.
  it("(§1bq.1) also captures every LIST_FIELDS key verbatim — the three-way merge's per-device base", () => {
    const snap = singleValueSnapshot(
      profile({
        researchTopics: ["required-a"],
        softTopics: ["explore-a"],
        preferredMethods: ["DFT"],
        locationPreferences: ["Chicago"],
        authorisedCountries: ["Canada"],
        dislikedTopics: ["avoid-a"],
        preferredJournals: ["Advanced Materials"],
      }),
    );
    expect(snap.researchTopics).toEqual(["required-a"]);
    expect(snap.softTopics).toEqual(["explore-a"]);
    expect(snap.preferredMethods).toEqual(["DFT"]);
    expect(snap.locationPreferences).toEqual(["Chicago"]);
    expect(snap.authorisedCountries).toEqual(["Canada"]);
    expect(snap.dislikedTopics).toEqual(["avoid-a"]);
    expect(snap.preferredJournals).toEqual(["Advanced Materials"]);
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

  // PROFILE-SYNC (§1bk.8 AMENDMENT) — "prove with a test that a stale
  // device cannot shrink or roll back the account's copy." A stale/
  // incomplete local ledger (missing keys the account already has, and
  // holding only an OLDER entry for a key both sides share) must never
  // cause the merge OUTPUT to lose any of the account's own entries.
  it("(§1bk.8 AMENDMENT) a stale, incomplete local ledger never drops a key present in the account's copy — the merge output is always a superset of remote's keys", () => {
    const remoteLedger = {
      "concept:a": { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 5, negative: 0, lastSeenAt: "2026-09-20T00:00:00.000Z" },
      "concept:b": { key: "concept:b", label: "B", source: "openalex_topic" as const, positive: 3, negative: 0, lastSeenAt: "2026-09-15T00:00:00.000Z" },
      "concept:c": { key: "concept:c", label: "C", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-10T00:00:00.000Z" },
    };
    // Device Y is stale: it never learned about "concept:c" at all, and
    // its own "concept:a" entry is an OLDER snapshot than the account's.
    const staleLocalLedger = {
      "concept:a": { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" },
    };
    const merged = mergePreferenceLedger(remoteLedger, staleLocalLedger);
    expect(Object.keys(merged).sort()).toEqual(["concept:a", "concept:b", "concept:c"]);
    expect(merged["concept:a"].positive).toBe(5); // the account's newer entry, not the stale one
    expect(merged["concept:b"]).toEqual(remoteLedger["concept:b"]); // untouched, survives
    expect(merged["concept:c"]).toEqual(remoteLedger["concept:c"]); // untouched, survives
  });
});

describe("preferenceLedgerChanged (§1bk.8 AMENDMENT)", () => {
  const entryA = { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 5, negative: 0, lastSeenAt: "2026-09-20T00:00:00.000Z" };

  it("is false when the merged ledger equals remote's own — nothing to push", () => {
    expect(preferenceLedgerChanged({ "concept:a": entryA }, { "concept:a": entryA })).toBe(false);
  });

  it("is false for two structurally-empty ledgers, regardless of null/undefined/{}", () => {
    expect(preferenceLedgerChanged(undefined, {})).toBe(false);
    expect(preferenceLedgerChanged(null, undefined)).toBe(false);
  });

  it("is true when local contributed a genuinely new key beyond remote's own", () => {
    const entryB = { key: "concept:b", label: "B", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-01T00:00:00.000Z" };
    expect(
      preferenceLedgerChanged({ "concept:a": entryA }, { "concept:a": entryA, "concept:b": entryB }),
    ).toBe(true);
  });

  it("is true when a shared key's entry actually differs (a genuinely more recent local update)", () => {
    const updated = { ...entryA, positive: 9, lastSeenAt: "2026-09-25T00:00:00.000Z" };
    expect(preferenceLedgerChanged({ "concept:a": entryA }, { "concept:a": updated })).toBe(true);
  });

  it("(§1bk.8 AMENDMENT) after a stale device's merge, the RESULT differs from remote (so it correctly gets pushed) even though the merge itself never lost any of remote's keys", () => {
    const remoteLedger = { "concept:a": entryA };
    const staleLocalLedger = {
      "concept:a": { key: "concept:a", label: "A", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "" },
      "concept:new": { key: "concept:new", label: "New", source: "openalex_topic" as const, positive: 1, negative: 0, lastSeenAt: "2026-09-26T00:00:00.000Z" },
    };
    const merged = mergePreferenceLedger(remoteLedger, staleLocalLedger);
    expect(preferenceLedgerChanged(remoteLedger, merged)).toBe(true); // concept:new is real, local-only content
  });

  it("after a device that contributed NOTHING new reconciles, the result equals remote — correctly excluded from the push", () => {
    const remoteLedger = { "concept:a": entryA };
    const local = { "concept:a": { ...entryA } }; // identical, nothing new or newer
    const merged = mergePreferenceLedger(remoteLedger, local);
    expect(preferenceLedgerChanged(remoteLedger, merged)).toBe(false);
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

  // LIST-REMOVAL-SYNC (§1bq) — pins the direction a restore depends on that
  // is the exact OPPOSITE of the three-way merge's "removed here" rule: an
  // item present ONLY in the backup (not in the live local profile at all —
  // e.g. removed on purpose sometime after the backup was taken) must come
  // BACK. `mergeProfileFromBackup` is NOT routed through `threeWayMergeList`
  // (see this function's own header note, restated above the describe
  // block) — if it ever were, using this device's own `lastSynced` as a
  // base, this exact item would be classified "removed HERE" and dropped,
  // defeating the whole point of "restore."
  it("(§1bq) restores an item present only in the backup, even though it is NOT in the live local profile at all", () => {
    const local = profile({ researchTopics: ["kept-locally"] }); // "from the backup" was deliberately removed locally sometime after the backup was taken
    const { patch } = mergeProfileFromBackup(local, { researchTopics: ["from the backup"] });
    // Backup wins outright for list order too (P4's own convention, unlike
    // P1's account-order-first rule): the backup's own list first, then
    // local's own additions since — matching the pre-existing "does not
    // silently drop a topic added since" test's order immediately above.
    expect(patch.researchTopics).toEqual(["from the backup", "kept-locally"]);
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
