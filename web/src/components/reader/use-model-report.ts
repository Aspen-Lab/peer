"use client";

// The model report — the stream consumer the page used to hold, trimmed to
// what the reading surface needs: the verified report, the stage while it
// works, and whether it failed.
//
// A `noLlm` report is never cached and never rendered. What it means depends
// on whether a model was asked (`reportOutcome`): at Tier 0 it is "no model
// layer" and the Decision block's sentence stays the reading's own; after a
// `tier1` / `tier2` mode it is the model failing, and the page says so.
// Nothing here fills a gap with a fallback — that path was deleted with the
// old page.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Paper, UserProfile } from "@/types";
import { apiFetch } from "@/lib/api";
import type { PaperReport } from "@/lib/papers/report";
import { streamPaperReport } from "@/lib/papers/report-stream";
import { reportOutcome } from "@/lib/reader/report-outcome";
import { aiAvailability, type AiMode } from "@/lib/feed/ai-tier";
import { useSyncGate } from "@/components/profile-sync";

// v6: S6 merged "what is new" into "what it proposes" (whatItProposes.newHere
// replaces .novelty) and deleted "why it fits you" — a v5 report still has
// the old two-block/fit shape and would render it for up to DEEP_TTL_MS
// after upgrade without this bump.
const STORAGE_KEY = "peer-paper-report-v7";
/** The cache the old page kept, with its fabricated fallbacks inside. */
const LEGACY_STORAGE_KEYS = ["peer-paper-report-cache-v3", "peer-paper-report-v4", "peer-paper-report-v5", "peer-paper-report-v6"];
const MAX_ENTRIES = 40;
// A deep report stays well past a session; an abstract-tier one expires
// sooner so a transient failure (paywall flap, model hiccup) self-heals on
// the next open without manual action.
const DEEP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ABSTRACT_TTL_MS = 6 * 60 * 60 * 1000;

interface CachedReport {
  report: PaperReport;
  savedAt: number;
}

type ReportCache = Record<string, CachedReport>;

function readCache(): ReportCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReportCache) : {};
  } catch {
    return {};
  }
}

function readCached(key: string): PaperReport | null {
  if (!key) return null;
  const entry = readCache()[key];
  if (!entry?.report || typeof entry.report !== "object") return null;
  if (entry.report.noLlm) return null;
  const ttl = entry.report.depth === "deep" ? DEEP_TTL_MS : ABSTRACT_TTL_MS;
  if (Date.now() - (entry.savedAt ?? 0) >= ttl) return null;
  return entry.report;
}

/** What a settled report is cached as — exported so a test can stand in for
 *  the first visit that wrote it. */
export function rememberReport(key: string, report: PaperReport): void {
  writeCached(key, report);
}

function writeCached(key: string, report: PaperReport): void {
  if (!key || typeof window === "undefined") return;
  try {
    const cache = readCache();
    cache[key] = { report, savedAt: Date.now() };
    const pruned = Object.fromEntries(
      Object.entries(cache)
        .sort((a, b) => (b[1].savedAt ?? 0) - (a[1].savedAt ?? 0))
        .slice(0, MAX_ENTRIES),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // Cache failures never block reading the report.
  }
}

/** djb2 — the project text keys the cache; its length does not. */
function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i += 1) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * 9-15 (A9-10): a pure function so the key's shape — in particular, that
 * `revision` (9-12) is part of it — can be tested without rendering the
 * hook (this project's Vitest config runs in a plain Node environment, no
 * DOM). `paper.revision` distinguishes a delete-then-re-upload of the
 * identical bytes (the same hash16, hence the same `fullTextUploadId`
 * string, but a fresh lifecycle instance) from the attachment a stale key
 * was built against; `undefined` for every paper without a private
 * attachment, so the key is unchanged for the vast majority of papers.
 */
export function buildReportKey(
  paper: Pick<Paper, "id" | "fullTextUploadId" | "revision"> | undefined,
  depth: "deep" | "abstract",
  project: string,
  provider: string,
  questions: readonly string[] = [],
): string {
  if (!paper) return "";
  const base = `${paper.id}|${paper.fullTextUploadId ?? "public"}|${paper.revision ?? ""}|${depth}|${hash(project)}|${provider}`;
  // P2-03 (§1g.11 b): a report answers a set of questions — in any order —
  // so the set names it too, as a hash; with none the key is today's, and
  // every report already cached stays found.
  return questions.length > 0 ? `${base}|q:${hash([...questions].sort().join("\n"))}` : base;
}

/**
 * P3-05 (§1h.8 (1); A's P3-04 F1): whether this reader has switched the paper's
 * text on for a model — the one predicate the paper's text leaves the browser on.
 * A deep report reads the full text, and it is asked for when the reader turned
 * Deep report on in their profile or the paper carries an attached PDF, and a model
 * is there to ask (the reader's own key, for a signed-in reader). The hook
 * decides its own `deep` with it, and the page enables the paragraph-gist pass on it
 * too, so the map's gists are written only when a deep report is: one switch, never
 * a second. Pure, so the rule is tested without rendering anything.
 */
export function deepReportRequested(
  profile: Pick<UserProfile, "deepReportEnabled">,
  paper: Pick<Paper, "fullTextUploadId"> | undefined,
  aiMode: AiMode,
): boolean {
  return Boolean(profile.deepReportEnabled || paper?.fullTextUploadId) && aiMode !== "none";
}

export interface ModelReportState {
  /** A verified, model-written report; null when there is no model layer. */
  report: PaperReport | null;
  /** The stream's current stage while the model works. */
  stage: { label: string; pct: number } | null;
  /** The model was asked and could not finish; the paper's own text stands. */
  failed: boolean;
  /**
   * S5: true when `report` just finished generating in this visit — a live
   * model call settled, not a `readCached` hit on mount. The page uses this
   * to decide whether the report's text scrambles into place (fresh) or
   * renders plainly (a cache hit, including a page revisited later in the
   * same session).
   */
  fresh: boolean;
  /** The cache key this report was fetched/cached under — `""` with no paper. */
  reportKey: string;
}

interface Result {
  key: string;
  report: PaperReport | null;
  failed: boolean;
}

const NO_QUESTIONS: readonly string[] = [];

/**
 * Ask for the report once per `${paperId}|${depth}|${hash(project)}|${provider}`
 * and keep it in localStorage. The request goes out with the project text so
 * the server can relate the paper to it; `contextHint` carries the rest of the
 * profile as before.
 */
export function useModelReport({
  paper,
  profile,
  questions = NO_QUESTIONS,
}: {
  paper: Paper | undefined;
  profile: UserProfile;
  /** P2-03 (§1g.11 b): the reader's settled questions for this paper —
   *  never the gist. They go in the request body only when there are some. */
  questions?: readonly string[];
}): ModelReportState {
  const project = useMemo(
    () => [profile.currentProject, profile.currentChallenges].filter(Boolean).join("\n"),
    [profile.currentProject, profile.currentChallenges],
  );
  const contextHint = useMemo(
    () =>
      [
        profile.currentProject,
        profile.currentChallenges,
        profile.researchTopics.length > 0
          ? `Topics: ${profile.researchTopics.join(", ")}`
          : undefined,
        profile.preferredMethods.length > 0
          ? `Methods: ${profile.preferredMethods.join(", ")}`
          : undefined,
      ]
        .filter(Boolean)
        .join("\n"),
    [
      profile.currentProject,
      profile.currentChallenges,
      profile.researchTopics,
      profile.preferredMethods,
    ],
  );

  // A model runs only on the reader's own key, and only for a signed-in reader.
  // `userProviderConfigured` keeps its meaning — only a reader on their own key
  // sends one.
  const authOutcome = useSyncGate((s) => s.authOutcome);
  const aiMode = aiAvailability(profile, authOutcome);
  const userProviderConfigured = aiMode === "byok";
  // Deep is opt-in, and needs a model: the reader's own key. No NODE_ENV test
  // here: AI availability is decided on the server.
  const deep = deepReportRequested(profile, paper, aiMode);
  const depth = deep ? "deep" : "abstract";
  // P2-08b (§1g.17, F2): the questions name a request, and ride it, only when
  // it is a deep one — `deep` already needs a provider the hook knows about
  // (the reader's own key, for a signed-in reader). Any other
  // request has no use for them (the route reads them on the deep path alone),
  // so a settle then changes nothing on the wire and sends no request. The
  // reader's questions stay in the store, which the export and the note read.
  const requestQuestions = deep ? questions : NO_QUESTIONS;
  const reportKey = buildReportKey(paper, depth, project, profile.feedAiProvider, requestQuestions);

  // P0-02 (spec D0): a private PDF's report is cached like any other. It
  // never used to be, so every open of an attached PDF asked for — and
  // charged — a fresh deep report. The key already names the upload and its
  // revision (`buildReportKey`), so a re-upload, a new attachment or another
  // PDF is a different key; the server still re-checks the owner and the
  // revision on every request it does receive.
  const cached = useMemo(() => readCached(reportKey), [reportKey]);
  const [result, setResult] = useState<Result | null>(null);
  const [buildup, setBuildup] = useState<{
    key: string;
    label: string;
    pct: number;
  } | null>(null);

  // The old page's cache held fallback reports that relabelled abstract
  // sentences as findings; it is removed once so none of that is ever read
  // back.
  useEffect(() => {
    try {
      for (const key of LEGACY_STORAGE_KEYS) localStorage.removeItem(key);
    } catch {
      /* nothing to remove, or no storage */
    }
  }, []);

  // The request reads the paper through a ref, and the effect below is keyed
  // on `reportKey` (which carries the paper's id) rather than the object: the
  // page rebuilds `paper` whenever its save flag or feedback changes, and
  // keying on the object made `s` or `l` mid-stream abort the model call and
  // issue a second one on the reader's key.
  const paperRef = useRef(paper);
  useEffect(() => {
    paperRef.current = paper;
  }, [paper]);
  // The questions likewise: the key already names their set, so a new array
  // for the same set (every store write) asks for nothing new.
  const questionsRef = useRef(requestQuestions);
  useEffect(() => {
    questionsRef.current = requestQuestions;
  }, [requestQuestions]);

  // P2-08b (§1g.18): one request in flight at a time, and a different set of
  // questions never aborts it — the server has already charged it, and the
  // answer is wanted: it finishes and caches under its own key, and the effect
  // below then runs again (`released`) and sends one request for the latest
  // set, if that is another. `settings` is everything the request depends on
  // but the questions: a change of any of it (another paper, depth, project,
  // provider or key) still abandons the request, as it always did, and so does
  // leaving the page.
  const settings = [
    buildReportKey(paper, depth, project, profile.feedAiProvider),
    contextHint,
    project,
    deep,
    userProviderConfigured,
    profile.feedAiApiKey,
  ].join("\u0000");
  const flight = useRef<{ settings: string; controller: AbortController } | null>(null);
  /** The key whose request just ended: done, not owed another by the re-run it triggers. */
  const finishedKey = useRef<string | null>(null);
  const [released, setReleased] = useState(0);
  useEffect(() => () => flight.current?.controller.abort(), []);

  // P3-05 (§1h.8 (2); A's P3-04 F2; the invariant of §1g.21 (6)): nothing is sent
  // from an unloading page. The question box settles its questions on `pagehide`,
  // which re-keys this hook, and the request effect below used to fetch for the new
  // key from the dying page (the browser cancels it; a request that does reach the
  // server is charged and answered into nowhere, and the next open asks again). So
  // `pagehide` marks the page as unloading and `pageshow` — a back/forward-cache
  // restore — clears it; while it is set the effect withholds the request, and when
  // it clears the effect runs again (`released`, the trigger the hook already has)
  // and sends the one request for the current key, the settled questions on it. The
  // mark is a ref, not state: the question box's settle reaches the hook through
  // a store subscription, which React renders ahead of an ordinary state update, so a
  // state set by the same event would still read false in the render that settles.
  // `withheld` is whether a request was actually held back: a restore with nothing
  // owed re-runs nothing (the effect would otherwise read the `cached` of its first
  // render and ask again for a report already shown). Registered once per hook
  // instance and removed on unmount.
  const unloading = useRef(false);
  const withheld = useRef(false);
  useEffect(() => {
    const hide = () => {
      unloading.current = true;
    };
    const show = () => {
      unloading.current = false;
      if (!withheld.current) return;
      withheld.current = false;
      setReleased((n) => n + 1);
    };
    window.addEventListener("pagehide", hide);
    window.addEventListener("pageshow", show);
    return () => {
      window.removeEventListener("pagehide", hide);
      window.removeEventListener("pageshow", show);
    };
  }, []);

  useEffect(() => {
    const current = paperRef.current;
    // 2-05 (A2-02): a paper whose record already says its PDF had nothing
    // extractable (an uploaded, scanned PDF with no text layer) has no text
    // for any tier to report on — asking anyway would waste a call to
    // return the same honest emptiness the record's own textStatus already
    // states. The reading page renders the plain "no readable text"
    // sentence directly from `paper.textStatus` instead.
    const justFinished = finishedKey.current;
    finishedKey.current = null;
    if (!current || !reportKey || cached || current.textStatus === "empty" || justFinished === reportKey) return;
    const held = flight.current;
    if (held && !held.controller.signal.aborted) {
      // Only the questions differ: wait for it; `released` brings us back.
      if (held.settings === settings) return;
      // Anything else changed: abandon it, as before.
      held.controller.abort();
    }
    // An unloading page sends nothing; `pageshow` brings the request back (above).
    if (unloading.current) {
      withheld.current = true;
      return;
    }
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;
    flight.current = { settings, controller };

    // An override for both shallow and deep reports whenever the user
    // supplied a key. In deployed Peer this is the only path to a model call.
    const llmOverride =
      userProviderConfigured && profile.feedAiApiKey?.trim()
        ? {
            provider: profile.feedAiProvider as
              | "anthropic"
              | "openai"
              | "gemini"
              | "qwen"
              | "deepseek",
            apiKey: profile.feedAiApiKey.trim(),
          }
        : undefined;
    const sentQuestions = questionsRef.current;
    const requestBody = {
      paper: current,
      contextHint,
      project: project || undefined,
      deepReport: deep,
      llmOverride,
      // In the body of this one request, never a URL; absent without any.
      ...(sentQuestions.length > 0 ? { questions: [...sentQuestions] } : {}),
    };

    const fail = () => {
      if (!active()) return;
      setBuildup(null);
      setResult({ key: reportKey, report: null, failed: true });
    };
    // `asked` is whether a model was asked at all. A `noLlm` report is never
    // cached; asked, it is a failure, and unasked it is no model layer.
    const settle = (report: PaperReport | null, asked: boolean) => {
      if (!active()) return;
      const outcome = reportOutcome(report, asked);
      if (outcome === "failed") {
        fail();
        return;
      }
      const shown = outcome === "shown" ? report : null;
      if (shown) writeCached(reportKey, shown);
      setBuildup(null);
      setResult({ key: reportKey, report: shown, failed: false });
    };

    const fetchJsonFallback = async () => {
      try {
        const report = await apiFetch<PaperReport>("/api/papers/report", {
          method: "POST",
          body: JSON.stringify(requestBody),
          signal: controller.signal,
        });
        // No mode event on this path: the reader's own key says whether the
        // server had a provider to ask.
        settle(report, userProviderConfigured);
      } catch {
        fail();
      }
    };

    const load = async () => {
      let settled = false;
      let modeSeen = false;
      let asked = false;
      await Promise.resolve();
      if (!active()) return;
      try {
        for await (const event of streamPaperReport(requestBody, controller.signal)) {
          if (!active()) return;

          if (event.type === "mode") {
            if (modeSeen) throw new Error("Report stream sent more than one mode event.");
            modeSeen = true;
            if (event.aiMode === "tier0") {
              settled = true;
              settle(null, false);
              return;
            }
            asked = true;
            continue;
          }
          if (!modeSeen) throw new Error("Report stream did not begin with a mode event.");

          if (event.type === "stage") {
            const pct = Number.isFinite(event.pct) ? Math.max(0, Math.min(100, event.pct)) : 0;
            // The bar never moves backwards.
            setBuildup((current) =>
              current && current.key === reportKey && pct < current.pct
                ? current
                : { key: reportKey, label: event.label, pct },
            );
            continue;
          }
          if (event.type === "report") {
            settled = true;
            settle(event.report, asked);
            return;
          }
          throw new Error(event.message);
        }
        if (!settled) throw new Error("Report stream ended before a report arrived.");
      } catch {
        if (!settled && active()) await fetchJsonFallback();
      }
    };

    void load().finally(() => {
      if (flight.current?.controller !== controller) return;
      flight.current = null;
      finishedKey.current = reportKey;
      setReleased((n) => n + 1);
    });
  }, [
    released,
    settings,
    reportKey,
    cached,
    contextHint,
    project,
    deep,
    userProviderConfigured,
    profile.feedAiProvider,
    profile.feedAiApiKey,
  ]);

  const settled = result?.key === reportKey ? result : null;
  const report = cached ?? settled?.report ?? null;
  const stage =
    !report && buildup?.key === reportKey ? { label: buildup.label, pct: buildup.pct } : null;
  return {
    report,
    stage,
    failed: Boolean(settled?.failed),
    fresh: !cached && settled?.report != null,
    reportKey,
  };
}
