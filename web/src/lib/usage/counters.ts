/**
 * Per-user counters that survive a cold start.
 *
 * ABC-freemium 1-02 · R-METER-3, R-METER-4.
 *
 * What was wrong: the rate limiter was a module-scope `Map` in
 * `lib/security/ai-request.ts`. It lived inside one Node process, so a
 * serverless instance that had just started always saw zero and the 60/h and
 * 20/h limits were per-instance rather than per-user.
 *
 * ── TWO FAILURE RULES, ON PURPOSE ────────────────────────────────────────────
 *
 * When the store cannot be reached, `ok` is `false` on the reading and the two
 * kinds of caller must do **opposite** things:
 *
 *  - **Rate limits FAIL OPEN.** This counter sits in front of the feed for every
 *    signed-in user. A Supabase outage that answers 429 to everybody is a worse
 *    failure than an hour of unmetered use, so `underLimit()` treats an
 *    unreadable counter as "under the limit".
 *  - **Breakers FAIL CLOSED.** The 200/day and 500/day caps of R-QUOTA-2 exist
 *    to protect the owner's wallet. A wallet that cannot be read must not be
 *    spent, so `breakerTripped()` treats an unreadable counter as tripped and
 *    the request degrades to the existing no-LLM path.
 *
 * That asymmetry is deliberate and is asserted in `counters.test.ts`. **A
 * Supabase outage therefore degrades every paid user to no-LLM** — that is the
 * trade, written down here so a later round reports it as a design decision
 * rather than as a defect.
 *
 * ── THE PERIOD LIVES IN THE KEY ──────────────────────────────────────────────
 *
 * A shared store cannot carry a per-instance `resetAt`, so every window is a
 * segment of the key and rolls over when the clock crosses it. All segments are
 * **UTC**: D4 says "the rest of the UTC day" in as many words, and
 * `localCalendarDate` is the server's local zone, which is UTC on Vercel but not
 * on a developer's machine. **Do not reuse `localCalendarDate` here** — it is
 * the right helper for the pool key (1-17) and the wrong one for a quota.
 *
 * **A small, real behaviour change, stated rather than hidden:** the old bucket
 * ran for an hour from a user's first request; the new one is a fixed clock
 * hour. A user who sends 60 requests at 10:59 can send 60 more at 11:00, where
 * before they would have waited an hour. That is the standard trade for
 * surviving a cold start, and R-METER-3 asks for the survival. The limits
 * themselves (60/h feeds, 20/h reports) are unchanged.
 *
 * This module imports no framework: `ai-request.ts` pulls in `next/server` and
 * `next/headers`, and anything importing those inside a test drags in the Next
 * request scope.
 */
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * A counter reading.
 *
 * `value` is the count **after** this call's increment, so a caller can test the
 * limit and increment it in one round trip and two instances can never both see
 * "59" and both proceed.
 *
 * `ok` is false when the store could not be reached. It is a field rather than a
 * thrown error so that a caller who forgets to check it fails **open** — which
 * is the safe direction for the rate limits that make up almost every call, and
 * why `breakerTripped()` below exists rather than leaving each breaker to
 * hand-roll the opposite rule.
 */
export interface CounterReading {
  value: number;
  ok: boolean;
}

export interface CounterStore {
  /**
   * Add `by` (default 1) and return the post-increment value.
   *
   * `now` is **the caller's clock**, defaulted to the real one (ABC-freemium
   * 2-01 · Ruling 5 point 3). Every production caller already has a `now` in
   * hand and must pass it: the in-memory store's housekeeping sweep compares
   * stored window ends against it, and a sweep on a second, different clock is
   * how a fixture that pins time still watches its own entries disappear.
   */
  increment(
    key: string,
    windowEndsAt: Date | null,
    by?: number,
    now?: Date,
  ): Promise<CounterReading>;
  read(key: string, now?: Date): Promise<CounterReading>;
  /** R-METER-4 — which implementation actually answered. */
  readonly label: "supabase" | "in-memory";
}

// ── Key layout ───────────────────────────────────────────────────────────────

function utcHourSegment(now: Date): string {
  return now.toISOString().slice(0, 13); // YYYY-MM-DDTHH
}

function utcDaySegment(now: Date): string {
  return now.toISOString().slice(0, 10); // YYYY-MM-DD
}

function utcMonthSegment(now: Date): string {
  return now.toISOString().slice(0, 7); // YYYY-MM
}

/** `rate:<scope>:<user>:<YYYY-MM-DDTHH>` — the replacement for the old bucket. */
export function rateKey(scope: string, userId: string, now: Date): string {
  return `rate:${scope}:${userId}:${utcHourSegment(now)}`;
}

/** D4 — one counter across papers + jobs + events, per calendar month. */
export function deepReportMonthKey(userId: string, now: Date): string {
  return `deep:${userId}:${utcMonthSegment(now)}`;
}

/** R-QUOTA-2 — the paid 200/day breaker. */
export function deepReportDayKey(userId: string, now: Date): string {
  return `deep:${userId}:${utcDaySegment(now)}`;
}

/**
 * R-QUOTA-2 — the 20-report trial cap.
 *
 * **No date segment, and that is not an oversight.** The cap is 20 over the
 * whole 14 days, so a period segment would reset it and hand the trial a fresh
 * twenty every month. The trial expires by date on its own (D5); this key never
 * rolls over. A later reader will want to make it monthly for symmetry with the
 * two keys above — do not.
 */
export function deepReportTrialKey(userId: string): string {
  return `deep:${userId}:trial`;
}

/**
 * R-QUOTA-2 / D4 — the paid circuit breakers. Unlimited *to the user*, behind a
 * hard cap that protects the owner's wallet.
 *
 * **RENAMED in 5-02 · Ruling 13 point 1 — was `SYSTEM_SEARCHES_PER_DAY`, cap
 * unchanged at 500/day.** Under D2a the operator funds no search, so the search
 * fan-out no longer reaches this breaker at all. What still reaches it is the
 * **forced pool rebuild** ("refresh now", gated on `poolRefreshAllowed`), which
 * spends operator money on the query-generation LLM call — so the cap must stay
 * or the refresh button becomes an unbounded spend button. Only the name was
 * made false by D2a, so only the name changed.
 */
export const FORCED_REBUILDS_PER_DAY = 500;

/**
 * R-QUOTA-2 — the 500/day forced-rebuild breaker (renamed from
 * `systemSearchDayKey` in 5-02; the key string changed with it, which is free
 * because the migrations are unapplied and there are no users).
 */
export function forcedRebuildDayKey(userId: string, now: Date): string {
  return `forced_rebuilds_today:${userId}:${utcDaySegment(now)}`;
}

/** First instant of the next UTC hour — housekeeping only; nothing gates on it. */
export function endOfUtcHour(now: Date): Date {
  const end = new Date(now);
  end.setUTCMinutes(0, 0, 0);
  end.setUTCHours(end.getUTCHours() + 1);
  return end;
}

/** First instant of the next UTC day. */
export function endOfUtcDay(now: Date): Date {
  const end = new Date(now);
  end.setUTCHours(0, 0, 0, 0);
  end.setUTCDate(end.getUTCDate() + 1);
  return end;
}

/** First instant of the next UTC month — R-QUOTA-1's `resetsAt`. */
export function endOfUtcMonth(now: Date): Date {
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
}

// ── The in-memory implementation ─────────────────────────────────────────────

interface MemoryEntry {
  value: number;
  windowEndsAt: Date | null;
}

/**
 * R-METER-4's fallback. Correct for a single process and honest about being one:
 * `label` says `in-memory` so a log line never implies a shared count.
 *
 * **It is genuinely atomic**, which matters more than it looks. There is no
 * `await` between reading the entry and writing it back, so JavaScript's single
 * thread guarantees that N concurrent callers get N distinct values. An
 * implementation that awaited in the middle would hand two callers the same
 * number and the concurrency test in `counters.test.ts` would catch it.
 */
export class InMemoryCounterStore implements CounterStore {
  readonly label = "in-memory" as const;
  private readonly entries = new Map<string, MemoryEntry>();

  increment(
    key: string,
    windowEndsAt: Date | null,
    by = 1,
    now: Date = new Date(),
  ): Promise<CounterReading> {
    this.prune(now);
    const existing = this.entries.get(key);
    const value = (existing?.value ?? 0) + by;
    this.entries.set(key, { value, windowEndsAt });
    return Promise.resolve({ value, ok: true });
  }

  read(key: string, now: Date = new Date()): Promise<CounterReading> {
    this.prune(now);
    return Promise.resolve({ value: this.entries.get(key)?.value ?? 0, ok: true });
  }

  /**
   * Keys already carry their period; this only stops the map growing forever.
   *
   * **It sweeps against the caller's clock, never the process clock**
   * (ABC-freemium 2-01 · Ruling 5 point 3). Reading `Date.now()` here made
   * housekeeping silently change a decision: a caller that passed a pinned
   * `now` would write an entry whose window ends "later" by its own clock, and
   * the very next increment would sweep it away because the real clock had
   * already passed that instant. That is a defect in the seam, not in any
   * fixture — in production the two clocks agree, so only a test can see it.
   *
   * The same bug bites two real users on one UTC day: `user-b`'s increment
   * used to delete `user-a`'s live entry whenever the process clock had
   * crossed the shared day boundary that `user-a`'s entry recorded.
   */
  private prune(now: Date = new Date()): void {
    const cutoff = now.getTime();
    for (const [key, entry] of this.entries) {
      if (entry.windowEndsAt && entry.windowEndsAt.getTime() <= cutoff) {
        this.entries.delete(key);
      }
    }
  }
}

// ── The Supabase implementation ──────────────────────────────────────────────

interface SupabaseRpcResult {
  data: unknown;
  error: unknown;
}

interface SupabaseCounterSelect {
  eq(column: string, value: string): {
    maybeSingle(): Promise<{ data: { value: unknown } | null; error: unknown }>;
  };
}

export interface CounterSupabaseClient {
  rpc(fn: string, args: Record<string, unknown>): Promise<SupabaseRpcResult>;
  from(table: string): { select(columns: string): SupabaseCounterSelect };
}

/**
 * The same predicate `pool-cache-supabase.ts` uses. **R-METER-4's selection rule
 * is the env pair, not `NODE_ENV`** — "never selected when Supabase is present"
 * is a statement about configuration, and `pool-cache-runtime.ts`'s
 * `NODE_ENV === "development"` test would pick the fallback on a developer
 * machine that *does* have Supabase configured.
 */
function configuredAdminClient(): CounterSupabaseClient | null {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return null;
  }
  try {
    return createAdminClient() as unknown as CounterSupabaseClient;
  } catch {
    return null;
  }
}

let warnedOnce = false;

function warnOnce(error: unknown): void {
  if (warnedOnce) return;
  warnedOnce = true;
  console.warn(
    "[usage] counter store unreachable; rate limits fail open and breakers fail closed",
    error instanceof Error ? error.message : error,
  );
}

/**
 * **This store has no clock and needs none** (ABC-freemium 2-01). It sweeps
 * nothing: `increment` only serialises the `windowEndsAt` it was handed, `read`
 * is a plain select, and `increment_usage_counter` in the migration calls
 * `now()` only for `updated_at`. Nothing here compares `window_ends_at` against
 * anything to decide anything, so the `now` parameter of `CounterStore` is
 * deliberately not declared on these two methods — TypeScript allows an
 * implementation to omit trailing parameters, and declaring an argument this
 * class ignores would suggest a clock dependency that does not exist. If a
 * later round adds a sweep on the SQL side, take the parameter then.
 */
export class SupabaseCounterStore implements CounterStore {
  readonly label = "supabase" as const;
  private readonly client: CounterSupabaseClient | null;

  constructor(client?: CounterSupabaseClient | null) {
    this.client = client === undefined ? configuredAdminClient() : client;
  }

  async increment(
    key: string,
    windowEndsAt: Date | null,
    by = 1,
  ): Promise<CounterReading> {
    if (!this.client) return { value: 0, ok: false };
    try {
      const { data, error } = await this.client.rpc("increment_usage_counter", {
        p_key: key,
        p_window_ends_at: windowEndsAt ? windowEndsAt.toISOString() : null,
        p_by: by,
      });
      if (error) {
        warnOnce(error);
        return { value: 0, ok: false };
      }
      const value = Number(data);
      if (!Number.isFinite(value)) return { value: 0, ok: false };
      return { value, ok: true };
    } catch (error) {
      warnOnce(error);
      return { value: 0, ok: false };
    }
  }

  async read(key: string): Promise<CounterReading> {
    if (!this.client) return { value: 0, ok: false };
    try {
      const { data, error } = await this.client
        .from("usage_counters")
        .select("value")
        .eq("key", key)
        .maybeSingle();
      if (error) {
        warnOnce(error);
        return { value: 0, ok: false };
      }
      return { value: Number(data?.value ?? 0), ok: true };
    } catch (error) {
      warnOnce(error);
      return { value: 0, ok: false };
    }
  }
}

// ── Selection ────────────────────────────────────────────────────────────────

let defaultStore: CounterStore | undefined;

/**
 * R-METER-4 — Supabase whenever it is configured, the labelled in-memory
 * fallback otherwise. Memoised once, following `pool-cache-runtime.ts`.
 */
export function getCounterStore(): CounterStore {
  if (!defaultStore) {
    defaultStore =
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
        ? new SupabaseCounterStore()
        : new InMemoryCounterStore();
  }
  return defaultStore;
}

/** Drop the memoised choice. Tests only — the env pair is stubbed per case. */
export function resetCounterStoreForTests(): void {
  defaultStore = undefined;
  warnedOnce = false;
}

// ── The two failure rules, as helpers so nobody hand-rolls them ──────────────

/**
 * Rate limits: **fail open.** An unreadable counter is treated as under the
 * limit — see the module header for why an outage must not 429 every user.
 */
export function underLimit(reading: CounterReading, limit: number): boolean {
  if (!reading.ok) return true;
  return reading.value <= limit;
}

/**
 * Breakers: **fail closed.** An unreadable counter is treated as tripped, so a
 * wallet that cannot be read is not spent. The caller degrades to the existing
 * no-LLM path — never an error.
 */
export function breakerTripped(
  reading: CounterReading,
  limit: number,
): boolean {
  if (!reading.ok) return true;
  return reading.value > limit;
}

/**
 * The durable trace of a counter-store outage (ABC-freemium 2-02 · Ruling 6
 * point 1).
 *
 * **This is the ONLY writer of this line, for every caller.** It lives here
 * rather than inside `deep-report-quota.ts` because `rebuild-breaker.ts` needs
 * the identical line and both modules already import this one — two private
 * copies is exactly how the prefix drifts, which is the drift the single-writer
 * rule exists to prevent.
 *
 * Three things it deliberately is **not**:
 *
 *  - **Not `warnOnce` above.** That is the store's own diagnostic: `console.warn`
 *    rather than error level, a different text, and once per process. A
 *    once-per-process flag would make an occurrence count meaningless.
 *  - **Not a `usage_events` row.** Ruling 6 point 1: a `kind: "breaker"` row
 *    means "a cap tripped", and on an outage none did. Writing one injects a
 *    false trip into the owner's audit trail for a call that spent nothing.
 *    The `kind` check on the table admits only `llm | search | breaker`, so
 *    the log line is the durable trace this round. A later migration may add
 *    an `'outage'` kind and bring the row back honestly.
 *  - **Not throttled or deduplicated.** One line per outage-affected decision,
 *    so occurrences can be counted.
 *
 * The prefix `[quota] store unavailable` is stable and is what a reviewer
 * greps for; keep it byte-for-byte.
 */
export function logStoreUnavailable(path: string, userId: string): void {
  console.error(
    `[quota] store unavailable for ${path} (user ${userId}); the allowance is unchanged and nothing was spent`,
  );
}
