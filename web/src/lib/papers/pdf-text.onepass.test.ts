import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { minimalPdf } from "./minimal-pdf.test-helper";
import { withInheritedBuckets } from "./html-text";
import { extractPdfTextFromPath } from "./pdf-text";

// P10-33 (BACKLOG-36): the outline's `flush()` already tells one inheritor every heading, so the
// sections reach `normalize()` with their buckets. A second pass over them changed nothing and ran
// anyway. The count is on the module's own export; the answers are compared with the pass applied.
vi.mock("./html-text", async (importOriginal) => {
  const original = await importOriginal<typeof import("./html-text")>();
  return { ...original, withInheritedBuckets: vi.fn(original.withInheritedBuckets) };
});

let dir: string;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "peer-p10-33b-"));
});
afterAll(async () => {
  await rm(dir, { recursive: true, force: true }).catch(() => undefined);
});

describe("normalize reads the buckets the outline inherited, in one pass (P10-33, BACKLOG-36)", () => {
  it("gives a subsection its group heading's bucket without a second inheritance pass", async () => {
    const file = path.join(dir, "group.pdf");
    await writeFile(
      file,
      minimalPdf([
        [
          ["A Study of Invented Shoreline Surveys", 72, 80, 18],
          ["1 Introduction", 72, 130, 11],
          ["Every shoreline survey begins with a walk along the water at low tide.", 72, 150, 11],
          ["2 Results and Discussion", 72, 200, 11],
          ["2.1 Counts at the Marsh", 72, 230, 11],
          ["The team counted ten sites near the marsh on one visit.", 72, 250, 11],
        ],
        [
          ["2.2 Counts at the Pools", 72, 80, 11],
          ["The team counted twelve sites near the pools on one visit.", 72, 100, 11],
          ["3 Methods", 72, 150, 11],
          ["Counting was done on foot by two people with a tally sheet.", 72, 170, 11],
        ],
      ]),
    );
    vi.mocked(withInheritedBuckets).mockClear();

    const result = await extractPdfTextFromPath(file);

    expect(result.ok).toBe(true);
    const sections = result.doc!.sections;
    // The extractor ran no inheritance pass of its own.
    expect(vi.mocked(withInheritedBuckets)).not.toHaveBeenCalled();
    expect(sections.map((s) => s.heading)).toEqual([
      "1 Introduction",
      "2 Results and Discussion",
      "2.1 Counts at the Marsh",
      "2.2 Counts at the Pools",
      "3 Methods",
    ]);
    // The subsections took the group's bucket from the heading that holds no text.
    expect(sections.map((s) => s.canonical)).toEqual(["introduction", "results", "results", "results", "methods"]);
    // Nothing is left for a second pass to do: the same answers with it applied.
    expect(withInheritedBuckets(sections).map((s) => s.canonical)).toEqual(sections.map((s) => s.canonical));
  });
});
