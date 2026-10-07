import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/cn";

// One page column and one page rhythm. Override the rhythm with `rhythm=`,
// never with a raw `py-*` — seven different vertical recipes across fifteen
// route files is what the old "rhythm stays per-page" comment produced, and
// the one value Latent actually beats time on (96px) survived only on the
// four pages nobody designs: 500, 404, the auth error, and a footer.

export const pageContainer = cva("mx-auto w-full px-6", {
  variants: {
    width: {
      // Paper reading: one column, a two-column spread from xl. The spread is
      // a narrow fixed panel beside a wide reading column (`spread.ts`), and
      // the cap decides how wide that column gets: 1072px at xl leaves it
      // 640px (after 48px of padding, a 64px gap and the 320px panel), and
      // from 2xl the pair below leaves it 680px.
      // Round 7 (Ruling 19 / A7-02): the reading spread's caps grow with
      // `--reading-scale` so the column grows as the reader's font steps up.
      // 2xl is a fixed-plus-flexible split (48 padding + 360 panel + 96 gap
      // + 680*scale column = 504 + 680*scale; at scale 1 that is 1184). xl's
      // panel is fixed too, so the whole cap's growth lands in the column.
      // Keep the `504`, the `680` and the `1072` in step with `spread.ts`.
      spread:
        "max-w-[760px] xl:max-w-[calc(1072px*var(--reading-scale,1))] 2xl:max-w-[calc(504px+680px*var(--reading-scale,1))]",
      content: "max-w-[820px]",  // home column, /privacy, /saved
      // The feed board. It held 1280 at every width above 1280, so a 1920
      // screen spent a third of itself on margins and still dealt three
      // cards. The card is what should stay constant — about 400px, the
      // width a title and three lines of reason want — so the board widens
      // and the columns multiply instead. Four cards from 1700, five from
      // 2200; below that nothing moves.
      board: "max-w-[1280px] 3xl:max-w-[1760px] 4xl:max-w-[2200px]",
      // Narrows on small screens, widens at lg — /profile.
      contentResponsive: "max-w-[740px] lg:max-w-[820px]",
      // A page laid out as a rail and a column (`PageSpread`): one column at
      // 820 until xl, then wide enough that the column beside a 240px rail is
      // still worth two cards. Only the built-in screens — a custom one loses
      // to them (see `@theme` in globals.css).
      shelf: "max-w-[820px] xl:max-w-[1180px] 2xl:max-w-[1360px]",
    },
    rhythm: {
      page: "py-12 md:py-16 lg:py-24",  // 48 → 64 → 96, the section heartbeat
      reader: "py-8 sm:py-12 xl:pt-4",  // the spread keeps its own top
      none: "",
    },
  },
  defaultVariants: {
    width: "content",
    rhythm: "page",
  },
});

type PageContainerProps = React.HTMLAttributes<HTMLElement> &
  VariantProps<typeof pageContainer> & {
    as?: "div" | "article" | "main" | "section";
  };

export function PageContainer({
  className,
  width,
  rhythm,
  as: Tag = "article",
  ...props
}: PageContainerProps) {
  return <Tag className={cn(pageContainer({ width, rhythm }), className)} {...props} />;
}
