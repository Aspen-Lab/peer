"use client";

// The masthead: one 48px line across the top of every page but /welcome.
// The wordmark at the left, the day's state on the window's centre line,
// Search · Saved · Profile · ? at the right. It replaces the 208px sidebar,
// its floating toggle, the two top-right pills and the phone's row of tabs.
//
// The grid is `1fr auto 1fr` so the centre cell sits on the window's centre
// whatever the side cells measure. A hairline under it at rest — a title bar
// is drawn, like every other surface — and the surface colour, opaque, once
// scrolled 8px (P10-21: it was glass, and the paper's words showed through it), background only, so the height never changes: nothing on the page moves
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
import type { Route } from "next";
import { usePathname, useRouter } from "next/navigation";
import { useFeedStore } from "@/store/feed";
import { Kbd } from "@/components/ui/kbd";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { Avatar } from "@/components/account/account-section";
import { useAuthUser, userAvatar } from "@/components/account/use-auth-user";
import { readerActions } from "@/lib/reader/reader-keys";
import type { PaperNav } from "@/lib/reader/paper-nav";
import { RAIL } from "@/components/reader/copy";
import { WriteButton } from "@/components/shell/write-button";
import { HelpGlyph, RouteGlyph } from "@/components/shell/icons";
import {
  SHELL_LINKS,
  isActiveLink,
  mastheadCentre,
  railHasPosition,
  shellRoute,
} from "@/lib/shell/masthead";

/** Scrolled this far, the bar takes its glass. */
const SCROLLED_AT = 8;

/** The rail link's arrow — "←" — taken from its label, so the two cannot drift. */
const BACK_ARROW = RAIL.back.split(" ")[0];
/** The rest of the label, " Briefing" with its leading space: the arrow is drawn once, the word comes in from `lg`. */
const BACK_WORD = RAIL.back.slice(BACK_ARROW.length);

const WORDMARK_CLASS =
  "font-display text-title-lg font-medium leading-none tracking-[-0.01em] text-heading";

/**
 * The phone's in-flow wordmark (the briefing's, below `md`) where there is no hover (P9-52, A P9-W3's N5): it was
 * 37 x 19 px. It is a block there (`flex w-fit`, so the 44 px is its own box and not a line box's strut) at least 44
 * px tall, the words centred in it; with a mouse it is the inline link it was.
 */
const FLOW_WORDMARK_TOUCH =
  "[@media(hover:none)]:flex [@media(hover:none)]:w-fit [@media(hover:none)]:min-h-11 [@media(hover:none)]:items-center";

/** The hairline between two words in the bar. A middot is a glyph in a row
 *  of glyphs; a rule is the machine's own line, and the rest of this product
 *  is ruled — the band's rule, the key's, the plate's edge. */
const RULE = (
  <span
    aria-hidden
    className="mx-2 block h-3 w-px bg-border-strong [@media(hover:none)]:max-lg:mx-1"
  />
);
// 4px a side, not 8, on a touch tablet below `lg` (P9-40, step 3): its 44px arrows and 44px `?` leave the cells
// 13px short of 768 after the wordmark is a mark and the position text is gone, and the five hairlines that
// show there are the one thing in the bar that is air, not a word or a target. The `?` ends at 744px, inside the
// bar's 24px margin. A mouse's cells fit already and keep the 8px.

/** The same hairline, drawn from `lg` only: it goes with the position text it follows. */
const RULE_FROM_LG = <span aria-hidden className="mx-2 hidden h-3 w-px bg-border-strong lg:block" />;

/**
 * The registration mark, in the bar's size: four 1px corners around a plate.
 * The graph puts it on the node being pointed at and a card grows it under
 * the pointer; here it says which section you are in, and boxes the
 * nameplate. It marks, it does not decorate — nothing wears it that is not
 * registered.
 */
function Corners({ className = "border-border-strong" }: { className?: string }) {
  const leg = `pointer-events-none absolute h-[5px] w-[5px] transition-colors ${className}`;
  return (
    <span aria-hidden>
      <span className={`${leg} left-0 top-0 border-l border-t`} />
      <span className={`${leg} right-0 top-0 border-r border-t`} />
      <span className={`${leg} bottom-0 left-0 border-b border-l`} />
      <span className={`${leg} bottom-0 right-0 border-b border-r`} />
    </span>
  );
}

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
        //
        // `gap-x-4`: the cells keep 16px between them. The grid has no gap of
        // its own, and the centre is `auto` while the right cell cannot be
        // narrower than the nav, so from 768 to 1279 the rail ended where the
        // nav began — 0px at 768, 900 and 1024 (P9-W2 N2). The gap holds the
        // line wherever the three fit; where they cannot (below `lg`) the
        // wordmark gives way to its mark (see the wordmark below), not the gap.
        className="hidden md:grid sticky top-0 z-50 h-12 px-6 gap-x-4 grid-cols-[1fr_auto_1fr] items-center border-b border-border transition-[background-color,box-shadow] data-[scrolled=true]:bg-surface data-[scrolled=true]:shadow-[0_1px_0_var(--color-border-strong)]"
      >
        {/* The bar's tooth, under its words. It cannot ride on the header
            itself: a background shorthand (the glass it once was) resets
            the image, and it keeps its own fade. Every cell below is positioned, so the words paint over
            it. */}
        <span
          aria-hidden
          className="grain pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[180ms] [[data-scrolled=true]_&]:opacity-100"
        />

        <div className="relative justify-self-start">
          {/* Below `lg` the wordmark is its mark alone. With the position rail
              ("← Briefing · 2 of 5 · k j") the three cells need 826px with a
              mouse and about 897px on touch (P9-40, ruling §1h.64 (a)); the
              word is 53px of that, and the mark is what a tab and a shared
              link's card show, so it names the product on its own. The link
              keeps its name, "Peer", as an aria-label; its `gap-2` comes in
              with the word (it sat between the mark, the word and the
              zero-width corners, 8px of nothing once the word is gone), so
              from `lg` the box is what it was, to the pixel. The mark and its
              padding are 30 x 26px, so an invisible `after` box reaches 8px
              out each side and 12px up and down, to the bar's edges (46 x
              50px), without taking room in the grid; it is not drawn from
              `lg`, where the word is the target. */}
          <Link
            href="/"
            aria-label="Peer"
            className="group/mark relative inline-flex items-center lg:gap-2 px-2 py-1.5 text-heading after:absolute after:-inset-x-2 after:-inset-y-3 lg:after:hidden"
          >
            <Mark />
            <span className={`${WORDMARK_CLASS} hidden lg:inline`}>Peer</span>
            <Corners className="border-border-strong group-hover/mark:border-text-muted" />
          </Link>
        </div>

        {/* Keyed by route so the text crossfades on a navigation and holds
            still when a count lands. */}
        <div
          key={route}
          className="relative justify-self-center inline-flex items-center whitespace-nowrap eyebrow text-text-muted animate-fade-in"
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
          className="relative justify-self-end inline-flex items-center eyebrow text-text-muted"
        >
          <WriteButton />
          {SHELL_LINKS.map((link, i) => {
            const active = isActiveLink(link, route);
            const isProfile = link.route === "profile";
            return (
              <Fragment key={link.href}>
                {i > 0 && RULE}
              <Link
                href={link.href as Route}
                aria-current={active ? "page" : undefined}
                aria-label={isProfile && auth.kind === "signed-in" ? link.label : undefined}
                // The bar's own height, so the whole 48px row is the target
                // on a tablet, and 44px wide where there is no hover — the
                // same rule the k/j arrows two cells over follow.
                className={`inline-flex h-12 items-center justify-center px-1 transition-colors  hover:text-heading [@media(hover:none)]:min-w-11 ${
                  active ? "text-heading" : ""
                }`}
              >
                <span className="relative inline-flex items-center gap-1.5 px-2 py-1">
                  {isProfile && auth.kind === "signed-in" && avatar ? (
                    // Signed in, your own face is the glyph.
                    <Avatar user={auth.user} size={22} />
                  ) : (
                    <>
                      <RouteGlyph route={link.route} size={13} strokeWidth={1.3} />
                      {link.label}
                    </>
                  )}
                  {active && <Corners className="border-text-muted" />}
                </span>
              </Link>
              </Fragment>
            );
          })}
          {RULE}
          <button
            type="button"
            onClick={openHelp}
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
            // The chip is gone: it was the one boxed object in a row of
            // words, which read as unfinished rather than as emphasis. It is
            // a link in the row like the rest, and its glyph is its name.
            className="inline-flex h-12 items-center justify-center px-2 transition-colors hover:text-heading [@media(hover:none)]:min-w-11"
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

function Numeral({ children }: { children: React.ReactNode }) {
  return <span className="text-heading tabular-nums">{children}</span>;
}

function RailLine({ nav, onBack }: { nav: PaperNav; onBack: () => void }) {
  // "2 of 5", as the rail's text says it: the arrows' names carry it, since the text goes below `lg`.
  const position = `${nav.index + 1} of ${nav.total}`;
  return (
    <>
      <BackToFeedLink
        onBack={onBack}
        // Below `lg` the rail and the nav (525px of words) plus the grid's two
        // 16px gaps do not leave room for "← Briefing" beside its position and
        // keycaps, so the link is its arrow there and the whole label from `lg`
        // (1024), where the three cells hold it with room to spare. The arrow
        // is always there and the word comes in after it, inside the same
        // span, so the link's textContent reads "← Briefing" once, not
        // "←← Briefing", and the label is one line of text as it was (two flex
        // items would each round their own width, 1/64px apart from one run).
        // The name does not change: the label is the link's `aria-label`, and
        // the span is decoration. The arrow alone is 8px wide, so below
        // `lg` an invisible `after` box (8px either side, the bar's height; it
        // ends inside the 16px gap) is the click area, and where there is no
        // hover the link is a 44px target, like the keycaps' arrows beside it.
        aria-label={RAIL.back}
        className="relative inline-flex items-center justify-center transition-colors hover:text-heading after:absolute after:-inset-x-2 after:-inset-y-3 lg:after:hidden [@media(hover:none)]:min-h-11 [@media(hover:none)]:min-w-11"
      >
        <span aria-hidden="true">
          {BACK_ARROW}
          <span className="hidden lg:inline">{BACK_WORD}</span>
        </span>
      </BackToFeedLink>
      {railHasPosition(nav) && (
        <>
          {RULE}
          {/* Below `lg` the text and the hairline after it drop (P9-40, step 2
              of ruling §1h.64 (a)): with the wordmark as its mark a mouse fits
              from 768, but a touch tablet's 44px arrows and 44px `?` still
              need 844px. The arrows stay, the real prev / next buttons, and
              their names carry the position the text said. */}
          <span className="hidden lg:inline tabular-nums">
            <Numeral>{nav.index + 1}</Numeral> of <Numeral>{nav.total}</Numeral>
          </span>
          {RULE_FROM_LG}
          <span className="inline-flex items-center gap-1.5">
            <StepButton
              cap="k"
              label="Previous paper"
              position={position}
              arrow="←"
              disabled={!nav.prevId}
              onClick={() => readerActions()?.prev?.()}
            />
            <StepButton
              cap="j"
              label="Next paper"
              position={position}
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
  position,
  arrow,
  disabled,
  onClick,
}: {
  cap: string;
  label: string;
  /** Where you are ("2 of 5"): part of the name, so it is said when the rail's text is not drawn. */
  position: string;
  arrow: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={`${label}, ${position}`}
      title={`${label} (${cap})`}
      className="inline-flex items-center justify-center rounded-md transition-[opacity,transform,scale] disabled:opacity-40 active:scale-[0.95] disabled:active:scale-100 [@media(hover:none)]:min-h-11 [@media(hover:none)]:min-w-11"
    >
      <Kbd pointerOnly>{cap}</Kbd>
      <span className="hidden [@media(hover:none)]:inline text-body text-text-muted" aria-hidden>
        {arrow}
      </span>
    </button>
  );
}
