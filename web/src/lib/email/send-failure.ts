// Shared between the two EMAIL-SETTINGS send routes — POST
// /api/profile/confirm-email and POST /api/profile/send-test-email.
// ABC-JEV-INTEGRATION.md §1al POLISH-1-EMAIL (f)/(g).
//
// `sendDigestEmail` (send-digest.ts, not edited by this item) already
// returns a structured result: `errorCode` is Resend's own `error.name`
// (present only for a structured `{data:null,error}` response — never for a
// thrown/network error, which has no such code), `error` is the free-text
// message. Neither route may show that free-text message to the reader (it
// can name the Resend account's own address in the sandbox-sender case) or
// write a raw address to the server log — this module is the one place
// both rules are decided, so the two routes cannot drift apart.

/** The shape both routes' `sendDigestEmail(...)` result satisfies — only the
 * two fields this module reads. */
export interface SendFailureResult {
  errorCode?: string;
  error?: string;
}

// "Sender not allowed" = a Resend `validation_error` whose message says the
// sender/domain is not verified, or that a sandbox key may only send
// testing emails to the account owner. This samples an open class —
// Resend's own wording can change — so anything that does not match falls
// back to the generic "send_failed" below, never a further guess.
const SENDER_NOT_VERIFIED_PATTERNS: RegExp[] = [
  /verify a domain/i,
  /domain is not verified/i,
  /testing emails?/i,
];

/**
 * Classifies a failed `sendDigestEmail` result into one of the two reasons
 * both routes may show a reader: `"sender_not_verified"` (Peer's own sender
 * setup is the problem — a plain, safe thing to say) or the generic
 * `"send_failed"` (never guess beyond the known patterns; the generic
 * message is the defensible fallback whenever the pattern misses).
 */
export function classifySendFailure(
  result: SendFailureResult,
): "sender_not_verified" | "send_failed" {
  if (result.errorCode !== "validation_error") return "send_failed";
  const message = result.error ?? "";
  return SENDER_NOT_VERIFIED_PATTERNS.some((pattern) => pattern.test(message))
    ? "sender_not_verified"
    : "send_failed";
}

// Pragmatic — same spirit as confirm-token.ts's own format check, not full
// RFC 5322: this only needs to catch what a provider error message would
// plausibly contain, not validate anything. Deliberately narrower than "any
// non-space run either side of @" so it does not also swallow the
// surrounding prose punctuation a provider message wraps an address in,
// e.g. "(owner@example.test)." must redact to "([email])." — the parens
// and trailing period stay put; only the address itself is replaced.
const EMAIL_LIKE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Every email-like substring in `text` becomes "[email]". Never log a raw
 * address (constraint vii, restated for this item in §1al (g)). */
export function redactEmailAddresses(text: string): string {
  return text.replace(EMAIL_LIKE, "[email]");
}

/** One log line's worth: the provider's error name + message, redacted.
 * Both routes use this exact shape so a grep for a route's log prefix finds
 * a consistent tail. */
export function describeSendFailureForLog(result: SendFailureResult): string {
  const name = result.errorCode ?? "error";
  const message = redactEmailAddresses(result.error ?? "unknown error");
  return `${name}: ${message}`;
}
