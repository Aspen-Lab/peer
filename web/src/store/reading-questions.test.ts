import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// P1-03 (ruling §1f.9): the reader's questions, per paper, in this browser.
// `persist` reads its storage when the store is created, so the storage is
// in place before the module loads.
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
  // zustand's persist reads `window.localStorage`.
  (globalThis as Record<string, unknown>).window ??= globalThis;
  return { items, local };
});

import {
  MAX_QUESTION_CHARS,
  MAX_QUESTION_PAPERS,
  MAX_QUESTIONS,
  READING_QUESTIONS_STORAGE_KEY,
  useReadingQuestionsHydrated,
  useReadingQuestionsStore,
} from "./reading-questions";

const AT = "2026-10-05T12:00:00.000Z";

describe("reading questions store (P1-03)", () => {
  beforeEach(() => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    storage.items.clear();
  });

  it("keeps up to five trimmed, non-empty, distinct questions of at most 200 characters", () => {
    const long = "x".repeat(250);
    useReadingQuestionsStore.getState().set(
      "openalex:W1",
      ["  How does LCO degrade?  ", "", "how does lco DEGRADE?", "   ", "Why 4.5 V?", long, "Q4", "Q5", "Q6"],
      false,
      AT,
    );

    const entry = useReadingQuestionsStore.getState().byPaper["openalex:W1"];
    expect(entry).toEqual({
      items: ["How does LCO degrade?", "Why 4.5 V?", "x".repeat(MAX_QUESTION_CHARS), "Q4", "Q5"],
      gist: false,
      updatedAt: AT,
    });
    expect(MAX_QUESTIONS).toBe(5);
    expect(MAX_QUESTION_CHARS).toBe(200);
  });

  it("remembers which paper was asked last", () => {
    const { set } = useReadingQuestionsStore.getState();
    set("openalex:W1", ["A question about one"], false, AT);
    expect(useReadingQuestionsStore.getState().lastPaperId).toBe("openalex:W1");
    set("upload:0123456789abcdef", ["A question about an upload"], false, AT);
    expect(useReadingQuestionsStore.getState().lastPaperId).toBe("upload:0123456789abcdef");
  });

  it("keeps the gist flag, with or without questions", () => {
    useReadingQuestionsStore.getState().set("openalex:W1", [], true, AT);
    expect(useReadingQuestionsStore.getState().byPaper["openalex:W1"]).toEqual({ items: [], gist: true, updatedAt: AT });
  });

  it("forgets a paper whose questions are all removed, and clear() forgets one outright", () => {
    const { set, clear } = useReadingQuestionsStore.getState();
    set("openalex:W1", ["A question"], false, AT);
    set("openalex:W1", ["", "  "], false, AT);
    expect(useReadingQuestionsStore.getState().byPaper["openalex:W1"]).toBeUndefined();

    set("openalex:W2", ["Another"], false, AT);
    clear("openalex:W2");
    expect(useReadingQuestionsStore.getState().byPaper).toEqual({});
  });

  it("keeps at most 200 papers, dropping the oldest", () => {
    const { set } = useReadingQuestionsStore.getState();
    for (let i = 0; i < MAX_QUESTION_PAPERS + 3; i++) {
      set(`openalex:W${i}`, [`Question ${i}`], false, new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString());
    }

    const papers = Object.keys(useReadingQuestionsStore.getState().byPaper);
    expect(MAX_QUESTION_PAPERS).toBe(200);
    expect(papers).toHaveLength(200);
    expect(papers).not.toContain("openalex:W0");
    expect(papers).not.toContain("openalex:W2");
    expect(papers).toContain("openalex:W3");
    expect(papers).toContain(`openalex:W${MAX_QUESTION_PAPERS + 2}`);
  });

  it("persists under peer-reading-questions-v1 in this browser only, and loads after mount", async () => {
    useReadingQuestionsStore.getState().set("openalex:W1", ["A question"], false, AT);
    expect(READING_QUESTIONS_STORAGE_KEY).toBe("peer-reading-questions-v1");
    const saved = JSON.parse(storage.items.get("peer-reading-questions-v1") ?? "null");
    expect(saved.state).toEqual({ byPaper: { "openalex:W1": { items: ["A question"], gist: false, updatedAt: AT } }, lastPaperId: "openalex:W1" });

    // A later visit: the page starts empty (skipHydration) with the saved
    // questions in this browser, and reads them back only when the hydrator
    // asks.
    const savedText = storage.items.get("peer-reading-questions-v1") ?? "";
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    storage.items.set("peer-reading-questions-v1", savedText);
    expect(useReadingQuestionsStore.getState().byPaper).toEqual({});
    await useReadingQuestionsStore.persist.rehydrate();
    expect(useReadingQuestionsStore.persist.hasHydrated()).toBe(true);
    expect(useReadingQuestionsStore.getState().byPaper["openalex:W1"].items).toEqual(["A question"]);
  });

  it("reports not-hydrated on the server render, so the first client render matches it", () => {
    function Probe() {
      return createElement("p", null, useReadingQuestionsHydrated() ? "hydrated" : "not yet");
    }
    expect(renderToStaticMarkup(createElement(Probe))).toBe("<p>not yet</p>");
  });
});
