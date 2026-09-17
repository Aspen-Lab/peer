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
