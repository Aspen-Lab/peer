import { beforeEach, describe, expect, it, vi } from "vitest";
vi.hoisted(() => {
  const entries = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => entries.set(key, value), removeItem: (key: string) => entries.delete(key) };
  (globalThis as Record<string, unknown>).window ??= globalThis;
});
import { EXPLAIN_THREADS_STORAGE_KEY, explainCacheKey, explanationFor, passageHash, useExplainThreadsStore } from "./explain-threads";
import type { ExplainIdentity } from "@/lib/reader/explain-range";

const identity = (start = 3, source: ExplainIdentity["source"] = "paper"): ExplainIdentity => ({ source, segments: [{ sectionId: "s1", paragraphIndex: 0, start, end: start + 5 }, { sectionId: "s1", paragraphIndex: 1, start: 0, end: 4 }] });
const passage = "pools\n\nrise";
const answer = { meaning: "A rise.", here: { text: "It rose.", peer: true as const } };
const entry = (id?: ExplainIdentity) => ({ passage, sectionId: "s1", paragraphIndex: 0, answer, ...(id ? { identity: id } : {}) });
const target = (id: ExplainIdentity) => ({ passage, identity: id });
const turn = { role: "reader" as const, text: "Why?" };
beforeEach(() => useExplainThreadsStore.setState({ byPaper: {} }));
describe("P12-12 grouped browser cache occurrence and source", () => {
  it("preserves legacy keys/entries, and separates same words by source and occurrence", () => {
    const store = useExplainThreadsStore.getState(); store.remember("p", entry());
    for (const id of [identity(), identity(9), identity(3, "summary"), identity(3, "answer")]) store.remember("p", entry(id));
    const kept = useExplainThreadsStore.getState().byPaper;
    expect(Object.keys(kept.p)).toHaveLength(5);
    expect(explainCacheKey(passage)).toBe(passageHash(passage));
    expect(explanationFor(kept, "p", passage)).toBe(kept.p[passageHash(passage)]);
    expect(explanationFor(kept, "p", passage, identity())).toBeDefined();
    expect(explanationFor(kept, "p", passage, identity(6))).toBeUndefined();
    expect(explainCacheKey(passage, identity())).toMatch(/^g-[a-z0-9-]+$/);
    expect(explainCacheKey(passage, identity())).not.toMatch(/pools|rise|s1|paper/);
  });
  it("retains only protocol identity fields and entry data, rehydrates with the same storage key", async () => {
    const input = { ...entry(identity()), paragraphText: "private captured paragraph", segments: [{ quote: "extra" }], callback: () => 1 };
    useExplainThreadsStore.getState().remember("p", input);
    const json = localStorage.getItem(EXPLAIN_THREADS_STORAGE_KEY)!;
    expect(json).not.toMatch(/paragraphText|captured|callback|quote|extra/);
    useExplainThreadsStore.setState({ byPaper: {} });
    // Put back the saved browser record after setState's ordinary persistence write.
    localStorage.setItem(EXPLAIN_THREADS_STORAGE_KEY, json);
    await useExplainThreadsStore.persist.rehydrate();
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "p", passage, identity())).toBeDefined();
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "p", passage, identity(4))).toBeUndefined();
  });
  it("checks equality in lookup/remember/addTurns/reset/forget even with a forced key collision", () => {
    const id = identity(), different = identity(9), key = explainCacheKey(passage, id);
    useExplainThreadsStore.setState({ byPaper: { p: { [key]: { ...entry(different), turns: [turn], at: "2026-01-01" } } } });
    const store = useExplainThreadsStore.getState();
    expect(explanationFor(store.byPaper, "p", passage, id)).toBeUndefined();
    store.addTurns("p", key, [turn], undefined, target(id)); store.resetThread("p", key, target(id)); store.forget("p", key, target(id));
    expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toEqual([turn]);
    store.remember("p", entry(id));
    expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toEqual([]);
    store.addTurns("p", key, [turn], undefined, target(id));
    expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toEqual([turn]);
    store.resetThread("p", key, target(different)); expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toHaveLength(1);
    store.resetThread("p", key, target(id)); expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toHaveLength(0);
    store.forget("p", key, target(different)); expect(useExplainThreadsStore.getState().byPaper.p[key]).toBeDefined();
    store.forget("p", key, target(id)); expect(useExplainThreadsStore.getState().byPaper.p).toBeUndefined();
  });
  it("requires an equality target for grouped mutations, without breaking legacy calls", () => {
    const store = useExplainThreadsStore.getState(); store.remember("p", entry(identity()));
    const key = explainCacheKey(passage, identity()); store.addTurns("p", key, [turn]); store.forget("p", key);
    expect(useExplainThreadsStore.getState().byPaper.p[key].turns).toHaveLength(0);
    store.remember("p", entry()); const legacy = passageHash(passage); store.addTurns("p", legacy, [turn]);
    expect(useExplainThreadsStore.getState().byPaper.p[legacy].turns).toHaveLength(1);
    store.resetThread("p", legacy); store.forget("p", legacy); expect(useExplainThreadsStore.getState().byPaper.p[legacy]).toBeUndefined();
  });
});
