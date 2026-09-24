import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, digestFeedRequestFromProfile } from "./route";
import { selectedSenseConcept } from "@/lib/feed/senses";

// P4-S7 (Round 3) -- F-A-P4-07 (double-send race) / F-A-P4-04 (dashboard
// ledger independence), ABC-JEV-INTEGRATION.md §1p.C.10. `createAdminClient`
// is mocked here for the first time in this file (the existing three tests
// above never touched it -- they return before it's called, or are pure).
const mocks = vi.hoisted(() => ({
  createAdminClient: vi.fn(),
  runFeedPipeline: vi.fn(),
  sendDigestEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: mocks.createAdminClient,
}));
vi.mock("@/lib/feed/pipeline", () => ({ runFeedPipeline: mocks.runFeedPipeline }));
vi.mock("@/lib/email/send-digest", () => ({ sendDigestEmail: mocks.sendDigestEmail }));

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/jobs/dispatch-digests", () => {
  it("normalizes a project-only scheduled profile with the same labeled intent", () => {
    const result = digestFeedRequestFromProfile({
      research_topics: [],
      preferred_methods: [],
      current_project: "Stabilize sulfide electrolytes",
      current_challenges: "Lower interfacial resistance",
      disliked_topics: ["review"],
    });

    expect(result).toMatchObject({
      ok: true,
      request: {
        topics: [],
        project: "Stabilize sulfide electrolytes",
        challenge: "Lower interfacial resistance",
        intent: {
          version: "feed-intent-v1",
          exclusions: [{ kind: "exclude-term", value: "review" }],
        },
      },
    });
  });

  it("accepts a persisted selected sense alone without reclassifying raw legacy topics", () => {
    const result = digestFeedRequestFromProfile({
      research_topics: [], preferred_methods: [], current_project: null, current_challenges: null, disliked_topics: [],
      feed_intent: { version: "feed-intent-v1", selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] },
    });
    expect(result).toMatchObject({ ok: true, request: { topics: [], intent: { selectedSenseConcepts: [selectedSenseConcept("hr.role_conflict")] } } });
  });

  it("rejects a forged Vercel cron header without the shared secret", async () => {
    vi.stubEnv("CRON_SECRET", "real-secret");
    const request = new NextRequest(
      "http://localhost/api/jobs/dispatch-digests",
      { headers: { "x-vercel-cron": "1" } },
    );

    const response = await GET(request);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized" });
  });
});

// ── P4-S7 (Round 3) -- F-A-P4-07 double-send close + F-A-P4-04 dashboard-
// ledger independence, ABC-JEV-INTEGRATION.md §1p.C.10 ────────────────────
//
// A minimal thenable double for the `.select(...).eq(...).gte(...)[.limit(...)]`
// chains on `briefing_deliveries` -- same shape as
// `web/src/lib/dashboard/delivery-ledger.test.ts`'s own `chainableResult`.
function chain(result: { data: unknown; error: unknown }) {
  const node = {
    eq: () => node,
    gte: () => node,
    limit: () => node,
    then: (
      onFulfilled: (value: typeof result) => unknown,
      onRejected?: (reason: unknown) => unknown,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return node;
}

function makeAdminClient(options: {
  profiles: unknown[];
  recent?: { data: unknown; error: unknown };
  past?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
  rpc?: { data: unknown; error: unknown };
  getUserById?: { data: unknown; error: unknown };
}) {
  // Each mock is given an explicit `vi.fn<Signature>()` type argument (not an
  // unused runtime parameter) so its inferred call-args tuple isn't `[]` --
  // otherwise e.g. `insertFn.mock.calls[0]?.[0]` below is a TS2493 "tuple of
  // length 0 has no element at index 0" error, since TS infers a mock's
  // argument type from its implementation's own signature, not from how the
  // route actually calls it at runtime.
  const insertFn = vi.fn<(row: unknown) => Promise<{ data: unknown; error: unknown }>>(
    () => Promise.resolve(options.insert ?? { data: null, error: null }),
  );
  const rpcFn = vi.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(
    () => Promise.resolve(options.rpc ?? { data: [{ id: 1 }], error: null }),
  );
  const getUserByIdFn = vi.fn<(userId: string) => Promise<{ data: unknown; error: unknown }>>(
    () =>
      Promise.resolve(
        options.getUserById ?? {
          data: { user: { email: "fallback@example.test" } },
          error: null,
        },
      ),
  );
  const client = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: options.profiles, error: null }),
            }),
          }),
        };
      }
      if (table === "briefing_deliveries") {
        return {
          select: (cols: string) =>
            cols === "id"
              ? chain(options.recent ?? { data: [], error: null })
              : chain(options.past ?? { data: [], error: null }),
          insert: insertFn,
        };
      }
      throw new Error(`makeAdminClient: unexpected table "${table}"`);
    },
    rpc: rpcFn,
    auth: { admin: { getUserById: getUserByIdFn } },
  };
  return { client, insertFn, rpcFn, getUserByIdFn };
}

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    user_id: "user-1",
    display_name: "Test Person",
    research_topics: [],
    preferred_methods: [],
    current_project: "Stabilize sulfide electrolytes",
    current_challenges: null,
    disliked_topics: [],
    preference_ledger: null,
    feed_focus: null,
    feed_freshness: null,
    paper_count: 10,
    feed_source_mix: null,
    feed_importance: null,
    feed_method_mode: null,
    feed_discovery_mode: null,
    feed_avoid_reviews: null,
    feed_avoid_old_papers: null,
    feed_avoid_broad_surveys: null,
    digest_enabled: true,
    digest_hour_local: 15,
    digest_timezone: "UTC",
    digest_channel: "email",
    digest_frequency: "daily",
    digest_email: "person@example.test",
    ...overrides,
  };
}

function authedRequest(): NextRequest {
  return new NextRequest("http://localhost/api/jobs/dispatch-digests", {
    headers: { authorization: "Bearer test-secret" },
  });
}

describe("GET /api/jobs/dispatch-digests -- PEER_DIGEST_DEDUPE (P4-S7)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // 15:00 UTC
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("flag off (default): uses the plain insert exactly as before, never calls the claim RPC, and never writes local_date", async () => {
    const { client, insertFn, rpcFn } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(rpcFn).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(insertFn.mock.calls[0]?.[0]).toEqual({
      user_id: "user-1",
      channel: "email",
      item_ids: [],
      payload: { items: [] },
    });
    expect(body.dispatched).toEqual(["user-1"]);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
  });

  it('only recognizes the literal value "on" -- anything else keeps the plain-insert behaviour', async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "true"); // NOT "on"
    const { client, insertFn, rpcFn } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(rpcFn).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalledTimes(1);
  });

  it("flag on: a second concurrent-style invocation for the same user/day claims nothing and sends no second email (F-A-P4-07)", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn } = makeAdminClient({ profiles: [profileRow()] });
    rpcFn
      .mockResolvedValueOnce({ data: [{ id: 101 }], error: null }) // first run claims it
      .mockResolvedValueOnce({ data: [], error: null }); // second run: already claimed
    mocks.createAdminClient.mockReturnValue(client);

    const first = await GET(authedRequest());
    const firstBody = await first.json();
    const second = await GET(authedRequest());
    const secondBody = await second.json();

    expect(rpcFn).toHaveBeenCalledTimes(2);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(firstBody.dispatched).toEqual(["user-1"]);
    expect(secondBody.dispatched).toEqual([]);
    expect(secondBody.failed).toEqual([]);
    expect(secondBody.skipped).toContainEqual({
      user_id: "user-1",
      reason: "digest already claimed for this local date",
    });
  });

  it("flag on: a claim conflict (RPC returns zero rows) is skipped, not counted as a failure, and sends no email", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.failed).toEqual([]);
    expect(body.dispatched).toEqual([]);
    expect(body.skipped).toContainEqual({
      user_id: "user-1",
      reason: "digest already claimed for this local date",
    });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("flag on: a genuine claim error is counted as a failure and sends no email", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: null, error: { message: "connection reset" } },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.failed).toEqual([{ user_id: "user-1", error: "connection reset" }]);
    expect(body.dispatched).toEqual([]);
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("flag on: computes local_date in the owner's digest timezone and passes it to the claim RPC by name", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(rpcFn).toHaveBeenCalledWith("claim_briefing_delivery", {
      p_user_id: "user-1",
      p_local_date: "2026-09-24",
      p_channel: "email",
      p_item_ids: [],
      p_payload: { items: [] },
    });
  });

  it("flag on: uses the OWNER's timezone for local_date, not the server's (differs from the UTC calendar date)", async () => {
    vi.setSystemTime(new Date("2026-09-24T02:00:00.000Z")); // 19:00 previous day in America/Los_Angeles (PDT, UTC-7)
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn } = makeAdminClient({
      profiles: [
        profileRow({ digest_timezone: "America/Los_Angeles", digest_hour_local: 19 }),
      ],
    });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-09-23" }),
    );
  });

  it("never imports or references the dashboard delivery ledger (F-A-P4-04, §1p.C.2 -- email and dashboard stay fully independent)", () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/jobs/dispatch-digests/route.ts"),
      "utf8",
    );
    for (const forbidden of [
      "dashboard/delivery-ledger",
      "dashboard_deliveries",
      "dashboard_batches",
      "DashboardDeliveryLedger",
      "PEER_DASHBOARD_LEDGER",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });
});

// ── P4-S7-T -- test formalization of an independent reviewer's out-of-repo
// probes (docs/jev-abc/P4-S7-A-20260924T0522Z.md, EVIDENCE #7, findings
// F-A-P4S7-01/02/03). The P4-S7 tests above prove the claim-vs-insert branch
// and the owner-timezone date computation against a DB that has already
// serialized two SEQUENTIAL attempts, and against ordinary instants. They do
// not: (a) launch two GET calls truly concurrently via Promise.all, (b)
// cross a real DST boundary, (c) cross UTC midnight in both directions, or
// (d) cover an email failure that happens AFTER a successful claim. This
// block turns those four probes into permanent, in-repo, CI-run tests.
type ClaimRpcArgs = {
  p_user_id: string;
  p_local_date: string;
  p_channel: string;
  p_item_ids: string[];
  p_payload: unknown;
};

// Same table/auth shape as `makeAdminClient` above, but takes a caller-built
// `rpc` mock directly instead of one canned `{ data, error }` response, so
// the mock can hold state across calls -- needed to arbitrate "who claimed
// first" between two truly concurrent invocations sharing one client.
function makeAdminClientWithRpc(profiles: unknown[], rpcFn: ReturnType<typeof vi.fn>) {
  const getUserByIdFn = vi.fn<(userId: string) => Promise<{ data: unknown; error: unknown }>>(
    () =>
      Promise.resolve({
        data: { user: { email: "fallback@example.test" } },
        error: null,
      }),
  );
  const insertFn = vi.fn<(row: unknown) => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve({ data: null, error: null }),
  );
  const client = {
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: () => ({
            eq: () => ({
              neq: () => Promise.resolve({ data: profiles, error: null }),
            }),
          }),
        };
      }
      if (table === "briefing_deliveries") {
        return {
          select: () => chain({ data: [], error: null }),
          insert: insertFn,
        };
      }
      throw new Error(`makeAdminClientWithRpc: unexpected table "${table}"`);
    },
    rpc: rpcFn,
    auth: { admin: { getUserById: getUserByIdFn } },
  };
  return { client, insertFn, getUserByIdFn };
}

// Yields `n` microtask turns without touching real or faked timers -- fake
// timers (active via this suite's own beforeEach below) mock `setTimeout`/
// `Date`, not the native promise microtask queue, so this is a safe way to
// make one mocked async call's continuation land before or after another's
// without needing `vi.advanceTimersByTimeAsync`.
async function yieldMicrotasks(n: number): Promise<void> {
  for (let i = 0; i < n; i++) await Promise.resolve();
}

describe("GET /api/jobs/dispatch-digests -- PEER_DIGEST_DEDUPE hardening (P4-S7-T)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // 15:00 UTC
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("TRUE concurrency: two GET calls launched together via Promise.all produce exactly one claim, one email, and no failures", async () => {
    // WHAT THIS MOCK CAN PROVE: the route holds no in-process mutable state
    // (module-level or otherwise) that could let two overlapping
    // invocations both "win" -- `dispatched`/`skipped`/`failed`/`emailsSent`/
    // `emailsFailed` are all freshly declared inside each `GET` call, so the
    // only place a race can be won or lost is whatever the claim RPC
    // returns. This test proves the route reacts correctly no matter which
    // of the two calls' simulated network round-trips comes back first.
    //
    // WHAT THIS MOCK CANNOT PROVE: that a real Postgres
    // `ON CONFLICT (user_id, local_date) WHERE local_date IS NOT NULL
    // DO NOTHING` against the partial unique index actually serializes two
    // real, cross-process concurrent inserts the way this mock assumes.
    // That is DB-level proof and is BLOCKED here -- no isolated Postgres/
    // Supabase instance is available to this test run (matches every other
    // slice in this campaign, see ABC-JEV-INTEGRATION.md §1k). This test
    // only rules out an in-process/application-level race; it is not a
    // substitute for a real-database integration test.
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");

    const claimedKeys = new Set<string>();
    let callOrder = 0;
    const rpcFn = vi.fn<(fn: string, args: ClaimRpcArgs) => Promise<{ data: unknown; error: unknown }>>(
      (_fn, args) => {
        callOrder += 1;
        const myOrder = callOrder;
        const key = `${args.p_user_id}:${args.p_local_date}`;
        // The uniqueness decision is made SYNCHRONOUSLY, at the instant
        // this mock is invoked -- modeling what a real partial-unique-index
        // arbiter guarantees atomically at insert time, regardless of how
        // long any individual caller's round-trip takes to resolve.
        const alreadyClaimed = claimedKeys.has(key);
        if (!alreadyClaimed) claimedKeys.add(key);
        // Deliberately make the FIRST caller's own round-trip resolve
        // SLOWER than the second caller's, so resolution order is the
        // reverse of call order. This rules out the route depending on
        // response-arrival order instead of reacting only to each call's
        // own returned rows.
        const hops = myOrder === 1 ? 8 : 2;
        return yieldMicrotasks(hops).then(() =>
          alreadyClaimed
            ? { data: [], error: null }
            : { data: [{ id: myOrder }], error: null },
        );
      },
    );
    const { client } = makeAdminClientWithRpc([profileRow()], rpcFn);
    mocks.createAdminClient.mockReturnValue(client);

    const [firstResponse, secondResponse] = await Promise.all([
      GET(authedRequest()),
      GET(authedRequest()),
    ]);
    const [firstBody, secondBody] = await Promise.all([
      firstResponse.json(),
      secondResponse.json(),
    ]);

    expect(rpcFn).toHaveBeenCalledTimes(2);
    expect(claimedKeys.size).toBe(1); // exactly one claim row, ever

    const totalDispatched = firstBody.dispatched.length + secondBody.dispatched.length;
    const totalFailed = firstBody.failed.length + secondBody.failed.length;
    const totalEmails = mocks.sendDigestEmail.mock.calls.length;

    expect(totalDispatched).toBe(1);
    expect(totalEmails).toBe(1);
    expect(totalFailed).toBe(0); // neither invocation counts the other's loss as a failure

    const skippedReasons = [...firstBody.skipped, ...secondBody.skipped].map(
      (s: { reason: string }) => s.reason,
    );
    expect(skippedReasons).toContain("digest already claimed for this local date");
  });

  it("DST spring-forward boundary (America/Chicago, 2026-03-08): local_date stays the owner's correct calendar date across the transition instant", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");

    // 2026-03-08 is the US spring-forward Sunday: America/Chicago clocks
    // jump 01:59:59 CST (UTC-6) -> 03:00:00 CDT (UTC-5), skipping the
    // 02:00-02:59 local hour entirely. Both instants below are still the
    // same local calendar day, so `local_date` must read "2026-03-08" on
    // both sides of the jump. (Verified against Node's own `Intl` before
    // writing this test, not hand-computed.)
    vi.setSystemTime(new Date("2026-03-08T07:59:00.000Z")); // 01:59 CST, pre-transition
    const pre = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Chicago", digest_hour_local: 1 })],
    });
    mocks.createAdminClient.mockReturnValue(pre.client);
    await GET(authedRequest());
    expect(pre.rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-03-08" }),
    );

    vi.setSystemTime(new Date("2026-03-08T08:01:00.000Z")); // 03:01 CDT, just after the jump
    const post = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Chicago", digest_hour_local: 3 })],
    });
    mocks.createAdminClient.mockReturnValue(post.client);
    await GET(authedRequest());
    expect(post.rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-03-08" }),
    );
  });

  it("cross-midnight: server just after UTC midnight, owner's zone (America/Los_Angeles) is still on the previous local day", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    vi.setSystemTime(new Date("2026-09-24T00:30:00.000Z")); // 17:30 the PREVIOUS day in America/Los_Angeles (PDT, UTC-7)
    const { client, rpcFn } = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Los_Angeles", digest_hour_local: 17 })],
    });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-09-23" }),
    );
  });

  it("cross-midnight (reverse): owner's zone (Asia/Tokyo) is already on the NEXT local day while the server/UTC calendar date is still the previous day", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    vi.setSystemTime(new Date("2026-09-24T23:30:00.000Z")); // 08:30 the NEXT day in Asia/Tokyo (UTC+9)
    const { client, rpcFn } = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "Asia/Tokyo", digest_hour_local: 8 })],
    });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-09-25" }),
    );
  });

  it("failure after claim: claim succeeds, email send throws -> counted as a failure, and a later same-day invocation does not resend (F-A-P4S7-01)", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn } = makeAdminClient({ profiles: [profileRow()] });
    rpcFn
      .mockResolvedValueOnce({ data: [{ id: 201 }], error: null }) // first invocation claims it
      .mockResolvedValueOnce({ data: [], error: null }); // second invocation: already claimed
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail
      .mockRejectedValueOnce(new Error("smtp down")) // first invocation's email attempt throws
      .mockResolvedValueOnce({ sent: true, messageId: "should-never-be-sent" }); // trap: must not be reached

    const first = await GET(authedRequest());
    const firstBody = await first.json();
    const second = await GET(authedRequest());
    const secondBody = await second.json();

    // Claim succeeded (`dispatched.push` runs before the email block), then
    // the email threw -- the per-row try/catch catches it, so the user
    // lands in BOTH `dispatched` AND `failed` for this first invocation.
    expect(firstBody.dispatched).toEqual(["user-1"]);
    expect(firstBody.failed).toEqual([{ user_id: "user-1", error: "smtp down" }]);

    // ACCEPTED TRADE-OFF, documented as CURRENT behaviour (F-A-P4S7-01,
    // docs/jev-abc/P4-S7-A-20260924T0522Z.md): the claim itself already
    // succeeded and cannot be reclaimed for the same (user_id, local_date),
    // even though the email never actually went out. The schema has no way
    // today to tell "claimed and delivered" apart from "claimed but email
    // failed", so a same-day retry after a transient email-provider outage
    // is not possible. This is very likely the correct trade-off for
    // closing the double-send race, but it IS a real behaviour change from
    // the flag-off 6-hour-window, which incidentally allowed a same-day
    // retry. OPEN FOLLOW-UP (not built in this slice, not this test's job
    // to fix): a retry-with-idempotency-key path that can distinguish those
    // two states and re-attempt only the email leg without re-claiming or
    // double-sending.
    expect(rpcFn).toHaveBeenCalledTimes(2);
    expect(secondBody.dispatched).toEqual([]);
    expect(secondBody.failed).toEqual([]);
    expect(secondBody.skipped).toContainEqual({
      user_id: "user-1",
      reason: "digest already claimed for this local date",
    });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1); // never retried
  });

  it("flag off: none of the concurrency/DST/cross-midnight scenarios call the claim RPC (sanity)", async () => {
    // Flag intentionally left unset (default off). Reuses the DST
    // post-transition instant to confirm the flag gate -- not the
    // timezone/date math -- is what controls whether the claim RPC path
    // runs at all.
    vi.setSystemTime(new Date("2026-03-08T08:01:00.000Z")); // 03:01 CDT
    const { client, rpcFn, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Chicago", digest_hour_local: 3 })],
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(rpcFn).not.toHaveBeenCalled();
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(body.dispatched).toEqual(["user-1"]);
  });
});

// P3-S5 (Round 3) — ABC-JEV-INTEGRATION.md §4 "P3-S5 DESIGN RULING": the
// Jev shadow's `onFreshShortlist` hook is wired ONLY in
// app/api/feed/route.ts's POST handler — this route is never edited by
// that slice. This is the regression net for "no cron-driven Jev spend":
// it proves the structural reason the hook cannot reach this call site
// (runFeedPipeline is called with a single argument here, no options
// object at all), not merely that today's code happens not to pass one.
describe("GET /api/jobs/dispatch-digests -- never schedules the Jev shadow (P3-S5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    // Same fixed instant the PEER_DIGEST_DEDUPE block above uses to make
    // profileRow()'s default scheduled hour actually due for dispatch.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("calls runFeedPipeline with a single argument (no options object) -- structurally cannot carry onFreshShortlist", async () => {
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(mocks.runFeedPipeline).toHaveBeenCalled();
    for (const call of mocks.runFeedPipeline.mock.calls) {
      expect(call).toHaveLength(1);
      expect((call[0] as Record<string, unknown>)).not.toHaveProperty("onFreshShortlist");
    }
  });
});
