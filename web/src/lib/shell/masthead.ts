// What the shell says on each route, as data.
//
// The masthead (desktop), the thumb bar (phone) and the keyboard layer all
// answer the same question — "which page is this, and what does the shell
// state here?" — and they used to answer it three different ways (nav.tsx's
// isActive, the rail's own position, keyboard.tsx's pathname checks). One
// mapping here, with no DOM in it, so the three cannot drift and the mapping
// can be tested without rendering.
//
// The shell states only what the store knows. Before the day's fetch lands
// `papers` is empty — it is not persisted (store/feed.ts partialize) — so the
// centre reads the date alone rather than "0 papers"; a count appears only
// once there are papers to count.

import { NONE } from "@/lib/navigation/card-focus";
import { paperNav, type PaperNav } from "@/lib/reader/paper-nav";

export type ShellRoute =
  | "welcome"
  | "briefing"
  | "paper"
  | "search"
  | "saved"
  | "profile"
  | "other";

function under(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function shellRoute(pathname: string | null | undefined): ShellRoute {
  if (!pathname) return "other";
  if (pathname === "/") return "briefing";
  if (under(pathname, "/welcome")) return "welcome";
  if (pathname.startsWith("/papers/")) return "paper";
  if (under(pathname, "/search")) return "search";
  if (under(pathname, "/saved")) return "saved";
  if (under(pathname, "/profile")) return "profile";
  return "other";
}

/** `/papers/openalex%3AW1` → `openalex:W1`, as the page itself decodes it. */
export function paperIdFromPathname(pathname: string | null | undefined): string | null {
  if (!pathname || !pathname.startsWith("/papers/")) return null;
  const raw = pathname.slice("/papers/".length).split("/")[0];
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

// ── The right cell ──

export interface ShellLink {
  href: string;
  label: string;
  route: ShellRoute;
}

/** Search · Saved · Profile — weekly, weekly, rare; the daily surface is the wordmark. */
export const SHELL_LINKS: readonly ShellLink[] = [
  { href: "/search", label: "Search", route: "search" },
  { href: "/saved", label: "Saved", route: "saved" },
  { href: "/profile", label: "Profile", route: "profile" },
];

/** The phone's four cells. "You", not "Profile": it is where sign-in lives too. */
export const THUMB_TABS: readonly ShellLink[] = [
  { href: "/", label: "Today", route: "briefing" },
  { href: "/search", label: "Search", route: "search" },
  { href: "/saved", label: "Saved", route: "saved" },
  { href: "/profile", label: "You", route: "profile" },
];

export function isActiveLink(link: ShellLink, route: ShellRoute): boolean {
  return link.route === route;
}

// ── The centre cell ──

/** "Sunday, September 7". A fixed locale: the server and the client must agree. */
export function dayLine(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export interface DayState {
  date: string;
  /** Null until the briefing has landed — never "0 papers" on a reload. */
  total: number | null;
  unread: number | null;
}

export function unreadCount(
  papers: readonly { id: string }[],
  readItems: Readonly<Record<string, true>>,
): number {
  return papers.filter((p) => !readItems[p.id]).length;
}

export function dayState(
  date: Date,
  papers: readonly { id: string }[],
  readItems: Readonly<Record<string, true>>,
): DayState {
  if (papers.length === 0) return { date: dayLine(date), total: null, unread: null };
  return {
    date: dayLine(date),
    total: papers.length,
    unread: unreadCount(papers, readItems),
  };
}

export type MastheadCentre =
  | { kind: "day"; day: DayState }
  | { kind: "rail"; nav: PaperNav }
  | { kind: "empty" };

export function mastheadCentre(
  route: ShellRoute,
  input: {
    date: Date;
    pathname: string | null | undefined;
    papers: readonly { id: string }[];
    readItems: Readonly<Record<string, true>>;
  },
): MastheadCentre {
  if (route === "briefing") {
    return { kind: "day", day: dayState(input.date, input.papers, input.readItems) };
  }
  if (route === "paper") {
    const id = paperIdFromPathname(input.pathname) ?? "";
    return {
      kind: "rail",
      nav: paperNav(
        input.papers.map((p) => p.id),
        id,
      ),
    };
  }
  return { kind: "empty" };
}

/** A deep link has no position and nothing to step to; the rail is the way back alone. */
export function railHasPosition(nav: PaperNav): boolean {
  return nav.index !== NONE;
}

// ── The thumb bar ──

export type ThumbBarMode = "tabs" | "rail" | "none";

export function thumbBarMode(route: ShellRoute): ThumbBarMode {
  if (route === "welcome") return "none";
  if (route === "paper") return "rail";
  return "tabs";
}

// ── The `/` key ──

export type SearchKeyTarget = { action: "focus" } | { action: "push"; href: "/search" };

/**
 * `/` is honest now: from any route it goes to Search; on Search it focuses
 * the box. The old handler only looked for `#peer-search`, which exists on
 * one route, so from the briefing the key did nothing while the help sheet
 * said "Anywhere".
 */
export function searchKeyTarget(
  pathname: string | null | undefined,
  hasSearchInput: boolean,
): SearchKeyTarget {
  if (shellRoute(pathname) === "search" && hasSearchInput) return { action: "focus" };
  return { action: "push", href: "/search" };
}
