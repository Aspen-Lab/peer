"use client";

// The phone's shell: a 56px bar at the bottom, in thumb reach, plus the
// safe area. Four cells — Today, Search, Saved, You — each about 93×56px,
// a 22px stroke icon over an 11.5px sentence-case label. On a paper the same
// bar is the rail: ← Briefing · 3 of 10 · Next → — the move-on-without-
// judging the page had no room for, and the way back, both under the thumb.
//
// P9-41 (ruling §1h.66): while a settled selection in the paper's body has an
// "Explain this?" control on offer (the explain box says so through
// `explain-offer.ts`), the rail's centre cell gives its place to that control —
// a 44px target in thumb reach that covers none of the paper's words (a pill
// above the bar covered 1,790–2,473 px² of them) — and "3 of 10" waits; ←
// Briefing and Next → keep their columns. The cell goes with the selection.
//
// The row of 30px text tabs it replaces sat at the top of every page,
// including the reading page, under the 44px target the page enforces for
// its own buttons. Gestures stay in the content (the card and the plate are
// swiped); the bar never covers the decided-read observer's targets because
// the spacer below keeps the page's last line above it.

import Link from "next/link";
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { RouteGlyph } from "@/components/shell/icons";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { EXPLAIN, RAIL } from "@/components/reader/copy";
import { useExplainOffer } from "@/lib/reader/explain-offer";
import { paperNav } from "@/lib/reader/paper-nav";
import { readerActions } from "@/lib/reader/reader-keys";
import {
  THUMB_TABS,
  isActiveLink,
  paperIdFromPathname,
  railHasPosition,
  shellRoute,
  thumbBarMode,
  type ShellRoute,
} from "@/lib/shell/masthead";

/** The cells' height in px; the safe area sits under them. */
export const THUMB_BAR_PX = 56;
/** The bar's whole height as CSS, for the in-flow spacer. */
export const THUMB_BAR_HEIGHT = `calc(${THUMB_BAR_PX}px + env(safe-area-inset-bottom))`;
/** Where the bar exists — Tailwind's `md:hidden`, as a query the page can ask. */
export const THUMB_BAR_QUERY = "(max-width: 767px)";

const CELL_CLASS = "h-14 inline-flex items-center px-2 text-body";

export function ThumbBar() {
  const pathname = usePathname();
  const route = shellRoute(pathname);
  const mode = thumbBarMode(route);
  const savedCount = useFeedStore((s) => s.savedPapers.length);
  const papers = useFeedStore((s) => s.papers);
  const router = useRouter();

  if (mode === "none") return null;

  return (
    <>
      {/* In flow, after <main>: the page's bottom padding, exactly the bar.
          Lives here, not on main, so /welcome — which returns above — gets
          no gap. */}
      <div className="md:hidden shrink-0" style={{ height: THUMB_BAR_HEIGHT }} aria-hidden />

      <nav
        aria-label={mode === "rail" ? "Briefing position" : "Peer"}
        className="md:hidden fixed inset-x-0 bottom-0 z-50 glass-bar shadow-[0_-1px_0_var(--color-border)] pb-[env(safe-area-inset-bottom)]"
      >
        {mode === "tabs" ? (
          <Tabs route={route} savedCount={savedCount} />
        ) : (
          <Rail
            ids={papers.map((p) => p.id)}
            id={paperIdFromPathname(pathname) ?? ""}
            onBack={() => router.back()}
          />
        )}
      </nav>
    </>
  );
}

function Tabs({ route, savedCount }: { route: ShellRoute; savedCount: number }) {
  return (
    <div className="grid grid-cols-4 h-14 px-2">
      {THUMB_TABS.map((tab) => {
        const active = isActiveLink(tab, route);
        return (
          <Link
            key={tab.href}
            href={tab.href as Route}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 h-14 text-caption transition-colors  ${
              active ? "text-heading" : "text-text-faint"
            }`}
          >
            <RouteGlyph route={tab.route} strokeWidth={active ? 2 : 1.6} />
            <span>
              {tab.label}
              {tab.route === "saved" && savedCount > 0 && (
                <span className="ml-1 font-mono tabular-nums">{savedCount}</span>
              )}
            </span>
          </Link>
        );
      })}
    </div>
  );
}

function Rail({
  ids,
  id,
  onBack,
}: {
  ids: string[];
  id: string;
  onBack: () => void;
}) {
  const nav = paperNav(ids, id);
  const positioned = railHasPosition(nav);
  const explaining = useExplainOffer();
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center h-14 px-3">
      <BackToFeedLink onBack={onBack} className={`${CELL_CLASS} justify-self-start text-text`}>
        {RAIL.back}
      </BackToFeedLink>
      {explaining ? (
        <ExplainCell />
      ) : (
        positioned && (
          <span className="text-body-sm text-text-muted tabular-nums">
            {RAIL.position(nav.index, nav.total)}
          </span>
        )
      )}
      {positioned && (
        // Dimmed, not gone, at the last paper: the Next row in the content
        // says what remains; the bar keeps its shape.
        <button
          type="button"
          onClick={() => readerActions()?.next?.()}
          disabled={!nav.nextId}
          className={`${CELL_CLASS} col-start-3 justify-self-end text-text disabled:text-text-faint`}
        >
          Next →
        </button>
      )}
    </div>
  );
}

/**
 * P9-41 (ruling §1h.66): the "Explain this?" control as the rail's centre cell, while a settled selection has one on offer. The pill's
 * words (its accessible name) and the pill's action — the page's own `explain`, what the `e` key calls: the explain window opens for
 * the selection and the box, which then has nothing on offer, takes the cell away. 44px tall (`min-h-11`, bare: the bar is a touch
 * surface by its place), in the 56px rail's middle, where "3 of 10" stood. The mouse-down is cancelled so the press does not take the
 * selection with it — the selection is what is explained.
 */
export function ExplainCell() {
  return (
    <button
      type="button"
      data-explain-ask=""
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => readerActions()?.explain?.()}
      className="col-start-2 justify-self-center inline-flex min-h-11 items-center rounded-full border border-border-strong bg-surface px-4 font-mono text-caption text-heading transition-colors hover:bg-surface-hover"
    >
      {EXPLAIN.ask}
    </button>
  );
}
