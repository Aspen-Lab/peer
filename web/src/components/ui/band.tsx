// A band header — the label sitting on its own rule.
//
//     the record ──────────────────────────────────────
//
// The TUI pass needs a section marker that works on any ground: a notched
// border (the label sitting in a gap in the frame) has to paint the page's
// background behind the label, and this page's ground carries a gradient and
// a grain, so the patch would show its seam. A label followed by the rule it
// starts is the same figure, drawn in one direction, and it survives any
// background.
//
// The label is mono because it is the machine speaking. The paper's own words
// are never in a band label.

import { cn } from "@/lib/cn";

/**
 * The gap above a section belongs to the section, not to whoever placed it.
 *
 * Nine call sites each typed their own — 32, 40, 48, 48, 56, 56, 64 — so a
 * reader scrolling one paper passed six different pauses between blocks that
 * are all the same kind of thing. There are two values, named by what they
 * are for, not by how big they are: `section` is the pause, and `none` is for
 * a caller whose container already owns the rhythm (the briefing board) and
 * says so out loud.
 *
 * 48 on a phone, 64 from `sm` up. A flat 64 makes the reader noticeably
 * longer on the screen most reading happens on, and buys nothing there.
 */
/** The pause above a section, for the two blocks on the reading page that are
 *  not a Band and so cannot take `gap="section"`: the skim deck and the
 *  decision. Anything new that opens a section imports this rather than
 *  retyping the pair. */
export const SECTION_GAP = "mt-12 sm:mt-16";

const GAP = { section: SECTION_GAP, none: "" };

export function Band({
  label,
  gap = "section",
  className,
  labelClassName,
  dot = true,
  pulse = false,
  children,
}: {
  label: string;
  /** The pause above this section. `none` when the container owns it. */
  gap?: keyof typeof GAP;
  className?: string;
  /** The claim's band is the one that carries the hue. */
  labelClassName?: string;
  /** The eyebrow's mark, on by default — it is what makes a two-word label
   *  read as a section rather than as a stray line of small type. */
  dot?: boolean;
  /** The one repeating animation in the product. Never on two things at once. */
  pulse?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <section className={cn(GAP[gap], className)}>
      <div className="flex items-center gap-3">
        <h2
          className={`eyebrow inline-flex items-center gap-2 whitespace-nowrap ${labelClassName ?? "text-text-faint"}`}
        >
          {dot && (
            <span
              aria-hidden
              className={`block h-[6px] w-[6px] shrink-0 bg-current${pulse ? " dot-pulse" : ""}`}
            />
          )}
          {label}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border-strong" />
      </div>
      {children}
    </section>
  );
}

/** The rule alone — a band with nothing to say, or a divider inside one. */
export function BandRule({
  gap = "section",
  className,
}: {
  gap?: keyof typeof GAP;
  className?: string;
}) {
  return <span aria-hidden className={cn("block h-px bg-border-strong", GAP[gap], className)} />;
}
