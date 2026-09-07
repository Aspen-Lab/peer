// Where a paper sits in the briefing, for the reading page's rail and Next
// row and for j/k.
//
// The order is the feed store's `papers` — already in memory, so moving
// between papers costs no request. A paper that is not in it was opened from
// a link outside today's briefing: there is no "3 of 10" to show and nothing
// for j/k to step to, and the callers read that from `index === NONE` rather
// than from a flag.

import { NONE } from "@/lib/navigation/card-focus";

export interface PaperNav {
  /** Position in the briefing, or `NONE` for a deep link. */
  index: number;
  total: number;
  prevId: string | null;
  nextId: string | null;
}

export function paperNav(ids: readonly string[], currentId: string): PaperNav {
  const index = ids.indexOf(currentId);
  if (index === NONE) {
    return { index: NONE, total: ids.length, prevId: null, nextId: null };
  }
  return {
    index,
    total: ids.length,
    prevId: index > 0 ? ids[index - 1] : null,
    nextId: index < ids.length - 1 ? ids[index + 1] : null,
  };
}
