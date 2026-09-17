import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// The app's pill grammar, in one place. Every interactive pill — primary
// CTAs, soft action pills, quiet icon buttons — derives from these variants;
// don't hand-roll `rounded-full bg-… h-…` button recipes in pages anymore.
// For <a>/<Link> styled as buttons, use buttonVariants() on the className.

export const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-1.5 rounded-full font-medium",
    "transition-[color,background-color,box-shadow,transform] duration-[180ms] ease-expo",
    "active:scale-[0.94] disabled:opacity-55 disabled:cursor-wait",
  ].join(" "),
  {
    variants: {
      tone: {
        primary: "bg-accent text-bg shadow-card hover:bg-accent/90",
        soft: "bg-bg-secondary/60 shadow-card text-text-muted hover:text-heading hover:bg-surface-hover",
        surface:
          "bg-surface shadow-card text-text-muted hover:text-heading hover:shadow-card-hover hover:bg-surface-hover",
        accentSoft: "bg-accent-dim text-accent shadow-card hover:bg-accent/15",
        ghost: "text-text-faint hover:text-heading hover:bg-bg-secondary/80",
        dangerSoft:
          "bg-bg-secondary/60 shadow-card text-text-muted hover:text-red hover:bg-red/5",
      },
      size: {
        sm: "h-8 px-3 text-meta",
        md: "h-9 px-4 text-meta",
        lg: "h-10 px-5 text-body",
      },
    },
    defaultVariants: {
      tone: "soft",
      size: "md",
    },
  },
);

export const iconButtonVariants = cva(
  [
    "inline-flex items-center justify-center rounded-full shrink-0",
    "transition-[color,background-color,box-shadow,transform] duration-[180ms] ease-expo",
    "active:scale-90 disabled:opacity-50 disabled:cursor-wait",
  ].join(" "),
  {
    variants: {
      tone: {
        ghost: "text-text-faint hover:text-text hover:bg-bg-secondary/80",
        soft: "bg-bg-secondary/60 shadow-card text-text-muted hover:text-heading hover:bg-surface-hover",
      },
      size: {
        sm: "h-6 w-6",
        md: "h-7 w-7",
        lg: "h-8 w-8",
      },
    },
    defaultVariants: {
      tone: "ghost",
      size: "md",
    },
  },
);

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>;

export function Button({ className, tone, size, type, ...props }: ButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(buttonVariants({ tone, size }), className)}
      {...props}
    />
  );
}

type IconButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof iconButtonVariants> & {
    /** Icon-only buttons must say what they do. */
    "aria-label": string;
  };

export function IconButton({
  className,
  tone,
  size,
  type,
  ...props
}: IconButtonProps) {
  return (
    <button
      type={type ?? "button"}
      className={cn(iconButtonVariants({ tone, size }), className)}
      {...props}
    />
  );
}
