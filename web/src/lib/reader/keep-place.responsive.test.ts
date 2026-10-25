import { describe, expect, it } from "vitest";
import { keepPlace, type KeepPlaceEnv } from "./keep-place";

// P12-15 / B13: CSS changes before React measures the shell. The correction's
// clamp scroll is delivered BEFORE the final observer, not after one atomic reflow.
function measuredSequence(initial = 524) {
  let y = initial, width = 646, absoluteTop = 603.9375, max = 822, clock = 0;
  let scroll = () => {}, box = () => {}, resize = () => {}, input = () => {};
  const calls: number[] = [];
  const paragraph = (id: string) => ({ top: absoluteTop + (id.endsWith("p4") ? 100 : 0) - y, height: 86.625 });
  const env = {
    view: () => ({ scrollY: y, viewportHeight: 900, scrollHeight: max + 900,
      top: { id: `paper-section-0-p${absoluteTop - y + 86.625 > 56 ? 3 : 4}`,
        ...paragraph(`p${absoluteTop - y + 86.625 > 56 ? 3 : 4}`) } }),
    paragraph,
    key: () => String(width), scrollY: () => y, now: () => clock,
    scrollBy: (dy: number) => { calls.push(dy); y = Math.max(0, Math.min(max, y + dy)); },
    onScroll: (run: () => void) => { scroll = run; return () => { scroll = () => {}; }; },
    observe: (run: () => void) => { box = run; return () => { box = () => {}; }; },
    onResponsive: (run: () => void) => { resize = run; return () => { resize = () => {}; }; },
    onIntervention: (run: () => void) => { input = run; return () => { input = () => {}; }; },
  } satisfies KeepPlaceEnv & { onResponsive(run: () => void): () => void; onIntervention(run: () => void): () => void };
  return { env, calls, get y() { return y; },
    transient() { width = 125; absoluteTop = 1402.09375; max = 2461; resize(); box(); },
    final() { width = 476; absoluteTop = 603.9375; max = 749; y = Math.min(y, max); scroll(); box(); },
    readerScroll(next: number) { input(); y = next; scroll(); },
    notify() { box(); },
    advance(ms: number) { clock += ms; },
    heightOnly() { absoluteTop += 100; box(); },
  };
}

describe("P12-15 durable responsive transaction", () => {
  it("retains the original legal524 scroll through125px/correction1322/clamp749/scroll-before-observer", () => {
    const page = measuredSequence();
    const stop = keepPlace(page.env);
    page.transient();
    expect(page.y).toBeCloseTo(1322.15625);
    page.final();
    expect(page.y).toBeCloseTo(524);
    expect(page.calls).toHaveLength(2);
    stop();
  });

  it("respects a real reader intervention during the same transaction", () => {
    const page = measuredSequence();
    const stop = keepPlace(page.env);
    page.transient(); page.final();
    page.readerScroll(659); page.notify();
    expect(page.y).toBe(659);
    stop();
  });
  it.each([0, 822])("leaves true edge%s to the native clamp", (start) => {
    const page = measuredSequence(start); const stop = keepPlace(page.env);
    page.transient(); page.final();
    expect(page.y).toBe(start === 0 ? 0 : 749); expect(page.calls).toHaveLength(0); stop();
  });
  it("ends the responsive hold and performs no permanent/every-render correction", () => {
    const page = measuredSequence(); const stop = keepPlace(page.env);
    page.transient(); page.final(); page.advance(700);
    const calls = page.calls.length; page.heightOnly(); page.notify();
    expect(page.calls).toHaveLength(calls); stop();
  });
});
