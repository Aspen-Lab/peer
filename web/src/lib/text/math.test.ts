import { describe, expect, it } from "vitest";
import { blockMarker, inlineMath, MATH_CLOSE, MATH_OPEN, parseBlockMarker, plainMath, splitMath } from "./math";

describe("marks", () => {
  it("are the mathematical white brackets, printable and rare", () => {
    expect(MATH_OPEN.codePointAt(0)).toBe(0x27e6);
    expect(MATH_CLOSE.codePointAt(0)).toBe(0x27e7);
  });

  it("wrap inline TeX and refuse the one character that would end it early", () => {
    expect(inlineMath(" h_{t} ")).toBe(`${MATH_OPEN}h_{t}${MATH_CLOSE}`);
    expect(inlineMath(`a${MATH_CLOSE}b`)).toBe(`${MATH_OPEN}ab${MATH_CLOSE}`);
    expect(inlineMath("   ")).toBe("");
  });

  it("name a lifted equation by index, and read the name back", () => {
    expect(parseBlockMarker(blockMarker(3))).toBe(3);
    expect(parseBlockMarker(`  ${blockMarker(0)} `)).toBe(0);
    expect(parseBlockMarker("A sentence.")).toBeNull();
    expect(parseBlockMarker(`${MATH_OPEN}x^2${MATH_CLOSE}`)).toBeNull();
  });
});

describe("splitMath", () => {
  it("returns prose untouched as one run", () => {
    expect(splitMath("No maths here.")).toEqual([{ kind: "text", value: "No maths here." }]);
  });

  it("separates prose and formulas in order", () => {
    const text = `where ${inlineMath("d_{k}")} is the key size and ${inlineMath("\\sqrt{d_{k}}")} scales it.`;
    expect(splitMath(text)).toEqual([
      { kind: "text", value: "where " },
      { kind: "math", value: "d_{k}" },
      { kind: "text", value: " is the key size and " },
      { kind: "math", value: "\\sqrt{d_{k}}" },
      { kind: "text", value: " scales it." },
    ]);
  });

  it("drops a display marker that was never lifted, and keeps an unclosed bracket as text", () => {
    expect(splitMath(`see ${blockMarker(2)} now`)).toEqual([
      { kind: "text", value: "see " },
      { kind: "text", value: " now" },
    ]);
    // Nothing is thrown away: an unclosed bracket stays in the prose as it is.
    expect(splitMath(`odd ${MATH_OPEN}x`)).toEqual([{ kind: "text", value: `odd ${MATH_OPEN}x` }]);
  });

  it("flattens to plain TeX for places that cannot draw", () => {
    expect(plainMath(`with ${inlineMath("h_{t}")} held`)).toBe("with h_{t} held");
  });

  it("renders conventional TeX delimiters found in publisher text", () => {
    expect(splitMath(String.raw`Let $x$ and \(\frac{a}{b}\) be given.`)).toEqual([
      { kind: "text", value: "Let " }, { kind: "math", value: "x" },
      { kind: "text", value: " and " }, { kind: "math", value: String.raw`\frac{a}{b}` },
      { kind: "text", value: " be given." },
    ]);
    expect(splitMath(String.raw`Display \[x^2\] or $$y_1$$.`)).toEqual([
      { kind: "text", value: "Display " }, { kind: "math", value: "x^2" },
      { kind: "text", value: " or " }, { kind: "math", value: "y_1" }, { kind: "text", value: "." },
    ]);
  });

  it("leaves prices and unmatched delimiters as prose", () => {
    expect(splitMath("The cost rose from $5 to $10.")).toEqual([{ kind: "text", value: "The cost rose from $5 to $10." }]);
    expect(splitMath(String.raw`An unmatched \(x is text.`)).toEqual([{ kind: "text", value: String.raw`An unmatched \(x is text.` }]);
  });
});
