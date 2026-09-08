"use client";

// The masthead: one 48px line across the top of every page but /welcome.
// The wordmark at the left, the day's state on the window's centre line,
// Search · Saved · Profile · ? at the right. It replaces the 208px sidebar,
// its floating toggle, the two top-right pills and the phone's row of tabs.
//
// The grid is `1fr auto 1fr` so the centre cell sits on the window's centre
// whatever the side cells measure. A hairline under it at rest — a title bar
// is drawn, like every other surface — and glass once scrolled 8px,
// background only, so the height never changes: nothing on the page moves
// and the reading panel's 4rem sticky top still clears it. Scroll state is a
// data attribute written by a passive listener: no React state, no re-render
// per scroll tick.
//
// The wordmark is the display serif — the product's own name, the one thing
// in the bar that is not the machine talking. Everything else in it is mono.
//
// On a paper the centre is the rail — ← Briefing · 3 of 10 · k j — with the
// keycaps as the real prev/next buttons, calling what the page registered
// (`readerActions`), so there is one position counter on the page. Below
// 768px the bar is gone: the briefing gets the wordmark and the day line in
// flow, and the thumb bar carries the shell.

import { Fragment, useEffect, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { Kbd } from "@/components/ui/kbd";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { Avatar } from "@/components/account/account-section";
import { useAuthUser, userAvatar } from "@/components/account/use-auth-user";
import { readerActions } from "@/lib/reader/reader-keys";
import type { PaperNav } from "@/lib/reader/paper-nav";
import { RAIL } from "@/components/reader/copy";
import {
  SHELL_LINKS,
  isActiveLink,
  mastheadCentre,
  railHasPosition,
  shellRoute,
} from "@/lib/shell/masthead";

/** Scrolled this far, the bar takes its glass. */
const SCROLLED_AT = 8;

const WORDMARK_CLASS =
  "font-display text-title-lg font-medium leading-none tracking-[-0.01em] text-heading";

const DOT = (
  <span className="px-[7px] text-text-faint" aria-hidden>
    ·
  </span>
);

function openHelp() {
  window.dispatchEvent(new CustomEvent("peer:toggle-help"));
}

export function Masthead() {
  const pathname = usePathname();
  const route = shellRoute(pathname);
  const papers = useFeedStore((s) => s.papers);
  const auth = useAuthUser();
  const router = useRouter();

  const ref = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const paint = () => {
      el.dataset.scrolled = window.scrollY >= SCROLLED_AT ? "true" : "false";
    };
    paint();
    window.addEventListener("scroll", paint, { passive: true });
    return () => window.removeEventListener("scroll", paint);
    // Re-read on every route: a navigation resets the scroll position
    // without firing a scroll event.
  }, [route]);

  // The wizard is the one chrome-free route.
  if (route === "welcome") return null;

  const centre = mastheadCentre(route, { pathname, papers });
  const avatar = auth.kind === "signed-in" ? userAvatar(auth.user) : null;

  return (
    <>
      <header
        ref={ref}
        // A title bar is drawn. It used to be transparent with no edge until
        // the reader scrolled, which left three words and a boxed `?`
        // floating on the ground with nothing holding them — the rest of the
        // product is hairlines now, and this was the last surface without
        // one. The edge is there at rest; the glass still arrives on scroll,
        // background only, so the height never changes.
        className="hidden md:grid sticky top-0 z-50 h-12 px-6 grid-cols-[1fr_auto_1fr] items-center border-b border-border transition-[background-color,box-shadow] duration-150 ease-snap data-[scrolled=true]:glass-bar data-[scrolled=true]:shadow-[0_1px_0_var(--color-border-strong)]"
      >
        <div className="justify-self-start">
          <Link href="/" className={WORDMARK_CLASS}>
            Peer
          </Link>
        </div>

        {/* Keyed by route so the text crossfades on a navigation and holds
            still when a count lands. */}
        <div
          key={route}
          className="justify-self-center inline-flex items-center whitespace-nowrap font-mono text-meta text-text-muted animate-fade-in"
          // Inline, not a utility: `.animate-fade-in` is an unlayered rule
          // in globals.css whose shorthand outranks anything in Tailwind's
          // utilities layer, so `[animation-duration:150ms]` lost silently.
          style={{ animationDuration: "150ms" }}
        >
          {centre.kind === "rail" && <RailLine nav={centre.nav} onBack={() => router.back()} />}
        </div>

        <nav
          aria-label="Peer"
          // One row, not three words with air between them: mono, and the
          // separators the rest of the machine's lines use. The nav and the
          // reading page's key legend at the foot of the screen are now the
          // same object at the two edges of the window.
          className="justify-self-end inline-flex items-center font-mono text-meta text-text-muted"
        >
          {SHELL_LINKS.map((link, i) => {
            const active = isActiveLink(link, route);
            const isProfile = link.route === "profile";
            return (
              <Fragment key={link.href}>
                {i > 0 && DOT}
              <Link
                href={link.href}
                aria-current={active ? "page" : undefined}
                aria-label={isProfile && auth.kind === "signed-in" ? link.label : undefined}
                // The bar's own height, so the whole 48px row is the target
                // on a tablet, and 44px wide where there is no hover — the
                // same rule the k/j arrows two cells over follow.
                className={`inline-flex h-12 items-center justify-center px-1 transition-colors duration-150 ease-snap hover:text-heading [@media(hover:none)]:min-w-11 ${
                  active ? "text-heading" : ""
                }`}
              >
                {isProfile && auth.kind === "signed-in" && avatar ? (
                  <Avatar user={auth.user} size={22} />
                ) : (
                  link.label
                )}
              </Link>
              </Fragment>
            );
          })}
          {DOT}
          <button
            type="button"
            onClick={openHelp}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            // The chip is gone: it was the one boxed object in a row of
            // words, which read as unfinished rather than as emphasis. It is
            // a link in the row like the rest, and its glyph is its name.
            className="inline-flex h-12 items-center justify-center px-1 transition-colors duration-150 ease-snap hover:text-heading [@media(hover:none)]:min-w-11"
          >
            ?
          </button>
        </nav>
      </header>

      {/* Phone, briefing only: the nameplate, in flow, above the page's own
          dateline. The reading page has no top chrome — the plate is the
          first thing on screen. */}
      {route === "briefing" && (
        <div className="md:hidden px-6 pt-6">
          <Link href="/" className={WORDMARK_CLASS}>
            Peer
          </Link>
        </div>
      )}
    </>
  );
}

function Numeral({ children }: { children: React.ReactNode }) {
  return <span className="text-heading tabular-nums">{children}</span>;
}

function RailLine({ nav, onBack }: { nav: PaperNav; onBack: () => void }) {
  return (
    <>
      <BackToFeedLink
        onBack={onBack}
        className="transition-colors duration-150 ease-snap hover:text-heading"
      >
        {RAIL.back}
      </BackToFeedLink>
      {railHasPosition(nav) && (
        <>
          {DOT}
          <span className="tabular-nums">
            <Numeral>{nav.index + 1}</Numeral> of <Numeral>{nav.total}</Numeral>
          </span>
          {DOT}
          <span className="inline-flex items-center gap-1.5">
            <StepButton
              cap="k"
              label="Previous paper"
              arrow="←"
              disabled={!nav.prevId}
              onClick={() => readerActions()?.prev?.()}
            />
            <StepButton
              cap="j"
              label="Next paper"
              arrow="→"
              disabled={!nav.nextId}
              onClick={() => readerActions()?.next?.()}
            />
          </span>
        </>
      )}
    </>
  );
}

/**
 * A keycap that is the button. Where there is no hover the cap hides (a key
 * means nothing without a keyboard) and a 44px arrow stands in — a tablet
 * in landscape gets this masthead too.
 */
function StepButton({
  cap,
  label,
  arrow,
  disabled,
  onClick,
}: {
  cap: string;
  label: string;
  arrow: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={`${label} (${cap})`}
      className="inline-flex items-center justify-center rounded-md transition-[opacity,transform] duration-150 ease-snap disabled:opacity-40 active:scale-[0.95] disabled:active:scale-100 [@media(hover:none)]:min-h-11 [@media(hover:none)]:min-w-11"
    >
      <Kbd pointerOnly>{cap}</Kbd>
      <span className="hidden [@media(hover:none)]:inline text-body text-text-muted" aria-hidden>
        {arrow}
      </span>
    </button>
  );
}
