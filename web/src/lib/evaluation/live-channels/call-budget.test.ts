import { describe, expect, it, vi } from "vitest";
import { CallBudget, trackedCall, type ClockFn, type SleepFn } from "./call-budget";

// LIVE-EVAL-4-FIX: a virtual clock so the cool-off/retry/pacing tests below
// (which involve real 3s/60s waits in production) run instantly and
// deterministically. `sleep(ms)` advances the same counter `now()` reads —
// i.e. it behaves like real time elapsing, just without an actual wait —
// so the pacing/cool-off arithmetic under test is exercised exactly as it
// would be live, and every wait the code under test asks for is visible in
// `sleepCalls` for exact assertions.
function createVirtualClock(): { sleep: SleepFn; now: ClockFn; sleepCalls: number[] } {
  let current = 0;
  const sleepCalls: number[] = [];
  const sleep: SleepFn = async (ms) => {
    sleepCalls.push(ms);
    current += ms;
  };
  const now: ClockFn = () => current;
  return { sleep, now, sleepCalls };
}

describe("CallBudget ceiling", () => {
  it("stops making calls at exactly the ceiling and marks the rest not_run, without ever calling the adapter a ceiling+1th time", async () => {
    const budget = new CallBudget({ ceiling: 3 });
    const fake = vi.fn(async () => "ok");

    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await trackedCall(budget, "openalex", fake));
    }

    expect(fake).toHaveBeenCalledTimes(3);
    expect(outcomes.slice(0, 3).every((o) => o.status === "ok")).toBe(true);
    expect(outcomes[3]).toMatchObject({
      status: "not_run",
      reason: "call ceiling reached",
    });
    expect(outcomes[4]).toMatchObject({
      status: "not_run",
      reason: "call ceiling reached",
    });
    expect(budget.callsMade).toBe(3);
  });

  it("a ceiling of 0 never attempts any call", async () => {
    const budget = new CallBudget({ ceiling: 0 });
    const fake = vi.fn(async () => "ok");
    const outcome = await trackedCall(budget, "openalex", fake);
    expect(fake).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ status: "not_run", reason: "call ceiling reached" });
  });
});

describe("CallBudget stop-on-429", () => {
  it("stops the run after the first OpenAlex 429 and marks every remaining planned call not_run", async () => {
    const budget = new CallBudget({ ceiling: 150 });
    let n = 0;
    const fake = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("openalex HTTP 429 — rate limited");
      return "ok";
    });

    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await trackedCall(budget, "openalex", fake));
    }

    expect(fake).toHaveBeenCalledTimes(2);
    expect(outcomes[0]).toMatchObject({ status: "ok" });
    expect(outcomes[1]).toMatchObject({ status: "failed" });
    expect(outcomes[2]).toMatchObject({
      status: "not_run",
      reason: "stopped after first OpenAlex 429",
    });
    expect(outcomes[3]).toMatchObject({ status: "not_run" });
    expect(outcomes[4]).toMatchObject({ status: "not_run" });
    expect(budget.stopped?.kind).toBe("openalex-429");
  });

  it(
    "LIVE-EVAL-4-FIX: a single S2 429 no longer stops the run — the contract changed " +
      "(ABC-JEV-INTEGRATION.md §1w AMENDMENT). It now gets a 60s cool-off and ONE retry " +
      "of the SAME call, which is allowed to succeed; the run is never marked stopped.",
    async () => {
      const clock = createVirtualClock();
      const budget = new CallBudget({ ceiling: 150, sleep: clock.sleep, now: clock.now });
      let n = 0;
      const fake = vi.fn(async () => {
        n += 1;
        if (n === 1) throw new Error("semantic_scholar HTTP 429 — rate limited");
        return "ok";
      });

      const outcome = await trackedCall(budget, "semantic_scholar", fake);

      expect(fake).toHaveBeenCalledTimes(2); // the original attempt + one retry
      expect(outcome).toMatchObject({ status: "ok", value: "ok" });
      expect(clock.sleepCalls).toEqual([60_000]); // the one 60s cool-off; no 3s pacing wait before the very first S2 call
      expect(budget.callsMade).toBe(2); // both attempts count against the ceiling
      expect(budget.stopped).toBeNull(); // whole run NOT stopped
      expect(budget.s2Blocked).toBeNull(); // S2 NOT marked rate-limited — the retry succeeded
    },
  );

  it("does NOT stop the run on a non-429 error — only that one call fails", async () => {
    const budget = new CallBudget({ ceiling: 150 });
    let n = 0;
    const fake = vi.fn(async () => {
      n += 1;
      if (n === 2) throw new Error("openalex HTTP 500 — server error");
      return "ok";
    });

    const outcomes = [];
    for (let i = 0; i < 5; i++) {
      outcomes.push(await trackedCall(budget, "openalex", fake));
    }

    expect(fake).toHaveBeenCalledTimes(5);
    expect(outcomes.filter((o) => o.status === "not_run")).toHaveLength(0);
    expect(outcomes[1]).toMatchObject({ status: "failed" });
    expect(budget.stopped).toBeNull();
  });

  it("does NOT stop on a network-error (non-HTTP) rejection", async () => {
    const budget = new CallBudget({ ceiling: 150 });
    let n = 0;
    const fake = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("fetch failed: ECONNRESET");
      return "ok";
    });

    await trackedCall(budget, "openalex", fake);
    const second = await trackedCall(budget, "openalex", fake);

    expect(fake).toHaveBeenCalledTimes(2);
    expect(second).toMatchObject({ status: "ok" });
    expect(budget.stopped).toBeNull();
  });

  it("counts a failed call against the budget (the attempt happened)", async () => {
    const budget = new CallBudget({ ceiling: 150 });
    const fake = vi.fn(async () => {
      throw new Error("openalex HTTP 500 — server error");
    });
    await trackedCall(budget, "openalex", fake);
    expect(budget.callsMade).toBe(1);
  });
});

// LIVE-EVAL-4-FIX (ABC-JEV-INTEGRATION.md §1w AMENDMENT) — new behavior:
// OpenAlex 429 still stops the whole run (unchanged), but an S2 429 no
// longer does. S2 instead gets a 60s cool-off + one retry of the same call;
// only a 429 on THAT retry blocks further S2 calls specifically, while
// OpenAlex calls keep running. Plus runner-side S2 pacing (>=3s between the
// runner's own consecutive S2 calls) and the retry's effect on the ceiling.
describe("CallBudget S2 429 cool-off/retry (LIVE-EVAL-4-FIX)", () => {
  it("a second 429 (on the cool-off retry) marks every LATER S2 call not_run(s2_rate_limited), reports THIS call as failed (not hidden), and never touches OpenAlex", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 150, sleep: clock.sleep, now: clock.now });
    const alwaysRateLimited = vi.fn(async () => {
      throw new Error("semantic_scholar HTTP 429 — rate limited");
    });

    const first = await trackedCall(budget, "semantic_scholar", alwaysRateLimited);

    expect(alwaysRateLimited).toHaveBeenCalledTimes(2); // the attempt + one retry, no more
    expect(first.status).toBe("failed");
    if (first.status === "failed") expect(first.error.message).toMatch(/HTTP 429/);
    expect(clock.sleepCalls).toEqual([60_000]);
    expect(budget.s2Blocked).toMatchObject({ kind: "s2-rate-limited", reason: "s2_rate_limited" });
    expect(budget.stopped).toBeNull(); // the whole run is NOT stopped

    // Every S2 call planned after this one is skipped, with an honest reason
    // — never silently dropped and never attempted.
    const neverCalled = vi.fn(async () => "should not run");
    const second = await trackedCall(budget, "semantic_scholar", neverCalled);
    expect(neverCalled).not.toHaveBeenCalled();
    expect(second).toMatchObject({ status: "not_run", reason: "s2_rate_limited" });

    // OpenAlex is completely unaffected — the run continues with it.
    const openAlexFake = vi.fn(async () => "openalex ok");
    const oaOutcome = await trackedCall(budget, "openalex", openAlexFake);
    expect(openAlexFake).toHaveBeenCalledTimes(1);
    expect(oaOutcome).toMatchObject({ status: "ok", value: "openalex ok" });
  });

  it("an OpenAlex 429 still blocks EVERY later call, including semantic_scholar ones — the whole run stops (unchanged)", async () => {
    const budget = new CallBudget({ ceiling: 150 });
    const openAlex429 = vi.fn(async () => {
      throw new Error("openalex HTTP 429 — rate limited");
    });
    await trackedCall(budget, "openalex", openAlex429);
    expect(budget.stopped?.kind).toBe("openalex-429");

    const s2Fake = vi.fn(async () => "should not run");
    const outcome = await trackedCall(budget, "semantic_scholar", s2Fake);
    expect(s2Fake).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({
      status: "not_run",
      reason: "stopped after first OpenAlex 429",
    });
  });

  it("paces its own S2 calls at least 3s apart, with no wait before the very first S2 call", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 150, sleep: clock.sleep, now: clock.now });
    const fake = vi.fn(async () => "ok");

    await trackedCall(budget, "semantic_scholar", fake);
    expect(clock.sleepCalls).toEqual([]);

    await trackedCall(budget, "semantic_scholar", fake);
    expect(clock.sleepCalls).toEqual([3_000]);

    await trackedCall(budget, "semantic_scholar", fake);
    expect(clock.sleepCalls).toEqual([3_000, 3_000]);

    expect(fake).toHaveBeenCalledTimes(3);
  });

  it("does not pace OpenAlex calls at all, even back-to-back", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 150, sleep: clock.sleep, now: clock.now });
    const fake = vi.fn(async () => "ok");

    await trackedCall(budget, "openalex", fake);
    await trackedCall(budget, "openalex", fake);

    expect(clock.sleepCalls).toEqual([]);
  });

  it("does not wait again if enough time already elapsed between two S2 calls", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 150, sleep: clock.sleep, now: clock.now });
    const fake = vi.fn(async () => "ok");

    await trackedCall(budget, "semantic_scholar", fake);
    await clock.sleep(5_000); // simulates 5s of real time passing between calls
    await trackedCall(budget, "semantic_scholar", fake);

    // The 5s "elapsed" wait is recorded, but no ADDITIONAL pacing wait was
    // needed on top of it — the gap was already >=3s.
    expect(clock.sleepCalls).toEqual([5_000]);
  });

  it("the ceiling counts a retried S2 call TWICE (both attempts), exhausting it after one logical call", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 2, sleep: clock.sleep, now: clock.now });
    let n = 0;
    const fake = vi.fn(async () => {
      n += 1;
      if (n === 1) throw new Error("semantic_scholar HTTP 429 — rate limited");
      return "ok";
    });

    const outcome = await trackedCall(budget, "semantic_scholar", fake);

    expect(outcome).toMatchObject({ status: "ok" });
    expect(budget.callsMade).toBe(2); // ceiling of 2, fully consumed by ONE logical call

    const blocked = await trackedCall(budget, "openalex", vi.fn(async () => "x"));
    expect(blocked).toMatchObject({ status: "not_run", reason: "call ceiling reached" });
  });

  it("never pays the 60s cool-off or a retry once the ceiling is already exhausted by the first attempt", async () => {
    const clock = createVirtualClock();
    const budget = new CallBudget({ ceiling: 1, sleep: clock.sleep, now: clock.now });
    const fake = vi.fn(async () => {
      throw new Error("semantic_scholar HTTP 429 — rate limited");
    });

    const outcome = await trackedCall(budget, "semantic_scholar", fake);

    expect(fake).toHaveBeenCalledTimes(1); // no retry attempted — the ceiling was already spent
    expect(outcome).toMatchObject({ status: "failed" });
    expect(clock.sleepCalls).toEqual([]); // no cool-off paid for a retry that will never happen
    expect(budget.callsMade).toBe(1);
    expect(budget.s2Blocked).toBeNull(); // never confirmed a second 429 — a retry was never tried
  });
});
