import { Band } from "@/components/ui/band";

// ── One empty state ──
//
// A reader who hit nothing-here met three different products: the briefing's
// serif display line with `gap-2.5` buttons, /saved's and /search's centred
// `py-20` block at 17.5px, and /error and /not-found's 22px/600 heading over
// hand-rolled pill buttons that `button.tsx`'s own header comment forbids.
//
// Left-aligned, never centred — the absence sits in the page's column, where
// the content would have been. The measure is `measure-ui`: `max-w-[40ch]` is
// exactly what globals.css's measure block was written to end.

export function EmptyState({
  label,
  title,
  line,
  actions,
}: {
  /** The filing word — where you are. Omitted → no band at all, never a
   *  placeholder word. It must not restate the line under it: "Nothing new
   *  today" above "Nothing new for these topics today." breaks Peer's
   *  no-repeat rule as squarely as a truncation would. */
  label?: string;
  title: string;
  line: string;
  /** `buttonVariants` children. */
  actions?: React.ReactNode;
}) {
  const body = (
    <>
      <h2 className="display-line text-display-sm text-heading text-balance mt-3">{title}</h2>
      <p className="mt-3 text-body-sm text-text-muted measure-ui leading-relaxed">{line}</p>
      {actions && <div className="mt-6 flex flex-wrap items-center gap-4">{actions}</div>}
    </>
  );
  return label ? <Band label={label}>{body}</Band> : <section>{body}</section>;
}
