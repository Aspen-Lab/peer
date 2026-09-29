// TAB-ICON-THEME round 2 (ABC-JEV-INTEGRATION.md §1ae, ruling §1ak). The
// browser tab's own small square mark used to be Next's file-based
// `app/icon.svg` metadata icon — round 1 repainted that tag in place, but
// Next re-renders its file-based metadata `<link>` from a Server Component
// keyed by a fresh per-request id on every client-side navigation
// (`generateDynamicRSCPayload` -> `getFlightMetadataKey`, confirmed by
// reading next/dist/server/app-render/*), so React mounted a brand-new,
// un-themed `<link>` after the first navigation and never deduped it against
// ours (a `rel="icon"` link is a plain Hoistable in React 19, not a
// deduped Resource the way `rel="stylesheet"` + `precedence` is — confirmed
// by reading react-dom's `isHostHoistableType`). Round 1's A caught the
// live duplicate; this round removes the failure mode structurally instead
// of reconciling after it (§1ak Option 2): `app/icon.svg` moved to
// `web/public/icon.svg` (plain static asset, no longer Next metadata), and
// `web/src/app/layout.tsx` hand-authors ONE `<link id="peer-tab-icon">`
// directly in the root layout's own persistent JSX — the part of the tree
// this app never re-keys or remounts on navigation, so nothing is ever left
// to compete with it.
//
// This module repaints that same `<link>` element in place — never a second
// one — from the SAME two custom properties the masthead's Mark resolves
// (components/shell/masthead.tsx: the sheet via `currentColor`/the
// `text-heading` class, the corner via `var(--color-accent)`; both defined
// per data-mode/data-accent in globals.css). Never a second, independently
// maintained palette.
//
// web/public/icon.svg itself is untouched content (byte-identical move):
// it stays the no-JS / first-paint fallback until this runs, once, after
// mount.

/** The one hand-authored `<link>` in web/src/app/layout.tsx's root layout
 *  JSX (see that file's comment) — targeted by its stable id rather than by
 *  guessing at Next-generated attributes, since nothing auto-generates this
 *  tag any more. Nothing else in the document can ever render a competing
 *  `rel="icon"` link (app/icon.svg no longer exists as a metadata file), so
 *  there is only ever one element to repaint. */
const ICON_LINK_SELECTOR = "#peer-tab-icon";

/** Same 64x64 geometry as app/icon.svg / masthead.tsx's <Mark>: a 56x56 sheet
 *  inset by 4px, and the same two corner paths. Keep in sync with both by
 *  hand if that geometry ever changes. */
function iconMarkup(sheet: string, corner: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect x="4" y="4" width="56" height="56" fill="${sheet}"/>` +
    `<path d="M30 4h30v10H30z" fill="${corner}"/>` +
    `<path d="M50 4h10v30H50z" fill="${corner}"/>` +
    `</svg>`
  );
}

/** A `data:` URL a `<link rel="icon">` can point straight at: no request, so
 *  no flash of the old icon between paints. */
export function buildTabIconHref(sheet: string, corner: string): string {
  return `data:image/svg+xml,${encodeURIComponent(iconMarkup(sheet, corner))}`;
}

/**
 * Reads the exact same two custom properties the masthead's `<Mark>`
 * resolves through `currentColor`/`text-heading` and `var(--color-accent)`
 * — never a second, independently-maintained palette. Null if either is
 * unresolved (no `document`, or the cascade has not applied yet): the
 * caller then leaves whatever icon is already showing alone rather than
 * paint a blank/black one.
 */
export function readMarkTokens(): { sheet: string; corner: string } | null {
  if (typeof document === "undefined" || typeof getComputedStyle === "undefined") return null;
  const style = getComputedStyle(document.documentElement);
  const sheet = style.getPropertyValue("--color-heading").trim();
  const corner = style.getPropertyValue("--color-accent").trim();
  if (!sheet || !corner) return null;
  return { sheet, corner };
}

/**
 * Repaints the existing tab-icon `<link>` in place. Never creates or
 * removes a link element, so there is always exactly one effective icon
 * and no flicker between two of them. A no-op if the link or the tokens
 * are not found (defensive; not expected live — Step 0 confirmed exactly
 * one such link always renders).
 */
export function paintTabIcon(): void {
  if (typeof document === "undefined") return;
  const link = document.querySelector<HTMLLinkElement>(ICON_LINK_SELECTOR);
  if (!link) return;
  const tokens = readMarkTokens();
  if (!tokens) return;
  link.href = buildTabIconHref(tokens.sheet, tokens.corner);
}

/**
 * Mounts the sync: paints once on first load, then repaints whenever
 * `data-mode`/`data-accent` change on `<html>` (the same two attributes
 * `applyColorTheme` writes), and whenever the OS colour scheme changes
 * while the mode is `"system"` — an explicit light/dark choice must NOT
 * follow the OS. Returns a cleanup function that disconnects the observer
 * and removes the media-query listener; call it on unmount.
 *
 * Round 1 deferred the very first paint across two animation frames because
 * painting synchronously raced Next's own hydration of the SSR-rendered
 * icon `<link>` — that `<link>` was rendered by Next's file-based metadata
 * system, a Server Component subtree Next re-resolves shortly after mount.
 * Round 2 removed that race at its source instead of dodging it: the link
 * now lives in `layout.tsx`'s own directly-returned JSX (see that file's
 * comment and this module's header), which this app renders once, plainly,
 * with no separate re-resolution pass after mount — the same kind of plain
 * `useEffect` DOM write `ThemeSync` already does synchronously on every
 * profile change (`components/theme-sync.tsx`), with no timing guard.
 * Retested by execution against the running dev server with the paint
 * restored to synchronous: 7 consecutive fresh loads plus 3 in-app
 * client-side navigations plus a history-back all held at exactly one
 * `<link>`, correctly painted, no hydration warning in the console — the
 * deferral is no longer needed and has been removed (round-2 C checkpoint
 * has the numbers). If a future change ever moves this tag back behind any
 * kind of async/streamed boundary, re-test this exact question before
 * assuming synchronous painting is still safe.
 *
 * Safe to call where `document`/`window`/`MutationObserver` are unavailable
 * (e.g. this repo's Node test environment outside a stubbed test): returns
 * a no-op cleanup instead of throwing.
 */
export function startTabIconSync(): () => void {
  if (
    typeof document === "undefined" ||
    typeof window === "undefined" ||
    typeof MutationObserver === "undefined"
  ) {
    return () => {};
  }

  paintTabIcon();

  const root = document.documentElement;
  const observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.attributeName === "data-mode" || m.attributeName === "data-accent")) {
      paintTabIcon();
    }
  });
  observer.observe(root, { attributes: true, attributeFilter: ["data-mode", "data-accent"] });

  // Repaints only while mode = "system": an explicit light/dark choice never
  // depends on the OS, so none of the three listeners below (the `change`
  // event plus the two round-3 additions) may act on one. Shared logic, one
  // function, three triggers, always the same idempotent paint.
  const repaintIfSystemMode = () => {
    if (root.getAttribute("data-mode") === "system") paintTabIcon();
  };

  const media =
    typeof window.matchMedia === "function"
      ? window.matchMedia("(prefers-color-scheme: dark)")
      : null;
  media?.addEventListener("change", repaintIfSystemMode);

  // §1am (round 3, hardening on A2's finding F1). A2's review
  // (docs/jev-abc/TAB-ICON-THEME-A2-20260928T042554Z.md) could not get a
  // live OS-scheme flip to reach the `change` listener above under this
  // repo's in-app browser tool's colour-scheme emulation — even a plain,
  // Peer-independent `matchMedia` listener never fired as a control, which
  // points at a ceiling of that tool rather than a confirmed defect (a
  // fresh reload taken with the scheme already flipped painted correctly).
  // Harden anyway, for a reason that holds regardless of which explanation
  // is true: a real OS-wide light/dark switch (sunset, a manual OS toggle)
  // usually happens while Peer's tab is in the background, not focused —
  // so also repaint whenever the tab becomes visible again or the window
  // regains focus. This is also the one path of the three that IS
  // verifiable with the tool (flip the scheme while a second pane tab is
  // selected, then return to this one). Same guard, same single element,
  // same idempotent paint: repainting an already-correct icon just
  // re-writes the same href.
  const onVisibilityChange = () => {
    if (document.visibilityState === "visible") repaintIfSystemMode();
  };
  document.addEventListener("visibilitychange", onVisibilityChange);
  window.addEventListener("focus", repaintIfSystemMode);

  return () => {
    observer.disconnect();
    media?.removeEventListener("change", repaintIfSystemMode);
    document.removeEventListener("visibilitychange", onVisibilityChange);
    window.removeEventListener("focus", repaintIfSystemMode);
  };
}
