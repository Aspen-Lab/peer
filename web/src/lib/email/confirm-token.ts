// EMAIL-SETTINGS — confirming a NEW (non-account) digest_email address.
//
// ABC-JEV-INTEGRATION.md §1y point 2.iii: "a custom address (!= account
// email) must be confirmed by a signed link sent to that address before
// anything else is sent there". §1z P4/P6/P9 binds the specifics: 24h TTL,
// re-use allowed (a confirmation link is conventionally multi-use within its
// expiry — unlike a password reset, there is nothing to "spend", and
// blocking re-use would break a mail gateway that prefetches the link to
// scan it), and a pragmatic (not full RFC 5322) email format check shared by
// both the request and verify sides and by the profile page's own
// client-side check before submitting.
//
// EMAIL-TOKEN-PRIVACY (ABC-JEV-INTEGRATION.md §1as, guide
// docs/jev-abc/EMAIL-TOKEN-PRIVACY-B-20260928T220245Z.md): the original
// token shape here was base64url(JSON{uid,email,exp}) + "." + HMAC-SHA256 —
// an ENCODING, not encryption. Base64 has no secret; anyone holding the
// token (i.e. anyone who has the URL — including request logs, mail
// gateways that prefetch links, and Vercel/Next's own access logs) could
// decode the address in plain text with zero effort. The HMAC only proved
// the token wasn't tampered with; it did nothing to keep the payload
// confidential. Replaced with AES-256-GCM authenticated encryption: the
// payload is genuinely unreadable without DIGEST_EMAIL_CONFIRM_SECRET, and
// GCM's own authentication tag is the integrity/tamper check — no separate
// HMAC layered on top (ruling §1as point 1/2, POLICY 2: one audited AEAD
// primitive, not two hand-composed crypto steps). A pre-fix (legacy-format)
// token is deliberately NOT accepted by `verifyConfirmToken` below — no
// dual-format fallback is kept (ruling §1as point 2): it lands on the same
// honest "expired or invalid — request a new one" state as any other bad
// token, exactly like a token that failed for any other reason.
//
// Server-only. Never logs an email address (P7/constraint vii).

import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

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
  // EMAIL-TOKEN-REPLAY (ABC-JEV-INTEGRATION.md §1bn): the digest address the
  // profile held at the moment THIS token was minted — "" when none was set
  // yet. Compared against the live digest_email at verify time (the GET
  // handler in confirm-email/route.ts) so an old, superseded token can no
  // longer silently re-apply once something else has changed the address.
  // A pre-fix token that decrypts without this field fails the shape check
  // below and is rejected as malformed — no dual-format fallback, same
  // discipline as §1as point 2.
  priorEmail: string;
  exp: number; // unix seconds
}

// EMAIL-TOKEN-PRIVACY — token shape: TOKEN_VERSION_PREFIX + base64url(iv |
// ciphertext | tag), one opaque blob (never two dot-separated segments —
// base64url's own alphabet never produces a ".", so a genuine token always
// has exactly one dot, right after the prefix).
const TOKEN_VERSION_PREFIX = "v2.";
// Fixed HKDF context label — deliberately distinct from any other string
// this codebase derives a key from, so a future second use of
// DIGEST_EMAIL_CONFIRM_SECRET (if one is ever added) cannot accidentally
// reuse this exact key.
const HKDF_CONTEXT_LABEL = "peer:digest-email-confirm:v2";
const IV_LENGTH = 12; // 96 bits — AES-GCM's standard/recommended IV size
const AUTH_TAG_LENGTH = 16; // 128-bit GCM tag
// Structurally the smallest a well-formed blob could ever be (IV + tag, zero
// -byte ciphertext). Real tokens are always longer (the JSON payload is
// never empty), but this is the cheap, pre-crypto shape check: anything
// shorter cannot even be split into iv/tag and is rejected as malformed
// before any decrypt is attempted.
const MIN_BLOB_LENGTH = IV_LENGTH + AUTH_TAG_LENGTH;

/** HKDF-SHA256 from the raw secret, fixed context label, 32 bytes (AES-256's
 * key size). `hkdfSync` returns an ArrayBuffer, not a Buffer — wrapped here
 * so every caller gets a Buffer directly. */
function deriveKey(secret: string): Buffer {
  const key = hkdfSync(
    "sha256",
    Buffer.from(secret, "utf8"),
    Buffer.alloc(0), // no salt — the secret itself is the sole entropy source
    HKDF_CONTEXT_LABEL,
    32,
  );
  return Buffer.from(key);
}

/**
 * Mint a confirmation token for `uid` + `email` (normalized before signing —
 * the verified email a caller gets back is always the normalized form).
 * `priorEmail` is the digest address the profile held right now, at mint
 * time (EMAIL-TOKEN-REPLAY, §1bn) — pass "" when none is set yet; callers
 * normalize it the same way `email` is normalized here. `now` is the
 * caller's clock (2-01 convention); `ttlMs` defaults to the standard 24h.
 *
 * AES-256-GCM authenticated encryption, keyed from DIGEST_EMAIL_CONFIRM_SECRET
 * via HKDF-SHA256 (fixed context label above). A fresh random 96-bit IV is
 * drawn per call — never reused with the same key — so two tokens minted for
 * the identical (uid, email, priorEmail, exp) still differ byte-for-byte.
 * GCM's own 128-bit authentication tag is the sole integrity/tamper check
 * (see `verifyConfirmToken` below) — no second HMAC composed on top.
 */
export function signConfirmToken(
  secret: string,
  uid: string,
  email: string,
  priorEmail: string,
  now: Date,
  ttlMs: number = CONFIRM_TOKEN_TTL_MS,
): string {
  const payload: ConfirmTokenPayload = {
    uid,
    email: normalizeEmailAddress(email),
    priorEmail: normalizeEmailAddress(priorEmail),
    exp: Math.floor((now.getTime() + ttlMs) / 1000),
  };
  const key = deriveKey(secret);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  const blob = Buffer.concat([iv, ciphertext, tag]);
  return `${TOKEN_VERSION_PREFIX}${blob.toString("base64url")}`;
}

export type VerifyConfirmTokenResult =
  | { ok: true; uid: string; email: string; priorEmail: string }
  | { ok: false; reason: "malformed" | "tampered" | "expired" };

/**
 * Verification order matters — a structural shape check first (cheap, never
 * throws), THEN decrypt-with-auth-tag-check (any failure — tampered
 * ciphertext, a swapped IV, a swapped tag, or the wrong secret — is caught
 * as "tampered" BEFORE anything is trusted or parsed), THEN a shape check on
 * the decrypted claims, THEN expiry. A forged `exp` or `uid` can never be
 * read: without the secret, an attacker cannot produce a ciphertext whose
 * tag verifies at all, so there is no way to reach the parsing step with
 * attacker-controlled content.
 *
 * A token that does not start with the current version prefix — including
 * every token minted by the pre-EMAIL-TOKEN-PRIVACY HMAC scheme — is
 * rejected here as "malformed". This is deliberate (ABC-JEV-INTEGRATION.md
 * §1as ruling point 2): there is no fallback parser for the old format: a
 * legacy link lands on the same honest "expired or invalid" outcome as any
 * other bad token, never a crash and never a readable address.
 *
 * Re-use is deliberately allowed: this function has no side effects and no
 * single-use state, so calling it twice with the same still-valid token
 * returns the same `{ ok: true, ... }` both times.
 */
export function verifyConfirmToken(
  secret: string,
  token: string,
  now: Date,
): VerifyConfirmTokenResult {
  if (!token.startsWith(TOKEN_VERSION_PREFIX)) {
    return { ok: false, reason: "malformed" };
  }
  // Node's base64url decoder silently drops any character outside its
  // alphabet rather than throwing (verified before writing this check), so
  // "invalid base64url" and "wrong number of parts" both collapse to "too
  // short to be real" here — handled uniformly by the length check below,
  // never by a try/catch around decoding itself.
  const blob = Buffer.from(token.slice(TOKEN_VERSION_PREFIX.length), "base64url");
  if (blob.length < MIN_BLOB_LENGTH) {
    return { ok: false, reason: "malformed" };
  }
  const iv = blob.subarray(0, IV_LENGTH);
  const tag = blob.subarray(blob.length - AUTH_TAG_LENGTH);
  const ciphertext = blob.subarray(IV_LENGTH, blob.length - AUTH_TAG_LENGTH);

  const key = deriveKey(secret);
  let plaintext: string;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    // GCM's auth-tag check failed: tampered ciphertext, a swapped IV, a
    // swapped tag, or a different secret. Caught before any claim is ever
    // trusted — mirrors the old "sign check before parsing" discipline.
    return { ok: false, reason: "tampered" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    !parsed ||
    typeof parsed !== "object" ||
    typeof (parsed as Record<string, unknown>).uid !== "string" ||
    typeof (parsed as Record<string, unknown>).email !== "string" ||
    // EMAIL-TOKEN-REPLAY (§1bn): same strict-shape discipline as uid/email/
    // exp above. A token minted before this field existed decrypts fine
    // (same AES-256-GCM/HKDF, same "v2." prefix — this is not a version
    // bump) but its plaintext has no priorEmail, so it fails here and lands
    // on the ordinary "malformed" outcome — never a crash, never silently
    // treated as "nothing has changed". No dual-format fallback, same as
    // §1as point 2.
    typeof (parsed as Record<string, unknown>).priorEmail !== "string" ||
    typeof (parsed as Record<string, unknown>).exp !== "number"
  ) {
    return { ok: false, reason: "malformed" };
  }

  const { uid, email, priorEmail, exp } = parsed as ConfirmTokenPayload;
  if (exp < Math.floor(now.getTime() / 1000)) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, uid, email, priorEmail };
}
