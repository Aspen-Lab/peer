"use client";

// Peer's gist of each paragraph, for the reading map (P3-03; ruling §1h.6;
// user decision §1a.8).
//
// One request per paper: when the reading has a body to put the gists under, the
// reader has a model (the page's `providerConfigured`, which is
// `aiAvailability(...) !== "none"`) and no answer is kept in this browser. The
// route answers one of three things — a guide, "skipped" (the paper has more
// paragraphs than the pass takes) or "unavailable" (no model could write it, or
// it said nothing grounded) — and each is kept for a day under the paper and its
// upload revision, so a second open of the page asks nothing and a skipped or
// unavailable paper is not asked about again until tomorrow. A failed request —
// an error status, an answer that is not one, no network — keeps nothing: the
// next open asks again.
//
// Never two requests for one paper: the effect is keyed on the paper's key and
// on whether it may ask, not on the paper object (the page rebuilds that for a
// save flag or a feedback tick) or on the reader's key (read through a ref); and
// the request is aborted when the page goes, so an answer that arrives after is
// never kept. Every touch of localStorage is wrapped: a private window, a full
// quota or a corrupt entry must never cost the reader the page.
//
// What is kept is Peer's own words — the gists — and nothing of the paper: for a
// private PDF that is the owner's own browser, under the same key shape as the
// reading (`buildReadingKey`), exactly as the reading is kept.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Paper } from "@/types";
import { apiFetch } from "@/lib/api";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { GUIDE_CAPS, type GistRecord, type ParagraphGuide } from "@/lib/papers/paragraph-guide";
import { buildReadingKey } from "./use-reading";

export const PARAGRAPH_GUIDE_STORAGE_KEY = "peer-paragraph-guide-v1";
const MAX_ENTRIES = 24;
const TTL_MS = 24 * 60 * 60 * 1000;

/** What the route said, as the browser keeps it. */
export type GuideOutcome = { guide: ParagraphGuide } | { skipped: "too_many_paragraphs" } | { unavailable: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The gists a map may draw: only text, non-empty, at most 120 characters, under a
 *  whole-number index — whatever a corrupt store or a surprising answer holds. Null
 *  when nothing is left. */
function cleanGists(value: unknown): GistRecord | null {
  if (!isRecord(value)) return null;
  const out: GistRecord = {};
  for (const [sectionId, section] of Object.entries(value)) {
    if (sectionId === "__proto__" || !isRecord(section)) continue;
    for (const [index, gist] of Object.entries(section)) {
      if (!/^\d+$/.test(index) || typeof gist !== "string") continue;
      const text = gist.trim();
      if (!text || text.length > GUIDE_CAPS.gistChars) continue;
      (out[sectionId] ??= {})[Number(index)] = text;
    }
  }
  return Object.keys(out).length > 0 ? out : null;
}

/** An answer or a kept entry, read: the outcome it holds, or null for anything else. */
function readOutcome(value: unknown): GuideOutcome | null {
  if (!isRecord(value)) return null;
  if (value.skipped === "too_many_paragraphs") return { skipped: "too_many_paragraphs" };
  if (value.unavailable === true) return { unavailable: true };
  if (isRecord(value.guide)) {
    const gists = cleanGists(value.guide.gists);
    if (gists) return { guide: { docHash: typeof value.guide.docHash === "string" ? value.guide.docHash : "", gists } };
  }
  return null;
}

type Store = Record<string, unknown>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(PARAGRAPH_GUIDE_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const atOf = (entry: unknown): number => (isRecord(entry) && typeof entry.at === "number" ? entry.at : 0);

/** What is kept for this paper and still fresh (a day), or null. */
export function keptParagraphGuide(key: string): GuideOutcome | null {
  const entry = readStore()[key];
  if (!isRecord(entry)) return null;
  const age = Date.now() - atOf(entry);
  if (typeof entry.at !== "number" || age < 0 || age >= TTL_MS) return null;
  return readOutcome(entry);
}

/** Keep what the route said for this paper, for a day; the guides of at most
 *  24 papers are kept, the newest. Exported so a test can stand in for an earlier open. */
export function rememberParagraphGuide(key: string, outcome: GuideOutcome): void {
  if (typeof window === "undefined") return;
  try {
    const store = readStore();
    store[key] = { ...outcome, at: Date.now() };
    const pruned = Object.fromEntries(
      Object.entries(store)
        .sort((a, b) => atOf(b[1]) - atOf(a[1]))
        .slice(0, MAX_ENTRIES),
    );
    localStorage.setItem(PARAGRAPH_GUIDE_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // The map is already on screen without its gists; the memory is a convenience.
  }
}

/**
 * Peer's gists for the paper's paragraphs — `gists[sectionId][paragraphIndex]` — or
 * undefined (nothing kept and nothing yet, or none can be written). Asked for once, when
 * the reading has a `body`, the reader has a model (`enabled`) and no answer is kept.
 * `llmOverride` is the reader's own provider and key, when they have one — the same the
 * explain box sends; nothing else about them is sent.
 */
export function useParagraphGuide({
  paper,
  hasBody,
  enabled,
  llmOverride,
}: {
  paper: Paper | undefined;
  /** The reading has a body: there are paragraphs to put gists under. */
  hasBody: boolean;
  /** The reader has a model, from anywhere (`providerConfigured`). */
  enabled: boolean;
  llmOverride?: ProviderOverrideConfig;
}): GistRecord | undefined {
  const paperId = paper?.id;
  const key = paperId ? buildReadingKey(paperId, paper?.fullTextUploadId, paper?.revision) : "";

  // Read once per paper. The server renders with no window and the first client
  // render has no paper yet (the store hydrates after mount), so the two agree.
  const kept = useMemo(() => (key ? keptParagraphGuide(key) : null), [key]);
  const [fetched, setFetched] = useState<{ id: string; gists: GistRecord } | null>(null);

  // The request reads the paper and the reader's key through a ref: the effect is
  // keyed on `key` (which carries the paper's id and its upload revision), and
  // the page hands a new object for either on many renders.
  const latest = useRef({ paper, llmOverride });
  useEffect(() => {
    latest.current = { paper, llmOverride };
  }, [paper, llmOverride]);

  useEffect(() => {
    if (!paperId || !key || !hasBody || !enabled || kept) return;
    const controller = new AbortController();
    (async () => {
      try {
        const { paper: current, llmOverride: override } = latest.current;
        const answer = await apiFetch<unknown>(`/api/papers/${encodeURIComponent(paperId)}/paragraph-guide`, {
          method: "POST",
          body: JSON.stringify({ paper: current, ...(override ? { llmOverride: override } : {}) }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const outcome = readOutcome(answer);
        if (!outcome) return;
        rememberParagraphGuide(key, outcome);
        if ("guide" in outcome) setFetched({ id: key, gists: outcome.guide.gists });
      } catch {
        // Nothing is kept: the next open of the page asks again.
      }
    })();
    return () => controller.abort();
  }, [paperId, key, hasBody, enabled, kept]);

  if (kept && "guide" in kept) return kept.guide.gists;
  return fetched && fetched.id === key ? fetched.gists : undefined;
}
