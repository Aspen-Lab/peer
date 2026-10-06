// P2-09b (§1g.14, second amendment): the quota the hook hands the page.
//
// P2-09 mounted the quota notice on `report.quota`. A refused deep read often
// has no report to carry it: a `company_budget` refusal is an `emptyReport`
// (`noLlm: true`) that `reportOutcome` turns into "no model layer", and a
// `quota` event after `mode` settles `report: null` before any report arrives.
// So the hook keeps the quota itself — `ModelReportState.quota`, the last one
// the server sent for the current key, whether or not a report is shown — and
// the page reads that. The report keeps carrying its own `quota`
// (`use-model-report.effects.test.ts`, P2-07, is untouched and still pins it).
//
// The hook runs on `test-support/hook-runtime` with its effects, as the P0-06
// tests do; the one network entry point, `streamPaperReport`, is scripted and
// counted. All data here is synthetic quota objects: no question text.
import { createElement, useEffect, useState } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

const net = vi.hoisted(() => ({
  streamCalls: [] as Array<Record<string, unknown>>,
  jsonCalls: 0,
  /** The events the stream sends, per request, in order; the last repeats. */
  scripts: [] as Array<Array<Record<string, unknown>>>,
  /** What the JSON transport answers. */
  json: { noLlm: true } as Record<string, unknown>,
  /** Who is signed in: with no key of their own, Peer's model is the reader's. */
  entitlement: null as { userId: string } | null,
}));

vi.mock("@/lib/papers/report-stream", () => ({
  streamPaperReport: async function* (body: Record<string, unknown>) {
    net.streamCalls.push(body);
    const script = net.scripts[Math.min(net.streamCalls.length, net.scripts.length) - 1] ?? [];
    for (const event of script) yield event;
  },
}));
vi.mock("@/lib/api", () => ({
  apiFetch: async () => {
    net.jsonCalls += 1;
    return net.json;
  },
}));
vi.mock("@/store/profile", () => ({
  useProfileStore: (select: (state: { entitlement: unknown }) => unknown) => select({ entitlement: net.entitlement }),
}));

import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { QUOTA } from "./copy";
import { QuotaNotice } from "./quota-notice";
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

// With the reader's own key the hook asks a model (a placeholder string: the
// stream is stubbed, nothing leaves the process); without one, and signed in,
// Peer's model is the one asked, and the JSON transport sends no override.
const byok: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key" };
const signedIn: UserProfile = { ...defaultProfile, deepReportEnabled: true };
const paper: Paper = {
  id: "openalex:W7000000009",
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

const breaker: QuotaSignal = { kind: "breaker", reason: "exhausted", remaining: 0, resetsAt: "2026-10-07T00:00:00.000Z" };
const allowance: QuotaSignal = { kind: "deep_report", reason: "exhausted", remaining: 0, resetsAt: "2026-10-07T00:00:00.000Z" };
const companyBudget: QuotaSignal = {
  kind: "company_budget",
  reason: "exhausted",
  remaining: 0,
  resetsAt: "2026-10-07T00:00:00.000Z",
};

const shorterReport = {
  noLlm: false,
  depth: "abstract",
  skim: [],
  whatItProposes: { summary: "An abstract-tier report, the deep one refused.", methods: [] },
  resultsAndSignificance: { summary: "", keyResults: [] },
  provenance: { basis: "model-abstract", droppedClaims: 0 },
};
/** What `generateShallowReport` returns when the company budget refuses it. */
const refusedFallback = { noLlm: true, quota: companyBudget };

async function open(reader: UserProfile, questions?: readonly string[]) {
  const opened = await hookRuntime.mount(() => useModelReport({ paper, profile: reader, questions }));
  opened.unmount();
  return opened.value;
}

describe("useModelReport hands the page the server's quota (P2-09b, §1g.14 amendment 2)", () => {
  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
    net.streamCalls.length = 0;
    net.jsonCalls = 0;
    net.scripts = [];
    net.json = { noLlm: true };
    net.entitlement = null;
  });

  afterEach(() => vi.unstubAllGlobals());

  // The ruled order on the stream for a refused deep read: the notice first,
  // then an ordinary tier 1 stream. The report carries it (P2-07) and so does
  // the hook.
  it("a first-quota stream (quota, mode, report): the report carries it and so does the hook", async () => {
    net.scripts = [
      [
        { type: "quota", quota: allowance },
        { type: "mode", aiMode: "tier1" },
        { type: "report", report: shorterReport },
        { type: "stage", stage: "done", label: "Report ready", pct: 100 },
      ],
    ];

    const opened = await open(byok);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(opened.failed).toBe(false);
    expect(opened.report?.quota).toEqual(allowance);
    expect(opened.quota).toEqual(allowance);
  });

  // `finish()` in the route sends a refusal it learned only after `mode`, as a
  // `quota` event ahead of the report — and the hook stops there with
  // `report: null`. The breaker kind is the brief's; the branch does not care.
  it("a quota after mode (kind breaker): no report, not a failure, and the quota is kept", async () => {
    net.scripts = [[{ type: "mode", aiMode: "tier2" }, { type: "quota", quota: breaker }]];

    const opened = await open(byok);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(opened.report).toBeNull();
    expect(opened.failed).toBe(false);
    expect(opened.quota?.kind).toBe("breaker");
    expect(opened.quota).toEqual(breaker);
  });

  // The company budget's own sequence on the stream, as `finish()` sends it:
  // mode, the quota event, then the empty fallback report that carries it.
  it("a company-budget refusal on the stream: no report, not a failure, quota.kind company_budget", async () => {
    net.scripts = [
      [
        { type: "mode", aiMode: "tier1" },
        { type: "stage", stage: "writing", label: "Writing the report", pct: 20 },
        { type: "quota", quota: companyBudget },
        { type: "report", report: refusedFallback },
        { type: "stage", stage: "done", label: "Report ready", pct: 100 },
      ],
    ];

    const opened = await open(byok);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(0);
    expect(opened.report).toBeNull();
    expect(opened.failed).toBe(false);
    expect(opened.quota?.kind).toBe("company_budget");
  });

  // The JSON transport: no mode event, so the reader's own key says whether a
  // model was asked. A signed-in reader without a key was not asked on their
  // own account, so a `noLlm` fallback is "no model layer" — and carries the
  // company-budget quota the server put on it.
  it("a company-budget quota on a noLlm fallback over JSON: no report, not a failure, quota.kind company_budget", async () => {
    net.entitlement = { userId: "reader-1" };
    net.scripts = [[{ type: "error", message: "stream unavailable" }]];
    net.json = refusedFallback;

    const opened = await open(signedIn);

    expect(net.streamCalls).toHaveLength(1);
    expect(net.jsonCalls).toBe(1);
    expect(opened.report).toBeNull();
    expect(opened.failed).toBe(false);
    expect(opened.quota?.kind).toBe("company_budget");
  });

  it("a shown report over JSON keeps its quota in the hook too", async () => {
    net.scripts = [[{ type: "error", message: "stream unavailable" }]];
    net.json = { ...shorterReport, quota: allowance };

    const opened = await open(byok);

    expect(net.jsonCalls).toBe(1);
    expect(opened.report?.quota).toEqual(allowance);
    expect(opened.quota).toEqual(allowance);
  });

  it("a quota first and then tier 0 (no model layer): no report, and the quota is still kept", async () => {
    net.scripts = [[{ type: "quota", quota: allowance }, { type: "mode", aiMode: "tier0" }]];

    const opened = await open(byok);

    expect(opened.report).toBeNull();
    expect(opened.failed).toBe(false);
    expect(opened.quota).toEqual(allowance);
  });

  // `fail()` is the model failing: the page says that, and the shorter-report
  // line would describe a report that is not there.
  it("after fail() the quota is null: the model was asked and could not finish", async () => {
    net.scripts = [
      [
        { type: "quota", quota: allowance },
        { type: "mode", aiMode: "tier1" },
        { type: "report", report: { noLlm: true } },
      ],
    ];

    const opened = await open(byok);

    expect(opened.failed).toBe(true);
    expect(opened.report).toBeNull();
    expect(opened.quota).toBeNull();
  });

  it("over JSON, a noLlm fallback with a quota for a reader whose model was asked is a failure and keeps no quota", async () => {
    net.scripts = [[{ type: "error", message: "stream unavailable" }]];
    net.json = refusedFallback;

    const opened = await open(byok);

    expect(opened.failed).toBe(true);
    expect(opened.quota).toBeNull();
  });

  it("is null when the server sent no quota, on a shown report and on none", async () => {
    net.scripts = [[{ type: "mode", aiMode: "tier2" }, { type: "report", report: shorterReport }]];
    const shown = await open(byok);
    expect(shown.report).not.toBeNull();
    expect(shown.quota).toBeNull();

    vi.stubGlobal("localStorage", memoryStorage());
    net.scripts = [[{ type: "mode", aiMode: "tier0" }]];
    const absent = await open(byok);
    expect(absent.report).toBeNull();
    expect(absent.quota).toBeNull();
  });

  // A cached report is the report as it was shown, quota and all: the second
  // open asks for nothing, and the hook reads the quota off the cache hit.
  it("a cache hit gives the quota its report carried, and null when it carried none", async () => {
    net.scripts = [
      [
        { type: "quota", quota: allowance },
        { type: "mode", aiMode: "tier1" },
        { type: "report", report: shorterReport },
      ],
    ];
    const first = await open(byok);
    expect(first.quota).toEqual(allowance);

    const second = await open(byok);

    expect(net.streamCalls).toHaveLength(1);
    expect(second.fresh).toBe(false);
    expect(second.quota).toEqual(allowance);

    vi.stubGlobal("localStorage", memoryStorage());
    net.streamCalls.length = 0;
    net.scripts = [[{ type: "mode", aiMode: "tier2" }, { type: "report", report: shorterReport }]];
    await open(byok);
    const plain = await open(byok);
    expect(net.streamCalls).toHaveLength(1);
    expect(plain.report).not.toBeNull();
    expect(plain.quota).toBeNull();
  });

  // The key names the request; a new key is a new request with its own answer,
  // and the earlier key's quota must not stand over it. Each render of one
  // mounted hook is recorded: the first key settles with a quota and renders
  // with it, then an effect changes the settled-question set, and the second
  // key — from its first render, before its own request has answered — never
  // shows the first key's quota.
  it("a new key clears it: the next key's renders never carry the earlier key's quota", async () => {
    let questions: readonly string[] = [];
    net.scripts = [
      [
        { type: "quota", quota: allowance },
        { type: "mode", aiMode: "tier1" },
        { type: "report", report: shorterReport },
      ],
      [{ type: "mode", aiMode: "tier2" }, { type: "report", report: shorterReport }],
    ];
    const renders: Array<{ key: string; quota: QuotaSignal | null }> = [];

    const opened = await hookRuntime.mount(() => {
      const state = useModelReport({ paper, profile: byok, questions });
      renders.push({ key: state.reportKey, quota: state.quota });
      const [, rerender] = useState(0);
      useEffect(() => {
        // After the first key has rendered with its quota, settle a question.
        if (state.quota && questions.length === 0) {
          questions = ["synthetic settled question"];
          rerender(1);
        }
      }, [state.quota]);
      return state;
    });
    opened.unmount();

    const keys = [...new Set(renders.map((render) => render.key))];
    expect(net.streamCalls).toHaveLength(2);
    expect(keys).toHaveLength(2);
    const [first, second] = keys;
    expect(renders.some((render) => render.key === first && render.quota !== null)).toBe(true);
    expect(renders.filter((render) => render.key === second).every((render) => render.quota === null)).toBe(true);
    expect(opened.value.reportKey).toBe(second);
    expect(opened.value.quota).toBeNull();
  });

  // End to end: the hook's state is what the page hands `QuotaNotice`, so a
  // refused deep read with no report still gets its line.
  describe("the notice from the hook's state", () => {
    function line(html: string): string {
      return html
        .replace(/<[^>]*>/g, "")
        .replace(/&#x27;/g, "'")
        .replace(/&amp;/g, "&");
    }

    it("the company-budget line is reachable: stream, no report", async () => {
      net.scripts = [
        [
          { type: "mode", aiMode: "tier1" },
          { type: "quota", quota: companyBudget },
          { type: "report", report: refusedFallback },
        ],
      ];
      const opened = await open(byok);

      expect(opened.report).toBeNull();
      expect(line(renderToStaticMarkup(createElement(QuotaNotice, { quota: opened.quota })))).toBe(QUOTA.companyBudget);
    });

    it("the company-budget line is reachable: JSON, no report", async () => {
      net.entitlement = { userId: "reader-1" };
      net.scripts = [[{ type: "error", message: "stream unavailable" }]];
      net.json = refusedFallback;
      const opened = await open(signedIn);

      expect(opened.report).toBeNull();
      expect(line(renderToStaticMarkup(createElement(QuotaNotice, { quota: opened.quota })))).toBe(QUOTA.companyBudget);
    });

    it("a breaker that trips after mode is no longer silent", async () => {
      net.scripts = [[{ type: "mode", aiMode: "tier2" }, { type: "quota", quota: breaker }]];
      const opened = await open(byok);

      expect(opened.report).toBeNull();
      expect(line(renderToStaticMarkup(createElement(QuotaNotice, { quota: opened.quota })))).toBe(QUOTA.exhausted);
    });

    it("a report with no quota gets no line", async () => {
      net.scripts = [[{ type: "mode", aiMode: "tier2" }, { type: "report", report: shorterReport }]];
      const opened = await open(byok);

      expect(renderToStaticMarkup(createElement(QuotaNotice, { quota: opened.quota }))).toBe("");
    });
  });
});
