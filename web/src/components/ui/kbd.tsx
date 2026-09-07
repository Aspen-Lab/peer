// The keycap chip. One rendering for the help sheet, the `g` chord hint, the
// reading rail and the Decision buttons, so a key looks the same wherever it
// is named.

/**
 * A keycap means nothing where there is no keyboard. Any element that exists
 * only to name a key — a rail of `k` `j` `?`, the chip inside a button — takes
 * this class so a phone never shows it. The help sheet does not: the masthead's
 * `?` chip opens it on a tablet too, and a shortcut list with no keys is empty.
 */
export const POINTER_ONLY_CLASS = "[@media(hover:none)]:hidden";

export function Kbd({
  children,
  className,
  pointerOnly = false,
}: {
  children: React.ReactNode;
  className?: string;
  /** Hide under `hover:none` — for chips that decorate a control. */
  pointerOnly?: boolean;
}) {
  const extra = [pointerOnly && POINTER_ONLY_CLASS, className]
    .filter(Boolean)
    .join(" ");
  // A chip that decorates a control is hidden from assistive technology too:
  // the control already has a name, and the chip's letter would be read
  // into it ("Saves", "Skipx"). The help sheet's chips are content and keep
  // their text.
  return (
    <kbd
      aria-hidden={pointerOnly || undefined}
      className={`inline-flex items-center justify-center min-w-[22px] h-[22px] px-1.5 rounded-md bg-bg-secondary shadow-well text-caption text-heading font-medium tabular-nums font-mono${extra ? ` ${extra}` : ""}`}
    >
      {children}
    </kbd>
  );
}
