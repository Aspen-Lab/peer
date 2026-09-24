import { describe, expect, it, vi } from "vitest";
import { InMemoryCounterStore, type CounterReading, type CounterStore } from "@/lib/usage/counters";
import { jevGlobalDayKey, jevPerUserDayKey, reserveJevCall } from "./jev-broker-auth";

const NOW = new Date("2026-09-24T12:00:00.000Z");

describe("jevPerUserDayKey / jevGlobalDayKey", () => {
  it("match the exact binding key scheme jev:<owner>:<UTC-day> and jev:all:<UTC-day>", () => {
    expect(jevPerUserDayKey("owner-a", NOW)).toBe("jev:owner-a:2026-09-24");
    expect(jevGlobalDayKey(NOW)).toBe("jev:all:2026-09-24");
  });
});

describe("reserveJevCall", () => {
  it("succeeds and increments both the per-user and global counters by 1", async () => {
    const store = new InMemoryCounterStore();
    const result = await reserveJevCall("owner-a", { perUserCap: 10, globalCap: 100, now: NOW, store });
    expect(result).toEqual({ ok: true });
    await expect(store.read(jevPerUserDayKey("owner-a", NOW), NOW)).resolves.toEqual({ value: 1, ok: true });
    await expect(store.read(jevGlobalDayKey(NOW), NOW)).resolves.toEqual({ value: 1, ok: true });
  });

  it("refuses once the per-user cap is exceeded, and does NOT touch the shared global counter", async () => {
    const store = new InMemoryCounterStore();
    const first = await reserveJevCall("owner-a", { perUserCap: 1, globalCap: 100, now: NOW, store }); // 1/1 -> ok
    const second = await reserveJevCall("owner-a", { perUserCap: 1, globalCap: 100, now: NOW, store }); // 2/1 -> refused, per-user only

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "per_user_cap_exceeded" });
    // P3-S4-FIX (Round 3): this used to assert the global counter was
    // incremented on BOTH attempts, including the refused one — that was
    // Finding 2 of docs/jev-abc/P3-S4-A-20260924T0905Z.md, a bounded but real
    // budget-griefing surface (a per-user-capped owner's refused retries kept
    // consuming the shared global counter). Reservation is now per-user-first:
    // a per-user refusal returns before the global counter is ever touched, so
    // it stays at exactly the 1 unit the FIRST (successful) call reserved.
    await expect(store.read(jevGlobalDayKey(NOW), NOW)).resolves.toEqual({ value: 1, ok: true });
  });

  it("when the per-user cap is exceeded, the global counter's increment is never even called (not just left unincremented by luck)", async () => {
    const store = new InMemoryCounterStore();
    await reserveJevCall("owner-a", { perUserCap: 1, globalCap: 100, now: NOW, store }); // 1/1 -> ok, consumes the cap
    const incrementSpy = vi.spyOn(store, "increment");

    const result = await reserveJevCall("owner-a", { perUserCap: 1, globalCap: 100, now: NOW, store }); // 2/1 -> refused

    expect(result).toEqual({ ok: false, reason: "per_user_cap_exceeded" });
    expect(incrementSpy).toHaveBeenCalledTimes(1); // only the per-user counter, never the global one
    expect(incrementSpy).toHaveBeenCalledWith(jevPerUserDayKey("owner-a", NOW), expect.anything(), expect.anything(), expect.anything());
  });

  it("reserves the per-user counter strictly before the global counter (call-order proof, success path)", async () => {
    const store = new InMemoryCounterStore();
    const order: string[] = [];
    vi.spyOn(store, "increment").mockImplementation(async (key: string, windowEndsAt, by, now) => {
      order.push(key.startsWith("jev:all:") ? "global" : "perUser");
      return InMemoryCounterStore.prototype.increment.call(store, key, windowEndsAt, by, now);
    });

    await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, now: NOW, store });

    expect(order).toEqual(["perUser", "global"]);
  });

  it("refuses once the global cap is exceeded, and still increments the per-user counter (accepted over-reservation, no rollback)", async () => {
    const store = new InMemoryCounterStore();
    const first = await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 1, now: NOW, store }); // global 1/1 -> ok
    const second = await reserveJevCall("owner-b", { perUserCap: 100, globalCap: 1, now: NOW, store }); // different user, same global counter -> refused

    expect(first).toEqual({ ok: true });
    expect(second).toEqual({ ok: false, reason: "global_cap_exceeded" });
    // owner-b's own per-user counter was still incremented despite the refusal.
    await expect(store.read(jevPerUserDayKey("owner-b", NOW), NOW)).resolves.toEqual({ value: 1, ok: true });
  });

  it("fails closed when the counter store is entirely unreadable, regardless of caps", async () => {
    const unreadable: CounterStore = {
      label: "in-memory",
      async increment(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
      async read(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
    };
    const result = await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, now: NOW, store: unreadable });
    expect(result).toEqual({ ok: false, reason: "counter_unreadable" });
  });

  it("fails closed when only the global counter is unreadable (per-user read succeeded and was under cap)", async () => {
    const partiallyUnreadable: CounterStore = {
      label: "in-memory",
      async increment(key: string): Promise<CounterReading> {
        return key.startsWith("jev:all:") ? { value: 0, ok: false } : { value: 1, ok: true };
      },
      async read(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
    };
    const result = await reserveJevCall("owner-a", {
      perUserCap: 100,
      globalCap: 100,
      now: NOW,
      store: partiallyUnreadable,
    });
    expect(result).toEqual({ ok: false, reason: "counter_unreadable" });
  });

  it("fails closed when only the per-user counter is unreadable", async () => {
    const partiallyUnreadable: CounterStore = {
      label: "in-memory",
      async increment(key: string): Promise<CounterReading> {
        return key.startsWith("jev:all:") ? { value: 1, ok: true } : { value: 0, ok: false };
      },
      async read(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
    };
    const result = await reserveJevCall("owner-a", {
      perUserCap: 100,
      globalCap: 100,
      now: NOW,
      store: partiallyUnreadable,
    });
    expect(result).toEqual({ ok: false, reason: "counter_unreadable" });
  });

  it("when the per-user counter is unreadable, the global counter's increment is never even attempted (sequential reservation, not parallel)", async () => {
    const globalIncrement = vi.fn(async (): Promise<CounterReading> => ({ value: 1, ok: true }));
    const store: CounterStore = {
      label: "in-memory",
      async increment(key: string): Promise<CounterReading> {
        if (key.startsWith("jev:all:")) return globalIncrement();
        return { value: 0, ok: false }; // per-user always unreadable
      },
      async read(): Promise<CounterReading> {
        return { value: 0, ok: false };
      },
    };
    const result = await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, now: NOW, store });
    expect(result).toEqual({ ok: false, reason: "counter_unreadable" });
    expect(globalIncrement).not.toHaveBeenCalled();
  });

  it("shares one counter across the same UTC calendar day, and rolls over on the next UTC day", async () => {
    const store = new InMemoryCounterStore();
    const laterSameDay = new Date("2026-09-24T23:59:00.000Z");
    const nextDay = new Date("2026-09-25T00:00:01.000Z");

    await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, now: NOW, store });
    await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, now: laterSameDay, store });
    await expect(store.read(jevPerUserDayKey("owner-a", NOW), NOW)).resolves.toEqual({ value: 2, ok: true });

    const thirdOnNextDay = await reserveJevCall("owner-a", { perUserCap: 1, globalCap: 100, now: nextDay, store });
    expect(thirdOnNextDay).toEqual({ ok: true }); // new UTC day, fresh counter, 1/1 cap -> ok
  });

  it("increments happen atomically — N concurrent reservations for one owner never over- or under-count", async () => {
    const store = new InMemoryCounterStore();
    const results = await Promise.all(
      Array.from({ length: 5 }, () => reserveJevCall("owner-a", { perUserCap: 3, globalCap: 100, now: NOW, store })),
    );
    const okCount = results.filter((r) => r.ok).length;
    const refusedCount = results.filter((r) => !r.ok).length;
    expect(okCount).toBe(3);
    expect(refusedCount).toBe(2);
    await expect(store.read(jevPerUserDayKey("owner-a", NOW), NOW)).resolves.toEqual({ value: 5, ok: true });
  });

  it("defaults `now` to the real clock when omitted", async () => {
    const store = new InMemoryCounterStore();
    const before = new Date();
    const result = await reserveJevCall("owner-a", { perUserCap: 100, globalCap: 100, store });
    expect(result).toEqual({ ok: true });
    await expect(store.read(jevPerUserDayKey("owner-a", before), before)).resolves.toEqual({ value: 1, ok: true });
  });
});
