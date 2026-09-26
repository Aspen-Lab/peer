// TRIGGER-A — extracted from web/src/app/api/jobs/dispatch-digests/route.ts
// (guide docs/jev-abc/TRIGGER-A-B-20260925T044825Z.md §3 Step 1,
// ABC-JEV-INTEGRATION.md §1x). BEHAVIOUR-PRESERVING: every export below is a
// byte-identical body move, not a rewrite — dispatch-digests/route.ts now
// imports these instead of declaring them locally. route.test.ts and
// idempotency.test.ts both import only `GET`/`digestIdempotencyKey` from
// route.ts (never these symbols directly), so this move does not require any
// test-file edit and both suites must stay green unchanged.
//
// Second caller (the reason this now lives in its own module instead of
// staying private to dispatch-digests/route.ts): TRIGGER-A's new
// `GET /api/jobs/prepare-dashboards` route reuses `handleConflictingEmailClaim`
// unmodified for its own digest-email-retry phase (user decision #5) — see
// that route's module header. Nothing about the function's behaviour changes
// for its original caller; it just has a second one now.
import type { createAdminClient } from "@/lib/supabase/admin";
import { sendDigestEmail } from "@/lib/email/send-digest";

type AdminClient = ReturnType<typeof createAdminClient>;

// Inside Resend's 24h idempotency-key window (B3) with a 1h safety margin,
// so a retry is never attempted right at the edge of the key silently
// expiring and becoming a genuinely new send.
export const IDEMPOTENCY_REPLAY_WINDOW_MS = 23 * 60 * 60 * 1000;

export type PendingDigestEmail = {
  idempotencyKey: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attemptedAt: string;
};
export type ConfirmedDigestEmail = { sent: true; sentAt: string };
export type DigestEmailRecord = PendingDigestEmail | ConfirmedDigestEmail;

// Best-effort bookkeeping only. Per the B guide's own C7 reasoning: Resend's
// idempotency key (not this local write) is the actual safety net against a
// double send, so a failure HERE must never block the send itself and must
// never promote the row into this invocation's `failed` bucket -- it only
// costs this one row its ability to be usefully replayed if the send also
// then fails, which degrades to exactly the pre-existing F-A-P4S7-01
// trade-off, never to a new failure mode.
export async function persistDigestEmailAttempt(
  admin: AdminClient,
  deliveryId: number,
  currentPayload: Record<string, unknown> | null | undefined,
  email: DigestEmailRecord,
): Promise<void> {
  try {
    await admin
      .from("briefing_deliveries")
      .update({ payload: { ...(currentPayload ?? {}), email } })
      .eq("id", deliveryId);
  } catch {
    // Swallowed deliberately -- see comment above.
  }
}

export type ConflictOutcome =
  | { kind: "sent"; messageId?: string }
  | { kind: "failed"; error: string }
  | { kind: "skip"; reason: string };

// P4-S7-IDEM conflict-branch decision ladder (ABC-JEV-INTEGRATION.md §4
// ruling, binding):
//   1. row/sub-object unreadable or absent (legacy/pre-change row, or the
//      read itself failed) -> treat as already sent -> skip, UNCHANGED
//      reason string (every pre-existing route.test.ts assertion for this
//      branch keeps passing byte for byte).
//   2. payload.email.sent === true -> skip, new distinguishing reason.
//   3. unsent, has a full stored body, attemptedAt <= 23h -> replay
//      VERBATIM with the same recomputed key.
//   4. unsent, attemptedAt > 23h -> do not send; report expired-unsent.
// Never risks a double send: the only way this function calls Resend at all
// is case 3, always with the SAME deterministic key and the SAME
// byte-for-byte stored payload every time.
export type ExistingBriefingRow = {
  id: number;
  payload: { email?: Partial<PendingDigestEmail> & { sent?: boolean } };
};

export async function handleConflictingEmailClaim(params: {
  admin: AdminClient;
  userId: string;
  localDate: string;
  idempotencyKey: string;
  now: Date;
}): Promise<ConflictOutcome> {
  const { admin, userId, localDate, idempotencyKey, now } = params;
  const LEGACY_SKIP: ConflictOutcome = {
    kind: "skip",
    reason: "digest already claimed for this local date",
  };

  let existing: ExistingBriefingRow | null = null;
  try {
    const { data, error } = await admin
      .from("briefing_deliveries")
      .select("id, payload")
      .eq("user_id", userId)
      .eq("local_date", localDate)
      .limit(1);
    if (!error && Array.isArray(data) && data.length > 0) {
      existing = data[0] as ExistingBriefingRow;
    }
  } catch {
    existing = null;
  }

  const email = existing?.payload?.email;
  if (!existing || !email) {
    return LEGACY_SKIP; // never risk a double send on an unreadable/legacy row
  }
  if (email.sent === true) {
    return { kind: "skip", reason: "digest already sent for this local date" };
  }
  if (!email.subject || !email.html || !email.text || !email.to || !email.attemptedAt) {
    return LEGACY_SKIP; // shape we don't recognize -- fail safe, same as legacy
  }
  const attemptedAtMs = Date.parse(email.attemptedAt);
  const ageMs = now.getTime() - attemptedAtMs;
  if (!Number.isFinite(attemptedAtMs) || ageMs > IDEMPOTENCY_REPLAY_WINDOW_MS) {
    return { kind: "skip", reason: "digest email attempt expired unsent (>23h, not retried)" };
  }

  const result = await sendDigestEmail({
    to: email.to,
    items: [],
    originUrl: "",
    idempotencyKey,
    render: { subject: email.subject, html: email.html, text: email.text },
  });

  if (result.sent) {
    await persistDigestEmailAttempt(admin, existing.id, existing.payload, {
      sent: true,
      sentAt: new Date().toISOString(),
    });
    return { kind: "sent", messageId: result.messageId };
  }
  if (result.errorCode === "concurrent_idempotent_requests") {
    // Another attempt is genuinely in flight elsewhere -- safe to retry
    // later (B6); not our failure to report as one, and the stored row is
    // deliberately left untouched.
    return {
      kind: "skip",
      reason: "digest email retry already in progress (concurrent idempotent request)",
    };
  }
  // Generic failure OR `invalid_idempotent_request` (payload-mismatch 409):
  // both fall into the same reported bucket, carrying Resend's own message.
  // "Never resend" (the §4 ruling's words for the invalid_idempotent_request
  // case) is satisfied structurally, not by extra suppression state: this
  // function never regenerates the key and never re-renders on retry, so
  // the ONLY way it can legitimately reach that specific error is if
  // something outside this design reused the same key with different
  // content -- an anomaly this slice cannot repair without guessing.
  return { kind: "failed", error: result.error ?? "unknown" };
}

// TRIGGER-A (ABC-JEV-INTEGRATION.md §1x P10) — the digest-email-retry
// phase's own candidate-eligibility window. Reuses IDEMPOTENCY_REPLAY_WINDOW_MS
// above as the single source of truth for the upper bound rather than a
// second 23h constant (handleConflictingEmailClaim already enforces that
// same bound internally; this is additionally applied at SELECTION time so a
// long-expired unsent row stops being re-fetched every hourly run forever —
// see docs/jev-abc/TRIGGER-A-B-20260925T044825Z.md §2.9). The 10-minute
// floor is a deliberate, cheap defense-in-depth margin against racing a
// same-hour dispatch attempt still in flight — not required for correctness
// (Resend's own idempotency key is the actual safety net), but avoids a
// pointless simultaneous-retry attempt.
export const EMAIL_RETRY_MIN_AGE_MS = 10 * 60 * 1000;

export function isEmailRetryEligible(attemptedAtIso: string | undefined, now: Date): boolean {
  if (!attemptedAtIso) return false;
  const attemptedAtMs = Date.parse(attemptedAtIso);
  if (!Number.isFinite(attemptedAtMs)) return false;
  const ageMs = now.getTime() - attemptedAtMs;
  return ageMs >= EMAIL_RETRY_MIN_AGE_MS && ageMs <= IDEMPOTENCY_REPLAY_WINDOW_MS;
}
