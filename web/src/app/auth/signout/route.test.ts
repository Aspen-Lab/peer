import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// ACCOUNT-SWITCH (ABC-JEV-INTEGRATION.md §1bt.8 AMENDMENT (b)) — REPLACES
// the §1bt.7 AMENDMENT's URL-parameter marker with a short-lived,
// first-party cookie: the fresh review (docs/jev-abc/ACCOUNT-SWITCH-A-
// 20260930T123154Z.md, CHECK 4) proved a forged, shared, or bookmarked
// link carrying "?signed-out=1" could trigger the same clear a real
// sign-out does. A cookie can only be created by a same-origin Set-Cookie
// response header — this route actually running — never by a URL a
// browser merely navigates to. This file proves the server half: the
// route still calls supabase.auth.signOut() exactly once, still answers
// 303, redirects to the PLAIN root (no query string), and sets the cookie
// with the ruled attributes — same mocking pattern as
// src/app/api/profile/confirm-email/route.test.ts (the only other route in
// this app that both mocks @/lib/supabase/server and asserts on a
// NextResponse.redirect).
const mocks = vi.hoisted(() => ({
  signOut: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { signOut: mocks.signOut },
    }),
}));

import { POST } from "./route";

const COOKIE_NAME = "peer_signed_out";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.signOut.mockResolvedValue({ error: null });
});

describe("POST /auth/signout", () => {
  it("calls supabase.auth.signOut() exactly once", async () => {
    await POST(new NextRequest("https://peer.test/auth/signout", { method: "POST" }));
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  // (ACCOUNT-SWITCH §1bt.8) CHANGED — was "...with the one-time signed-out
  // marker" (a query string); the marker is now a cookie, not a URL
  // parameter, so the redirect target itself goes back to the plain root.
  it("redirects with a 303 to the request's own origin, plain root path, no query string", async () => {
    const response = await POST(new NextRequest("https://peer.test/auth/signout", { method: "POST" }));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://peer.test/");
  });

  // (ACCOUNT-SWITCH §1bt.8) CHANGED — was "...a different origin still
  // gets the marker"; still true about using the real origin, the marker
  // half is gone.
  it("uses the ACTUAL request's origin, not a hard-coded one", async () => {
    const response = await POST(
      new NextRequest("http://localhost:3000/auth/signout", { method: "POST" }),
    );
    expect(response.headers.get("location")).toBe("http://localhost:3000/");
  });

  // (ACCOUNT-SWITCH §1bt.8) CHANGED — was "the redirect target is exactly
  // the marker-carrying path — never the bare root the pre-§1bt.7 code
  // used" (the OPPOSITE of what is now correct: the bare root IS the
  // intended target now). Repurposed into the AMENDMENT's own required
  // test: the route sets the cookie with the stated attributes. Every
  // attribute checked individually so a partial regression (e.g. a wrong
  // Max-Age) fails on its own line, not a single brittle exact-string
  // match — cookie-string serialization order is an implementation detail
  // this test does not want to pin.
  it("sets the sign-out cookie with the ruled attributes: name=1, Max-Age=60, Path=/, SameSite=Lax, NOT HttpOnly", async () => {
    const response = await POST(new NextRequest("https://peer.test/auth/signout", { method: "POST" }));
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${COOKIE_NAME}=1`);
    expect(setCookie).toMatch(/Max-Age=60/i);
    expect(setCookie).toMatch(/Path=\//i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).not.toMatch(/HttpOnly/i);
  });

  // MUTATION GUARD (pairs with profile-sync.test.tsx's cookie-driven-clear
  // tests): if this route ever stopped setting the cookie, or reverted to
  // redirecting with the old "?signed-out=1" query string, a real,
  // deliberate sign-out would silently stop clearing local profile state
  // (no cookie → processConfirmedSignOutCookie does nothing), or worse,
  // the forged-link vector this AMENDMENT closes would reopen.
  it("the redirect target never carries the old query-string marker, and the cookie is the only thing that carries the signal", async () => {
    const response = await POST(new NextRequest("https://peer.test/auth/signout", { method: "POST" }));
    const location = response.headers.get("location") ?? "";
    expect(location).not.toContain("signed-out");
    expect(location).not.toContain("?");
    expect(response.headers.get("set-cookie") ?? "").toContain(COOKIE_NAME);
  });
});
