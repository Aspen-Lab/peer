import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_TOKEN_TTL_MS,
  isValidEmailFormat,
  normalizeEmailAddress,
  signConfirmToken,
  verifyConfirmToken,
} from "./confirm-token";

// EMAIL-SETTINGS — ABC-JEV-INTEGRATION.md §1y point 2.iii / §1z P4/P6/P9.
// Stateless HMAC confirmation token: no schema change, no DB row to check
// re-use against. See guide docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md
// §2.2 for the exact format and verification order (sign check BEFORE
// trusting anything in the payload).

const SECRET = "TEST-NOT-A-REAL-SECRET";
const NOW = new Date("2026-09-26T12:00:00.000Z");

describe("normalizeEmailAddress", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmailAddress("  Person@Example.COM  ")).toBe(
      "person@example.com",
    );
  });
});

describe("isValidEmailFormat — P9: one address only, trimmed, <=254 chars, pragmatic pattern", () => {
  it("accepts an ordinary well-formed address", () => {
    expect(isValidEmailFormat("person@example.com")).toBe(true);
  });

  it("rejects a missing @ or domain dot", () => {
    expect(isValidEmailFormat("not-an-email")).toBe(false);
    expect(isValidEmailFormat("person@example")).toBe(false);
  });

  it("rejects whitespace anywhere in the address", () => {
    expect(isValidEmailFormat("person @example.com")).toBe(false);
    expect(isValidEmailFormat("person@ example.com")).toBe(false);
  });

  it("rejects a comma-separated list (no lists — one address only)", () => {
    expect(isValidEmailFormat("a@example.com,b@example.com")).toBe(false);
  });

  it("rejects an address over 254 characters", () => {
    const longLocal = "a".repeat(250);
    expect(isValidEmailFormat(`${longLocal}@example.com`)).toBe(false);
  });

  it("accepts exactly 254 characters", () => {
    // "p@example.com" is 13 chars; pad the local part to land exactly on 254.
    const local = "a".repeat(254 - "@example.com".length);
    const email = `${local}@example.com`;
    expect(email).toHaveLength(254);
    expect(isValidEmailFormat(email)).toBe(true);
  });
});

describe("signConfirmToken / verifyConfirmToken — round trip", () => {
  it("verifies a freshly signed token and returns the normalized uid/email", () => {
    const token = signConfirmToken(SECRET, "user-1", "Person@Example.com", NOW);
    const result = verifyConfirmToken(SECRET, token, NOW);
    expect(result).toEqual({
      ok: true,
      uid: "user-1",
      email: "person@example.com",
    });
  });

  it("re-use is allowed: verifying the same still-valid token twice both succeed identically (no single-use state)", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const first = verifyConfirmToken(SECRET, token, NOW);
    const second = verifyConfirmToken(SECRET, token, NOW);
    expect(first).toEqual({ ok: true, uid: "user-1", email: "person@example.com" });
    expect(second).toEqual(first);
  });

  it("rejects a tampered signature without parsing the payload as meaningful", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const [payload, sig] = token.split(".");
    // Flip the signature's first character to something else entirely.
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    const tampered = `${payload}.${flipped}`;
    expect(verifyConfirmToken(SECRET, tampered, NOW)).toEqual({
      ok: false,
      reason: "tampered",
    });
  });

  it("rejects a token whose signature was made with a different secret", () => {
    const token = signConfirmToken("OTHER-SECRET", "user-1", "person@example.com", NOW);
    expect(verifyConfirmToken(SECRET, token, NOW)).toEqual({
      ok: false,
      reason: "tampered",
    });
  });

  it("rejects an expired token (pinned clock, not real sleep)", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW, CONFIRM_TOKEN_TTL_MS);
    const justAfterExpiry = new Date(NOW.getTime() + CONFIRM_TOKEN_TTL_MS + 1000);
    expect(verifyConfirmToken(SECRET, token, justAfterExpiry)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("accepts a token right at the TTL boundary (not yet expired)", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW, CONFIRM_TOKEN_TTL_MS);
    const justBeforeExpiry = new Date(NOW.getTime() + CONFIRM_TOKEN_TTL_MS - 1000);
    expect(verifyConfirmToken(SECRET, token, justBeforeExpiry).ok).toBe(true);
  });

  it("rejects malformed input: no dot separator", () => {
    expect(verifyConfirmToken(SECRET, "not-a-real-token", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects malformed input: empty payload or signature half", () => {
    expect(verifyConfirmToken(SECRET, ".sig", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmToken(SECRET, "payload.", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a payload that base64url-decodes but isn't the expected JSON shape", () => {
    // Build a token whose signature is valid for a payload missing required
    // fields, proving the malformed check runs on genuinely-signed content too.
    const badPayload = Buffer.from(JSON.stringify({ uid: "user-1" }), "utf8").toString(
      "base64url",
    );
    const sig = createHmac("sha256", SECRET)
      .update(badPayload)
      .digest()
      .toString("base64url");
    expect(verifyConfirmToken(SECRET, `${badPayload}.${sig}`, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("defaults to a 24h TTL when none is passed", () => {
    expect(CONFIRM_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});
