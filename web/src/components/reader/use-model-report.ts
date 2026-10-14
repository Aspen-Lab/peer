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
import { REPORT_STATUS } from "./copy";

// v6: S6 merged "what is new" into "what it proposes" (whatItProposes.newHere
// replaces .novelty) and deleted "why it fits you" — a v5 report still has
// the old two-block/fit shape and would render it for up to DEEP_TTL_MS
// after upgrade without this bump.
const STORAGE_KEY = "peer-paper-report-v7";
/** The cache the old page kept, with its fabricated fallbacks inside. */
const LEGACY_STORAGE_KEYS = ["peer-paper-report-cache-v3", "peer-paper-report-v4", "peer-paper-report-v5", "peer-paper-report-v6"];
const MAX_ENTRIES = 40;
/**
 * P9-48 rule 2 (A's P9-W3 §4, §6 item 1): the most the cache may take of the
 * origin's `localStorage`, in characters of its serialized text — a budget as
 * well as the count above, because the count says nothing of size. A browser
 * gives one origin about 5 M characters in all (5.24 M in the browser of A's
 * walk), and the feed, the profile with the key a reader stored, the reading
 * preferences, the question store and the reading cache share it; the cache
 * alone filled it at four entries and a quota error, swallowed, was all that
 * stood between it and them. A report without its figure (rule 1) is a few KB
 * to some tens of KB — `REPORT_CAPS` bounds every field — so 1.5 M holds the
 * forty the count allows with room to spare, yet is under a third of the
 * smallest quota, and the quota error stops being the only limit.
 */
export const REPORT_CACHE_BUDGET_CHARS = 1_500_000;
// A deep report stays well past a session; an abstract-tier one expires
// sooner so a transient failure (paywall flap, model hiccup) self-heals on
// the next open without manual action.
const DEEP_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const ABSTRACT_TTL_MS = 6 * 60 * 60 * 1000;

/**
 * P10-41 (BACKLOG-39): the longest a reader waits on one report. The route's own ceiling is
 * `maxDuration = 180` s for one attempt (the deep reports measured run 85–100 s); the stream and
 * its JSON fallback together get a little over that, and then the request has failed — the page says
 * so, in the line it already has for a model that could not finish — instead of a label that never
 * clears. Nothing a request could still finish is cut: the platform ends it at 180 s.
 */
export const REPORT_DEADLINE_MS = 200_000;

function stageLabel(stage: string, serverLabel: string, withQuestions: boolean): string {
  if (stage === "reading") return withQuestions ? REPORT_STATUS.readingQuestions : REPORT_STATUS.reading;
  if (stage === "source") return REPORT_STATUS.source;
  if (stage === "writing") return REPORT_STATUS.writing;
  if (stage === "figures") return REPORT_STATUS.figures;
  return serverLabel;
}

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

/** A figure carried by value: the picture's own bytes, `data:image/png;base64,…`. */
function isFigureData(url: unknown): boolean {
  return typeof url === "string" && /^\s*data:/i.test(url);
}

/**
 * P9-48 rule 1 (A's P9-W3 §4, §6 item 1): the report as the cache keeps it —
 * with no figure by value. A figure rendered from the PDF arrives as a
 * `data:` URL (1.08 M characters for one), on the proposal and on any key
 * result, and the cache stored it once per cache key, so a handful of question
 * sets filled the origin's `localStorage`. Each such URL is dropped from the
 * stored copy: the field is absent — a label with no image, which the client
 * answers with the figure resolver (`BindArgs.figurePool` in figure-binding) —
 * while `figureLabel`, `figureCaption` and `figureSource` (a few words) stay.
 * The report in memory is untouched, so this visit still draws the figure it
 * was handed.
 *
 * A reload then draws what the page draws for a report with no bound figure:
 * the plate asks the figure resolver (`/api/figure`, which the page runs anyway
 * and the card primed) and each key result's section asks it for its own — the
 * paper's figure by the resolver's pick, not necessarily the one the report
 * bound.
 *
 * Why not the figure-image route's URL (`/api/papers/<id>/figure-image?page=&fig=`),
 * which would draw the same picture again: the route names a page, and the
 * report does not carry one — only the reading does (`ReadingFigure.page`),
 * and this hook is given a paper, not a reading. The server can send that URL
 * where it binds the figure (it has each caption's page), and then the browser
 * never holds the data URL at all; that is not this file's to change.
 *
 * Only a `data:` URL goes: an `https:` URL or the route's own URL is already
 * small and is kept as it is. The same report comes back (not a copy) when it
 * holds none.
 */
export function withoutFigureData(report: PaperReport): PaperReport {
  const proposes = report.whatItProposes;
  const results = report.resultsAndSignificance?.keyResults;
  const proposalHolds = isFigureData(proposes?.figureImageUrl);
  const resultsHold = Array.isArray(results) && results.some((result) => isFigureData(result?.figureImageUrl));
  if (!proposalHolds && !resultsHold) return report;

  const out: PaperReport = { ...report };
  if (proposalHolds) {
    const bare = { ...proposes };
    delete bare.figureImageUrl;
    out.whatItProposes = bare;
  }
  if (resultsHold) {
    out.resultsAndSignificance = {
      ...report.resultsAndSignificance,
      keyResults: results!.map((result) => {
        if (!isFigureData(result?.figureImageUrl)) return result;
        const bare = { ...result };
        delete bare.figureImageUrl;
        return bare;
      }),
    };
  }
  return out;
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

/** What one entry takes of the serialized cache, `"key":{…},` — the comma
 *  is counted with it, so the whole is `1 + Σ entryChars` (`{`, the entries, `}`). */
function entryChars(key: string, entry: CachedReport): number {
  return JSON.stringify(key).length + 1 + JSON.stringify(entry).length + 1;
}

/**
 * Cache `report` under `key`: without its figures (rule 1), and under the
 * budget (rule 2) — before the write, the oldest entries are evicted until the
 * cache and the new entry fit `REPORT_CACHE_BUDGET_CHARS` and `MAX_ENTRIES`;
 * an entry that alone is over the budget is not cached, and the log carries its
 * length and nothing of it (the paper's words, its key and its project are the
 * reader's). The entry being replaced is not counted twice, and the new entry
 * is never the one evicted.
 */
function writeCached(key: string, report: PaperReport): void {
  if (!key || typeof window === "undefined") return;
  try {
    const fresh: CachedReport = { report: withoutFigureData(report), savedAt: Date.now() };
    const freshChars = entryChars(key, fresh);
    if (1 + freshChars > REPORT_CACHE_BUDGET_CHARS) {
      console.warn("[report-cache] a report over the cache budget was not cached:", freshChars, "characters, budget", REPORT_CACHE_BUDGET_CHARS);
      return;
    }
    // Every other entry, oldest first (ties keep the order they were written
    // in). A cache an earlier build wrote may hold figures by value: they go
    // here too, so an old cache is rewritten as small as a new one and its
    // reports are kept rather than evicted.
    const older = Object.entries(readCache())
      .flatMap(([k, entry]) => {
        if (k === key || !entry?.report || typeof entry.report !== "object") return [];
        const kept: CachedReport = { ...entry, report: withoutFigureData(entry.report) };
        return [{ key: k, entry: kept, chars: entryChars(k, kept) }];
      })
      .sort((a, b) => (a.entry.savedAt ?? 0) - (b.entry.savedAt ?? 0));
    let total = 1 + freshChars + older.reduce((n, e) => n + e.chars, 0);
    let evicted = 0;
    while (evicted < older.length && (older.length - evicted + 1 > MAX_ENTRIES || total > REPORT_CACHE_BUDGET_CHARS)) {
      total -= older[evicted].chars;
      evicted += 1;
    }
    const cache: ReportCache = {};
    for (const e of older.slice(evicted)) cache[e.key] = e.entry;
    cache[key] = fresh;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cache));
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
  stage: { label: string; pct: number | null } | null;
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
  // never used to be, so every open of an attached PDF asked for — and spent the
  // reader's own key on — a fresh deep report. The key already names the upload and its
  // revision (`buildReportKey`), so a re-upload, a new attachment or another
  // PDF is a different key; the server still re-checks the owner and the
  // revision on every request it does receive.
  const cached = useMemo(() => readCached(reportKey), [reportKey]);
  const [result, setResult] = useState<Result | null>(null);
  // P10-41: the request in flight, if a model was asked — what the status line says. `base` is the
  // key without the questions: the request a reader's new question waits behind is the same paper,
  // depth, project and provider, so its stage is what the page is waiting on until it ends. It is
  // cleared at the one place a request ends (`finally` below), so it cannot outlive its request.
  const [progress, setProgress] = useState<{
    base: string;
    label: string;
    /** `null` until a stage has said how far along it is: a request just started has no progress to draw. */
    pct: number | null;
  } | null>(null);
  const baseKey = buildReportKey(paper, depth, project, profile.feedAiProvider);

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
  // questions never aborts it — the server has already taken it on the reader's
  // key, and the answer is wanted: it finishes and caches under its own key, and the effect
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
  // from an unloading page. The question box used to settle its questions on `pagehide`
  // (P7-13 took that away; a tick, a × or a Submit pressed as the page hides still
  // settle), which re-keys this hook, and the request effect below used to fetch for
  // the new key from the dying page (the browser cancels it; a request that does reach the
  // server runs on the reader's key and is answered into nowhere, and the next open asks again). So
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
      setProgress(null);
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
      setProgress(null);
      setResult({ key: reportKey, report: shown, failed: false });
    };

    const fetchJsonFallback = async () => {
      // The stream broke and the request is asked once more: the line says so rather than
      // standing on the stage the broken one reached. Only where a model was to be asked.
      if (userProviderConfigured) {
        setProgress((current) => ({ base: baseKey, label: REPORT_STATUS.again, pct: current?.pct ?? null }));
      }
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

    // The page has what it asked for (the report, or Tier 0's "no model"): whatever the stream still
    // sends is read and dropped. P10-45 (BACKLOG-92): returning at the report cancelled a body the
    // server was still closing, which the browser logs as `ERR_ABORTED` on every report.
    let settled = false;
    const load = async () => {
      let modeSeen = false;
      let asked = false;
      await Promise.resolve();
      if (!active()) return;
      // A reader's own key means a model is to be asked: the page waits on it from the request on,
      // not from the server's first word (which, with an earlier request ending just before this
      // one starts, would leave the line blank for a round trip). With no key, no model is asked
      // and nothing is shown; the mode event below says so for the case this guess misses.
      if (userProviderConfigured) setProgress({ base: baseKey, label: REPORT_STATUS.starting, pct: null });
      try {
        for await (const event of streamPaperReport(requestBody, controller.signal)) {
          if (!active()) return;
          if (settled) continue;

          if (event.type === "mode") {
            if (modeSeen) throw new Error("Report stream sent more than one mode event.");
            modeSeen = true;
            if (event.aiMode === "tier0") {
              settled = true;
              settle(null, false);
              continue;
            }
            asked = true;
            // A model is asked: the page waits on it from here, stage event or not. (At Tier 0 no
            // model is asked and nothing is shown, so this is not set before the mode says so.)
            setProgress({ base: baseKey, label: REPORT_STATUS.starting, pct: null });
            continue;
          }
          if (!modeSeen) throw new Error("Report stream did not begin with a mode event.");

          if (event.type === "stage") {
            const pct = Number.isFinite(event.pct) ? Math.max(0, Math.min(100, event.pct)) : null;
            const label = stageLabel(event.stage, event.label, sentQuestions.length > 0);
            // The bar never moves backwards within a request; a request that has not yet said how far
            // it is (the one a queued question starts, behind an earlier one that ended) has no bar.
            setProgress((current) => {
              const same = current !== null && current.base === baseKey;
              if (same && current.pct !== null && pct !== null && pct < current.pct) return current;
              return { base: baseKey, label, pct: pct ?? (same ? current.pct : null) };
            });
            continue;
          }
          if (event.type === "report") {
            settled = true;
            settle(event.report, asked);
            continue;
          }
          throw new Error(event.message);
        }
        if (!settled) throw new Error("Report stream ended before a report arrived.");
      } catch {
        if (!settled && active()) await fetchJsonFallback();
      }
    };

    // P10-41: out of time is a failure, said once: the stage clears, the page's "could not finish"
    // line stands, and (`finishedKey`, below) the same key is not asked again for it.
    const deadline = setTimeout(() => {
      if (!active()) return;
      // A stream that has delivered its report and does not close is let go, not reported as a failure.
      if (!settled) fail();
      controller.abort();
    }, REPORT_DEADLINE_MS);

    void load().finally(() => {
      clearTimeout(deadline);
      if (flight.current?.controller !== controller) return;
      flight.current = null;
      finishedKey.current = reportKey;
      // The one place a request ends, whichever way: nothing is in flight, so no stage stands.
      setProgress(null);
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
    baseKey,
  ]);

  const settled = result?.key === reportKey ? result : null;
  const report = cached ?? settled?.report ?? null;
  // P10-41: the page's wait, said only while it is waiting: no report yet, and a request for this
  // paper in flight (this key's own, or the earlier one this key's request follows).
  const stage = !report && progress?.base === baseKey ? { label: progress.label, pct: progress.pct } : null;
  return {
    report,
    stage,
    failed: Boolean(settled?.failed),
    fresh: !cached && settled?.report != null,
    reportKey,
  };
}
