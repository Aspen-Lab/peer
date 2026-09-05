"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import type { Paper } from "@/types";
import { apiFetch } from "@/lib/api";
import { useFeedStore } from "@/store/feed";
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

const CACHE_KEY = "peer-digest-cache";
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
    const raw = localStorage.getItem(CACHE_KEY);
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
    localStorage.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

function clearCache() {
  try { localStorage.removeItem(CACHE_KEY); } catch { /* noop */ }
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

  // Order-insensitive (a pure re-shuffle of the same papers must still hit the
  // cache) and context-aware (a profile-context change must invalidate a stale
  // digest). Bullets are matched to papers by paperId downstream, so sorting the
  // ids here has no display effect.
  const paperKey = useMemo(() => {
    const ids = papers.map((p) => p.id).sort().join("|");
    const ctx = contextHint ?? "";
    return `${ids}::${ctx.length}:${simpleHash(ctx)}::${llmOverride?.provider ?? "tier0"}`;
  }, [papers, contextHint, llmOverride?.provider]);

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

