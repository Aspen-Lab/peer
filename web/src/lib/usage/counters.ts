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
 *  - **Breakers FAIL CLOSED.** The daily caps (the test-email and confirm-email
 *    sends) exist to protect what Peer itself pays for. A budget that cannot be
 *    read must not be spent, so `breakerTripped()` treats an unreadable counter
 *    as tripped and the action is refused.
 *
 * That asymmetry is deliberate and is asserted in `counters.test.ts`. **A
 * Supabase outage therefore refuses those capped actions until the store is
 * back** — that is the trade, written down here so a later round reports it as
 * a design decision rather than as a defect.
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

/** `rate:<scope>:<user>:<YYYY-MM-DDTHH>` — the replacement for the old bucket. */
export function rateKey(scope: string, userId: string, now: Date): string {
  return `rate:${scope}:${userId}:${utcHourSegment(now)}`;
}

/**
 * EMAIL-SETTINGS · ABC-JEV-INTEGRATION.md §1z P1 — the "Send test email"
 * button's own per-user daily cap (3/day), a UTC-day key. **Fails CLOSED**
 * (`breakerTripped`, not `underLimit`): this exists to protect the send budget
 * and stop the button being used to spam, which the manager ruled fails closed,
 * unlike the ordinary UX rate limit.
 */
export function testEmailDayKey(userId: string, now: Date): string {
  return `test_email:${userId}:${utcDaySegment(now)}`;
}

/**
 * EMAIL-SETTINGS · ABC-JEV-INTEGRATION.md §1z P1/P3 — the confirm-a-new-
 * address request's own per-user daily cap (5/day, one higher than the test
 * email's 3 because this reaches an arbitrary address the user types, a
 * bigger abuse surface). Same shape and **fails CLOSED**, same reasoning as
 * `testEmailDayKey` above.
 */
export function confirmEmailRequestDayKey(userId: string, now: Date): string {
  return `confirm_email:${userId}:${utcDaySegment(now)}`;
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
 * budget that cannot be read is not spent. The caller refuses the capped
 * action (a send, a call) rather than letting it through.
 */
export function breakerTripped(
  reading: CounterReading,
  limit: number,
): boolean {
  if (!reading.ok) return true;
  return reading.value > limit;
}
