import { afterEach, describe, expect, it, vi } from "vitest";
import { PAPER_BODY_ID, measureBodyColumn } from "./paper-body";

// P3-02b (ruling §1h.3): the "Explain this?" box stands to the right of the text
// column on a spread, and the page tells it where that column ends — the right
// edge of `#paper-body`, read fresh each time it is asked (a scroll or a resize
// never leaves it stale). No DOM in this project's Vitest: the document is a
// stand-in that hands back one element's rectangle.

afterEach(() => vi.unstubAllGlobals());

describe("measureBodyColumn", () => {
  it("is the right edge of #paper-body, read each time it is asked", () => {
    let right = 1196;
    const getElementById = vi.fn((id: string) => (id === PAPER_BODY_ID ? { getBoundingClientRect: () => ({ right }) } : null));
    vi.stubGlobal("document", { getElementById });

    expect(measureBodyColumn()).toEqual({ right: 1196 });
    right = 1100;
    expect(measureBodyColumn()).toEqual({ right: 1100 });
    expect(getElementById).toHaveBeenCalledWith("paper-body");
  });

  it("is null when the body is not on the page", () => {
    vi.stubGlobal("document", { getElementById: () => null });

    expect(measureBodyColumn()).toBeNull();
  });

  it("is null where there is no document to measure", () => {
    vi.stubGlobal("document", undefined);

    expect(measureBodyColumn()).toBeNull();
  });
});
