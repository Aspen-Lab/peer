// P0-06 (§1e.2, A's F2): `useModelReport` with its effects running.
//
// `use-model-report.test.ts` mounts the hook with `react-dom/server`, where
// effects never run: it shows the report is READ from the cache on render,
// not that the second open of a private PDF sends no request — the write that
// makes the second open free is in the effect. A's mutation M4 (drop the
// effect's `writeCached`) left every reader test green. Here the hook runs on
// `test-support/hook-runtime` and the one network entry point it uses,
// `streamPaperReport`, is counted.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

const net = vi.hoisted(() => ({
  streamCalls: [] as Array<Record<string, unknown>>,
  jsonCalls: 0,
  /** When set, the stream sends exactly these events (P2-07). */
  script: null as Array<Record<string, unknown>> | null,
  /** Who is signed in (P2-08b): `null` is signed out; a user gets Peer's model. */
  entitlement: null as { userId: string } | null,
  /** P2-08b (§1g.18): per request, whether it was abandoned before it finished,
   *  and how long a request is held after `mode`. */
  flights: [] as Array<{ aborted: boolean; done: boolean }>,
  delayMs: 0,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: async function* (body: Record<string, unknown>, signal?: AbortSignal) {
    net.streamCalls.push(body);
    const flight = { aborted: false, done: false };
    net.flights.push(flight);
    signal?.addEventListener("abort", () => {
      if (!flight.done) flight.aborted = true;
    });
    if (net.script) {
      for (const event of net.script) yield event;
      flight.done = true;
      return;
    }
    yield { type: "mode", aiMode: "tier2" };
    if (net.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, net.delayMs));
    flight.done = true;
    yield { type: "stage", stage: "done", label: "Report ready", pct: 100 };
    yield {
      type: "report",
      report: {
        noLlm: false,
        depth: body.deepReport ? "deep" : "abstract",
        skim: [],
        whatItProposes: { summary: "A report asked for once.", methods: [] },
        resultsAndSignificance: { summary: "", keyResults: [] },
        provenance: { basis: "model-full-text", droppedClaims: 0 },
      },
    };
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async () => {
    net.jsonCalls += 1;
    return { noLlm: true };
  },
}));
vi.mock("@/store/profile", () => ({
  useProfileStore: (select: (state: { entitlement: unknown }) => unknown) => select({ entitlement: net.entitlement }),
}));

import { useEffect, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { buildReading } from "@/lib/papers/reading";
import type { ExtractedDocument } from "@/lib/papers/html-text";
import { useReadingQuestionsStore } from "@/store/reading-questions";
import { readingRoute } from "./reading-map";
import { useModelReport } from "./use-model-report";

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

// The reader's own key, so the hook asks a model: a placeholder string — the
// stream is stubbed, nothing leaves the process.
const profile: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key" };
const base: Paper = {
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
};
const attached: Paper = { ...base, fullTextUploadId: "upload:0123456789abcdef", revision: 1 };
const standalone: Paper = { ...base, id: "upload:fedcba9876543210", revision: 1, textStatus: "ok" };

async function open(paper: Paper, reader: UserProfile = profile, questions?: readonly string[]) {
  const opened = await hookRuntime.mount(() => useModelReport({ paper, profile: reader, questions }));
  opened.unmount();
  return opened.value;
}

describe("useModelReport with effects running — one report request across two opens (P0-06)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    net.streamCalls.length = 0;
    net.jsonCalls = 0;
    net.script = null;
    net.entitlement = null;
    net.flights.length = 0;
    net.delayMs = 0;
  });

  afterEach(() => vi.unstubAllGlobals());

  it("an attached PDF: the first open asks for the deep report once, the second asks for nothing", async () => {
    const first = await open(attached);
    expect(net.streamCalls).toHaveLength(1);
    expect(net.streamCalls[0].deepReport).toBe(true);
    expect(first.report?.whatItProposes.summary).toBe("A report asked for once.");
    expect(first.fresh).toBe(true);

    const second = await open(attached);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(second.report?.whatItProposes.summary).toBe("A report asked for once.");
    expect(second.fresh).toBe(false);
  });

  it("a new revision of the attachment asks again", async () => {
    await open(attached);
    await open(attached);
    await open({ ...attached, revision: 2 });

    expect(net.streamCalls).toHaveLength(2);
  });

  it("a standalone upload: one request across two opens, a new one for a new revision", async () => {
    const deepReader = { ...profile, deepReportEnabled: true };
    await open(standalone, deepReader);
    await open(standalone, deepReader);
    expect(net.streamCalls).toHaveLength(1);
    expect(net.streamCalls[0].deepReport).toBe(true);

    await open({ ...standalone, revision: 2 }, deepReader);

    expect(net.streamCalls).toHaveLength(2);
  });

  // P1-03 (§1f.9): the reader's questions stay in this browser. With
  // questions stored for the paper, the report request is the same request.
  it("sends no question: the report request is unchanged with questions stored for the paper (P1-03)", async () => {
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    await open(attached);

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [attached.id]: { items: ["Quillwortane creep under load"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: attached.id,
    });
    await open(attached);

    expect(net.streamCalls).toHaveLength(2);
    expect(JSON.stringify(net.streamCalls[1])).toBe(JSON.stringify(net.streamCalls[0]));
    expect(JSON.stringify(net.streamCalls[1])).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  // P1-05 (§1f.13): the route the page draws is computed beside the report,
  // in this browser; with a route present the report request is unchanged.
  it("sends no question with a route present: the report request is unchanged (P1-05)", async () => {
    const doc: ExtractedDocument = {
      source: "pdf",
      figureCaptions: [],
      sections: [{ id: "s1", heading: "1 Introduction", canonical: "introduction", text: "Quillwortane parts creep under load. The creep rate rises with the load." }],
    };
    const reading = buildReading(attached, { status: "ok", attempts: [], doc, sourceLink: { url: "https://example.org/p.pdf", kind: "pdf", label: "doi", rank: 1 } });
    const withRoute = async () => {
      const opened = await hookRuntime.mount(() => {
        const report = useModelReport({ paper: attached, profile });
        return { report, route: readingRoute(reading, useReadingQuestionsStore.getState().byPaper[attached.id]) };
      });
      opened.unmount();
      return opened.value;
    };

    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
    const before = await withRoute();
    expect(before.route).toBeUndefined();

    vi.stubGlobal("localStorage", memoryStorage());
    useReadingQuestionsStore.setState({
      byPaper: { [attached.id]: { items: ["Quillwortane creep under load"], gist: false, updatedAt: "2026-10-05T00:00:00.000Z" } },
      lastPaperId: attached.id,
    });
    const after = await withRoute();

    expect(after.route?.vague).toBe(false);
    expect(after.route?.byQuestion[0].sections.s1.tier).toBe("read");
    expect(net.streamCalls).toHaveLength(2);
    expect(JSON.stringify(net.streamCalls[1])).toBe(JSON.stringify(net.streamCalls[0]));
    expect(JSON.stringify(net.streamCalls)).not.toContain("Quillwortane");
    useReadingQuestionsStore.setState({ byPaper: {}, lastPaperId: null });
  });

  // P2-03 (§1g.11 b): the settled questions travel with the deep-report
  // request — in its body, never its URL — and are part of the client's
  // cache key, so each distinct set is one report and an earlier set comes
  // back from the cache.
  it("sends the settled questions in the request body, under a key of their own (P2-03)", async () => {
    const plain = await open(attached);
    vi.stubGlobal("localStorage", memoryStorage());
    const asked = await open(attached, profile, ["Does tungsten delay rafting?", "Why 1100 C?"]);

    expect(net.streamCalls).toHaveLength(2);
    expect(net.streamCalls[1].questions).toEqual(["Does tungsten delay rafting?", "Why 1100 C?"]);
    expect(asked.reportKey).not.toBe(plain.reportKey);
    expect(asked.reportKey.startsWith(plain.reportKey)).toBe(true);
  });

  it("asks again when the settled questions change, and an earlier set comes back from the cache (P2-03)", async () => {
    await open(attached, profile, ["Does tungsten delay rafting?"]);
    await open(attached, profile, ["Does tungsten delay rafting?", "Why 1100 C?"]);
    expect(net.streamCalls).toHaveLength(2);

    await open(attached, profile, ["Does tungsten delay rafting?"]);
    await open(attached, profile, ["Why 1100 C?", "Does tungsten delay rafting?"]);
    expect(net.streamCalls).toHaveLength(2);
  });

  it("without settled questions the request body has no questions key (P2-03)", async () => {
    await open(attached);
    vi.stubGlobal("localStorage", memoryStorage());
    await open(attached, profile, []);

    expect(net.streamCalls).toHaveLength(2);
    for (const body of net.streamCalls) expect(body).not.toHaveProperty("questions");
    expect(JSON.stringify(net.streamCalls[1])).toBe(JSON.stringify(net.streamCalls[0]));
  });

  // P2-07 (§1g.9 e, B's O-B1): the route sends the deep-report quota
  // decision BEFORE `mode` — a refused deep open is an ordinary tier 1
  // stream with the notice in front. The reader must read it as one: one
  // request, the tier 1 report shown, the notice carried on it — not a
  // thrown stream and a second, JSON request that charges again.
  it("reads a quota event that comes before mode: one request, the report shown, the notice carried (P2-07)", async () => {
    const quota = { kind: "deep_report", reason: "exhausted" };
    net.script = [
      { type: "quota", quota },
      { type: "mode", aiMode: "tier1" },
      {
        type: "report",
        report: {
          noLlm: false,
          depth: "abstract",
          skim: [],
          whatItProposes: { summary: "An abstract-tier report, the deep one refused.", methods: [] },
          resultsAndSignificance: { summary: "", keyResults: [] },
          provenance: { basis: "model-abstract", droppedClaims: 0 },
        },
      },
      { type: "stage", stage: "done", label: "Report ready", pct: 100 },
    ];

    const opened = await open(attached);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(opened.failed).toBe(false);
    expect(opened.report?.whatItProposes.summary).toBe("An abstract-tier report, the deep one refused.");
    expect(opened.report?.quota).toEqual(quota);
  });

  // P2-08b (§1g.18, F3): the hook keeps one request in flight and never aborts
  // it for a different set of questions (the flow test in `question-box.flow
  // .test.tsx` shows that end to end). These are the two guards that hold the
  // hook's own branches: what ends a request is not asked again, and anything
  // but the questions changing still abandons it.
  describe("one request in flight; only a change of something else abandons it (P2-08b, §1g.18)", () => {
    it("a request that ends with a tier 0 outcome is sent once, not again when it finishes", async () => {
      // `settle(null, false)` writes no cache, so without the guard that the key
      // which just ended is done, the re-run it triggers would send it forever.
      net.script = [{ type: "mode", aiMode: "tier0" }];

      const opened = await open(attached);

      expect(net.streamCalls).toHaveLength(1);
      expect(opened.failed).toBe(false);
    });

    it("a different paper while a request is in flight abandons it and asks for the new one", async () => {
      net.delayMs = 200;
      let current: Paper = { ...attached, id: "openalex:W7000000011", fullTextUploadId: "upload:0123456789abcde1" };
      let rounds = 0;
      const opened = await hookRuntime.mount(
        () => {
          const state = useModelReport({ paper: current, profile });
          const [tick, setTick] = useState(0);
          useEffect(() => {
            rounds += 1;
            // Round 3 is well inside the first request's 200 ms.
            if (rounds === 3) current = { ...attached, id: "openalex:W7000000012", fullTextUploadId: "upload:0123456789abcde2" };
            if (rounds > 60) return;
            const timer = setTimeout(() => setTick((n) => n + 1), 1);
            return () => clearTimeout(timer);
          }, [tick]);
          return state;
        },
        { maxRounds: 100 },
      );
      opened.unmount();

      expect(net.streamCalls).toHaveLength(2);
      // The first was abandoned while it was held; the second ran to its end.
      expect(net.flights.map((flight) => flight.aborted)).toEqual([true, false]);
      expect(net.flights[1].done).toBe(true);
    });

    it("leaving the page while a request is in flight abandons it", async () => {
      net.delayMs = 200;
      // `mount` returns once nothing is left to do, which is while the request is held.
      const opened = await hookRuntime.mount(() => useModelReport({ paper: attached, profile }));
      expect(net.flights).toEqual([{ aborted: false, done: false }]);

      opened.unmount();

      expect(net.flights).toEqual([{ aborted: true, done: false }]);
    });
  });

  // P2-08b (§1g.17, F2): the /privacy entry says the questions travel when Peer
  // writes a deep report. They used to ride every request, so a reader with no
  // deep report asked for sent each settle to the server (and, with a key, paid
  // a model call for it) for an answers block that never appears. Now the
  // questions name a request, and ride it, only when it is a deep one.
  describe("the questions travel only with a deep request (P2-08b, §1g.17)", () => {
    const FIRST = "synthetic first question";
    const SECOND = "synthetic second question";

    /** One mounted hook whose settled questions grow by one, twice, as a reader's do. */
    async function settleTwice(paper: Paper, reader: UserProfile) {
      const sets: readonly (readonly string[])[] = [[], [FIRST], [FIRST, SECOND]];
      let step = 0;
      const keys = new Set<string>();
      const opened = await hookRuntime.mount(() => {
        const state = useModelReport({ paper, profile: reader, questions: sets[step] });
        keys.add(state.reportKey);
        const [tick, setTick] = useState(0);
        // After each render, move on to the next settled set (a state change re-renders).
        useEffect(() => {
          if (step < sets.length - 1) {
            step += 1;
            setTick(step);
          }
        }, [tick]);
        return state;
      });
      opened.unmount();
      return { keys, state: opened.value };
    }

    const notDeep: Array<[string, () => { paper: Paper; reader: UserProfile }]> = [
      ["signed out, no key", () => ({ paper: base, reader: { ...defaultProfile } })],
      ["the reader's own key, deep reports off", () => ({ paper: base, reader: { ...profile, deepReportEnabled: false } })],
      [
        "signed in, deep reports off",
        () => {
          net.entitlement = { userId: "reader-1" };
          return { paper: base, reader: { ...defaultProfile } };
        },
      ],
    ];

    for (const [name, setup] of notDeep) {
      it(`${name}: a settle sends no request and no question`, async () => {
        const { paper, reader } = setup();

        const { keys } = await settleTwice(paper, reader);

        expect(net.streamCalls).toHaveLength(1);
        expect(net.streamCalls[0].deepReport).toBe(false);
        for (const body of net.streamCalls) expect(body).not.toHaveProperty("questions");
        expect(JSON.stringify(net.streamCalls)).not.toContain(FIRST);
        // One key: the questions are not part of a request that does not carry them.
        expect(keys.size).toBe(1);
      });
    }

    // The control: with a deep report asked for, the settled set still names the
    // request and travels in its body, as P2-03 ruled.
    it("a deep request still carries them: each set has its own key and the latest set goes out", async () => {
      const { keys } = await settleTwice(base, { ...profile, deepReportEnabled: true });

      expect(keys.size).toBe(3);
      expect(net.streamCalls.length).toBeGreaterThanOrEqual(1);
      expect(net.streamCalls.every((body) => body.deepReport === true)).toBe(true);
      expect(net.streamCalls[net.streamCalls.length - 1].questions).toEqual([FIRST, SECOND]);
    });
  });
});
