// What the shell says on each route, as data.
//
// The masthead (desktop), the thumb bar (phone) and the keyboard layer all
// answer the same question — "which page is this, and what does the shell
// state here?" — and they used to answer it three different ways (nav.tsx's
// isActive, the rail's own position, keyboard.tsx's pathname checks). One
// mapping here, with no DOM in it, so the three cannot drift and the mapping
// can be tested without rendering.
//
// On the briefing the centre is empty: the page opens with the date as its
// headline and a one-sentence deck (app/page.tsx BriefingHead), so the day is
// stated once, at display size, not again in 13.5px above it. The masthead
// carries position only where the page cannot — on a paper.

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

/**
 * Main · Search · Saved · Profile — a desktop-mouse click back to the
 * briefing (8-01/S27): the phone's "Today" cell and the `g h` chord already
 * reach it, but nothing on the masthead itself did.
 */
export const SHELL_LINKS: readonly ShellLink[] = [
  { href: "/", label: "Main", route: "briefing" },
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

/** "Sunday, September 7" — the briefing's headline. A fixed locale: the server and the client must agree. */
export function dayLine(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export type MastheadCentre = { kind: "rail"; nav: PaperNav } | { kind: "empty" };

export function mastheadCentre(
  route: ShellRoute,
  input: {
    pathname: string | null | undefined;
    papers: readonly { id: string }[];
  },
): MastheadCentre {
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
 * `/` is honest: where the page has a search box it focuses it; anywhere
 * else it goes to Search, whose box focuses itself on arrival. The old
 * handler only looked for `#peer-search` and did nothing where there was
 * none, while the help sheet said "Anywhere" — the push is what fixed that.
 * The box now stands on two routes, Search and the briefing, and the rule
 * reads the page rather than naming them: a route that gains a box gains the
 * key with it.
 */
export function searchKeyTarget(
  pathname: string | null | undefined,
  hasSearchInput: boolean,
): SearchKeyTarget {
  const route = shellRoute(pathname);
  if (hasSearchInput && (route === "search" || route === "briefing")) {
    return { action: "focus" };
  }
  return { action: "push", href: "/search" };
}
