"use client";

import {
  ReactNode,
  useEffect,
  useId,
  useRef,
  useState,
  KeyboardEvent,
} from "react";

interface FilterChipProps {
  label: string;
  displayValue?: string;
  active: boolean;
  onClear?: () => void;
  onClick?: () => void;
  children?: (close: () => void) => ReactNode;
  ariaLabel?: string;
}

export function FilterChip({
  label,
  displayValue,
  active,
  onClear,
  onClick,
  children,
  ariaLabel,
}: FilterChipProps) {
  const [open, setOpen] = useState(false);
  const [hovering, setHovering] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: MouseEvent) => {
      if (!wrapperRef.current) return;
      if (!wrapperRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("mousedown", onDocDown);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDocDown);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open]);

  const close = () => setOpen(false);

  const handleClick = () => {
    if (onClick) onClick();
    if (children) setOpen((v) => !v);
  };

  const showClearButton = active && onClear && hovering;

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === "Backspace" || e.key === "Delete") && active && onClear) {
      e.preventDefault();
      onClear();
    }
  };

  return (
    <div
      ref={wrapperRef}
      className="relative inline-block"
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
    >
      <button
        ref={buttonRef}
        type="button"
        onClick={handleClick}
        onKeyDown={handleKey}
        aria-pressed={active}
        aria-expanded={children ? open : undefined}
        aria-controls={children ? panelId : undefined}
        aria-label={ariaLabel}
        className={[
          "group relative inline-flex items-center h-10 rounded-full px-4 gap-1.5",
          "text-body-sm font-medium tracking-[-0.005em]",
          "transition-all ease-out active:scale-[0.97]",
          active
            ? "bg-[color:var(--color-accent-dim)] text-[color:var(--color-accent)] shadow-card hover:shadow-card-hover"
            : "bg-surface text-text shadow-card hover:shadow-card-hover hover:-translate-y-[0.5px] hover:text-heading",
        ].join(" ")}
      >
        <span>{displayValue ?? label}</span>
        {children &&
          (showClearButton ? (
            <span
              role="button"
              tabIndex={-1}
              onClick={(e) => {
                e.stopPropagation();
                onClear?.();
              }}
              className="inline-flex items-center justify-center w-4 h-4 rounded-full text-meta hover:bg-[color:var(--color-accent)]/20"
              aria-label={`Clear ${label}`}
            >
              ×
            </span>
          ) : (
            <span
              aria-hidden
              className={[
                "inline-block text-micro transition-transform ",
                open ? "rotate-180" : "",
                active ? "opacity-70" : "opacity-50",
              ].join(" ")}
            >
              ▾
            </span>
          ))}
        {!children && active && onClear && hovering && (
          <span
            role="button"
            tabIndex={-1}
            onClick={(e) => {
              e.stopPropagation();
              onClear?.();
            }}
            className="inline-flex items-center justify-center w-4 h-4 rounded-full text-meta hover:bg-[color:var(--color-accent)]/20"
            aria-label={`Clear ${label}`}
          >
            ×
          </span>
        )}
      </button>
      {children && open && (
        <div
          id={panelId}
          role="dialog"
          className="absolute top-full mt-2 left-0 z-30 glass shadow-card-hover rounded-xl p-3 min-w-[220px]"
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}

interface RadioListProps<T extends string | number> {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  name: string;
}

export function RadioList<T extends string | number>({
  options,
  value,
  onChange,
  name,
}: RadioListProps<T>) {
  return (
    <div className="flex flex-col gap-0.5" role="radiogroup">
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <button
            key={String(opt.value)}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={[
              "flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-body-sm text-left",
              "transition-colors ",
              active
                ? "bg-[color:var(--color-accent-dim)] text-[color:var(--color-accent)]"
                : "text-text hover:bg-[color:var(--color-bg-secondary)]",
            ].join(" ")}
            data-name={name}
          >
            <span>{opt.label}</span>
            {active && <span aria-hidden>✓</span>}
          </button>
        );
      })}
    </div>
  );
}
