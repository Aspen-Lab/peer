"use client";

import { useEffect, useSyncExternalStore } from "react";
import type { Paper } from "@/types";
import type { PaperReading } from "@/lib/papers/reading";
import { hasReadableText } from "@/lib/papers/readability";
import { buildReadingKey, readCached, READING_VERSION, rememberReading } from "@/components/reader/use-reading";

type State = "checking" | "readable" | "abstract" | "unavailable" | "unknown";
const states = new Map<string, { state: State; at: number }>();
const STATE_TTL_MS = 24 * 60 * 60 * 1000;
const setState = (key: string, state: State) => states.set(key, { state, at: Date.now() });
const listeners = new Set<() => void>();
const queued = new Set<string>();
const tasks: Array<{ key: string; paper: Paper; refresh: boolean }> = [];
let active = 0;
const MAX_CONCURRENT = 2;
const notify = () => listeners.forEach((fn) => fn());
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

function hasReadableBody(reading: PaperReading): boolean {
  if (reading.provenance?.fullText !== "html" && reading.provenance?.fullText !== "pdf") return false;
  if (!Array.isArray(reading.body)) return false;
  const paragraphs = reading.body.flatMap((section) => Array.isArray(section?.paragraphs) ? section.paragraphs.filter((p) => typeof p === "string") : []);
  return hasReadableText(paragraphs.join(" "));
}

function pump() {
  while (active < MAX_CONCURRENT && tasks.length) {
    const task = tasks.shift()!;
    active++;
    void check(task).finally(() => { active--; queued.delete(task.key); pump(); });
  }
}

async function check({ key, paper, refresh }: { key: string; paper: Paper; refresh: boolean }) {
  try {
    const url = `/api/papers/${encodeURIComponent(paper.id)}/reading?v=${READING_VERSION}&availability=1${paper.fullTextUploadId ? `&upload=${encodeURIComponent(paper.fullTextUploadId)}` : ""}${refresh ? "&refresh=1" : ""}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    if (!res.ok) throw new Error("Reading unavailable");
    const availability = res.headers.get("X-Peer-Readability");
    const reading = await res.json() as PaperReading;
    if (reading.version !== READING_VERSION || !reading.provenance) throw new Error("Unexpected reading");
    if (availability === "readable" && hasReadableBody(reading)) {
      rememberReading(key, reading);
      setState(key, "readable");
    } else if (availability === "abstract") {
      rememberReading(key, reading);
      setState(key, reading.provenance.abstract === "none" ? "unavailable" : "abstract");
    } else {
      setState(key, "unknown");
    }
  } catch {
    setState(key, "unknown");
  }
  notify();
}

function schedule(paper: Paper, refresh = false) {
  const key = buildReadingKey(paper.id, paper.fullTextUploadId, paper.revision);
  const existing = states.get(key);
  if (queued.has(key)) return;
  const cached = readCached(key);
  if (!refresh && cached && hasReadableBody(cached)) {
    setState(key, "readable");
    notify();
    return;
  }
  if (!refresh && existing && Date.now() - existing.at < STATE_TTL_MS) return;
  setState(key, "checking");
  queued.add(key);
  tasks.push({ key, paper, refresh });
  notify();
  pump();
}

const labels: Record<State, string> = {
  checking: "Checking full text…",
  readable: "Read in Peer",
  abstract: "Abstract only",
  unavailable: "Full text unavailable",
  unknown: "Couldn’t check · Retry",
};

export function ReadingAvailability({ paper }: { paper: Paper }) {
  const key = buildReadingKey(paper.id, paper.fullTextUploadId, paper.revision);
  const state = useSyncExternalStore<State>(subscribe, () => states.get(key)?.state ?? "checking", () => "checking");
  useEffect(() => { schedule(paper); }, [key, paper]);
  if (state === "unknown") {
    return <button type="button" className="reading-availability reading-availability-retry" onClick={(event) => { event.preventDefault(); event.stopPropagation(); schedule(paper, true); }} aria-label="Couldn’t check full text. Try again.">{labels[state]}</button>;
  }
  return <span className={`reading-availability reading-availability-${state}`}>{labels[state]}</span>;
}
