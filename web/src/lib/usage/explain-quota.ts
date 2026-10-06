/**
 * What an "Explain this?" turn costs, and who may still ask for one today.
 *
 * P3-02c · ruling §1h.4 (amendment of 08:1xZ 2026-10-06) · user decision §1a.10 /
 * §1a.11: every explain turn — the first answer and each reply in a thread — is
 * charged, and a turn that searches the web costs ten times a plain one.
 *
 * **A parallel counter, in tenths of a deep-report unit.** The deep-report
 * counters are integers in units and their tests pin them, so a fraction on that
 * consumer would have changed a mechanism that is not this item's. This is its
 * own counter beside them: one tenth for a turn, ten (a whole unit) for a turn
 * that searches. The prices are the manager's placeholders from the cost estimate
 * given to the user in chat; they are re-set by a dated amendment once real token
 * counts exist (the route's debug line records the sizes and `tenths` for that).
 *
 * **Two caps, both on the UTC day, both incremented on every charge**, so either
 * can refuse and each stays true on a day nobody trips the other:
 *
 *  - per reader, `EXPLAIN_TENTHS_PER_DAY`, key `explain_tenths:<user>:<day>`;
 *  - across every reader, `ALL_USERS_EXPLAIN_TENTHS_PER_DAY` — the house ceiling,
 *    key `explain_tenths:house:<day>`. A round number rather than a computed
 *    budget, for the reason the deep-report ceiling is one: a good day costs a
 *    known amount.
 *
 * **Every plan is charged the same**, a reader on their own key included, as the
 * report route does: the allowance is about what Peer's page spends and what one
 * reader may ask of it in a day, not about whose key answered. Nothing in the
 * entitlement but the user id is read.
 *
 * **It fails CLOSED, and says so truthfully** (§1g.14, the outage principle). An
 * unreadable counter refuses the turn with reason `unavailable` — never
 * `exhausted`: the reader is told nothing was spent, because nothing was — and
 * writes the one stable `[quota] store unavailable` line and NO usage row (a
 * `breaker` row means a cap tripped, and on an outage none did). A real trip
 * writes the error line and the awaited breaker row, as the deep-report breakers
 * do. No user id means no allowance: refused as `exhausted`, without touching the
 * store.
 *
 * **A refused charge takes nothing.** The counters are incremented first and read
 * after, so two tabs cannot both see room (the same atomic shape as the
 * deep-report counters); when the reading says no, the tenths that were just added
 * are taken back out. Without that, a searched turn refused at 395 would leave the
 * counter at 405 and shut out the five normal turns the reader still has.
 *
 * Called by the explain route after the owner checks, the gate, the provider check
 * and the memory (a hit costs nothing), and before the model is asked. A refusal
 * inside the model's call still costs — the report route's rule.
 */
import type { Entitlement } from "@/lib/entitlement/types";
import {
  breakerTripped,
  endOfUtcDay,
  getCounterStore,
  logStoreUnavailable,
  type CounterReading,
} from "./counters";
import { recordUsageEventAwaited } from "./events";

/** A normal turn: one tenth of a deep-report unit. */
export const EXPLAIN_TURN_TENTHS = 1;
/** A turn that searched the web: ten tenths — a whole unit. */
export const EXPLAIN_SEARCH_TENTHS = 10;
/**
 * One reader's day, in tenths: forty normal turns, or four searched ones, or any
 * mix (§1h.4 amendment 2, 2026-10-06 — the first P3-02c commit had it ten times
 * too large).
 */
export const EXPLAIN_TENTHS_PER_DAY = 40;
/** Every reader's day together, in tenths: two thousand normal turns. */
export const ALL_USERS_EXPLAIN_TENTHS_PER_DAY = 2000;

/** The counter one reader is charged on: one reader, one UTC day. */
export function explainTenthsKey(userId: string, now: Date): string {
  return `explain_tenths:${userId}:${now.toISOString().slice(0, 10)}`;
}

/** The counter every reader is charged on, for the house ceiling: one UTC day. */
export function explainTenthsHouseKey(now: Date): string {
  return `explain_tenths:house:${now.toISOString().slice(0, 10)}`;
}

export type ExplainDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** `exhausted`: a cap said no. `unavailable`: the counter could not be read — nothing was spent. */
      reason: "exhausted" | "unavailable";
      /** ISO instant at which the day's allowance comes back. */
      resetsAt: string;
    };

/**
 * Check and charge one explain turn: `searched` says whether it will search the
 * web. One round trip per counter, so the reading is this call's own.
 */
export async function consumeExplainTurn(
  entitlement: Entitlement,
  { searched }: { searched: boolean },
  now: Date = new Date(),
): Promise<ExplainDecision> {
  const end = endOfUtcDay(now);
  const resetsAt = end.toISOString();
  const refused = (reason: "exhausted" | "unavailable"): ExplainDecision => ({ allowed: false, reason, resetsAt });

  const userId = entitlement.userId;
  // No user, no allowance — and nothing unavailable about it: it never reaches
  // the store (the same reading as the deep-report counter's no-user branch).
  if (!userId) return refused("exhausted");

  const tenths = searched ? EXPLAIN_SEARCH_TENTHS : EXPLAIN_TURN_TENTHS;
  const store = getCounterStore();
  const userKey = explainTenthsKey(userId, now);
  const houseKey = explainTenthsHouseKey(now);

  const reading = await store.increment(userKey, end, tenths, now);
  const houseReading = await store.increment(houseKey, end, tenths, now);

  /** Take back what this call added, to each counter it reached. Best effort: a
   *  counter that cannot be written now fails closed, which is the safe direction. */
  const takeBack = async (): Promise<void> => {
    const added: Array<[string, CounterReading]> = [[userKey, reading], [houseKey, houseReading]];
    for (const [key, result] of added) {
      if (!result.ok) continue;
      try {
        await store.increment(key, end, -tenths, now);
      } catch {
        // Left as it is: the count stays high, never low.
      }
    }
  };

  // An unreadable counter fails CLOSED and is called an outage (§1g.14): the
  // reader is told nothing was spent, and no usage row says a cap tripped.
  if (!reading.ok || !houseReading.ok) {
    logStoreUnavailable("explain", userId);
    await takeBack();
    return refused("unavailable");
  }

  // The house first, as the deep-report counter does: a ceiling that is spent
  // refuses everyone, whatever their own count says.
  if (breakerTripped(houseReading, ALL_USERS_EXPLAIN_TENTHS_PER_DAY)) {
    console.error(`[quota] HOUSE explain breaker tripped (limit ${ALL_USERS_EXPLAIN_TENTHS_PER_DAY} tenths/day, all readers)`);
    await takeBack();
    await recordUsageEventAwaited({ user_id: userId, kind: "breaker", path: "explain-house", ok: false });
    return refused("exhausted");
  }
  if (breakerTripped(reading, EXPLAIN_TENTHS_PER_DAY)) {
    console.error(`[quota] explain breaker tripped for a reader (limit ${EXPLAIN_TENTHS_PER_DAY} tenths/day)`);
    await takeBack();
    await recordUsageEventAwaited({ user_id: userId, kind: "breaker", path: "explain", ok: false });
    return refused("exhausted");
  }
  return { allowed: true };
}
