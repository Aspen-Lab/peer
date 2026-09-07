// Arithmetic for the keyboard's card focus on the briefing.
//
// The keyboard layer keeps the focused index in a ref and paints the ring
// through a DOM attribute, so the only logic worth testing is this: where a
// step lands. Nothing is focused until the first press; from nothing, either
// direction lands on the first card. Steps clamp — no wrap, because a wrap at
// the bottom of a masonry teleports the ring to the top of another column.

export const NONE = -1;

export function stepIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return NONE;
  if (current === NONE) return 0;
  const next = current + delta;
  if (next < 0) return 0;
  if (next >= length) return length - 1;
  return next;
}

/**
 * After a card leaves the list (dismissed), the ring stays in place and the
 * next card slides under it — unless it was the last card, in which case the
 * ring steps back one.
 */
export function indexAfterRemoval(current: number, lengthAfter: number): number {
  if (current === NONE || lengthAfter <= 0) return NONE;
  return Math.min(current, lengthAfter - 1);
}
