"use client";

// P11-14 rule 2 (B P11-03 §3.2; ruling §1h.113 (d)): the one frame every card in the margin stands in.
//
// A card is an `id`, a `kind` (`sticky | notes | explain | figure | highlight`), a title, an optional headline (the quote head a sticky
// shows beside its title), a header 40 px tall with the title, the headline and the X, and a body. One card of the stack is in front
// and whole; every other shows its header alone; a press on a header raises it (`useWindows.raise`), the X closes it, opening one
// raises it. The cards stay `position: fixed`, mounted at the page's top level, outside the Fit zoom's container, placed in the
// window's own pixels — a `zoom` ancestor would scale them — and need only the margin's left and width for their place across the
// page (`useMarginRect()`, `lib/reader/margin.ts`); the stack (`lib/reader/windows.ts`) gives each its `top`, `height` and `z`.
//
// Where no shell has registered a margin (below 1024 css px, a page without the shell) the card keeps the right edge, 360 px wide at
// most, as the stickies always stood. The X is a prop, not a rule (O-7): the explain card keeps its big highlighted X at the
// top-left (`closeAt="start"`), the sticky and the figure theirs at the top-right (`closeAt="end"`).
//
// `MarginCardShell` is hook-free (the card's frame is a prop), so a card's view can be tested as markup and as an element tree;
// `MarginCard` is the shell with the margin's rect read in. Each kind keeps its own body component and hands it in as `children`;
// a kind with a header of its own (the notes window's Export) hands that in as `header`.

import type { CSSProperties, HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useMarginRect, type MarginRect } from "@/lib/reader/margin";
import type { WindowKind } from "@/lib/reader/windows";

/** The margin's left and width: all a card needs of it across the page. */
export type MarginFrame = Pick<MarginRect, "left" | "width">;

/** A card's place across the page: the margin's left and width, else the right edge, 360 px wide at most. */
export function marginCardFrame(frame: MarginFrame | null): CSSProperties {
  return frame ? { left: frame.left, width: frame.width } : { right: 0, width: "min(360px, 100vw)" };
}

type Attrs = Record<string, string | number | undefined>;

export interface MarginCardHeaderProps {
  title: string;
  /** What follows the title, quiet and on one line: a sticky's quote head, the explain card's passage when it is behind. */
  headline?: string;
  /** The X at the end (a sticky, a figure) or at the start, big and highlighted (the explain card, O-7). */
  closeAt: "start" | "end";
  closeLabel: string;
  closeTitle?: string;
  onRaise: () => void;
  onClose: () => void;
  /** Attributes the kind needs on its header button (`data-sticky-header`) and on its X (`data-explain-close`). */
  headerAttrs?: Attrs;
  closeAttrs?: Attrs;
}

/** The 40 px header: a button over the title and the headline (a press raises the card) and the X (which closes it, and raises nothing). */
export function MarginCardHeader({ title, headline, closeAt, closeLabel, closeTitle, onRaise, onClose, headerAttrs, closeAttrs }: MarginCardHeaderProps) {
  const close = (
    <button
      type="button"
      aria-label={closeLabel}
      title={closeTitle}
      onClick={(event) => {
        event.stopPropagation();
        onClose();
      }}
      {...closeAttrs}
      className={
        closeAt === "start"
          ? "ml-0.5 inline-flex h-9 w-9 shrink-0 items-center justify-center self-center bg-accent text-bg transition-colors hover:bg-accent/90"
          : "grid w-10 shrink-0 place-items-center font-mono text-title leading-none text-text-muted transition-colors hover:bg-surface-hover hover:text-heading"
      }
    >
      {closeAt === "start" ? (
        <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      ) : (
        "×"
      )}
    </button>
  );
  return (
    <div className="flex h-10 shrink-0 items-stretch">
      {closeAt === "start" && close}
      <button
        type="button"
        data-margin-header=""
        onClick={onRaise}
        {...headerAttrs}
        className="flex min-w-0 flex-1 items-center gap-2 px-3 text-left transition-colors hover:bg-surface-hover"
      >
        <span className="eyebrow shrink-0 text-heading">{title}</span>
        {headline && <span className="min-w-0 truncate font-reading text-body-sm italic text-text-muted">{headline}</span>}
      </button>
      {closeAt === "end" && close}
    </div>
  );
}

export interface MarginCardShellProps extends Omit<HTMLAttributes<HTMLElement>, "id" | "title" | "children" | "style"> {
  /** The card's id in the stack (`useWindows`). */
  id: string;
  kind: WindowKind;
  /** In front and whole; else only its header shows. */
  front: boolean;
  /** The stack's row for this card (`stackRows`): its top across the screen, its z, and its height — or, for a card that is as tall as
   *  its content up to the room, a `maxHeight` instead. */
  top: number;
  height?: number;
  maxHeight?: number;
  z: number;
  /** The margin's left and width; null where there is none. */
  frame: MarginFrame | null;
  /** The header row, for a kind whose header is not the standard one; else `MarginCardHeader` from the props below. */
  header?: ReactNode;
  /** Keep the body mounted while the card is behind (the notes window's editor holds unsaved typing); it hides itself. */
  keepMounted?: boolean;
  title?: string;
  headline?: string;
  closeAt?: "start" | "end";
  closeLabel?: string;
  closeTitle?: string;
  onRaise?: () => void;
  onClose?: () => void;
  headerAttrs?: Attrs;
  closeAttrs?: Attrs;
  children?: ReactNode;
}

export function MarginCardShell({
  id,
  kind,
  front,
  top,
  height,
  maxHeight,
  z,
  frame,
  header,
  keepMounted,
  title = "",
  headline,
  closeAt = "end",
  closeLabel = "Close",
  closeTitle,
  onRaise,
  onClose,
  headerAttrs,
  closeAttrs,
  className,
  children,
  ...root
}: MarginCardShellProps) {
  const style: CSSProperties = {
    ...marginCardFrame(frame),
    top,
    zIndex: z,
    ...(height !== undefined ? { height } : {}),
    ...(maxHeight !== undefined ? { maxHeight } : {}),
  };
  return (
    <section
      {...root}
      data-margin-card={kind}
      data-margin-id={id}
      style={style}
      className={cn("fixed flex flex-col overflow-hidden border border-border-strong bg-surface shadow-card-hover", className)}
    >
      {header ?? (
        <MarginCardHeader
          title={title}
          headline={headline}
          closeAt={closeAt}
          closeLabel={closeLabel}
          closeTitle={closeTitle}
          onRaise={onRaise ?? (() => {})}
          onClose={onClose ?? (() => {})}
          headerAttrs={headerAttrs}
          closeAttrs={closeAttrs}
        />
      )}
      {(front || keepMounted) && children}
    </section>
  );
}

/** A card of the margin: the shell, with the margin's rect read in (`useMarginRect`). */
export function MarginCard(props: Omit<MarginCardShellProps, "frame">) {
  const rect = useMarginRect();
  return <MarginCardShell {...props} frame={rect} />;
}
