import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildReading } from "@/lib/papers/reading";
import { buildReadingKey, rememberReading } from "@/components/reader/use-reading";
import type { Paper } from "@/types";
import { PaperCard, bodyMinutesOf, cardMinutes } from "./paper-card";

// P10-11 rule 5: the Saved card's "N min read" counted the summary's words, so an uploaded 50-minute paper said "1 min
// read" (two blind readers costed it 0.5). When the paper's body is known — the reading the reading page keeps in this
// browser, no fetch — the card shows the map's total; otherwise the summary's, as before.
function memoryStorage(): Storage {
  const items = new Map<string, string>();
  return {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => void items.set(key, String(value)),
  };
}

const upload: Paper = {
  id: "upload:0123456789abcdef",
  revision: 1,
  title: "An Invented Upload",
  authors: ["A. Writer"],
  relevanceReason: "It is on your topic.",
  venue: "Upload",
  source: "other",
  summaryIntro: "A short summary of the invented paper.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: true,
};
const other: Paper = { ...upload, id: "upload:fedcba9876543210" };

function cachedWithTotal(paper: Paper, totalMinutes: number | undefined) {
  const reading = buildReading(paper, null);
  rememberReading(buildReadingKey(paper.id, paper.fullTextUploadId, paper.revision), {
    ...reading,
    map: totalMinutes === undefined ? undefined : { sections: [], totalMinutes },
  });
}

beforeEach(() => {
  vi.stubGlobal("localStorage", memoryStorage());
  vi.stubGlobal("window", globalThis);
});
afterEach(() => vi.unstubAllGlobals());

describe("the Saved card's minutes are the paper's when its body is known (P10-11 rule 5)", () => {
  it("a paper with a known body shows the map's total, the summary's 1 min otherwise", () => {
    expect(bodyMinutesOf(upload)).toBeNull();
    expect(cardMinutes(upload, bodyMinutesOf(upload))).toBe(1);

    cachedWithTotal(upload, 50);
    expect(bodyMinutesOf(upload)).toBe(50);
    expect(cardMinutes(upload, bodyMinutesOf(upload))).toBe(50);
    // Another paper's reading is not this paper's.
    expect(bodyMinutesOf(other)).toBeNull();
    expect(cardMinutes(other, bodyMinutesOf(other))).toBe(1);
  });

  it("a cached reading with no map, a zero total or a damaged cache is an unknown body", () => {
    cachedWithTotal(upload, undefined);
    expect(bodyMinutesOf(upload)).toBeNull();
    cachedWithTotal(upload, 0);
    expect(bodyMinutesOf(upload)).toBeNull();
    const broken = memoryStorage();
    broken.setItem("peer-reading-v2", "{not json");
    expect(bodyMinutesOf(upload, broken)).toBeNull();
    expect(bodyMinutesOf(upload, { getItem: () => { throw new Error("blocked"); } })).toBeNull();
  });

  it("the first render (the server's, and a hydrating client's) shows the summary's minutes and never reads storage", () => {
    cachedWithTotal(upload, 50);
    const html = renderToStaticMarkup(createElement(PaperCard, { paper: upload }));
    expect(html).toContain("1 min read");
    expect(html).not.toContain("50 min read");
  });
});
