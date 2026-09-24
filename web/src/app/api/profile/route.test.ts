import { describe, expect, it, vi } from "vitest";
const routeMocks = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => routeMocks.client }));
vi.mock("@/lib/entitlement/resolve", () => ({ resolveEntitlement: vi.fn() }));
vi.mock("@/lib/entitlement/allowance", () => ({ toClientEntitlement: vi.fn(), ANONYMOUS_CLIENT_ENTITLEMENT: {} }));
vi.mock("@/lib/usage/counters", () => ({ deepReportMonthKey: vi.fn(), deepReportTrialKey: vi.fn(), getCounterStore: vi.fn() }));
import { PUT, profilePatchToRow, profileRowToProfile } from "./route";
import { NextRequest } from "next/server";
import { selectedSenseConcept } from "@/lib/feed/senses";

const rowFixture = {
  user_id: "user-1",
  display_name: "Peer Member",
  research_topics: ["solid-state battery"],
  preferred_methods: ["electrochemistry"],
  location_preferences: ["Chicago"],
  authorised_countries: ["United States", "Canada"],
  career_stage: "Postdoc",
  industry_vs_academia: "both",
  phd_year: null,
  school: null,
  current_project: null,
  current_challenges: null,
  disliked_topics: [],
  preference_ledger: {},
  feed_focus: "balanced" as const,
  feed_freshness: "week" as const,
  paper_count: 10 as const,
  feed_source_mix: "balanced" as const,
  feed_importance: "new" as const,
  feed_method_mode: "relatedOk" as const,
  feed_discovery_mode: "core" as const,
  feed_avoid_reviews: true,
  feed_avoid_old_papers: false,
  feed_avoid_broad_surveys: true,
  lab: null,
  digest_enabled: true,
  digest_hour_local: 8,
  digest_timezone: "America/Chicago",
  digest_channel: "inapp" as const,
  digest_frequency: "daily" as const,
  digest_email: null,
  color_theme: "system:ember" as const,
  updated_at: "2026-07-31T00:00:00.000Z",
};
const explicitEmptyIntent = {
  version: "feed-intent-v1" as const,
  project: { presence: "explicit-empty" as const }, challenge: { presence: "omitted" as const },
  requiredConcepts: [], preferredConcepts: [], exclusions: [], methods: [], selectedSenseConcepts: [],
};

describe("profile route work-authorisation mapping", () => {
  it("omits an absent intent but round-trips canonical empty/value cards without administrative fields", () => {
    expect(profilePatchToRow({ displayName: "Only this" }, "user-1")).not.toHaveProperty("feed_intent");
    expect(profilePatchToRow({ feedIntent: explicitEmptyIntent }, "user-1")).toMatchObject({ feed_intent: explicitEmptyIntent });
    const valued = { ...explicitEmptyIntent, project: { presence: "value" as const, value: "Battery", provenance: "user" as const }, selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] };
    expect(profileRowToProfile({ ...rowFixture, feed_intent: valued }).feedIntent).toEqual(valued);
    expect(profileRowToProfile({ ...rowFixture, feed_intent: explicitEmptyIntent }).currentProject).toBe("");
    expect(profilePatchToRow({ plan: "paid", entitlement: { forged: true } } as never, "user-1")).toEqual({ user_id: "user-1" });
  });

  it("rejects an invalid supplied card before any upsert", async () => {
    const upsert = vi.fn();
    routeMocks.client = { auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: () => ({ upsert }) };
    const response = await PUT(new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ feedIntent: { version: "not-v1" } }) }));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "invalid_feed_intent" });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("reports a precise feed_intent schema error after one write and never delete-retries it", async () => {
    const upsert = vi.fn(() => ({ select: () => ({ single: async () => ({ data: null, error: { message: "Could not find the 'feed_intent' column of 'profiles' in the schema cache" } }) }) }));
    routeMocks.client = { auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) }, from: () => ({ upsert }) };
    const response = await PUT(new NextRequest("http://peer.test/api/profile", { method: "PUT", body: JSON.stringify({ feedIntent: explicitEmptyIntent }) }));
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({ error: "feed_intent_schema_unavailable" });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect((upsert.mock.calls as unknown[][])[0]?.[0]).toHaveProperty("feed_intent");
  });
  it("reads authorised countries from a remote profile row", () => {
    expect(profileRowToProfile(rowFixture).authorisedCountries).toEqual([
      "United States",
      "Canada",
    ]);
  });

  it("defaults old rows without the new column to an empty list", () => {
    const { authorised_countries: _omitted, ...oldRow } = rowFixture;
    void _omitted;
    expect(
      profileRowToProfile(oldRow).authorisedCountries,
    ).toEqual([]);
  });

  it("writes only the changed work-authorisation field in a partial patch", () => {
    expect(
      profilePatchToRow(
        { authorisedCountries: ["Germany"] },
        "user-1",
      ),
    ).toEqual({
      user_id: "user-1",
      authorised_countries: ["Germany"],
    });
  });
});
