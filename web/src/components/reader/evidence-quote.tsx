"use client";

// The receipt under a model claim: the paper's sentence, verbatim, with
// where it came from. Italic and a step smaller than the claim, indented,
// no rule, no box, no quote glyph — the attribution is the mark.
//
// P1-04 (§1f.12): "§Heading" is a link to that section of the paper on this
// page — the first body section with the same heading — and plain text when
// none has it (the abstract, a heading the body does not carry, or a page
// that renders no body). The page provides the body's headings through
// `SectionLinks`, so the lists that render quotes need no new prop.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { MAP, attribution } from "./copy";
import { sectionAnchor } from "./paper-body";

interface SectionLinkContext {
  headings: readonly string[];
  reveal?: (run: () => void) => void;
}

const SectionHeadings = createContext<SectionLinkContext | null>(null);

/**
 * `reveal` (P7-14, R10): on a full-text paper the body is under "Paper digestion" and not mounted
 * under "Summary", where most of these links are; the page hands in its way to switch tabs and
 * run a jump once the body is on the page (`useReaderTab`'s `reveal`). Without it a link is the
 * browser's own anchor, as it was.
 */
export function SectionLinks({
  headings,
  reveal,
  children,
}: {
  headings: readonly string[];
  reveal?: (run: () => void) => void;
  children?: ReactNode;
}) {
  const value = useMemo(() => ({ headings, reveal }), [headings, reveal]);
  return <SectionHeadings.Provider value={value}>{children}</SectionHeadings.Provider>;
}

/** What the settle needs of the heading it watches. */
export interface SettleTarget {
  getBoundingClientRect: () => { top: number };
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
}

/** The settle's clock, frames and the reader's own input — in the test's hands, the browser's on the page. */
export interface SettleEnv {
  now: () => number;
  /** Runs `run` on the next frame; returns the way to cancel it. */
  frame: (run: () => void) => () => void;
  /** Calls `stop` on the reader's own scroll input (wheel, touch, key, press); returns the way to unsubscribe. */
  onUser: (stop: () => void) => () => void;
  /** Calls `run` whenever a picture anywhere on the page has arrived (or failed to); returns the way to unsubscribe. */
  onArrive: (run: () => void) => () => void;
}

/** Frames the heading's top must hold still before the page counts as at rest. */
const REST_FRAMES = 3;
/** A jump that has not begun moving in this long (ms) is taken as one that has nowhere to go. */
const SETTLE_GRACE = 120;
/** How long (ms) after the page first comes to rest the settle keeps watching for the layout to grow. */
const SETTLE_CAP = 1000;
/** The longest a smooth scroll is waited for (ms). */
const SETTLE_TRAVEL_CAP = 5000;
/** After the watching by frames is over: how long (ms) from the page's rest a figure that arrives late still lands the heading again. */
const SETTLE_LATE_CAP = 10000;
const SAME = 0.5;

function browserSettleEnv(): SettleEnv | null {
  if (typeof window === "undefined" || typeof requestAnimationFrame !== "function") return null;
  return {
    now: () => performance.now(),
    frame: (run) => {
      const handle = requestAnimationFrame(run);
      return () => cancelAnimationFrame(handle);
    },
    onUser: (stop) => {
      const kinds = ["wheel", "touchstart", "keydown", "pointerdown"] as const;
      for (const kind of kinds) window.addEventListener(kind, stop, { passive: true, capture: true });
      return () => {
        for (const kind of kinds) window.removeEventListener(kind, stop, { capture: true });
      };
    },
    // `load` and `error` do not bubble; the capture phase on the document sees every picture's.
    onArrive: (run) => {
      document.addEventListener("load", run, true);
      document.addEventListener("error", run, true);
      return () => {
        document.removeEventListener("load", run, true);
        document.removeEventListener("error", run, true);
      };
    },
  };
}

let settling: (() => void) | null = null;

/**
 * P10-19 (X-A7, BACKLOG-78): the landing of a jump to a section. The browser's hash jump aims at where the heading
 * stood when it was pressed; the paper's lazy figures above it then load while the page scrolls past them, and the
 * heading ends thousands of pixels from where the page stopped. So after the jump the page watches the heading:
 * once its top has held still for three frames (the jump is over) it scrolls to the heading again — instantly,
 * `block: "start"`, so the heading's own `scroll-mt` places it — and goes on watching, scrolling again whenever the
 * layout moved it and came to rest, until a second after the page first came to rest. A figure that arrives later
 * than that (a slow host) still lands the heading again, up to ten seconds from the rest. The reader's own scroll,
 * touch, key or press ends it at once; a second press replaces the first. Nothing happens in a page that is not a
 * browser's. Returns the way to end it.
 */
export function settleOnSection(find: () => SettleTarget | null, env: SettleEnv | null = browserSettleEnv()): () => void {
  settling?.();
  settling = null;
  if (!env) return () => {};
  const start = env.now();
  let cancelFrame: (() => void) | null = null;
  let unwatch: (() => void) | null = null;
  let unarrive: (() => void) | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let held = 0;
  let travelled = false;
  let restAt: number | null = null;
  let watchUntil = 0;
  let landedTop: number | null = null;
  let justScrolled = false;
  const end = () => {
    cancelFrame?.();
    cancelFrame = null;
    unwatch?.();
    unwatch = null;
    unarrive?.();
    unarrive = null;
    if (settling === end) settling = null;
  };
  // The watching by frames is over; a picture that arrives later starts it again (the arrival's own height reaches
  // the layout a frame or two after its `load`, so the heading is looked at again by frames, not at the event).
  const endFrames = () => {
    cancelFrame = null;
    if (restAt === null) return end();
    unarrive ??= env.onArrive(() => {
      if (!find() || env.now() - (restAt as number) >= SETTLE_LATE_CAP) return end();
      watchUntil = env.now() + SETTLE_CAP;
      held = 0;
      last = null;
      cancelFrame ??= env.frame(tick);
    });
  };
  const tick = () => {
    cancelFrame = null;
    const target = find();
    if (!target || typeof target.getBoundingClientRect !== "function") return end();
    const now = env.now();
    const top = target.getBoundingClientRect().top;
    if (justScrolled) {
      // The frame after the page's own scroll: wherever the heading is now is where it lands.
      justScrolled = false;
      landedTop = top;
      last = top;
      held = 0;
    } else {
      if (first === null) first = top;
      if (Math.abs(top - first) > SAME) travelled = true;
      held = last !== null && Math.abs(top - last) <= SAME ? held + 1 : 0;
      last = top;
    }
    if (restAt === null ? now - start >= SETTLE_TRAVEL_CAP : now >= watchUntil) return restAt === null ? end() : endFrames();
    if (held >= REST_FRAMES - 1 && (travelled || now - start >= SETTLE_GRACE)) {
      if (restAt === null) {
        restAt = now;
        watchUntil = now + SETTLE_CAP;
      }
      if (landedTop === null || Math.abs(top - landedTop) > SAME) {
        target.scrollIntoView({ block: "start", behavior: "instant" as ScrollBehavior });
        justScrolled = true;
      }
    }
    cancelFrame = env.frame(tick);
  };
  unwatch = env.onUser(end);
  cancelFrame = env.frame(tick);
  settling = end;
  return end;
}

/**
 * The click on a "§Heading" link. With the section on the page it is left to the browser's anchor
 * jump. With it not on the page — the body is under the other tab — the dead anchor is stopped, and
 * the page's `reveal` brings the body in and then scrolls to the section. Either way the landing is
 * settled once the jump is under way (P10-19): see `settleOnSection`.
 */
export function followSectionLink(
  event: { preventDefault: () => void },
  id: string,
  reveal: ((run: () => void) => void) | undefined,
  find: (id: string) => { scrollIntoView: (options?: ScrollIntoViewOptions) => void } | null = (target) =>
    document.getElementById(target),
  settle: (find: () => SettleTarget | null) => void = (watch) => void settleOnSection(watch),
): void {
  if (find(id)) {
    settle(() => find(id) as SettleTarget | null);
    return;
  }
  if (!reveal) return;
  event.preventDefault();
  reveal(() => {
    find(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
    settle(() => find(id) as SettleTarget | null);
  });
}

/** The anchor of the first body section headed `where`, or null. */
export function sectionHref(where: string, headings: readonly string[]): string | null {
  const wanted = where.trim();
  if (!wanted || wanted === "abstract") return null;
  const index = headings.findIndex((heading) => heading.trim() === wanted);
  return index >= 0 ? `#${sectionAnchor(index)}` : null;
}

/** An attribution's text, as a link to the section headed `where` when the
 *  page's body has one (P1-04), else as it was. P1-05 (the §1f.13
 *  amendment): the Tier 0 quotes and the skim's quoted evidence use it too. */
export function SectionAttribution({ where, children }: { where: string; children: ReactNode }) {
  const links = useContext(SectionHeadings);
  const href = links ? sectionHref(where, links.headings) : null;
  if (!links || !href) return <>{children}</>;
  return (
    <a
      href={href}
      onClick={(event) => followSectionLink(event, href.slice(1), links.reveal)}
      className="underline-offset-2 transition-colors hover:text-heading hover:underline"
    >
      {children}
    </a>
  );
}

/** `page` (P2-04b, §1g.15): where the sentence sits in a PDF, when it is known,
 *  as " · p.N" inside the attribution after the section link. `where` stays
 *  the bare heading, so `sectionHref` keeps matching it. Callers without a
 *  page are unchanged. */
export function EvidenceQuote({ text, where, page }: { text: string; where: string; page?: number }) {
  return (
    <p className="font-reading italic text-body leading-[1.55] text-text-muted pl-5 mt-1.5 reading-justify">
      {text}
      <span className="font-mono not-italic text-meta text-text-faint ml-2">
        — <SectionAttribution where={where}>{attribution(where)}</SectionAttribution>
        {typeof page === "number" && ` · ${MAP.page(page)}`}
      </span>
    </p>
  );
}
