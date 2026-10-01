import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { GET, digestFeedRequestFromProfile, hasDeliveryOnLocalDate } from "./route";
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

// DIGEST-CATCHUP (ABC-JEV-INTEGRATION.md §1bf point 1) -- direct unit tests
// for the new pure helper, independent of any DB mock shape.
describe("hasDeliveryOnLocalDate (pure)", () => {
  it("true when a delivered-at value falls on the same local date as now", () => {
    const now = new Date("2026-09-24T20:00:00.000Z"); // 2026-09-24 in UTC
    const deliveredAt = new Date("2026-09-24T09:00:00.000Z").toISOString(); // same UTC date, 11h earlier
    expect(hasDeliveryOnLocalDate([deliveredAt], now, "UTC")).toBe(true);
  });

  it("false when every delivered-at value falls on a different local date", () => {
    const now = new Date("2026-09-24T09:00:00.000Z");
    const deliveredAt = new Date("2026-09-23T09:00:00.000Z").toISOString();
    expect(hasDeliveryOnLocalDate([deliveredAt], now, "UTC")).toBe(false);
  });

  it("compares LOCAL dates, not raw UTC dates: a delivery just after UTC midnight can still be 'yesterday' in a negative-offset zone", () => {
    // 2026-09-24T02:00:00Z is 2026-09-23 19:00 in America/Los_Angeles
    // (PDT, UTC-7) -- still the PREVIOUS owner-local day.
    const now = new Date("2026-09-24T20:00:00.000Z"); // 13:00 PDT, 2026-09-24 locally
    const deliveredAt = "2026-09-24T02:00:00.000Z"; // 19:00 PDT, 2026-09-23 locally
    expect(hasDeliveryOnLocalDate([deliveredAt], now, "America/Los_Angeles")).toBe(false);
  });

  it("empty input is never treated as a match", () => {
    expect(hasDeliveryOnLocalDate([], new Date("2026-09-24T12:00:00.000Z"), "UTC")).toBe(false);
  });

  it("null/undefined entries in the list are skipped safely, never thrown", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    expect(() => hasDeliveryOnLocalDate([null, undefined], now, "UTC")).not.toThrow();
    expect(hasDeliveryOnLocalDate([null, undefined], now, "UTC")).toBe(false);
  });

  it("one matching value among several non-matching ones is enough", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    const values = [
      new Date("2026-09-20T12:00:00.000Z").toISOString(),
      new Date("2026-09-22T12:00:00.000Z").toISOString(),
      new Date("2026-09-24T01:00:00.000Z").toISOString(), // same UTC date as now
    ];
    expect(hasDeliveryOnLocalDate(values, now, "UTC")).toBe(true);
  });

  it("an unresolvable timezone returns false defensively (never a false 'already delivered' block)", () => {
    const now = new Date("2026-09-24T12:00:00.000Z");
    expect(hasDeliveryOnLocalDate([now.toISOString()], now, "Not/A_Zone")).toBe(false);
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
  /** DIGEST-CATCHUP (§1bf point 1): the new 26h same-local-date guard's own
   * query (`select("delivered_at")`), kept distinct from `recent` (the
   * pre-existing 6h `select("id")` lookback) and `past` (the pre-existing
   * 30-day `select("item_ids")` exclusion) so a test can set each
   * independently. Defaults to empty, same as the other two -- a test that
   * doesn't care about this guard sees no behaviour change. */
  sameDate?: { data: unknown; error: unknown };
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
  // DIGEST-CATCHUP: wrapped as a spy (was a plain arrow function) so a test
  // can assert WHICH `briefing_deliveries` column sets were actually
  // queried -- in particular, that the new 26h same-date guard's
  // `"delivered_at"` select is never issued on the flag-on path.
  const selectFn = vi.fn((cols: string) => {
    if (cols === "id") return chain(options.recent ?? { data: [], error: null });
    if (cols === "delivered_at") return chain(options.sameDate ?? { data: [], error: null });
    return chain(options.past ?? { data: [], error: null });
  });
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
          select: selectFn,
          insert: insertFn,
        };
      }
      throw new Error(`makeAdminClient: unexpected table "${table}"`);
    },
    rpc: rpcFn,
    auth: { admin: { getUserById: getUserByIdFn } },
  };
  return { client, insertFn, rpcFn, getUserByIdFn, selectFn };
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
    // EMAIL-TOKEN-PRIVACY (§1as): a count only, not a per-reader user_id list.
    expect(body.dispatched_count).toBe(1);
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
    // EMAIL-TOKEN-PRIVACY (§1as): counts/fixed-code tally, not per-reader arrays.
    expect(firstBody.dispatched_count).toBe(1);
    expect(secondBody.dispatched_count).toBe(0);
    expect(secondBody.failed_count).toBe(0);
    expect(secondBody.skipped_reasons).toEqual({ already_claimed: 1 });
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

    // EMAIL-TOKEN-PRIVACY (§1as): counts/fixed-code tally, not per-reader arrays.
    expect(body.failed_count).toBe(0);
    expect(body.dispatched_count).toBe(0);
    expect(body.skipped_reasons).toEqual({ already_claimed: 1 });
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

    // EMAIL-TOKEN-PRIVACY (§1as): a fixed code in the response; the raw DB
    // error text ("connection reset") goes only to the private server log
    // (see the console.warn assertion further down this file).
    expect(body.failed_reasons).toEqual({ claim_error: 1 });
    expect(JSON.stringify(body)).not.toContain("connection reset");
    expect(body.dispatched_count).toBe(0);
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

// ── EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj) — the scheduled sender
// must forward the pipeline's own `meta.emptyReasonCode` through to
// `sendDigestEmail` unchanged on the flag-off default path (the P4-S7-IDEM
// first-attempt path is covered separately, with REAL rendering, in
// idempotency.test.ts — `sendDigestEmail` is a bare mock in THIS file, see
// the module-level `vi.mock` at the top, so these tests prove only this
// route's own plumbing; the rendered-sentence behaviour is covered by
// digest-template.test.ts and send-digest.test.ts). ──────────────────────
describe("GET /api/jobs/dispatch-digests -- passes feed.meta.emptyReasonCode through (EMPTY-EMAIL-REASON)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("forwards a real code when the pipeline resolves one", async () => {
    mocks.runFeedPipeline.mockResolvedValue({
      items: [],
      meta: { emptyReasonCode: "no-required-match" },
    });
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(mocks.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({ emptyReasonCode: "no-required-match" }),
    );
  });

  it("forwards undefined when the pipeline returned no code (today's only-tested shape, now also checked on this field)", async () => {
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    const call = mocks.sendDigestEmail.mock.calls[0][0];
    expect(call.emptyReasonCode).toBeUndefined();
  });
});

// ── EMPTY-EMAIL-REASON / §1bj.5 pin — the guide's §1.4 proved by execution
// that the dispatcher's OWN post-pipeline 30-day re-filter (route.ts, the
// `freshItems = feed.items.filter((i) => !seenIds.has(i.id))` line right
// after the `runFeedPipeline` call) is a no-op today, because the SAME
// `seenIds` set already went into the pipeline call as `excludeIds` — but
// that invariant had no test (the route's own tests, above, all mock
// `runFeedPipeline` directly and never exercise a non-empty `feed.items`).
// Regression-pins that the redundant filter removes nothing beyond what the
// pipeline (here: a realistic mock standing in for it) already excluded. ──
describe("GET /api/jobs/dispatch-digests -- the redundant 30-day re-filter removes nothing extra (§1bj.5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a non-excluded item survives when a DIFFERENT item is in the 30-day set (a realistic already-filtered pipeline stub)", async () => {
    // "past" (the 30-day briefing_deliveries lookback) returns paper A's id.
    // A real pipeline call passes that same set as `excludeIds` and so can
    // never return paper A (proven by the B guide §1.4/§2.1-2.2 against the
    // REAL pipeline) -- this mock reflects that already-filtered reality:
    // feed.items holds only the non-excluded paper B.
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      past: { data: [{ item_ids: ["openalex:paper-a"] }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.runFeedPipeline.mockResolvedValue({
      items: [{ id: "openalex:paper-b", title: "Paper B" }],
      meta: {},
    });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });

    const response = await GET(authedRequest());
    const body = await response.json();

    // Mutation-catching: if the route's own `.filter(i => !seenIds.has(i.id))`
    // were changed to filter against a DIFFERENT set (e.g. cleared, or one
    // that happens to also cover paper B), paper B would be wrongly dropped
    // and this assertion would go red.
    expect(mocks.sendDigestEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ id: "openalex:paper-b" })],
      }),
    );
    // Not treated as an empty send.
    expect(body.dispatched_count).toBe(1);
    expect(body.emails_sent_count).toBe(1);
  });
});

// ── EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as) — the response is
// printed whole into the (now-public repo) GitHub Actions log every hour:
// counts and fixed reason codes only, no raw provider text, no per-reader
// user_id list. Per-reader detail goes to the private server log instead. ──
describe("GET /api/jobs/dispatch-digests -- EMAIL-TOKEN-PRIVACY response privacy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a Resend sandbox failure naming an address classifies to the fixed code, never appears in the JSON response, and reaches only the private log redacted", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      errorCode: "validation_error",
      error: "You can only send testing emails to your own email address (owner@example.test).",
    });
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.emails_failed_reasons).toEqual({ sender_not_verified: 1 });
    expect(body.emails_failed_count).toBe(1);
    expect(JSON.stringify(body)).not.toContain("owner@example.test");
    expect(JSON.stringify(body)).not.toContain("@");

    const logged = warnSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("user-1");
    expect(logged).toContain("sender_not_verified");
    expect(logged).toContain("[email]");
    expect(logged).not.toContain("owner@example.test");
    warnSpy.mockRestore();
  });

  it("an unrecognized send failure classifies to the generic fixed code, never guessed further", async () => {
    mocks.sendDigestEmail.mockResolvedValue({ sent: false, errorCode: "validation_error", error: "Invalid `to` field." });
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.emails_failed_reasons).toEqual({ send_failed: 1 });
  });

  it("no address on file at all (neither digest_email nor the auth user's email) -> the fixed 'no_email' code, never sends", async () => {
    const { client } = makeAdminClient({
      profiles: [profileRow({ digest_email: null })],
      getUserById: { data: { user: { email: null } }, error: null },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.emails_failed_reasons).toEqual({ no_email: 1 });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("regression guard: the response never carries the old per-reader arrays, only counts and *_reasons tallies", async () => {
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
    const { client } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    for (const forbiddenKey of ["dispatched", "skipped", "failed", "emails_sent", "emails_failed"]) {
      expect(body).not.toHaveProperty(forbiddenKey);
    }
    for (const requiredKey of [
      "dispatched_count",
      "skipped_count",
      "skipped_reasons",
      "failed_count",
      "failed_reasons",
      "emails_sent_count",
      "emails_failed_count",
      "emails_failed_reasons",
    ]) {
      expect(body).toHaveProperty(requiredKey);
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

    // EMAIL-TOKEN-PRIVACY (§1as): summed from the *_count/*_reasons fields —
    // there is no per-reader array left to read a user_id off of here.
    const totalDispatched = firstBody.dispatched_count + secondBody.dispatched_count;
    const totalFailed = firstBody.failed_count + secondBody.failed_count;
    const totalEmails = mocks.sendDigestEmail.mock.calls.length;

    expect(totalDispatched).toBe(1);
    expect(totalEmails).toBe(1);
    expect(totalFailed).toBe(0); // neither invocation counts the other's loss as a failure

    const combinedSkipReasons: Record<string, number> = {};
    for (const body of [firstBody, secondBody]) {
      for (const [code, count] of Object.entries(body.skipped_reasons as Record<string, number>)) {
        combinedSkipReasons[code] = (combinedSkipReasons[code] ?? 0) + (count as number);
      }
    }
    expect(combinedSkipReasons.already_claimed).toBe(1);
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

    // Claim succeeded (`dispatchedCount` is bumped before the email block),
    // then the email threw -- the per-row try/catch catches it, so the user
    // is counted in BOTH `dispatched_count` AND `failed_reasons` for this
    // first invocation. EMAIL-TOKEN-PRIVACY (§1as): the raw thrown message
    // ("smtp down") goes only to the private server log, never the response.
    expect(firstBody.dispatched_count).toBe(1);
    expect(firstBody.failed_reasons).toEqual({ pipeline_error: 1 });
    expect(JSON.stringify(firstBody)).not.toContain("smtp down");

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
    // EMAIL-TOKEN-PRIVACY (§1as): counts/fixed-code tally, not per-reader arrays.
    expect(secondBody.dispatched_count).toBe(0);
    expect(secondBody.failed_count).toBe(0);
    expect(secondBody.skipped_reasons).toEqual({ already_claimed: 1 });
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
    // EMAIL-TOKEN-PRIVACY (§1as): a count only, not a per-reader user_id list.
    expect(body.dispatched_count).toBe(1);
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

// ── DIGEST-CATCHUP (ABC-JEV-INTEGRATION.md §1bf) ──────────────────────────
// GitHub Actions only runs this route's own schedule 3-7 times per real UTC
// day (B's execution against real run history), so the old exact-hour-match
// rule silently skipped most readers most days. This block covers the new
// "due since, same local date, not yet delivered" rule: the hour gate
// (`<` instead of `!==`, reason `before_chosen_hour`), the flag-off-only
// same-local-date guard (`already_delivered_today`, a separate 26h query
// from the pre-existing 6h lookback), and the wall-clock time budget
// (`deferred_time_budget`, mirroring prepare-dashboards/route.ts's own
// named-constant pattern). Reuses this file's own `makeAdminClient`/
// `profileRow`/`authedRequest`/`chain` helpers, extended additively above
// (a `sameDate` mock option + `selectFn` returned as a spy) -- every
// existing caller of `makeAdminClient` in this file is unaffected, since
// both additions default to empty/unused.
describe("GET /api/jobs/dispatch-digests -- DIGEST-CATCHUP (§1bf): catch-up hour rule + same-date guard + time budget", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("a reader due earlier today (current local hour > chosen hour) is caught up and sent on a later run", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // chosen 9, run lands at local hour 15

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.dispatched_count).toBe(1);
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    expect(body.skipped_reasons.before_chosen_hour).toBeUndefined();
  });

  it("a reader whose local hour has not reached their chosen hour yet is skipped before_chosen_hour, never sent", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 20 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // chosen 20, run at local hour 15 -- not yet due

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.skipped_reasons).toEqual({ before_chosen_hour: 1 });
    expect(body.dispatched_count).toBe(0);
    expect(insertFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("a second run on the same local date is skipped already_delivered_today even when it comes MORE than 6 hours after the first send", async () => {
    const first = makeAdminClient({ profiles: [profileRow({ digest_hour_local: 9 })] });
    mocks.createAdminClient.mockReturnValue(first.client);
    vi.setSystemTime(new Date("2026-09-24T09:00:00.000Z")); // exact-hour match -- sends
    const firstDeliveredAt = new Date("2026-09-24T09:00:00.000Z").toISOString();

    const firstResponse = await GET(authedRequest());
    const firstBody = await firstResponse.json();
    expect(firstBody.dispatched_count).toBe(1);
    expect(first.insertFn).toHaveBeenCalledTimes(1);

    // 9 hours later -- past the 6-hour lookback, still the same UTC calendar
    // date (09:00Z -> 18:00Z is still 2026-09-24).
    vi.setSystemTime(new Date("2026-09-24T18:00:00.000Z"));
    const second = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
      recent: { data: [], error: null }, // > 6h ago: the OLD 6h guard finds nothing
      sameDate: { data: [{ delivered_at: firstDeliveredAt }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(second.client);

    const secondResponse = await GET(authedRequest());
    const secondBody = await secondResponse.json();

    expect(secondBody.dispatched_count).toBe(0);
    expect(secondBody.skipped_reasons).toEqual({ already_delivered_today: 1 });
    expect(second.insertFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1); // only the first run's send
  });

  it("two runs close together (< 6h apart, same date): the 6-hour lookback still wins over the new same-date guard", async () => {
    const first = makeAdminClient({ profiles: [profileRow({ digest_hour_local: 9 })] });
    mocks.createAdminClient.mockReturnValue(first.client);
    vi.setSystemTime(new Date("2026-09-24T09:00:00.000Z"));
    await GET(authedRequest());

    vi.setSystemTime(new Date("2026-09-24T11:00:00.000Z")); // 2h later, same date
    const second = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
      recent: { data: [{ id: 1 }], error: null }, // within 6h: the OLD guard fires
      sameDate: { data: [{ delivered_at: "2026-09-24T09:00:00.000Z" }], error: null }, // also true, must not win
    });
    mocks.createAdminClient.mockReturnValue(second.client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.skipped_reasons).toEqual({ recent_delivery: 1 });
    expect(second.insertFn).not.toHaveBeenCalled();
  });

  // DIGEST-CATCHUP §1bf point 9 (AMENDMENT) -- the manager's diff read found
  // the 26h same-date read originally ignored its own `error`, so a DB
  // hiccup looked identical to "no delivery today" and would let a later
  // run send a real second email the same local day (fails OPEN). Fixed to
  // fail CLOSED: an error here means "cannot prove this reader is safe",
  // not "proceed".
  it("the 26h same-date read failing (a DB error) fails CLOSED: no pipeline call, no insert, no email, tallied delivery_check_error, no raw error text in the response", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
      sameDate: { data: null, error: { message: "connection reset" } },
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // chosen 9, run at 15 -- due, reaches the guard

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.runFeedPipeline).not.toHaveBeenCalled();
    expect(insertFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    expect(body.failed_reasons).toEqual({ delivery_check_error: 1 });
    expect(body.dispatched_count).toBe(0);
    // EMAIL-TOKEN-PRIVACY: the raw DB error text goes only to the private
    // server log (logJobIssue), never the response.
    expect(JSON.stringify(body)).not.toContain("connection reset");
  });

  it("the first run after local midnight sends for an early-hour reader while a late-hour (23) reader stays before_chosen_hour -- no cross-midnight leak from 'yesterday'", async () => {
    const rows = [
      profileRow({ user_id: "user-early", digest_email: "early@example.test", digest_hour_local: 1 }),
      profileRow({ user_id: "user-late", digest_email: "late@example.test", digest_hour_local: 23 }),
    ];
    const { client, insertFn } = makeAdminClient({ profiles: rows });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-25T02:00:00.000Z")); // 02:00 UTC -- a new local date

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.dispatched_count).toBe(1); // only user-early
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(insertFn.mock.calls[0]?.[0]).toMatchObject({ user_id: "user-early" });
    // user-late is simply "not yet due TODAY" -- never a retroactive send for
    // whatever they may have missed yesterday, and never a distinct reason.
    expect(body.skipped_reasons).toEqual({ before_chosen_hour: 1 });
  });

  it("chosen hour 0 (the falsy trap) sends once the reader's local hour reaches 0 -- a strict numeric compare, never a truthiness check", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 0 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T00:00:00.000Z")); // local hour 0, exact match

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.dispatched_count).toBe(1);
    expect(insertFn).toHaveBeenCalledTimes(1);
    expect(body.skipped_reasons.before_chosen_hour).toBeUndefined();
  });

  it("DST spring-forward day (America/Chicago, 2026-03-08): a chosen local hour that never literally occurs that day (the clock jumps 01:59:59 CST -> 03:00:00 CDT, skipping 02:00-02:59) is still caught up by the first later run", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Chicago", digest_hour_local: 2 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-03-08T08:01:00.000Z")); // 03:01 CDT (this file's own established DST fixture)

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.dispatched_count).toBe(1);
    expect(insertFn).toHaveBeenCalledTimes(1);
  });

  it("a weekly reader caught up on a non-Monday is still skipped by the frequency gate, never sent", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_frequency: "weekly", digest_hour_local: 9 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-03-10T15:00:00.000Z")); // Tuesday (2026-03-09 is the established Monday fixture), hour 15 -- "due" by the new hour rule alone

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.skipped_reasons).toEqual({ frequency_skip: 1 });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("a weekdays reader caught up on a Saturday is still skipped by the frequency gate, never sent", async () => {
    const { client, insertFn } = makeAdminClient({
      profiles: [profileRow({ digest_frequency: "weekdays", digest_hour_local: 9 })],
    });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-03-14T15:00:00.000Z")); // Saturday, hour 15

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.skipped_reasons).toEqual({ frequency_skip: 1 });
    expect(insertFn).not.toHaveBeenCalled();
  });

  it("flag-on path: the catch-up hour rule composes with the existing claim/already_claimed ladder unchanged; the new same-date query is never issued", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn, selectFn } = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
    });
    rpcFn
      .mockResolvedValueOnce({ data: [{ id: 301 }], error: null }) // first run claims it
      .mockResolvedValueOnce({ data: [], error: null }); // second run: already claimed
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z")); // chosen 9, run at 15 -- catch-up

    const first = await GET(authedRequest());
    const firstBody = await first.json();
    const second = await GET(authedRequest());
    const secondBody = await second.json();

    expect(firstBody.dispatched_count).toBe(1);
    expect(secondBody.skipped_reasons).toEqual({ already_claimed: 1 });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    // DIGEST-CATCHUP point 1: "Do NOT add it to the flag-on path."
    expect(selectFn.mock.calls.some((call) => call[0] === "delivered_at")).toBe(false);
  });

  it("the wall-clock budget defers the remaining readers with an exact per-reader tally once real elapsed time crosses the budget", async () => {
    const rows = [
      profileRow({ user_id: "user-a", digest_email: "a@example.test" }),
      profileRow({ user_id: "user-b", digest_email: "b@example.test" }),
      profileRow({ user_id: "user-c", digest_email: "c@example.test" }),
    ]; // all default digest_hour_local:15, matching the system time below -- all due
    const { client } = makeAdminClient({ profiles: rows });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));

    // Simulate a slow first pipeline build that eats almost the whole
    // wall-clock budget in real elapsed time -- by the time row 2 is
    // considered, DISPATCH_WALL_CLOCK_BUDGET_MS (240_000ms) has already
    // passed. `vi.advanceTimersByTime` moves the fake `Date.now()` without
    // touching the already-captured logical `now` used for hour/date
    // decisions (verified above: row 1 through row 3 all still evaluate the
    // SAME hour/frequency/intent gates correctly).
    mocks.runFeedPipeline.mockImplementationOnce(async () => {
      vi.advanceTimersByTime(250_000);
      return { items: [], meta: {} };
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.runFeedPipeline).toHaveBeenCalledTimes(1); // rows 2 & 3 never started
    expect(body.dispatched_count).toBe(1);
    expect(body.skipped_reasons).toEqual({ deferred_time_budget: 2 });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
  });

  it("an invalid timezone never sends, for any chosen hour including 0 -- hourInTimezone's fail-safe -1 sentinel is always < a valid chosen hour", async () => {
    const rows = [
      profileRow({
        user_id: "user-x",
        digest_email: "x@example.test",
        digest_timezone: "Not/A_Zone",
        digest_hour_local: 0,
      }),
      profileRow({
        user_id: "user-y",
        digest_email: "y@example.test",
        digest_timezone: "Not/A_Zone",
        digest_hour_local: 12,
      }),
    ];
    const { client, insertFn } = makeAdminClient({ profiles: rows });
    mocks.createAdminClient.mockReturnValue(client);
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(body.skipped_reasons).toEqual({ before_chosen_hour: 2 });
    expect(body.dispatched_count).toBe(0);
    expect(insertFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  // ── DIGEST-CATCHUP-TRIPWIRES (ABC-JEV-INTEGRATION.md §1bf.10a) ──────────
  // The fresh A review (docs/jev-abc/DIGEST-CATCHUP-A-20260929T161325Z.md)
  // proved three behaviours only in a probe test file it wrote and then
  // deleted at the end of its own review (its "Cleanup proof" section) --
  // so none of them had a permanent, in-repo test. §1bf.10a accepted the
  // timezone-change finding (F1) as a COST, not a bug to fix here, and
  // named all three as a "tripwire owed": the next C on this route adds
  // permanent tests pinning them, so a future change to any one of them is
  // a conscious decision, not a silent regression.
  it("accepted cost, §1bf.10a -- pins today's behaviour so a change to it is a conscious decision: a reader who changes timezone after a send gets one more email for the new local date, then nothing more that Tokyo day", async () => {
    // Reader receives today's digest in America/Chicago, chosen hour 9.
    const chicago = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "America/Chicago", digest_hour_local: 9 })],
    });
    mocks.createAdminClient.mockReturnValue(chicago.client);
    vi.setSystemTime(new Date("2026-09-24T14:05:00.000Z")); // 09:05 CDT, local date 2026-09-24
    const firstBody = await (await GET(authedRequest())).json();
    expect(firstBody.dispatched_count).toBe(1);
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    const firstDeliveredAt = new Date("2026-09-24T14:05:00.000Z").toISOString();

    // The reader's profile timezone changes to Asia/Tokyo before the next
    // run (chosen hour unchanged). ~10.4h later -- past the 6h guard, a NEW
    // local date in Tokyo, and at/after the chosen hour there.
    vi.setSystemTime(new Date("2026-09-25T00:30:00.000Z")); // 09:30 JST, local date 2026-09-25
    const tokyoRun2 = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "Asia/Tokyo", digest_hour_local: 9 })],
      recent: { data: [], error: null }, // > 6h since the Chicago send: the old guard is silent
      sameDate: { data: [{ delivered_at: firstDeliveredAt }], error: null }, // still inside the 26h window
    });
    mocks.createAdminClient.mockReturnValue(tokyoRun2.client);
    const secondBody = await (await GET(authedRequest())).json();

    // ACCEPTED COST (§1bf.10a / review finding F1): the guard judges "today"
    // in the reader's CURRENT (Tokyo) timezone and reinterprets the
    // Chicago-send instant in that same zone -- 2026-09-24T14:05:00Z reads
    // as 23:05 on 2026-09-24 in Tokyo, a different local date than this
    // run's 2026-09-25, so the guard does not recognize "already sent
    // today" and a genuine second email goes out.
    expect(secondBody.dispatched_count).toBe(1);
    expect(secondBody.skipped_reasons.already_delivered_today).toBeUndefined();
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(2); // one more email
    const secondDeliveredAt = new Date("2026-09-25T00:30:00.000Z").toISOString();

    // A further run the SAME Tokyo local date sends nothing: the guard now
    // sees a delivery (the Tokyo run's own insert) that DOES fall on
    // today's Tokyo local date.
    vi.setSystemTime(new Date("2026-09-25T08:00:00.000Z")); // 17:00 JST, still local date 2026-09-25
    const tokyoRun3 = makeAdminClient({
      profiles: [profileRow({ digest_timezone: "Asia/Tokyo", digest_hour_local: 9 })],
      recent: { data: [], error: null },
      sameDate: {
        data: [{ delivered_at: firstDeliveredAt }, { delivered_at: secondDeliveredAt }],
        error: null,
      },
    });
    mocks.createAdminClient.mockReturnValue(tokyoRun3.client);
    const thirdBody = await (await GET(authedRequest())).json();

    expect(thirdBody.dispatched_count).toBe(0);
    expect(thirdBody.skipped_reasons).toEqual({ already_delivered_today: 1 });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(2); // no further email
  });

  it("DST fall-back day (America/Chicago, 2026-11-01, when 01:00-01:59 happens twice): both occurrences of the repeated hour plus a later same-day run add up to exactly one send", async () => {
    const tz = "America/Chicago";
    const chosenHour = 1;

    // First occurrence: 01:15 CDT (pre-transition, UTC-5) -- due, sends.
    const runA = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: chosenHour })],
    });
    mocks.createAdminClient.mockReturnValue(runA.client);
    vi.setSystemTime(new Date("2026-11-01T06:15:00.000Z"));
    const bodyA = await (await GET(authedRequest())).json();
    expect(bodyA.dispatched_count).toBe(1);
    const deliveredAtA = new Date("2026-11-01T06:15:00.000Z").toISOString();

    // Second occurrence of the SAME local hour: 01:45 CST (post-transition,
    // UTC-6), 1.5h of real time after the first send -- still inside the
    // pre-existing 6-hour lookback, so the OLD guard fires first.
    const runB = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: chosenHour })],
      recent: { data: [{ id: 1 }], error: null },
      sameDate: { data: [{ delivered_at: deliveredAtA }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(runB.client);
    vi.setSystemTime(new Date("2026-11-01T07:45:00.000Z"));
    const bodyB = await (await GET(authedRequest())).json();
    expect(bodyB.dispatched_count).toBe(0);
    expect(bodyB.skipped_reasons).toEqual({ recent_delivery: 1 });

    // A later run the SAME local day (08:00 CST, 7h45 after the first
    // send): past the 6-hour window, but the NEW same-local-date guard
    // catches it.
    const runC = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: chosenHour })],
      recent: { data: [], error: null },
      sameDate: { data: [{ delivered_at: deliveredAtA }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(runC.client);
    vi.setSystemTime(new Date("2026-11-01T14:00:00.000Z"));
    const bodyC = await (await GET(authedRequest())).json();
    expect(bodyC.dispatched_count).toBe(0);
    expect(bodyC.skipped_reasons).toEqual({ already_delivered_today: 1 });

    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1); // exactly one send across all 3 runs
  });

  it("two runs 20 minutes apart, both after the chosen hour: exactly one send, and the second is skipped by the pre-existing 6-hour guard, not the new same-date guard", async () => {
    const first = makeAdminClient({ profiles: [profileRow({ digest_hour_local: 9 })] });
    mocks.createAdminClient.mockReturnValue(first.client);
    vi.setSystemTime(new Date("2026-09-24T09:10:00.000Z")); // local hour 9 (UTC), due
    const firstBody = await (await GET(authedRequest())).json();
    expect(firstBody.dispatched_count).toBe(1);
    const firstDeliveredAt = new Date("2026-09-24T09:10:00.000Z").toISOString();

    vi.setSystemTime(new Date("2026-09-24T09:30:00.000Z")); // 20 minutes later, same date
    const second = makeAdminClient({
      profiles: [profileRow({ digest_hour_local: 9 })],
      recent: { data: [{ id: 1 }], error: null }, // within 6h: the OLD guard fires first
      sameDate: { data: [{ delivered_at: firstDeliveredAt }], error: null }, // also true, must not be the credited reason
    });
    mocks.createAdminClient.mockReturnValue(second.client);
    const secondBody = await (await GET(authedRequest())).json();

    expect(secondBody.dispatched_count).toBe(0);
    // Which guard is credited matters: the pre-existing 6-hour lookback,
    // not the new same-local-date guard, even though both would fire here.
    expect(secondBody.skipped_reasons).toEqual({ recent_delivery: 1 });
    expect(second.insertFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1); // exactly one send across both runs
  });

  // DIGEST-CATCHUP-TRIPWIRES addendum (review finding TW-F1,
  // docs/jev-abc/DIGEST-CATCHUP-TRIPWIRES-A-20260930T055418Z.md): none of
  // the three tests above have a delivery/run pair whose LOCAL dates
  // differ while their UTC calendar dates coincide, so none of them can
  // tell "compares local dates" apart from "compares UTC dates" -- a
  // mutation swapping in a hardcoded "UTC" at the guard's call site turned
  // no test red. This one closes that gap directly.
  it("UTC-vs-local-date tripwire (review TW-F1): a Chicago reader's previous delivery shares the new run's UTC calendar date but not its local one -- the guard compares LOCAL dates, so this run still sends", async () => {
    const tz = "America/Chicago";
    const chosenHour = 8;

    // Day D, 23:30 CDT -- America/Chicago LOCAL date 2026-09-24, but
    // already 2026-09-25 in UTC (04:30Z). Verified with Node's Intl
    // before writing this test (see the checkpoint doc's addendum).
    const first = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: chosenHour })],
    });
    mocks.createAdminClient.mockReturnValue(first.client);
    vi.setSystemTime(new Date("2026-09-25T04:30:00.000Z"));
    const firstBody = await (await GET(authedRequest())).json();
    expect(firstBody.dispatched_count).toBe(1);
    const firstDeliveredAt = new Date("2026-09-25T04:30:00.000Z").toISOString();

    // Day D+1, 08:00 CDT -- LOCAL date 2026-09-25 (a genuinely new local
    // day), and ALSO 2026-09-25 in UTC (13:00Z) -- the SAME UTC calendar
    // date as the first delivery, even though the local dates differ.
    // 8.5h of real elapsed time: past the 6-hour guard, so that guard is
    // not what decides this run either way.
    const second = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: chosenHour })],
      recent: { data: [], error: null }, // > 6h: the old guard is silent
      sameDate: { data: [{ delivered_at: firstDeliveredAt }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(second.client);
    vi.setSystemTime(new Date("2026-09-25T13:00:00.000Z"));
    const secondBody = await (await GET(authedRequest())).json();

    // The guard must judge "today" in the READER's own local zone: local
    // dates 2026-09-24 vs 2026-09-25 differ, so this is genuinely a new
    // day and the run sends. A guard that instead compared UTC dates
    // would see 2026-09-25 == 2026-09-25 and wrongly block it (TW-F1).
    expect(secondBody.dispatched_count).toBe(1);
    expect(secondBody.skipped_reasons.already_delivered_today).toBeUndefined();
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(2);
  });
});
