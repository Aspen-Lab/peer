import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { firstKeyword, paperKeywords } from "./keyword-emphasis";
import { MathText } from "./math";
import { splitMath } from "@/lib/text/math";

describe("paper keyword emphasis", () => {
  it("uses supplied topics and meaningful pairs from the paper's title", () => {
    const terms = paperKeywords("ZENO: Nonlinear filtering with Zakai Equation Neural Operators", ["neuroscience", "Neuroscience", "data"]);
    expect(terms).toContain("neuroscience");
    expect(terms).toContain("Nonlinear filtering");
    expect(terms).toContain("Zakai Equation");
    expect(terms).toContain("Neural Operators");
    expect(terms.filter((t) => t.toLowerCase() === "neuroscience")).toHaveLength(1);
    expect(terms).not.toContain("data");
  });

  it("emphasizes at most one whole phrase, ignoring TeX and partial words", () => {
    const runs = splitMath("⟦neural operators⟧ Neurally different. Neural operators help; neural operators generalize.");
    const hit = firstKeyword(runs, ["neural operators", "neural"]);
    expect(hit).toEqual({ run: 1, start: 21, end: 37 });
    const html = renderToStaticMarkup(<MathText text="Neural operators help; neural operators generalize." keywords={["neural operators"]} />);
    expect(html.match(/<strong/g)).toHaveLength(1);
    expect(html).toContain('<strong class="reader-keyword">Neural operators</strong>');
    expect(renderToStaticMarkup(<MathText text="Neurally different." keywords={["neural"]} />)).not.toContain("<strong");
  });

  it("escapes punctuation and preserves the paper's original text", () => {
    const html = renderToStaticMarkup(<MathText text="Use C++ language for models." keywords={["C++ language"]} />);
    expect(html).toContain('<strong class="reader-keyword">C++ language</strong>');
  });
});

describe("citation emphasis", () => {
  it("highlights author–year references alongside one keyword without changing their words", () => {
    const html = renderToStaticMarkup(<MathText text="Neural operators work (Yau et al., 2024; Smith, 2022)." keywords={["neural operators"]} citations />);
    expect(html).toContain('<strong class="reader-keyword">Neural operators</strong>');
    expect(html).toContain('<span class="reader-citation">(Yau et al., 2024; Smith, 2022)</span>');
  });

  it("recognizes narrative references but does not treat statistics or math as citations", () => {
    const html = renderToStaticMarkup(<MathText text="Smith et al. (2020) report (n = 2020) and ⟦x_{2020}⟧." citations />);
    expect(html).toContain('<span class="reader-citation">Smith et al. (2020)</span>');
    expect(html).not.toContain('<span class="reader-citation">(n = 2020)</span>');
    expect(html.match(/class="reader-citation"/g)).toHaveLength(1);
    expect(html).toContain('encoding="application/x-tex"');
  });

  it("recognizes numbered references but leaves numeric intervals and dates alone", () => {
    const html = renderToStaticMarkup(<MathText text="Prior studies [1, 3–5] compare [0, 1] during (October 2026)." citations />);
    expect(html).toContain('<span class="reader-citation">[1, 3–5]</span>');
    expect(html).not.toContain('<span class="reader-citation">[0, 1]</span>');
    expect(html).not.toContain('<span class="reader-citation">(October 2026)</span>');
  });

  it("leaves other uses of MathText unchanged by default", () => {
    expect(renderToStaticMarkup(<MathText text="See (Yau et al., 2024)." />)).not.toContain('reader-citation');
  });
});
