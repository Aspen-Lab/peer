// GET /api/feed/archive[?date=YYYY-MM-DD]
//
// Read-only, owner-scoped past-batch access (ABC-JEV-INTEGRATION.md §4
// "Round 3 — END-OF-ROUND RE-MEASUREMENT part 2" RULING (archive);
// acceptance 16's "archive access" subcase; §3c: "Archive is explicit
// old-batch access, not a new recommendation."). Sibling of
// web/src/app/api/feed/route.ts and web/src/app/api/feed/ack/route.ts --
// this route MIRRORS the ack route's conventions throughout (flag-off 404
// before auth, 401, owner id only from the session, no existence oracle,
// `private, no-store`) rather than inventing new ones.
//
// With `?date=YYYY-MM-DD`: returns that owner's SERVED or ACKNOWLEDGED
// batch for that local date -- its stored `servedItems`, in their exact
// frozen order. NEVER a `'prepared'`-only batch (nobody has been sent it
// yet, so it isn't "archived"), NEVER re-ranked, NEVER re-scored, NEVER
// minted, NEVER acknowledged -- this route only ever calls read methods
// (`getBatch`, `listServedBatchDates`, `readExclusions`) and never writes
// the ledger. Unlike web/src/app/api/feed/route.ts's own
// `resolveServedItems`, this route does NOT reconstruct a legacy batch that
// predates the `servedItems` column (P4-S3): reconstruction re-runs the
// selection pipeline, which is exactly the "never re-ranked/re-scored"
// guarantee this route exists to keep. A legacy batch with no stored items
// returns an empty `items` array, not a re-derived one.
//
// Without `date`: a bounded (most recent `ARCHIVE_DATE_LIST_LIMIT`),
// most-recent-first list of this owner's local dates that have a SERVED or
// ACKNOWLEDGED batch, via `DashboardDeliveryLedger.listServedBatchDates`
// (P4-S9's one addition to that interface -- see
// web/src/lib/dashboard/delivery-ledger.ts).
//
// Behind the same server-only flag as every other P4 ledger path
// (ABC-JEV-INTEGRATION.md §1p.F): PEER_DASHBOARD_LEDGER=on. Off (the
// default) means this route reports itself not_enabled, before any auth or
// ledger work -- see web/src/lib/dashboard/ledger-flag.ts.
//
// **Availability / the 503 contract.** `getBatch`/`listServedBatchDates`
// both fail OPEN (null/`[]`) on a configured-client read error -- by
// themselves indistinguishable from "genuinely nothing there" (see
// delivery-ledger.ts's own "two failure rules" comment). This route gets
// its fail-CLOSED 503 the same way web/src/app/api/feed/route.ts's
// `runLedgerAwareFeed` already does: checking `readExclusions`'s own
// strict ok/unavailable status FIRST (an existing, already-tested method --
// its `keys` are unused here, only its `status`), and only trusting a
// fail-open empty/null result once that says "ok". No new "unavailable"-
// typed primitive was added just for this route. Named, accepted cost:
// this spends 2 extra queries (readExclusions' own dashboard_deliveries +
// dashboard_batches reads) beyond the 1 query getBatch/listServedBatchDates
// itself would need on a success path -- the same "one wasted read for a
// truthful availability signal" trade-off runLedgerAwareFeed already makes
// (see that file's own "Named, accepted cost" comment), acceptable here
// because this is a low-traffic browsing endpoint, not the hot feed path.
//
// **Owner id** is only ever the authenticated session's own `user.id`. This
// route never reads any owner-shaped value from the query string -- `date`
// is the only query parameter it ever looks at -- so "no owner from the
// query" is structural, not a runtime check.
//
// **No existence oracle.** A date with no batch at all, and a date whose
// batch is still only `'prepared'` (not yet served to anyone), return the
// EXACT SAME 404 body -- mirrors the ack route's not_found/owner_mismatch
// collapse (never let a caller distinguish "doesn't exist" from "not
// servable yet, but something is quietly being prepared").
//
// **Validation order** mirrors the ack route exactly: flag check (sync,
// cheap) -> date-shape/future validation (sync, cheap, no I/O) -> auth (I/O)
// -> ledger availability -> business logic. Shape validation runs BEFORE
// auth on purpose, same as the ack route's batchId check -- there is no
// reason to pay for a network auth round trip on a request that is
// syntactically invalid regardless of who is asking.

import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { localCalendarDate } from "@/lib/local-calendar-date";
import { dashboardLedgerEnabled } from "@/lib/dashboard/ledger-flag";
import { SupabaseDashboardDeliveryLedger } from "@/lib/dashboard/delivery-ledger";
import type { ScoredItem } from "@/lib/scoring/types";

export const dynamic = "force-dynamic";

const CACHE_HEADERS = {
  "Cache-Control": "private, no-store",
};

// "list of available dates (bounded)" per the P4-S9 ruling -- a named
// constant, matching this codebase's FINAL_POOL_SIZE-style convention
// rather than a bare literal at the call site.
const ARCHIVE_DATE_LIST_LIMIT = 30;

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Strict calendar-date validity, not just shape: rejects e.g. "2026-02-30"
 * or "2026-13-01", which `new Date(y, m - 1, d)` would otherwise silently
 * roll over into a DIFFERENT, valid-looking date (March 2 / next January)
 * rather than reject.
 */
function isValidCalendarDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(year, month - 1, day);
  return parsed.getFullYear() === year && parsed.getMonth() === month - 1 && parsed.getDate() === day;
}

function json(body: unknown, status: number): NextResponse {
  return NextResponse.json(body, { status, headers: CACHE_HEADERS });
}

export async function GET(request: NextRequest) {
  // Flag off: report not found before touching auth or the ledger at all --
  // same ordering as web/src/app/api/feed/ack/route.ts.
  if (!dashboardLedgerEnabled()) {
    return json({ error: "not_enabled" }, 404);
  }

  // Pure, local, synchronous validation before any I/O -- same discipline
  // as the ack route's batchId shape check. `null` (param absent entirely)
  // means "list mode"; an empty string (`?date=`) is present-but-malformed,
  // not absent, so it falls through to the shape check and is rejected.
  const dateParam = request.nextUrl.searchParams.get("date");
  if (dateParam !== null) {
    if (!isValidCalendarDate(dateParam)) {
      return json({ error: "invalid_date" }, 400);
    }
    // "Local date" uses the SAME server-local-calendar convention as
    // web/src/app/api/feed/route.ts's own localCalendarDate(now) for batch
    // keys -- string comparison is safe because the format is a fixed-width
    // YYYY-MM-DD (lexicographic order equals chronological order).
    if (dateParam > localCalendarDate(new Date())) {
      return json({ error: "future_date" }, 400);
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return json({ error: "unauthenticated" }, 401);
  }

  const ledger = new SupabaseDashboardDeliveryLedger();

  // Fail-CLOSED availability probe -- see this file's top-of-file comment.
  const availability = await ledger.readExclusions(user.id);
  if (availability.status === "unavailable") {
    return json({ error: "ledger_unavailable" }, 503);
  }

  if (dateParam !== null) {
    const batch = await ledger.getBatch(user.id, dateParam);
    // No existence oracle: "no batch at all" and "a batch that's still only
    // prepared, not yet served to anyone" collapse to the identical 404 --
    // see this file's top-of-file comment.
    if (!batch || (batch.status !== "served" && batch.status !== "acknowledged")) {
      return json({ error: "not_found" }, 404);
    }
    return json(
      {
        date: dateParam,
        batchStatus: batch.status,
        items: (batch.servedItems as ScoredItem[] | undefined) ?? [],
      },
      200,
    );
  }

  const dates = await ledger.listServedBatchDates(user.id, ARCHIVE_DATE_LIST_LIMIT);
  return json({ dates }, 200);
}
