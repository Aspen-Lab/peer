// P9-48 (A's P9-W3 §4 "Found, not a rubric kind", §6 item 1): the report cache.
//
// A deep report's `whatItProposes.figureImageUrl` (and a key result's) is a
// `data:` URL when the figure was rendered from the PDF: 1.08 M characters
// for one figure. The cache stored it once per cache key — one entry per
// (paper, depth, project, provider, question set) — and capped itself by a
// COUNT (40), so the origin's `localStorage` (5.24 M characters in the walk's
// browser) filled at the fourth entry. `writeCached`'s `catch` swallows the
// quota error, so from the fifth question set on a reload found nothing and
// asked the model again with the reader's own key (measured: reload calls 0,
// 0, 0, then 1, 1), and the feed, the profile, the reading preferences and the
// question store were left 0.8 M.
//
// Rule 1: no figure by value in the cache. Rule 2: the cache has a character
// budget, not only a count. Rule 3: nothing else changes (the key, the
// entry's shape apart from the figure, the TTL, the reader's key never in it).
//
// The quota is a stub of 5 M characters (key + value, summed over the origin,
// `QuotaExceededError` on the write that would pass it) — the project's Vitest
// has no DOM, so `localStorage` is stood in for, as the other hook tests do.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

const net = vi.hoisted(() => ({
  streamCalls: [] as Array<Record<string, unknown>>,
  /** What the stream's `report` event carries for a request body. */
  report: null as null | ((body: Record<string, unknown>) => unknown),
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: async function* (body: Record<string, unknown>) {
    net.streamCalls.push(body);
    yield { type: "mode", aiMode: "tier2" };
    yield { type: "report", report: net.report!(body) };
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async () => ({ noLlm: true }),
}));
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

import { hookRuntime } from "@/test-support/hook-runtime";
import { captureConsole } from "@/test-support/console-capture";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { emptyReport, type PaperReport } from "@/lib/papers/report";
import { buildReportKey, REPORT_CACHE_BUDGET_CHARS, rememberReport, useModelReport, withoutFigureData } from "./use-model-report";

const STORAGE_KEY = "peer-paper-report-v8";
/** The ceiling the brief names for the cache's budget (rule 2: "≤ 1.5 M characters"). */
const CEILING = 1_500_000;
/** The origin's quota in the stub: A's P9-W3 measured 5.24 M characters in its browser. */
const QUOTA = 5_000_000;
/** The measured length of one figure `data:` URL (A's P9-W3 §4: 1,081,390). */
const FIGURE_CHARS = 1_081_390;
const KEY_SENTINEL = "placeholder-not-a-key";

// ── the stubs ─────────────────────────────────────────────────────────

/** A `localStorage` that counts key + value characters over the origin and
 *  refuses, like a browser, the write that would pass `limit`. */
function quotaStorage(limit: number, seed: Record<string, string> = {}) {
  const items = new Map<string, string>(Object.entries(seed));
  let refused = 0;
  const used = () => [...items].reduce((n, [key, value]) => n + key.length + value.length, 0);
  const storage: Storage = {
    get length() {
      return items.size;
    },
    clear: () => items.clear(),
    getItem: (key) => items.get(key) ?? null,
    key: (index) => [...items.keys()][index] ?? null,
    removeItem: (key) => void items.delete(key),
    setItem: (key, value) => {
      const text = String(value);
      const after = used() - (items.has(key) ? key.length + items.get(key)!.length : 0) + key.length + text.length;
      if (after > limit) {
        refused += 1;
        throw new DOMException("The quota has been exceeded.", "QuotaExceededError");
      }
      items.set(key, text);
    },
  };
  return { storage, used, refused: () => refused };
}

/** A `data:` figure of exactly `chars` characters. */
function dataUrl(chars = FIGURE_CHARS): string {
  const head = "data:image/png;base64,";
  return head + "iVBORw0KGgoAAAANSUhEUgAA".repeat(Math.ceil(chars / 24)).slice(0, chars - head.length);
}

function claim(text: string) {
  return { text, evidence: `${text} (a verbatim sentence of the paper)` };
}

/** A deep report the size of a real one (a few KB), with figures where given. */
function report(
  tag: string,
  figures: { proposal?: string | null; results?: Array<string | null> } = {},
  extraSummary = "",
): PaperReport {
  const results = figures.results ?? [];
  return {
    ...emptyReport("deep"),
    noLlm: false,
    skim: [claim(`Skim one of ${tag}.`), claim(`Skim two of ${tag}.`)],
    whatItProposes: {
      summary: `The proposal of ${tag}. ${extraSummary}`,
      methods: [claim(`Method one of ${tag}.`), claim(`Method two of ${tag}.`)],
      figureLabel: "Figure 2",
      ...(figures.proposal !== undefined ? { figureImageUrl: figures.proposal } : {}),
      figureCaption: "Figure 2. Creep curves at three loads.",
      figureSource: "publisher",
    },
    resultsAndSignificance: {
      summary: `The headline of ${tag}.`,
      keyResults: results.map((figure, i) => ({
        title: `Result ${i + 1}`,
        detail: `What result ${i + 1} of ${tag} shows.`,
        evidence: `A sentence of the paper for result ${i + 1}.`,
        figureLabel: `Figure ${i + 3}`,
        figureImageUrl: figure,
        figureCaption: `Figure ${i + 3}. A later plot.`,
        figureSource: "publisher",
      })),
    },
  };
}

/** A boolean, so a failure prints "true", not a megabyte of base64. */
function holdsDataUrl(raw: string): boolean {
  return raw.includes("data:image/");
}

function storedCache(): Record<string, { report: PaperReport; savedAt: number }> {
  return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
}

const profile: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: KEY_SENTINEL };
const attached: Paper = {
  id: "openalex:W7000000001",
  title: "A Paper With A Private PDF",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  fullTextUploadId: "upload:0123456789abcdef",
  revision: 1,
};

async function open(questions?: readonly string[]) {
  const opened = await hookRuntime.mount(() => useModelReport({ paper: attached, profile, questions }));
  opened.unmount();
  return opened.value;
}
const keyFor = (questions: readonly string[] = []) =>
  buildReportKey(attached, "deep", "", profile.feedAiProvider, questions);

beforeEach(() => {
  vi.stubGlobal("localStorage", quotaStorage(QUOTA).storage);
  // The hook listens for `pagehide` / `pageshow` on `window`; nothing here fires them.
  vi.stubGlobal("window", Object.assign(Object.create(globalThis) as object, { addEventListener: () => {}, removeEventListener: () => {} }));
  net.streamCalls.length = 0;
  net.report = () => report("the stream", { proposal: dataUrl() });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// ── rule 1 ────────────────────────────────────────────────────────────

describe("the report cache holds no figure by value (P9-48 rule 1)", () => {
  it("P12-28: an old persisted report cannot reopen a stale derived figure URL; the normal request refreshes it once", async () => {
    const old = report("old-engine", { proposal: "/api/papers/arxiv%3A2610.00001/figure-image?page=1&fig=4" });
    localStorage.setItem("peer-paper-report-v7", JSON.stringify({ [keyFor()]: { report: old, savedAt: Date.now() } }));
    await open();
    expect(net.streamCalls).toHaveLength(1);
    await open();
    expect(net.streamCalls).toHaveLength(1);
  });

  it("stores no data: URL — the proposal's, a result's, or a figure two places share", () => {
    const shared = dataUrl(300_000);
    rememberReport(keyFor(), report("r", { proposal: shared, results: [shared, dataUrl(200_000), null] }));

    const raw = localStorage.getItem(STORAGE_KEY)!;
    expect(holdsDataUrl(raw)).toBe(false);
    expect(raw.length).toBeLessThan(50_000);

    const stored = storedCache()[keyFor()].report;
    expect(stored.whatItProposes.figureImageUrl ?? "").not.toMatch(/^data:/);
    for (const result of stored.resultsAndSignificance.keyResults) expect(result.figureImageUrl ?? "").not.toMatch(/^data:/);
  });

  it("keeps the figure's label, caption and source, and every word of the report", () => {
    const original = report("r", { proposal: dataUrl(300_000), results: [dataUrl(300_000)] });
    rememberReport(keyFor(), original);

    const stored = storedCache()[keyFor()].report;
    expect(stored.whatItProposes.figureLabel).toBe("Figure 2");
    expect(stored.whatItProposes.figureCaption).toBe("Figure 2. Creep curves at three loads.");
    expect(stored.whatItProposes.figureSource).toBe("publisher");
    expect(stored.resultsAndSignificance.keyResults[0].figureLabel).toBe("Figure 3");
    expect(stored.resultsAndSignificance.keyResults[0].figureCaption).toBe("Figure 3. A later plot.");
    expect(stored.skim).toEqual(original.skim);
    expect(stored.whatItProposes.methods).toEqual(original.whatItProposes.methods);
    expect(stored.whatItProposes.summary).toBe(original.whatItProposes.summary);
    expect(stored.resultsAndSignificance.keyResults[0].detail).toBe(original.resultsAndSignificance.keyResults[0].detail);
  });

  it("leaves a figure that is already small alone: an https URL, the figure route's URL, null", () => {
    const route = "/api/papers/upload%3A0123456789abcdef/figure-image?page=4&fig=2";
    const original = report("r", { proposal: "https://arxiv.org/html/2607.00001v1/x1.png", results: [route, null] });
    rememberReport(keyFor(), original);

    expect(storedCache()[keyFor()].report).toEqual(original);
  });

  it("this visit still draws the figure the stream delivered; only the stored copy is without it", async () => {
    const first = await open();
    expect(net.streamCalls).toHaveLength(1);
    expect(first.report?.whatItProposes.figureImageUrl === dataUrl()).toBe(true);
    expect(first.fresh).toBe(true);

    const second = await open();

    expect(net.streamCalls).toHaveLength(1);
    expect(second.fresh).toBe(false);
    expect(second.report?.whatItProposes.summary).toContain("The proposal of the stream.");
    expect(second.report?.whatItProposes.figureImageUrl ?? "").not.toMatch(/^data:/);
    expect(second.report?.whatItProposes.figureLabel).toBe("Figure 2");
  });

  it("rewrites a cache an earlier build left with figures by value: the reports stay, the figures go", () => {
    const old = (tag: string, savedAt: number) => ({ report: report(tag, { proposal: dataUrl() }), savedAt });
    const now = Date.now();
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ [keyFor(["a"])]: old("a", now - 3000), [keyFor(["b"])]: old("b", now - 2000), [keyFor(["c"])]: old("c", now - 1000) }),
    );
    expect(localStorage.getItem(STORAGE_KEY)!.length).toBeGreaterThan(3_000_000);

    rememberReport(keyFor(["d"]), report("d", { proposal: dataUrl() }));

    expect(holdsDataUrl(localStorage.getItem(STORAGE_KEY)!)).toBe(false);
    expect(Object.keys(storedCache()).sort()).toEqual([keyFor(["a"]), keyFor(["b"]), keyFor(["c"]), keyFor(["d"])].sort());
    expect(storedCache()[keyFor(["a"])].report.whatItProposes.summary).toContain("The proposal of a.");
  });
});

describe("withoutFigureData — the copy of a report the cache keeps (P9-48 rule 1)", () => {
  it("is the very report when it holds no data: figure", () => {
    const plain = report("p", { proposal: "https://arxiv.org/html/2607.00001v1/x1.png", results: [null, "/api/papers/arxiv%3A2607.00001/figure-image?page=3&fig=1"] });

    expect(withoutFigureData(plain)).toBe(plain);
  });

  it("drops the field — absent, as where no picture was attached — and leaves the report it was given alone", () => {
    const figure = dataUrl(5000);
    const held = report("h", { proposal: figure, results: [figure, "https://example.org/y.png"] });

    const stored = withoutFigureData(held);

    expect("figureImageUrl" in stored.whatItProposes).toBe(false);
    expect("figureImageUrl" in stored.resultsAndSignificance.keyResults[0]).toBe(false);
    expect(stored.resultsAndSignificance.keyResults[1].figureImageUrl).toBe("https://example.org/y.png");
    expect(held.whatItProposes.figureImageUrl === figure).toBe(true);
    expect(held.resultsAndSignificance.keyResults[0].figureImageUrl === figure).toBe(true);
  });

  it("reads a cache entry of an older shape without throwing", () => {
    const old = { skim: [], whatItProposes: { summary: "old", methods: [], figureImageUrl: dataUrl(5000) } } as unknown as PaperReport;

    expect(() => withoutFigureData(old)).not.toThrow();
    expect("figureImageUrl" in withoutFigureData(old).whatItProposes).toBe(false);
  });
});

// ── rule 2 ────────────────────────────────────────────────────────────

describe("the report cache has a character budget, not only a count (P9-48 rule 2)", () => {
  it("evicts the oldest entries until the cache and the new entry are under the budget", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const sets = ["one", "two", "three", "four", "five"];
    for (const [i, set] of sets.entries()) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, i)));
      rememberReport(keyFor([set]), report(set, {}, "w".repeat(400_000)));

      const raw = localStorage.getItem(STORAGE_KEY)!;
      expect(raw.length).toBeLessThanOrEqual(CEILING);
      expect(Object.keys(storedCache())).toContain(keyFor([set]));
    }

    const kept = sets.filter((set) => keyFor([set]) in storedCache());
    // the newest stay, the oldest went: what is kept is a suffix of the writes, and more than one of them
    expect(kept).toEqual(sets.slice(sets.length - kept.length));
    expect(kept.length).toBeGreaterThanOrEqual(2);
    expect(kept.length).toBeLessThan(sets.length);
  });

  it("does not cache an entry that alone exceeds the budget; the cache is as it was, and the log is a count", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, 0)));
    rememberReport(keyFor(["small"]), report("small"));
    const before = localStorage.getItem(STORAGE_KEY);

    const marker = "TheWordsOfAnUnpublishedPaperXyzzy";
    const log = captureConsole();
    try {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, 1)));
      rememberReport(keyFor(["giant"]), report("giant", {}, marker + "w".repeat(CEILING + 100_000)));

      expect(localStorage.getItem(STORAGE_KEY) === before).toBe(true);
      expect(Object.keys(storedCache())).toEqual([keyFor(["small"])]);
      expect(log.calls()).toBe(1);
      // a count (the entry's length), never its words, its key or its project
      expect(log.text()).toMatch(/\b\d{7}\b/);
      expect(log.text()).not.toContain(marker);
      expect(log.text()).not.toContain(keyFor(["giant"]));
      expect(log.text()).not.toContain("The proposal of giant");
    } finally {
      log.restore();
    }
  });

  it("the budget is a named constant, within the ceiling, that holds the count's forty reports with room", () => {
    expect(REPORT_CACHE_BUDGET_CHARS).toBeLessThanOrEqual(CEILING);
    // forty reports of 25 KB (REPORT_CAPS bounds every field) are a million characters
    expect(REPORT_CACHE_BUDGET_CHARS).toBeGreaterThan(40 * 25_000);
  });

  it("counts the serialized cache exactly: an entry that makes the text the budget is cached, one character more is not", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, 0)));
    rememberReport(keyFor(["probe"]), report("probe"));
    const bare = localStorage.getItem(STORAGE_KEY)!.length;
    localStorage.removeItem(STORAGE_KEY);
    const room = REPORT_CACHE_BUDGET_CHARS - bare;

    rememberReport(keyFor(["probe"]), report("probe", {}, "w".repeat(room)));
    expect(localStorage.getItem(STORAGE_KEY)!.length).toBe(REPORT_CACHE_BUDGET_CHARS);

    localStorage.removeItem(STORAGE_KEY);
    const log = captureConsole();
    try {
      rememberReport(keyFor(["probe"]), report("probe", {}, "w".repeat(room + 1)));
      expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    } finally {
      log.restore();
    }
  });

  it("never evicts the entry it is writing, even when every entry was written in the same millisecond", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, 0)));
    const sets = ["one", "two", "three", "four", "five"];
    for (const set of sets) {
      rememberReport(keyFor([set]), report(set, {}, "w".repeat(400_000)));
      expect(Object.keys(storedCache())).toContain(keyFor([set]));
      expect(localStorage.getItem(STORAGE_KEY)!.length).toBeLessThanOrEqual(CEILING);
    }
    // the oldest written went first
    expect(Object.keys(storedCache())).not.toContain(keyFor(["one"]));
  });

  it("still keeps at most forty entries when they are small", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 43; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, i)));
      rememberReport(keyFor([`q${i}`]), report(`q${i}`));
    }

    const kept = Object.keys(storedCache());
    expect(kept).toHaveLength(40);
    expect(kept).not.toContain(keyFor(["q0"]));
    expect(kept).not.toContain(keyFor(["q2"]));
    expect(kept).toContain(keyFor(["q3"]));
    expect(kept).toContain(keyFor(["q42"]));
  });

  it("an entry that fits but replaces its own key counts once, not twice", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    for (let i = 0; i < 6; i++) {
      vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, i)));
      rememberReport(keyFor(["same"]), report(`again ${i}`, {}, "w".repeat(600_000)));
    }

    expect(Object.keys(storedCache())).toEqual([keyFor(["same"])]);
    expect(storedCache()[keyFor(["same"])].report.whatItProposes.summary).toContain("again 5");
  });
});

// ── the measurement ───────────────────────────────────────────────────

describe("six question sets with a 1.08 M figure, then a 50 k profile write, on a 5 M quota (P9-48)", () => {
  const sets: string[][] = [[], ["Does tungsten delay rafting?"], ["Why 1100 C?"], ["How was the creep rate measured?"], ["Is the alloy cast or wrought?"], ["What limits the study?"]];

  it("every write lands, no reload asks the model again, and the origin keeps room for the rest", async () => {
    // The rest of the origin — the feed, the preferences, the question store —
    // 0.65 M characters: the walk's browser left 0.8 M of 5.24 M with four entries in, and
    // on this 5 M stub four entries (4.33 M) and 0.65 M leave room for neither a fifth nor
    // a 50 k profile write, which is what the head did.
    const origin = quotaStorage(QUOTA, { "peer-feed": "f".repeat(650_000) });
    vi.stubGlobal("localStorage", origin.storage);
    net.report = (body) => report(`set ${JSON.stringify(body.questions ?? [])}`, { proposal: dataUrl() });

    for (const [i, questions] of sets.entries()) {
      const first = await open(questions);
      expect(first.report).not.toBeNull();
      expect(net.streamCalls).toHaveLength(i + 1);

      const reload = await open(questions);
      // the reload reads the report back: no second request, and it is not a fresh one
      expect(net.streamCalls).toHaveLength(i + 1);
      expect(reload.fresh).toBe(false);
      expect(reload.report?.whatItProposes.summary).toBe(first.report?.whatItProposes.summary);
    }

    expect(origin.refused()).toBe(0);
    expect(localStorage.getItem(STORAGE_KEY)!.length).toBeLessThanOrEqual(CEILING);
    expect(() => localStorage.setItem("peer-profile", "p".repeat(50_000))).not.toThrow();
    expect(origin.refused()).toBe(0);
    expect(holdsDataUrl(localStorage.getItem(STORAGE_KEY)!)).toBe(false);
  });

  it("one cached entry is a few KB, not 1.08 M", () => {
    rememberReport(keyFor(), report("one", { proposal: dataUrl() }));

    const entry = JSON.stringify(storedCache()[keyFor()]);
    expect(entry.length).toBeLessThan(20_000);
  });
});

// ── rule 3 ────────────────────────────────────────────────────────────

describe("nothing else changes (P9-48 rule 3)", () => {
  it("the reader's key is in no cached byte", async () => {
    await open(["Does tungsten delay rafting?"]);

    expect(net.streamCalls[0]).toMatchObject({ llmOverride: { apiKey: KEY_SENTINEL } });
    expect(localStorage.getItem(STORAGE_KEY)).not.toBeNull();
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain(KEY_SENTINEL);
  });

  it("an entry is { report, savedAt } under the same key, and a report with no data: figure is stored as it is", () => {
    const original = report("plain", { proposal: null, results: [null] });
    rememberReport(keyFor(), original);

    const stored = storedCache();
    expect(Object.keys(stored)).toEqual([keyFor()]);
    expect(Object.keys(stored[keyFor()]).sort()).toEqual(["report", "savedAt"]);
    expect(stored[keyFor()].savedAt).toBeGreaterThan(0);
    expect(stored[keyFor()].report).toEqual(original);
  });

  it("an expired deep report is still not read back", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 1, 12, 0, 0)));
    rememberReport(keyFor(), report("old", { proposal: dataUrl(1000) }));
    vi.setSystemTime(new Date(Date.UTC(2026, 9, 12, 12, 0, 0)));

    const reopened = await open();

    expect(net.streamCalls).toHaveLength(1);
    expect(reopened.fresh).toBe(true);
  });
});
