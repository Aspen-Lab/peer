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

// R14 — one paper page: a signed-out reader with a key is sent from the paper
// to sign in (`/profile?return=…`) and must come back to that paper. Exactly
// `/papers/<one URI-encoded id>`: no further "/", no query, no fragment.
describe("safeReturnPath — one paper page (R14)", () => {
  it.each([
    "/papers/openalex%3AW123",
    "/papers/W4391234567",
    "/papers/arxiv%3A2401.01234",
    "/papers/arxiv:2401.01234v2",
    "/papers/pubmed%3A38012345",
    "/papers/hn%3A39999999",
    "/papers/dblp%3Ajournals.nature.Smith24",
    "/papers/a",
    "/papers/A-Z_a.z~0:9",
    "/papers/%E4%B8%AD%E6%96%87",
    "/papers/...",
    "/papers/%252F",
  ])("accepts %s, unchanged", (value) => {
    expect(safeReturnPath(value)).toBe(value);
  });

  it("accepts the address lane 2's paper link produces, after one decode of its return= value", () => {
    const id = "openalex:W123";
    const link = `/profile?return=${encodeURIComponent(`/papers/${encodeURIComponent(id)}`)}`;
    const value = new URLSearchParams(link.slice(link.indexOf("?"))).get("return");
    expect(value).toBe("/papers/openalex%3AW123");
    expect(safeReturnPath(value)).toBe("/papers/openalex%3AW123");
  });

  // R15 — lane 2's exact link: the paper's "Sign in" goes to
  // `/profile?return=` + encodeURIComponent('/papers/' + encodeURIComponent(paper.id)).
  // dblp ids and old arXiv ids hold a "/", which arrives as %2F inside the one
  // segment; those papers must come back too.
  it.each([
    ["openalex:W1", "/papers/openalex%3AW1"],
    ["dblp:journals/corr/abs-2101-00001", "/papers/dblp%3Ajournals%2Fcorr%2Fabs-2101-00001"],
    ["arxiv:hep-th/9901001", "/papers/arxiv%3Ahep-th%2F9901001"],
  ])("lane 2's link for %s comes back through URLSearchParams and is accepted", (id, expected) => {
    const link = `/profile?return=${encodeURIComponent("/papers/" + encodeURIComponent(id))}`;
    const value = new URLSearchParams(link.slice(link.indexOf("?"))).get("return");
    expect(value).toBe(expected);
    expect(safeReturnPath(value)).toBe(expected);
  });

  it("an encoded slash stays inside the one segment: the URL keeps Peer's host and a single /papers/ segment", () => {
    for (const value of [
      "/papers/dblp%3Ajournals%2Fcorr%2Fabs-2101-00001",
      "/papers/arxiv%3Ahep-th%2F9901001",
      "/papers/..%2F..%2Fwelcome",
      "/papers/a%2F%2Fevil.com",
    ]) {
      expect(safeReturnPath(value), value).toBe(value);
      const url = new URL(`https://peer.homes${value}`);
      expect(url.host).toBe("peer.homes");
      expect(url.pathname).toBe(value);
      expect(url.pathname.split("/")).toHaveLength(3); // "", "papers", the id
    }
  });

  it.each([
    ["the bare prefix", "/papers/"],
    ["no prefix slash", "/papers"],
    ["a second segment", "/papers/a/b"],
    ["a trailing slash", "/papers/a/"],
    ["a sub-page", "/papers/openalex%3AW123/surface"],
    ["a query", "/papers/a?x=1"],
    ["a bare query mark", "/papers/a?"],
    ["a fragment", "/papers/a#x"],
    ["a dot segment", "/papers/."],
    ["a dot-dot segment", "/papers/.."],
    ["an encoded dot-dot", "/papers/%2e%2e"],
    ["an upper-case encoded dot-dot", "/papers/%2E%2E"],
    ["a half-encoded dot-dot", "/papers/.%2e"],
    // R15: an encoded "/" inside the id is allowed now (see the dblp and
    // arXiv tests below); one that STARTS the decoded id is still refused.
    ["an encoded slash pair at the start", "/papers/%2F%2Fevil.com"],
    ["a lower-case encoded slash pair at the start", "/papers/%2f%2fevil.com"],
    ["one encoded slash at the start", "/papers/%2Fx"],
    ["an encoded backslash", "/papers/%5Cevil.com"],
    ["an encoded backslash mid-way", "/papers/a%5cb"],
    ["an encoded control character", "/papers/a%0d%0aX"],
    ["an encoded NUL", "/papers/a%00"],
    ["a broken escape", "/papers/a%2"],
    ["a broken escape mid-way", "/papers/a%zzb"],
    ["an invalid UTF-8 escape", "/papers/%E0%A4%A"],
    ["a space", "/papers/a b"],
    ["an at sign", "/papers/@evil.com"],
    ["a protocol-relative host after the prefix", "/papers//evil.com"],
    ["a backslash", "/papers/a\b"],
    ["a plus sign", "/papers/a+b"],
    ["a non-ASCII character", "/papers/中文"],
    ["a capitalised prefix", "/Papers/a"],
    ["a longer prefix", "/papersX/a"],
    ["a full URL", "https://peer.homes/papers/a"],
  ])("refuses %s", (_label, value) => {
    expect(safeReturnPath(value)).toBeNull();
  });

  it("allows a paper path of exactly the maximum length and refuses one character more", () => {
    const atMax = "/papers/" + "a".repeat(RETURN_PATH_MAX_LENGTH - "/papers/".length);
    expect(atMax).toHaveLength(200);
    expect(safeReturnPath(atMax)).toBe(atMax);
    expect(safeReturnPath(atMax + "a")).toBeNull();
  });

  it("keeps every earlier answer: /welcome and /profile with a query, and the earlier refusals", () => {
    expect(safeReturnPath("/welcome?step=ai")).toBe("/welcome?step=ai");
    expect(safeReturnPath("/profile?return=%2Fpapers%2Fa")).toBe("/profile?return=%2Fpapers%2Fa");
    for (const value of ["//evil.com", "/\evil.com", "@evil.com", "/papers", "/welcomeX", "/%2F%2Fevil.com"]) {
      expect(safeReturnPath(value)).toBeNull();
    }
  });
});
