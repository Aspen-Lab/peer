"use client";

// The reading the page renders — the abstract-only one at first paint, the
// server's once it arrives.
//
// `buildReading(paper, null)` is synchronous and needs nothing but the record,
// so the page is complete before any request. The server reading adds the
// full-text blocks (below the Decision block, so nothing above it moves) and
// is one document per paper for every reader, which is why it can live in
// localStorage for a day: it carries no profile and no key.

import { useEffect, useMemo, useState } from "react";
import type { Paper } from "@/types";
import { buildReading, type PaperReading } from "@/lib/papers/reading";

const STORAGE_KEY = "peer-reading-v1";
const MAX_ENTRIES = 40;
const TTL_MS = 24 * 60 * 60 * 1000;
/** The shape both gates below accept. Typed from the document itself, so
 *  bumping `PaperReading["version"]` is the only edit a shape change needs. */
const READING_VERSION: PaperReading["version"] = 2;

type ReadingCache = Record<string, { reading: PaperReading; ts: number }>;

// Every touch of localStorage is wrapped: a private window, a full quota or
// a corrupt entry must never cost the reader the page.
function readCache(): ReadingCache {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as ReadingCache) : {};
  } catch {
    return {};
  }
}

function readCached(paperId: string): PaperReading | null {
  const entry = readCache()[paperId];
  if (!entry?.reading || entry.reading.version !== READING_VERSION) return null;
  if (Date.now() - (entry.ts ?? 0) >= TTL_MS) return null;
  return entry.reading;
}

function writeCached(paperId: string, reading: PaperReading): void {
  if (typeof window === "undefined") return;
  try {
    const cache = readCache();
    cache[paperId] = { reading, ts: Date.now() };
    const pruned = Object.fromEntries(
      Object.entries(cache)
        .sort((a, b) => (b[1].ts ?? 0) - (a[1].ts ?? 0))
        .slice(0, MAX_ENTRIES),
    );
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // The reading is already on screen; the cache is a convenience.
  }
}

interface Fetched {
  id: string;
  reading: PaperReading | null;
}

/**
 * The reading for `paper`: the abstract-only reading until the server's
 * arrives, then that. `fromServer` says which is on screen, so the page can
 * stagger in the blocks that were not there at first paint.
 */
export function useReading(paper: Paper | undefined): {
  reading: PaperReading | null;
  fromServer: boolean;
} {
  const paperId = paper?.id;

  // Synchronous and complete: the page the reader sees before any request.
  const reading0 = useMemo(() => (paper ? buildReading(paper, null) : null), [paper]);

  // Read once per paper. The server renders with no window and the first
  // client render has no paper yet (the store hydrates after mount), so the
  // two agree.
  const cached = useMemo(() => (paperId ? readCached(paperId) : null), [paperId]);

  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (!paperId || cached) return;
    const controller = new AbortController();
    (async () => {
      try {
        const res = await fetch(`/api/papers/${encodeURIComponent(paperId)}/reading`, {
          signal: controller.signal,
        });
        if (!res.ok) throw new Error(`reading HTTP ${res.status}`);
        const reading = (await res.json()) as PaperReading;
        if (controller.signal.aborted) return;
        if (reading?.version !== READING_VERSION) throw new Error("reading: unexpected shape");
        // The route answers `no-store` when the full-text attempt timed out —
        // that reading is the abstract alone, and keeping it for a day would
        // hide the sections the next request gets. Follow the server's own
        // verdict on what is worth keeping.
        const cacheControl = res.headers.get("cache-control") ?? "";
        if (!/\bno-store\b/i.test(cacheControl)) writeCached(paperId, reading);
        setFetched({ id: paperId, reading });
      } catch {
        if (!controller.signal.aborted) setFetched({ id: paperId, reading: null });
      }
    })();
    return () => controller.abort();
  }, [paperId, cached]);

  const server = fetched && fetched.id === paperId ? fetched.reading : null;
  const reading = server ?? cached ?? reading0;
  return { reading, fromServer: Boolean(server ?? cached) };
}
