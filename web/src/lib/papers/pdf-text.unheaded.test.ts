import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chooseHtmlExtractor } from "./html-text";
import { minimalPdf, type Run } from "./minimal-pdf.test-helper";
import { extractPdfTextFromPath } from "./pdf-text";
import { readableSections } from "./reading-map";
import { unheadedTrunk } from "./reading-partition";

// P10-07a (B P10-05 §1.1 and §5.2): the shape the unheaded rule depends on, pinned on the
// extractors as they are. Read-only on `pdf-text.ts` and `html-text.ts`: a PDF with no heading
// line reads as ONE `body` section holding every paragraph, and a page of generic HTML with no
// `<h2>` / `<h3>` reads as one section `Body`. If this fails, the extractor changed under the
// rule (P10-04's work, say) and the rule's threshold and `unheadedTrunk` are to be re-read.
// Every text is invented ("a survey of shore ecology"); no sentence of any paper.

const TOPICS = ["tide pools", "kelp beds", "gull colonies", "sand ripples", "salt marsh", "mussel banks"];
const SENTENCES = (k: number) => {
  const topic = TOPICS[k % TOPICS.length];
  return [`Survey paragraph ${k} looks at the ${topic}.`, `The team counted ${10 + k} sites near the ${topic} on one visit.`];
};

let tempDir: string;
beforeAll(async () => {
  tempDir = await mkdtemp(path.join(tmpdir(), "peer-unheaded-"));
});
afterAll(async () => {
  await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
});

/** One page of body-size lines, paragraphs set apart by a blank line's gap, no heading line anywhere. */
function headlessPages(paragraphs: number): Run[][] {
  const pages: Run[][] = [];
  let runs: Run[] = [["A Survey of Shore Ecology", 72, 80, 20]];
  let top = 130;
  for (let k = 0; k < paragraphs; k += 1) {
    const lines = SENTENCES(k);
    if (top + lines.length * 14 > 760) {
      pages.push(runs);
      runs = [];
      top = 80;
    }
    lines.forEach((text, i) => runs.push([text, 72, top + i * 14, 11]));
    top += lines.length * 14 + 14;
  }
  pages.push(runs);
  return pages;
}

describe("the extractors on a paper with no headings (what the unheaded rule rests on)", () => {
  it("reads a headless PDF as one body section holding every paragraph", async () => {
    const pdfPath = path.join(tempDir, "headless.pdf");
    await writeFile(pdfPath, minimalPdf(headlessPages(24)));

    const result = await extractPdfTextFromPath(pdfPath);

    expect(result.ok).toBe(true);
    const sections = readableSections(result.doc!);
    expect(sections).toHaveLength(1);
    expect(sections[0].section.canonical).toBe("body");
    expect(sections[0].paragraphs.length).toBeGreaterThanOrEqual(20);
    // The rule reads that one row as the trunk.
    const rows = sections.map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));
    expect(unheadedTrunk(rows)).toMatchObject({ sectionId: sections[0].id, sectionIndex: 0, paragraphCount: sections[0].paragraphs.length });
  });

  it("reads generic HTML with no heading as one section Body", () => {
    const html =
      "<html><head><title>A Survey of Shore Ecology</title></head><body><article>" +
      Array.from({ length: 24 }, (_, k) => `<p>${SENTENCES(k).join(" ")} ${SENTENCES(k + 1).join(" ")}</p>`).join("") +
      "</article></body></html>";

    const doc = chooseHtmlExtractor("https://example.org/shore-survey")(html);

    const sections = readableSections(doc);
    expect(sections).toHaveLength(1);
    expect(sections[0].section.heading).toBe("Body");
    expect(sections[0].section.canonical).toBe("body");
    expect(sections[0].paragraphs).toHaveLength(24);
    const rows = sections.map(({ id, section, paragraphs }) => ({ id, canonical: section.canonical, paragraphs }));
    expect(unheadedTrunk(rows)).toMatchObject({ sectionIndex: 0, paragraphCount: 24 });
  });
});
