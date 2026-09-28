import { createCipheriv, createHmac, hkdfSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  CONFIRM_TOKEN_TTL_MS,
  isValidEmailFormat,
  normalizeEmailAddress,
  signConfirmToken,
  verifyConfirmToken,
} from "./confirm-token";

// EMAIL-SETTINGS — ABC-JEV-INTEGRATION.md §1y point 2.iii / §1z P4/P6/P9.
// EMAIL-TOKEN-PRIVACY (§1as) replaced the original base64url(JSON)+HMAC
// scheme — an ENCODING, not encryption; anyone holding the token could
// decode the address with zero secret — with AES-256-GCM authenticated
// encryption. Token shape: "v2." + base64url(iv | ciphertext | tag), one
// opaque blob. GCM's own auth tag is the sole integrity check (no second
// HMAC). See confirm-token.ts's own header for the full design note and
// guide docs/jev-abc/EMAIL-TOKEN-PRIVACY-B-20260928T220245Z.md §3/§4.

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

// ── Helpers that reimplement the module's own primitives (never imported —
// mirrors the old test file's precedent of hand-rolling the HMAC step
// locally) so a test can construct a token that is validly authenticated
// but has content the module itself would never produce, or a token from
// the OLD (pre-EMAIL-TOKEN-PRIVACY) scheme. ─────────────────────────────────

const HKDF_CONTEXT_LABEL = "peer:digest-email-confirm:v2"; // must match confirm-token.ts's own constant
const TOKEN_VERSION_PREFIX = "v2.";

function deriveKeyForTest(secret: string): Buffer {
  return Buffer.from(
    hkdfSync("sha256", Buffer.from(secret, "utf8"), Buffer.alloc(0), HKDF_CONTEXT_LABEL, 32),
  );
}

/** Encrypts arbitrary plaintext with the SAME algorithm/key-derivation the
 * module uses, so the result is a validly-authenticated "v2." token whose
 * decrypted content the module itself never would have produced (e.g. bad
 * JSON shape). Proves the post-decrypt shape check is real and reachable —
 * something an attacker without the secret could never construct. */
function encryptRawForTest(secret: string, plaintext: string, iv = Buffer.alloc(12, 7)): string {
  const key = deriveKeyForTest(secret);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${TOKEN_VERSION_PREFIX}${Buffer.concat([iv, ciphertext, tag]).toString("base64url")}`;
}

/** The OLD (pre-EMAIL-TOKEN-PRIVACY) token scheme: base64url(JSON) + "." +
 * base64url(HMAC-SHA256(payload)). Reimplemented here only to prove the new
 * verifier rejects it outright — see the "legacy token" tests below. */
function legacyTokenForTest(secret: string, uid: string, email: string, exp: number): string {
  const payloadB64 = Buffer.from(JSON.stringify({ uid, email, exp }), "utf8").toString("base64url");
  const sig = createHmac("sha256", secret).update(payloadB64).digest().toString("base64url");
  return `${payloadB64}.${sig}`;
}

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

  it("round-trips a realistic long address and a UUID-shaped uid", () => {
    const uid = "11111111-2222-3333-4444-555555555555";
    const longAddress = "a.very.long.local.part.for.testing+tag@sub.department.example-university.edu";
    const token = signConfirmToken(SECRET, uid, longAddress, NOW);
    expect(verifyConfirmToken(SECRET, token, NOW)).toEqual({
      ok: true,
      uid,
      email: longAddress,
    });
  });

  it("re-use is allowed: verifying the same still-valid token twice both succeed identically (no single-use state)", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const first = verifyConfirmToken(SECRET, token, NOW);
    const second = verifyConfirmToken(SECRET, token, NOW);
    expect(first).toEqual({ ok: true, uid: "user-1", email: "person@example.com" });
    expect(second).toEqual(first);
  });

  it("token format: version prefix + exactly one further dot-free base64url blob", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    expect(token.startsWith("v2.")).toBe(true);
    expect(token.split(".")).toHaveLength(2);
    expect(token.slice(3)).toMatch(/^[A-Za-z0-9_-]+$/); // pure base64url, no "."
  });

  it("mints a different token every time, even for the identical (uid, email, exp) — a fresh random IV per call (nonce/IV uniqueness)", () => {
    const first = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const second = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    expect(first).not.toBe(second);
    // Both remain independently valid — uniqueness isn't achieved by
    // breaking verification.
    expect(verifyConfirmToken(SECRET, first, NOW)).toEqual({ ok: true, uid: "user-1", email: "person@example.com" });
    expect(verifyConfirmToken(SECRET, second, NOW)).toEqual({ ok: true, uid: "user-1", email: "person@example.com" });
  });

  it("never contains the address in the clear, base64, or base64url — plain or URL-encoded — anywhere in the token", () => {
    const email = "reader@example.test";
    const token = signConfirmToken(SECRET, "user-1", email, NOW);
    const encodedToken = encodeURIComponent(token);
    const [localPart, domain] = email.split("@");
    const variants = [
      email,
      encodeURIComponent(email),
      localPart,
      domain,
      Buffer.from(email, "utf8").toString("base64"),
      Buffer.from(email, "utf8").toString("base64url"),
    ];
    for (const variant of variants) {
      expect(token).not.toContain(variant);
      expect(encodedToken).not.toContain(variant);
    }
  });

  it("rejects a token tampered inside the ciphertext/tag region without parsing the payload as meaningful", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const lastChar = token[token.length - 1];
    const flipped = lastChar === "a" ? "b" : "a"; // last base64url char falls inside the GCM tag
    const tampered = token.slice(0, -1) + flipped;
    expect(verifyConfirmToken(SECRET, tampered, NOW)).toEqual({
      ok: false,
      reason: "tampered",
    });
  });

  it("rejects a token tampered right after the version prefix, inside the IV region", () => {
    const token = signConfirmToken(SECRET, "user-1", "person@example.com", NOW);
    const ivChar = token[3]; // first char after "v2." falls inside the IV
    const flipped = ivChar === "a" ? "b" : "a";
    const tampered = token.slice(0, 3) + flipped + token.slice(4);
    expect(verifyConfirmToken(SECRET, tampered, NOW)).toEqual({
      ok: false,
      reason: "tampered",
    });
  });

  it("rejects a token whose IV was swapped for a different valid-length IV, ciphertext/tag unchanged (GCM's own tag check fails)", () => {
    const token = encryptRawForTest(SECRET, JSON.stringify({ uid: "user-1", email: "person@example.com", exp: 9999999999 }), Buffer.alloc(12, 1));
    const blob = Buffer.from(token.slice(3), "base64url");
    const swappedIv = Buffer.alloc(12, 2); // different valid-length IV
    const rebuilt = `v2.${Buffer.concat([swappedIv, blob.subarray(12)]).toString("base64url")}`;
    expect(verifyConfirmToken(SECRET, rebuilt, NOW)).toEqual({
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

  it("rejects malformed input: no version prefix at all", () => {
    expect(verifyConfirmToken(SECRET, "not-a-real-token", NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects malformed input: empty string", () => {
    expect(verifyConfirmToken(SECRET, "", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects malformed input: the version prefix with nothing after it, or a truncated/too-short blob", () => {
    expect(verifyConfirmToken(SECRET, "v2.", NOW)).toEqual({ ok: false, reason: "malformed" });
    expect(verifyConfirmToken(SECRET, "v2.AAAA", NOW)).toEqual({ ok: false, reason: "malformed" }); // decodes to 3 bytes, far under iv+tag
  });

  it("rejects malformed input: garbage/invalid base64url characters after the prefix, never throws", () => {
    expect(() => verifyConfirmToken(SECRET, "v2.####$$$$@@@@", NOW)).not.toThrow();
    expect(verifyConfirmToken(SECRET, "v2.####$$$$@@@@", NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("rejects a payload that decrypts successfully but isn't the expected JSON shape — proves the post-decrypt shape check runs, not just the auth-tag check", () => {
    // Built with the SAME secret/algorithm as a real token, so the auth tag
    // verifies — the ONLY way to reach this branch — but the plaintext is
    // missing required fields. An attacker without the secret could never
    // construct this.
    const token = encryptRawForTest(SECRET, JSON.stringify({ uid: "user-1" }));
    expect(verifyConfirmToken(SECRET, token, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("rejects a validly-decrypted payload that isn't JSON at all", () => {
    const token = encryptRawForTest(SECRET, "not json");
    expect(verifyConfirmToken(SECRET, token, NOW)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("defaults to a 24h TTL when none is passed", () => {
    expect(CONFIRM_TOKEN_TTL_MS).toBe(24 * 60 * 60 * 1000);
  });
});

// EMAIL-TOKEN-PRIVACY ruling §1as point 2: no dual-format fallback. A token
// from the OLD (pre-fix) HMAC scheme must land on the same honest
// "malformed" outcome as any other bad input — never parsed, never a
// readable address, never a crash — whether or not it was itself tampered
// with (there is no separate legacy code path left to protect against
// weakened tamper-detection: both collapse to the same prefix check).
describe("legacy (pre-EMAIL-TOKEN-PRIVACY) tokens are never accepted", () => {
  it("a well-formed legacy token (valid HMAC under the old scheme) is rejected as malformed, not parsed", () => {
    const legacy = legacyTokenForTest(SECRET, "user-1", "person@example.com", 9999999999);
    expect(legacy.startsWith("v2.")).toBe(false); // sanity: doesn't accidentally collide with the new prefix
    expect(verifyConfirmToken(SECRET, legacy, NOW)).toEqual({ ok: false, reason: "malformed" });
  });

  it("a tampered legacy token is likewise rejected as malformed, never throws", () => {
    const legacy = legacyTokenForTest(SECRET, "user-1", "person@example.com", 9999999999);
    const [payload, sig] = legacy.split(".");
    const flipped = (sig[0] === "a" ? "b" : "a") + sig.slice(1);
    const tampered = `${payload}.${flipped}`;
    expect(() => verifyConfirmToken(SECRET, tampered, NOW)).not.toThrow();
    expect(verifyConfirmToken(SECRET, tampered, NOW)).toEqual({ ok: false, reason: "malformed" });
  });
});
