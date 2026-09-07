"use client";

// The phone's shell: a 56px bar at the bottom, in thumb reach, plus the
// safe area. Four cells — Today, Search, Saved, You — each about 93×56px,
// a 22px stroke icon over an 11.5px sentence-case label. On a paper the same
// bar is the rail: ← Briefing · 3 of 10 · Next → — the move-on-without-
// judging the page had no room for, and the way back, both under the thumb.
//
// The row of 30px text tabs it replaces sat at the top of every page,
// including the reading page, under the 44px target the page enforces for
// its own buttons. Gestures stay in the content (the card and the plate are
// swiped); the bar never covers the decided-read observer's targets because
// the spacer below keeps the page's last line above it.

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { RAIL } from "@/components/reader/copy";
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
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={`flex flex-col items-center justify-center gap-1 h-14 text-caption transition-colors duration-150 ease-snap ${
              active ? "text-heading" : "text-text-faint"
            }`}
          >
            <TabIcon route={tab.route} active={active} />
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
  return (
    <div className="grid grid-cols-[1fr_auto_1fr] items-center h-14 px-3">
      <BackToFeedLink onBack={onBack} className={`${CELL_CLASS} justify-self-start text-text`}>
        {RAIL.back}
      </BackToFeedLink>
      {positioned && (
        <span className="text-body-sm text-text-muted tabular-nums">
          {RAIL.position(nav.index, nav.total)}
        </span>
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

// 22px, 1.6px strokes; 2px when active. Drawn once here — the phone bar is
// the only place Peer uses a glyph for a page.
function TabIcon({ route, active }: { route: ShellRoute; active: boolean }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: active ? 2 : 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  switch (route) {
    case "briefing":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
      );
    case "saved":
      return (
        <svg {...common}>
          <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
        </svg>
      );
  }
}
