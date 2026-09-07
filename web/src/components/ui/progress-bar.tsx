import { cn } from "@/lib/cn";

interface ProgressBarProps {
  pct: number;
  label: string;
  className?: string;
}

function clampPct(pct: number) {
  if (!Number.isFinite(pct)) return 0;
  return Math.min(100, Math.max(0, pct));
}

export function ProgressBar({ pct, label, className }: ProgressBarProps) {
  const value = clampPct(pct);

  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
      className={cn(
        // Centred under the 48px masthead, above it in z; it used to hang off
        // the sidebar's edge and follow it.
        "fixed inset-x-4 top-14 z-[60] mx-auto max-w-lg rounded-xl px-3 py-2.5",
        "glass shadow-card pointer-events-none",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 text-meta text-text-muted">
        <span className="truncate">{label}</span>
        <span className="shrink-0 tabular-nums" aria-hidden>
          {Math.round(value)}%
        </span>
      </div>
      <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-bg-secondary">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-300 ease-snap motion-reduce:transition-none"
          style={{ width: `${value}%` }}
        />
      </div>
    </div>
  );
}
