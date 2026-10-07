// What "Say it plainly" wrote, kept in this browser, and which paragraphs show it now
// (P4-01; blueprint §3.6 "客户端 localStorage"; rulings §1h.12 (h)).
//
// Per paper, per paragraph (`paragraphKey`: the section's id and the paragraph's place in it)
// and per level: the rewrite, with a hash of the paragraph it was written for. Opening a
// paragraph the reader already had said plainly at that level shows the rewrite at once with
// no request — and a rewrite whose paragraph has since changed under the same place (the paper
// re-extracted) is not handed back (`keptFor` compares the hash). Nothing here is ever sent
// anywhere; the server keeps its own hour of memory under hashes, and none of this.
//
// A rewrite is Peer's paraphrase of the paper's own words, so for an uploaded PDF it is private
// text, in the reader's own browser — the same place their notes, questions and explain
// threads are. Signing out does not clear it, as with those. It is bounded so it cannot fill
// the browser's storage: ≤48 rewrites per paper (a paragraph at a level is one), the rewrites
// of ≤24 papers, the oldest dropped first.
//
// What is NOT kept: which paragraphs show their rewrite right now (`showing`, oldest first, so
// the latest is the one `u` takes back), which are waiting on the model (`busy`) and which
// could not be said plainly (`notices`, one line each). A reload shows the originals.
//
// Rehydrated after mount by <StoreHydrator/>, like the other stores (`skipHydration`).

import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { PlainLevel } from "@/lib/papers/plain-levels";
import { passageHash } from "@/store/explain-threads";

export const PLAIN_STORAGE_KEY = "peer-plain-v1";
export const MAX_PLAIN_PAPERS = 24;
export const MAX_PLAIN_PER_PAPER = 48;

/** One rewrite as kept: Peer's words, a hash of the paragraph they say again, and when. */
export interface KeptRewrite {
  plain: string;
  hash: string;
  at: string;
}

type ByLevel = Partial<Record<PlainLevel, KeptRewrite>>;
/** Paper id -> paragraph key -> level -> rewrite. */
export type PlainByPaper = Record<string, Record<string, ByLevel>>;

/** A paragraph showing its rewrite, and at which level. */
export interface ShownEntry {
  key: string;
  level: PlainLevel;
}

/** Why a paragraph has no rewrite after the reader asked: the numbers could not be kept exact,
 *  or the model had nothing to give. */
export type PlainNotice = "numbers_changed" | "unavailable";

/** A paragraph's place: the section's id and the paragraph's index in it. */
export function paragraphKey(sectionId: string, paragraphIndex: number): string {
  return `${sectionId}:${paragraphIndex}`;
}

/** The rewrite kept for this paragraph at this level — only when the paragraph still says what
 *  it said when the rewrite was written. */
export function keptFor(byPaper: PlainByPaper, paperId: string, key: string, level: PlainLevel, text: string): KeptRewrite | undefined {
  const kept = byPaper[paperId]?.[key]?.[level];
  return kept && kept.hash === passageHash(text) ? kept : undefined;
}

interface PlainRewritesState {
  byPaper: PlainByPaper;
  showing: Record<string, ShownEntry[]>;
  busy: Record<string, string[]>;
  notices: Record<string, Record<string, PlainNotice>>;
  /** Keep (or replace) the rewrite for a paragraph at a level. */
  remember: (paperId: string, key: string, level: PlainLevel, entry: { plain: string; text: string }, at?: string) => void;
  /** Show a paragraph's rewrite at a level: last in the list, once. */
  show: (paperId: string, key: string, level: PlainLevel) => void;
  /** Show the original alone again; the rewrite stays kept. */
  hide: (paperId: string, key: string) => void;
  /** Hide the rewrite shown most recently — one that is still kept — and say whether there was one. */
  hideLatest: (paperId: string) => boolean;
  setBusy: (paperId: string, key: string, busy: boolean) => void;
  isBusy: (paperId: string, key: string) => boolean;
  setNotice: (paperId: string, key: string, notice: PlainNotice | null) => void;
  clearPaper: (paperId: string) => void;
}

const newestOf = (paper: Record<string, ByLevel>): string => {
  let latest = "";
  for (const levels of Object.values(paper)) for (const kept of Object.values(levels)) if (kept && kept.at > latest) latest = kept.at;
  return latest;
};

/** At most 24 papers: those whose newest rewrite is oldest go first. */
function withoutOldestPapers(byPaper: PlainByPaper): PlainByPaper {
  const papers = Object.entries(byPaper);
  if (papers.length <= MAX_PLAIN_PAPERS) return byPaper;
  papers.sort((a, b) => newestOf(b[1]).localeCompare(newestOf(a[1])));
  return Object.fromEntries(papers.slice(0, MAX_PLAIN_PAPERS));
}

/** At most 48 rewrites in a paper (a paragraph at a level counts one): the oldest go first. */
function withoutOldestRewrites(paper: Record<string, ByLevel>): Record<string, ByLevel> {
  const all: Array<{ key: string; level: PlainLevel; at: string }> = [];
  for (const [key, levels] of Object.entries(paper)) {
    for (const [level, kept] of Object.entries(levels) as Array<[PlainLevel, KeptRewrite | undefined]>) if (kept) all.push({ key, level, at: kept.at });
  }
  if (all.length <= MAX_PLAIN_PER_PAPER) return paper;
  all.sort((a, b) => b.at.localeCompare(a.at));
  const next: Record<string, ByLevel> = {};
  for (const { key, level } of all.slice(0, MAX_PLAIN_PER_PAPER)) {
    next[key] = { ...next[key], [level]: paper[key][level] };
  }
  return next;
}

function without<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

export const usePlainRewritesStore = create<PlainRewritesState>()(
  persist(
    (set, get) => ({
      byPaper: {},
      showing: {},
      busy: {},
      notices: {},
      remember: (paperId, key, level, entry, at = new Date().toISOString()) =>
        set((s) => {
          const paper = s.byPaper[paperId] ?? {};
          const kept: KeptRewrite = { plain: entry.plain, hash: passageHash(entry.text), at };
          return {
            byPaper: withoutOldestPapers({
              ...s.byPaper,
              [paperId]: withoutOldestRewrites({ ...paper, [key]: { ...paper[key], [level]: kept } }),
            }),
          };
        }),
      show: (paperId, key, level) =>
        set((s) => ({
          showing: { ...s.showing, [paperId]: [...(s.showing[paperId] ?? []).filter((entry) => entry.key !== key), { key, level }] },
        })),
      hide: (paperId, key) =>
        set((s) => {
          const list = s.showing[paperId];
          if (!list?.some((entry) => entry.key === key)) return s;
          const rest = list.filter((entry) => entry.key !== key);
          return { showing: rest.length > 0 ? { ...s.showing, [paperId]: rest } : without(s.showing, paperId) };
        }),
      hideLatest: (paperId) => {
        const state = get();
        const list = [...(state.showing[paperId] ?? [])];
        let hidden = false;
        // The latest one that is still kept: an entry whose rewrite is gone shows nothing, so
        // there is nothing for `u` to take back there.
        while (list.length > 0 && !hidden) {
          const last = list.pop() as ShownEntry;
          hidden = state.byPaper[paperId]?.[last.key]?.[last.level] !== undefined;
        }
        if (list.length === (state.showing[paperId] ?? []).length) return false;
        set((s) => ({ showing: list.length > 0 ? { ...s.showing, [paperId]: list } : without(s.showing, paperId) }));
        return hidden;
      },
      setBusy: (paperId, key, busy) =>
        set((s) => {
          const list = s.busy[paperId] ?? [];
          if (busy === list.includes(key)) return s;
          const next = busy ? [...list, key] : list.filter((one) => one !== key);
          return { busy: next.length > 0 ? { ...s.busy, [paperId]: next } : without(s.busy, paperId) };
        }),
      isBusy: (paperId, key) => (get().busy[paperId] ?? []).includes(key),
      setNotice: (paperId, key, notice) =>
        set((s) => {
          const lines = s.notices[paperId] ?? {};
          if (notice === null) {
            if (!(key in lines)) return s;
            const rest = without(lines, key);
            return { notices: Object.keys(rest).length > 0 ? { ...s.notices, [paperId]: rest } : without(s.notices, paperId) };
          }
          return { notices: { ...s.notices, [paperId]: { ...lines, [key]: notice } } };
        }),
      clearPaper: (paperId) =>
        set((s) => {
          if (!s.byPaper[paperId]) return s;
          return { byPaper: without(s.byPaper, paperId) };
        }),
    }),
    {
      name: PLAIN_STORAGE_KEY,
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ byPaper: s.byPaper }),
    },
  ),
);
