/**
 * The `usage_events` sink — what was actually spent, and on whose behalf.
 *
 * ABC-freemium 1-03 · R-METER-1, R-METER-2.
 *
 * Before this, nothing anywhere was persisted: `logLlmUsage` wrote one
 * `console.log` line and searches were not recorded at all.
 *
 * **A usage row is observability, never a gate.** Writing one can fail without
 * the user's response changing in any way, so `recordUsageEvent` swallows its
 * own errors and is a no-op when Supabase is unconfigured. The single exception
 * is R-QUOTA-2's breaker row, which is the audit trail for a spend cap — use
 * `recordUsageEventAwaited` there. Even then the *decision* belongs to the
 * counter, never to the row.
 *
 * **Never the key.** There is no field on this row that could hold a
 * credential, `LlmUsage` never carried one, and none is to be added "for
 * debugging" — a usage table is exactly the place a leaked key would survive
 * longest.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type UsageEventKind = "llm" | "search" | "breaker";

export interface UsageEventRow {
  /** Null for a library-level call the route has already authenticated. */
  user_id: string | null;
  kind: UsageEventKind;
  /** Logical call site, e.g. "digest", "report:pass2", "figure:vision". */
  path?: string | null;
  provider?: string | null;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  thinking_tokens?: number | null;
  latency_ms?: number | null;
  ok: boolean;
  /**
   * True when the call ran on the user's own key. **Null means "not known"** —
   * a row written outside a resolved-provider scope. A wrong `false` would read
   * as "the operator paid for this", so the honest missing value is kept.
   */
  byok?: boolean | null;
  /** `kind: "search"` only — which surface fanned out. */
  surface?: string | null;
  /** `kind: "search"` only — how many queries this fan-out issued. */
  query_count?: number | null;
}

interface UsageEventsClient {
  from(table: string): {
    insert(rows: UsageEventRow[]): Promise<{ error: unknown }>;
  };
}

function configuredAdminClient(): UsageEventsClient | null {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  try {
    return createAdminClient() as unknown as UsageEventsClient;
  } catch {
    return null;
  }
}

let testClient: UsageEventsClient | null | undefined;

/** Tests only: inject a recorder, or `null` to assert the no-op path. */
export function setUsageEventsClientForTests(
  client: UsageEventsClient | null | undefined,
): void {
  testClient = client;
}

async function send(row: UsageEventRow): Promise<void> {
  const client = testClient === undefined ? configuredAdminClient() : testClient;
  if (!client) return;
  try {
    await client.from("usage_events").insert([row]);
  } catch {
    // Observability must never break a request. Deliberately silent: this runs
    // on every model call, and a warn-per-failure during an outage would be its
    // own incident.
  }
}

/** Fire and forget. Never awaited on a request's critical path. */
export function recordUsageEvent(row: UsageEventRow): void {
  void send(row);
}

/**
 * Awaited. **Only** for R-QUOTA-2's breaker row: that row is the audit trail
 * for a spend cap that has already been decided by the counter, and losing it
 * to a cold shutdown would leave a trip with no record.
 */
export async function recordUsageEventAwaited(row: UsageEventRow): Promise<void> {
  await send(row);
}
