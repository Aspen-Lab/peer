// The five block headings, from one table. A band: the name in mono on its
// own rule, running the width of the column.
//
// They were 22px display serif. The serif on this page is the paper's voice —
// its title, its claim, its own sentences — and these are Peer's names for
// what it did with the paper, so they belong to the machine and are set in
// the machine's face. The landmark down the column is now the rule, which is
// the width of the column, rather than a larger line of the same colour.

import { Band } from "@/components/ui/band";
import type { ReadingBlock } from "@/lib/papers/reading";
import { BLOCK_HEADING } from "./copy";

export type BlockName = Exclude<ReadingBlock, "skim">;

export function BlockHeading({ block }: { block: BlockName }) {
  return <Band label={BLOCK_HEADING[block]} className="mt-12 mb-4" />;
}
