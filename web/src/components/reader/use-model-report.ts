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
import { reportProviderConfigured } from "@/components/reports/provider-configured";

const STORAGE_KEY = "peer-paper-report-v4";
/** The cache the old page kept, with its fabricated fallbacks inside. */
const LEGACY_STORAGE_KEY = "peer-paper-report-cache-v3";
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

export interface ModelReportState {
  /** A verified, model-written report; null when there is no model layer. */
  report: PaperReport | null;
  /** The stream's current stage while the model works. */
  stage: { label: string; pct: number } | null;
  /** The model was asked and could not finish; the paper's own text stands. */
  failed: boolean;
}

interface Result {
  key: string;
  report: PaperReport | null;
  failed: boolean;
}

/**
 * Ask for the report once per `${paperId}|${depth}|${hash(project)}|${provider}`
 * and keep it in localStorage. The request goes out with the project text so
 * the server can relate the paper to it; `contextHint` carries the rest of the
 * profile as before.
 */
export function useModelReport({
  paper,
  profile,
}: {
  paper: Paper | undefined;
  profile: UserProfile;
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

  const userProviderConfigured = reportProviderConfigured(profile);
  const localDeveloperProvider =
    process.env.NODE_ENV === "development" && profile.feedAiProvider === "default";
  // Deep is opt-in. Deployed copies require the user's own key; local next
  // dev may use the developer's explicit configuration.
  const deep =
    Boolean(profile.deepReportEnabled) && (userProviderConfigured || localDeveloperProvider);
  const depth = deep ? "deep" : "abstract";
  const reportKey = paper
    ? `${paper.id}|${depth}|${hash(project)}|${profile.feedAiProvider}`
    : "";

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
      localStorage.removeItem(LEGACY_STORAGE_KEY);
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

  useEffect(() => {
    const current = paperRef.current;
    if (!current || !reportKey || cached) return;
    const controller = new AbortController();
    const active = () => !controller.signal.aborted;

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
    const requestBody = {
      paper: current,
      contextHint,
      project: project || undefined,
      deepReport: deep,
      llmOverride,
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

    void load();
    return () => controller.abort();
  }, [
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
  return { report, stage, failed: Boolean(settled?.failed) };
}
