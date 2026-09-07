import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import {
  OPERATOR_SENTINEL,
  USER_SENTINEL,
  deleteSpendableKeys,
  deployedRuntimeEnv,
  signedIn,
  signedOut,
  supabaseServerStub,
} from "@/test-support/route-harness";
import { forcedRebuildDayKey } from "@/lib/usage/counters";

/**
 * ABC-freemium 1-09 · R-TEST-1, Ruling 2 point 7.
 *
 * Round-1 A measured the personas with a throwaway probe and deleted it. This is
 * the permanent form: the real handler, a real `NextRequest`, a recording
 * `fetch`, and sentinel keys — so the persona pass is re-runnable by anyone
 * instead of reconstructed from prose each round.
 *
 * **What it pins.** Before 1-05, an unauthenticated `POST` here produced **two**
 * outgoing searches on the operator's Tavily key. The number that has to stay at
 * zero for `anonymous` and `free-no-key` is asserted directly, by reading the
 * bodies of the outgoing requests rather than by trusting a return value.
 *
 * **The money rule.** This suite does not mock the provider registry, so after
 * item 1-11 an unmocked `resolveProvider()` inside it would return a live
 * provider on the operator's real key. `vitest.setup.ts` deletes
 * `GOOGLE_API_KEY` and `TAVILY_API_KEY` before every suite and every test, and
 * `deleteSpendableKeys()` below is the belt-and-braces call. Every key in this
 * file is a sentinel.
 */

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  adminFrom: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => Promise.resolve(supabaseServerStub(mocks.getUser)),
}));

// The entitlement resolver reads the stored plan through the admin client. This
// is how the `trial` and `paid` personas are constructed — `PEER_DEV_ENTITLEMENT`
// cannot be, because it is honoured only outside a deployed runtime and these
// cases need a deployed one to have a session at all.
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: mocks.adminFrom,
    // The counter store and the usage sink share this client. The counter's
    // RPC is a spy as well as a stub, because "did the route forward the
    // refresh?" is answered by whether the daily search counter moved.
    rpc: mocks.rpc,
  }),
}));

import { POST } from "./route";

/** Every outgoing request the handler made, URL and body. */
const outgoing: Array<{ url: string; body: string }> = [];

function recordingFetch(): typeof fetch {
  return vi.fn(async (input: unknown, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : String((input as Request)?.url ?? "");
    outgoing.push({ url, body: String(init?.body ?? "") });
    return new Response(JSON.stringify({ results: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

/** Requests whose URL or body carries a given key. */
function requestsCarrying(key: string): Array<{ url: string; body: string }> {
  return outgoing.filter(
    (entry) => entry.url.includes(key) || entry.body.includes(key),
  );
}

function rowReturning(data: Record<string, unknown> | null) {
  return {
    select: () => ({
      eq: () => ({ maybeSingle: () => Promise.resolve({ data, error: null }) }),
    }),
    insert: () => Promise.resolve({ error: null }),
  };
}

function planRow(plan: string | null) {
  return rowReturning(plan ? { plan } : null);
}

function request(body: Record<string, unknown>): NextRequest {
  return new NextRequest("http://localhost/api/jobs/feed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BASE = { topics: ["molten salt"], perSourceLimit: 5, topN: 3 };

beforeEach(() => {
  vi.clearAllMocks();
  outgoing.length = 0;
  deleteSpendableKeys();
  vi.stubGlobal("fetch", recordingFetch());
  deployedRuntimeEnv(vi.stubEnv);
  // The entitlement resolver reads the stored plan through the admin client,
  // which needs both variables present. Safe here and only here: this suite
  // mocks `@/lib/supabase/admin`, so nothing constructs a real client or opens
  // a real connection. The shared `deployedRuntimeEnv` deliberately does not set
  // this.
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "SERVICE-ROLE-NOT-A-KEY");
  // The operator's key exists in the environment. Every case below is about
  // whether it is *spent*, not whether it is set.
  vi.stubEnv("TAVILY_API_KEY", OPERATOR_SENTINEL);
  vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
  vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
  mocks.adminFrom.mockReturnValue(planRow(null));
  mocks.rpc.mockResolvedValue({ data: 1, error: null });
  mocks.getUser.mockResolvedValue(signedOut());
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("POST /api/jobs/feed — the operator's search key", () => {
  it("spends nothing for an anonymous caller", async () => {
    // A's round-1 measurement: 2 outgoing searches, from a request with no
    // account and no `aiTier`.
    mocks.getUser.mockResolvedValue(signedOut());

    const response = await POST(request(BASE));

    expect(response.status).toBe(200);
    expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
  });

  it("spends nothing for a signed-in free user with no key", async () => {
    mocks.getUser.mockResolvedValue(signedIn("free-user"));
    mocks.adminFrom.mockReturnValue(planRow("free"));

    const response = await POST(request(BASE));

    // R-POOL-3 — jobs still respond from the free structured sources, so this
    // is a 200 and not a 401.
    expect(response.status).toBe(200);
    expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
  });

  it("sends the user's own key and not the operator's", async () => {
    // The one persona A measured as already correct. Pinned so 1-05 cannot
    // regress it.
    mocks.getUser.mockResolvedValue(signedIn("byok-user"));
    mocks.adminFrom.mockReturnValue(planRow("free"));

    await POST(
      request({
        ...BASE,
        searchConnectors: { tavily: { enabled: true, apiKey: USER_SENTINEL } },
      }),
    );

    expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
    expect(requestsCarrying(USER_SENTINEL).length).toBeGreaterThan(0);
  });

  it("sends the operator's key for a paid user", async () => {
    // The first time this persona can be constructed at all — before 1-01 there
    // was no server-side input that could make a request behave as paid.
    mocks.getUser.mockResolvedValue(signedIn("paid-user"));
    mocks.adminFrom.mockReturnValue(planRow("paid"));

    await POST(request(BASE));

    expect(requestsCarrying(OPERATOR_SENTINEL).length).toBeGreaterThan(0);
  });

  it("sends the operator's key for a trial user", async () => {
    mocks.getUser.mockResolvedValue(signedIn("trial-user"));
    mocks.adminFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                plan: "trial",
                trial_ends_at: new Date(
                  Date.now() + 7 * 24 * 60 * 60 * 1000,
                ).toISOString(),
              },
              error: null,
            }),
        }),
      }),
      insert: () => Promise.resolve({ error: null }),
    });

    await POST(request(BASE));

    expect(requestsCarrying(OPERATOR_SENTINEL).length).toBeGreaterThan(0);
  });

  it("spends nothing for an EXPIRED trial", async () => {
    // D5 — expiry is computed at read time, so the stored column still says
    // `trial` and the very next request behaves as free.
    mocks.getUser.mockResolvedValue(signedIn("expired-user"));
    mocks.adminFrom.mockReturnValue({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: {
                plan: "trial",
                trial_ends_at: "2020-01-01T00:00:00.000Z",
              },
              error: null,
            }),
        }),
      }),
      insert: () => Promise.resolve({ error: null }),
    });

    await POST(request(BASE));

    expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
  });

  it("cannot be elevated by the request body", async () => {
    // R-SEC-3 — the body asks for tier 2 and claims the connector is on with an
    // empty key, which `parseSearchConnectors` drops. Neither can reach the
    // operator's key, because the flag comes from the entitlement alone.
    mocks.getUser.mockResolvedValue(signedOut());

    await POST(
      request({
        ...BASE,
        aiTier: 2,
        searchConnectors: { tavily: { enabled: true, apiKey: "" } },
      }),
    );

    expect(requestsCarrying(OPERATOR_SENTINEL)).toEqual([]);
  });
});

/**
 * ABC-freemium 1-19 / 1-21 · R-POOL-2 — the entitlement gate, observed at the
 * route.
 *
 * A forced rebuild charges the daily system-search counter before it runs, so
 * "did the route forward the refresh?" is answered by that counter moving.
 * Since 1-21 the ordinary fan-out charges the same counter too, so the
 * assertion is on the **difference** between the same request with and without
 * the flag — which is a sharper statement anyway: a granted refresh costs
 * exactly one charge on top of whatever the fan-out already costs.
 */
describe("POST /api/jobs/feed — refresh now (R-POOL-2)", () => {
  /**
   * ABC-freemium 5-02 · Ruling 13 point 1 — DERIVED, never hard-coded again.
   *
   * This filter used to test `startsWith("search:")`. Renaming the counter to
   * `forced_rebuilds_today:` (the breaker no longer guards a search — it guards
   * this very refresh) made the fixture match nothing, so both cases below went
   * quietly to zero and one of them failed. B's plant could not have predicted
   * it: the rename came from Ruling 13, after the blast radius was measured.
   * Taking the prefix from the key builder means the next rename cannot repeat
   * it.
   */
  const REBUILD_KEY_PREFIX = `${forcedRebuildDayKey("u", new Date()).split(":")[0]}:`;

  function rebuildIncrements(): number {
    return mocks.rpc.mock.calls.filter(
      (call) =>
        call[0] === "increment_usage_counter" &&
        String((call[1] as { p_key?: string })?.p_key ?? "").startsWith(
          REBUILD_KEY_PREFIX,
        ),
    ).length;
  }

  it("refuses a free user's forced rebuild, and still answers 200", async () => {
    // A free user has no system search at all, so nothing is charged either
    // way — and the surface answers exactly as it would have. Refused, never
    // errored.
    mocks.getUser.mockResolvedValue(signedIn("free-user"));
    mocks.adminFrom.mockReturnValue(planRow("free"));

    const response = await POST(request({ ...BASE, poolRefresh: true }));

    expect(response.status).toBe(200);
    expect(rebuildIncrements()).toBe(0);
  });

  it("charges a paid user exactly one extra for a granted refresh", async () => {
    mocks.getUser.mockResolvedValue(signedIn("paid-user"));
    mocks.adminFrom.mockReturnValue(planRow("paid"));

    await POST(request(BASE));
    const withoutRefresh = rebuildIncrements();
    mocks.rpc.mockClear();

    await POST(request({ ...BASE, poolRefresh: true }));
    const withRefresh = rebuildIncrements();

    expect(withRefresh).toBe(withoutRefresh + 1);
  });
});
