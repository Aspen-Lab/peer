// The shell's glyphs, drawn once.
//
// The phone bar had them first, at 22px over an 11.5px label; the masthead
// takes the same geometry finer — 13px on a 1.3px stroke — so the two bars
// are one family seen at two sizes rather than two icon sets that drifted.
//
// A glyph here names a PLACE or an ACTION in the shell and nothing else:
// Peer draws no icons in its content, where the words are the paper's.

import type { ShellRoute } from "@/lib/shell/masthead";

export interface GlyphProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function frame({ size = 22, strokeWidth = 1.6, className }: GlyphProps) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
    className,
  };
}

/** The place: today, search, the shelf, you. */
export function RouteGlyph({ route, ...props }: GlyphProps & { route: ShellRoute }) {
  const common = frame(props);
  switch (route) {
    case "briefing":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1" />
        </svg>
      );
    case "search":
      return (
        <svg {...common}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="M20 20l-4.2-4.2" />
        </svg>
      );
    case "saved":
      return (
        <svg {...common}>
          <path d="M6.5 3.5h11v17l-5.5-4-5.5 4z" />
        </svg>
      );
    default:
      return (
        <svg {...common}>
          <circle cx="12" cy="8.5" r="4" />
          <path d="M4.5 20.5c1.2-4 4-6 7.5-6s6.3 2 7.5 6" />
        </svg>
      );
  }
}

/** The action: a pencil, for the one thing in the bar that makes something. */
export function WriteGlyph(props: GlyphProps) {
  return (
    <svg {...frame(props)}>
      <path d="M4 20l1.1-4.1L15.4 5.6l3 3L8.1 18.9z" />
      <path d="M13.3 7.7l3 3" />
    </svg>
  );
}

/** The shortcuts sheet. A question mark is its own glyph, drawn on the same
 *  grid so it sits on the row's baseline with the rest. */
export function HelpGlyph(props: GlyphProps) {
  return (
    <svg {...frame(props)}>
      <path d="M9 8.8a3.1 3.1 0 1 1 3.6 3.05c-.7.14-1.1.7-1.1 1.4v1" />
      <path d="M11.5 17.4h.01" />
    </svg>
  );
}
