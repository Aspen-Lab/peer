// P11-06 (the owner's item 3, 2026-10-19): after "Open your notes" on a paper, the notes page's top-left button
// reads "Back to paper" and goes straight back to the paper — on the tab the reader was on (Summary or Paper
// digestion), at the place they left — instead of to the Saved library.
//
// Two halves, one record between them:
//
//   The press (`paper-notes.tsx`) calls `rememberPlace` just before it navigates to the notes page: the paper's id,
//   the note it opens, the tab on show, the scroll, the page's height, and the paragraph at the top of the view (the
//   fallback if the height has changed by the time the reader is back). It is kept in `sessionStorage` — this tab
//   only, never a server, never a shared store.
//
//   The notes page's button (`components/notes/back-link.tsx`) asks `backTarget` what to say: "Back to paper" when the
//   record names THIS note, "Saved" otherwise (from Saved, a deep link, a reload with no record). The page's one call
//   (`useRestoreReaderPlace`, in `Reader`) puts the tab and the place back once the reading has rendered, then clears
//   the record, so a later visit opens normally.
//
// Everything that decides something is a pure function over a document, a window, a storage or a clock handed in, so
// it runs in the Node-only test suite (no jsdom); only the thin browser defaults and the hook touch the real ones.

import { useEffect, useRef } from "react";
import { DOCK_TOP_PX } from "@/components/reader/explain-dock";
import type { ReaderTab } from "@/components/reader/use-reader-tab";

export type ReturnTab = ReaderTab;

/** The two tabs, as the strip's buttons are named (`reader-tabs.tsx`: `reader-tab-<name>`; the test holds the two together). */
const TABS: readonly ReturnTab[] = ["summary", "digestion"];
const TAB_ID_PREFIX = "reader-tab-";

/** The body's paragraphs, as `paper-body.tsx` anchors them: `paper-section-<k>-p<n>`. */
const PARAGRAPH = /^paper-section-\d+-p\d+$/;
const PARAGRAPHS = '[id^="paper-section-"][id*="-p"]';

/** A page this much taller or shorter than it was (about a line) is a page whose height changed. */
export const HEIGHT_SLACK_PX = 16;
/** How long the restore waits for the page to get its height back, or the paragraph to be on it, before it uses the recorded scroll. */
export const SETTLE_MS = 3000;

/**
 * How long, after it has landed, the restore keeps the place while the page settles. For a moment after the reading arrives the page is
 * still laying itself out: the left pane re-lays itself (with scroll anchoring on, the browser moves the scroll to keep some node of
 * it still: 47 px, measured, 200 ms after landing) and, in one column, content above the paragraph grows (56 px). So for this long the
 * browser's anchoring is off and a drift from the landing is put right at the next frame.
 */
export const HOLD_MS = 1500;

/** The one key, in this tab's `sessionStorage`. */
export const RETURN_KEY = "peer-return-to-paper";

/** Where the reader was on the paper when they pressed "Open your notes". */
export interface PlaceRecord {
  paperId: string;
  /** The note that press opened: the notes page says "Back to paper" only for this one. */
  noteId: string;
  tab: ReturnTab;
  scrollY: number;
  /** The page's height then: a different height now means the scroll no longer means the same words. */
  height: number;
  /** The paragraph at the top of the view (`paper-section-2-p3`), null where there is none on the screen (the Summary). */
  paragraphId: string | null;
  /** Its top in the window's pixels then. */
  paragraphTop: number;
}

/** The part of `document` the place is read from. */
export interface PlaceDoc {
  documentElement: { scrollHeight: number };
  getElementById(id: string): { getAttribute(name: string): string | null } | null;
  querySelectorAll(selector: string): ArrayLike<{ id: string; getBoundingClientRect(): { top: number; bottom: number } }>;
}

export type PlaceStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

// ── Reading the place ──

/** The tab on show: the strip's selected button; a paper with no body has no strip, and is the Summary. */
export function tabOnShow(doc: Pick<PlaceDoc, "getElementById">): ReturnTab {
  for (const name of TABS) if (doc.getElementById(`${TAB_ID_PREFIX}${name}`)?.getAttribute("aria-selected") === "true") return name;
  return "summary";
}

/** The first body paragraph that reaches below the masthead — the one at the top of the view (`windows.ts`'s `readingAnchorTop` reads it the same way). */
export function paragraphAtTop(doc: Pick<PlaceDoc, "querySelectorAll">, below: number = DOCK_TOP_PX + 8): { id: string; top: number } | null {
  for (const element of Array.from(doc.querySelectorAll(PARAGRAPHS))) {
    if (!PARAGRAPH.test(element.id)) continue;
    const box = element.getBoundingClientRect();
    if (box.bottom > below) return { id: element.id, top: box.top };
  }
  return null;
}

export function readPlace(win: { scrollY: number }, doc: PlaceDoc, ids: { paperId: string; noteId: string }): PlaceRecord {
  const top = paragraphAtTop(doc);
  return {
    paperId: ids.paperId,
    noteId: ids.noteId,
    tab: tabOnShow(doc),
    scrollY: Math.round(win.scrollY),
    height: Math.round(doc.documentElement.scrollHeight),
    paragraphId: top ? top.id : null,
    paragraphTop: top ? Math.round(top.top) : 0,
  };
}

// ── The record, in this tab's sessionStorage ──

/** This tab's storage, or null where there is none (a server render; a browser that blocks it). */
function tabStorage(): PlaceStorage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;
const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The record in `raw`, or null when it is not one (nothing stored, damaged, or of another shape). */
export function parseRecord(raw: string | null): PlaceRecord | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Record<keyof PlaceRecord, unknown>> | null;
    if (!v || typeof v !== "object") return null;
    const whole =
      isText(v.paperId) &&
      isText(v.noteId) &&
      (v.tab === "summary" || v.tab === "digestion") &&
      isNumber(v.scrollY) &&
      isNumber(v.height) &&
      (v.paragraphId === null || isText(v.paragraphId)) &&
      isNumber(v.paragraphTop);
    return whole ? (v as unknown as PlaceRecord) : null;
  } catch {
    return null;
  }
}

function readRaw(storage: PlaceStorage | null): string | null {
  try {
    return storage ? storage.getItem(RETURN_KEY) : null;
  } catch {
    return null;
  }
}

/** The stored record as text, for the notes page's button to read the way an external store is read. */
export function readRawReturn(): string | null {
  return readRaw(tabStorage());
}

/**
 * The press's half: record where the reader is on the paper, just before leaving it for the note `noteId`. False where nothing could be
 * kept (storage blocked): the press goes on, and the notes page's button stays "Saved".
 */
export function rememberPlace(
  ids: { paperId: string; noteId: string },
  env: { win: { scrollY: number }; doc: PlaceDoc; storage: PlaceStorage | null } | null = typeof window === "undefined" ? null : { win: window, doc: document, storage: tabStorage() },
): boolean {
  if (!env || !env.storage) return false;
  try {
    env.storage.setItem(RETURN_KEY, JSON.stringify(readPlace(env.win, env.doc, ids)));
    return true;
  } catch {
    return false;
  }
}

/** The record for `paperId`, left in place; another paper's record is none of this page's. */
export function peekPlace(paperId: string, storage: PlaceStorage | null = tabStorage()): PlaceRecord | null {
  const record = parseRecord(readRaw(storage));
  return record && record.paperId === paperId ? record : null;
}

export function dropPlace(storage: PlaceStorage | null = tabStorage()): void {
  try {
    storage?.removeItem(RETURN_KEY);
  } catch {
    // Nothing was kept that could be dropped.
  }
}

/** Drop the record only if it is the one that opened note `noteId`. */
export function dropPlaceFor(noteId: string, storage: PlaceStorage | null = tabStorage()): void {
  if (parseRecord(readRaw(storage))?.noteId === noteId) dropPlace(storage);
}

// ── The notes page's button ──

export interface BackTarget {
  label: "Back to paper" | "Saved";
  href: string;
  /** True when it goes back to the paper. */
  fromPaper: boolean;
}

/** What the notes page's top-left button says and where it goes: back to the paper when this note was opened from it, else Saved, as it always was. */
export function backTarget(noteId: string, raw: string | null): BackTarget {
  const record = parseRecord(raw);
  if (record && record.noteId === noteId) return { label: "Back to paper", href: `/papers/${encodeURIComponent(record.paperId)}`, fromPaper: true };
  return { label: "Saved", href: "/saved", fromPaper: false };
}

/**
 * The notes page's hold on the record. Leaving the page any way but its "Back to paper" (the global navigation, another note, the
 * browser's own Back) ends the visit, so the record is dropped — otherwise Saved's own entry to the same note, later, would find a
 * record from the paper and call itself "Back to paper". A reload never unmounts, so its record survives it. The drop is put off a
 * tick so a page that is unmounted and mounted again at once (React's development double run) keeps it.
 */
export function leaseReturn(drop: () => void, later: (run: () => void) => void = (run) => void setTimeout(run, 0)) {
  let alive = false;
  let leaving = false;
  return {
    mount() {
      alive = true;
    },
    unmount() {
      alive = false;
      later(() => {
        if (!alive && !leaving) drop();
      });
    },
    /** The "Back to paper" button was pressed: the paper's page takes the record from here. */
    leave() {
      leaving = true;
    },
  };
}

// ── Back on the paper ──

export type RestoreStep = { kind: "none" } | { kind: "wait" } | { kind: "select"; tab: ReturnTab } | { kind: "place" };

/**
 * What the paper's page does next about a record: nothing without one; wait for the reading to be on the page; switch to the recorded
 * tab if it is on the other (a paper with no body has no tabs, and is on its one page); else place the scroll.
 */
export function restoreStep(record: PlaceRecord | null, view: { ready: boolean; hasBody: boolean; tab: ReturnTab }): RestoreStep {
  if (!record) return { kind: "none" };
  if (!view.ready) return { kind: "wait" };
  if (view.hasBody && view.tab !== record.tab) return { kind: "select", tab: record.tab };
  return { kind: "place" };
}

export type Landing = { kind: "scroll"; top: number } | { kind: "paragraph"; by: number } | { kind: "wait" };

/**
 * Where the page lands: at the recorded scroll when it is as tall as it was; else on the recorded paragraph, back at the height it
 * stood (the page moves by the difference); else, with that paragraph not on the page, it waits.
 */
export function decideRestore(record: PlaceRecord, now: { height: number; paragraphTop: number | null }): Landing {
  if (Math.abs(now.height - record.height) <= HEIGHT_SLACK_PX) return { kind: "scroll", top: record.scrollY };
  if (record.paragraphId !== null && now.paragraphTop !== null) return { kind: "paragraph", by: now.paragraphTop - record.paragraphTop };
  return { kind: "wait" };
}

/** The page, the clock and the reader, as the restore sees them. */
export interface PlaceEnv {
  scrollHeight(): number;
  scrollY(): number;
  /** The top, in the window's pixels, of the paragraph with this id; null where it is not on the page. */
  paragraphTop(id: string): number | null;
  scrollTo(top: number): void;
  scrollBy(dy: number): void;
  /** Clear the record. */
  drop(): void;
  now(): number;
  /** Run `run` at the next frame; the result cancels it. */
  frame(run: () => void): () => void;
  /** Told when the reader scrolls or presses a key; the result stops listening. */
  onUserScroll(run: () => void): () => void;
  /** Switch the browser's scroll anchoring off; the result switches it back. */
  hold(): () => void;
}

/**
 * Put the page back once: after a frame (the reading is on the page, not in the render that put it there), at the recorded scroll or,
 * if the height changed, on the recorded paragraph; waiting up to `SETTLE_MS` for either to be possible, then the recorded scroll.
 * The record is cleared as it lands. For `HOLD_MS` after, the place is held while the page settles: scroll anchoring is off from the
 * start until then, and a drift from the landing is put right at the next frame. The reader scrolling or pressing a key first leaves
 * the page to them (and clears the record too). The result stops it all without clearing, for a page torn down before it landed.
 */
export function restorePlace(record: PlaceRecord, env: PlaceEnv): () => void {
  const started = env.now();
  let landedAt: number | null = null;
  let finished = false;
  let cleared = false;
  let stopFrame: () => void = () => {};
  const release = env.hold();
  const stopUser = env.onUserScroll(() => finish(true));

  function finish(clear: boolean) {
    if (finished) return;
    finished = true;
    stopFrame();
    stopUser();
    release();
    if (clear) clearOnce();
  }
  function clearOnce() {
    if (cleared) return;
    cleared = true;
    env.drop();
  }

  const attempt = () => {
    if (finished) return;
    const now = env.now();
    const landing = decideRestore(record, {
      height: env.scrollHeight(),
      paragraphTop: record.paragraphId === null ? null : env.paragraphTop(record.paragraphId),
    });
    if (landedAt === null) {
      if (landing.kind === "wait" && now - started < SETTLE_MS) {
        stopFrame = env.frame(attempt);
        return;
      }
      if (landing.kind === "scroll") env.scrollTo(landing.top);
      else if (landing.kind === "paragraph") env.scrollBy(landing.by);
      else env.scrollTo(record.scrollY);
      landedAt = now;
      clearOnce();
    } else {
      if (now - landedAt >= HOLD_MS) return finish(false);
      // Settling: put right only what has moved, so a place that holds is not touched.
      if (landing.kind === "scroll" && Math.abs(env.scrollY() - landing.top) >= 1) env.scrollTo(landing.top);
      else if (landing.kind === "paragraph" && Math.abs(landing.by) >= 1) env.scrollBy(landing.by);
    }
    stopFrame = env.frame(attempt);
  };
  stopFrame = env.frame(attempt);

  return () => finish(false);
}

const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "mousedown"] as const;

/** The real page, window and clock. Browser only. */
export function browserPlaceEnv(): PlaceEnv {
  return {
    scrollHeight: () => document.documentElement.scrollHeight,
    scrollY: () => window.scrollY,
    paragraphTop: (id) => document.getElementById(id)?.getBoundingClientRect().top ?? null,
    scrollTo: (top) => window.scrollTo({ top, behavior: "instant" }),
    scrollBy: (dy) => window.scrollBy({ top: dy, behavior: "instant" }),
    drop: () => dropPlace(),
    now: () => performance.now(),
    frame: (run) => {
      const id = requestAnimationFrame(run);
      return () => cancelAnimationFrame(id);
    },
    onUserScroll: (run) => {
      for (const type of USER_SCROLL_EVENTS) window.addEventListener(type, run, { passive: true });
      return () => {
        for (const type of USER_SCROLL_EVENTS) window.removeEventListener(type, run);
      };
    },
    hold: () => {
      const root = document.documentElement;
      const was = root.style.overflowAnchor;
      root.style.overflowAnchor = "none";
      return () => {
        root.style.overflowAnchor = was;
      };
    },
  };
}

/**
 * The paper's page's one call. A paper opened from the notes page's "Back to paper" has a record: once the reading is on the page
 * (`ready`), the tab is switched to the recorded one (`select`, the page's own tab switch) and the scroll is put back, once. A paper
 * with no record, or another paper's, is not touched.
 */
export function useRestoreReaderPlace({
  paperId,
  ready,
  hasBody,
  tab,
  select,
}: {
  paperId: string;
  /** The reading (not the abstract alone) is the one on the page. */
  ready: boolean;
  hasBody: boolean;
  tab: ReturnTab;
  select: (tab: ReturnTab) => void;
}): void {
  // The record is held for this page from the first look; it is cleared in storage only as it lands, so a page that mounts
  // and is replaced before the reading arrives leaves it for the one that stays.
  const held = useRef<{ paperId: string; record: PlaceRecord | null } | null>(null);
  // The restore under way, if any: it outlives the effect below (which runs again as the tab changes) but not the page.
  const running = useRef<(() => void) | null>(null);
  useEffect(() => {
    if (held.current?.paperId === paperId) return;
    running.current?.();
    running.current = null;
    held.current = { paperId, record: peekPlace(paperId) };
  }, [paperId]);

  useEffect(() => {
    const mine = held.current;
    if (!mine || running.current) return;
    const record = mine.record;
    const step = restoreStep(record, { ready, hasBody, tab });
    if (step.kind === "select") {
      select(step.tab);
      return;
    }
    if (step.kind !== "place" || !record) return;
    const env = browserPlaceEnv();
    running.current = restorePlace(record, {
      ...env,
      drop: () => {
        mine.record = null;
        env.drop();
      },
    });
  }, [paperId, ready, hasBody, tab, select]);

  useEffect(
    () => () => {
      running.current?.();
      running.current = null;
    },
    [],
  );
}
