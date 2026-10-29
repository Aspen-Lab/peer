"use client";

// S15/S16/S18/S21: the reading controls — text size, day/night and fit, in
// the user's own order: A (big) · A (small) · sun · moon · fit. One framed
// strip with a rule between each pair, so five loose glyphs read as three
// controls. Sized with the panel's own (non-scaling) type steps, never the
// --reading-scale-driven reading tokens: only the article text these buttons
// control moves, not the controls themselves.
//
// P11-16 (B P11-01 §2.3; ruling §1h.113 (a)): from 1024 css px the strip stands at the top of the left pane (`ReaderLayout` draws it there, with
// `spread`): Fit has a layout to balance and is enabled, and there is no gap above it — the pane's header row above has its own. In one column
// the decision block's details draw it, without `spread`, as ever. It is the caller that knows the layout, so the strip no longer asks
// `useSpread` (and `reader-layout.tsx` can import it without a cycle).
//
// P11-23 rule 3 (round 1's three blind readers, 0.25 each; ruling §1h.121): the sun means "system" (S16: the default, which follows the OS), and it was
// labelled "Day reading mode" and drawn pressed on a dark page — a control claiming a mode the reader does not see. No control is drawn pressed while it
// names a mode the page is not in: the sun's name and tooltip say what it does — "Follow the system" — and, read live from the media query, what that is
// now ("(now dark)" / "(now light)"); and its icon is the sun only while the system is light. While the system is dark it is a half-lit disc, the
// "system" mark, never a sun on a dark page. What a press does is as it was: the sun sets "system", the moon "dark".

import { useSyncExternalStore } from "react";
import { IconButton } from "@/components/ui/button";
import { IconExpand, IconMoon, IconSun } from "@/components/icons";
import { withThemeTransition, withZoomTransition } from "@/lib/theme";
import { useProfileStore } from "@/store/profile";
import { READING_SCALE_STEPS, useReadingPrefsStore } from "@/store/reading-prefs";
import type { ColorTheme, ThemeMode } from "@/types";

// P9-23 (A P9-W2's N5): 28 × 28 px, 4 px apart, on a phone. Where there is no
// hover each control takes the shell's touch rule (notes-button.tsx,
// reader-tabs.tsx, the masthead's links): 44 × 44, with 8 px between
// neighbours (`gap-2` on the strip). With a mouse they are the 28 px they
// were; the floor sits behind the media query so it cannot grow them.
const TOUCH = "[@media(hover:none)]:min-h-11 [@media(hover:none)]:min-w-11";

const DARK_SCHEME = "(prefers-color-scheme: dark)";

function subscribeSystemScheme(onChange: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(DARK_SCHEME);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Whether the system (the OS, through the browser) is dark now; `null` where it cannot be asked (a server render, a browser with no media queries). */
function systemIsDark(): boolean | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DARK_SCHEME).matches : null;
}

/** P11-23 rule 3: the sun's name and tooltip — what the press does, and, when it is known, what that is now. */
export function systemModeLabel(dark: boolean | null): string {
  return dark === null ? "Follow the system" : `Follow the system (now ${dark ? "dark" : "light"})`;
}

/** P11-23 rule 3: the "system" mark, a disc half lit — the sun's place in the strip while the system is dark (the shared set has no such glyph, and the
 *  strip is the only place that needs it). Drawn as the shared icons are: 24 × 24, the stroke and the round caps of the strip's other glyphs. */
function SystemGlyph({ size = 14 }: { size?: number }) {
  return (
    <svg
      data-glyph="system"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 3.5a8.5 8.5 0 0 1 0 17z" fill="currentColor" />
    </svg>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-4 w-px bg-border-strong" />;
}

export function ReadingControls({ spread = false }: { spread?: boolean }) {
  const scaleIndex = useReadingPrefsStore((s) => s.scaleIndex);
  const increaseScale = useReadingPrefsStore((s) => s.increaseScale);
  const decreaseScale = useReadingPrefsStore((s) => s.decreaseScale);
  const atMaxScale = scaleIndex >= READING_SCALE_STEPS.length - 1;
  const atMinScale = scaleIndex <= 0;

  // S21: Fit needs the spread (the three panes, P11-16) to have a pane and a column to balance.
  const fit = useReadingPrefsStore((s) => s.fit);
  const setFit = useReadingPrefsStore((s) => s.setFit);

  // S16: sun = system (the existing default; P11-23: named for what it does, and a sun only while the system is light), moon = night — the same
  // `mode:accent` plumbing the Profile page's own picker already drives, so
  // the two stay in sync through one source of truth (`profile.colorTheme`).
  const colorTheme = useProfileStore((s) => s.profile.colorTheme);
  const updateColorTheme = useProfileStore((s) => s.updateColorTheme);
  const [mode, accent] = colorTheme.split(":") as [ThemeMode, string];
  // P11-23 rule 3: what the system is now, live, for the sun's name and glyph (unknown on the server and before the first client render).
  const systemDark = useSyncExternalStore(subscribeSystemScheme, systemIsDark, () => null);
  const systemLabel = systemModeLabel(systemDark);
  const setMode = (nextMode: "system" | "dark") => {
    // S17: a click fades the palette over ~1s; hydration and background
    // profile syncs never go through this wrapper, so they stay instant.
    withThemeTransition(() => updateColorTheme(`${nextMode}:${accent}` as ColorTheme));
  };

  return (
    <div
      role="group"
      aria-label="Reading controls"
      className={`${spread ? "" : "mt-5 "}reader-controls inline-flex items-center gap-1 [@media(hover:none)]:gap-2 p-1`}
    >
      <IconButton
        aria-label="Larger text"
        // S22: every zoom change eases over ~0.3s instead of snapping.
        onClick={() => withZoomTransition(increaseScale)}
        disabled={atMaxScale}
        aria-disabled={atMaxScale}
        className={`font-reading text-body-lg font-semibold ${TOUCH}`}
      >
        A
      </IconButton>
      <IconButton
        aria-label="Smaller text"
        onClick={() => withZoomTransition(decreaseScale)}
        disabled={atMinScale}
        aria-disabled={atMinScale}
        className={`font-reading text-meta font-semibold ${TOUCH}`}
      >
        A
      </IconButton>
      <Divider />
      <IconButton
        aria-label={systemLabel}
        title={systemLabel}
        aria-pressed={mode === "system"}
        tone={mode === "system" ? "soft" : "ghost"}
        className={TOUCH}
        onClick={() => setMode("system")}
      >
        {systemDark ? <SystemGlyph /> : <IconSun size={14} />}
      </IconButton>
      <IconButton
        aria-label="Night reading mode"
        aria-pressed={mode === "dark"}
        tone={mode === "dark" ? "soft" : "ghost"}
        className={TOUCH}
        onClick={() => setMode("dark")}
      >
        <IconMoon size={14} />
      </IconButton>
      <Divider />
      <IconButton
        aria-label={fit ? "Book layout" : "Fit to screen"}
        aria-pressed={fit}
        tone={fit ? "soft" : "ghost"}
        disabled={!spread}
        title={!spread ? "Fit needs the two-column layout" : undefined}
        className={TOUCH}
        // S22: Fit on/off eases like every other zoom change.
        onClick={() => withZoomTransition(() => setFit(!fit))}
      >
        <IconExpand size={14} />
      </IconButton>
    </div>
  );
}
