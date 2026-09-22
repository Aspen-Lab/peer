// The subject mark on a card.
//
// `shell/icons.tsx` says Peer draws no icons in its content, where the words
// are the paper's. This is the one exception, and it is a narrow one: the
// mark names a FAMILY, never a paper, it is drawn at the weight of the meta
// line rather than the title, and nothing on the card depends on it. On a
// board of ten grey rectangles the eye needs something to sort by before it
// starts reading, and the subject is the honest thing to sort by.
//
// Same geometry as the shell's glyphs — a 24-unit grid, one stroke, round
// ends — so the product has one hand, not two.

import { cn } from "@/lib/cn";
import type { TopicKey } from "@/lib/papers/topic-mark";

export function TopicMark({
  topic,
  label,
  size = 13,
  strokeWidth = 1.4,
  framed = false,
  className,
}: {
  topic: TopicKey;
  /** In a tinted square, the way the profile frames a signal's glyph: a badge
   *  the eye finds from across the board, where the bare stroke was a
   *  13px whisper nobody saw. */
  framed?: boolean;
  /** Named on hover. The mark is a reading of the paper's words, so it is not
   *  announced as a fact: `aria-hidden`, and the card's own words carry the
   *  meaning for anyone not looking at it. */
  label: string;
  size?: number;
  strokeWidth?: number;
  className?: string;
}) {
  const common = {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };

  // The class goes on the wrapper, not the glyph: the caller places the mark
  // (`ml-auto` at the end of the meta line) and colours it, and a margin on
  // the svg inside a span moves nothing.
  return (
    <span
      title={label}
      className={cn(
        "shrink-0 leading-none",
        framed && "grid h-7 w-7 place-items-center bg-bg-secondary text-text-muted transition-colors",
        className,
      )}
    >
      <svg {...common}>{PATHS[topic]}</svg>
    </span>
  );
}

const PATHS: Record<TopicKey, React.ReactNode> = {
  // A leaf and its midrib.
  earth: (
    <>
      <path d="M4.5 19.5C4.5 11.2 11.2 4.5 19.5 4.5c0 8.3-6.7 15-15 15z" />
      <path d="M8.5 15.5c2-3.5 4-5.5 7.5-7.5" />
    </>
  ),
  // Two strands and their rungs.
  life: (
    <>
      <path d="M8 3c6 4.5 6 13.5 0 18M16 3c-6 4.5-6 13.5 0 18" />
      <path d="M9.6 8h4.8M9.6 16h4.8" />
    </>
  ),
  // A nucleus and one orbit.
  matter: (
    <>
      <circle cx="12" cy="12" r="2.1" />
      <ellipse cx="12" cy="12" rx="9.3" ry="4" transform="rotate(-30 12 12)" />
    </>
  ),
  // A line that steps up, and the corner it turns into.
  market: (
    <>
      <path d="M3 17.5l5-5 3.5 3.5L20.5 7" />
      <path d="M15.5 7h5v5" />
    </>
  ),
  shield: <path d="M12 3l7.5 2.9v6.3c0 4.3-3.2 7.1-7.5 8.3-4.3-1.2-7.5-4-7.5-8.3V5.9z" />,
  // A frame and what it is looking at.
  vision: (
    <>
      <rect x="3" y="5.5" width="18" height="13" rx="1.5" />
      <circle cx="12" cy="12" r="3.4" />
    </>
  ),
  // Lines of type, the last one short.
  language: <path d="M4 7.5h16M4 12h16M4 16.5h9" />,
  // A body on a base, and the arm it reaches with.
  robot: (
    <>
      <rect x="6" y="9" width="12" height="9" rx="1.5" />
      <path d="M12 9V5.5M9.5 21h5M9 13.5h.01M15 13.5h.01" />
      <circle cx="12" cy="4.5" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // A die and its pins.
  chip: (
    <>
      <rect x="7" y="7" width="10" height="10" rx="1" />
      <path d="M9.5 7V3.5M14.5 7V3.5M9.5 20.5V17M14.5 20.5V17M7 9.5H3.5M7 14.5H3.5M20.5 9.5H17M20.5 14.5H17" />
    </>
  ),
  // A figure with a centre.
  geometry: (
    <>
      <path d="M12 2.8l8 4.6v9.2l-8 4.6-8-4.6V7.4z" />
      <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    </>
  ),
  // Three nodes, and what joins them.
  network: (
    <>
      <path d="M10.9 8.5L8.3 13.9M13.1 8.5l2.6 5.4M9.4 16.6h5.2" />
      <circle cx="12" cy="6.4" r="2.1" />
      <circle cx="7.2" cy="16.6" r="2.1" />
      <circle cx="16.8" cy="16.6" r="2.1" />
    </>
  ),
  // A book, open.
  primer: (
    <>
      <path d="M12 7.6C10 5.6 7 5.1 4 5.6v12.2c3-.5 6 0 8 2 2-2 5-2.5 8-2V5.6c-3-.5-6 0-8 2z" />
      <path d="M12 7.6v12.2" />
    </>
  ),
  // The brackets software is written between.
  tool: <path d="M8.6 6.4L3.4 12l5.2 5.6M15.4 6.4L20.6 12l-5.2 5.6" />,
  // Three measurements.
  data: <path d="M5.5 19.5V11M12 19.5V4.5M18.5 19.5V14" />,
  // Something goes in, something comes out.
  model: (
    <>
      <rect x="7.5" y="7.5" width="9" height="9" rx="1" />
      <path d="M2.5 12h5M16.5 12h5" />
    </>
  ),
  // Peer's own mark: a sheet, registered at its corners.
  paper: (
    <>
      <rect x="6.5" y="6.5" width="11" height="11" />
      <path d="M3 6.5h2M6.5 3v2M21 6.5h-2M17.5 3v2M3 17.5h2M6.5 21v-2M21 17.5h-2M17.5 21v-2" />
    </>
  ),
};
