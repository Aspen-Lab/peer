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
  function tokenFor(uid: string, email: string, now = new Date()): string {
    return signConfirmToken(SECRET, uid, email, now);
  }

  it("valid token for the signed-in user: writes digest_email, redirects to the confirmed outcome", async () => {
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
