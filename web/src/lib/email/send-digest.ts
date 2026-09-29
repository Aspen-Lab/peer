// Sends a digest email via Resend. Server-only.
//
// Uses lazy init — Resend client is created per-call so missing env vars
// surface as a clear error rather than a module-load crash in dev.

import { Resend } from "resend";
import type { ScoredItem } from "@/lib/scoring/types";
import type { FeedEmptyReasonCode } from "@/lib/feed/types";
import {
  renderDigestHtml,
  renderDigestPlaintext,
  renderDigestSubject,
} from "@/lib/email/digest-template";

export interface SendDigestInput {
  to: string;
  firstName?: string;
  items: ScoredItem[];
  originUrl: string;
  /**
   * EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj) — forwarded straight
   * into `renderDigestHtml`/`renderDigestPlaintext` below (both read the
   * whole `input` object already, so this field reaches them with no other
   * change here). Every real sender fills this from
   * `feed.meta.emptyReasonCode`; unused when `render` (below) is supplied,
   * since a replayed attempt never re-renders.
   */
  emptyReasonCode?: FeedEmptyReasonCode;
  /**
   * P4-S7-IDEM (Round 3) -- ABC-JEV-INTEGRATION.md §4 "P4-S7-IDEM B
   * complete" ruling. Forwarded verbatim as the Resend SDK's second
   * `emails.send()` argument (`{ idempotencyKey }`), which the SDK sends as
   * the `Idempotency-Key` HTTP header (VERIFIED in
   * docs/jev-abc/P4-S7-IDEM-B-20260924T113658Z.md B2/B9 against both the
   * official docs and the installed SDK's own shipped source). Omitted
   * (undefined) ⇒ `client.emails.send()` is called with exactly ONE
   * argument, byte-identical to this function's shape before this item.
   */
  idempotencyKey?: string;
  /**
   * P4-S7-IDEM: when provided, sent VERBATIM instead of re-rendering from
   * `items`/`firstName`/`originUrl`. Required for a safe retry: each of
   * `renderDigestSubject`/`renderDigestHtml`/`renderDigestPlaintext` calls
   * `new Date()` internally (digest-template.ts, read-only, never edited by
   * this item), so re-rendering on a retry made even moments later can
   * silently change the payload bytes and trip Resend's own idempotency
   * payload-match check (409 `invalid_idempotent_request` -- B5).
   */
  render?: { subject: string; html: string; text: string };
}

export interface SendDigestResult {
  sent: boolean;
  messageId?: string;
  error?: string;
  /**
   * P4-S7-IDEM: Resend's own structured error code (`error.name`), e.g.
   * `"concurrent_idempotent_requests"` or `"invalid_idempotent_request"` --
   * present only when the SDK returned a structured `{data:null,error}`
   * response (never for a thrown/network error, which has no such code).
   * Lets a caller distinguish "another attempt is genuinely in flight,
   * safe to retry later" from an ordinary failure without parsing
   * `error`'s free-text message.
   */
  errorCode?: string;
}

function getClient(): Resend | null {
  const key = process.env.RESEND_API_KEY;
  if (!key) return null;
  return new Resend(key);
}

function fromAddress(): string {
  // Resend allows this sender with zero domain setup — great for demo/
  // pre-launch. Swap to your verified domain once DNS is ready.
  return process.env.DIGEST_FROM_EMAIL || "Peer <onboarding@resend.dev>";
}

export async function sendDigestEmail(
  input: SendDigestInput,
): Promise<SendDigestResult> {
  const client = getClient();
  if (!client) {
    return { sent: false, error: "RESEND_API_KEY not set" };
  }
  try {
    // P4-S7-IDEM: `render` replaces a fresh call to the (non-deterministic
    // -- each calls `new Date()`) template functions when the caller is
    // replaying a previously-rendered, previously-persisted attempt.
    const subject = input.render?.subject ?? renderDigestSubject(input.items);
    const html = input.render?.html ?? renderDigestHtml(input);
    const text = input.render?.text ?? renderDigestPlaintext(input);
    const payload = { from: fromAddress(), to: [input.to], subject, html, text };

    // Deliberately two DIFFERENT call shapes (one argument vs. two), not
    // one call with a possibly-undefined second argument: this is what
    // makes "flag off ⇒ byte-identical to before this item" a provable
    // property of the actual call, not just of its observable effect (see
    // send-digest.test.ts's "byte-identical call shape" test, which asserts
    // `mock.calls[0]` has length 1, not merely that its second element is
    // undefined).
    const { data, error } = input.idempotencyKey
      ? await client.emails.send(payload, { idempotencyKey: input.idempotencyKey })
      : await client.emails.send(payload);

    if (error) {
      return { sent: false, error: error.message || "unknown error", errorCode: error.name };
    }
    return { sent: true, messageId: data?.id };
  } catch (err) {
    return {
      sent: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
