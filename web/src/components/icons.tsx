// Shared icon set — ONE canonical drawing per concept.
//
// Before this file existed the same icons were retyped per page and had
// already drifted (three different checks, two pins, two books…). Add new
// icons here, not inline in pages; keep the 24×24 viewBox and stroke style.

export interface IconProps {
  size?: number;
  strokeWidth?: number;
  className?: string;
}

function strokeProps(size: number, strokeWidth: number, className?: string) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    stroke: "currentColor" as const,
    strokeWidth,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    className,
    "aria-hidden": true as const,
  };
}

export function IconCheck({ size = 12, strokeWidth = 2.2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

export function IconCheckCircle({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12l3 3 5-6" />
    </svg>
  );
}

export function IconStar({ size = 13, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" stroke="none" className={className} aria-hidden>
      <path d="M12 3l2.5 6.5L21 10l-5.2 4 1.7 7L12 17.5 6.5 21l1.7-7L3 10l6.5-.5z" />
    </svg>
  );
}

export function IconPin({ size = 12, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M12 21s-7-7.5-7-12a7 7 0 1 1 14 0c0 4.5-7 12-7 12z" />
      <circle cx="12" cy="9" r="2.5" />
    </svg>
  );
}

export function IconCalendar({ size = 12, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </svg>
  );
}

export function IconBullseye({ size = 12, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <circle cx="12" cy="12" r="9" />
      <circle cx="12" cy="12" r="5" />
      <circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function IconBuilding({ size = 12, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <rect x="4" y="3" width="16" height="18" rx="1.5" />
      <path d="M8 7h2M14 7h2M8 12h2M14 12h2M8 17h2M14 17h2" />
    </svg>
  );
}

export function IconBook({ size = 12, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14z" />
      <path d="M4 19.5V21h16" />
    </svg>
  );
}

export function IconBookmark({
  size = 14,
  strokeWidth = 2,
  className,
  filled = false,
}: IconProps & { filled?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" />
    </svg>
  );
}

export function IconThumbsUp({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M7 10v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V11a1 1 0 0 1 1-1h3zM7 10l4-7a2 2 0 0 1 2 2v3h5.5a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 17.3 19H7" />
    </svg>
  );
}

export function IconThumbsDown({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M17 14V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-3zM17 14l-4 7a2 2 0 0 1-2-2v-3H5.5a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 6.7 5H17" />
    </svg>
  );
}

// ── The reading page's set ────────────────────────────────────────────
// Actions carry a mark, not a picture: one stroke each, drawn at the meta
// line's size so an icon never outweighs the word beside it.

export function IconArrowUpRight({ size = 13, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M7 17L17 7" />
      <path d="M8 7h9v9" />
    </svg>
  );
}

export function IconArrowRight({ size = 13, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M4 12h15" />
      <path d="M13 6l6 6-6 6" />
    </svg>
  );
}

export function IconCopy({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  );
}

export function IconX({ size = 13, strokeWidth = 2, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M6 6l12 12" />
      <path d="M18 6L6 18" />
    </svg>
  );
}

export function IconCode({ size = 13, strokeWidth = 1.9, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M9 8l-5 4 5 4" />
      <path d="M15 8l5 4-5 4" />
    </svg>
  );
}

export function IconLink({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M10.5 13.5a3.5 3.5 0 0 0 5 0l3-3a3.5 3.5 0 0 0-5-5l-1.5 1.5" />
      <path d="M13.5 10.5a3.5 3.5 0 0 0-5 0l-3 3a3.5 3.5 0 0 0 5 5l1.5-1.5" />
    </svg>
  );
}

export function IconQuote({ size = 13, strokeWidth = 1.8, className }: IconProps) {
  return (
    <svg {...strokeProps(size, strokeWidth, className)}>
      <path d="M9 6.5C6.2 7.6 4.5 10 4.5 13v4.5h6V11H7.6c.1-1.4.7-2.4 1.9-3z" />
      <path d="M19 6.5c-2.8 1.1-4.5 3.5-4.5 6.5v4.5h6V11h-2.9c.1-1.4.7-2.4 1.9-3z" />
    </svg>
  );
}
