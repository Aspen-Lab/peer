import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import katex from "katex";
import { Equation, MathText, isSubstantiveEquation, normalizeEquationTex } from "./math";

const realWorld = [
  String.raw`2\times\mbox{CP}`,
  String.raw`8\text{\times}{10}^{-5}\text{\,}\mathrm{,}`,
  String.raw`\bm{B}:{\color[rgb]{0.72,0,0}\mathtt{(B,L,N)}}`,
];

describe("math rendering", () => {
  it("distinguishes a substantive equation from a symbol or a short value", () => {
    expect(isSubstantiveEquation(String.raw`110\times 2\times 14\times 3=9{,}240`)).toBe(true);
    expect(isSubstantiveEquation(String.raw`\frac{a}{b}`)).toBe(true);
    expect(isSubstantiveEquation(String.raw`\kappa`)).toBe(false);
    expect(isSubstantiveEquation("=-1")).toBe(false);
  });
  it("renders formula markup on the first render for common source delimiters", () => {
    const html = renderToStaticMarkup(<MathText text={String.raw`For $x$ and \(\frac{a}{b}\), read on.`} />);
    expect(html.match(/class="katex"/g)).toHaveLength(2);
    expect(html).not.toContain('<code');
  });
  it("renders the source's full equation without its delimiters", () => {
    const html = renderToStaticMarkup(<Equation equation={{ latex: String.raw`$$\frac{1}{2}$$`, after: 0 }} />);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('class="katex-error"');
  });
  it("supports standard LaTeXML math found in real papers", () => {
    for (const tex of realWorld) expect(() => katex.renderToString(normalizeEquationTex(tex), { throwOnError: true })).not.toThrow();
    expect(normalizeEquationTex(realWorld[2])).toContain(String.raw`\color{#b80000}`);
  });
});
