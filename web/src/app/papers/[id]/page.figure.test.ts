import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// P11-15 rule 3 (owner item 1; B P11-05 §6 C2): the page mounts the figure host, once per paper. `Reader` cannot be mounted in this Node-only
// suite, so — like `page.sticky.test.ts` and `page.explain.test.ts` — this reads the source and holds the join to its shape, and runs the checker
// on mutated copies so it proves it would notice what it guards. The host stands right after the sticky notes (which it is stacked with), outside
// the zoom container (the card is placed in the window's pixels; a `zoom` ancestor would scale it), keyed by the paper (the figure store's key
// `label:ordinal` repeats across papers, and a card must not follow the reader to the next one).

const HOST = "<FigureHost key={paper.id} />";
const STICKIES = "<StickyNotes key={paper.id} paper={paper} reveal={reveal} />";

function wiringProblems(page: string): string[] {
  const p = page.replace(/\s+/g, " ");
  const problems: string[] = [];
  const count = p.split("<FigureHost").length - 1;
  if (count !== 1) problems.push(`the figure host is mounted ${count} times, not once`);
  if (!p.includes(HOST)) problems.push("the figure host is not keyed by the paper");
  if (!p.includes('import { FigureHost } from "@/components/reader/figure-host";')) problems.push("the page does not import the figure host from the reader's folder");
  // Right after the stickies (a JSX comment may stand between them).
  if (!new RegExp(`${STICKIES.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( \\{/\\*.*?\\*/\\})? ${HOST.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(p)) {
    problems.push("the figure host does not stand right after the sticky notes");
  }
  // Outside the page container, so the Fit zoom does not scale the card.
  const container = p.indexOf("</PageContainer>");
  const host = p.indexOf("<FigureHost");
  if (container < 0 || host < container) problems.push("the figure host is not outside the page container (the zoom root)");
  // Not inside the section links or the error boundary round the explain box.
  const links = p.lastIndexOf("</SectionLinks>");
  if (links < 0 || host < links) problems.push("the figure host stands inside the section links");
  return problems;
}

const page = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

describe("the page's wiring of the figure host", () => {
  it("is right on the source", () => {
    expect(wiringProblems(page)).toEqual([]);
  });

  it("mounts the host exactly once, keyed by the paper, right after the sticky notes", () => {
    const p = page.replace(/\s+/g, " ");
    expect(p.split("<FigureHost").length - 1).toBe(1);
    expect(p).toContain(`${STICKIES}`);
    expect(p.indexOf(HOST)).toBeGreaterThan(p.indexOf(STICKIES));
    expect(p.indexOf(HOST) - (p.indexOf(STICKIES) + STICKIES.length)).toBeLessThan(400);
  });

  it("leaves the lines the sticky and explain pins match as they were", () => {
    const p = page.replace(/\s+/g, " ");
    expect(p).toContain(STICKIES);
    expect(p).toMatch(/<SelectionToolbar target=\{explainTarget\}/);
    expect(p).toMatch(/<SectionLinks headings=\{bodyHeadings\}>.*<ExplainBox .*\/>.*<\/SectionLinks>/);
  });

  it("notices each join taken out", () => {
    const cases: [string, () => string[]][] = [
      ["unmounted", () => wiringProblems(page.replace(HOST, ""))],
      ["not keyed", () => wiringProblems(page.replace(HOST, "<FigureHost />"))],
      ["mounted twice", () => wiringProblems(page.replace(HOST, `${HOST} ${HOST}`))],
      ["not imported", () => wiringProblems(page.replace('import { FigureHost } from "@/components/reader/figure-host";', ""))],
      ["before the stickies", () => wiringProblems(page.replace(STICKIES, "@@S@@").replace(HOST, STICKIES).replace("@@S@@", HOST))],
      ["inside the page container", () => wiringProblems(page.replace(HOST, "").replace("</PageContainer>", `${HOST}</PageContainer>`))],
      ["inside the section links", () => wiringProblems(page.replace(HOST, "").replace("</SectionLinks>", `${HOST}</SectionLinks>`))],
    ];
    for (const [name, run] of cases) expect(run().length, name).toBeGreaterThan(0);
  });
});
