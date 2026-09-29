// P4-S7-IDEM (Round 3) -- ABC-JEV-INTEGRATION.md §4 "P4-S7-IDEM B complete"
// ruling; design doc docs/jev-abc/P4-S7-IDEM-B-20260924T113658Z.md; C
// checkpoint docs/jev-abc/P4-S7-IDEM-C-<UTC>.md. NEW file -- does not edit
// the existing (untouchable, owned by another writer) ./route.test.ts.
//
// Covers the SEND-step retry-safety layered on top of the already-verified
// CLAIM-step dedupe (P4-S7-C/A/T-C): a deterministic Resend Idempotency-Key
// per (user_id, local_date), persisted-and-replayed rendered email content
// (never re-rendered on retry -- digest-template.ts's three render
// functions each call `new Date()`, so a naive re-render would silently
// break Resend's own payload-match check), and the conflict-branch decision
// ladder from the manager's §4 ruling: sent -> skip; no send-status at all
// (legacy/pre-change or an unreadable row) -> treat as sent -> skip;
// unsent + stored body + attemptedAt <= 23h -> replay; > 23h -> expired,
// no send.
//
// `@/lib/email/digest-template` is deliberately NOT mocked here (unlike
// send-digest.test.ts) -- this file wants the REAL rendered bytes flowing
// through so the byte-identical-replay regression pin is a genuine
// end-to-end proof, not a mock artifact.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { GET, digestIdempotencyKey } from "./route";

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
  vi.useRealTimers();
});

// ── local test fixtures/helpers (independent of route.test.ts's own,
// unreachable from this file since it does not export them) ──────────────

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

type BriefingRow = { id: number; payload: { items?: unknown[]; email?: Record<string, unknown> } };

function makeAdminClient(options: {
  profiles: unknown[];
  recent?: { data: unknown; error: unknown };
  past?: { data: unknown; error: unknown };
  insert?: { data: unknown; error: unknown };
  rpc?: { data: unknown; error: unknown };
  getUserById?: { data: unknown; error: unknown };
  /** The row a claim-conflict SELECT ("id, payload") should find, if any. */
  conflictRow?: BriefingRow | null;
  conflictSelectError?: { message: string } | null;
}) {
  const insertFn = vi.fn<(row: unknown) => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve(options.insert ?? { data: null, error: null }),
  );
  const rpcFn = vi.fn<(fn: string, args: unknown) => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve(options.rpc ?? { data: [{ id: 1 }], error: null }),
  );
  const getUserByIdFn = vi.fn<(userId: string) => Promise<{ data: unknown; error: unknown }>>(() =>
    Promise.resolve(
      options.getUserById ?? { data: { user: { email: "fallback@example.test" } }, error: null },
    ),
  );
  const conflictSelectFn = vi.fn(() =>
    chain(
      options.conflictSelectError
        ? { data: null, error: options.conflictSelectError }
        : { data: options.conflictRow ? [options.conflictRow] : [], error: null },
    ),
  );
  const updateCalls: { deliveryId: unknown; payload: unknown }[] = [];
  const updateFn = vi.fn((patch: { payload: unknown }) => ({
    eq: (_col: string, deliveryId: unknown) => {
      updateCalls.push({ deliveryId, payload: patch.payload });
      return Promise.resolve({ data: null, error: null });
    },
  }));

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
          select: (cols: string) => {
            if (cols === "id") return chain(options.recent ?? { data: [], error: null });
            if (cols === "id, payload") return conflictSelectFn();
            return chain(options.past ?? { data: [], error: null });
          },
          insert: insertFn,
          update: updateFn,
        };
      }
      throw new Error(`makeAdminClient: unexpected table "${table}"`);
    },
    rpc: rpcFn,
    auth: { admin: { getUserById: getUserByIdFn } },
  };
  return { client, insertFn, rpcFn, getUserByIdFn, conflictSelectFn, updateFn, updateCalls };
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

function expectedKey(userId: string, localDate: string): string {
  return createHash("sha256").update(`peer-digest-email:v1:${userId}:${localDate}`).digest("hex");
}

describe("digestIdempotencyKey (pure)", () => {
  it("is deterministic: identical inputs produce identical output across repeated calls", () => {
    const a = digestIdempotencyKey("user-1", "2026-09-24");
    const b = digestIdempotencyKey("user-1", "2026-09-24");
    expect(a).toBe(b);
    expect(a).toBe(expectedKey("user-1", "2026-09-24"));
  });

  it("a different user_id OR a different local_date produces a different key", () => {
    const base = digestIdempotencyKey("user-1", "2026-09-24");
    expect(digestIdempotencyKey("user-2", "2026-09-24")).not.toBe(base);
    expect(digestIdempotencyKey("user-1", "2026-09-25")).not.toBe(base);
  });

  it("format sanity: lowercase hex, well under Resend's 256-char cap", () => {
    const key = digestIdempotencyKey("user-1", "2026-09-24");
    expect(key).toMatch(/^[0-9a-f]+$/);
    expect(key.length).toBeLessThan(256);
  });

  it("carries no raw personal data: the literal user_id and local_date never appear as substrings of the key", () => {
    const userId = "11111111-2222-3333-4444-555555555555";
    const key = digestIdempotencyKey(userId, "2026-09-24");
    expect(key).not.toContain(userId);
    expect(key).not.toContain("2026-09-24");
    expect(key).not.toContain("2026");
  });
});

describe("GET /api/jobs/dispatch-digests -- P4-S7-IDEM Resend idempotency key + replay", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("CRON_SECRET", "test-secret");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-24T15:00:00.000Z"));
    mocks.runFeedPipeline.mockResolvedValue({ items: [], meta: {} });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
  });

  it("flag off: sendDigestEmail is called with exactly the original 4 fields -- no idempotencyKey, no render, byte-identical to pre-P4-S7-IDEM", async () => {
    const { client, updateFn } = makeAdminClient({ profiles: [profileRow()] });
    mocks.createAdminClient.mockReturnValue(client);

    await GET(authedRequest());

    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    const arg = mocks.sendDigestEmail.mock.calls[0][0];
    expect(arg).toEqual({
      to: "person@example.test",
      firstName: "Test",
      items: [],
      originUrl: expect.any(String),
    });
    expect(arg).not.toHaveProperty("idempotencyKey");
    expect(arg).not.toHaveProperty("render");
    expect(updateFn).not.toHaveBeenCalled(); // no bookkeeping writes at all when the flag is off
  });

  it("flag on, first-ever attempt: sends with the independently-computable key, persists the pending record BEFORE sending, then replaces it with {sent,sentAt} after a confirmed send", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, rpcFn, updateCalls } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [{ id: 555 }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-abc" });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(rpcFn).toHaveBeenCalledWith(
      "claim_briefing_delivery",
      expect.objectContaining({ p_local_date: "2026-09-24" }),
    );
    const expected = expectedKey("user-1", "2026-09-24");

    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    const sendArg = mocks.sendDigestEmail.mock.calls[0][0];
    expect(sendArg.idempotencyKey).toBe(expected);
    expect(sendArg.render).toBeDefined();
    expect(typeof sendArg.render.subject).toBe("string");
    expect(typeof sendArg.render.html).toBe("string");
    expect(typeof sendArg.render.text).toBe("string");

    // Pre-send write happened BEFORE the send resolved its outcome, i.e. it
    // must be the FIRST update call, targeting the claimed row's id, and it
    // must carry the exact rendered bytes just passed to sendDigestEmail.
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);
    const pre = updateCalls[0];
    expect(pre.deliveryId).toBe(555);
    expect(pre.payload).toMatchObject({
      email: {
        idempotencyKey: expected,
        to: "person@example.test",
        subject: sendArg.render.subject,
        html: sendArg.render.html,
        text: sendArg.render.text,
      },
    });
    expect((pre.payload as { email: { attemptedAt: string } }).email.attemptedAt).toEqual(
      expect.any(String),
    );

    // Post-send write replaces payload.email with a bare confirmation --
    // no body kept.
    const post = updateCalls[updateCalls.length - 1];
    expect(post.deliveryId).toBe(555);
    expect(post.payload).toMatchObject({ email: { sent: true } });
    const postEmail = (post.payload as { email: Record<string, unknown> }).email;
    expect(postEmail).not.toHaveProperty("subject");
    expect(postEmail).not.toHaveProperty("html");
    expect(postEmail).not.toHaveProperty("text");
    expect(postEmail.sentAt).toEqual(expect.any(String));

    // EMAIL-TOKEN-PRIVACY (§1as): a count only, no per-reader messageId list
    // — the stronger assertion (the right key/render/to reached
    // sendDigestEmail) is already checked above via the mock's own call args.
    expect(body.emails_sent_count).toBe(1);
  });

  it("flag on, claim conflict, existing row unsent with a stored body within 23h: replays the EXACT stored bytes and the SAME key, using the STORED `to` (not a freshly resolved one)", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const key = expectedKey("user-1", "2026-09-24");
    const attemptedAt = new Date("2026-09-24T10:00:00.000Z").toISOString(); // 5h before "now" (15:00Z)
    const { client, updateCalls } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null }, // conflict
      conflictRow: {
        id: 777,
        payload: {
          items: [],
          email: {
            idempotencyKey: key,
            to: "stored-recipient@example.test", // deliberately different from profileRow's digest_email
            subject: "STORED_SUBJECT",
            html: "STORED_HTML",
            text: "STORED_TEXT",
            attemptedAt,
          },
        },
      },
    });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "retry-msg" });

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    const sendArg = mocks.sendDigestEmail.mock.calls[0][0];
    expect(sendArg.idempotencyKey).toBe(key);
    expect(sendArg.render).toEqual({ subject: "STORED_SUBJECT", html: "STORED_HTML", text: "STORED_TEXT" });
    expect(sendArg.to).toBe("stored-recipient@example.test");

    const post = updateCalls[updateCalls.length - 1];
    expect(post.deliveryId).toBe(777);
    expect(post.payload).toMatchObject({ email: { sent: true } });

    // EMAIL-TOKEN-PRIVACY (§1as): counts only, no per-reader user_id/messageId list.
    expect(body.emails_sent_count).toBe(1);
    expect(body.dispatched_count).toBe(0); // §4 ruling: retry bookkeeping does not re-add to `dispatched`
  });

  it("flag on, claim conflict, existing row already payload.email.sent === true: skips, never calls sendDigestEmail again", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictRow: { id: 888, payload: { items: [], email: { sent: true, sentAt: "2026-09-24T09:00:00.000Z" } } },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(body.skipped_reasons).toEqual({ already_sent: 1 });
  });

  it("flag on, claim conflict, row has NO send status at all (legacy/pre-change row): treated as sent, skipped with the UNCHANGED original reason, never risks a double send", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictRow: { id: 999, payload: { items: [] } }, // no `email` key at all
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(body.skipped_reasons).toEqual({ already_claimed: 1 });
  });

  it("flag on, claim conflict, the conflict-row SELECT itself errors: fails safe to the same legacy/no-status treatment, never crashes the row into `failed`, never sends", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictSelectError: { message: "connection reset" },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    // EMAIL-TOKEN-PRIVACY (§1as): counts/fixed-code tally, not raw arrays —
    // also proves the raw "connection reset" DB message never surfaces here.
    expect(body.failed_count).toBe(0);
    expect(body.skipped_reasons).toEqual({ already_claimed: 1 });
  });

  it("flag on, claim conflict, row is channel inapp: the pre-existing unconditional skip still fires, no conflict-row SELECT, no send call", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client, conflictSelectFn } = makeAdminClient({
      profiles: [profileRow({ digest_channel: "inapp" })],
      rpc: { data: [], error: null },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(conflictSelectFn).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(body.skipped_reasons).toEqual({ already_claimed: 1 });
  });

  it("flag on, claim conflict, stored attemptedAt is OLDER than 23h: does not send, reports expired-unsent, does not touch the stored row", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const key = expectedKey("user-1", "2026-09-24");
    const attemptedAt = new Date("2026-09-23T10:00:00.000Z").toISOString(); // 29h before "now" (15:00Z next day)
    const { client, updateFn } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictRow: {
        id: 111,
        payload: {
          items: [],
          email: { idempotencyKey: key, to: "person@example.test", subject: "S", html: "H", text: "T", attemptedAt },
        },
      },
    });
    mocks.createAdminClient.mockReturnValue(client);

    const response = await GET(authedRequest());
    const body = await response.json();

    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    expect(updateFn).not.toHaveBeenCalled();
    // EMAIL-TOKEN-PRIVACY (§1as): fixed-code tally, not a {user_id,reason} list.
    expect(body.skipped_reasons).toEqual({ retry_expired: 1 });
  });

  it("409 concurrent_idempotent_requests on retry: treated as in-progress, lands in the skip tally (not emails_failed), row left untouched for a later run", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const key = expectedKey("user-1", "2026-09-24");
    const attemptedAt = new Date("2026-09-24T14:00:00.000Z").toISOString();
    const { client, updateFn } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictRow: {
        id: 222,
        payload: { items: [], email: { idempotencyKey: key, to: "person@example.test", subject: "S", html: "H", text: "T", attemptedAt } },
      },
    });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      error: "another request with this key is in flight",
      errorCode: "concurrent_idempotent_requests",
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    // EMAIL-TOKEN-PRIVACY (§1as): counts/fixed-code tally, not raw arrays.
    expect(body.emails_failed_count).toBe(0);
    expect(body.skipped_reasons).toEqual({ retry_in_progress: 1 });
    expect(updateFn).not.toHaveBeenCalled();
  });

  it("409 invalid_idempotent_request on retry: recorded in emails_failed with a fixed code, Resend's own message never in the response, never resent under a different key/payload", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const key = expectedKey("user-1", "2026-09-24");
    const attemptedAt = new Date("2026-09-24T14:00:00.000Z").toISOString();
    const { client } = makeAdminClient({
      profiles: [profileRow()],
      rpc: { data: [], error: null },
      conflictRow: {
        id: 333,
        payload: { items: [], email: { idempotencyKey: key, to: "person@example.test", subject: "S", html: "H", text: "T", attemptedAt } },
      },
    });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      error: "this idempotency key has already been used on a request that had a different payload",
      errorCode: "invalid_idempotent_request",
    });

    const response = await GET(authedRequest());
    const body = await response.json();

    // EMAIL-TOKEN-PRIVACY (§1as): a fixed code only -- Resend's own message
    // never reaches the response (digest-retry.ts's ConflictOutcome carries
    // no errorCode, so this retry path always classifies to the generic
    // code, same as a direct-send failure with no recognized pattern).
    expect(body.emails_failed_reasons).toEqual({ send_failed: 1 });
    expect(JSON.stringify(body)).not.toContain("idempotency key has already been used");
  });

  it("REGRESSION PIN: a retry made hours later, across a UTC calendar-date boundary (while still the OWNER's same local day, so the claim still conflicts on the same row/key), replays byte-identical content -- proves no re-render happened despite the clock moving", async () => {
    // Anchored to America/Los_Angeles (PDT, UTC-7) so the owner's
    // `local_date` -- which gates whether this is "the same digest" at all
    // -- stays fixed across T1/T2, while the bare UTC calendar date (what
    // an un-parameterized `new Date().toLocaleDateString()` inside
    // digest-template.ts would actually stamp, since it takes no explicit
    // timeZone) rolls forward. This is the exact shape of drift C3 in the B
    // guide identified: local_date and the template's own "today" string
    // are computed independently and can disagree.
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const tz = "America/Los_Angeles";
    const first = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: 13 })],
      rpc: { data: [{ id: 42 }], error: null },
    });
    mocks.createAdminClient.mockReturnValue(first.client);
    vi.setSystemTime(new Date("2026-09-24T20:00:00.000Z")); // 13:00 PDT, 2026-09-24 both locally and in UTC
    mocks.sendDigestEmail.mockResolvedValueOnce({ sent: false, error: "smtp temporarily down" });

    await GET(authedRequest()); // T1 -- claim succeeds, send fails (soft failure, not a throw)
    const firstSendArg = mocks.sendDigestEmail.mock.calls[0][0];
    const storedEmail = (first.updateCalls[0].payload as { email: Record<string, unknown> }).email;

    // T2: 8h later. Still 2026-09-24 in America/Los_Angeles (21:00 PDT) --
    // same local_date, same conflict, same key -- but already 2026-09-25 in
    // UTC. If the fix were missing/incomplete, a naive re-render right here
    // would stamp a visibly different date string into subject/html/text.
    vi.setSystemTime(new Date("2026-09-25T04:00:00.000Z"));
    const second = makeAdminClient({
      profiles: [profileRow({ digest_timezone: tz, digest_hour_local: 21 })],
      rpc: { data: [], error: null }, // conflict: the row from T1 still exists
      conflictRow: { id: 42, payload: { items: [], email: storedEmail } },
    });
    mocks.createAdminClient.mockReturnValue(second.client);
    mocks.sendDigestEmail.mockResolvedValueOnce({ sent: true, messageId: "finally-sent" });

    await GET(authedRequest()); // T2 -- retry
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(2);
    const secondSendArg = mocks.sendDigestEmail.mock.calls[1][0];

    expect(secondSendArg.render).toEqual(firstSendArg.render);
    expect(secondSendArg.idempotencyKey).toBe(firstSendArg.idempotencyKey);
  });

  it("TRUE concurrency: two concurrent retries for the same already-conflicted row compute and send the identical key and identical payload (proves OUR code is race-free; Resend's own cross-process arbitration is B4/B6's documented contract, not something this offline test can execute against)", async () => {
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const key = expectedKey("user-1", "2026-09-24");
    const attemptedAt = new Date("2026-09-24T14:30:00.000Z").toISOString();
    const conflictRow = {
      id: 654,
      payload: {
        items: [],
        email: { idempotencyKey: key, to: "person@example.test", subject: "S", html: "H", text: "T", attemptedAt },
      },
    };
    const a = makeAdminClient({ profiles: [profileRow()], rpc: { data: [], error: null }, conflictRow });
    const b = makeAdminClient({ profiles: [profileRow()], rpc: { data: [], error: null }, conflictRow });
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "concurrent-msg" });

    mocks.createAdminClient.mockReturnValueOnce(a.client).mockReturnValueOnce(b.client);
    await Promise.all([GET(authedRequest()), GET(authedRequest())]);

    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(2);
    const [firstArg, secondArg] = mocks.sendDigestEmail.mock.calls.map((c) => c[0]);
    expect(firstArg.idempotencyKey).toBe(secondArg.idempotencyKey);
    expect(firstArg.render).toEqual(secondArg.render);
    expect(firstArg.to).toBe(secondArg.to);
  });

  it("never logs the rendered body (subject/html/text) to the console at any point in the claim -> persist -> send -> confirm flow", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    vi.stubEnv("PEER_DIGEST_DEDUPE", "on");
    const { client } = makeAdminClient({ profiles: [profileRow()], rpc: { data: [{ id: 1 }], error: null } });
    mocks.createAdminClient.mockReturnValue(client);
    mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "m" });

    await GET(authedRequest());
    const sendArg = mocks.sendDigestEmail.mock.calls[0][0];

    const allLoggedText = [...logSpy.mock.calls, ...errorSpy.mock.calls, ...warnSpy.mock.calls, ...infoSpy.mock.calls]
      .flat()
      .map((arg) => (typeof arg === "string" ? arg : JSON.stringify(arg)))
      .join("\n");

    expect(allLoggedText).not.toContain(sendArg.render.html);
    expect(allLoggedText).not.toContain(sendArg.render.text);

    logSpy.mockRestore();
    errorSpy.mockRestore();
    warnSpy.mockRestore();
    infoSpy.mockRestore();
  });

  it("never imports or references the dashboard delivery ledger (re-scan; §1p.C.2 must still hold after this item's additions)", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
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
