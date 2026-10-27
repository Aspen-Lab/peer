import { describe, expect, it } from "vitest";
import { blockMarker, inlineMath } from "@/lib/text/math";
import {
  bucketInheritor,
  canonicalizeHeading,
  chooseHtmlExtractor,
  looksLikeFullText,
  parseCaption,
  resolveBase,
  withInheritedBuckets,
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

// P12-48 (rule L1; B P12-40 R1, Theme C): "experimental methods" is a methods heading. It used to miss the
// methods words and fall to the `^experiment…` line, which files it as results — the methods part of a paper
// (and its numbered sub-headings, which inherit the bucket) read as evidence.
describe("canonicalizeHeading — experimental methods (L1)", () => {
  it.each([
    ["Experimental methods", "methods"],
    ["2. Experimental Methods", "methods"],
    ["EXPERIMENTAL PROCEDURES", "methods"],
    ["3 Experimental procedure", "methods"],
    ["Experimental and computational methods", "methods"],
    ["Experimental protocols", "methods"],
    ["Experimental techniques", "methods"],
    ["Experimental details", "methods"],
    ["Experimental detail", "methods"],
  ])("%s → %s", (heading, bucket) => {
    expect(canonicalizeHeading(heading)).toBe(bucket);
  });

  it("keeps the headings that were methods before, and the ones that are results", () => {
    expect(canonicalizeHeading("4. EXPERIMENTAL SECTION")).toBe("methods");
    expect(canonicalizeHeading("IV. Experimental Setup")).toBe("methods");
    expect(canonicalizeHeading("Experimental design")).toBe("methods");
    // No methods word follows "experimental": these are the paper's findings.
    expect(canonicalizeHeading("Experimental results")).toBe("results");
    expect(canonicalizeHeading("Experiments")).toBe("results");
    expect(canonicalizeHeading("5 Experimental Evaluation")).toBe("results");
    expect(canonicalizeHeading("Experimental and numerical results")).toBe("results");
  });

  it("gives the numbered sub-headings of an experimental-methods part the methods bucket", () => {
    const inherit = bucketInheritor();
    expect(inherit("2. Experimental methods", canonicalizeHeading("2. Experimental methods"))).toBe("methods");
    expect(inherit("2.1 Sample preparation", canonicalizeHeading("2.1 Sample preparation"))).toBe("methods");
    expect(inherit("2.2 Measurements", canonicalizeHeading("2.2 Measurements"))).toBe("methods");
  });
});

describe("withInheritedBuckets", () => {
  const section = (heading: string, canonical: string) => ({ heading, canonical, text: "x" });

  it("gives a numbered subsection its parent's bucket when its own heading is a guess", () => {
    // The real shape that produced an empty "What they found" block: the only
    // section bucketed `results` was the signpost paragraph, and the findings
    // were in subsections one heading-keyword away from being called methods.
    const out = withInheritedBuckets([
      section("5 Results", "results"),
      section("5.1 Model Comparison Across Budgets", "methods"),
      section("5.2 O3", "body"),
      section("5.3 FK-steering", "body"),
    ]);
    expect(out.map((s) => s.canonical)).toEqual(["results", "results", "results", "results"]);
  });

  it("lets a structural heading overrule its parent", () => {
    const out = withInheritedBuckets([
      section("5 Results", "results"),
      section("5.3 Limitations", "limitations"),
    ]);
    expect(out[1].canonical).toBe("limitations");
  });

  it("reaches past a parent that is itself unclassified", () => {
    const out = withInheritedBuckets([
      section("4 Experiments", "results"),
      section("4.2 Setup", "body"),
      section("4.2.1 Hardware", "body"),
    ]);
    expect(out.map((s) => s.canonical)).toEqual(["results", "results", "results"]);
  });

  it("leaves an unnumbered document alone", () => {
    const out = withInheritedBuckets([
      section("Results", "results"),
      section("Impact Statement", "body"),
    ]);
    expect(out.map((s) => s.canonical)).toEqual(["results", "body"]);
  });
});

// P7-18 (F3): the PDF outline writes no section for a heading with nothing under it, so
// "2. RESULTS AND DISCUSSION" never reached `withInheritedBuckets` and "2.1 …" was filed `body`. The
// outline now tells every heading, text or not, to this one, in order.
describe("bucketInheritor", () => {
  it("carries a numbered heading's bucket to its subsections even when the heading was never made a section", () => {
    const inherit = bucketInheritor();
    expect(inherit("2. RESULTS AND DISCUSSION", "results")).toBe("results");
    expect(inherit("2.1. Electrochemically Tuned Growth and Form of LiCoO2 Crystals", "body")).toBe("results");
    expect(inherit("2.5. Crystal Tectonics Guided Electrochemomechanics", "body")).toBe("results");
    expect(inherit("3. CONCLUSION", "conclusion")).toBe("conclusion");
    expect(inherit("4. EXPERIMENTAL SECTION", "methods")).toBe("methods");
    expect(inherit("4.1. Material Growth of Electrodeposited LiCoO2", "body")).toBe("methods");
    expect(inherit("4.5. Macrotexture Analysis (X-ray Diffraction)", "body")).toBe("methods");
  });

  it("answers as withInheritedBuckets does over the same headings, one at a time", () => {
    const list = [
      ["5 Results", "results"],
      ["5.1 Model Comparison Across Budgets", "methods"],
      ["5.3 Limitations", "limitations"],
      ["5.3.1 Hardware", "body"],
      ["Impact Statement", "body"],
    ] as const;
    const inherit = bucketInheritor();
    const one = list.map(([heading, canonical]) => inherit(heading, canonical));
    const all = withInheritedBuckets(list.map(([heading, canonical]) => ({ heading, canonical }))).map((s) => s.canonical);
    expect(one).toEqual(all);
  });

  it("starts each paper with an empty numbering", () => {
    const first = bucketInheritor();
    first("2. RESULTS", "results");
    const second = bucketInheritor();
    expect(second("2.1 Setup", "body")).toBe("body");
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
      // Its own heading says nothing; its number says whose child it is.
      ["1.1 Contributions", "introduction"],
      ["4 Evaluation", "results"],
      ["4.4 Results", "results"],
      // A structural heading still overrules the parent it sits under.
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

  // P0-01 (spec D1): every section carries a stable id in document order —
  // what the reading map and the question routes point at. An HTML source
  // has no pages, and says so by having none.
  it("numbers its sections s0…sN in document order, with no page", () => {
    expect(doc.sections.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3", "s4", "s5"]);
    expect(doc.sections.every((s) => s.page === undefined)).toBe(true);
  });

  it("labels captions honestly and drops subfigure fragments", () => {
    expect(doc.figureCaptions).toMatchObject([
      { ordinal: 0, label: "Figure 1", caption: "Success rate per class." },
      { ordinal: 1, label: "Table 1", caption: "Metrics." },
    ]);
    // Every caption knows where in the page it sat, in document order.
    const at = doc.figureCaptions.map((c) => c.at ?? -1);
    expect(at.every((x) => x >= 0 && x <= 1)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it("keeps the figure's own picture, absolute against the page it came from", () => {
    const html = `<html><body>
      <h2 class="ltx_title ltx_title_section">1 Introduction</h2><p>Words words words words.</p>
      <figure class="ltx_figure"><img src="1234.5678v2/x1.png" class="ltx_graphics" alt="Refer to caption">
        <figcaption class="ltx_caption">Figure 1: The model.</figcaption></figure>
      <figure class="ltx_table"><table><tr><td>1</td></tr></table>
        <figcaption class="ltx_caption">Table 1: Numbers.</figcaption></figure>
    </body></html>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1234.5678")(html, "https://arxiv.org/html/1234.5678");
    expect(out.figureCaptions[0]).toMatchObject({
      label: "Figure 1",
      imageUrl: "https://arxiv.org/html/1234.5678v2/x1.png",
    });
    // A table has no picture, and says so by having none.
    expect(out.figureCaptions[1].imageUrl).toBeUndefined();
  });

  it("takes a figure drawn as SVG from its <object>, the way arXiv serves plots", () => {
    const html = `<h2 class="ltx_title ltx_title_section">1 A</h2><p>Words words words words.</p>
      <figure class="ltx_figure"><object type="image/svg+xml" data="1234.5678v2/plot.svg" class="ltx_graphics"></object>
        <figcaption class="ltx_caption">Figure 3: Loss.</figcaption></figure>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1234.5678")(html, "https://arxiv.org/html/1234.5678");
    expect(out.figureCaptions[0].imageUrl).toBe("https://arxiv.org/html/1234.5678v2/plot.svg");
  });
});

describe("section ids — P0-01", () => {
  it("numbers the generic walker's sections after the dropped ones are gone", () => {
    // The acknowledgements are dropped before numbering, so the ids stay
    // contiguous in the order the reader sees the sections.
    const html = `<article>
      <h2>Introduction</h2><p>Why this matters, at some length.</p>
      <h2>Acknowledgments</h2><p>We thank everyone.</p>
      <h2>Methods</h2><p>What we did, at some length.</p>
      <h3>Results</h3><p>What we found, at some length.</p>
    </article>`;
    const out = chooseHtmlExtractor("https://example.org/paper")(html, "https://example.org/paper");
    expect(out.sections.map((s) => [s.id, s.heading])).toEqual([
      ["s0", "Introduction"],
      ["s1", "Methods"],
      ["s2", "Results"],
    ]);
    expect(out.sections.every((s) => s.page === undefined)).toBe(true);
  });

  it("numbers PMC sections in order too", () => {
    const html = `<section id="sec1"><h2>Introduction</h2><p>Opening words.</p></section>
      <section id="sec2"><h2>Results</h2><p>Findings words.</p></section>`;
    const out = chooseHtmlExtractor("https://pmc.ncbi.nlm.nih.gov/articles/PMC1/")(html);
    expect(out.sections.map((s) => s.id)).toEqual(["s0", "s1"]);
  });
});

// P8-04 (BACKLOG-33): the same hole P7-18 closed in the PDF outline. A numbered heading that holds only its
// subsections ("2 Results" followed at once by "2.1 …") was dropped by every HTML section build before
// `withInheritedBuckets` could see it, so "2.1" never took `results`. Each build now tells one inheritor
// every heading, text or not, and drops the empty ones after. One fixture per path: the pages are written
// the way each host writes them, flat — a heading, then its words.
describe("an empty numbered parent — every HTML extractor", () => {
  interface Part {
    heading: string;
    text?: string;
  }
  interface HtmlPath {
    name: string;
    url: string;
    source: ExtractedDocument["source"];
    page: (parts: Part[]) => string;
  }

  /** How many numbers a heading carries: "2" is 1, "2.1" is 2, "2.1.1" is 3, "Results" is 0. */
  const depthOf = (heading: string) => heading.match(/^(\d+(?:\.\d+)*)\s/)?.[1].split(".").length ?? 0;
  /** h2 for a section, h3 for anything below it — the two levels the non-LaTeXML extractors read. */
  const plainTag = (heading: string) => (depthOf(heading) > 1 ? "h3" : "h2");
  const words = (text?: string) => (text ? `<p>${text}</p>` : "");

  const PATHS: HtmlPath[] = [
    {
      name: "LaTeXML (arxiv.org/html)",
      url: "https://arxiv.org/html/2609.02697",
      source: "ar5iv",
      page: (parts) =>
        parts
          .map(({ heading, text }) => {
            const depth = Math.max(depthOf(heading), 1);
            const tag = (["section", "subsection", "subsubsection"] as const)[depth - 1];
            const level = depth + 1;
            const numbered = heading.match(/^(\d+(?:\.\d+)*)\s+(.*)$/);
            const inner = numbered ? `<span class="ltx_tag ltx_tag_${tag}">${numbered[1]} </span>${numbered[2]}` : heading;
            return `<h${level} class="ltx_title ltx_title_${tag}">${inner}</h${level}>${text ? `<p class="ltx_p">${text}</p>` : ""}`;
          })
          .join("\n"),
    },
    {
      name: "PMC",
      url: "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/",
      source: "pmc",
      page: (parts) =>
        parts
          .map(({ heading, text }, i) => `<section id="sec${i + 1}"><${plainTag(heading)}>${heading}</${plainTag(heading)}>${words(text)}</section>`)
          .join("\n"),
    },
    {
      name: "bioRxiv (section blocks)",
      url: "https://www.biorxiv.org/content/10.1101/2026.01.01.000001v1.full",
      source: "biorxiv",
      page: (parts) =>
        `<article>${parts
          .map(({ heading, text }, i) => `<div class="section" id="sec-${i + 1}"><${plainTag(heading)}>${heading}</${plainTag(heading)}>${words(text)}</div>`)
          .join("\n")}</article>`,
    },
    {
      name: "bioRxiv (heading walker, no section blocks)",
      url: "https://www.biorxiv.org/content/10.1101/2026.01.01.000002v1.full",
      source: "biorxiv",
      page: (parts) => `<article>${parts.map(({ heading, text }) => `<${plainTag(heading)}>${heading}</${plainTag(heading)}>${words(text)}`).join("\n")}</article>`,
    },
    {
      name: "generic",
      url: "https://example.org/paper",
      source: "generic-html",
      page: (parts) => `<article>${parts.map(({ heading, text }) => `<${plainTag(heading)}>${heading}</${plainTag(heading)}>${words(text)}`).join("\n")}</article>`,
    },
  ];

  const read = (path: HtmlPath, parts: Part[]) => chooseHtmlExtractor(path.url)(path.page(parts), path.url);
  const shape = (doc: ExtractedDocument) => doc.sections.map((s) => [s.heading, s.canonical]);

  describe.each(PATHS)("$name", (path) => {
    it("gives a subsection the bucket of a numbered parent that holds no text of its own", () => {
      const doc = read(path, [
        { heading: "2 Results" },
        { heading: "2.1 Growth", text: "Colonies doubled each day." },
        { heading: "4 Methods" },
        { heading: "4.1 Samples", text: "Samples were taken at dawn." },
      ]);
      expect(doc.source).toBe(path.source);
      // P10-04 (review 3.3), RE-AIMED: this test pinned "the empty parents are no sections". An empty parent
      // that numbers the next heading is a section now (empty text, its bucket), so the map can show the
      // paper's own group headings; its children still carry the bucket they inherit.
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["2.1 Growth", "results"],
        ["4 Methods", "methods"],
        ["4.1 Samples", "methods"],
      ]);
      expect(doc.sections.map((s) => s.text)).toEqual(["", "Colonies doubled each day.", "", "Samples were taken at dawn."]);
      expect(doc.sections.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3"]);
      // A second pass over what was kept finds nothing left to inherit, so the build needs no second pass.
      expect(withInheritedBuckets(doc.sections).map((s) => s.canonical)).toEqual(doc.sections.map((s) => s.canonical));
    });

    it("lets a subsection that names a structural bucket keep it under an empty parent", () => {
      const doc = read(path, [
        { heading: "2 Results" },
        { heading: "2.1 Growth", text: "Colonies doubled each day." },
        { heading: "2.2 Limitations", text: "Only one strain was grown." },
      ]);
      // P10-04, RE-AIMED (missed in the red commit): "2 Results" is a section now, in its bucket.
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["2.1 Growth", "results"],
        ["2.2 Limitations", "limitations"],
      ]);
    });

    it("reaches a grandchild through two headings that hold no text", () => {
      const doc = read(path, [
        { heading: "2 Results" },
        { heading: "2.1 Growth" },
        { heading: "2.1.1 Dynamics", text: "The curve is steepest at noon." },
      ]);
      // P10-04, RE-AIMED: the two empty parents are kept, each numbering the heading after it.
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["2.1 Growth", "results"],
        ["2.1.1 Dynamics", "results"],
      ]);
      expect(doc.sections.map((s) => s.text)).toEqual(["", "", "The curve is steepest at noon."]);
    });

    // P10-04 (review 3.3; A10): the paper's group headings are rows of the map, so the extractor keeps them.
    it("keeps an empty numbered parent as a section with empty text and numbers it in order (P10-04)", () => {
      const doc = read(path, [
        { heading: "1 Introduction", text: "Cathodes fade." },
        { heading: "2 Results" },
        { heading: "2.1 Growth", text: "Colonies doubled each day." },
        { heading: "2.2 Form", text: "Crystals were faceted." },
        { heading: "3 Conclusion", text: "It works." },
      ]);
      expect(doc.sections.map((s) => s.heading)).toEqual(["1 Introduction", "2 Results", "2.1 Growth", "2.2 Form", "3 Conclusion"]);
      expect(doc.sections.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
      expect(doc.sections[1].text).toBe("");
      expect(doc.sections[1].canonical).toBe("results");
    });

    it("drops an empty heading that numbers nothing — a stray — as before (P10-04)", () => {
      const doc = read(path, [
        { heading: "1 Introduction", text: "Cathodes fade." },
        { heading: "2 Layout notes" },
        { heading: "3 Results", text: "Three findings follow." },
        { heading: "4 Outlook" },
      ]);
      expect(doc.sections.map((s) => s.heading)).toEqual(["1 Introduction", "3 Results"]);
    });

    it("does not take a sibling or an unrelated number for a child: 2 then 3.1 keeps nothing of 2 (P10-04)", () => {
      const doc = read(path, [
        { heading: "1 Introduction", text: "Cathodes fade." },
        { heading: "2 Results" },
        { heading: "3.1 Elsewhere", text: "Not a child of two." },
        { heading: "20 Further observations" },
        { heading: "20.1 Detail", text: "Child of twenty, not of two." },
      ]);
      expect(doc.sections.map((s) => s.heading)).toEqual(["1 Introduction", "3.1 Elsewhere", "20 Further observations", "20.1 Detail"]);
    });

    it("leaves an unnumbered document alone", () => {
      const doc = read(path, [
        { heading: "Results" },
        { heading: "Growth", text: "Colonies doubled each day." },
        { heading: "Methods", text: "Samples were taken at dawn." },
        { heading: "Sample notes", text: "Nothing else to add." },
      ]);
      expect(shape(doc)).toEqual([
        ["Growth", "body"],
        ["Methods", "methods"],
        ["Sample notes", "body"],
      ]);
    });

    it("treats a parent with text as it always has", () => {
      const doc = read(path, [
        { heading: "2 Results", text: "Three findings follow." },
        { heading: "2.1 Growth", text: "Colonies doubled each day." },
        // Its own heading says "method"; the parent says results, and a guess does not overrule it.
        { heading: "2.2 Method details", text: "Counted by two people." },
      ]);
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["2.1 Growth", "results"],
        ["2.2 Method details", "results"],
      ]);
    });

    it("still drops end matter, and an acknowledgments subsection with it", () => {
      const doc = read(path, [
        { heading: "2 Results", text: "Three findings follow." },
        { heading: "2.1 Growth", text: "Colonies doubled each day." },
        { heading: "3 Acknowledgments", text: "We thank the lab." },
        { heading: "3.1 Funding", text: "Grant 12345." },
      ]);
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["2.1 Growth", "results"],
      ]);
    });

    it("does not let end matter hand its bucket down: a subsection under an empty one reads as it did before", () => {
      // Not the question of this item (BACKLOG-33); pinned so the choice is a visible one.
      const doc = read(path, [
        { heading: "2 Results", text: "Three findings follow." },
        { heading: "3 Acknowledgments" },
        { heading: "3.1 Notes", text: "Nothing else to add." },
      ]);
      expect(shape(doc)).toEqual([
        ["2 Results", "results"],
        ["3.1 Notes", "body"],
      ]);
    });
  });
});

describe("resolveBase", () => {
  it("prefers the page's own <base href>", () => {
    expect(resolveBase('<head><base href="/html/1706.03762/"></head>', "https://ar5iv.labs.arxiv.org/html/1706.03762"))
      .toBe("https://ar5iv.labs.arxiv.org/html/1706.03762/");
  });
  it("reads a URL whose last segment is not a file as a directory", () => {
    expect(resolveBase("", "https://example.org/articles/PMC123?x=1#y")).toBe("https://example.org/articles/PMC123/");
    expect(resolveBase("", "https://example.org/a/paper.html")).toBe("https://example.org/a/paper.html");
  });
  it("gives nothing without a page", () => {
    expect(resolveBase("", undefined)).toBeUndefined();
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
    sections: sections.map(([canonical, chars], i) => ({
      id: `s${i}`,
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


describe("liftLatexmlMath", () => {
  it("lifts a numbered display equation into a marker paragraph and keeps its TeX", () => {
    const html = `<h2 class="ltx_title ltx_title_section">3 Attention</h2><p>Words words words words.</p>
      <table id="S3.E1" class="ltx_equation ltx_eqn_table"><tbody><tr class="ltx_equation ltx_eqn_row">
        <td class="ltx_eqn_cell"><math class="ltx_Math" alttext="\\mathrm{softmax}(\\frac{QK^{T}}{\\sqrt{d_{k}}})V" display="block"><mi>Q</mi></math></td>
        <td class="ltx_eqn_cell ltx_eqn_eqno"><span class="ltx_tag ltx_tag_equation">(1)</span></td></tr></tbody></table>
      <p>More words words words.</p>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1.2")(html, "https://arxiv.org/html/1.2");
    expect(out.equations).toEqual([{ latex: "\\mathrm{softmax}(\\frac{QK^{T}}{\\sqrt{d_{k}}})V", number: "(1)" }]);
    const text = out.sections[0].text;
    expect(text).toContain(blockMarker(0));
    expect(text).not.toContain("Q");
    // Its own paragraph: blank lines on both sides.
    expect(text).toMatch(new RegExp(`\\n\\n${blockMarker(0).replace(/[#]/g, "#")}\\n\\n`));
  });

  it("keeps a formula with a less-than sign, and the sentence after it", () => {
    // `alttext="k&lt;n"`: decoded before the tags were stripped, the `<`
    // opened a phantom tag that ate the rest of the paragraph.
    const html = `<h2 class="ltx_title ltx_title_section">4 Why</h2><p>a kernel width <math alttext="k&lt;n" display="inline"><mi>k</mi></math> does not connect all pairs, so <math alttext="f'(x)" display="inline"><mi>f</mi></math> is needed.</p>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1.2")(html, "https://arxiv.org/html/1.2");
    expect(out.sections[0].text).toBe(`a kernel width ${inlineMath("k<n")} does not connect all pairs, so ${inlineMath("f'(x)")} is needed.`);
  });

  it("decodes the TeX of a lifted display equation, which leaves the HTML", () => {
    const html = `<h2 class="ltx_title ltx_title_section">1 A</h2><p>Words words words words.</p>
      <table class="ltx_equation ltx_eqn_table"><tr><td><math alttext="x &lt; y &amp; z" display="block"><mi>x</mi></math></td></tr></table>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1.2")(html, "https://arxiv.org/html/1.2");
    expect(out.equations?.[0].latex).toBe("x < y & z");
  });

  it("keeps inline mathematics as marked TeX instead of flattened MathML", () => {
    const html = `<h2 class="ltx_title ltx_title_section">1 A</h2><p>the key size <math alttext="d_{k}" display="inline"><msub><mi>d</mi><mi>k</mi></msub><annotation encoding="application/x-tex">d_{k}</annotation></math> matters here and here.</p>`;
    const out = chooseHtmlExtractor("https://arxiv.org/html/1.2")(html, "https://arxiv.org/html/1.2");
    expect(out.sections[0].text).toContain(`the key size ${inlineMath("d_{k}")} matters`);
    expect(out.sections[0].text).not.toMatch(/\bd k\b/);
    expect(out.equations).toBeUndefined();
  });
});

// P10-40 (BACKLOG-35): `extractPmc` matched `<section …>…</section>` non-greedily, so the first inner closing tag
// ended the outer match: a section's first nested subsection was folded into its parent's text and never had a
// section of its own. The walk is by depth now. Two levels of nesting, written the way PMC writes them.
describe("extractPmc — a nested section is its own (P10-40, BACKLOG-35)", () => {
  const PMC_URL = "https://pmc.ncbi.nlm.nih.gov/articles/PMC1/";
  const html = `
    <section id="sec1"><h2>Introduction</h2><p>Intro opening words.</p>
      <section id="sec1.1"><h3>Background</h3><p>Background words.</p>
        <section id="sec1.1.1"><h4>Prior work</h4><p>Prior work words.</p></section>
        <p>Background closing words.</p>
      </section>
      <section id="sec1.2"><h3>Aim</h3><p>Aim words.</p></section>
      <p>Intro closing words.</p>
    </section>
    <section id="sec2"><h2>Results</h2><p>Findings words.</p></section>`;

  it("the first nested subsection is a section of its own, at both depths", () => {
    const out = chooseHtmlExtractor(PMC_URL)(html);
    expect(out.sections.map((s) => s.heading)).toEqual(["Introduction", "Background", "Prior work", "Aim", "Results"]);
    expect(out.sections.map((s) => s.id)).toEqual(["s0", "s1", "s2", "s3", "s4"]);
  });

  it("a parent keeps its own words, not its subsections' — before and after them", () => {
    const text = (heading: string) => chooseHtmlExtractor(PMC_URL)(html).sections.find((s) => s.heading === heading)?.text ?? "";
    expect(text("Introduction")).toContain("Intro opening words.");
    expect(text("Introduction")).toContain("Intro closing words.");
    expect(text("Introduction")).not.toMatch(/Background|Prior work|Aim words/);
    expect(text("Background")).toContain("Background words.");
    expect(text("Background")).toContain("Background closing words.");
    expect(text("Background")).not.toMatch(/Prior work/);
    expect(text("Prior work")).toBe("Prior work words.");
    expect(text("Aim")).toBe("Aim words.");
  });

  it("a section that is not a body section (a box) stays in its parent's text", () => {
    const boxed = `<section id="sec1"><h2>Methods</h2><p>Plots were watered.</p>
      <section class="boxed-text"><p>Box: the watering schedule.</p></section>
      <section id="sec1.1"><h3>Sampling</h3><p>Probes sat in each plot.</p></section></section>`;
    const out = chooseHtmlExtractor(PMC_URL)(boxed);
    expect(out.sections.map((s) => s.heading)).toEqual(["Methods", "Sampling"]);
    expect(out.sections[0].text).toContain("Box: the watering schedule.");
    expect(out.sections[1].text).toBe("Probes sat in each plot.");
  });
});
