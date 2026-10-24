import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// P11-02 (B P11-02): the owner's "Maximum update depth exceeded" at the explain box's after-every-commit layout effect came from a
// build that still had `setViewport` in that effect (P9-50's explain-box.tsx, before P10-08). React throws at the 51st nested commit,
// and an effect with NO dependency list that writes state runs after every commit — so the class of the bug is a source shape, and a
// source shape can be pinned: in `explain-box.tsx`, an effect without a dependency list writes state only through `settleHeight`
// (P10-08's convergence guard), and never writes the viewport. A rewrite of the box (the margin pane, P11-01) must keep that, or move
// the height to CSS and have no such effect at all. Every fixture below is invented code.

/** The text between the parentheses of each `useLayoutEffect(` / `useEffect(` call in `source`, with whether it has a dependency list. */
export function effectsOf(source: string): Array<{ hook: string; body: string; deps: boolean }> {
  const out: Array<{ hook: string; body: string; deps: boolean }> = [];
  const call = /\b(useLayoutEffect|useEffect)\(/g;
  for (let match = call.exec(source); match; match = call.exec(source)) {
    let depth = 1;
    let i = match.index + match[0].length;
    for (; i < source.length && depth > 0; i += 1) {
      if (source[i] === "(") depth += 1;
      else if (source[i] === ")") depth -= 1;
    }
    const body = source.slice(match.index + match[0].length, i - 1);
    // Drop trailing comments / whitespace; a call whose last argument is the arrow's block has no list (`}`), one with a list ends `]`.
    const tail = body.replace(/\/\/[^\n]*\n?/g, "").trimEnd().replace(/,$/, "").trimEnd();
    out.push({ hook: match[1], body, deps: tail.endsWith("]") });
  }
  return out;
}

/** What is wrong with the effects that run after every commit: a state write that is not `setCardHeight` behind `settleHeight`. */
export function everyCommitFaults(source: string): string[] {
  const faults: string[] = [];
  for (const effect of effectsOf(source)) {
    if (effect.deps) continue;
    const writes = [...effect.body.matchAll(/\b(set[A-Z]\w*)\(/g)].map((m) => m[1]);
    for (const write of new Set(writes)) {
      if (write === "setCardHeight" && /\bsettleHeight\(/.test(effect.body)) continue;
      faults.push(`${effect.hook} with no dependency list calls ${write}`);
    }
  }
  return faults;
}

describe("explain-box.tsx — no effect that runs after every commit can write state that layout reads back (P11-02; P10-08; §1h.80)", () => {
  // The stale build's effect (P9-50, 1044 in the owner's overlay), reduced and invented in its names only where they are not code.
  const STALE = `
    useLayoutEffect(() => {
      if (docked || target !== null) {
        const size = currentViewport();
        setViewport((previous) => (sameViewport(previous, size) ? previous : size));
      }
      const card = cardRef.current;
      if (!docked || !card) return;
      const height = card.scrollHeight + (card.offsetHeight - card.clientHeight);
      setCardHeight((previous) => (previous !== null && Math.abs(previous - height) < 1 ? previous : height));
    });`;
  const GUARDED = `
    useLayoutEffect(() => {
      const card = cardRef.current;
      if (!docked || !card) return;
      const height = card.scrollHeight + (card.offsetHeight - card.clientHeight);
      const write = settleHeight(heightGuard.current, cardHeight, height, readerKey);
      if (write === null) return;
      setCardHeight(write);
    });
    useEffect(() => {
      const size = currentViewport();
      setViewport((previous) => (sameViewport(previous, size) ? previous : size));
    }, [placed, following]);`;

  it("sees an effect with no dependency list and one with a list", () => {
    expect(effectsOf(STALE).map((e) => e.deps)).toEqual([false]);
    expect(effectsOf(GUARDED).map((e) => e.deps)).toEqual([false, true]);
    expect(effectsOf("useEffect(() => { go(); }, [a, (b)]);").map((e) => e.deps)).toEqual([true]);
  });

  it("the stale effect is a fault: it writes the viewport after every commit, and its height write is not behind settleHeight", () => {
    expect(everyCommitFaults(STALE)).toEqual([
      "useLayoutEffect with no dependency list calls setViewport",
      "useLayoutEffect with no dependency list calls setCardHeight",
    ]);
  });

  it("the guarded effect is not: setCardHeight behind settleHeight, and the viewport written only in an effect with a list", () => {
    expect(everyCommitFaults(GUARDED)).toEqual([]);
  });

  it("the real file: red on a tree that still has the stale effect (P9-50 .. before P10-08), green on the head", () => {
    const source = readFileSync(join(__dirname, "explain-box.tsx"), "utf8");
    expect(everyCommitFaults(source)).toEqual([]);
  });

  it("can fail for the reason it tests: the real file's text, weakened the way a rewrite might, is a fault", () => {
    const source = readFileSync(join(__dirname, "explain-box.tsx"), "utf8");
    // 1. the height written without the guard
    const unguarded = source.replace("setCardHeight(write);", "setCardHeight(height);").replace(/settleHeight\(heightGuard\.current, cardHeight, height, readerKey\)/, "height");
    expect(unguarded).not.toBe(source);
    expect(everyCommitFaults(unguarded)).toContain("useLayoutEffect with no dependency list calls setCardHeight");
    // 2. the viewport read back into the effect that has no list
    const reread = source.replace("const card = cardRef.current;\n    if (!docked || !card) return;", "setViewport(currentViewport());\n    const card = cardRef.current;\n    if (!docked || !card) return;");
    expect(reread).not.toBe(source);
    expect(everyCommitFaults(reread)).toContain("useLayoutEffect with no dependency list calls setViewport");
  });
});
