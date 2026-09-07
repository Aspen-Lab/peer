// The arithmetic behind swiping a card: which axis a drag belongs to, how the
// card should resist past the threshold, and whether releasing commits.
//
// Kept pure so it is testable without a DOM. The component owns pointer
// events and animation; this owns the decisions.

export type SwipeDirection = "left" | "right";
export type Axis = "x" | "y";

/** Movement below this, in either axis, is a tap — not a drag. */
export const SLOP_PX = 10;
/** Past this the card commits on release regardless of velocity. */
export const COMMIT_PX = 96;
/** A fast flick commits before the distance threshold. px per ms. */
export const COMMIT_VELOCITY = 0.5;
/** Beyond the threshold the card follows the finger at this fraction. */
export const RESISTANCE = 0.35;

/**
 * Lock the gesture to an axis once movement clears the slop. Null while it
 * is still ambiguous. A drag that is more vertical than horizontal belongs to
 * the scroller — `touch-action: pan-y` will already be handling it — and must
 * never move the card.
 */
export function lockAxis(dx: number, dy: number, slop = SLOP_PX): Axis | null {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (ax < slop && ay < slop) return null;
  return ax > ay ? "x" : "y";
}

/** Card offset for a raw horizontal displacement: linear to the threshold,
 *  rubber-banded past it. Sign is preserved. */
export function resist(dx: number, threshold = COMMIT_PX): number {
  const sign = dx < 0 ? -1 : 1;
  const mag = Math.abs(dx);
  if (mag <= threshold) return dx;
  return sign * (threshold + (mag - threshold) * RESISTANCE);
}

/** 0..1 progress toward committing, for the reveal layer's opacity. */
export function progress(dx: number, threshold = COMMIT_PX): number {
  return Math.min(1, Math.abs(dx) / threshold);
}

/**
 * On release: commit in the direction of travel if the finger went far
 * enough, or moved fast enough in that same direction. A fast flick back
 * toward the origin does not commit.
 */
export function shouldCommit(
  dx: number,
  velocityX: number,
  threshold = COMMIT_PX,
  velocity = COMMIT_VELOCITY,
): SwipeDirection | null {
  const dir: SwipeDirection = dx < 0 ? "left" : "right";
  if (Math.abs(dx) >= threshold) return dir;
  const sameWay = Math.sign(velocityX) === Math.sign(dx) && dx !== 0;
  if (sameWay && Math.abs(velocityX) >= velocity && Math.abs(dx) >= SLOP_PX) return dir;
  return null;
}
