import { beforeEach, describe, expect, it, vi } from "vitest";

// P3-02 (ruling §1h.2): what "Explain this?" answered, per paper and passage,
// kept in this browser — so the same passage opens at once, with no request.
// `turns` is reserved for P3-02b's thread and is always empty here. `persist`
// reads its storage when the store is created, so it is in place before the
// module loads.
const storage = vi.hoisted(() => {
  const items = new Map<string, string>();
  const local = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    key: (index: number) => [...items.keys()][index] ?? null,
    removeItem: (key: string) => void items.delete(key),
    setItem: (key: string, value: string) => void items.set(key, String(value)),
  };
  (globalThis as Record<string, unknown>).localStorage = local;
  (globalThis as Record<string, unknown>).window ??= globalThis;
  return { items, local };
});

import type { ExplainAnswer } from "@/lib/papers/explain";
import {
  EXPLAIN_THREADS_STORAGE_KEY,
  MAX_EXPLAIN_PAPERS,
  MAX_EXPLAIN_PASSAGES,
  explanationFor,
  passageHash,
  useExplainThreadsStore,
} from "./explain-threads";

const answer = (n: number): ExplainAnswer => ({ meaning: `meaning ${n}`, here: { text: `here ${n}`, peer: true } });
const entry = (passage: string, n = 1) => ({ passage, sectionId: "s2", paragraphIndex: 1, answer: answer(n) });
const at = (n: number) => new Date(Date.UTC(2026, 9, 6, 12, 0, n)).toISOString();

describe("passageHash", () => {
  it("is the same however the passage is spaced or cased, and different for different words", () => {
    expect(passageHash("The rafting ratio")).toBe(passageHash("  the  RAFTING\nratio "));
    expect(passageHash("The rafting ratio")).not.toBe(passageHash("The rafting"));
    expect(passageHash("a")).not.toBe(passageHash("b"));
  });

  it("is a short key with no readable passage in it", () => {
    const hash = passageHash("The rafting ratio rose from 0.2 to 0.7 as the specimen crept.");

    expect(hash).toMatch(/^[0-9a-z-]+$/);
    expect(hash.length).toBeLessThan(40);
    expect(hash).not.toContain("rafting");
  });
});

describe("explain threads store (P3-02)", () => {
  beforeEach(() => {
    useExplainThreadsStore.setState({ byPaper: {} });
    storage.items.clear();
  });

  it("remembers an answer under its paper and the passage's hash, with an empty thread and a stamp", () => {
    useExplainThreadsStore.getState().remember("arxiv:1", entry("The rafting ratio"), at(1));

    const kept = useExplainThreadsStore.getState().byPaper["arxiv:1"][passageHash("The rafting ratio")];
    expect(kept).toEqual({ passage: "The rafting ratio", sectionId: "s2", paragraphIndex: 1, answer: answer(1), turns: [], at: at(1) });
  });

  it("finds an answer for the same words, and for no other", () => {
    useExplainThreadsStore.getState().remember("arxiv:1", entry("The rafting ratio"), at(1));
    const { byPaper } = useExplainThreadsStore.getState();

    expect(explanationFor(byPaper, "arxiv:1", "  the RAFTING   ratio")?.answer).toEqual(answer(1));
    expect(explanationFor(byPaper, "arxiv:1", "The rafting")).toBeUndefined();
    expect(explanationFor(byPaper, "arxiv:2", "The rafting ratio")).toBeUndefined();
  });

  it("does not take another passage's answer for a hash that collides", () => {
    useExplainThreadsStore.getState().remember("arxiv:1", entry("The rafting ratio"), at(1));
    // The same key, different words: as if two passages hashed alike.
    const key = passageHash("The rafting ratio");
    const byPaper = { "arxiv:1": { [key]: { ...entry("A different passage entirely", 2), turns: [], at: at(2) } } };

    expect(explanationFor(byPaper, "arxiv:1", "The rafting ratio")).toBeUndefined();
  });

  it("answering the same passage again replaces the answer and keeps the thread", () => {
    const store = useExplainThreadsStore.getState();
    store.remember("arxiv:1", entry("The rafting ratio", 1), at(1));
    useExplainThreadsStore.setState((s) => ({
      byPaper: { "arxiv:1": { [passageHash("The rafting ratio")]: { ...s.byPaper["arxiv:1"][passageHash("The rafting ratio")], turns: [{ role: "reader", text: "why?" }] } } },
    }));
    store.remember("arxiv:1", entry("the rafting ratio", 2), at(2));

    const kept = Object.values(useExplainThreadsStore.getState().byPaper["arxiv:1"]);
    expect(kept).toHaveLength(1);
    expect(kept[0].answer).toEqual(answer(2));
    expect(kept[0].turns).toEqual([{ role: "reader", text: "why?" }]);
    expect(kept[0].at).toBe(at(2));
  });

  it("keeps at most 32 passages per paper, the oldest dropped", () => {
    const store = useExplainThreadsStore.getState();
    for (let i = 0; i < 35; i += 1) store.remember("arxiv:1", entry(`passage number ${i}`, i), at(i));

    const kept = useExplainThreadsStore.getState().byPaper["arxiv:1"];
    expect(Object.keys(kept)).toHaveLength(MAX_EXPLAIN_PASSAGES);
    expect(MAX_EXPLAIN_PASSAGES).toBe(32);
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "arxiv:1", "passage number 0")).toBeUndefined();
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "arxiv:1", "passage number 2")).toBeUndefined();
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "arxiv:1", "passage number 3")?.answer).toEqual(answer(3));
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "arxiv:1", "passage number 34")?.answer).toEqual(answer(34));
  });

  it("keeps the answers of at most 24 papers, those least recently asked dropped", () => {
    const store = useExplainThreadsStore.getState();
    for (let i = 0; i < MAX_EXPLAIN_PAPERS + 3; i += 1) store.remember(`arxiv:${i}`, entry("The rafting ratio", i), at(i));

    const papers = Object.keys(useExplainThreadsStore.getState().byPaper);
    expect(papers).toHaveLength(MAX_EXPLAIN_PAPERS);
    expect(papers).not.toContain("arxiv:0");
    expect(papers).not.toContain("arxiv:2");
    expect(papers).toContain("arxiv:3");
    expect(papers).toContain(`arxiv:${MAX_EXPLAIN_PAPERS + 2}`);
  });

  it("forgets one passage, and drops a paper left with none", () => {
    const store = useExplainThreadsStore.getState();
    store.remember("arxiv:1", entry("The rafting ratio"), at(1));
    store.remember("arxiv:1", entry("Another passage here"), at(2));
    store.forget("arxiv:1", passageHash("The rafting ratio"));

    expect(Object.keys(useExplainThreadsStore.getState().byPaper["arxiv:1"])).toEqual([passageHash("Another passage here")]);
    store.forget("arxiv:1", passageHash("Another passage here"));
    expect(useExplainThreadsStore.getState().byPaper["arxiv:1"]).toBeUndefined();
    // Forgetting what is not there changes nothing.
    store.forget("arxiv:9", "nope");
    expect(useExplainThreadsStore.getState().byPaper["arxiv:9"]).toBeUndefined();
  });

  it("clears one paper and leaves the others", () => {
    const store = useExplainThreadsStore.getState();
    store.remember("arxiv:1", entry("The rafting ratio"), at(1));
    store.remember("arxiv:2", entry("The rafting ratio"), at(2));
    store.clearPaper("arxiv:1");

    expect(Object.keys(useExplainThreadsStore.getState().byPaper)).toEqual(["arxiv:2"]);
  });

  it("persists under peer-explain-threads-v1, and only the answers", () => {
    useExplainThreadsStore.getState().remember("arxiv:1", entry("The rafting ratio"), at(1));
    const stored = JSON.parse(storage.items.get(EXPLAIN_THREADS_STORAGE_KEY) ?? "null") as { state: Record<string, unknown>; version: number };

    expect(EXPLAIN_THREADS_STORAGE_KEY).toBe("peer-explain-threads-v1");
    expect(stored.version).toBe(1);
    expect(Object.keys(stored.state)).toEqual(["byPaper"]);
  });
});
