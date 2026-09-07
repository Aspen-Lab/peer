"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import type { Paper } from "@/types";
import { apiFetch } from "@/lib/api";
import { ScrambleText } from "@/components/scramble-text";
import { ProgressBar } from "@/components/ui/progress-bar";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { aiAvailability } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import {
  DIGEST_CACHE_STORAGE_KEY,
  digestCacheKey,
} from "./digest-cache-key";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";

interface DailyDigestProps {
  papers: Paper[];
  contextHint?: string;
  selectedPaperId?: string | null;
  onSelectPaper?: (paperId: string) => void;
  llmOverride?: ProviderOverrideConfig;
}

interface DigestPayload {
  bullets: { paperId: string; text: string }[];
  noLlm?: boolean;
}

interface DigestCache {
  paperKey: string;
  payload: DigestPayload;
  fetchedAt: number;
}

interface DigestProgressStep {
  afterMs: number;
  pct: number;
  label: string;
}

const CACHE_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const DIGEST_PROGRESS_STEPS = [
  { afterMs: 0, pct: 10, label: "Reviewing today\u2019s papers" },
  { afterMs: 900, pct: 35, label: "Reading the strongest matches" },
  { afterMs: 2_400, pct: 70, label: "Writing today\u2019s highlights" },
  { afterMs: 4_800, pct: 90, label: "Finishing the briefing" },
] as const satisfies readonly DigestProgressStep[];

// Tiny, stable string hash — only used to bound the cache-key length for the
// context blurb; correctness comes from the id list + length, not the hash.
function simpleHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = (Math.imul(31, h) + text.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
}

function readCache(paperKey: string): DigestPayload | null {
  try {
    const raw = localStorage.getItem(DIGEST_CACHE_STORAGE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as DigestCache;
    if (entry.paperKey !== paperKey) return null;
    if (Date.now() - entry.fetchedAt > CACHE_TTL_MS) return null;
    // Invalidate caches that used the old paragraph format.
    if (!Array.isArray(entry.payload.bullets)) return null;
    return entry.payload;
  } catch {
    return null;
  }
}

function writeCache(paperKey: string, payload: DigestPayload) {
  try {
    const entry: DigestCache = { paperKey, payload, fetchedAt: Date.now() };
    localStorage.setItem(DIGEST_CACHE_STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function clearCache() {
  try { localStorage.removeItem(DIGEST_CACHE_STORAGE_KEY); } catch { /* noop */ }
}

interface PaperDigestState {
  data: DigestPayload | null;
  loading: boolean;
  revealBullets: boolean;
  regenerate: () => void;
}

export function usePaperDigest(
  papers: Paper[],
  contextHint?: string,
  enabled = true,
  llmOverride?: ProviderOverrideConfig,
): PaperDigestState {
  const [data, setData] = useState<DigestPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealBullets, setRevealBullets] = useState(false);
  const setPaperSummaries = useFeedStore((state) => state.setPaperSummaries);
  // ABC-freemium 1-11 · R-UI-4 — which model, if any, produced a cached digest.
  // ABC-freemium 6-04 — a capability question, so the anonymous view while the
  // plan is unknown: `"none"`, which is the honest cache segment for a digest
  // built before we knew whose model was available. Nothing here upsells.
  const aiMode = useProfileStore((state) =>
    aiAvailability(state.profile, entitlementGrants(state.entitlement)),
  );

  // Order-insensitive (a pure re-shuffle of the same papers must still hit the
  // cache) and context-aware (a profile-context change must invalidate a stale
  // digest). Bullets are matched to papers by paperId downstream, so sorting the
  // ids here has no display effect.
  // ABC-freemium 1-11 · R-UI-4 — the `"tier0"` literal becomes the reader's
  // actual AI mode, so a digest written on Peer's model is not served after
  // their entitlement changes and two plans cannot collide in one browser
  // profile. Built by a pure function so it is testable; the storage version is
  // bumped in the same commit.
  const paperKey = useMemo(() => {
    const ids = papers.map((p) => p.id).sort().join("|");
    const ctx = contextHint ?? "";
    return digestCacheKey({
      paperIds: ids,
      contextLength: ctx.length,
      contextHash: simpleHash(ctx),
      overrideProvider: llmOverride?.provider,
      aiMode,
    });
  }, [papers, contextHint, llmOverride?.provider, aiMode]);

  const storePaperSummaries = useCallback((payload: DigestPayload) => {
    if (payload.noLlm || !payload.bullets?.length) return;

    setPaperSummaries(
      payload.bullets.map((bullet, index) => ({
        paperId:
          papers.find((paper) => paper.id === bullet.paperId)?.id ??
          papers[index]?.id ??
          bullet.paperId,
        text: bullet.text,
      })),
    );
  }, [papers, setPaperSummaries]);

  const fetchDigest = useCallback(async (key: string, force = false) => {
    if (!enabled || papers.length === 0) {
      setData(null);
      setRevealBullets(false);
      return;
    }

    if (!force) {
      const cached = readCache(key);
      if (cached) {
        setData(cached);
        storePaperSummaries(cached);
        setRevealBullets(false);
        return;
      }
    }

    setRevealBullets(false);
    setLoading(true);
    try {
      const json = await apiFetch<DigestPayload>("/api/digest", {
        method: "POST",
        body: JSON.stringify({
          papers: papers.map((p) => ({
            id: p.id,
            title: p.title,
            authors: p.authors,
            venue: p.venue,
            abstract: p.summaryIntro,
          })),
          contextHint,
          llmOverride,
        }),
      });
      setData(json);
      storePaperSummaries(json);
      setRevealBullets(Boolean(json.bullets?.length && !json.noLlm));
      if (json.bullets?.length && !json.noLlm) writeCache(key, json);
    } catch {
      setData(null);
      setRevealBullets(false);
    } finally {
      setLoading(false);
    }
  }, [contextHint, enabled, llmOverride, papers, storePaperSummaries]);

  useEffect(() => {
    void fetchDigest(paperKey);
  }, [fetchDigest, paperKey]);

  const regenerate = useCallback(() => {
    clearCache();
    void fetchDigest(paperKey, true);
  }, [fetchDigest, paperKey]);

  return { data, loading, revealBullets, regenerate };
}

export function PaperDigestLoader({
  papers,
  contextHint,
  enabled = true,
  llmOverride,
}: Pick<DailyDigestProps, "papers" | "contextHint" | "llmOverride"> & {
  enabled?: boolean;
}) {
  usePaperDigest(papers, contextHint, enabled, llmOverride);
  return null;
}

function DigestLoadingProgress() {
  const [progress, setProgress] = useState<DigestProgressStep>(
    DIGEST_PROGRESS_STEPS[0],
  );

  useEffect(() => {
    const timers = DIGEST_PROGRESS_STEPS.slice(1).map((step) =>
      window.setTimeout(() => {
        setProgress((current) => current.pct < step.pct ? step : current);
      }, step.afterMs),
    );

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, []);

  return <ProgressBar pct={progress.pct} label={progress.label} />;
}

/**
 * The daily one-paragraph briefing. Sits above the card grid on the
 * Discovery page. Hidden entirely when no LLM is configured (the API
 * returns `noLlm: true`) so the rest of the app keeps working without
 * an Anthropic API key.
 *
 * The result is cached in localStorage (12-hour TTL). On page refresh
 * the cached paragraph is shown immediately without a new LLM call.
 * The user can click "Regenerate" to force a fresh generation.
 */
export function DailyDigest({
  papers,
  contextHint,
  selectedPaperId,
  onSelectPaper,
  llmOverride,
}: DailyDigestProps) {
  const { data, loading, revealBullets, regenerate } = usePaperDigest(
    papers,
    contextHint,
    true,
    llmOverride,
  );

  const progressBar = loading ? (
    <DigestLoadingProgress />
  ) : null;

  if (!data || data.noLlm || !data.bullets?.length) {
    if (loading) {
      return (
        <>
          {progressBar}
          <DigestSkeleton />
        </>
      );
    }
    return null;
  }

  return (
    <>
      {progressBar}
      <section
        className="mb-8 rounded-2xl bg-surface shadow-card px-5 py-5 sm:px-7 sm:py-6 animate-fade-in-up"
        aria-label="Daily briefing digest"
        aria-busy={loading}
      >
        <header className="flex items-center justify-between gap-2 mb-4">
          <span className="inline-flex items-center gap-2 text-micro font-semibold uppercase tracking-[0.18em] text-accent/90 min-w-0">
            <span className="inline-block w-3.5 h-[1.5px] bg-accent/70 shrink-0" />
            <span className="truncate">Today&rsquo;s highlights</span>
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={regenerate}
              disabled={loading}
              title="Regenerate digest"
              aria-label="Regenerate digest"
              className="group inline-flex items-center gap-1.5 h-7 px-2 sm:pl-2 sm:pr-3 rounded-full bg-bg-secondary/60 text-text-faint hover:text-heading hover:bg-bg-secondary transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={loading ? "animate-spin" : "group-hover:rotate-180 transition-transform duration-300"}
                aria-hidden
              >
                <path d="M23 4v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
              </svg>
              <span className="text-caption font-medium hidden sm:inline">Regenerate</span>
            </button>
            <AudioButton />
          </div>
        </header>

        <ol className="space-y-3 list-none m-0 p-0">
          {data.bullets.map((bullet, i) => {
            // LLM sometimes returns a slightly different paperId than what was sent.
            // Fall back to index-based paper (the prompt guarantees same order as input).
            const paper = papers.find((p) => p.id === bullet.paperId) ?? papers[i];
            const actualPaperId = paper?.id ?? bullet.paperId;
            const isSelected = selectedPaperId === actualPaperId;
            const scrollTo = (e: React.MouseEvent) => {
              e.preventDefault();
              onSelectPaper?.(actualPaperId);
              const el = document.getElementById(`paper-${actualPaperId}`);
              if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
            };
            return (
              <li key={actualPaperId} className="flex items-start gap-3">
                <a
                  href={`#paper-${actualPaperId}`}
                  onClick={scrollTo}
                  title={paper?.title ?? "Jump to paper"}
                  className={`flex-shrink-0 mt-[3px] w-[22px] h-[22px] rounded-full text-caption font-semibold flex items-center justify-center transition-colors no-underline ${
                    isSelected
                      ? "bg-accent text-bg"
                      : "bg-accent/15 text-accent hover:bg-accent hover:text-bg"
                  }`}
                >
                  {i + 1}
                </a>
                <p
                  className="text-body-lg lg:text-lead text-heading leading-[1.65] font-reading"
                >
                  {revealBullets ? (
                    <ScrambleText text={bullet.text} />
                  ) : (
                    bullet.text
                  )}
                </p>
              </li>
            );
          })}
        </ol>
      </section>
    </>
  );
}


function AudioButton() {
  return (
    <button
      type="button"
      disabled
      title="Audio briefing — coming soon"
      aria-label="Listen — coming soon"
      className="group inline-flex items-center gap-1.5 h-7 px-2 sm:pl-2 sm:pr-3 rounded-full bg-bg-secondary/60 text-text-faint cursor-not-allowed transition-all"
    >
      <svg
        width="11"
        height="11"
        viewBox="0 0 24 24"
        fill="currentColor"
        aria-hidden
      >
        <path d="M8 5v14l11-7z" />
      </svg>
      <span className="text-caption font-medium hidden sm:inline">Listen</span>
      <span className="text-[9.5px] opacity-70 uppercase tracking-[0.1em] ml-0.5 hidden sm:inline">
        soon
      </span>
    </button>
  );
}

function DigestSkeleton() {
  return (
    <section
      className="mb-8 rounded-2xl bg-surface shadow-card px-7 py-6"
      aria-busy="true"
    >
      <div className="h-3 w-32 bg-bg-secondary/70 rounded mb-4 animate-pulse" />
      <div className="space-y-2">
        <div className="h-4 w-full bg-bg-secondary/70 rounded animate-pulse" />
        <div className="h-4 w-[95%] bg-bg-secondary/70 rounded animate-pulse" />
        <div className="h-4 w-[88%] bg-bg-secondary/70 rounded animate-pulse" />
        <div className="h-4 w-[60%] bg-bg-secondary/70 rounded animate-pulse" />
      </div>
    </section>
  );
}
