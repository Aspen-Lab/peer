"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { APP_VERSION } from "@/lib/version";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { useUIStore } from "@/store/ui";
import { formatTimeAgo } from "@/lib/format";
import { UserMenu } from "@/components/user-menu";

type Tab = {
  href: string;
  label: string;
  shortcut: string;
};

function IconFeed({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M2 4.5A1.5 1.5 0 0 1 3.5 3h17A1.5 1.5 0 0 1 22 4.5V19a2 2 0 0 1-2 2H5.5A3.5 3.5 0 0 1 2 17.5z" />
      <path d="M6 8h12M6 12h12M6 16h7" />
    </svg>
  );
}

function IconSaved({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill={active ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function IconSearch({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2.2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  );
}

function IconProfile({ active = false }: { active?: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={active ? 2 : 1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" />
    </svg>
  );
}

// Order encodes frequency. Feed is the daily read; Search is the weekly manual
// hunt; Saved is weekly; Events and Jobs are the once-a-year needs that used to
// sit on the home page as peers of the daily feed. Persona was a permanent slot
// above Profile for a 15-question quiz whose result nothing consumes — it is
// reachable from /profile now, not from the primary nav.
const tabs: Tab[] = [
  { href: "/", label: "Feed", shortcut: "g h" },
  { href: "/search", label: "Search", shortcut: "g /" },
  { href: "/saved", label: "Saved", shortcut: "g s" },
  { href: "/profile", label: "Profile", shortcut: "g p" },
];

// Feed is not in a group — it is the Today block at the top. The mobile bar
// still renders `tabs` flat.
const NAV_GROUPS: { key: string; label: string | null; items: Tab[] }[] = [
  {
    key: "reading",
    label: null,
    items: tabs.filter((t) => t.href === "/search" || t.href === "/saved"),
  },
  {
    key: "account",
    label: null,
    items: tabs.filter((t) => t.href === "/profile"),
  },
];

function iconFor(href: string, active: boolean): React.ReactNode {
  if (href === "/") return <IconFeed active={active} />;
  if (href === "/search") return <IconSearch active={active} />;
  if (href === "/saved") return <IconSaved active={active} />;
  return <IconProfile active={active} />;
}

function formatSynced(lastRefresh: string | null): string {
  return formatTimeAgo(lastRefresh) ?? "not synced";
}

export function Nav() {
  const pathname = usePathname();
  const sidebarOpen = useUIStore((s) => s.sidebarOpen);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const setSidebarOpen = useUIStore((s) => s.setSidebarOpen);

  // Sync CSS variable so <main> padding transitions in lockstep with the
  // sidebar slide. Force 0 on /welcome so the wizard has no sidebar gap.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.documentElement.style.setProperty(
      "--sidebar-offset",
      pathname === "/welcome" ? "0px" : sidebarOpen ? "13rem" : "0px",
    );
  }, [sidebarOpen, pathname]);

  const savedCount = useFeedStore((s) => s.savedPapers.length);

  const papers = useFeedStore((s) => s.papers);
  const readItems = useFeedStore((s) => s.readItems);
  const lastRefresh = useFeedStore((s) => s.lastRefresh);

  // The Feed badge counts the daily lane only. It used to fold in events and
  // jobs, so a job posting could put an unread dot on the paper feed.
  const unreadCount = papers.filter((p) => !readItems[p.id]).length;

  const todayLabel = new Date()
    .toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
    .replace(",", " ·");

  // The active rail. Measured from the DOM and written back as CSS variables
  // on the nav — a DOM write, not React state, so moving it never re-renders
  // the tree. Hidden when the active page is the Today block, which sits
  // outside the nav and carries its own state.
  const navRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    const el = nav.querySelector<HTMLElement>('[data-active="true"]');
    if (!el) {
      nav.style.setProperty("--rail-o", "0");
      return;
    }
    nav.style.setProperty("--rail-y", `${el.offsetTop}px`);
    nav.style.setProperty("--rail-h", `${el.offsetHeight}px`);
    nav.style.setProperty("--rail-o", "1");
  }, [pathname, sidebarOpen]);

  // The onboarding wizard is a focused, full-screen experience — no app chrome.
  if (pathname === "/welcome") return null;

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  const countFor = (href: string): number => {
    if (href === "/") return unreadCount;
    if (href === "/saved") return savedCount;
    return 0;
  };

  const openHelp = () => {
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("peer:toggle-help"));
    }
  };

  return (
    <>
      {/* Spacer that pushes page content below the fixed mobile top bar.
          Lives here (not in <main>) so /welcome, which returns null before
          this JSX, gets no top gap at all. */}
      <div className="h-12 lg:hidden" aria-hidden />

      {/* Mobile: top bar — [Logo] [Tabs] [UserMenu]. The floating
          UserMenu/GithubStars in layout.tsx is desktop-only, so the
          account control lives inline here. */}
      <nav className="fixed top-0 inset-x-0 z-50 glass-bar lg:hidden">
        <div className="h-12 px-3 flex items-center gap-2">
          <Link
            href="/"
            className="flex items-center gap-1.5 text-heading shrink-0 font-display"
            aria-label="Peer home"
          >
            <Image src="/logo-mark.png" alt="" width={26} height={26} className="shrink-0" />
            {/* Brand wordmark hides on the narrowest phones to leave room
                for tabs + account; reappears at sm (≥640px). */}
            <span className="text-title font-normal italic tracking-[-0.01em] hidden sm:inline">
              Peer
            </span>
          </Link>

          <div
            className="flex-1 flex items-center justify-end gap-0.5 min-w-0"
          >
            {tabs.map(({ href, label }) => {
              const n = countFor(href);
              const active = isActive(href);
              return (
                <Link
                  key={href}
                  href={href}
                  className={`relative px-2 py-1.5 text-meta transition-colors duration-200 ease-out active:scale-95 ${
                    active
                      ? "text-heading font-medium"
                      : "text-text-faint hover:text-text-muted"
                  }`}
                >
                  {label}
                  {n > 0 && (
                    <span className="ml-1 text-micro tabular-nums text-accent">
                      {n}
                    </span>
                  )}
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-2 right-2 -bottom-[7px] h-[2px] rounded-full bg-accent"
                    />
                  )}
                </Link>
              );
            })}
          </div>

          <div className="shrink-0">
            <UserMenu compact />
          </div>
        </div>
      </nav>

      {/* Desktop: sidebar — translates off-screen when collapsed.

          This is the spine of a daily ritual, not a list of pages. The one
          thing that changes every day — today's date, how many papers came,
          how many are unread — is the primary object at the top, and it IS the
          Feed link. Search and Saved are reading tools. Events and Jobs are
          once-a-year needs and sit under their own quiet label: the same
          frequency hierarchy the home page encodes, carried into the nav.

          The active state is a rail that travels, not a card. A nav item
          borrowing the content cards' elevation put chrome and content on one
          level; a 2px accent rail sliding to where you went says where you
          are without competing with what you are reading. */}
      <aside
        className={`hidden lg:flex fixed inset-y-0 left-0 w-52 z-50 glass-bar flex-col transition-transform duration-[350ms] ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
        aria-hidden={!sidebarOpen}
      >
        {/* Masthead */}
        <div className="relative px-6 pt-8 pb-5">
          <Link
            href="/"
            className="inline-flex items-baseline text-[22px] font-light text-heading tracking-[-0.02em] italic leading-none font-display"
          >
            Peer
          </Link>
          <button
            type="button"
            onClick={() => setSidebarOpen(false)}
            title="Collapse sidebar (\\)"
            aria-label="Collapse sidebar"
            className="absolute top-[26px] right-4 inline-flex items-center justify-center w-6 h-6 rounded-md text-text-faint/60 hover:text-heading hover:bg-surface/70 transition-colors active:scale-[0.92]"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M15 18l-6-6 6-6" />
              <path d="M20 4v16" />
            </svg>
          </button>
        </div>

        {/* Today — the ritual, and the Feed link */}
        <Link
          href="/"
          tabIndex={sidebarOpen ? 0 : -1}
          data-active={isActive("/") ? "true" : undefined}
          className={`group/today relative mx-3 mb-3 rounded-xl px-3 pt-3 pb-3.5 transition-colors duration-200 ease-out ${
            isActive("/") ? "bg-surface/70" : "hover:bg-surface/40"
          }`}
        >
          <span className="block font-mono text-micro uppercase tracking-[0.16em] text-text-faint/70 tabular-nums">
            {todayLabel}
          </span>
          <span className="mt-1.5 flex items-baseline gap-2">
            <span
              className={`font-display text-[26px] leading-none tracking-[-0.02em] transition-colors ${
                isActive("/") ? "text-heading" : "text-text-muted group-hover/today:text-heading"
              }`}
            >
              Today
            </span>
            {papers.length > 0 && (
              <span className="font-mono text-caption tabular-nums text-text-faint">
                {papers.length}
              </span>
            )}
          </span>
          <span className="mt-1.5 block text-caption text-text-faint tabular-nums">
            {papers.length === 0 ? (
              "no briefing yet"
            ) : unreadCount === 0 ? (
              "all read · back tomorrow"
            ) : (
              <>
                <span className="text-accent font-medium">{unreadCount}</span>{" "}
                unread
              </>
            )}
          </span>
        </Link>

        <nav ref={navRef} className="relative flex-1 flex flex-col px-3 pb-2">
          {/* The rail. Positioned from the active item's offset via CSS
              variables written in a layout effect — a DOM write, not React
              state, so it never re-renders the tree to move. */}
          <span
            aria-hidden
            className="pointer-events-none absolute left-0 w-[2px] rounded-full bg-accent transition-[transform,height,opacity] duration-[260ms] ease-snap"
            style={{
              transform: "translateY(var(--rail-y, 0px))",
              height: "var(--rail-h, 0px)",
              opacity: "var(--rail-o, 0)",
            }}
          />

          {NAV_GROUPS.map((group) => (
            <div
              key={group.key}
              className={
                group.key === "account" ? "mt-auto pt-5" : undefined
              }
            >
              {group.label && (
                <span className="block px-3 pb-1.5 font-mono text-micro uppercase tracking-[0.16em] text-text-faint/50">
                  {group.label}
                </span>
              )}
              <div className="space-y-px">
                {group.items.map(({ href, label, shortcut }) => {
                  const active = isActive(href);
                  const n = countFor(href);
                  return (
                    <Link
                      key={href}
                      href={href}
                      tabIndex={sidebarOpen ? 0 : -1}
                      data-active={active ? "true" : undefined}
                      className={`group flex items-center justify-between gap-2 rounded-lg px-3 py-[7px] text-body-sm transition-colors duration-150 ease-out active:scale-[0.99] ${
                        active
                          ? "text-heading"
                          : "text-text-muted hover:text-heading"
                      }`}
                    >
                      <span className="flex items-center gap-2.5 min-w-0">
                        <span
                          className={`inline-flex items-center justify-center w-4 h-4 shrink-0 transition-colors ${
                            active ? "text-accent" : "text-text-faint/70 group-hover:text-text-muted"
                          }`}
                        >
                          {iconFor(href, active)}
                        </span>
                        <span className="truncate">{label}</span>
                        {n > 0 && (
                          <span className="font-mono text-caption tabular-nums text-text-faint">
                            {n}
                          </span>
                        )}
                      </span>
                      <NavShortcut value={shortcut} dimmed />
                    </Link>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* Footer — one line. Sync state as a dot, shortcuts as a single key,
            version at the far end. Three unrelated things used to share a
            bordered strip here. */}
        <div className="px-6 py-4 flex items-center gap-3 text-micro text-text-faint/60">
          <span
            className={`block w-[5px] h-[5px] rounded-full shrink-0 ${
              lastRefresh ? "bg-accent" : "bg-border-strong"
            }`}
            title={`Synced ${formatSynced(lastRefresh)}`}
            aria-label={`Synced ${formatSynced(lastRefresh)}`}
          />
          <button
            type="button"
            onClick={openHelp}
            tabIndex={sidebarOpen ? 0 : -1}
            title="Keyboard shortcuts"
            aria-label="Keyboard shortcuts"
            className="inline-flex items-center hover:text-heading transition-colors active:scale-[0.95]"
          >
            <NavKbd>?</NavKbd>
          </button>
          <span className="flex-1" aria-hidden />
          <span className="font-mono tracking-wider uppercase tabular-nums">
            v{APP_VERSION}
          </span>
        </div>
      </aside>

      {/* Collapsed floating toggle — icon-only. Minimal footprint so the
          reclaimed space actually feels reclaimed. Unread count surfaces as a
          small badge so you don't need to open the sidebar to see it. */}
      <button
        type="button"
        onClick={toggleSidebar}
        aria-label="Expand sidebar"
        title="Expand sidebar (\)"
        className={`group hidden lg:inline-flex fixed top-4 left-4 z-[55] items-center justify-center w-10 h-10 rounded-full glass shadow-card hover:shadow-card-hover hover:-translate-y-[1px] transition-[opacity,transform,box-shadow] duration-[300ms] ease-out active:scale-[0.94] ${
          sidebarOpen
            ? "opacity-0 -translate-x-2 pointer-events-none"
            : "opacity-100 translate-x-0"
        }`}
      >
        <Image
          src="/logo-mark.png"
          alt=""
          width={26}
          height={26}
          className="shrink-0 transition-transform duration-300 ease-out group-hover:scale-[1.06]"
        />

        {/* Expand affordance — appears on hover, nudges to indicate direction */}
        <span
          className="absolute -right-1 -bottom-1 inline-flex items-center justify-center w-4 h-4 rounded-full bg-heading text-bg opacity-0 group-hover:opacity-100 scale-75 group-hover:scale-100 transition-all duration-200 ease-out"
          aria-hidden
        >
          <svg
            width="8"
            height="8"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M9 18l6-6-6-6" />
          </svg>
        </span>

        {/* Unread badge — hidden when zero or sidebar is open */}
        {unreadCount > 0 && (
          <span
            className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full bg-accent text-bg text-micro font-semibold tabular-nums shadow-card border border-bg/20 group-hover:opacity-0 transition-opacity duration-200"
            aria-label={`${unreadCount} unread`}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>
    </>
  );
}

function NavShortcut({ value, dimmed }: { value: string; dimmed: boolean }) {
  const parts = value.split(" ");
  return (
    <span
      className={`flex items-center gap-0.5 shrink-0 transition-opacity duration-200 ${
        dimmed ? "opacity-0 group-hover:opacity-70 group-focus-visible:opacity-70" : "opacity-60"
      }`}
      aria-hidden
    >
      {parts.map((k, i) => (
        <NavKbd key={i}>{k}</NavKbd>
      ))}
    </span>
  );
}

function NavKbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd
      className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded bg-bg-secondary/80 shadow-well text-[9.5px] text-text-muted leading-none font-mono"
    >
      {children}
    </kbd>
  );
}
