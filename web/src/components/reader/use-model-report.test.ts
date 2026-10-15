import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { emptyReport, type PaperReport } from "@/lib/papers/report";
import { defaultProfile, type Paper, type UserProfile } from "@/types";
import { buildReportKey, deepReportRequested, rememberReport, useModelReport } from "./use-model-report";

// A reader's own key counts only for a signed-in reader (P4-00), and a server render reads a
// zustand store's initial state, so the sign-in outcome is stood in for here.
vi.mock("@/components/profile-sync", () => ({
  useSyncGate: (select: (state: { authOutcome: string }) => unknown) => select({ authOutcome: "signed-in" }),
}));

// P3-05 (§1h.8 (1); A's P3-04 F1): "this reader has switched the paper's text on
// for a model" is one predicate, read by the report hook for its own `deep` and by
// the page for the paragraph-gist pass — so the paper's text leaves for a model on
// one switch (the Deep report setting, or an attached PDF) and never on another.
describe("deepReportRequested — the one switch the paper's text leaves on (P3-05)", () => {
  const off = { deepReportEnabled: false };
  const on = { deepReportEnabled: true };
  const publicPaper = { fullTextUploadId: undefined };
  const attached = { fullTextUploadId: "upload:0123456789abcdef" };

  it("is false with the switch off and no attached PDF, whatever model the reader has", () => {
    expect(deepReportRequested(off, publicPaper, "byok")).toBe(false);
    // A standalone upload carries no `fullTextUploadId`: with the switch off it is the abstract report.
    expect(deepReportRequested(off, undefined, "byok")).toBe(false);
  });

  // P4-00: the model is the reader's own key ("byok") — the "system" mode, Peer's own
  // model, is gone, and with it the cases that said so.
  it("is true with the switch on and a model", () => {
    expect(deepReportRequested(on, publicPaper, "byok")).toBe(true);
    expect(deepReportRequested(on, undefined, "byok")).toBe(true);
  });

  it("is true for an attached PDF even with the switch off", () => {
    expect(deepReportRequested(off, attached, "byok")).toBe(true);
  });

  it("is false with no model, switch on or an attached PDF alike", () => {
    expect(deepReportRequested(on, publicPaper, "none")).toBe(false);
    expect(deepReportRequested(off, attached, "none")).toBe(false);
    expect(deepReportRequested(on, attached, "none")).toBe(false);
  });
});

// 9-15 (A9-10): `buildReportKey` is a pure extraction of the report cache
// key so it can be unit-tested without rendering the hook (this project's
// Vitest config runs in a plain Node environment, no DOM). The load-bearing
// behavior: `revision` (9-12) must be part of the key, so a delete-then-
// re-upload of the identical bytes (the same hash16, the same
// `fullTextUploadId` string, but a fresh lifecycle instance) never reuses a
// stale in-memory/localStorage entry built against the previous instance.
describe("buildReportKey", () => {
  // P2-03 (§1g.11 b): the settled questions name the report too — but only
  // when there are some, so every key and cached report from before stays.
  it("is byte-identical to today's key without questions", () => {
    const paper = { id: "arxiv:2607.00001", fullTextUploadId: "upload:0123456789abcdef", revision: 2 };
    const today = buildReportKey(paper, "deep", "my project", "gemini");
    expect(today).toBe(`arxiv:2607.00001|upload:0123456789abcdef|2|deep|${today.split("|")[4]}|gemini`);
    expect(buildReportKey(paper, "deep", "my project", "gemini", [])).toBe(today);
    expect(buildReportKey(paper, "deep", "my project", "gemini", undefined)).toBe(today);
  });

  it("with questions: appends one hash of the sorted set — order-insensitive, and different sets differ", () => {
    const paper = { id: "arxiv:2607.00001", fullTextUploadId: undefined, revision: undefined };
    const today = buildReportKey(paper, "deep", "", "gemini");
    const ab = buildReportKey(paper, "deep", "", "gemini", ["Does tungsten delay rafting?", "Why 1100 C?"]);
    const ba = buildReportKey(paper, "deep", "", "gemini", ["Why 1100 C?", "Does tungsten delay rafting?"]);
    const a = buildReportKey(paper, "deep", "", "gemini", ["Does tungsten delay rafting?"]);

    expect(ab).toMatch(new RegExp(`^${today.replace(/[|.]/g, "\\$&")}\\|q:[0-9a-z]+$`));
    expect(ba).toBe(ab);
    expect(a).not.toBe(ab);
    // The key holds a hash, never the question.
    expect(ab).not.toContain("tungsten");
  });

  it("returns an empty key with no paper", () => {
    expect(buildReportKey(undefined, "abstract", "", "default")).toBe("");
  });

  it("includes the paper id, upload id, depth, project hash and provider", () => {
    const key = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined, revision: undefined },
      "deep",
      "my project",
      "default",
    );
    expect(key).toContain("arxiv:2607.00001");
    expect(key).toContain("public");
    expect(key).toContain("deep");
    expect(key).toContain("default");
  });

  it("differs when the revision differs, even with the same paper id and fullTextUploadId", () => {
    const base = { id: "arxiv:2607.00001", fullTextUploadId: "upload:0123456789abcdef" };
    const keyRev1 = buildReportKey({ ...base, revision: 1 }, "deep", "", "default");
    const keyRev2 = buildReportKey({ ...base, revision: 2 }, "deep", "", "default");
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("is unchanged for a paper with no revision at all (the vast majority of papers)", () => {
    const withoutField = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined },
      "abstract",
      "",
      "default",
    );
    const withUndefined = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined, revision: undefined },
      "abstract",
      "",
      "default",
    );
    expect(withoutField).toBe(withUndefined);
  });

  it("still differs on paper id / fullTextUploadId / depth / provider as before", () => {
    const key = buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "default");
    expect(key).not.toBe(buildReportKey({ id: "b", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: "upload:x", revision: undefined }, "deep", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "abstract", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "gemini"));
  });
});

// P0-02 (spec D0): a private PDF's report is cached in the browser under a
// key that already names the upload and its revision, instead of never —
// the second open of the same PDF reads the report back rather than asking
// (and paying) for it again. Mounted through the server renderer: this
// project's Vitest has no DOM, but the hook's cache read happens during
// render, which is exactly the "second mount" being tested. Effects (the
// request) do not run here, so nothing is sent.
describe("useModelReport — private PDF report cache (P0-02)", () => {
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

  // A reader on their own key, so a supplement goes deep the way it does in
  // use — a signed-in reader (the mock above). A placeholder string: no request
  // leaves a server render.
  const profile: UserProfile = { ...defaultProfile, feedAiProvider: "anthropic", feedAiApiKey: "placeholder-not-a-key" };
  const supplement: Paper = {
    id: "openalex:W7000000001",
    fullTextUploadId: "upload:0123456789abcdef",
    revision: 1,
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
  const standalone: Paper = { ...supplement, id: "upload:fedcba9876543210", fullTextUploadId: undefined };
  const report: PaperReport = {
    ...emptyReport("deep"),
    noLlm: false,
    whatItProposes: { summary: "A report read once.", methods: [] },
  };

  function mount(paper: Paper): string {
    function Probe() {
      const state = useModelReport({ paper, profile });
      return createElement("p", null, state.report ? `hit:${state.report.whatItProposes.summary}` : "miss");
    }
    return renderToStaticMarkup(createElement(Probe));
  }

  beforeEach(() => {
    vi.stubGlobal("localStorage", memoryStorage());
    vi.stubGlobal("window", globalThis);
  });

  afterEach(() => vi.unstubAllGlobals());

  it("reads a supplement's deep report back on the second mount", () => {
    expect(mount(supplement)).toContain("miss");
    rememberReport(buildReportKey(supplement, "deep", "", profile.feedAiProvider), report);

    expect(mount(supplement)).toContain("hit:A report read once.");
  });

  it("reads a standalone upload's report back on the second mount", () => {
    const depth = "abstract"; // a standalone upload goes deep only with the profile switch on
    rememberReport(buildReportKey(standalone, depth, "", profile.feedAiProvider), { ...report, depth });

    expect(mount(standalone)).toContain("hit:A report read once.");
  });

  it("misses when the upload's revision changes", () => {
    rememberReport(buildReportKey(supplement, "deep", "", profile.feedAiProvider), report);

    expect(mount({ ...supplement, revision: 2 })).toContain("miss");
  });
});
