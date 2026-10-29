"use client";

// The reading the page renders — the abstract-only one at first paint, the
// server's once it arrives.
//
// `buildReading(paper, null)` is synchronous and needs nothing but the record,
// so the page is complete before any request. The server reading adds the
// full-text blocks (below the Decision block, so nothing above it moves) and
// is one document per paper for every reader, which is why it can live in
// localStorage for a day: it carries no profile and no key. A private PDF's
// reading is the owner's own and lives there under its own key (P0-02).
//
// P12-58 (rule 3): the server waits eight seconds for the full text and, if the attempt has not
// finished, answers with the abstract alone, marked pending (`full-text-pending.ts`). The hook
// does not take that for the answer: it asks again, one request at a time, after 2, 4, 8 and 16
// seconds and then every 20, until the sections arrive or three minutes have passed since the
// first ask. While it waits the page shows its one pending line (`wait: "pending"`); when the
// body arrives it replaces the abstract in place — nothing here scrolls, and nothing remounts;
// after three minutes `wait` is "gave-up" and the page says so and points at the reload. A
// pending answer is never kept, in the browser or anywhere else.

import { useEffect, useMemo, useState } from "react";
import type { Paper } from "@/types";
import { buildReading, type PaperReading } from "@/lib/papers/reading";
import { isFullTextPending } from "@/lib/papers/full-text-pending";
import { FULL_TEXT_WAIT } from "./copy";

const STORAGE_KEY = "peer-reading-v2";
const MAX_ENTRIES = 40;
const TTL_MS = 24 * 60 * 60 * 1000;
/** The shape both gates below accept. Typed from the document itself, so
 *  bumping `PaperReading["version"]` is the only edit a shape change needs.
 *
 *  It is also in the request's URL (`?v=`, below). The route answers a public
 *  paper with `public, s-maxage=86400, stale-while-revalidate=604800`, and a
 *  shared cache is keyed by the URL: with the same URL for every version, a
 *  cache holding a body of the old shape went on serving it to a client that
 *  refuses it, and the reader got the abstract alone for a day instead of the
 *  old full reading (P8-04). The version in the URL moves the cache's key with
 *  the bump, so an old body is never served to a newer client. The route
 *  ignores the parameter. */
export const READING_VERSION: PaperReading["version"] = 18;

/** P12-58: how long to wait after the 1st, 2nd, 3rd and 4th pending answer before asking again. */
export const POLL_DELAYS_MS: readonly number[] = [2_000, 4_000, 8_000, 16_000];
/** P12-58: after those, how long between asks. */
export const POLL_EVERY_MS = 20_000;
/** P12-58: how long, from the first ask, the hook keeps asking for a full text that is pending. */
export const POLL_BUDGET_MS = 3 * 60 * 1000;

/** P12-58: the wait before the next ask, after `pendingAnswers` (1 or more) answers that said pending. */
export function pollDelayMs(pendingAnswers: number): number {
  return POLL_DELAYS_MS[pendingAnswers - 1] ?? POLL_EVERY_MS;
}

/** What the page is waiting on: the full text is pending (still asking), or it was not there after
 *  the whole budget (stopped asking); null when there is nothing to wait for. */
export type ReadingWait = "pending" | "gave-up" | null;

/**
 * P12-58 (rule 3): the Decision block's sentences while the full text has not settled. The first one
 * is `describeAvailability`'s reading sentence — "No abstract is published where Peer can read it" or
 * "Abstract only. ..." — which is not true of a paper that is still being read; it gives way to the
 * page's one pending line, and after the budget to the line that says the text could not be read yet
 * and points at the reload. Any sentence after the first (a model that failed) stays, and so does the
 * model's own sentence (`modelSentence`: a report answered, and its sentence names what it read).
 */
export function sentencesWhileWaiting(sentences: string[], wait: ReadingWait, modelSentence: boolean): string[] {
  if (modelSentence || wait === null) return sentences;
  return [wait === "pending" ? FULL_TEXT_WAIT.pending : FULL_TEXT_WAIT.gaveUp, ...sentences.slice(1)];
}

type ReadingCache = Record<string, { reading: PaperReading; ts: number }>;

/**
 * 9-15 (A9-10): a pure function, same reasoning as use-model-report.ts's
 * `buildReportKey` — testable without rendering the hook (no DOM in this
 * project's Vitest config), and `revision` (9-12) tells a delete-then-
 * re-upload of the identical bytes apart from the attachment a stale key
 * was built against. `undefined` for every paper without a private
 * attachment, so the key is unchanged for the vast majority of papers.
 */
export function buildReadingKey(
  paperId: string | undefined,
  uploadId: string | undefined,
  revision: number | undefined,
): string {
  return `${paperId ?? ""}|${uploadId ?? "public"}|${revision ?? ""}`;
}

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

function readCached(key: string): PaperReading | null {
  const entry = readCache()[key];
  if (!entry?.reading || entry.reading.version !== READING_VERSION) return null;
  if (Date.now() - (entry.ts ?? 0) >= TTL_MS) return null;
  return entry.reading;
}

/** What a server reading is cached as — exported so a test can stand in for
 *  the first visit that wrote it. */
export function rememberReading(key: string, reading: PaperReading): void {
  writeCached(key, reading);
}

function writeCached(key: string, reading: PaperReading): void {
  if (typeof window === "undefined") return;
  try {
    const cache = readCache();
    cache[key] = { reading, ts: Date.now() };
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
  /** Set while `reading` is null because the full text is pending, or was not there in time. */
  wait: ReadingWait;
}

/** One ask, as the loop below needs it. */
type Asked =
  /** A settled answer; `keep` is whether this browser should remember it. */
  | { kind: "reading"; reading: PaperReading; keep: boolean }
  /** The route waited for the full text and it had not settled. */
  | { kind: "pending" }
  /** No usable answer; `again` is whether asking again could help (a dropped connection, a 5xx). */
  | { kind: "failed"; again: boolean };

async function askReading(url: string, signal: AbortSignal, privatePdf: boolean): Promise<Asked> {
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) return { kind: "failed", again: res.status >= 500 };
    const reading = (await res.json()) as PaperReading;
    if (reading?.version !== READING_VERSION) return { kind: "failed", again: false };
    // The route answers a full text that has not settled with the abstract alone, marked pending
    // (P12-58). It is never kept, whatever the headers say, and it is not the answer.
    if (isFullTextPending(reading)) return { kind: "pending" };
    // The route answers `no-store` when the full-text attempt timed out —
    // that reading is the abstract alone, and keeping it for a day would
    // hide the sections the next request gets. Follow the server's own
    // verdict on what is worth keeping. A private reading is always
    // `private, no-store` (it must never sit in a shared HTTP cache), so
    // there the reading itself says whether the PDF was read: a
    // `fullText` of "none" is the abstract-only answer.
    const cacheControl = res.headers.get("cache-control") ?? "";
    const keep = privatePdf
      ? reading.provenance?.fullText !== "none"
      : !/\bno-store\b/i.test(cacheControl);
    return { kind: "reading", reading, keep };
  } catch {
    return { kind: "failed", again: true };
  }
}

/** Resolves after `ms`, or at once when `signal` aborts (the timer is cleared either way). */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);
    signal.addEventListener("abort", done, { once: true });
  });
}

/**
 * The reading for `paper`: the abstract-only reading until the server's
 * arrives, then that. `fromServer` says which is on screen, so the page can
 * stagger in the blocks that were not there at first paint.
 */
export function useReading(paper: Paper | undefined): {
  reading: PaperReading | null;
  fromServer: boolean;
  /** P12-58: "pending" while the hook is still asking for a full text that has not settled, "gave-up"
   *  once the budget ran out; `reading` is the abstract alone in both, and `fromServer` is false. */
  wait: ReadingWait;
} {
  const paperId = paper?.id;
  useEffect(() => {
    // v1 could persist private upload text from the old public reading route.
    try { localStorage.removeItem("peer-reading-v1"); } catch { /* storage unavailable */ }
  }, []);
  const uploadId = paper?.fullTextUploadId;
  const privatePdf = !!uploadId || !!paperId?.startsWith("upload:");
  const readingKey = buildReadingKey(paperId, uploadId, paper?.revision);

  // Synchronous and complete: the page the reader sees before any request.
  const reading0 = useMemo(() => (paper ? buildReading(paper, null) : null), [paper]);

  // Read once per paper. The server renders with no window and the first
  // client render has no paper yet (the store hydrates after mount), so the
  // two agree.
  //
  // P0-02 (spec D0): keyed by `readingKey`, which names the upload and its
  // revision, so a private PDF's reading is cached too — under its own key,
  // never the public paper's — instead of being read again on every open.
  const cached = useMemo(() => (paperId ? readCached(readingKey) : null), [paperId, readingKey]);

  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => {
    if (!paperId || cached) return;
    const controller = new AbortController();
    const { signal } = controller;
    (async () => {
      // The first tick, as `use-model-report.ts` has it (P10-40, BACKLOG-04): a double effect
      // (StrictMode in dev, or a key that changes at once) cleans the first run up before
      // this line, so only the run that is kept goes on to ask.
      await Promise.resolve();
      if (signal.aborted) return;
      // `v` first, so a private request keeps its `upload` parameter after it.
      const url = `/api/papers/${encodeURIComponent(paperId)}/reading?v=${READING_VERSION}${uploadId ? `&upload=${encodeURIComponent(uploadId)}` : ""}`;
      const startedAt = Date.now();
      let pendingAnswers = 0;
      // One request in flight at a time: the next ask is made only after the last one answered
      // and the wait after it has passed. The cleanup below aborts the request and the wait both.
      for (;;) {
        const asked = await askReading(url, signal, privatePdf);
        if (signal.aborted) return;
        if (asked.kind === "reading") {
          if (asked.keep) writeCached(readingKey, asked.reading);
          setFetched({ id: readingKey, reading: asked.reading, wait: null });
          return;
        }
        // A first ask that fails is the end of it, as it always was; so is an answer that asking
        // again cannot change (a 4xx, a shape this build refuses). A dropped connection or a 5xx
        // after the route has already said "pending" is a blip in a wait that is under way.
        if (asked.kind === "failed" && (pendingAnswers === 0 || !asked.again)) {
          setFetched({ id: readingKey, reading: null, wait: null });
          return;
        }
        pendingAnswers += 1;
        const delay = pollDelayMs(pendingAnswers);
        if (Date.now() - startedAt + delay > POLL_BUDGET_MS) {
          setFetched({ id: readingKey, reading: null, wait: "gave-up" });
          return;
        }
        setFetched((before) =>
          before && before.id === readingKey && before.reading === null && before.wait === "pending"
            ? before
            : { id: readingKey, reading: null, wait: "pending" },
        );
        await pause(delay, signal);
        if (signal.aborted) return;
      }
    })();
    return () => controller.abort();
  }, [paperId, cached, uploadId, privatePdf, readingKey]);

  const server = fetched && fetched.id === readingKey ? fetched.reading : null;
  const reading = server ?? cached ?? reading0;
  const wait = fetched && fetched.id === readingKey ? fetched.wait : null;
  return { reading, fromServer: Boolean(server ?? cached), wait };
}
