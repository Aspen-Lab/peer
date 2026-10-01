import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { resetCounterStoreForTests } from "@/lib/usage/counters";
import { signConfirmToken } from "@/lib/email/confirm-token";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  select: vi.fn(),
  maybeSingle: vi.fn(),
  upsert: vi.fn(),
  sendDigestEmail: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { getUser: mocks.getUser },
      from: () => ({
        select: mocks.select,
        upsert: mocks.upsert,
      }),
    }),
}));
vi.mock("@/lib/email/send-digest", () => ({ sendDigestEmail: mocks.sendDigestEmail }));

import { GET, POST } from "./route";

const SECRET = "TEST-CONFIRM-SECRET";

function postRequest(body: unknown): NextRequest {
  return new NextRequest("http://peer.test/api/profile/confirm-email", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function getRequest(token?: string): NextRequest {
  const qs = token !== undefined ? `?token=${encodeURIComponent(token)}` : "";
  return new NextRequest(`http://peer.test/api/profile/confirm-email${qs}`);
}

function locationQuery(response: Response): string {
  const location = response.headers.get("location") ?? "";
  return location.includes("?") ? location.slice(location.indexOf("?") + 1) : "";
}

// EMAIL-TOKEN-REPLAY (§1bn): priorEmail defaults to "" (nothing stored yet
// at mint time) so every call site that never passed one keeps minting a
// token whose priorEmail matches this file's default mock
// (`mocks.maybeSingle` -> `digest_email: null`, see beforeEach). Module
// scope (not just inside one describe block) so both the ordinary GET tests
// and the EMAIL-TOKEN-REPLAY describe block below can mint tokens.
function tokenFor(uid: string, email: string, now = new Date(), priorEmail = ""): string {
  return signConfirmToken(SECRET, uid, email, priorEmail, now);
}

beforeEach(() => {
  vi.clearAllMocks();
  resetCounterStoreForTests();
  vi.stubEnv("DIGEST_EMAIL_CONFIRM_SECRET", SECRET);
  // Deliberately NOT stubbing NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY
  // — the counter store stays the deterministic in-memory fallback.
  mocks.getUser.mockResolvedValue({
    data: { user: { id: "user-1", email: "account@example.test" } },
  });
  mocks.select.mockImplementation(() => ({ eq: () => ({ maybeSingle: mocks.maybeSingle }) }));
  mocks.maybeSingle.mockResolvedValue({ data: { digest_email: null }, error: null });
  mocks.upsert.mockResolvedValue({ error: null });
  mocks.sendDigestEmail.mockResolvedValue({ sent: true, messageId: "msg-1" });
});

afterEach(() => {
  vi.unstubAllEnvs();
  resetCounterStoreForTests();
});

describe("auth", () => {
  it("POST: 401 with no session, nothing written", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await POST(postRequest({ email: "new@example.test" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthenticated" });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("GET: redirects to a calm sign-in message with no session, nothing written (see route.ts header's Deviations note vs. the literal RED-list '401')", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null } });

    const response = await GET(getRequest("whatever.token"));

    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    expect(locationQuery(response)).toBe("digest_email_confirm=signin_required");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("POST validation (P9)", () => {
  it("rejects a syntactically invalid address, spends no counter, sends nothing", async () => {
    const response = await POST(postRequest({ email: "not-an-email" }));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_email" });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("rejects a missing/blank email field", async () => {
    const response = await POST(postRequest({}));
    expect(response.status).toBe(400);
  });

  it("accepts one well-formed NEW address: sends the confirmation email and returns a generic sent response", async () => {
    const response = await POST(postRequest({ email: "New@Example.test" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, confirmed: false });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(1);
    const call = mocks.sendDigestEmail.mock.calls[0][0];
    expect(call.to).toBe("new@example.test"); // normalized
    expect(call.items).toEqual([]);
    expect(call.render.subject).toMatch(/confirm/i);
    expect(call.render.html).toContain("Confirm email");
    // Does not write digest_email yet — nothing is written until the link is clicked.
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("EMAIL-TOKEN-PRIVACY: the confirm URL sent to the reader never contains the address — plain, base64, or URL-encoded", async () => {
    const email = "new@example.test";
    await POST(postRequest({ email }));

    const call = mocks.sendDigestEmail.mock.calls[0][0];
    const localPart = email.split("@")[0];
    const variants = [
      email,
      encodeURIComponent(email),
      localPart,
      Buffer.from(email, "utf8").toString("base64"),
      Buffer.from(email, "utf8").toString("base64url"),
    ];
    for (const text of [call.render.html, call.render.text] as string[]) {
      for (const variant of variants) {
        expect(text).not.toContain(variant);
      }
      // The domain alone is deliberately not checked here: "example.test" is
      // also the Peer brand/link domain in this test fixture, so asserting
      // its absence would be a false requirement — the local-part and
      // whole-address checks above are what actually catch a reintroduced
      // leak.
    }
  });
});

describe("the confirmation send itself fails (§1al POLISH-1-EMAIL (f))", () => {
  it("Resend's sandbox sender-not-allowed wording -> 502 sender_not_verified, no raw text", async () => {
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      errorCode: "validation_error",
      error:
        "You can only send testing emails to your own email address (owner@example.test). To send emails to other recipients, please verify a domain at resend.com/domains.",
    });

    const response = await POST(postRequest({ email: "new@example.test" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "sender_not_verified" });
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("any other send failure -> 502 confirmation_send_failed, no raw text", async () => {
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      errorCode: "validation_error",
      error: "Invalid `to` field.",
    });

    const response = await POST(postRequest({ email: "new@example.test" }));

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "confirmation_send_failed" });
  });

  it("does not refund the daily confirmation-request counter on a send failure", async () => {
    mocks.sendDigestEmail.mockResolvedValue({ sent: false, error: "boom" });

    for (let i = 0; i < 5; i += 1) {
      const response = await POST(postRequest({ email: `new${i}@example.test` }));
      expect(response.status).toBe(502);
    }
    const sixth = await POST(postRequest({ email: "new5@example.test" }));
    expect(sixth.status).toBe(429);
  });

  it("logs the provider's error name + message with the address redacted, never a raw address", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.sendDigestEmail.mockResolvedValue({
      sent: false,
      errorCode: "validation_error",
      error: "You can only send testing emails to your own email address (owner@example.test).",
    });

    await POST(postRequest({ email: "new@example.test" }));

    const logged = errorSpy.mock.calls.map((args) => args.join(" ")).join("\n");
    expect(logged).toContain("validation_error");
    expect(logged).toContain("[email]");
    expect(logged).not.toContain("owner@example.test");
    errorSpy.mockRestore();
  });
});

describe("already-confirmed short-circuit (§2.2)", () => {
  it("account's own email: writes directly, no token, no email sent", async () => {
    const response = await POST(postRequest({ email: "Account@Example.test" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      confirmed: true,
      email: "account@example.test",
    });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", digest_email: "account@example.test" },
      { onConflict: "user_id" },
    );
  });

  it("the address already stored: writes directly (idempotent), no email sent", async () => {
    mocks.maybeSingle.mockResolvedValue({
      data: { digest_email: "already@example.test" },
      error: null,
    });

    const response = await POST(postRequest({ email: "Already@Example.test" }));

    expect(response.status).toBe(200);
    expect((await response.json()).confirmed).toBe(true);
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("the account's own email still works even when DIGEST_EMAIL_CONFIRM_SECRET is unset (§1z P6)", async () => {
    vi.stubEnv("DIGEST_EMAIL_CONFIRM_SECRET", "");

    const response = await POST(postRequest({ email: "account@example.test" }));

    expect(response.status).toBe(200);
    expect((await response.json()).confirmed).toBe(true);
  });
});

describe("DIGEST_EMAIL_CONFIRM_SECRET unset — a DIFFERENT address is unavailable (§1z P6)", () => {
  it("POST: honest 503 — not 500 (§1al POLISH-1-EMAIL (a)) — no email sent, no counter spent", async () => {
    vi.stubEnv("DIGEST_EMAIL_CONFIRM_SECRET", "");

    const response = await POST(postRequest({ email: "new@example.test" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "email_confirmation_unavailable" });
    expect(mocks.sendDigestEmail).not.toHaveBeenCalled();
  });

  it("GET: redirects to an honest 'unavailable' outcome", async () => {
    vi.stubEnv("DIGEST_EMAIL_CONFIRM_SECRET", "");

    const response = await GET(getRequest("some.token"));

    expect(locationQuery(response)).toBe("digest_email_confirm=unavailable");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

describe("rate limit — 5/day, fails CLOSED (§1z P1/P3)", () => {
  it("the 6th confirmation request the same UTC day is refused; the first 5 succeed", async () => {
    for (let i = 0; i < 5; i += 1) {
      const response = await POST(postRequest({ email: `new${i}@example.test` }));
      expect(response.status).toBe(200);
    }
    const sixth = await POST(postRequest({ email: "new5@example.test" }));
    expect(sixth.status).toBe(429);
    expect(await sixth.json()).toEqual({ error: "rate_limited" });
    expect(mocks.sendDigestEmail).toHaveBeenCalledTimes(5);
  });

  it("the short-circuit path never spends the counter (only a genuinely new address does)", async () => {
    for (let i = 0; i < 5; i += 1) {
      await POST(postRequest({ email: `new${i}@example.test` }));
    }
    // The counter is now exhausted for new addresses...
    const seventh = await POST(postRequest({ email: "new-again@example.test" }));
    expect(seventh.status).toBe(429);
    // ...but the account's own (already-confirmed) email still goes through,
    // because the short-circuit never touches this counter.
    const ownEmail = await POST(postRequest({ email: "account@example.test" }));
    expect(ownEmail.status).toBe(200);
  });
});

describe("GET — token verification (re-uses confirm-token.ts, tested there in isolation)", () => {
  it("valid token for the signed-in user: writes digest_email, redirects to the confirmed outcome", async () => {
    // Also the "ordinary case" for EMAIL-TOKEN-REPLAY (§1bn): nothing else
    // happened since mint (the default mock's digest_email is null, and
    // tokenFor's default priorEmail is "") — proves the new current-address
    // check has no false positive on a plain first confirmation.
    const token = tokenFor("user-1", "new@example.test");

    const response = await GET(getRequest(token));

    expect(locationQuery(response)).toBe("digest_email_confirmed=1");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", digest_email: "new@example.test" },
      { onConflict: "user_id" },
    );
  });

  it("re-use: the SAME valid token GET-ed twice both succeed identically (not single-use)", async () => {
    const token = tokenFor("user-1", "new@example.test");

    const first = await GET(getRequest(token));
    const second = await GET(getRequest(token));

    expect(locationQuery(first)).toBe("digest_email_confirmed=1");
    expect(locationQuery(second)).toBe("digest_email_confirmed=1");
    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("tampered signature: rejected, no DB write", async () => {
    const token = tokenFor("user-1", "new@example.test");
    const [payload, sig] = token.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);

    const response = await GET(getRequest(`${payload}.${flipped}`));

    expect(locationQuery(response)).toBe("digest_email_confirm=invalid_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("expired token: rejected, no DB write (signed far enough in the past that any real clock has passed its 24h TTL)", async () => {
    const token = tokenFor("user-1", "new@example.test", new Date(0));

    const response = await GET(getRequest(token));

    expect(locationQuery(response)).toBe("digest_email_confirm=invalid_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("token minted for a DIFFERENT user than the one signed in: rejected, and the signed-in user's own row is untouched", async () => {
    const token = tokenFor("user-A", "new@example.test");
    mocks.getUser.mockResolvedValue({
      data: { user: { id: "user-B", email: "b@example.test" } },
    });

    const response = await GET(getRequest(token));

    expect(locationQuery(response)).toBe("digest_email_confirm=wrong_account");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("missing token: rejected as an invalid link, no DB write", async () => {
    const response = await GET(getRequest());
    expect(locationQuery(response)).toBe("digest_email_confirm=invalid_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });
});

// EMAIL-TOKEN-REPLAY (ABC-JEV-INTEGRATION.md §1bn, guide
// docs/jev-abc/EMAIL-TOKEN-REPLAY-B-20260930T055356Z.md). A token inside its
// 24h TTL can still be STALE once the live digest_email has moved on for a
// different reason. Every scenario here reconfigures `mocks.maybeSingle`
// (the mocked `currentDigestEmail`/`profiles.select` read) to represent
// "what the DB holds right now" at the moment of each GET — the mock has no
// real persistence of its own, so each step states explicitly what the
// column holds at that point, the same way `mocks.maybeSingle.mockResolvedValue`
// is already used elsewhere in this file to represent DB state.
describe("EMAIL-TOKEN-REPLAY (§1bn): a token that is still valid can still be stale", () => {
  it("the exact item scenario: mint A, mint B (nothing stored at either mint), confirm B, then click the OLD A link -> stale_link, digest_email stays B, nothing written", async () => {
    const tokenA = tokenFor("user-1", "a@example.test");
    const tokenB = tokenFor("user-1", "b@example.test");

    // Nothing stored yet when B is confirmed.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: null }, error: null });
    const confirmB = await GET(getRequest(tokenB));
    expect(locationQuery(confirmB)).toBe("digest_email_confirmed=1");

    // The DB now holds B when the stale A link is clicked.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "b@example.test" }, error: null });
    mocks.upsert.mockClear();
    const clickA = await GET(getRequest(tokenA));

    // MUTATION ANCHOR: deleting the current-address comparison in route.ts's
    // GET handler turns this assertion red (the old A link would silently
    // succeed and overwrite B back to A instead).
    expect(locationQuery(clickA)).toBe("digest_email_confirm=stale_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("the account-email short-circuit variant: mint for A, the address is now the account email (short-circuit, no token), click A -> stale_link, digest_email stays the account email", async () => {
    const tokenA = tokenFor("user-1", "a@example.test");

    // The account's own email already went through the POST short-circuit
    // (§2.2) by the time this old A link is clicked.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "account@example.test" }, error: null });
    mocks.upsert.mockClear();

    const response = await GET(getRequest(tokenA));

    expect(locationQuery(response)).toBe("digest_email_confirm=stale_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("the same link opened twice with the DB reflecting the first write in between (a mail-gateway prefetch, then the reader's own click) -- both succeed", async () => {
    const token = tokenFor("user-1", "new@example.test");

    // First open: nothing stored yet -- matches via priorEmail.
    mocks.maybeSingle.mockResolvedValueOnce({ data: { digest_email: null }, error: null });
    const first = await GET(getRequest(token));
    expect(locationQuery(first)).toBe("digest_email_confirmed=1");

    // Second open: the DB now already holds the token's own target address
    // -- matches via "this exact link already applied", not priorEmail.
    mocks.maybeSingle.mockResolvedValueOnce({ data: { digest_email: "new@example.test" }, error: null });
    const second = await GET(getRequest(token));
    expect(locationQuery(second)).toBe("digest_email_confirmed=1");

    expect(mocks.upsert).toHaveBeenCalledTimes(2);
  });

  it("re-requesting an address superseded earlier: a fresh token (new priorEmail snapshot) succeeds; the original stale token is a harmless no-op while its target is still current, then rejected once a third address supersedes it", async () => {
    const staleTokenA = tokenFor("user-1", "a@example.test"); // minted while nothing was stored
    const tokenB = tokenFor("user-1", "b@example.test");

    // Confirm B.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: null }, error: null });
    await GET(getRequest(tokenB));

    // Re-request A: the fresh token snapshots today's current value (B).
    const freshTokenA = tokenFor("user-1", "a@example.test", new Date(), "b@example.test");

    // Confirm the fresh A token -> succeeds, current becomes A.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "b@example.test" }, error: null });
    mocks.upsert.mockClear();
    const confirmFreshA = await GET(getRequest(freshTokenA));
    expect(locationQuery(confirmFreshA)).toBe("digest_email_confirmed=1");

    // The ORIGINAL, now-doubly-stale A token: current is already A (its own
    // target) -> a harmless idempotent no-op, not stale.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "a@example.test" }, error: null });
    mocks.upsert.mockClear();
    const staleClickWhileStillA = await GET(getRequest(staleTokenA));
    expect(locationQuery(staleClickWhileStillA)).toBe("digest_email_confirmed=1");

    // A third address (e.g. via PUT /api/profile, or another confirm)
    // supersedes A -> the original stale token is now rejected.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "c@example.test" }, error: null });
    mocks.upsert.mockClear();
    const staleClickAfterC = await GET(getRequest(staleTokenA));
    expect(locationQuery(staleClickAfterC)).toBe("digest_email_confirm=stale_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("error precedence: an expired token still reports invalid_link (verifyConfirmToken's own expiry check runs first), never stale_link, even though the address has also changed since", async () => {
    const token = tokenFor("user-1", "a@example.test", new Date(0)); // long expired
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "b@example.test" }, error: null }); // address moved on too
    mocks.upsert.mockClear();

    const response = await GET(getRequest(token));

    expect(locationQuery(response)).toBe("digest_email_confirm=invalid_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("a live digest_email read failure falls back to the same generic invalid_link outcome as a write failure, never a crash and never a write", async () => {
    const token = tokenFor("user-1", "a@example.test");
    mocks.maybeSingle.mockResolvedValue({ data: null, error: { message: "boom" } });

    const response = await GET(getRequest(token));

    expect(locationQuery(response)).toBe("digest_email_confirm=invalid_link");
    expect(mocks.upsert).not.toHaveBeenCalled();
  });

  it("ACCEPTED COST (§1bn.7b): a mint-time snapshot is a VALUE, not a history of events — a link minted for A while no address was set, then B confirmed, then the address cleared (PUT allows clearing without confirmation), then the old A link clicked -> it confirms A (writes)", async () => {
    // accepted cost, §1bn.7b — pins today's behaviour so a change is a
    // conscious decision. The staleness check compares the LIVE address
    // against the token's mint-time snapshot value; it has no memory of
    // events in between. If the live value round-trips back to that exact
    // snapshot — here, by clearing the field back to "" after a real,
    // deliberate change to B — an old, long-abandoned token silently looks
    // indistinguishable from "nothing has changed since mint" and fires.
    // Closing this needs per-user state (a generation counter or column),
    // out of this item's no-migration scope (§1bn point 4); threshold for
    // revisiting: one real report.
    const tokenA = tokenFor("user-1", "a@example.test"); // priorEmail "" — nothing stored at mint
    const tokenB = tokenFor("user-1", "b@example.test");

    // B is confirmed.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: null }, error: null });
    await GET(getRequest(tokenB));

    // The field is cleared — PUT /api/profile allows this unconditionally,
    // no confirmation needed (route.ts:296-327: `let allowed = candidate ===
    // ""`). profilePatchToRow writes digest_email as the literal empty
    // string for a cleared field (route.ts:147, `row.digest_email =
    // p.digestEmail`), simulated here by the live column reading back "" —
    // which happens to equal tokenA's mint-time priorEmail snapshot.
    mocks.maybeSingle.mockResolvedValue({ data: { digest_email: "" }, error: null });
    mocks.upsert.mockClear();

    const clickA = await GET(getRequest(tokenA));

    expect(locationQuery(clickA)).toBe("digest_email_confirmed=1");
    expect(mocks.upsert).toHaveBeenCalledWith(
      { user_id: "user-1", digest_email: "a@example.test" },
      { onConflict: "user_id" },
    );
  });
});

// EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as, guide §4 test 11) — a
// regression guard, not just a point-in-time check: every `profileRedirect`
// call site's query string must be one of a fixed, closed set of keys and
// must never contain "@". Reads the route's own source rather than driving
// every branch through GET/POST (some outcomes, like a DB write failure,
// are already covered behaviourally above; this test's job is to catch a
// FUTURE call site that adds a stray `email`/`address` key, not to
// re-prove today's branches).
describe("EMAIL-TOKEN-PRIVACY: redirect query allow-list (regression guard)", () => {
  it("every profileRedirect(...) literal query string is an allow-listed key, never an address", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const source = fs.readFileSync(
      path.join(process.cwd(), "src/app/api/profile/confirm-email/route.ts"),
      "utf8",
    );
    const ALLOWED = new Set([
      "digest_email_confirm=signin_required",
      "digest_email_confirm=invalid_link",
      "digest_email_confirm=unavailable",
      "digest_email_confirm=wrong_account",
      // stale_link added — EMAIL-TOKEN-REPLAY (§1bn): a real new outcome,
      // not an address, so it belongs on this allow-list like every other
      // outcome above.
      "digest_email_confirm=stale_link",
      "digest_email_confirmed=1",
    ]);
    const calls = [...source.matchAll(/profileRedirect\(req,\s*"([^"]*)"\)/g)].map((m) => m[1]);
    expect(calls.length).toBeGreaterThan(0); // sanity: the regex actually matched every call site
    for (const query of calls) {
      expect(query).not.toContain("@");
      expect(ALLOWED.has(query)).toBe(true);
    }
  });
});
