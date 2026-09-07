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
      radius: {
        xl: "rounded-xl",
        "2xl": "rounded-2xl",
        "3xl": "rounded-3xl",
      },
      padding: {
        none: "",
        sm: "p-4",
        md: "p-5",
        lg: "p-7",
        xl: "p-8",
      },
      interactive: {
        true: [
          "transition-[box-shadow,transform] duration-200 ease-out",
          "hover:shadow-card-hover hover:-translate-y-[2px]",
          // Pressed, it goes below where it started: a thing under a finger
          // does not merely stop rising.
          "active:translate-y-[1px] active:shadow-well-soft active:duration-75",
        ].join(" "),
        false: "",
      },
      entrance: {
        fade: "animate-fade-in-up",
        none: "",
      },
    },
    defaultVariants: {
      radius: "2xl",
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
  radius,
  padding,
  interactive,
  entrance,
  as: Tag = "div",
  ...props
}: CardShellProps) {
  return (
    <Tag
      className={cn(
        cardShell({ radius, padding, interactive, entrance }),
        className,
      )}
      {...props}
    />
  );
}
