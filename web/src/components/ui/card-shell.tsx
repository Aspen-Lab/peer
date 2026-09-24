import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// The card surface recipe — soft-UI slab with the hover lift. Was pasted
// verbatim across every card component; restyle cards HERE. Link-based
// cards apply cardShell() to their className; block containers can use
// <CardShell>.

export const cardShell = cva(
  // `grain` is a background-image over the surface colour: in a palette with
  // one hue, the grain is what tells the eye this is a material and not a
  // filled rectangle.
  "group block bg-surface grain shadow-card",
  {
    variants: {
      // There is no `corners` variant either, and for the opposite reason to
      // the radius one: the corner detail is not a second frame inside this
      // frame, it IS this frame. `@utility cropmarks` (globals.css) steps
      // `--nm-frame` up to `--nm-frame-hi` for the last 12px into each corner,
      // applied at the call site (`paperShellClass`, feed-tile.tsx), and
      // `.cropmarks:has(> .tile-cover[data-plate="figure"])` drops the top pair
      // where a figure's mat covers the card's own edge. Nothing is added, so
      // there is no choice to expose here.
      //
      // The version to keep refusing is Latent's other one: an L-bracket
      // OUTSIDE the frame with a gap. It states the boundary a second time,
      // four marks per card and forty on a ten-card briefing, and `cropmarks`
      // uses a POSITIVE inset because the tile is `overflow-hidden` and a
      // negative one is clipped. That is the category v0.29.0 emptied.
      // There is no `radius` variant. All three values compiled to 0 — an API
      // that read as a choice and was not one, which is exactly how a round
      // corner gets back in. The frame is `--shadow-card`.
      padding: {
        none: "",
        sm: "p-4",
        md: "p-5",
        lg: "p-7",
        xl: "p-8",
      },
      interactive: {
        // A terminal's surfaces do not move. The lift and the press-below
        // went with the cast shadow (globals.css, "The frame"): what is left
        // is the frame brightening under a pointer and taking the hue while
        // held — a selected row, which is how a TUI says the same thing.
        true: [
          "transition-[box-shadow,background-color] duration-[180ms] ease-expo",
          "hover:shadow-card-hover hover:bg-surface-hover",
          "active:shadow-well-soft",
        ].join(" "),
        false: "",
      },
      entrance: {
        fade: "animate-fade-in-up",
        none: "",
      },
    },
    defaultVariants: {
      padding: "lg",
      interactive: true,
      entrance: "fade",
    },
  },
);

type CardShellProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof cardShell> & {
    as?: "div" | "article" | "section" | "li";
  };

export function CardShell({
  className,
  padding,
  interactive,
  entrance,
  as: Tag = "div",
  ...props
}: CardShellProps) {
  return (
    <Tag
      className={cn(
        cardShell({ padding, interactive, entrance }),
        className,
      )}
      {...props}
    />
  );
}
