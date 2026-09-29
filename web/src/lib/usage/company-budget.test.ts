import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { InMemoryCounterStore, endOfUtcDay } from "@/lib/usage/counters";
import { jevGlobalDayKey, jevPerUserDayKey, reserveJevCall } from "@/lib/security/jev-broker-auth";
import { GEMINI_API_MODEL_CHAIN } from "@/lib/llm/providers/gemini";
import {
  CompanySpendCapRefusedError,
  DEFAULT_GLOBAL_DAILY_USD,
  DEFAULT_PER_USER_DAILY_USD,
  DIGEST_MAX_OUTPUT_TOKENS,
  companySpendCapEnabled,
  companySpendGlobalDayKey,
  companySpendPerUserDayKey,
  estimateCompanySpend,
  microUsdForTokens,
  readCompanyBudgetConfig,
  recordCompanySpendAttempt,
  reserveCompanySpend,
  resetCompanyBudgetConfigCacheForTests,
  settleCompanySpend,
  type CompanyBudgetSupabaseClient,
  type CompanyModelPrice,
  type CompanySpendCapsConfig,
  type CompanySpendReservation,
} from "./company-budget";

/**
 * SPEND-CAP (ABC-JEV-INTEGRATION.md §1v). The guide's §3 RED list plus the
 * rulings' protective tests, against `reserveCompanySpend`/
 * `readCompanyBudgetConfig`/`estimateCompanySpend`/`settleCompanySpend`
 * directly — the pure/unit level the guide asks for, mirroring
 * `security/jev-broker-auth.test.ts`'s own shape for the concurrency/ordering
 * cases. `metered.test.ts` covers the R9 flag-gate and R10 wiring at the
 * `meterCall` integration level; `app/api/papers/report/route.test.ts` covers
 * R7 (the company_budget quota signal) and RED-list item 14 (the refusal
 * reaching the caller as a thrown error with the existing degrade shape).
 */

const NOW = new Date("2026-09-25T12:00:00.000Z");

const FLAT_PRICE: CompanyModelPrice = { inputPerM: 1, outputPerM: 1, visionTokensPerImage: 100 };

function priceMap(entries: Record<string, CompanyModelPrice>): Map<string, CompanyModelPrice> {
  return new Map(Object.entries(entries));
}

/** Every model in the REAL chain, priced flat — avoids hand-typed model ids drifting from the real chain. */
function fourModelPrices(): Map<string, CompanyModelPrice> {
  const map = new Map<string, CompanyModelPrice>();
  for (const target of GEMINI_API_MODEL_CHAIN) map.set(target.id, FLAT_PRICE);
  return map;
}

function fakeClient(opts: {
  capsRows?: Array<{ cap_key: string; amount_usd: unknown }>;
  priceRows?: Array<{
    model_id: string;
    input_usd_per_million_tokens: unknown;
    output_usd_per_million_tokens: unknown;
    vision_tokens_per_image?: unknown;
  }>;
  error?: unknown;
}): CompanyBudgetSupabaseClient {
  return {
    from: (table: unknown) => ({
      select: async () => {
        if (opts.error) return { data: null, error: opts.error };
        if (table === "company_spend_caps") return { data: opts.capsRows ?? [], error: null };
        return { data: opts.priceRows ?? [], error: null };
      },
    }),
  } as unknown as CompanyBudgetSupabaseClient;
}

const FLAT_CAPS: CompanySpendCapsConfig = { globalDailyMicroUsd: 1_000_000, perUserDailyMicroUsd: 1_000_000 };

beforeEach(() => resetCompanyBudgetConfigCacheForTests());

// ── Key layout ───────────────────────────────────────────────────────────────

describe("companySpendPerUserDayKey / companySpendGlobalDayKey", () => {
  it("match company_spend:<userId>:<UTC-day> / company_spend:all:<UTC-day> — disjoint from every existing prefix", () => {
    expect(companySpendPerUserDayKey("user-a", NOW)).toBe("company_spend:user-a:2026-09-25");
    expect(companySpendGlobalDayKey(NOW)).toBe("company_spend:all:2026-09-25");
  });
});

// ── R9 — the master switch ───────────────────────────────────────────────────

describe("companySpendCapEnabled — R9, literal 'on' only", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("empty/unset -> false, the default", () => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", "");
    expect(companySpendCapEnabled()).toBe(false);
  });

  it.each(["true", "1", "yes", "ON!", "onn"])("%s -> false (only the exact literal counts)", (value) => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", value);
    expect(companySpendCapEnabled()).toBe(false);
  });

  it.each(["on", "On", " on ", "ON"])("%s -> true (trimmed + lower-cased)", (value) => {
    vi.stubEnv("PEER_COMPANY_SPEND_CAP", value);
    expect(companySpendCapEnabled()).toBe(true);
  });
});

// ── RED list item 1 + R2 + item 13 — reserveCompanySpend concurrency/ordering ─

describe("reserveCompanySpend — concurrency, ordering, over-reservation (guide items 1 & 13)", () => {
  it("two concurrent reservations at the cap edge: exactly one succeeds, and the final counter is the SUM of both attempts, not just the winner's amount and not capped at the limit", async () => {
    // Guide's own worked numbers (cap 100, two reservations of 60, "final
    // counter value must be exactly 160") don't add up on their own terms
    // (60+60=120) — read as a typo, not a spec to satisfy literally. This
    // tests the same PROPERTY with internally consistent numbers: an
    // over-reservation is never rolled back (mirrors `reserveJevCall`'s own
    // "DESIGN CHOICE" precedent), so the final value is the sum of every
    // attempt, win or lose — never less (nothing silently dropped), never
    // more (no double count).
    const store = new InMemoryCounterStore();
    const caps: CompanySpendCapsConfig = { globalDailyMicroUsd: 1_000_000, perUserDailyMicroUsd: 100 };

    const results = await Promise.all([
      reserveCompanySpend("user-a", 60, caps, NOW, store),
      reserveCompanySpend("user-a", 60, caps, NOW, store),
    ]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.filter((r) => !r.ok);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toMatchObject({ reason: "per_user_cap_exceeded" });
    await expect(store.read(companySpendPerUserDayKey("user-a", NOW), NOW)).resolves.toEqual({ value: 120, ok: true });
  });

  it("reserves the per-user counter strictly before the global counter (call-order proof)", async () => {
    const store = new InMemoryCounterStore();
    const order: string[] = [];
    vi.spyOn(store, "increment").mockImplementation(async (key: string, windowEndsAt, by, now) => {
      order.push(key.startsWith("company_spend:all:") ? "global" : "perUser");
      return InMemoryCounterStore.prototype.increment.call(store, key, windowEndsAt, by, now);
    });

    await reserveCompanySpend("user-a", 10, FLAT_CAPS, NOW, store);

    expect(order).toEqual(["perUser", "global"]);
  });

  it("when the per-user reservation refuses, the global counter's increment is never even called", async () => {
    const store = new InMemoryCounterStore();
    const caps: CompanySpendCapsConfig = { globalDailyMicroUsd: 1_000_000, perUserDailyMicroUsd: 10 };
    await reserveCompanySpend("user-a", 10, caps, NOW, store); // exactly consumes the per-user cap
    const incrementSpy = vi.spyOn(store, "increment");

    const result = await reserveCompanySpend("user-a", 1, caps, NOW, store);

    expect(result).toEqual({ ok: false, reason: "per_user_cap_exceeded" });
    expect(incrementSpy).toHaveBeenCalledTimes(1);
    expect(incrementSpy).toHaveBeenCalledWith(
      companySpendPerUserDayKey("user-a", NOW),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("refuses once the global cap is exceeded, and still increments the per-user counter (accepted over-reservation, no rollback)", async () => {
    const store = new InMemoryCounterStore();
    const caps: CompanySpendCapsConfig = { globalDailyMicroUsd: 1, perUserDailyMicroUsd: 1_000_000 };
    const first = await reserveCompanySpend("user-a", 1, caps, NOW, store);
    const second = await reserveCompanySpend("user-b", 1, caps, NOW, store);

    expect(first).toEqual({ ok: true, reservation: expect.objectContaining({ reservedMicroUsd: 1 }) });
    expect(second).toEqual({ ok: false, reason: "global_cap_exceeded" });
    await expect(store.read(companySpendPerUserDayKey("user-b", NOW), NOW)).resolves.toEqual({ value: 1, ok: true });
  });

  it("fails closed when the counter store is entirely unreadable", async () => {
    const store = new InMemoryCounterStore();
    vi.spyOn(store, "increment").mockResolvedValue({ value: 0, ok: false });
    const result = await reserveCompanySpend("user-a", 10, FLAT_CAPS, NOW, store);
    expect(result).toEqual({ ok: false, reason: "counter_unreadable" });
  });

  it("day rollover: a fresh counter after UTC midnight, not cumulative with the prior day", async () => {
    const store = new InMemoryCounterStore();
    const lateNight = new Date("2026-09-25T23:59:59.999Z");
    const nextDay = new Date("2026-09-26T00:00:01.000Z");
    const caps: CompanySpendCapsConfig = { globalDailyMicroUsd: 1_000_000, perUserDailyMicroUsd: 900 };

    const first = await reserveCompanySpend("user-a", 900, caps, lateNight, store);
    const second = await reserveCompanySpend("user-a", 900, caps, nextDay, store);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true); // would refuse on the SAME day; a new UTC day is a fresh counter
    expect(companySpendPerUserDayKey("user-a", lateNight)).not.toBe(companySpendPerUserDayKey("user-a", nextDay));
  });
});

// ── R2 — the one no-owner call site ───────────────────────────────────────────

describe("R2 — a userId-null reservation touches the global key ONLY, never any per-user key", () => {
  it("increment is called exactly once, against the global key", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");

    const result = await reserveCompanySpend(null, 10, FLAT_CAPS, NOW, store);

    expect(result.ok).toBe(true);
    expect(incrementSpy).toHaveBeenCalledTimes(1);
    expect(incrementSpy).toHaveBeenCalledWith(
      companySpendGlobalDayKey(NOW),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it("the reservation's own perUserKey is null", async () => {
    const store = new InMemoryCounterStore();
    const result = await reserveCompanySpend(null, 10, FLAT_CAPS, NOW, store);
    expect(result.ok && result.reservation.perUserKey).toBeNull();
  });

  it("a refusal on the global cap still reports global_cap_exceeded, never a per-user reason, for a null owner", async () => {
    const store = new InMemoryCounterStore();
    const caps: CompanySpendCapsConfig = { globalDailyMicroUsd: 1, perUserDailyMicroUsd: 1_000_000 };
    const result = await reserveCompanySpend(null, 10, caps, NOW, store);
    expect(result).toEqual({ ok: false, reason: "global_cap_exceeded" });
  });
});

// ── RED list items 2-4 — readCompanyBudgetConfig's three-outcome table ──────

describe("readCompanyBudgetConfig — the three-outcome table (§2.2)", () => {
  it("client unreachable (null) -> ok:false, NEVER the documented default", async () => {
    const result = await readCompanyBudgetConfig(NOW, null);
    expect(result).toEqual({ ok: false });
  });

  it("the underlying query throwing -> ok:false", async () => {
    const throwing: CompanyBudgetSupabaseClient = {
      from: () => ({
        select: () => {
          throw new Error("boom");
        },
      }),
    } as unknown as CompanyBudgetSupabaseClient;
    const result = await readCompanyBudgetConfig(NOW, throwing);
    expect(result).toEqual({ ok: false });
  });

  it("a query-level error object -> ok:false", async () => {
    const result = await readCompanyBudgetConfig(NOW, fakeClient({ error: new Error("supabase down") }));
    expect(result).toEqual({ ok: false });
  });

  it("both tables genuinely empty (rows absent) -> the documented $5.00/$0.50 defaults — a DIFFERENT code path from case 2, not the same 'unreadable' branch", async () => {
    const result = await readCompanyBudgetConfig(NOW, fakeClient({ capsRows: [], priceRows: [] }));
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.caps.globalDailyMicroUsd).toBe(Math.round(DEFAULT_GLOBAL_DAILY_USD * 1_000_000));
    expect(result.config.caps.perUserDailyMicroUsd).toBe(Math.round(DEFAULT_PER_USER_DAILY_USD * 1_000_000));
    expect(result.config.prices.size).toBe(0);
  });

  it("a stored, valid cap row is used as-is", async () => {
    const result = await readCompanyBudgetConfig(
      NOW,
      fakeClient({ capsRows: [{ cap_key: "global_daily_usd", amount_usd: 30 }, { cap_key: "per_user_daily_usd", amount_usd: 1.5 }] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.caps.globalDailyMicroUsd).toBe(30_000_000);
    expect(result.config.caps.perUserDailyMicroUsd).toBe(1_500_000);
  });

  it("item 4a — a negative amount_usd reaching the JS layer (bypassing the DB constraint) is treated as unreadable, not clamped or silently used", async () => {
    const result = await readCompanyBudgetConfig(NOW, fakeClient({ capsRows: [{ cap_key: "global_daily_usd", amount_usd: -5 }] }));
    expect(result).toEqual({ ok: false });
  });

  it("item 4b — a NaN amount_usd reaching the JS layer is treated as unreadable", async () => {
    const result = await readCompanyBudgetConfig(NOW, fakeClient({ capsRows: [{ cap_key: "per_user_daily_usd", amount_usd: Number.NaN }] }));
    expect(result).toEqual({ ok: false });
  });

  it("item 4c — an absurdly large amount_usd (1e12) does not silently blow the reservation past any sane ceiling — treated as unreadable", async () => {
    const result = await readCompanyBudgetConfig(NOW, fakeClient({ capsRows: [{ cap_key: "per_user_daily_usd", amount_usd: 1e12 }] }));
    expect(result).toEqual({ ok: false });
  });

  it("the same three checks apply to a price row's per-token cost fields", async () => {
    const negative = await readCompanyBudgetConfig(
      NOW,
      fakeClient({ priceRows: [{ model_id: "gemini-3.1-flash-lite", input_usd_per_million_tokens: -1, output_usd_per_million_tokens: 1 }] }),
    );
    expect(negative).toEqual({ ok: false });

    const nan = await readCompanyBudgetConfig(
      NOW,
      fakeClient({
        priceRows: [{ model_id: "gemini-3.1-flash-lite", input_usd_per_million_tokens: 1, output_usd_per_million_tokens: Number.NaN }],
      }),
    );
    expect(nan).toEqual({ ok: false });

    const huge = await readCompanyBudgetConfig(
      NOW,
      fakeClient({ priceRows: [{ model_id: "gemini-3.1-flash-lite", input_usd_per_million_tokens: 1e9, output_usd_per_million_tokens: 1 }] }),
    );
    expect(huge).toEqual({ ok: false });
  });

  it("a valid price row, including a null vision price (a legitimate non-vision model), reads cleanly", async () => {
    const result = await readCompanyBudgetConfig(
      NOW,
      fakeClient({
        priceRows: [
          { model_id: "gemini-3.1-flash-lite", input_usd_per_million_tokens: 0.25, output_usd_per_million_tokens: 1.5, vision_tokens_per_image: null },
        ],
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.config.prices.get("gemini-3.1-flash-lite")).toEqual({ inputPerM: 0.25, outputPerM: 1.5, visionTokensPerImage: null });
  });
});

/**
 * Item 15 — the SQL-level CHECK constraint's own NaN/negative rejection.
 * BLOCKED: no Docker/Supabase CLI/live Postgres instance is reachable from
 * this test environment (confirmed by B's own investigation and re-confirmed
 * here — no local database exists to run these statements against). A human
 * must run the three statements below by hand against a real instance and
 * confirm each one raises a constraint violation; this suite does not, and
 * must not, claim that result without having actually run it.
 */
describe.skip("item 15 — SQL CHECK constraint rejects NaN/negative (BLOCKED — no live Postgres reachable here)", () => {
  it("run by hand: insert into public.company_spend_caps (cap_key, amount_usd) values ('per_user_daily_usd', 'NaN'::numeric); -- expect: constraint violation", () => {});
  it("run by hand: insert into public.company_spend_caps (cap_key, amount_usd) values ('per_user_daily_usd', -1); -- expect: constraint violation", () => {});
  it("run by hand: insert into public.company_model_prices (model_id, input_usd_per_million_tokens, output_usd_per_million_tokens, source_note) values ('x', 'NaN'::numeric, 1, 't'); -- expect: constraint violation", () => {});
});

// ── RED list item 5 — the ≤60s cache ─────────────────────────────────────────

describe("readCompanyBudgetConfig — 60s cache", () => {
  it("stays cached at 59s, refetches past 61s", async () => {
    let selects = 0;
    const client: CompanyBudgetSupabaseClient = {
      from: () => ({
        select: async () => {
          selects += 1;
          return { data: [], error: null };
        },
      }),
    } as unknown as CompanyBudgetSupabaseClient;

    await readCompanyBudgetConfig(NOW, client);
    expect(selects).toBe(2); // one select per table on the first real fetch

    await readCompanyBudgetConfig(new Date(NOW.getTime() + 59_000), client);
    expect(selects).toBe(2); // still cached

    await readCompanyBudgetConfig(new Date(NOW.getTime() + 61_000), client);
    expect(selects).toBe(4); // refetched: one select per table again
  });
});

// ── The estimator ─────────────────────────────────────────────────────────────

describe("estimateCompanySpend", () => {
  it("an unrecognized provider id fails closed rather than silently pricing at $0 (item 12)", () => {
    const result = estimateCompanySpend({ method: "json", systemPrompt: "s", userPrompt: "u", maxTokens: 100 }, "anthropic", fourModelPrices());
    expect(result).toEqual({ ok: false, reason: "unrecognized_provider" });
  });

  it("digest: sums the worst case across the FULL chain (no tier filter applies to generateDigest)", () => {
    const result = estimateCompanySpend({ method: "digest", papers: [{ id: "p1" }], contextHint: "ctx" }, "gemini", fourModelPrices());
    expect(result.ok).toBe(true);
  });

  it("a tiered json call sums across fewer models than an untiered one", () => {
    const prices = fourModelPrices();
    const small = estimateCompanySpend(
      { method: "json", systemPrompt: "s", userPrompt: "u", maxTokens: 100, tier: "small" },
      "gemini",
      prices,
    );
    const untiered = estimateCompanySpend({ method: "json", systemPrompt: "s", userPrompt: "u", maxTokens: 100 }, "gemini", prices);
    expect(small.ok && untiered.ok).toBe(true);
    if (small.ok && untiered.ok) expect(small.microUsd).toBeLessThan(untiered.microUsd);
  });

  it("escape clause — no maxTokens on a json/vision call has no honest ceiling, fails closed as unestimable_call rather than guessing", () => {
    const result = estimateCompanySpend({ method: "json", systemPrompt: "s", userPrompt: "u" }, "gemini", fourModelPrices());
    expect(result).toEqual({ ok: false, reason: "unestimable_call" });
  });

  it("escape clause — test-connection has no bounded output and no measurable input, fails closed as unestimable_call (recorded as POLICY, not built)", () => {
    const result = estimateCompanySpend({ method: "test-connection" }, "gemini", fourModelPrices());
    expect(result).toEqual({ ok: false, reason: "unestimable_call" });
  });

  it("a vision call against a chain model with no configured vision price fails closed with price_unreadable", () => {
    const prices = fourModelPrices();
    const [firstId] = [...prices.keys()];
    prices.set(firstId, { ...(prices.get(firstId) as CompanyModelPrice), visionTokensPerImage: null });
    const result = estimateCompanySpend(
      { method: "vision", systemPrompt: "s", userPrompt: "u", maxTokens: 100, imageCount: 2 },
      "gemini",
      prices,
    );
    expect(result).toEqual({ ok: false, reason: "price_unreadable" });
  });

  it("a missing price for any chain model fails closed with price_unreadable, not a partial estimate", () => {
    const prices = fourModelPrices();
    const [firstId] = [...prices.keys()];
    prices.delete(firstId);
    const result = estimateCompanySpend({ method: "json", systemPrompt: "s", userPrompt: "u", maxTokens: 100 }, "gemini", prices);
    expect(result).toEqual({ ok: false, reason: "price_unreadable" });
  });
});

describe("microUsdForTokens", () => {
  it("micro-dollars = tokens x price-per-million directly (rounded up)", () => {
    const price: CompanyModelPrice = { inputPerM: 0.25, outputPerM: 1.5, visionTokensPerImage: null };
    // 65,000 in * 0.25 + 1500 out * 1.5 = 16,250 + 2,250 = 18,500
    expect(microUsdForTokens(price, 65_000, 1500)).toBe(18_500);
  });

  it("rounds up, never under-reserves/under-settles", () => {
    const price: CompanyModelPrice = { inputPerM: 0.3, outputPerM: 0, visionTokensPerImage: null };
    expect(microUsdForTokens(price, 1, 0)).toBe(1); // 0.3 -> ceil -> 1
  });
});

/**
 * DIGEST_MAX_OUTPUT_TOKENS must stay in sync with gemini.ts's own hardcoded
 * `maxTokens: 1500` literal (never passed by the caller, so the estimator
 * cannot read it off `args`) — same "two numbers that must never silently
 * diverge" idiom `spend-scans.test.ts` uses elsewhere in this codebase.
 */
describe("DIGEST_MAX_OUTPUT_TOKENS stays in sync with gemini.ts's own literal", () => {
  it("both generateDigest implementations' inline maxTokens literal equal the exported constant", () => {
    const source = fs.readFileSync(path.join(process.cwd(), "src/lib/llm/providers/gemini.ts"), "utf8");
    const literals = [...source.matchAll(/maxTokens:\s*(\d+),\s*\n\s*path:\s*"digest"/g)].map((m) => Number(m[1]));
    expect(literals).toHaveLength(2); // Vertex provider + reader's-key API provider
    expect(literals.every((n) => n === DIGEST_MAX_OUTPUT_TOKENS)).toBe(true);
  });
});

// ── RED list items 9, 10 + R10 — settlement ──────────────────────────────────

function reservationFor(reservedMicroUsd: number, userId: string | null = "user-a"): CompanySpendReservation {
  return {
    reservedMicroUsd,
    perUserKey: userId ? companySpendPerUserDayKey(userId, NOW) : null,
    globalKey: companySpendGlobalDayKey(NOW),
    settlement: { actualMicroUsdSum: 0, attemptsSeen: 0, allReported: true },
  };
}

async function seedReservation(store: InMemoryCounterStore, reservation: CompanySpendReservation): Promise<void> {
  await store.increment(reservation.globalKey, endOfUtcDay(NOW), reservation.reservedMicroUsd, NOW);
  if (reservation.perUserKey) await store.increment(reservation.perUserKey, endOfUtcDay(NOW), reservation.reservedMicroUsd, NOW);
}

describe("settleCompanySpend (R10 — settle ONCE, after every attempt has already accumulated)", () => {
  it("item 9 — settle with missing usage keeps the full reservation, no refund fires", async () => {
    const store = new InMemoryCounterStore();
    const reservation = reservationFor(10_000);
    await seedReservation(store, reservation);

    recordCompanySpendAttempt(reservation, { model: "gemini-3.1-flash-lite", inputTokens: undefined, outputTokens: undefined }, fourModelPrices());
    await settleCompanySpend(reservation, NOW, store);

    await expect(store.read(reservation.perUserKey!, NOW)).resolves.toEqual({ value: 10_000, ok: true });
    await expect(store.read(reservation.globalKey, NOW)).resolves.toEqual({ value: 10_000, ok: true });
  });

  it("item 10 — settle with real usage refunds exactly reserved-minus-actual, never below actual", async () => {
    const store = new InMemoryCounterStore();
    const price: CompanyModelPrice = { inputPerM: 1, outputPerM: 1, visionTokensPerImage: null };
    const prices = priceMap({ "gemini-3.1-flash-lite": price });
    const reservation = reservationFor(1000);
    await seedReservation(store, reservation);

    recordCompanySpendAttempt(reservation, { model: "gemini-3.1-flash-lite", inputTokens: 100, outputTokens: 50 }, prices); // actual = 150
    await settleCompanySpend(reservation, NOW, store);

    await expect(store.read(reservation.perUserKey!, NOW)).resolves.toEqual({ value: 150, ok: true });
    await expect(store.read(reservation.globalKey, NOW)).resolves.toEqual({ value: 150, ok: true });
  });

  it("R10 — accumulates across MULTIPLE chain attempts and settles the SUM once", async () => {
    const store = new InMemoryCounterStore();
    const price: CompanyModelPrice = { inputPerM: 1, outputPerM: 1, visionTokensPerImage: null };
    const prices = priceMap({ "model-a": price, "model-b": price });
    const reservation = reservationFor(1000);
    await seedReservation(store, reservation);

    recordCompanySpendAttempt(reservation, { model: "model-a", inputTokens: 40, outputTokens: 10 }, prices); // 50
    recordCompanySpendAttempt(reservation, { model: "model-b", inputTokens: 60, outputTokens: 20 }, prices); // 80
    expect(reservation.settlement.attemptsSeen).toBe(2);
    expect(reservation.settlement.actualMicroUsdSum).toBe(130);

    await settleCompanySpend(reservation, NOW, store);

    await expect(store.read(reservation.perUserKey!, NOW)).resolves.toEqual({ value: 130, ok: true }); // 1000 - (1000-130) refund = 130
  });

  it("R10 — ONE attempt with missing usage among several reported ones latches allReported false for the WHOLE reservation, so nothing refunds", async () => {
    const store = new InMemoryCounterStore();
    const price: CompanyModelPrice = { inputPerM: 1, outputPerM: 1, visionTokensPerImage: null };
    const prices = priceMap({ "model-a": price, "model-b": price });
    const reservation = reservationFor(1000);
    await seedReservation(store, reservation);

    recordCompanySpendAttempt(reservation, { model: "model-a", inputTokens: undefined, outputTokens: undefined }, prices); // threw before usageMetadata
    recordCompanySpendAttempt(reservation, { model: "model-b", inputTokens: 60, outputTokens: 20 }, prices); // succeeded

    await settleCompanySpend(reservation, NOW, store);

    await expect(store.read(reservation.perUserKey!, NOW)).resolves.toEqual({ value: 1000, ok: true }); // unchanged
  });

  it("settlement of a userId-null reservation only ever touches the global key", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");
    const price: CompanyModelPrice = { inputPerM: 1, outputPerM: 1, visionTokensPerImage: null };
    const reservation = reservationFor(1000, null);
    recordCompanySpendAttempt(reservation, { model: "gemini-3.1-flash-lite", inputTokens: 10, outputTokens: 10 }, priceMap({ "gemini-3.1-flash-lite": price }));

    await settleCompanySpend(reservation, NOW, store);

    expect(incrementSpy).toHaveBeenCalledTimes(1);
    expect(incrementSpy).toHaveBeenCalledWith(reservation.globalKey, expect.anything(), expect.anything(), expect.anything());
  });

  it("zero attempts seen (fn threw before any chain attempt logged anything) keeps the full reservation", async () => {
    const store = new InMemoryCounterStore();
    const reservation = reservationFor(500);
    await seedReservation(store, reservation);

    await settleCompanySpend(reservation, NOW, store);

    await expect(store.read(reservation.globalKey, NOW)).resolves.toEqual({ value: 500, ok: true });
  });
});

// ── RED list item 8 — no double counting with the Jev path ──────────────────

describe("no double counting with the Jev path (guide item 8)", () => {
  it("a company-spend reservation never touches any jev:*/jev-gemini:* key", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");

    await reserveCompanySpend("user-a", 100, FLAT_CAPS, NOW, store);

    const keys = incrementSpy.mock.calls.map(([key]) => String(key));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("company_spend:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("jev:") || k.startsWith("jev-gemini:"))).toBe(false);
  });

  it("a reserveJevCall reservation never touches any company_spend:* key", async () => {
    const store = new InMemoryCounterStore();
    const incrementSpy = vi.spyOn(store, "increment");

    await reserveJevCall("user-a", { perUserCap: 100, globalCap: 100, now: NOW, store });

    const keys = incrementSpy.mock.calls.map(([key]) => String(key));
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k.startsWith("jev:"))).toBe(true);
    expect(keys.some((k) => k.startsWith("company_spend:"))).toBe(false);
    // Sanity: the two namespaces' own key builders never collide either.
    expect(jevPerUserDayKey("user-a", NOW)).not.toBe(companySpendPerUserDayKey("user-a", NOW));
    expect(jevGlobalDayKey(NOW)).not.toBe(companySpendGlobalDayKey(NOW));
  });
});

// ── CompanySpendCapRefusedError ───────────────────────────────────────────────

describe("CompanySpendCapRefusedError", () => {
  it("carries the refusal reason and a real Error identity so every existing catch(err) still catches it", () => {
    const err = new CompanySpendCapRefusedError("global_cap_exceeded");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CompanySpendCapRefusedError");
    expect(err.reason).toBe("global_cap_exceeded");
  });
});
