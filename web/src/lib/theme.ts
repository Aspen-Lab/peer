import type { ColorTheme, ThemeAccent, ThemeMode } from "@/types";

// Theme = mode x accent, stored as one "mode:accent" string. CSS derives the
// full palette from the accent seed via color-mix (see globals.css) — setting
// the two data attributes is the whole mechanism. A pre-paint boot script in
// app/layout.tsx applies the persisted value before first paint.

const MODES: readonly ThemeMode[] = ["system", "light", "dark"];
const ACCENTS: readonly ThemeAccent[] = [
  "ember",
  "rose",
  "marigold",
  "sage",
  "indigo",
  "violet",
];

/** Pre-v2 single-name themes map onto the nearest mode x accent pair. */
const LEGACY: Record<string, ColorTheme> = {
  system: "system:ember",
  cream: "light:ember",
  white: "light:indigo",
  pink: "light:rose",
  blue: "light:indigo",
  sage: "light:sage",
  lavender: "light:violet",
  black: "dark:ember",
  slate: "dark:indigo",
  plum: "dark:violet",
};

export function normalizeColorTheme(value: string | null | undefined): ColorTheme {
  if (!value) return "system:ember";
  if (LEGACY[value]) return LEGACY[value];
  const [mode, accent] = value.split(":");
  if (MODES.includes(mode as ThemeMode) && ACCENTS.includes(accent as ThemeAccent)) {
    return value as ColorTheme;
  }
  return "system:ember";
}

export function applyColorTheme(theme: ColorTheme | string) {
  if (typeof document === "undefined") return;
  const [mode, accent] = normalizeColorTheme(theme).split(":");
  const root = document.documentElement;
  root.setAttribute("data-mode", mode);
  root.setAttribute("data-accent", accent);
}

const THEME_TRANSITION_CLASS = "theme-transition";
// A little over the CSS rule's own 1s, so the class outlives the
// transition it triggers rather than cutting it off early.
const THEME_TRANSITION_MS = 1100;

/**
 * S17: runs `run` (a theme-changing action, e.g. `updateColorTheme`) with a
 * ~1s colour fade instead of an instant snap. Deliberately not wired inside
 * `applyColorTheme` itself: `ThemeSync` calls that on every hydration and
 * every background profile sync, neither of which is a user click — fading
 * those would play the transition on every page load. Only call this from
 * an actual click handler.
 */
export function withThemeTransition(run: () => void): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    run();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    run();
    return;
  }
  const root = document.documentElement;
  root.classList.add(THEME_TRANSITION_CLASS);
  // Force a style recalc before `run()` changes the palette attributes:
  // without this, the class-add and the attribute change can land in the
  // same synchronous style recalculation, so the browser never registers
  // a "before" value to fade from and the colours snap instead of easing
  // (confirmed by execution: without this line, a click-triggered switch
  // left `background-color` visibly stuck at the old value well past the
  // transition's own 1.1s window, while the identical attribute change
  // made directly — no wrapper — updated instantly, isolating the cause
  // to this add-then-change ordering rather than the CSS rule itself).
  void root.offsetHeight;
  run();
  window.setTimeout(() => root.classList.remove(THEME_TRANSITION_CLASS), THEME_TRANSITION_MS);
}

const ZOOM_TRANSITION_CLASS = "zoom-transition";
// The CSS rule's own duration; matches globals.css's `.zoom-transition` block.
const ZOOM_DURATION_MS = 300;
// A little over the CSS rule's own .3s, so the class outlives the
// transition it triggers rather than cutting it off early — same margin
// idea as THEME_TRANSITION_MS, scaled down for the shorter duration.
const ZOOM_TRANSITION_MS = ZOOM_DURATION_MS + 50;

/**
 * S22: runs `run` (a reading-scale change — the A/A buttons, the Fit
 * toggle, or a zoom keyboard chord) with a ~0.3s ease instead of an instant
 * snap. Same shape as `withThemeTransition`, one substitution: there is no
 * page-wide singleton to target the way `document.documentElement` is for
 * the palette, so the class goes on the reading page's own
 * `[data-zoom-root]` element (the one `<PageContainer>` S20 already wires
 * `--reading-scale` onto, in app/papers/[id]/page.tsx) via a
 * `document.querySelector` lookup rather than a threaded ref — the call
 * sites (decision-block.tsx's buttons, keyboard.tsx's chords) have no
 * natural path to a ref living in a different component, the same
 * `document.querySelectorAll("[data-paper-id]")` shape `keyboard.tsx`
 * already uses for cross-component coordination. No-op if the element
 * isn't found: defensive, since this is only ever called from the reading
 * page's own controls, which do not render unless the article does.
 */
export function withZoomTransition(run: () => void): void {
  if (typeof document === "undefined" || typeof window === "undefined") {
    run();
    return;
  }
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    run();
    return;
  }
  const root = document.querySelector<HTMLElement>("[data-zoom-root]");
  if (!root) {
    run();
    return;
  }
  root.classList.add(ZOOM_TRANSITION_CLASS);
  // Same reflow-before-change reasoning as withThemeTransition above.
  void root.offsetHeight;
  run();
  window.setTimeout(() => root.classList.remove(ZOOM_TRANSITION_CLASS), ZOOM_TRANSITION_MS);
}
