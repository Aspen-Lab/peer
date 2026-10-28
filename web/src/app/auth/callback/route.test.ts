import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// The OAuth callback, called directly with a mocked Supabase server client:
// where it sends the browser after the code exchange, and that it always
// clears the return-path cookie it was handed. Mock pattern as in
// app/api/feed/ack/route.test.ts.

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () =>
    Promise.resolve({
      auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
    }),
}));

import { GET } from "./route";

const COOKIE = "peer_after_sign_in";

function callback(query: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(`https://peer.test/auth/callback${query}`, { headers });
}

function withCookie(raw: string, extra: Record<string, string> = {}): Record<string, string> {
  return { cookie: `sb-other=1; ${COOKIE}=${raw}`, ...extra };
}

/** The Set-Cookie line that clears the return-path cookie, or undefined. */
function clearingLine(response: Response): string | undefined {
  return response.headers
    .getSetCookie()
    .find((line) => line.startsWith(`${COOKIE}=`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.exchangeCodeForSession.mockResolvedValue({ error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /auth/callback — where a successful sign-in lands", () => {
  it("lands on / with no next param and no cookie, as before", async () => {
    const response = await GET(callback("?code=abc"));
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc");
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://peer.test/");
    expect(clearingLine(response)).toBeUndefined();
  });

  it("follows a valid return-path cookie, and clears it", async () => {
    const response = await GET(
      callback("?code=abc", withCookie(encodeURIComponent("/welcome?step=account"))),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/welcome?step=account");
    const line = clearingLine(response);
    expect(line).toBeDefined();
    expect(line).toMatch(/^peer_after_sign_in=;/);
    expect(line).toMatch(/Max-Age=0/i);
    expect(line).toMatch(/Path=\//);
  });

  it("follows the cookie onto the forwarded host, keeping the x-forwarded-host handling", async () => {
    const response = await GET(
      callback(
        "?code=abc",
        withCookie(encodeURIComponent("/welcome?step=ai"), { "x-forwarded-host": "peer.homes" }),
      ),
    );
    expect(response.headers.get("location")).toBe("https://peer.homes/welcome?step=ai");
  });

  it("uses the request origin in development, as before", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = await GET(
      callback(
        "?code=abc",
        withCookie(encodeURIComponent("/profile"), { "x-forwarded-host": "peer.homes" }),
      ),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/profile");
  });

  it.each([
    ["a protocol-relative host", "//evil.com"],
    ["a userinfo host", "@evil.com"],
    ["a full URL", "https://evil.com/welcome"],
    ["a page that is not allowed", "/papers"],
    ["a backslash host", "/\\evil.com"],
  ])("ignores an invalid cookie (%s), lands on /, and still clears it", async (_label, value) => {
    const response = await GET(callback("?code=abc", withCookie(encodeURIComponent(value))));
    expect(response.headers.get("location")).toBe("https://peer.test/");
    expect(clearingLine(response)).toMatch(/Max-Age=0/i);
  });

  it("clears a cookie whose value cannot even be decoded", async () => {
    const response = await GET(callback("?code=abc", withCookie("%E0%A4%A")));
    expect(response.headers.get("location")).toBe("https://peer.test/");
    expect(clearingLine(response)).toMatch(/Max-Age=0/i);
  });

  it("does not decode the cookie a second time (a double-encoded slash pair stays refused)", async () => {
    const response = await GET(
      callback("?code=abc", withCookie(encodeURIComponent("/%2F%2Fevil.com"))),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/");
  });
});

describe("GET /auth/callback — the next param is checked too", () => {
  it("follows a valid next param, ahead of the cookie, and still clears the cookie", async () => {
    const response = await GET(
      callback(`?code=abc&next=${encodeURIComponent("/profile")}`, withCookie(encodeURIComponent("/welcome"))),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/profile");
    expect(clearingLine(response)).toMatch(/Max-Age=0/i);
  });

  it("closes the open redirect: next=@evil.com lands on Peer's own /, not on evil.com", async () => {
    const response = await GET(callback("?code=abc&next=@evil.com"));
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("https://peer.test/");
    expect(new URL(location).host).toBe("peer.test");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "/papers"])(
    "refuses next=%s and lands on /",
    async (value) => {
      const response = await GET(
        callback(`?code=abc&next=${encodeURIComponent(value)}`, { "x-forwarded-host": "peer.homes" }),
      );
      expect(response.headers.get("location")).toBe("https://peer.homes/");
    },
  );

  it("an invalid next param does not fall through to the cookie", async () => {
    const response = await GET(
      callback("?code=abc&next=@evil.com", withCookie(encodeURIComponent("/welcome?step=ai"))),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/");
  });
});

describe("GET /auth/callback — a failed sign-in", () => {
  it("a failed exchange goes to /auth/error and clears the cookie", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const response = await GET(
      callback("?code=abc", withCookie(encodeURIComponent("/welcome?step=account"))),
    );
    expect(response.headers.get("location")).toBe("https://peer.test/auth/error");
    expect(clearingLine(response)).toMatch(/Max-Age=0/i);
  });

  it("no code goes to /auth/error without calling Supabase, and clears the cookie", async () => {
    const response = await GET(callback("", withCookie(encodeURIComponent("/welcome"))));
    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://peer.test/auth/error");
    expect(clearingLine(response)).toMatch(/Max-Age=0/i);
  });

  it("a failed exchange with no cookie sets no cookie of this name", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: { message: "bad code" } });
    const response = await GET(callback("?code=abc"));
    expect(response.headers.get("location")).toBe("https://peer.test/auth/error");
    expect(clearingLine(response)).toBeUndefined();
  });
});
