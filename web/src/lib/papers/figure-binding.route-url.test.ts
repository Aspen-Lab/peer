import { describe, expect, it } from "vitest";
import type { ExtractedFigureCaption } from "./html-text";
import type { PaperReport } from "./report";
import type { FigurePool, FigurePoolEntry } from "@/lib/figures/extract";
import { bindFiguresToReport } from "./figure-binding";
import { pdfFigureUrl, placeFigures, type ReadingSection } from "./reading";

// P9-53 — a figure the report binds from a PDF is the figure-image route's URL
// (`/api/papers/<id>/figure-image?page=&fig=`), not the figure's bytes. Until
// now the pool's `data:image/png;base64,…` URL went into the report, so the
// stream carried about a megabyte per figure and a cached report (which cannot
// keep one, P9-48) drew another picture after a reload.
//
// The rules, one `describe` each:
//   1. a bound figure of a PDF is its route URL (the paper's id, the caption's
//      page, the number its label names);
//   2. an HTML source's own picture stays, and so does any pool entry that is
//      not a PDF-rendered one;
//   3. the picture is the same figure — here: only where the pool's pick *is*
//      the figure the label names (`figure-binding.same-figure.test.ts` has the
//      bytes, on a real PDF);
//   4. nothing else in the report changes.
// Everything below is invented. No model: the words of the section bind the
// figure (an explicit "Figure N", or a caption's own words), so `provider` is null.

const PAPER_ID = "arxiv:2610.00007";
const UPLOAD_ID = "upload:0123456789abcdef";

/** Two stand-ins for a PDF-rendered figure, short so that a failure prints legibly. */
const PNG_ONE = "data:image/png;base64,ONE-ONE-ONE";
const PNG_TWO = "data:image/png;base64,TWO-TWO-TWO";

const CAPTION_ONE = "Soil water against depth under three seaweed layers.";
const CAPTION_TWO = "Runoff loss after the storm, terrace by terrace.";

/** A PDF's captions: each has the page it was read from (`page`: PDFs only). */
const PDF_CAPTIONS: ExtractedFigureCaption[] = [
  { ordinal: 0, label: "Figure 1", caption: CAPTION_ONE, page: 3, at: 0.2 },
  { ordinal: 1, label: "Figure 2", caption: CAPTION_TWO, page: 5, at: 0.4 },
  { ordinal: 2, label: "Table 1", caption: "Probe positions in each plot.", page: 3, at: 0.2 },
];

function entry(over: Partial<FigurePoolEntry> & Pick<FigurePoolEntry, "imageUrl" | "caption">): FigurePoolEntry {
  return { source: "open-access", ordinal: 0, qualityHint: "high", ...over };
}

/** The pool the PDF's own figures make: one `data:` URL per figure, its caption opening "Figure N." */
function pdfPool(one = PNG_ONE, two = PNG_TWO): FigurePool {
  return {
    attempted: true,
    entries: [
      entry({ imageUrl: one, caption: `Figure 1. ${CAPTION_ONE}`, ordinal: 0 }),
      entry({ imageUrl: two, caption: `Figure 2. ${CAPTION_TWO}`, ordinal: 1 }),
    ],
  };
}

/** The proposal names Figure 2 and the one key result names Figure 1, in words the binder reads. */
function report(): PaperReport {
  return {
    skim: [],
    whatItProposes: { summary: "As Figure 2 shows, the runoff fell once the layers went on.", methods: [] },
    resultsAndSignificance: {
      summary: "",
      keyResults: [
        {
          title: "Deeper layers held water",
          detail: "The index rose with depth.",
          evidence: "The index rose with depth, as Figure 1 plots.",
        },
      ],
    },
    provenance: { basis: "model-fulltext", droppedClaims: 0 },
  };
}

/** A report whose proposal repeats `text` (a caption's own words bind that caption, no model) and has no result. */
function proposalOnly(text: string): PaperReport {
  return {
    ...report(),
    whatItProposes: { summary: text, methods: [] },
    resultsAndSignificance: { summary: "", keyResults: [] },
  };
}

async function bind(args: {
  id?: string;
  captions?: ExtractedFigureCaption[];
  pool?: FigurePool | null;
  report?: PaperReport;
}): Promise<PaperReport> {
  return bindFiguresToReport({
    paper: { title: "Seaweed mulch on terraces", ...(args.id !== undefined ? { id: args.id } : {}) },
    report: args.report ?? report(),
    captions: args.captions ?? PDF_CAPTIONS,
    provider: null,
    figurePool: args.pool === undefined ? pdfPool() : args.pool,
  });
}

function proposalUrl(bound: PaperReport): string | null | undefined {
  return bound.whatItProposes.figureImageUrl;
}
function resultUrl(bound: PaperReport): string | null | undefined {
  return bound.resultsAndSignificance.keyResults[0].figureImageUrl;
}

describe("rule 1 — a bound figure of a PDF is the figure-image route's URL", () => {
  it("binds the proposal and the result to the route, by the paper's id, the caption's page and the label's number", async () => {
    const bound = await bind({ id: PAPER_ID });

    expect(bound.whatItProposes.figureLabel).toBe("Figure 2");
    expect(proposalUrl(bound)).toBe(pdfFigureUrl(PAPER_ID, 5, 2));
    expect(bound.resultsAndSignificance.keyResults[0].figureLabel).toBe("Figure 1");
    expect(resultUrl(bound)).toBe(pdfFigureUrl(PAPER_ID, 3, 1));
    expect(proposalUrl(bound)).toBe("/api/papers/arxiv%3A2610.00007/figure-image?page=5&fig=2");
  });

  it("carries no figure by value: the report is a few KB, not two megabytes", async () => {
    // What a real pool holds: a megabyte of base64 a figure.
    const megabyte = (c: string) => `data:image/png;base64,${c.repeat(1_081_000)}`;
    const pool = pdfPool(megabyte("A"), megabyte("B"));

    const after = JSON.stringify(await bind({ id: PAPER_ID, pool }));
    const before = JSON.stringify(await bind({ pool }));

    expect(after).not.toContain("data:");
    expect(after).not.toContain("base64");
    expect(after.length).toBeLessThan(4_000);
    // The same report without the id is what the stream carried until now: both figures by value.
    expect(before.length).toBeGreaterThan(2_000_000);
  });

  it("names an upload by its id, so the route answers its owner only (the stream never carries the upload's bytes)", async () => {
    const bound = await bind({ id: UPLOAD_ID });

    expect(proposalUrl(bound)).toBe("/api/papers/upload%3A0123456789abcdef/figure-image?page=5&fig=2");
    expect(resultUrl(bound)).toBe("/api/papers/upload%3A0123456789abcdef/figure-image?page=3&fig=1");
    expect(JSON.stringify(bound)).not.toContain("data:");
  });

  it("answers an OpenAlex paper's route too", async () => {
    const bound = await bind({ id: "openalex:W4400000001" });

    expect(resultUrl(bound)).toBe("/api/papers/openalex%3AW4400000001/figure-image?page=3&fig=1");
  });

  it("answers a Semantic Scholar paper’s route", async () => {
    const id = "semantic_scholar:cbc4266795a13b6124294e0fb15bfcdcc29417e2";
    const bound = await bind({ id });
    expect(resultUrl(bound)).toBe(`/api/papers/${encodeURIComponent(id)}/figure-image?page=3&fig=1`);
  });

  it.each([
    ["Figure 3", 3],
    ["Fig. 3", 3],
    ["Fig 3", 3],
    ["fig.3", 3],
    ["FIGURE 12", 12],
  ])("reads the number from a label written %s", async (label, n) => {
    const captions: ExtractedFigureCaption[] = [{ ordinal: 0, label, caption: CAPTION_ONE, page: 7 }];
    const pool: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_ONE, caption: `Figure ${n}. ${CAPTION_ONE}` })] };

    const bound = await bind({ id: PAPER_ID, captions, pool, report: proposalOnly(CAPTION_ONE) });

    expect(bound.whatItProposes.figureLabel).toBe(label);
    expect(proposalUrl(bound)).toBe(pdfFigureUrl(PAPER_ID, 7, n));
  });

  it("gives the very URL the reading offers for the same caption, and none where the reading offers none", async () => {
    const labels = ["Figure 3", "Fig. 3", "Fig 3", "fig.3", "FIGURE 12", "Figure S3", "Figure 3b", "Figure IV", "Figure 03", "Figure 0", "Figure 1000", "Table 1"];
    const section: ReadingSection = { id: "s0", heading: "Results", canonical: "results", paragraphs: ["Prose."] };
    let offeredCount = 0;
    for (const label of labels) {
      const captions: ExtractedFigureCaption[] = [{ ordinal: 0, label, caption: CAPTION_ONE, page: 4 }];
      const offered = placeFigures([section], captions, { paperId: PAPER_ID })[0].figures?.[0]?.imageUrl;
      const n = /^fig(?:ure)?\.?\s*([1-9]\d{0,2})$/i.exec(label)?.[1] ?? "9";
      const pool: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_ONE, caption: `Figure ${n}. ${CAPTION_ONE}` })] };

      const bound = await bind({ id: PAPER_ID, captions, pool, report: proposalOnly(CAPTION_ONE) });

      expect(bound.whatItProposes.figureLabel, label).toBe(label);
      // Where the reading offers a route URL the binder gives it; where it offers none the pool's stays.
      expect(proposalUrl(bound), label).toBe(offered ?? PNG_ONE);
      if (offered) offeredCount += 1;
    }
    // The premise: five of the twelve labels name a picture number.
    expect(offeredCount).toBe(5);
  });

  it("takes the page from the picture-numbered caption, not from a table that shares its number", async () => {
    // "Table 1" sits first and normalises to the same key as "Figure 1": the page must still be Figure 1's.
    const captions: ExtractedFigureCaption[] = [
      { ordinal: 0, label: "Table 1", caption: "Probe positions in each plot.", page: 2 },
      { ordinal: 1, label: "Figure 1", caption: CAPTION_ONE, page: 6 },
    ];
    const pool: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_ONE, caption: `Figure 1. ${CAPTION_ONE}` })] };

    const bound = await bind({ id: PAPER_ID, captions, pool, report: proposalOnly(CAPTION_ONE) });

    expect(bound.whatItProposes.figureLabel).toBe("Figure 1");
    expect(proposalUrl(bound)).toBe(pdfFigureUrl(PAPER_ID, 6, 1));
  });

  it.each([
    ["no paper id", undefined],
    ["an empty paper id", ""],
    ["an id the figure route cannot look up (a source it does not know)", "semantic_scholar:abc123"],
    ["an upload id spelled in capitals, which is no upload", "UPLOAD:0123456789abcdef"],
  ])("keeps the pool's picture where there is %s", async (_name, id) => {
    const bound = await bind({ id });

    expect(proposalUrl(bound)).toBe(PNG_TWO);
    expect(resultUrl(bound)).toBe(PNG_ONE);
  });

  it("keeps the pool's picture for a caption with no page", async () => {
    const captions = PDF_CAPTIONS.map((c) => ({ ordinal: c.ordinal, label: c.label, caption: c.caption }));

    const bound = await bind({ id: PAPER_ID, captions });

    expect(proposalUrl(bound)).toBe(PNG_TWO);
    expect(resultUrl(bound)).toBe(PNG_ONE);
  });

  it.each(["Figure S3", "Figure 3b", "Figure IV", "Table 1"])("keeps the pool's picture where the label names no picture number (%s)", async (label) => {
    const captions: ExtractedFigureCaption[] = [{ ordinal: 0, label, caption: CAPTION_ONE, page: 4 }];
    const pool: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_ONE, caption: `Figure 3. ${CAPTION_ONE}` })] };

    const bound = await bind({ id: PAPER_ID, captions, pool, report: proposalOnly(CAPTION_ONE) });

    expect(bound.whatItProposes.figureLabel).toBe(label);
    expect(proposalUrl(bound)).toBe(PNG_ONE);
  });

  it("binds no picture where the pool gave none: a label alone, as before", async () => {
    for (const pool of [null, { entries: [], attempted: true } satisfies FigurePool]) {
      const bound = await bind({ id: PAPER_ID, pool });

      expect(bound.whatItProposes.figureLabel).toBe("Figure 2");
      expect(proposalUrl(bound)).toBeNull();
      expect(resultUrl(bound)).toBeNull();
    }
  });
});

describe("rule 2 — an HTML source's own picture stays", () => {
  const PICTURE_ONE = "https://ar5iv.example.org/html/2610.00007/assets/x1.png";
  const PICTURE_TWO = "https://ar5iv.example.org/html/2610.00007/assets/x2.png";

  function htmlCaptions(page?: number): ExtractedFigureCaption[] {
    return [
      { ordinal: 0, label: "Figure 1", caption: CAPTION_ONE, imageUrl: PICTURE_ONE, ...(page ? { page } : {}) },
      { ordinal: 1, label: "Figure 2", caption: CAPTION_TWO, imageUrl: PICTURE_TWO, ...(page ? { page } : {}) },
    ];
  }
  function htmlPool(): FigurePool {
    return {
      attempted: true,
      entries: [
        entry({ imageUrl: PICTURE_ONE, caption: `Figure 1. ${CAPTION_ONE}`, source: "ar5iv" }),
        entry({ imageUrl: PICTURE_TWO, caption: `Figure 2. ${CAPTION_TWO}`, source: "ar5iv" }),
      ],
    };
  }

  it("leaves an HTML document's pictures as the pool gave them, with an id and labels that name a number", async () => {
    const bound = await bind({ id: PAPER_ID, captions: htmlCaptions(), pool: htmlPool() });

    expect(resultUrl(bound)).toBe(PICTURE_ONE);
    expect(proposalUrl(bound)).toBe(PICTURE_TWO);
    expect(JSON.stringify(bound)).not.toContain("figure-image");
  });

  it("leaves a caption that carries its own picture alone even if it also names a page", async () => {
    const bound = await bind({ id: PAPER_ID, captions: htmlCaptions(4), pool: pdfPool() });

    // The pool's pick is what it was; a caption with a picture of its own is not sent to the route.
    expect(resultUrl(bound)).toBe(PNG_ONE);
    expect(proposalUrl(bound)).toBe(PNG_TWO);
  });

  it("leaves a publisher's picture (an https URL in the pool) alone for a PDF's caption: only a PDF-rendered figure changes", async () => {
    const publisher: FigurePool = {
      attempted: true,
      entries: [
        entry({ imageUrl: "https://publisher.example.org/f1.png", caption: `Figure 1. ${CAPTION_ONE}`, source: "publisher" }),
        entry({ imageUrl: "https://publisher.example.org/f2.png", caption: `Figure 2. ${CAPTION_TWO}`, source: "publisher" }),
      ],
    };

    const bound = await bind({ id: PAPER_ID, pool: publisher });

    expect(resultUrl(bound)).toBe("https://publisher.example.org/f1.png");
    expect(proposalUrl(bound)).toBe("https://publisher.example.org/f2.png");
  });
});

describe("rule 3 — only where the pool's pick is the figure the label names", () => {
  it("keeps the pool's pick when it is another figure (picked by words, not by number): the picture and its caption stay together", async () => {
    // The pool has no Figure 2 (past the pages it reads, say): it answers Figure 1's picture for a Figure 2 label.
    const pool: FigurePool = { attempted: true, entries: [entry({ imageUrl: PNG_ONE, caption: `Figure 1. ${CAPTION_ONE}` })] };

    const bound = await bind({ id: PAPER_ID, pool });

    expect(bound.whatItProposes.figureLabel).toBe("Figure 2");
    expect(proposalUrl(bound)).toBe(PNG_ONE);
    expect(bound.whatItProposes.figureCaption).toBe(`Figure 1. ${CAPTION_ONE}`);
    // The Figure 1 result still gets its route.
    expect(resultUrl(bound)).toBe(pdfFigureUrl(PAPER_ID, 3, 1));
  });

  it("keeps the pool's pick when its caption names a lettered panel, which the route does not draw for 'Figure 2'", async () => {
    const pool: FigurePool = {
      attempted: true,
      entries: [entry({ imageUrl: PNG_TWO, caption: `Figure 2a. ${CAPTION_TWO}` }), entry({ imageUrl: PNG_ONE, caption: `Figure 1. ${CAPTION_ONE}` })],
    };

    const bound = await bind({ id: PAPER_ID, pool });

    expect(proposalUrl(bound)).toBe(PNG_TWO);
  });
});

describe("rule 4 — nothing else in the report changes", () => {
  it("is the report the pool-only binding gives, except for the two URLs", async () => {
    const before = await bind({});
    const after = await bind({ id: PAPER_ID });

    const withoutUrls = (r: PaperReport) => ({
      ...r,
      whatItProposes: { ...r.whatItProposes, figureImageUrl: undefined },
      resultsAndSignificance: {
        ...r.resultsAndSignificance,
        keyResults: r.resultsAndSignificance.keyResults.map((k) => ({ ...k, figureImageUrl: undefined })),
      },
    });
    expect(withoutUrls(after)).toEqual(withoutUrls(before));
    // The captions and sources are the pool entries', as before.
    expect(after.whatItProposes.figureCaption).toBe(`Figure 2. ${CAPTION_TWO}`);
    expect(after.whatItProposes.figureSource).toBe("open-access");
    expect(after.resultsAndSignificance.keyResults[0].figureCaption).toBe(`Figure 1. ${CAPTION_ONE}`);
    expect(after.resultsAndSignificance.keyResults[0].figureSource).toBe("open-access");
    // And the URLs did change.
    expect(proposalUrl(after)).not.toBe(proposalUrl(before));
    expect(resultUrl(after)).not.toBe(resultUrl(before));
  });

  it("binds nothing for a document with no captions, as before", async () => {
    const bound = await bind({ id: PAPER_ID, captions: [] });

    expect(bound.whatItProposes.figureLabel).toBeNull();
    expect(proposalUrl(bound)).toBeNull();
    expect(resultUrl(bound)).toBeNull();
  });

  it("gives two results that share a figure the same URL, so the page shows one picture", async () => {
    const twice: PaperReport = {
      ...report(),
      whatItProposes: { summary: "The setup is described in prose only.", methods: [] },
      resultsAndSignificance: {
        summary: "",
        keyResults: [
          { title: "A", detail: "First claim.", evidence: "The index rose with depth, as Figure 1 plots." },
          { title: "B", detail: "Second claim.", evidence: "The gap held after the storm, also Figure 1." },
        ],
      },
    };

    const bound = await bind({ id: PAPER_ID, report: twice });
    const results = bound.resultsAndSignificance.keyResults;

    expect(results.map((r) => r.figureLabel)).toEqual(["Figure 1", "Figure 1"]);
    expect(results.map((r) => r.figureImageUrl)).toEqual([pdfFigureUrl(PAPER_ID, 3, 1), pdfFigureUrl(PAPER_ID, 3, 1)]);
  });
});
