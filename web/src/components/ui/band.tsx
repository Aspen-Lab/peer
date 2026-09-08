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

export function Band({
  label,
  className,
  labelClassName,
  children,
}: {
  label: string;
  className?: string;
  /** The claim's band is the one that carries the hue. */
  labelClassName?: string;
  children?: React.ReactNode;
}) {
  return (
    <section className={className}>
      <div className="flex items-center gap-3">
        <h2
          className={`font-mono text-caption whitespace-nowrap ${labelClassName ?? "text-text-faint"}`}
        >
          {label}
        </h2>
        <span aria-hidden className="h-px flex-1 bg-border-strong" />
      </div>
      {children}
    </section>
  );
}

/** The rule alone — a band with nothing to say, or a divider inside one. */
export function BandRule({ className }: { className?: string }) {
  return <span aria-hidden className={`block h-px bg-border-strong ${className ?? ""}`} />;
}
