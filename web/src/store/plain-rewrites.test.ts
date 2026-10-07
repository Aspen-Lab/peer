import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { passageHash } from "@/store/explain-threads";
import {
  MAX_PLAIN_PAPERS,
  MAX_PLAIN_PER_PAPER,
  PLAIN_STORAGE_KEY,
  keptFor,
  paragraphKey,
  usePlainRewritesStore,
} from "@/store/plain-rewrites";

// P4-01 (blueprint §3.6 "客户端 localStorage"; rulings §1h.12 (h)): what "Say it plainly" wrote,
// kept in this browser per paper, paragraph and level — and which paragraphs show it now, which
// is NOT kept (a reload shows the originals). The paragraph's text is Peer's paraphrase of the
// paper's own: for an uploaded PDF, private text, in the reader's own browser, like the explain
// threads and the questions. Everything below is invented.

const PARA = "The rafting ratio rose from 0.2 to 0.7 at 1100 K.";
const KEY = paragraphKey("s2", 1);

function reset() {
  usePlainRewritesStore.setState({ byPaper: {}, showing: {}, busy: {}, notices: {} });
}

beforeEach(reset);

describe("the keys", () => {
  it("names a paragraph by its section and its place in it, and the browser store by a versioned name", () => {
    expect(paragraphKey("s2", 1)).toBe("s2:1");
    expect(paragraphKey("s10", 0)).toBe("s10:0");
    expect(PLAIN_STORAGE_KEY).toBe("peer-plain-v1");
    expect(MAX_PLAIN_PAPERS).toBe(24);
  });
});

describe("remember and keptFor", () => {
  it("keeps a rewrite under the paper, the paragraph and the level, with the paragraph's hash", () => {
    usePlainRewritesStore.getState().remember("p1", KEY, "undergrad", { plain: "It rose.", text: PARA }, "2026-10-07T10:00:00.000Z");
    const kept = keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "undergrad", PARA);

    expect(kept).toEqual({ plain: "It rose.", hash: passageHash(PARA), at: "2026-10-07T10:00:00.000Z" });
    // A rewrite is kept at its level: another level has none, and neither has another paragraph or paper.
    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "graduate", PARA)).toBeUndefined();
    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", paragraphKey("s2", 2), "undergrad", PARA)).toBeUndefined();
    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p2", KEY, "undergrad", PARA)).toBeUndefined();
  });

  it("keeps the three levels of one paragraph side by side", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", KEY, "highschool", { plain: "Easy.", text: PARA });
    store.remember("p1", KEY, "undergrad", { plain: "Middle.", text: PARA });
    store.remember("p1", KEY, "graduate", { plain: "Hard.", text: PARA });
    const by = usePlainRewritesStore.getState().byPaper;

    expect(["highschool", "undergrad", "graduate"].map((level) => keptFor(by, "p1", KEY, level as "undergrad", PARA)?.plain)).toEqual(["Easy.", "Middle.", "Hard."]);
  });

  it("replaces the rewrite kept for the same paragraph and level", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", KEY, "undergrad", { plain: "First.", text: PARA });
    store.remember("p1", KEY, "undergrad", { plain: "Second.", text: PARA });

    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "undergrad", PARA)?.plain).toBe("Second.");
  });

  it("does not hand back a rewrite for words that are no longer the paragraph's: the text changed under the same place", () => {
    usePlainRewritesStore.getState().remember("p1", KEY, "undergrad", { plain: "It rose.", text: PARA });

    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "undergrad", `${PARA} A new sentence.`)).toBeUndefined();
    // The space around it is not a change: the hash is the verifier's own.
    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "undergrad", `  ${PARA}\n`)?.plain).toBe("It rose.");
  });

  it("keeps at most 24 papers: the one whose newest rewrite is oldest goes first", () => {
    const store = usePlainRewritesStore.getState();
    for (let i = 0; i < 25; i += 1) {
      store.remember(`paper-${i}`, KEY, "undergrad", { plain: `rewrite ${i}`, text: PARA }, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
    }
    const papers = Object.keys(usePlainRewritesStore.getState().byPaper);

    expect(papers).toHaveLength(MAX_PLAIN_PAPERS);
    expect(papers).not.toContain("paper-0");
    expect(papers).toContain("paper-24");
  });

  it("keeps at most 48 rewrites of one paper, the oldest dropped first — a paragraph at a level is one", () => {
    const store = usePlainRewritesStore.getState();
    for (let i = 0; i < MAX_PLAIN_PER_PAPER + 2; i += 1) {
      store.remember("p1", paragraphKey("s1", i), "undergrad", { plain: `rewrite ${i}`, text: `${PARA} ${i}` }, new Date(Date.UTC(2026, 9, 1, 0, i)).toISOString());
    }
    const kept = usePlainRewritesStore.getState().byPaper.p1;

    expect(Object.keys(kept)).toHaveLength(MAX_PLAIN_PER_PAPER);
    expect(kept[paragraphKey("s1", 0)]).toBeUndefined();
    expect(kept[paragraphKey("s1", 1)]).toBeUndefined();
    expect(kept[paragraphKey("s1", MAX_PLAIN_PER_PAPER + 1)]).toBeDefined();
    expect(MAX_PLAIN_PER_PAPER).toBe(48);
  });

  it("forgets a paper's rewrites when asked", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", KEY, "undergrad", { plain: "It rose.", text: PARA });
    store.remember("p2", KEY, "undergrad", { plain: "It rose.", text: PARA });
    store.clearPaper("p1");

    expect(Object.keys(usePlainRewritesStore.getState().byPaper)).toEqual(["p2"]);
  });
});

describe("what shows now", () => {
  const remember = () => usePlainRewritesStore.getState().remember("p1", KEY, "undergrad", { plain: "It rose.", text: PARA });

  it("shows a paragraph's rewrite at a level, and the same paragraph once", () => {
    remember();
    const store = usePlainRewritesStore.getState();
    store.show("p1", KEY, "undergrad");
    store.show("p1", KEY, "undergrad");

    expect(usePlainRewritesStore.getState().showing.p1).toEqual([{ key: KEY, level: "undergrad" }]);
  });

  it("puts the paragraph last again when it is shown again — the most recent act is the latest", () => {
    const store = usePlainRewritesStore.getState();
    for (const index of [1, 2, 3]) store.remember("p1", paragraphKey("s2", index), "undergrad", { plain: `rewrite ${index}`, text: `${PARA} ${index}` });
    for (const index of [1, 2, 3]) store.show("p1", paragraphKey("s2", index), "undergrad");
    store.show("p1", paragraphKey("s2", 1), "undergrad");

    expect(usePlainRewritesStore.getState().showing.p1.map((entry) => entry.key)).toEqual(["s2:2", "s2:3", "s2:1"]);
  });

  it("moves a paragraph to another level when that level is shown", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", KEY, "undergrad", { plain: "Middle.", text: PARA });
    store.remember("p1", KEY, "graduate", { plain: "Hard.", text: PARA });
    store.show("p1", KEY, "undergrad");
    store.show("p1", KEY, "graduate");

    expect(usePlainRewritesStore.getState().showing.p1).toEqual([{ key: KEY, level: "graduate" }]);
  });

  it("hides one paragraph and leaves the rewrite kept — a second click shows it again with no request", () => {
    remember();
    const store = usePlainRewritesStore.getState();
    store.show("p1", KEY, "undergrad");
    store.hide("p1", KEY);

    expect(usePlainRewritesStore.getState().showing.p1 ?? []).toEqual([]);
    expect(keptFor(usePlainRewritesStore.getState().byPaper, "p1", KEY, "undergrad", PARA)?.plain).toBe("It rose.");
  });

  it("hides the most recently shown, and says whether there was one: `u` restores the latest original first", () => {
    const store = usePlainRewritesStore.getState();
    for (const index of [1, 2]) {
      store.remember("p1", paragraphKey("s2", index), "undergrad", { plain: `rewrite ${index}`, text: `${PARA} ${index}` });
      store.show("p1", paragraphKey("s2", index), "undergrad");
    }

    expect(usePlainRewritesStore.getState().hideLatest("p1")).toBe(true);
    expect(usePlainRewritesStore.getState().showing.p1.map((entry) => entry.key)).toEqual(["s2:1"]);
    expect(usePlainRewritesStore.getState().hideLatest("p1")).toBe(true);
    expect(usePlainRewritesStore.getState().hideLatest("p1")).toBe(false);
    expect(usePlainRewritesStore.getState().hideLatest("nobody")).toBe(false);
    // Both are still kept.
    expect(Object.keys(usePlainRewritesStore.getState().byPaper.p1)).toHaveLength(2);
  });

  it("does not count as shown a paragraph whose rewrite is no longer kept: `u` passes it by", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", paragraphKey("s2", 1), "undergrad", { plain: "rewrite 1", text: `${PARA} 1` });
    store.show("p1", paragraphKey("s2", 1), "undergrad");
    // A shown entry whose rewrite was dropped from the store (a paper over the bound).
    usePlainRewritesStore.setState((s) => ({ showing: { ...s.showing, p1: [...s.showing.p1, { key: "s9:9", level: "undergrad" as const }] } }));

    expect(usePlainRewritesStore.getState().hideLatest("p1")).toBe(true);
    expect(usePlainRewritesStore.getState().showing.p1 ?? []).toEqual([]);
  });

  it("keeps each paper's own list", () => {
    const store = usePlainRewritesStore.getState();
    store.remember("p1", KEY, "undergrad", { plain: "One.", text: PARA });
    store.remember("p2", KEY, "undergrad", { plain: "Two.", text: PARA });
    store.show("p1", KEY, "undergrad");
    store.show("p2", KEY, "undergrad");
    store.hideLatest("p1");

    expect(usePlainRewritesStore.getState().showing.p1 ?? []).toEqual([]);
    expect(usePlainRewritesStore.getState().showing.p2).toHaveLength(1);
  });
});

describe("what is in flight and what failed", () => {
  it("marks a paragraph busy and clear again, for one paper", () => {
    const store = usePlainRewritesStore.getState();
    store.setBusy("p1", KEY, true);

    expect(usePlainRewritesStore.getState().busy.p1).toEqual([KEY]);
    expect(usePlainRewritesStore.getState().isBusy("p1", KEY)).toBe(true);
    expect(usePlainRewritesStore.getState().isBusy("p2", KEY)).toBe(false);
    store.setBusy("p1", KEY, true);
    expect(usePlainRewritesStore.getState().busy.p1).toEqual([KEY]);
    store.setBusy("p1", KEY, false);
    expect(usePlainRewritesStore.getState().isBusy("p1", KEY)).toBe(false);
  });

  it("holds one line for a paragraph that could not be said plainly, and clears it", () => {
    const store = usePlainRewritesStore.getState();
    store.setNotice("p1", KEY, "numbers_changed");
    expect(usePlainRewritesStore.getState().notices.p1[KEY]).toBe("numbers_changed");
    store.setNotice("p1", KEY, "unavailable");
    expect(usePlainRewritesStore.getState().notices.p1[KEY]).toBe("unavailable");
    store.setNotice("p1", KEY, null);
    expect(usePlainRewritesStore.getState().notices.p1?.[KEY]).toBeUndefined();
  });
});

// The store's `persist` handle only exists where there is a `localStorage` (this suite runs in
// plain Node), so what is persisted is held to the source, as the other stores' wiring is.
describe("what is persisted", () => {
  const source = readFileSync(resolve(process.cwd(), "src/store/plain-rewrites.ts"), "utf8");

  it("is the rewrites and nothing else: not what shows now, not what is in flight, not a failure line", () => {
    expect(source).toContain("partialize: (s) => ({ byPaper: s.byPaper }),");
    expect(source).toContain("name: PLAIN_STORAGE_KEY,");
    expect(source).toContain("skipHydration: true,");
  });

  it("is rehydrated after mount with the other stores, so the first client render is the server's", () => {
    const hydrator = readFileSync(resolve(process.cwd(), "src/components/store-hydrator.tsx"), "utf8");

    expect(hydrator).toContain('import { usePlainRewritesStore } from "@/store/plain-rewrites";');
    expect(hydrator).toContain("usePlainRewritesStore.persist.rehydrate();");
  });
});
