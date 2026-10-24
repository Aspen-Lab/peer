import { afterEach, expect, it, vi } from "vitest";
import { explainOffered, highlightOffered, noteOffered, setNoteOffer, subscribeNoteOffer } from "./explain-offer";
afterEach(() => setNoteOffer(false));
it("publishes a selection note boolean independently and stops subscribers cleanly", () => {
  const before = [explainOffered(), highlightOffered()];
  const listener = vi.fn();
  const stop = subscribeNoteOffer(listener);
  expect(noteOffered()).toBe(false);
  setNoteOffer(true); setNoteOffer(true);
  expect(noteOffered()).toBe(true);
  expect(listener).toHaveBeenCalledTimes(1);
  expect([explainOffered(), highlightOffered()]).toEqual(before);
  stop(); setNoteOffer(false);
  expect(listener).toHaveBeenCalledTimes(1);
});
