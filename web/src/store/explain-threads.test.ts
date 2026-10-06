import { beforeEach, describe, expect, it, vi } from "vitest";

// P3-02 (ruling §1h.2): what "Explain this?" answered, per paper and passage,
// kept in this browser — so the same passage opens at once, with no request.
// P3-02b (§1h.3) fills `turns` with the thread that follows; its tests are at
// the foot. `persist` reads its storage when the store is created, so it is in
// place before the module loads.
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
  MAX_EXPLAIN_MESSAGE_CHARS,
  MAX_EXPLAIN_PAPERS,
  MAX_EXPLAIN_PASSAGES,
  MAX_EXPLAIN_TURNS,
  explanationFor,
  passageHash,
  threadFull,
  useExplainThreadsStore,
  type ExplainTurn,
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

// ── P3-02b (ruling §1h.3): the thread ───────────────────────────────────

const reader = (n: number): ExplainTurn => ({ role: "reader", text: `question ${n}` });
const peer = (n: number): ExplainTurn => ({ role: "peer", text: `reply ${n}`, peer: true });
const pair = (n: number): ExplainTurn[] => [reader(n), peer(n)];
const keyOf = passageHash("The rafting ratio");
const turnsOf = (paperId = "arxiv:1") => useExplainThreadsStore.getState().byPaper[paperId]?.[keyOf]?.turns;

describe("the thread (P3-02b)", () => {
  beforeEach(() => {
    useExplainThreadsStore.setState({ byPaper: {} });
    storage.items.clear();
    useExplainThreadsStore.getState().remember("arxiv:1", entry("The rafting ratio"), at(1));
  });

  it("caps a thread at eight reader messages", () => {
    expect(MAX_EXPLAIN_TURNS).toBe(8);
    expect(MAX_EXPLAIN_MESSAGE_CHARS).toBe(400);
  });

  it("appends a reader message and Peer's reply together, in order, after the first answer", () => {
    const store = useExplainThreadsStore.getState();
    store.addTurns("arxiv:1", keyOf, pair(1), at(2));
    store.addTurns("arxiv:1", keyOf, pair(2), at(3));

    expect(turnsOf()).toEqual([...pair(1), ...pair(2)]);
    expect(useExplainThreadsStore.getState().byPaper["arxiv:1"][keyOf].answer).toEqual(answer(1));
  });

  it("keeps every field of a verified reply: the quote, its place, its page, its section", () => {
    const verified: ExplainTurn = { role: "peer", text: "A reply.", evidence: "A sentence.", evidenceWhere: "2 Methods", sectionId: "s2", page: 2 };
    useExplainThreadsStore.getState().addTurns("arxiv:1", keyOf, [reader(1), verified], at(2));

    expect(turnsOf()?.[1]).toEqual(verified);
    expect(JSON.parse(storage.items.get(EXPLAIN_THREADS_STORAGE_KEY) ?? "null").state.byPaper["arxiv:1"][keyOf].turns[1]).toEqual(verified);
  });

  // P3-02c (§1h.4 amendment): the reader's message that searched the web carries
  // the mark that explains its cost afterwards; the reply it did not get a search
  // for carries the note. Both are plain fields of a turn, kept and restored like
  // the rest — and never anything about the web itself (no source, no address).
  it("keeps the mark of a message that searched the web and the note on a reply that could not, in the store and in the browser's storage", () => {
    const marked: ExplainTurn = { role: "reader", text: "Does anyone else measure it this way?", searched: true };
    const searched: ExplainTurn = { role: "peer", text: "A reply.", peer: true, searched: true };
    const noted: ExplainTurn = { role: "peer", text: "Another reply.", peer: true, searchUnavailable: true };
    const store = useExplainThreadsStore.getState();
    store.addTurns("arxiv:1", keyOf, [marked, searched], at(2));
    store.addTurns("arxiv:1", keyOf, [reader(2), noted], at(3));

    expect(turnsOf()).toEqual([marked, searched, reader(2), noted]);
    const stored = JSON.parse(storage.items.get(EXPLAIN_THREADS_STORAGE_KEY) ?? "null").state.byPaper["arxiv:1"][keyOf].turns;
    expect(stored).toEqual([marked, searched, reader(2), noted]);
    expect(JSON.stringify(stored)).not.toMatch(/https?:|www\./);
  });

  it("counts a marked message as a reader message: the cap is about messages, not about search", () => {
    const store = useExplainThreadsStore.getState();
    for (let n = 1; n <= 8; n += 1) store.addTurns("arxiv:1", keyOf, [{ ...reader(n), searched: true }, { ...peer(n), searched: true }], at(n));

    expect(threadFull(turnsOf())).toBe(true);
    store.addTurns("arxiv:1", keyOf, [{ ...reader(9), searched: true }, peer(9)], at(20));
    expect(turnsOf()).toHaveLength(16);
  });

  it("stamps the thread's last use, so the newest conversation outlives the oldest", () => {
    useExplainThreadsStore.getState().addTurns("arxiv:1", keyOf, pair(1), at(9));

    expect(useExplainThreadsStore.getState().byPaper["arxiv:1"][keyOf].at).toBe(at(9));
  });

  it("stores nothing beyond eight reader messages", () => {
    const store = useExplainThreadsStore.getState();
    for (let n = 1; n <= 8; n += 1) store.addTurns("arxiv:1", keyOf, pair(n), at(n));
    expect(turnsOf()).toHaveLength(16);

    store.addTurns("arxiv:1", keyOf, pair(9), at(20));

    expect(turnsOf()).toHaveLength(16);
    expect(turnsOf()?.some((turn) => turn.text === "question 9" || turn.text === "reply 9")).toBe(false);
  });

  it("keeps only what fits when a pair would cross the cap", () => {
    const store = useExplainThreadsStore.getState();
    for (let n = 1; n <= 7; n += 1) store.addTurns("arxiv:1", keyOf, pair(n), at(n));
    store.addTurns("arxiv:1", keyOf, [...pair(8), ...pair(9)], at(30));

    expect(turnsOf()).toHaveLength(16);
    expect(turnsOf()?.[14].text).toBe("question 8");
    expect(turnsOf()?.[15].text).toBe("reply 8");
  });

  it("changes nothing for a passage that was never answered, or for no turns", () => {
    const store = useExplainThreadsStore.getState();
    const before = useExplainThreadsStore.getState().byPaper;
    store.addTurns("arxiv:9", keyOf, pair(1), at(2));
    store.addTurns("arxiv:1", "no-such-hash", pair(1), at(2));
    store.addTurns("arxiv:1", keyOf, [], at(2));

    expect(useExplainThreadsStore.getState().byPaper).toBe(before);
  });

  it("says a thread is full at eight reader messages, from the turns or from the thread", () => {
    const eight = Array.from({ length: 8 }, (_, i) => pair(i + 1)).flat();

    expect(threadFull(eight)).toBe(true);
    expect(threadFull(eight.slice(0, 15))).toBe(true);
    expect(threadFull(eight.slice(0, 14))).toBe(false);
    expect(threadFull([])).toBe(false);
    expect(threadFull(undefined)).toBe(false);
    expect(threadFull({ ...entry("x"), turns: eight, at: at(1) })).toBe(true);
    expect(threadFull({ ...entry("x"), turns: eight.slice(0, 4), at: at(1) })).toBe(false);
    // Only the reader's messages count: eight replies alone are not a full thread.
    expect(threadFull(Array.from({ length: 8 }, (_, i) => peer(i)))).toBe(false);
  });

  it("empties a thread and keeps the first answer", () => {
    const store = useExplainThreadsStore.getState();
    store.addTurns("arxiv:1", keyOf, pair(1), at(2));
    store.resetThread("arxiv:1", keyOf);

    const kept = useExplainThreadsStore.getState().byPaper["arxiv:1"][keyOf];
    expect(kept.turns).toEqual([]);
    expect(kept.answer).toEqual(answer(1));
    expect(kept.passage).toBe("The rafting ratio");
    expect(explanationFor(useExplainThreadsStore.getState().byPaper, "arxiv:1", "The rafting ratio")?.answer).toEqual(answer(1));
  });

  it("resets nothing that is not there, and leaves other passages alone", () => {
    const store = useExplainThreadsStore.getState();
    store.remember("arxiv:1", entry("Another passage here"), at(3));
    store.addTurns("arxiv:1", passageHash("Another passage here"), pair(1), at(4));
    const before = useExplainThreadsStore.getState().byPaper;
    store.resetThread("arxiv:9", keyOf);
    store.resetThread("arxiv:1", "no-such-hash");
    expect(useExplainThreadsStore.getState().byPaper).toBe(before);

    store.resetThread("arxiv:1", keyOf);
    expect(useExplainThreadsStore.getState().byPaper["arxiv:1"][passageHash("Another passage here")].turns).toEqual(pair(1));
  });

  it("answering the passage again keeps the turns already stored", () => {
    const store = useExplainThreadsStore.getState();
    store.addTurns("arxiv:1", keyOf, pair(1), at(2));
    store.remember("arxiv:1", entry("The rafting ratio", 2), at(3));

    expect(turnsOf()).toEqual(pair(1));
  });
});
