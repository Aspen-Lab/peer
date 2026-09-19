import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Ruling 111c (Phase 2 round 4 C item 3). `tailwind-merge` v3.6.0 has no
// notion of this app's 9 custom `--text-*` size tokens (`globals.css:78-94`)
// as a font-size class group — it falls back to reading any bare `text-XXX`
// as a text-COLOUR conflict-group member, so a call like
// `cn("text-caption font-medium text-accent", "text-text-muted")` silently
// DROPS `text-caption`. Documented in full at
// `components/reports/report-section.tsx:131-177`. `extendTailwindMerge`
// teaches the merge these 9 tokens belong to `font-size`, so they survive
// alongside a real text-colour utility in the same call, while genuine
// same-group conflicts (two of these 9 tokens together) still resolve to
// the later one, and native Tailwind conflicts are untouched (extend, not
// replace). Verified against the full 2425-test gate before shipping
// (round 3 B's item 3 entry) — fixes 5 confirmed live victims plus a
// byte-identical twin at once, in one place, with no site-level edits
// required.
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        "text-micro",
        "text-caption",
        "text-meta",
        "text-body-sm",
        "text-body",
        "text-body-lg",
        "text-lead",
        "text-title",
        "text-title-lg",
        // The display steps, missing from the list above until the note
        // editor's headings put one beside `text-heading` in a single `cn()`
        // and lost it — a Heading 2 set at body size, 17px for 22.
        "text-display-xs",
        "text-display-sm",
        "text-display",
        "text-display-lg",
        "text-display-xl",
      ],
    },
  },
});

/** Merge class lists with Tailwind-aware conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
