import { describe, expect, it } from "vitest";
import {
  canonicalizeHeading,
  chooseHtmlExtractor,
  looksLikeFullText,
  parseCaption,
  type ExtractedDocument,
} from "./html-text";

// A LaTeXML page the way arxiv.org/html and ar5iv emit it: numbered section
// tags inside the headings, subsections nested inside sections, subfigure
// captions nested inside a figure, a table caption, and a bibliography.
const LATEXML = `
<html><head><title>Causal Explanations for Vision Models</title></head><body>
<article class="ltx_document">
<h1 class="ltx_title ltx_title_document">Causal Explanations for Vision Models</h1>
<div class="ltx_abstract"><h6 class="ltx_title ltx_title_abstract">Abstract</h6>
<p class="ltx_p">We study counterfactual explanations for image classifiers.</p></div>
<section id="S1" class="ltx_section">
  <h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">1 </span>Introduction</h2>
  <div class="ltx_para"><p class="ltx_p">Intro text here.</p></div>
  <section id="S1.SS1" class="ltx_subsection">
    <h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">1.1 </span>Contributions</h3>
    <p class="ltx_p">We contribute three things.</p>
  </section>
</section>
<section id="S4" class="ltx_section">
  <h2 class="ltx_title ltx_title_section"><span class="ltx_tag ltx_tag_section">4 </span>Evaluation</h2>
  <p class="ltx_p">Evaluation preamble.</p>
  <section id="S4.SS4" class="ltx_subsection">
    <h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">4.4 </span>Results</h3>
    <p class="ltx_p">Our method reaches an 85% success rate.</p>
    <figure class="ltx_figure">
      <figure class="ltx_figure ltx_subfigure"><figcaption class="ltx_caption">(a) Original image</figcaption></figure>
      <figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_figure">Figure 1: </span>Success rate per class.</figcaption>
    </figure>
    <figure class="ltx_table"><figcaption class="ltx_caption"><span class="ltx_tag ltx_tag_table">Table 1: </span>Metrics.</figcaption></figure>
  </section>
  <section id="S4.SS5" class="ltx_subsection">
    <h3 class="ltx_title ltx_title_subsection"><span class="ltx_tag ltx_tag_subsection">4.5 </span>Limitations</h3>
    <p class="ltx_p">Our approach fails on occluded objects.</p>
  </section>
</section>
<section id="bib" class="ltx_bibliography">
  <h2 class="ltx_title ltx_title_bibliography">References</h2>
  <ul><li>Reference one.</li></ul>
</section>
</article></body></html>`;

describe("canonicalizeHeading", () => {
  it.each([
    ["4.4 Results", "results"],
    ["4.5 Limitations", "limitations"],
    ["Threats to Validity", "limitations"],
    ["IV. Experimental Setup", "methods"],
    ["Materials and Methods", "methods"],
    ["3 Evaluation", "results"],
    ["Model Evaluation", "results"],
    ["Model", "methods"],
    ["Appendix B Additional Results", "results"],
    ["Conclusion and Future Work", "conclusion"],
    ["2 Background", "introduction"],
    ["Related Work", "related_work"],
    ["Data Availability", "acknowledgments"],
    ["Problem Statement", "body"],
    ["Abstract", "abstract"],
  ])("%s → %s", (heading, bucket) => {
    expect(canonicalizeHeading(heading)).toBe(bucket);
  });
});

describe("LaTeXML extractor", () => {
  const extract = chooseHtmlExtractor("https://arxiv.org/html/2609.02697");
  const doc = extract(LATEXML);

  it("routes arxiv.org to the LaTeXML parser", () => {
    expect(doc.source).toBe("ar5iv");
    expect(doc.title).toBe("Causal Explanations for Vision Models");
  });

  it("keeps every heading level as its own section and drops the bibliography", () => {
    expect(doc.sections.map((s) => [s.heading, s.canonical])).toEqual([
      ["Abstract", "abstract"],
      ["1 Introduction", "introduction"],
      ["1.1 Contributions", "body"],
      ["4 Evaluation", "results"],
      ["4.4 Results", "results"],
      ["4.5 Limitations", "limitations"],
    ]);
  });

  it("gives a parent only its own preamble — nothing is counted twice", () => {
    const byHeading = Object.fromEntries(doc.sections.map((s) => [s.heading, s.text]));
    expect(byHeading["4 Evaluation"]).toBe("Evaluation preamble.");
    expect(byHeading["4.4 Results"]).toContain("85% success rate");
    expect(byHeading["4.4 Results"]).not.toContain("occluded");
    expect(byHeading["4.5 Limitations"]).toBe("Our approach fails on occluded objects.");
    expect(byHeading["1 Introduction"]).toBe("Intro text here.");
  });

  it("labels captions honestly and drops subfigure fragments", () => {
    expect(doc.figureCaptions).toEqual([
      { ordinal: 0, label: "Figure 1", caption: "Success rate per class." },
      { ordinal: 1, label: "Table 1", caption: "Metrics." },
    ]);
  });
});

describe("parseCaption", () => {
  it("does not repeat the word Figure in the label", () => {
    expect(parseCaption("Figure 3: Loss curves.", 0)).toEqual({
      ordinal: 0,
      label: "Figure 3",
      caption: "Loss curves.",
    });
    expect(parseCaption("Fig. 2b. Ablation.", 4)?.label).toBe("Figure 2b");
    expect(parseCaption("Figure 1: : A clinician may be surprised.", 0)?.caption).toBe(
      "A clinician may be surprised.",
    );
  });
  it("falls back to the ordinal when unlabelled and drops fragments", () => {
    expect(parseCaption("Overview of the pipeline.", 2)?.label).toBe("Figure 3");
    expect(parseCaption("(b) Perturbed image", 1)).toBeNull();
    expect(parseCaption("   ", 1)).toBeNull();
  });
});

describe("looksLikeFullText", () => {
  const doc = (sections: Array<[string, number]>): ExtractedDocument => ({
    sections: sections.map(([canonical, chars]) => ({
      heading: canonical,
      canonical,
      text: "x".repeat(chars),
    })),
    figureCaptions: [],
    source: "generic-html",
  });

  it("rejects a repository landing page: one long description and trimmings", () => {
    expect(
      looksLikeFullText(
        doc([["body", 1500], ["body", 250], ["body", 250], ["body", 250], ["body", 250], ["body", 250]]),
      ),
    ).toBe(false);
  });

  it("accepts a paper with a real body section", () => {
    expect(looksLikeFullText(doc([["abstract", 900], ["introduction", 1500], ["methods", 1200]]))).toBe(true);
  });

  it("accepts an unlabelled page with several long sections", () => {
    expect(looksLikeFullText(doc([["body", 1000], ["body", 1600]]))).toBe(true);
  });

  it("still rejects thin pages", () => {
    expect(looksLikeFullText(doc([["introduction", 1200], ["results", 900]]))).toBe(false);
  });
});
