import { describe, expect, it } from "vitest";
import {
  AFTER_SIGN_IN_COOKIE_MAX_AGE_SECONDS,
  AFTER_SIGN_IN_COOKIE_NAME,
  RETURN_PATH_MAX_LENGTH,
  safeReturnPath,
} from "./return-path";

// The callback joins this value to its own origin, so anything that is not a
// plain same-site path to one of the two allowed pages must come back null.

describe("safeReturnPath — the places a sign-in may come back to", () => {
  it.each([
    "/welcome",
    "/profile",
    "/welcome?step=account",
    "/welcome?step=ai",
    "/profile?tab=account",
    "/welcome?",
  ])("accepts %s, unchanged", (value) => {
    expect(safeReturnPath(value)).toBe(value);
  });

  it("names the cookie and its ten-minute life once, for both sides", () => {
    expect(AFTER_SIGN_IN_COOKIE_NAME).toBe("peer_after_sign_in");
    expect(AFTER_SIGN_IN_COOKIE_MAX_AGE_SECONDS).toBe(600);
  });
});

describe("safeReturnPath — refuses everything else", () => {
  it.each([
    ["missing", undefined],
    ["null", null],
    ["empty", ""],
    ["the root (not one of the two pages)", "/"],
    ["another page", "/papers"],
    ["a protocol-relative host", "//evil.com"],
    ["a protocol-relative host with a path", "//evil.com/welcome"],
    ["a backslash host", "/\\evil.com"],
    ["a backslash later on", "/welcome\\..\\evil.com"],
    ["a backslash in the query", "/welcome?step=\\evil"],
    ["a userinfo host", "@evil.com"],
    ["a full https URL", "https://evil.com/welcome"],
    ["a full https URL on Peer itself", "https://peer.homes/welcome"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a relative path", "welcome"],
    ["a longer path that starts the same", "/welcomeX"],
    ["a sub-path", "/welcome/evil"],
    ["a fragment on the path", "/welcome#step=ai"],
    ["an encoded slash pair", "/%2F%2Fevil.com"],
    ["an encoded leading slash pair", "%2F%2Fevil.com"],
    ["an encoded backslash", "/%5Cevil.com"],
    ["an encoded query mark", "/welcome%3Fstep=ai"],
    ["an encoded path", "/%77elcome"],
    ["a dot segment", "/welcome/../evil"],
    ["a newline", "/welcome\nLocation: https://evil.com"],
    ["a carriage return", "/welcome?step=ai\r"],
    ["a tab", "/welcome\t"],
    ["a NUL", "/welcome\u0000"],
    ["DEL", "/welcome?\u007f"],
    ["a C1 control", "/welcome?\u0085"],
  ])("refuses %s", (_label, value) => {
    expect(safeReturnPath(value as string | null | undefined)).toBeNull();
  });

  it("allows a value of exactly the maximum length and refuses one character more", () => {
    const base = "/welcome?step=";
    const atMax = base + "a".repeat(RETURN_PATH_MAX_LENGTH - base.length);
    expect(atMax).toHaveLength(200);
    expect(safeReturnPath(atMax)).toBe(atMax);
    expect(safeReturnPath(atMax + "a")).toBeNull();
  });
});
