// The reader's notes, kept in this browser.
//
// Local-first, the way Obsidian keeps a vault: a note is written, saved and
// read on this device, and leaves it only when the reader exports it. Nothing
// here is sent to Peer's server — which is also why signing out does not
// clear it: an account never brought these here, so the sign-out reset
// (lib/feed/session-step.ts) has no claim on them. /privacy says so.
//
// Rehydrated after mount by <StoreHydrator/>, like the other stores, so the
// first client render matches the server's.

import { useSyncExternalStore } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { Block, Citable, Note } from "@/lib/notes/types";
import { citedKeys, type NoteAnchorMap, stickyBlocks, stickyParagraphs, stickyQuote, stickySpan, stickyText, withStickyText } from "@/lib/notes/blocks";
import { readingNote, type ReadingNoteExtras } from "@/lib/notes/templates";
import { MATH_CLOSE, MATH_OPEN } from "@/lib/text/math";

/** U+2060: the word joiner a note's tag opens with (`NoteTag`), which allows no line break before the tag. */
const TAG_JOINER = "\u2060";

/**
 * P10-24 (X-B2′, BACKLOG-87): a passage without a note tag's text. A browser's selection reads the tag's `<sup>` as text —
 * the word joiner and "[n]" — in the middle of the words it runs across; the passage is the paragraph's words, so a tag
 * (the joiner and its "[n]") and any stray joiner are removed. A "[12]" with no joiner before it is the paper's own
 * words (a citation) and stays.
 */
export function stripTagText(passage: string): string {
  return passage.replace(new RegExp(`${TAG_JOINER}\\[\\d+\\]`, "g"), "").replace(new RegExp(TAG_JOINER, "g"), "");
}

/**
 * P10-09f (review 7.1c; rule 1): where a selection's words stand in the paragraph's text — the first occurrence of the
 * passage (white space in the passage matches any white space in the paragraph; the selection arrives collapsed).
 * A formula's TeX is not prose: no match starts or ends inside one. Null when the passage is not found whole.
 * P10-35: `from` starts the search at that position, so the next occurrence can be asked for.
 */
export function locatePassage(paragraph: string, passage: string, from = 0): { start: number; end: number } | null {
  // P10-24: a passage that still arrives with a tag's text (an older caller) is searched by its words.
  const words = stripTagText(passage).split(/\s+/).filter(Boolean);
  if (words.length === 0) return null;
  const masked = paragraph.replace(new RegExp(`${MATH_OPEN}[^${MATH_CLOSE}]*${MATH_CLOSE}`, "g"), (math) => "\u0000".repeat(math.length));
  const found = new RegExp(words.map((word) => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"), "g");
  found.lastIndex = Math.max(0, from);
  const hit = found.exec(masked);
  return hit ? { start: hit.index, end: hit.index + hit[0].length } : null;
}

// ── P10-35 (BACKLOG-91): a note finds its passage again by its quote ──────

/**
 * P10-36: the one check of a ranged anchor, which the store (`anchorHolds`, `resolveAnchors`) and the paper's marks (`rangeOf`,
 * in `note-tags.tsx`) both make. `text` still holds the words the anchor was taken on when the range is in it, is not empty,
 * has whole formulas at both ends, and the words at `[start, end)` begin with the quote. Returns the range a mark covers — it
 * ends at its last word, the white space a selection ran on over left out — or null when the text does not hold the words.
 */
export function anchorRange(text: string, spot: { start: number; end: number; quote: string }): { start: number; end: number } | null {
  const { start, end, quote } = spot;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || start >= end || end > text.length) return null;
  const inside = (at: number) => {
    if (at <= 0) return false;
    const open = text.lastIndexOf(MATH_OPEN, at - 1);
    return open > text.lastIndexOf(MATH_CLOSE, at - 1) && text.indexOf(MATH_CLOSE, at) >= 0;
  };
  if (inside(start) || inside(end)) return null;
  const held = text.slice(start, end);
  if (!held.replace(/\s+/g, " ").trim().startsWith(quote)) return null;
  const last = start + held.trimEnd().length;
  return last > start ? { start, end: last } : null;
}

/** Whether `text` still holds the words a ranged anchor was taken on (`anchorRange` has a range for it). */
export function anchorHolds(text: string, spot: { start: number; end: number; quote: string }): boolean {
  return anchorRange(text, spot) !== null;
}

/** One anchor's repair: where it stood (`was`, to know it is still the stored one) and where its words stand now. */
export interface AnchorFix {
  /** The sticky's heading id. */
  id: string;
  was: { paragraphId: string; start: number; end: number };
  paragraphId: string;
  start: number;
  end: number;
}

const PARAGRAPH_ID = /^paper-section-(\d+)-p(\d+)$/;

/**
 * P10-35 (rules 1-3): the anchors a paper body can draw. An anchor whose paragraph holds its words at `[start, end)` is kept
 * as it is, with no search (it reads only its own paragraph). One whose paragraph does not — the paragraphs moved, because a
 * paragraph id is positional — looks for its quote: the same section's paragraphs, nearest to the old one first; else the
 * whole body, nearest section first. The words found once repair the anchor (`fixes`); found more than once, the occurrence
 * nearest the old position; not found, the anchor is `lost` and drawn nowhere. An anchor with no range (its passage crossed
 * paragraphs) has nothing to check and stays at its paragraph. Pure; the body is only read.
 */
export function resolveAnchors(
  body: readonly { readonly paragraphs: readonly string[] }[],
  anchors: NoteAnchorMap,
): { map: NoteAnchorMap; fixes: AnchorFix[]; lost: string[] } {
  const map: NoteAnchorMap = {};
  const fixes: AnchorFix[] = [];
  const lost: string[] = [];
  const put = (paragraphId: string, spot: NoteAnchorMap[string][number]) => (map[paragraphId] ??= []).push(spot);
  for (const [paragraphId, spots] of Object.entries(anchors)) {
    const at = PARAGRAPH_ID.exec(paragraphId);
    const [si, pj] = at ? [Number(at[1]), Number(at[2])] : [-1, -1];
    const text = at ? body[si]?.paragraphs[pj] : undefined;
    for (const spot of spots) {
      const { start, end, quote } = spot;
      if (start === undefined || end === undefined || quote === undefined) {
        put(paragraphId, spot);
        continue;
      }
      if (text !== undefined && anchorHolds(text, { start, end, quote })) {
        put(paragraphId, spot);
        continue;
      }
      const found = findQuote(body, quote, si, pj, start);
      if (!found) {
        lost.push(spot.id);
        continue;
      }
      const there = paragraphAnchorId(found.section, found.paragraph);
      put(there, { ...spot, start: found.start, end: found.end });
      fixes.push({ id: spot.id, was: { paragraphId, start, end }, paragraphId: there, start: found.start, end: found.end });
    }
  }
  return { map, fixes, lost };
}

function paragraphAnchorId(section: number, paragraph: number): string {
  return `paper-section-${section}-p${paragraph}`;
}

/** Whether rank `a` is nearer than `b`: compared in order, the first difference decides. */
function nearer(a: readonly number[], b: readonly number[]): boolean {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k];
  return false;
}

/** Where the quote stands in the body, nearest to `(si, pj)` / `start`: the anchor's own section first, then the whole body. */
function findQuote(
  body: readonly { readonly paragraphs: readonly string[] }[],
  quote: string,
  si: number,
  pj: number,
  start: number,
): { section: number; paragraph: number; start: number; end: number } | null {
  type Hit = { section: number; paragraph: number; start: number; end: number; rank: number[] };
  /** The nearest occurrence in one section: the nearest paragraph to the old one, then the nearest offset. */
  const within = (section: number): Hit | null => {
    let best: Hit | null = null;
    const paragraphs = body[section]?.paragraphs ?? [];
    for (let j = 0; j < paragraphs.length; j++) {
      for (let place = locatePassage(paragraphs[j], quote); place; place = locatePassage(paragraphs[j], quote, place.start + 1)) {
        if (!anchorHolds(paragraphs[j], { ...place, quote })) continue;
        const rank = [Math.abs(section - si), Math.abs(j - pj), Math.abs(place.start - start)];
        if (!best || nearer(rank, best.rank)) best = { section, paragraph: j, ...place, rank };
      }
    }
    return best;
  };
  const own = si >= 0 ? within(si) : null;
  if (own) return own;
  let best: Hit | null = null;
  for (let section = 0; section < body.length; section++) {
    if (section === si) continue;
    const hit = within(section);
    if (hit && (!best || nearer(hit.rank, best.rank))) best = hit;
  }
  return best;
}

/** Where `next` differs from `base`: the span of `base` it replaces (`start`..`end`) and the words it puts there. */
function changeOf(base: string, next: string): { start: number; end: number; text: string } {
  const room = Math.min(base.length, next.length);
  let start = 0;
  while (start < room && base[start] === next[start]) start++;
  // A pair of surrogates is one character: never cut between its halves.
  if (start > 0 && /[\uD800-\uDBFF]/.test(base[start - 1])) start--;
  let tail = 0;
  while (tail < room - start && base[base.length - 1 - tail] === next[next.length - 1 - tail]) tail++;
  if (tail > 0 && /[\uDC00-\uDFFF]/.test(base[base.length - tail])) tail--;
  return { start, end: base.length - tail, text: next.slice(start, next.length - tail) };
}

/**
 * P10-29 (BACKLOG-71): two writers' texts for one block, grown from the same `base`, in one. Each side's change is the span
 * of the words it touched; when the two spans are apart both stay, when both only added words at the one place both stay (the
 * stored `theirs` first, a space between when the words would run together), and where both changed the same words the later
 * one stands: `mine`, the write being made now, unless `later` says `theirs`. The same text both arrived at is kept once. Pure.
 */
export function mergeText(base: string, mine: string, theirs: string, later: "mine" | "theirs" = "mine"): string {
  if (mine === theirs || theirs === base) return mine;
  if (mine === base) return theirs;
  const m = changeOf(base, mine);
  const t = changeOf(base, theirs);
  if (m.start === m.end && t.start === t.end && m.start === t.start) {
    const join = /\S$/.test(t.text) && /^\S/.test(m.text) ? " " : "";
    return base.slice(0, m.start) + t.text + join + m.text + base.slice(m.start);
  }
  if (t.end < m.start) return base.slice(0, t.start) + t.text + base.slice(t.end, m.start) + m.text + base.slice(m.end);
  if (m.end < t.start) return base.slice(0, m.start) + m.text + base.slice(m.end, t.start) + t.text + base.slice(t.end);
  return later === "mine" ? mine : theirs;
}

/** `mergeText` block by block: a sticky's paragraphs are blocks, so when the three keep the same paragraphs each is merged
 *  on its own — a block both rewrote is `mine` only for that block. Else the whole text is merged as one. */
function mergeParagraphs(base: string, mine: string, theirs: string): string {
  const b = base.split("\n");
  const m = mine.split("\n");
  const t = theirs.split("\n");
  if (b.length === m.length && b.length === t.length) return b.map((line, i) => mergeText(line, m[i], t[i])).join("\n");
  return mergeText(base, mine, theirs);
}

/**
 * P10-09c (rule 4): the blocks without the sticky's heading and its text blocks when all of those are empty — a sticky
 * opened and never written in leaves nothing behind. The same array when it has words, or is not there. The note's
 * `stickyCount` is not touched (the number is not reused).
 */
export function withoutSticky(blocks: readonly Block[], headerId: string): readonly Block[] {
  const span = stickySpan(blocks, headerId);
  if (!span) return blocks;
  if (blocks.slice(span.start + 1, span.end).some((b) => b.text.trim() !== "")) return blocks;
  return [...blocks.slice(0, span.start), ...blocks.slice(span.end)];
}

/**
 * P10-29 (BACKLOG-71): the headings of the empty stickies taken out in this tab. An editor holding an older copy of the
 * note (the notes window's flush as the page is left) saves it after the removal; the copy still has the empty sticky, which
 * is taken out of it again (never one that has words by then). Not kept across a reload: a reload shows the note as stored.
 */
const removedEmpty = new Set<string>();

interface NotesState {
  notes: Record<string, Note>;
  add: (note: Note) => void;
  /** Write the editor's state back. Stamps `updatedAt`. */
  save: (id: string, patch: Partial<Pick<Note, "title" | "blocks" | "sources">>, at?: string) => void;
  remove: (id: string) => void;
  /** P10-09a: the paper's own note — made from its template the first time, without navigating — and its id.
   *  Both "Take notes" paths (a sticky, the notes window) call it. */
  ensureReadingNote: (paper: Citable, extras?: ReadingNoteExtras) => string;
  /** P10-09a (ruling §1h.78 (f)): append sticky `stickyCount + 1` to the note: an `h3` "Note N" carrying the
   *  anchor, and an empty text block. Null for a note that is not there. */
  addSticky: (
    noteId: string,
    at: {
      paperId: string;
      paragraphId: string;
      passage: string;
      /** P10-09f: the paragraph's text as the body renders it; the anchor then records where the passage stands in it. */
      paragraphText?: string;
    },
  ) => { id: string; n: number } | null;
  /** P10-09a: write a sticky's text through into its own blocks (one per paragraph); nothing else changes.
   *  P10-29: `base` is the text the writer last saw stored. When the stored text is no longer that — the notes window wrote
   *  into the same blocks meanwhile — the two are merged block by block (`mergeText`) rather than the writer's text
   *  replacing the other's words. */
  setStickyText: (noteId: string, headerId: string, text: string, base?: string) => void;
  /** P10-09c / P10-29: take a sticky out of the note when it holds no words — its heading and anchor with it, so the paper has
   *  no tag for a note that says nothing. A sticky with words stays. The number is not freed (`stickyCount` stands). */
  removeEmptySticky: (noteId: string, headerId: string) => void;
}

/**
 * P10-35 (BACKLOG-91, rule 2): write repaired anchors back, once, so the next load needs no search. Each fix applies only to
 * the anchor it was worked out from (`was` is still what is stored: a sticky written or moved meanwhile is left alone). The
 * note's `updatedAt` is not touched — a repair is not the reader's edit. The same state when nothing changes.
 */
export function repairAnchors(fixes: readonly AnchorFix[]): void {
  if (fixes.length === 0) return;
  const byId = new Map(fixes.map((fix) => [fix.id, fix]));
  useNotesStore.setState((s) => {
    let changed = false;
    const notes: Record<string, Note> = {};
    for (const [key, note] of Object.entries(s.notes)) {
      let touched = false;
      const blocks = note.blocks.map((b) => {
        const fix = b.type === "h3" && b.anchor ? byId.get(b.id) : undefined;
        if (!fix || !b.anchor) return b;
        const { paragraphId, start, end } = b.anchor;
        if (paragraphId !== fix.was.paragraphId || start !== fix.was.start || end !== fix.was.end) return b;
        if (paragraphId === fix.paragraphId && start === fix.start && end === fix.end) return b;
        touched = true;
        return { ...b, anchor: { ...b.anchor, paragraphId: fix.paragraphId, start: fix.start, end: fix.end } };
      });
      notes[key] = touched ? { ...note, blocks } : note;
      changed ||= touched;
    }
    return changed ? { notes } : s;
  });
}

/**
 * P10-35 (rule 2): the stickies whose passage the paper on show does not hold, by heading id. Not stored (it is what the body
 * found this time, and a different version of the paper may hold the words), not per-user data: the sticky window reads it to
 * say so in one quiet line.
 */
export const useLostPassages = create<{ lost: Record<string, true>; setLost: (ids: readonly string[]) => void }>()((set, get) => ({
  lost: {},
  setLost: (ids) => {
    const now = get().lost;
    const same = ids.length === Object.keys(now).length && ids.every((id) => now[id]);
    if (!same) set({ lost: Object.fromEntries(ids.map((id) => [id, true as const])) });
  },
}));

export const useNotesStore = create<NotesState>()(
  persist(
    (set, get) => ({
      notes: {},
      add: (note) => set((s) => ({ notes: { ...s.notes, [note.id]: note } })),
      save: (id, patch, at = new Date().toISOString()) =>
        set((s) => {
          const note = s.notes[id];
          if (!note) return s;
          if (patch.blocks && removedEmpty.size > 0) {
            let blocks: readonly Block[] = patch.blocks;
            for (const headerId of removedEmpty) blocks = withoutSticky(blocks, headerId);
            if (blocks !== patch.blocks) patch = { ...patch, blocks: [...blocks] };
          }
          return { notes: { ...s.notes, [id]: { ...note, ...patch, updatedAt: at } } };
        }),
      remove: (id) =>
        set((s) => {
          if (!s.notes[id]) return s;
          const notes = { ...s.notes };
          delete notes[id];
          return { notes };
        }),
      ensureReadingNote: (paper, extras) => {
        const own = readingNoteFor(get().notes, paper.id);
        if (own) return own.id;
        const note = readingNote(paper, extras);
        set((s) => ({ notes: { ...s.notes, [note.id]: note } }));
        return note.id;
      },
      addSticky: (noteId, at) => {
        const note = get().notes[noteId];
        if (!note) return null;
        const used = note.blocks.reduce((most, b) => Math.max(most, b.anchor?.n ?? 0), 0);
        const n = Math.max(note.stickyCount ?? 0, used) + 1;
        // P10-24: the passage is the paragraph's words — never a tag's text — for the quote and for the range alike.
        const passage = stripTagText(at.passage);
        const place = at.paragraphText === undefined ? null : locatePassage(at.paragraphText, passage);
        const { header, blocks } = stickyBlocks({ paperId: at.paperId, paragraphId: at.paragraphId, quote: stickyQuote(passage), n, ...(place ?? {}) });
        set((s) => {
          const current = s.notes[noteId];
          if (!current) return s;
          const updatedAt = new Date().toISOString();
          return { notes: { ...s.notes, [noteId]: { ...current, blocks: [...current.blocks, ...blocks], stickyCount: n, updatedAt } } };
        });
        return { id: header.id, n };
      },
      setStickyText: (noteId, headerId, text, base) =>
        set((s) => {
          const note = s.notes[noteId];
          if (!note) return s;
          let write = text;
          if (base !== undefined) {
            const stored = stickyText(note.blocks, headerId);
            const mine = stickyParagraphs(text).join("\n");
            const seen = stickyParagraphs(base).join("\n");
            if (stored !== seen && stored !== mine) write = mergeParagraphs(seen, mine, stored);
          }
          const blocks = withStickyText(note.blocks, headerId, write);
          if (blocks.length === note.blocks.length && blocks.every((b, i) => b === note.blocks[i])) return s;
          return { notes: { ...s.notes, [noteId]: { ...note, blocks, updatedAt: new Date().toISOString() } } };
        }),
      removeEmptySticky: (noteId, headerId) =>
        set((s) => {
          const note = s.notes[noteId];
          if (!note) return s;
          const blocks = withoutSticky(note.blocks, headerId);
          if (blocks === note.blocks) return s;
          removedEmpty.add(headerId);
          return { notes: { ...s.notes, [noteId]: { ...note, blocks: [...blocks], updatedAt: new Date().toISOString() } } };
        }),
    }),
    {
      name: "peer-notes",
      version: 1,
      skipHydration: true,
      partialize: (s) => ({ notes: s.notes }),
    },
  ),
);

export function useNotesHydrated(): boolean {
  return useSyncExternalStore(
    (onChange) => useNotesStore.persist.onFinishHydration(onChange),
    () => useNotesStore.persist.hasHydrated(),
    () => false,
  );
}

export function newestFirst(notes: Record<string, Note>): Note[] {
  return Object.values(notes).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** The notes that cite this paper — its backlinks. */
export function notesCiting(notes: Record<string, Note>, paperId: string): Note[] {
  return newestFirst(notes).filter((note) =>
    citedKeys(note).some((key) => note.sources[key]?.paperId === paperId),
  );
}

/** The paper's own reading notes, if it has been given some. */
export function readingNoteFor(notes: Record<string, Note>, paperId: string): Note | undefined {
  return newestFirst(notes).find((note) => note.paperId === paperId);
}
