// EMAIL-SETTINGS — confirming a NEW (non-account) digest_email address.
//
// ABC-JEV-INTEGRATION.md §1y point 2.iii: "a custom address (!= account
// email) must be confirmed by a signed link sent to that address before
// anything else is sent there — stateless signed token (HMAC of user id +
// address + expiry) preferred so no schema change is needed". §1z P4/P6/P9
// binds the specifics: 24h TTL, re-use allowed (a confirmation link is
// conventionally multi-use within its expiry — unlike a password reset,
// there is nothing to "spend", and blocking re-use would break a mail
// gateway that prefetches the link to scan it), and a pragmatic (not full
// RFC 5322) email format check shared by both the request and verify sides
// and by the profile page's own client-side check before submitting.
//
// Server-only. Never logs an email address (P7/constraint vii).

import { createHmac, timingSafeEqual } from "node:crypto";

/** DIGEST_EMAIL_CONFIRM_SECRET — server-only, independent of CRON_SECRET
 * (different trust boundary: rotating one must not affect the other, and
 * whoever holds CRON_SECRET should not thereby be able to mint address
 * confirmations for arbitrary users). Unset ⇒ callers must show an honest
 * "unavailable" message rather than sign with an empty/guessable secret —
 * see the two route handlers, which check this before ever calling
 * `signConfirmToken`. */
export function getConfirmSecret(): string | null {
  const secret = process.env.DIGEST_EMAIL_CONFIRM_SECRET;
  return secret && secret.length > 0 ? secret : null;
}

/** §1z P4 — 24 hours. Independent of the unrelated 23h Resend idempotency-
 * replay window in digest-retry.ts (that window governs retrying a SCHEDULED
 * digest send; this governs how long a clicked confirmation link stays
 * good). */
export const CONFIRM_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

/** Trim + lowercase — the one normalization applied everywhere an address is
 * compared or stored (PUT /api/profile's guard, both confirm-email handlers,
 * and the profile page's own pre-submit check). */
export function normalizeEmailAddress(input: string): string {
  return input.trim().toLowerCase();
}

const MAX_EMAIL_LENGTH = 254;
// Pragmatic, not full RFC 5322 (§1z P9/P10 — B's proposal, accepted): one
// local part, one "@", one domain with at least one dot, no whitespace or
// comma anywhere (so "a@b.com,c@d.com" and "a@b.com c@d.com" both fail
// rather than silently taking the first address of a list).
const EMAIL_PATTERN = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;

/** P9 — one address only: trimmed, <=254 chars, pragmatic pattern, no
 * commas/whitespace/lists. Callers normalize (trim/lowercase) separately;
 * this only judges shape. */
export function isValidEmailFormat(email: string): boolean {
  if (!email || email.length > MAX_EMAIL_LENGTH) return false;
  if (/[\s,]/.test(email)) return false;
  return EMAIL_PATTERN.test(email);
}

interface ConfirmTokenPayload {
  uid: string;
  email: string;
  exp: number; // unix seconds
}

function base64urlEncode(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input, "utf8") : input;
  return buf.toString("base64url");
}

function base64urlDecodeToString(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

/** Constant-time string compare. A length mismatch is simply "not equal" —
 * `timingSafeEqual` throws on differing lengths, so that case is guarded
 * BEFORE calling it rather than left to throw (matches the existing
 * bearer-token comparisons in api/jobs/purge-uploads and
 * api/admin/uploads/block). */
function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function signPayload(secret: string, payloadB64: string): string {
  return base64urlEncode(createHmac("sha256", secret).update(payloadB64).digest());
}

/**
 * Mint a confirmation token for `uid` + `email` (normalized before signing —
 * the verified email a caller gets back is always the normalized form).
 * `now` is the caller's clock (2-01 convention); `ttlMs` defaults to the
 * standard 24h.
 */
export function signConfirmToken(
  secret: string,
  uid: string,
  email: string,
  now: Date,
  ttlMs: number = CONFIRM_TOKEN_TTL_MS,
): string {
  const payload: ConfirmTokenPayload = {
    uid,
    email: normalizeEmailAddress(email),
    exp: Math.floor((now.getTime() + ttlMs) / 1000),
  };
  const payloadB64 = base64urlEncode(JSON.stringify(payload));
  const sig = signPayload(secret, payloadB64);
  return `${payloadB64}.${sig}`;
}

export type VerifyConfirmTokenResult =
  | { ok: true; uid: string; email: string }
  | { ok: false; reason: "malformed" | "tampered" | "expired" };

/**
 * Verification order matters — **sign check BEFORE trusting anything in the
 * payload** (guide §2.2): a tampered token is rejected before its claims are
 * ever parsed as meaningful, so a forged `exp` or `uid` can never be read.
 * Re-use is deliberately allowed: this function has no side effects and no
 * single-use state, so calling it twice with the same still-valid token
 * returns the same `{ ok: true, ... }` both times.
 */
export function verifyConfirmToken(
  secret: string,
  token: string,
  now: Date,
): VerifyConfirmTokenResult {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return { ok: false, reason: "malformed" };
  }
  const [payloadB64, sig] = parts;

  const expectedSig = signPayload(secret, payloadB64);
  if (!timingSafeEqualStrings(sig, expectedSig)) {
    return { ok: false, reason: "tampered" };
  }

  // Only once signature-valid: decode + parse the payload's claims.
  let parsed: unknown;
  try {
    parsed = JSON.parse(base64urlDecodeToString(payloadB64));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).uid !== "string" ||
    typeof (parsed as Record<string, unknown>).email !== "string" ||
    typeof (parsed as Record<string, unknown>).exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const { uid, email, exp } = parsed as ConfirmTokenPayload;
  if (exp < Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, uid, email };
}
