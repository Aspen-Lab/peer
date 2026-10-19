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

  // S16: sun = system (the existing default), moon = night — the same
  // `mode:accent` plumbing the Profile page's own picker already drives, so
  // the two stay in sync through one source of truth (`profile.colorTheme`).
  const colorTheme = useProfileStore((s) => s.profile.colorTheme);
  const updateColorTheme = useProfileStore((s) => s.updateColorTheme);
  const [mode, accent] = colorTheme.split(":") as [ThemeMode, string];
  const setMode = (nextMode: "system" | "dark") => {
    // S17: a click fades the palette over ~1s; hydration and background
    // profile syncs never go through this wrapper, so they stay instant.
    withThemeTransition(() => updateColorTheme(`${nextMode}:${accent}` as ColorTheme));
  };

  return (
    <div
      role="group"
      aria-label="Reading controls"
      className={`${spread ? "" : "mt-5 "}inline-flex items-center gap-1 [@media(hover:none)]:gap-2 border border-border-strong p-1`}
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
        aria-label="Day reading mode"
        aria-pressed={mode === "system"}
        tone={mode === "system" ? "soft" : "ghost"}
        className={TOUCH}
        onClick={() => setMode("system")}
      >
        <IconSun size={14} />
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
