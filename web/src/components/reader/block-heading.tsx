// The five block headings, from one table. Sentence case, display serif,
// never doubled: a block renders its heading only when it has something
// under it.
//
// Each carries the rule above it, so the reading column reads as bands with
// edges rather than as one column of text with larger lines in it. The rule
// is the border hairline — a boundary, not a divider you notice.

import type { ReadingBlock } from "@/lib/papers/reading";
import { BLOCK_HEADING } from "./copy";

export type BlockName = Exclude<ReadingBlock, "skim">;

export function BlockHeading({ block }: { block: BlockName }) {
  return (
    <h2 className="font-display font-medium text-heading text-display-xs leading-[1.25] border-t border-border pt-6 mt-12 mb-3">
      {BLOCK_HEADING[block]}
    </h2>
  );
}
