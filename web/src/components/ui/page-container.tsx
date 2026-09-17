import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// One page column instead of seven hand-typed max-w values. Vertical
// rhythm stays per-page (pass py-* via className).

export const pageContainer = cva("mx-auto w-full px-6", {
  variants: {
    width: {
      narrow: "max-w-[720px]",   // event detail, not-found
      detail: "max-w-[760px]",   // paper/job detail
      // Paper reading: one column, a two-column spread from xl. The spread's
      // width is set by the measure, not by the window — at 1320 the 7fr
      // column was 681px holding a 462px line, so a fifth of the page was an
      // empty gutter inside the reading column. Sized so the column is the
      // measure plus a rag margin, the two columns fill and the leftover
      // becomes the page's own margins.
      //
      // S20: the 2xl cap grows in lockstep with the reading column
      // (`spread.ts`'s `SPREAD_GRID`, same `560px` base, same
      // `--reading-scale`) so the panel's `1fr` share stays numerically
      // constant at every step — 544px panel + 96px 2xl gap + 560px*scale
      // column = 640 + 560*scale. At scale 1: 640+560=1200, byte-identical
      // to before this item. Keep the two `560`s and this `640` in step —
      // same "two places, one query" risk spread.ts's own header names.
      spread: "max-w-[760px] xl:max-w-[1000px] 2xl:max-w-[calc(640px+560px*var(--reading-scale,1))]",
      content: "max-w-[820px]",  // home column
      wide: "max-w-[920px]",     // saved grid (lg)
      board: "max-w-[1280px]",   // full-bleed feed board
      // Pages that narrow on small screens, widen at lg
      contentResponsive: "max-w-[740px] lg:max-w-[820px]", // profile
      wideResponsive: "max-w-[740px] lg:max-w-[920px]",    // saved
    },
  },
  defaultVariants: {
    width: "content",
  },
});

type PageContainerProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof pageContainer> & {
    as?: "div" | "article" | "main" | "section";
  };

export function PageContainer({
  className,
  width,
  as: Tag = "article",
  ...props
}: PageContainerProps) {
  return (
    <Tag className={cn(pageContainer({ width }), className)} {...props} />
  );
}
