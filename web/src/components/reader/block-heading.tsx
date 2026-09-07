// The five block headings, from one table. Sentence case, 22px display
// serif, never doubled: a block renders its heading only when it has
// something under it.

import type { ReadingBlock } from "@/lib/papers/reading";
import { BLOCK_HEADING } from "./copy";

export type BlockName = Exclude<ReadingBlock, "skim">;

export function BlockHeading({ block }: { block: BlockName }) {
  return (
    <h2 className="font-display font-medium text-heading text-[22px] leading-[1.25] mt-12 mb-3">
      {BLOCK_HEADING[block]}
    </h2>
  );
}
