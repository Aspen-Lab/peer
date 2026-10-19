import { beforeEach, describe, expect, it, vi } from "vitest";
import { explainOffered, highlightOffered, setExplainOffer, setHighlightOffer, subscribeExplainOffer, subscribeHighlightOffer } from "./explain-offer";

// P9-41 (ruling §1h.66): below 768 px the "Explain this" control is a cell of the thumb bar (`components/shell/thumb-bar.tsx`),
// not a pill over the words. The bar is in the shell's layout and the explain box is in the paper's page, so the box tells the
// bar that a settled selection has a control on offer through this one flag — a module-level store, read by the bar with
// `useSyncExternalStore`. It holds one boolean and nothing about the selection: the action is the page's own `explain`
// (`reader-keys.ts`), the same one the `e` key calls. Plain Node, no DOM: the store is pinned on its own.

beforeEach(() => setExplainOffer(false));

describe("the explain offer — the one flag the explain box hands the thumb bar (P9-41)", () => {
  it("starts with nothing on offer, and says what it was told", () => {
    expect(explainOffered()).toBe(false);

    setExplainOffer(true);
    expect(explainOffered()).toBe(true);

    setExplainOffer(false);
    expect(explainOffered()).toBe(false);
  });

  it("tells a subscriber when it changes, once per change — telling it the same thing again is not a change", () => {
    const listener = vi.fn();
    const stop = subscribeExplainOffer(listener);

    setExplainOffer(true);
    setExplainOffer(true);
    expect(listener).toHaveBeenCalledTimes(1);

    setExplainOffer(false);
    setExplainOffer(false);
    expect(listener).toHaveBeenCalledTimes(2);
    stop();
  });

  it("stops telling a subscriber that has stopped, and tells every other one", () => {
    const first = vi.fn();
    const second = vi.fn();
    const stopFirst = subscribeExplainOffer(first);
    const stopSecond = subscribeExplainOffer(second);

    setExplainOffer(true);
    stopFirst();
    setExplainOffer(false);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
    stopSecond();
  });
});

// P11-13 (rule 3; B P11-03 §2.5; ruling §1h.113 (b) O-5): a second flag, the selection toolbar's, for the thumb bar's Highlight cell. The
// explain box keeps publishing its own; the two are independent, and the first one is exactly as it was.
describe("the highlight offer — the second flag, the selection toolbar's word to the thumb bar (P11-13)", () => {
  beforeEach(() => setHighlightOffer(false));

  it("starts with nothing on offer, and says what it was told", () => {
    expect(highlightOffered()).toBe(false);

    setHighlightOffer(true);
    expect(highlightOffered()).toBe(true);

    setHighlightOffer(false);
    expect(highlightOffered()).toBe(false);
  });

  it("is independent of the explain flag, both ways", () => {
    setHighlightOffer(true);
    expect(explainOffered()).toBe(false);
    setExplainOffer(true);
    setHighlightOffer(false);
    expect(explainOffered()).toBe(true);
    expect(highlightOffered()).toBe(false);
  });

  it("tells its own subscribers once per change, and not the explain flag's", () => {
    const highlight = vi.fn();
    const explain = vi.fn();
    const stopHighlight = subscribeHighlightOffer(highlight);
    const stopExplain = subscribeExplainOffer(explain);

    setHighlightOffer(true);
    setHighlightOffer(true);
    setHighlightOffer(false);
    expect(highlight).toHaveBeenCalledTimes(2);
    expect(explain).not.toHaveBeenCalled();

    setExplainOffer(true);
    expect(highlight).toHaveBeenCalledTimes(2);
    expect(explain).toHaveBeenCalledTimes(1);
    stopHighlight();
    setHighlightOffer(true);
    expect(highlight).toHaveBeenCalledTimes(2);
    stopExplain();
  });
});
