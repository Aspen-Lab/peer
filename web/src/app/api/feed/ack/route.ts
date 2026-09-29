// POST /api/feed/ack
//
// Client confirmation that a dashboard batch actually rendered
// (ABC-JEV-INTEGRATION.md §1p.C.7: "the client acknowledges once, after the
// batch's cards have rendered... AND document.visibilityState === 'visible'"
// -- that trigger logic lives client-side, P4-S5; this route only handles
// the server half of the contract). This is the ONLY thing that copies a
// batch's papers into the permanent dashboard_deliveries ledger
// (DashboardDeliveryLedger.acknowledgeBatch) -- being SERVED a batch is not
// enough, matching the product rule that background generation is never
// delivery (F-A-P4-02/F-A-P4-05).
//
// Idempotent and retryable by design (docs/jev-abc/P4-B-20260924T0338Z.md
// DESIGN §4; ABC-JEV-INTEGRATION.md §1p.C.7's "a pending acknowledgment is
// persisted locally and retried before the next load"): acking the same
// batch twice, from one device or two, is always safe and always a 200.
//
// Behind the same server-only flag as every other P4 ledger path
// (ABC-JEV-INTEGRATION.md §1p.F): PEER_DASHBOARD_LEDGER=on. Off (the
// default) means this route reports itself not_enabled, before any auth or
// ledger work -- same "conceals production before entitlement or profile
// work" ordering web/src/app/api/test-digest/route.ts already uses for its
// own environment gate. See web/src/lib/dashboard/ledger-flag.ts for why
// the on/off spelling is deliberately narrow.
//
// No per-card data is ever accepted -- the body is exactly { batchId }, and
// no other field is read. This route is client-only; no server/background
// code calls it (the cron/test digest paths never consult the dashboard
// ledger at all, ABC-JEV-INTEGRATION.md §1p.C.2/§1p.F).

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { dashboardLedgerEnabled } from "@/lib/dashboard/ledger-flag";
import { SupabaseDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
};

// dashboard_batches.id is a Postgres `uuid primary key default
// gen_random_uuid()` (docs/jev-abc/P4-B-20260924T0338Z.md DESIGN §1), so any
// non-UUID-shaped string can never be a real batch id. Rejecting it here is
// a pure, local, synchronous check -- no auth call, no ledger call, no DB
// round trip of any kind for a malformed request.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuidShaped(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

export async function POST(request: NextRequest) {
  // Flag off: report not found before touching auth or the ledger at all.
  if (!dashboardLedgerEnabled()) {
    return json({ error: "not_enabled" }, 404);
  }

  // Parse + validate before any I/O. Any shape problem -- unparseable JSON,
  // a missing/wrong-typed/non-UUID batchId -- collapses to the same 400;
  // there is nothing else in the body this route ever reads (no per-card
  // fields), so one generic error code is honest and sufficient.
  let batchId: unknown;
  try {
    const body = (await request.json()) as { batchId?: unknown } | null;
    batchId = body?.batchId;
  } catch {
    batchId = undefined;
  }
  if (!isUuidShaped(batchId)) {
    return json({ error: "invalid_batch_id" }, 400);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: "unauthenticated" }, 401);
  }

  const ledger = new SupabaseDashboardDeliveryLedger();
  let result: Awaited<ReturnType<typeof ledger.acknowledgeBatch>>;
  try {
    result = await ledger.acknowledgeBatch(user.id, batchId);
  } catch {
    // Server failure (RPC throws / DB down): the client keeps the batch
    // pending locally and retries later -- same idempotent path, never
    // marked acknowledged client-side until the server actually confirms.
    return json({ error: "ledger_unavailable" }, 503);
  }

  if (result === "acknowledged") {
    return json({ ok: true, alreadyAcknowledged: false }, 200);
  }
  if (result === "already_acknowledged") {
    return json({ ok: true, alreadyAcknowledged: true }, 200);
  }
  // result is "not_found" | "owner_mismatch" here -- deliberately the SAME
  // response for both: distinguishing them would let a caller learn "this
  // id exists but isn't yours" (an existence oracle for another owner's
  // data), which the ack design explicitly forbids.
  return json({ error: "batch_not_found" }, 404);
}
