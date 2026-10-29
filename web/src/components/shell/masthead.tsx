"use client";

// Desktop navigation: brand and the app's destinations.
// Its opaque 48px surface keeps reading content clear while scrolling. On
// narrow screens the thumb bar provides navigation instead.

import { useEffect, useRef } from "react";
import "./masthead.css";
import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";
import { Avatar } from "@/components/account/account-section";
import { useAuthUser, userAvatar } from "@/components/account/use-auth-user";
import { WriteButton } from "@/components/shell/write-button";
import { HelpGlyph, RouteGlyph } from "@/components/shell/icons";
import {
  SHELL_LINKS,
  isActiveLink,
  shellRoute,
} from "@/lib/shell/masthead";

/** Scrolled this far, the bar takes its glass. */
const SCROLLED_AT = 8;

const WORDMARK_CLASS =
  "font-display text-title-lg font-medium leading-none tracking-[-0.01em] text-heading";

/**
 * The phone's in-flow wordmark (the briefing's, below `md`) where there is no hover (P9-52, A P9-W3's N5): it was
 * 37 x 19 px. It is a block there (`flex w-fit`, so the 44 px is its own box and not a line box's strut) at least 44
 * px tall, the words centred in it; with a mouse it is the inline link it was.
 */
const FLOW_WORDMARK_TOUCH =
  "[@media(hover:none)]:flex [@media(hover:none)]:w-fit [@media(hover:none)]:min-h-11 [@media(hover:none)]:items-center";

/**
 * Peer's mark, at the bar's size: the sheet with its registered corner, the
 * same object the tab shows (public/icon.svg). The sheet takes the type's own
 * colour, the corner the accent — the one place in the chrome that carries
 * the hue, as the mark does on the tab and on a shared link's card.
 */
function Mark() {
  return (
    <svg width="14" height="14" viewBox="0 0 64 64" aria-hidden className="shrink-0">
      <rect x="4" y="4" width="56" height="56" fill="currentColor" />
      <path d="M30 4h30v10H30z" fill="var(--color-accent)" />
      <path d="M50 4h10v30H50z" fill="var(--color-accent)" />
    </svg>
  );
}

function openHelp() {
  window.dispatchEvent(new CustomEvent("peer:toggle-help"));
}

export function Masthead() {
  const pathname = usePathname();
  const route = shellRoute(pathname);
  const auth = useAuthUser();

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

  const avatar = auth.kind === "signed-in" ? userAvatar(auth.user) : null;

  return (
    <>
      <header
        ref={ref}
        // Keep the brand and destinations comfortably separated.
        className="peer-masthead hidden md:grid sticky top-0 z-50 h-12 px-6 gap-x-4 grid-cols-[1fr_auto] items-center"
      >
        <div className="relative justify-self-start">
          {/* The mark remains named and easy to hit at narrower widths. */}
          <Link
            href="/"
            aria-label="Peer"
            className="group/mark relative inline-flex items-center lg:gap-2 px-2 py-1.5 text-heading after:absolute after:-inset-x-2 after:-inset-y-3 lg:after:hidden"
          >
            <Mark />
            <span className={`${WORDMARK_CLASS} hidden lg:inline`}>Peer</span>
          </Link>
        </div>

        <nav
          aria-label="Peer"
          className="peer-nav relative justify-self-end inline-flex items-center text-text-muted"
        >
          <WriteButton />
          {SHELL_LINKS.map((link) => {
            const active = isActiveLink(link, route);
            const isProfile = link.route === "profile";
            return (
              <Link
                key={link.href}
                href={link.href as Route}
                aria-current={active ? "page" : undefined}
                aria-label={link.label}
                // The bar's own height, so the whole 48px row is the target
                // on a tablet, and 44px wide where there is no hover.
                className={`peer-nav-link inline-flex h-12 items-center justify-center px-1 transition-colors hover:text-heading [@media(hover:none)]:min-w-11 ${
                  active ? "text-heading" : ""
                }`}
              >
                <span className="relative inline-flex items-center gap-1.5 px-2 py-1">
                  {isProfile && auth.kind === "signed-in" && avatar ? (
                    // Signed in, your own face is the glyph.
                    <Avatar user={auth.user} size={22} />
                  ) : (
                    <>
                      <RouteGlyph route={link.route} size={16} strokeWidth={1.6} />
                      <span className="peer-nav-label">{link.label}</span>
                    </>
                  )}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            onClick={openHelp}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            // The chip is gone: it was the one boxed object in a row of
            // words, which read as unfinished rather than as emphasis. It is
            // a link in the row like the rest, and its glyph is its name.
            className="peer-help inline-flex h-12 items-center justify-center px-2 transition-colors hover:text-heading [@media(hover:none)]:min-w-11"
          >
            <HelpGlyph size={13} strokeWidth={1.3} />
          </button>
        </nav>
      </header>

      {/* Phone, briefing only: the nameplate, in flow, above the page's own
          dateline. The reading page has no top chrome — the plate is the
          first thing on screen. */}
      {route === "briefing" && (
        // 16px of padding above, not 24, where there is no hover: the link's box is 44px there, the words centred
        // in it, so they sit about where they sat (P9-52).
        <div className="md:hidden px-6 pt-6 [@media(hover:none)]:pt-4">
          <Link href="/" className={`${WORDMARK_CLASS} ${FLOW_WORDMARK_TOUCH}`}>
            Peer
          </Link>
        </div>
      )}
    </>
  );
}
