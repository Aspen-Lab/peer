import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PaperReport } from "@/lib/papers/report";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { SectionLinks } from "./evidence-quote";
import { ForYourQuestions } from "./for-your-questions";

const map: ReadingMap = {
  sections: [
    { id: "s1", heading: "1 Introduction", canonical: "introduction", role: "setup", page: 2, words: 260, minutes: 2, paragraphs: [] },
    { id: "s2", heading: "2 Results", canonical: "results", role: "evidence", page: 7, words: 460, minutes: 3, paragraphs: [] },
  ],
  totalMinutes: 5,
};

const report: Pick<PaperReport, "forYourQuestions"> = {
  forYourQuestions: [
    {
      question: "Does the method improve retention?",
      verdict: "answered",
      answers: [{ text: "Peer says retention improved under the tested condition.", evidence: "Retention improved after the treatment.", evidenceWhere: "2 Results", sectionId: "s2", page: 7 }],
      readNext: [
        { sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" },
        { sectionId: "s1", why: "It explains the comparison baseline.", kind: "background" },
        { sectionId: "missing", why: "This must not render.", kind: "answer" },
      ],
    },
    {
      question: "Does it cover manufacturing cost?",
      verdict: "partly",
      answers: [{ text: "Peer says cost is mentioned only as a constraint.", evidence: "Cost remains a constraint for scale-up.", evidenceWhere: "2 Results", sectionId: "s2", page: 7 }],
      readNext: [],
    },
    { question: "Does it discuss recycling?", verdict: "not_addressed", answers: [], readNext: [] },
  ],
};

function render(value: Pick<PaperReport, "forYourQuestions"> = report): string {
  return renderToStaticMarkup(
    createElement(
      SectionLinks,
      { headings: map.sections.map((section) => section.heading) },
      createElement(ForYourQuestions, { report: value, map }),
    ),
  );
}

describe("ForYourQuestions (P2-04)", () => {
  it("is absent without verified question answers", () => {
    expect(render({})).toBe("");
  });

  it("renders answered, partly answered, and the exact not-addressed sentence without an empty answers heading", () => {
    const html = render();

    expect(html).toContain("For your questions");
    expect(html).toContain("Answered");
    expect(html).toContain("Partly answered");
    expect(html).toContain("This paper does not address: Does it discuss recycling?.");
    expect(html).not.toContain("Answers");
  });

  it("keeps Peer prose unquoted and renders paper evidence as a linked quote with its page", () => {
    const html = render();
    const peer = /<p class="([^"]*)">Peer says retention improved under the tested condition\.<\/p>/.exec(html)?.[1] ?? "";

    expect(peer).toContain("font-reading");
    expect(peer).not.toContain("italic");
    expect(html).toMatch(/<p class="[^"]*font-reading[^"]*italic[^"]*">Retention improved after the treatment\./);
    expect(html).toContain('<a href="#paper-section-1"');
    expect(html).toContain("§2 Results</a>");
    expect(html).toContain(">p.7<");
  });

  it("resolves Read next against the map, including page, minutes, background and why, and silently drops an unknown id", () => {
    const html = render();

    expect(html).toContain("Read next");
    expect(html).toContain("§2 Results · p.7 · 3 min");
    expect(html).toContain("It reports the measured retention result.");
    expect(html).toContain("§1 Introduction · p.2 · 2 min");
    expect(html).toContain(">background<");
    expect(html).not.toContain("This must not render.");
  });

  it("is placed at the top of ReaderLayout additions, after Decision and before notes and the proposal", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    const additions = source.indexOf("additions={");
    const questions = source.indexOf("<ForYourQuestions", additions);
    const notes = source.indexOf("<PaperNotes", additions);
    const proposal = source.indexOf("<ProposalBlock", additions);

    expect(questions).toBeGreaterThan(additions);
    expect(questions).toBeLessThan(notes);
    expect(questions).toBeLessThan(proposal);
  });
});
