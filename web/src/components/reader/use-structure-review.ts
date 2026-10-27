"use client";

// The model's review of the rules' structure, for the reading map (P12-53; B P12-42 §4; ruling §1h.428).
//
// With a model key the structure of a paper must be right, and the rules are there to save tokens: the page
// divides the paper by its rules (`draftOf`), and this hook asks the review route ONCE per paper for the
// model's corrections to that draft. What it hands the page is the review (`StructureReviewEntry`: indices
// and role names), which the page lays over the map with `applyStructureReview`; the page keeps the rules'
// map until it arrives, and for good when it never does — a refusal, a timeout, no key, no network.
//
// One request per paper, when the reading has a body, the page has a draft and the reader has a model
// (`enabled`: `providerConfigured` — not the deep-report switch, §1h.428 (a)). An answer is kept in this browser
// for 30 days (D9), under the paper and its upload revision (`buildReadingKey`), together with the digest of the
// draft it was made against: a kept review of another draft (the rules changed) is not laid over this one, and
// the paper is asked about again. A failure — the route's `unavailable` or `fellBack`, a review that does not
// fit the draft — is kept an hour, so a broken key does not bill every open; an error status, an answer that is
// not one and no network keep nothing: the next open asks again.
//
// Never two requests for one paper: the effect is keyed on the paper's key and on whether it may ask, not on
// the paper object (the page rebuilds that for a save flag or a feedback tick) or on the reader's key (read
// through a ref); it lets the first tick pass and sends nothing from a run cleaned up in it (dev StrictMode's
// double effect, P4-00c); and the request is aborted when the page goes, so an answer that arrives after is
// never kept. Every touch of localStorage is wrapped: a private window, a full quota or a corrupt entry must
// never cost the reader the page. What is kept is the model's corrections — indices and roles — and nothing of
// the paper; for a private PDF that is the owner's own browser, under the same key shape as the reading.
//
// Without a model, or while the page may not ask, the hook returns nothing at all and the map is Tier 0's.

import { useEffect, useMemo, useRef, useState } from "react";
import type { Paper } from "@/types";
import { apiFetch } from "@/lib/api";
import type { ProviderOverrideConfig } from "@/lib/llm/providers/types";
import { restoreReview, type StructureReviewEntry } from "@/lib/papers/structure-review";
import { buildReadingKey } from "./use-reading";

export const STRUCTURE_REVIEW_STORAGE_KEY = "peer-structure-review-v1";
const MAX_ENTRIES = 24;
/** An answer is kept 30 days (D9). */
export const ANSWER_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** A failure is kept an hour, so a broken key does not re-bill every open. */
export const FAILURE_TTL_MS = 60 * 60 * 1000;

/** What the route said, as the browser keeps it. */
export type StructureOutcome = { review: StructureReviewEntry } | { failed: true };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** An answer or a kept entry, read: the outcome it holds, or null for anything else. */
function readOutcome(value: unknown): StructureOutcome | null {
  if (!isRecord(value)) return null;
  if (isRecord(value.review)) {
    const review = restoreReview(value.review);
    return review ? { review } : null;
  }
  if (value.unavailable === true || typeof value.fellBack === "string" || value.failed === true) return { failed: true };
  return null;
}

type Store = Record<string, unknown>;

function readStore(): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STRUCTURE_REVIEW_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const atOf = (entry: unknown): number => (isRecord(entry) && typeof entry.at === "number" ? entry.at : 0);

/** What is kept for this paper and still fresh (30 days for an answer, an hour for a failure), or null. */
export function keptStructureReview(key: string): StructureOutcome | null {
  const entry = readStore()[key];
  if (!isRecord(entry)) return null;
  const age = Date.now() - atOf(entry);
  const outcome = readOutcome(entry);
  if (typeof entry.at !== "number" || age < 0 || !outcome) return null;
  return age < ("failed" in outcome ? FAILURE_TTL_MS : ANSWER_TTL_MS) ? outcome : null;
}

/** Keep what the route said for this paper; the reviews of at most 24 papers are kept, the newest. Exported so a
 *  test can stand in for an earlier open. */
export function rememberStructureReview(key: string, outcome: StructureOutcome): void {
  if (typeof window === "undefined") return;
  try {
    const store = readStore();
    store[key] = { ...outcome, at: Date.now() };
    const pruned = Object.fromEntries(
      Object.entries(store)
        .sort((a, b) => atOf(b[1]) - atOf(a[1]))
        .slice(0, MAX_ENTRIES),
    );
    localStorage.setItem(STRUCTURE_REVIEW_STORAGE_KEY, JSON.stringify(pruned));
  } catch {
    // The map is already on screen as the rules drew it; the memory is a convenience.
  }
}

/**
 * The model's review of this paper's structure, or undefined: nothing kept and nothing yet, no model, none could
 * be made, or it was made against another draft than this page's. Asked for once, when the reading has a body and
 * a draft (`draftDigest`, from `structureDraftOf`), the page has enabled it (`enabled`: the reader has a model) and
 * no usable answer is kept. `llmOverride` is the reader's own provider and key, when they have one — the same the
 * explain box sends; nothing else about them is sent.
 */
export function useStructureReview({
  paper,
  hasBody,
  draftDigest,
  enabled,
  llmOverride,
}: {
  paper: Paper | undefined;
  /** The reading has a body: there is a structure to review. */
  hasBody: boolean;
  /** The digest of the rules' draft this page holds (`StructureDraft.digest`); undefined where there is none. */
  draftDigest: string | undefined;
  /** The page's condition: the reader has a model (`providerConfigured`). */
  enabled: boolean;
  llmOverride?: ProviderOverrideConfig;
}): StructureReviewEntry | undefined {
  const paperId = paper?.id;
  const key = paperId ? buildReadingKey(paperId, paper?.fullTextUploadId, paper?.revision) : "";
  const hasDraft = draftDigest !== undefined;

  // Read once per paper. The server renders with no window and the first client render has no paper yet (the
  // store hydrates after mount), so the two agree.
  const kept = useMemo(() => (key ? keptStructureReview(key) : null), [key]);
  // A kept review of another draft is no answer for this page: ask again.
  const keptUsable = kept !== null && ("failed" in kept || kept.review.draftDigest === draftDigest);
  const [fetched, setFetched] = useState<{ id: string; review: StructureReviewEntry } | null>(null);

  // The request reads the paper, the draft and the reader's key through a ref: the effect is keyed on `key` (which
  // carries the paper's id and its upload revision), and the page hands a new object for any of them on many renders.
  const latest = useRef({ paper, llmOverride, draftDigest });
  useEffect(() => {
    latest.current = { paper, llmOverride, draftDigest };
  }, [paper, llmOverride, draftDigest]);

  useEffect(() => {
    if (!paperId || !key || !hasBody || !hasDraft || !enabled || keptUsable) return;
    const controller = new AbortController();
    (async () => {
      // P4-00c: let the first tick pass, and send nothing from a run that was cleaned up in it (dev StrictMode runs
      // the effect, cleans it up and runs it again in one tick). `use-paragraph-guide.ts` has the same guard.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      try {
        const { paper: current, llmOverride: override } = latest.current;
        const answer = await apiFetch<unknown>(`/api/papers/${encodeURIComponent(paperId)}/structure`, {
          method: "POST",
          body: JSON.stringify({ paper: current, ...(override ? { llmOverride: override } : {}) }),
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        const outcome = readOutcome(answer);
        if (!outcome) return;
        // A review made against another draft than the page's (the rules differ between this build and the
        // server's) is not laid over this one; it is kept as a failure, so the page does not ask on every open.
        if ("review" in outcome && outcome.review.draftDigest !== latest.current.draftDigest) {
          rememberStructureReview(key, { failed: true });
          return;
        }
        rememberStructureReview(key, outcome);
        if ("review" in outcome) setFetched({ id: key, review: outcome.review });
      } catch {
        // Nothing is kept: the next open of the page asks again.
      }
    })();
    return () => controller.abort();
  }, [paperId, key, hasBody, hasDraft, enabled, keptUsable]);

  return useMemo((): StructureReviewEntry | undefined => {
    if (!enabled || !hasDraft) return undefined;
    if (kept && "review" in kept && keptUsable) return kept.review;
    return fetched && fetched.id === key && fetched.review.draftDigest === draftDigest ? fetched.review : undefined;
  }, [enabled, hasDraft, kept, keptUsable, fetched, key, draftDigest]);
}
