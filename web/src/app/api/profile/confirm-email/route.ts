// POST /api/profile/confirm-email — request a confirmation link for a NEW
//   (non-account) digest_email address. Stateless: nothing is written until
//   the link is clicked (GET below).
// GET  /api/profile/confirm-email — the clicked link: verify the token,
//   write digest_email, redirect back to /profile.
//
// EMAIL-SETTINGS — ABC-JEV-INTEGRATION.md §1y point 2.iii, §1z. Guide
// docs/jev-abc/EMAIL-SETTINGS-B-20260926T142832Z.md §2.1/§2.2.
//
// Design notes worth keeping visible here (not just in the guide):
//  - The account's own email, and the address already stored in
//    digest_email, both count as already-confirmed: this route short-
//    circuits straight to a write for either, with no token and no email
//    sent (§2.2 "Address already-confirmed short-circuit").
//  - Re-use is allowed on purpose: the SAME token GET-ed twice both
//    succeed. A confirmation link is conventionally multi-use within its
//    expiry (unlike a password reset, there is nothing to "spend" here) —
//    see confirm-token.ts's own header for the mail-gateway-prefetch reason.
//  - **GET redirects rather than returning a bare 401 when nobody is signed
//    in.** This is a deliberate reading of a real conflict in this item's
//    own inputs: the guide's RED list #1 says "both methods... return 401",
//    but the guide's own detailed design (§2.2) and the manager's ruling
//    (§1z P8) both say a browser-clicked link with nobody signed in must
//    show "a calm 'sign in, then open the link again' page" — and a bare
//    JSON 401 is not a page a person clicking an email link would see
//    rendered sensibly. A 401 status cannot carry a redirect a browser will
//    follow (redirects are 3xx by HTTP definition), so the two directives
//    cannot both be satisfied literally for GET. This implementation follows
//    the more specific, more recently written design (§2.2/P8): GET redirects
//    to /profile with an honest flag for every outcome, POST alone returns
//    the plain 401 JSON the RED list describes. Flagged for A in the C
//    checkpoint's "Deviations" section.
//  - Never logs an email address (constraint vii).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  getConfirmSecret,
  isValidEmailFormat,
  normalizeEmailAddress,
  signConfirmToken,
  verifyConfirmToken,
} from "@/lib/email/confirm-token";
import {
  renderConfirmEmailHtml,
  renderConfirmEmailPlaintext,
  renderConfirmEmailSubject,
} from "@/lib/email/confirm-email-template";
import { sendDigestEmail } from "@/lib/email/send-digest";
import {
  classifySendFailure,
  describeSendFailureForLog,
} from "@/lib/email/send-failure";
import {
  breakerTripped,
  confirmEmailRequestDayKey,
  endOfUtcDay,
  getCounterStore,
} from "@/lib/usage/counters";

export const dynamic = "force-dynamic";

const CONFIRM_REQUESTS_PER_DAY = 5;

function originUrlFor(req: NextRequest): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (host) return `${proto}://${host}`;
  return "https://hermes-flax-six.vercel.app";
}

function profileRedirect(req: NextRequest, query: string): NextResponse {
  return NextResponse.redirect(new URL(`/profile?${query}`, req.url));
}

interface SupabaseLike {
  auth: { getUser(): Promise<{ data: { user: { id: string; email?: string } | null } }> };
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): Promise<{ data: { digest_email: string | null } | null; error: { message: string } | null }>;
      };
    };
    upsert(
      row: Record<string, unknown>,
      opts: { onConflict: string },
    ): Promise<{ error: { message: string } | null }>;
  };
}

async function currentDigestEmail(
  supabase: SupabaseLike,
  userId: string,
): Promise<{ ok: true; value: string | null } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("profiles")
    .select("digest_email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) return { ok: false, message: error.message };
  return { ok: true, value: data?.digest_email ?? null };
}

async function writeConfirmedDigestEmail(
  supabase: SupabaseLike,
  userId: string,
  email: string,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase
    .from("profiles")
    .upsert({ user_id: userId, digest_email: email }, { onConflict: "user_id" });
  if (error) return { ok: false, message: error.message };
  return { ok: true };
}

export async function POST(req: NextRequest) {
  const supabase = (await createClient()) as unknown as SupabaseLike;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const rawEmail = (body as { email?: unknown } | null)?.email;
  if (typeof rawEmail !== "string" || !rawEmail.trim()) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const candidate = normalizeEmailAddress(rawEmail);
  if (!isValidEmailFormat(candidate)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const accountEmail = user.email ? normalizeEmailAddress(user.email) : null;
  const existing = await currentDigestEmail(supabase, user.id);
  if (!existing.ok) {
    return NextResponse.json({ error: existing.message }, { status: 500 });
  }
  const storedEmail = existing.value ? normalizeEmailAddress(existing.value) : null;

  // §2.2 "Address already-confirmed short-circuit" — the account's own
  // email, or the address already stored, needs no token and no email.
  if (candidate === accountEmail || (storedEmail !== null && candidate === storedEmail)) {
    const write = await writeConfirmedDigestEmail(supabase, user.id, candidate);
    if (!write.ok) {
      return NextResponse.json({ error: write.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, confirmed: true, email: candidate });
  }

  // A genuinely new address from here on — needs the secret and the daily cap.
  const secret = getConfirmSecret();
  if (!secret) {
    // §1z P6 — confirming a DIFFERENT address is unavailable with an honest
    // message; the account's own email (handled above) still works. §1al
    // POLISH-1-EMAIL (a) — 503 (a configuration state, not a server fault),
    // not the old 500; the page maps 503 to a plain "not available right
    // now" sentence and reserves 500 for a genuine database error below.
    return NextResponse.json(
      { error: "email_confirmation_unavailable" },
      { status: 503 },
    );
  }

  // §1z P1 — FAILS CLOSED: protects the send budget/abuse surface, follows
  // the wallet-breaker precedent, not the ordinary rate-limit one.
  const now = new Date();
  const reading = await getCounterStore().increment(
    confirmEmailRequestDayKey(user.id, now),
    endOfUtcDay(now),
    1,
    now,
  );
  if (breakerTripped(reading, CONFIRM_REQUESTS_PER_DAY)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  const token = signConfirmToken(secret, user.id, candidate, now);
  const confirmUrl = `${originUrlFor(req)}/api/profile/confirm-email?token=${encodeURIComponent(token)}`;

  // Same "empty items + render override" trick handleConflictingEmailClaim
  // already uses — send-digest.ts needs no change at all.
  const result = await sendDigestEmail({
    to: candidate,
    items: [],
    originUrl: "",
    render: {
      subject: renderConfirmEmailSubject(),
      html: renderConfirmEmailHtml({ confirmUrl }),
      text: renderConfirmEmailPlaintext({ confirmUrl }),
    },
  });

  // §1al POLISH-1-EMAIL (f) — this route now checks the send result instead
  // of discarding it. Safe to be specific about WHY it failed: this POST
  // handler has exactly one send branch, so a failure here reflects Peer's
  // own sender setup (or a transient provider outage) — never whether
  // `candidate` belongs to someone else's account. No enumeration risk, and
  // no counter refund (the daily request was already spent above).
  if (!result.sent) {
    console.error(
      `[profile/confirm-email] confirmation send failed: ${describeSendFailureForLog(result)}`,
    );
    const reason = classifySendFailure(result);
    return NextResponse.json(
      { error: reason === "sender_not_verified" ? "sender_not_verified" : "confirmation_send_failed" },
      { status: 502 },
    );
  }

  // Generic response either way — this route never states whether the
  // address exists elsewhere (P9's enumeration protection: a request for an
  // address already used elsewhere looks identical to a request for a
  // brand-new one). It DOES now state whether the send itself technically
  // succeeded (§1al (f) above) — that is a separate, safe distinction, not
  // an enumeration leak.
  return NextResponse.json({ ok: true, confirmed: false });
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");

  const supabase = (await createClient()) as unknown as SupabaseLike;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // P8 — nothing is written; a calm redirect, not a raw 401 (see module
    // header's "Deviations" note).
    return profileRedirect(req, "digest_email_confirm=signin_required");
  }

  if (!token) {
    return profileRedirect(req, "digest_email_confirm=invalid_link");
  }

  const secret = getConfirmSecret();
  if (!secret) {
    return profileRedirect(req, "digest_email_confirm=unavailable");
  }

  const result = verifyConfirmToken(secret, token, new Date());
  if (!result.ok) {
    // malformed / tampered / expired all land on the same honest, generic
    // outcome for the reader — no DB write in any case.
    return profileRedirect(req, "digest_email_confirm=invalid_link");
  }
  if (result.uid !== user.id) {
    // "This confirmation link isn't for your account" — critically, the
    // SIGNED-IN user's own digest_email is not touched either.
    return profileRedirect(req, "digest_email_confirm=wrong_account");
  }

  const write = await writeConfirmedDigestEmail(supabase, user.id, result.email);
  if (!write.ok) {
    return profileRedirect(req, "digest_email_confirm=invalid_link");
  }
  return profileRedirect(req, "digest_email_confirmed=1");
}
