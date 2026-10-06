import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { PaperReport } from "@/lib/papers/report";
import type { ReadingMap } from "@/lib/papers/reading-map";
import { FOR_YOUR_QUESTIONS } from "./copy";
import { EvidenceQuote, SectionLinks } from "./evidence-quote";
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
    // P2-04b (§1g.15 finding 1): the reader's own "?" ends the sentence; no ".?" or "?.".
    expect(html).toContain("This paper does not address: Does it discuss recycling?<");
    expect(html).not.toContain("recycling?.");
    expect(html).not.toContain("Answers");
  });

  // P2-04b (§1g.15 finding 1): the sentence takes a period only when the
  // reader's question does not already end the way a sentence ends.
  it("ends the not-addressed sentence with the question's own ?, . or ! and adds a period only otherwise", () => {
    expect(FOR_YOUR_QUESTIONS.notAddressed("Does it discuss recycling?")).toBe("This paper does not address: Does it discuss recycling?");
    expect(FOR_YOUR_QUESTIONS.notAddressed("recycling")).toBe("This paper does not address: recycling.");
    expect(FOR_YOUR_QUESTIONS.notAddressed("recycling.")).toBe("This paper does not address: recycling.");
    expect(FOR_YOUR_QUESTIONS.notAddressed("Is it safe!")).toBe("This paper does not address: Is it safe!");
    // Trailing space is not a terminal mark: the sentence still ends cleanly.
    expect(FOR_YOUR_QUESTIONS.notAddressed("recycling ")).toBe("This paper does not address: recycling.");
    expect(FOR_YOUR_QUESTIONS.notAddressed("Does it discuss recycling? ")).toBe("This paper does not address: Does it discuss recycling?");
    // P2-05 item 0 (§1g.15 amendment): a question typed in a CJK keyboard ends in the
    // full-width ？, ！ or 。, which end a sentence just as ?, ! and . do — no period after them.
    expect(FOR_YOUR_QUESTIONS.notAddressed("Does it discuss recycling？")).toBe("This paper does not address: Does it discuss recycling？");
    expect(FOR_YOUR_QUESTIONS.notAddressed("Is it safe！")).toBe("This paper does not address: Is it safe！");
    expect(FOR_YOUR_QUESTIONS.notAddressed("It discusses recycling。")).toBe("This paper does not address: It discusses recycling。");
    expect(FOR_YOUR_QUESTIONS.notAddressed("Does it discuss recycling？ ")).toBe("This paper does not address: Does it discuss recycling？");

    const html = render({
      forYourQuestions: [
        { question: "recycling", verdict: "not_addressed", answers: [], readNext: [] },
        { question: "Is it safe!", verdict: "not_addressed", answers: [], readNext: [] },
        { question: "Does it discuss recycling？", verdict: "not_addressed", answers: [], readNext: [] },
      ],
    });
    expect(html).toContain("This paper does not address: recycling.<");
    expect(html).toContain("This paper does not address: Is it safe!<");
    expect(html).toContain("This paper does not address: Does it discuss recycling？<");
    expect(html).not.toMatch(/\.\.|!\.|\?\.|[？！。]\./);
  });

  it("keeps Peer prose unquoted and renders paper evidence as a linked quote with its page", () => {
    const html = render();
    const peer = /<p class="([^"]*)">Peer says retention improved under the tested condition\.<\/p>/.exec(html)?.[1] ?? "";

    expect(peer).toContain("font-reading");
    expect(peer).not.toContain("italic");
    expect(html).toMatch(/<p class="[^"]*font-reading[^"]*italic[^"]*">Retention improved after the treatment\./);
    expect(html).toContain('<a href="#paper-section-1"');
    expect(html).toContain("§2 Results</a>");
  });

  // P2-04b (§1g.15 finding 2): the page is part of the attribution, in the
  // one span, after the section link; the old stray "p.N" line is gone.
  it("puts the page inside the attribution span, after the section link, and draws no separate page line", () => {
    const html = render();

    expect(html).toContain("— <a href=\"#paper-section-1\"");
    expect(html).toContain("§2 Results</a> · p.7</span>");
    expect(html).not.toContain(">p.7<");
    // Both answers (both from "2 Results", page 7) carry it, once each.
    expect(html.match(/§2 Results<\/a> · p\.7<\/span>/g)).toHaveLength(2);
    // Read next keeps its own "§Heading · p.N · M min" label, which is not the attribution.
    expect(html).toContain("§2 Results · p.7 · 3 min");
  });

  it("takes the page from the answer, else from its section in the map, else none", () => {
    const answer = (extra: object) => ({
      forYourQuestions: [
        {
          question: "Does it retain?",
          verdict: "answered" as const,
          answers: [{ text: "Peer says yes.", evidence: "Retention improved after the treatment.", evidenceWhere: "2 Results", ...extra }],
          readNext: [],
        },
      ],
    });
    // The answer's own page wins over the section's.
    expect(render(answer({ sectionId: "s2", page: 9 }))).toContain("§2 Results</a> · p.9</span>");
    // No page on the answer: the section's page from the map.
    expect(render(answer({ sectionId: "s2" }))).toContain("§2 Results</a> · p.7</span>");
    // Neither: the attribution stands alone.
    const none = render(answer({ sectionId: "gone" }));
    expect(none).toContain("§2 Results</a></span>");
    expect(none).not.toMatch(/p\.\d/);
  });

  it("the attribution's page is optional on EvidenceQuote and its heading stays bare for the link", () => {
    const quote = (props: { where: string; page?: number }) =>
      renderToStaticMarkup(
        createElement(
          SectionLinks,
          { headings: map.sections.map((section) => section.heading) },
          createElement(EvidenceQuote, { text: "Retention improved after the treatment.", ...props }),
        ),
      );

    expect(quote({ where: "2 Results", page: 7 })).toMatch(/<a href="#paper-section-1" class="[^"]*">§2 Results<\/a> · p\.7<\/span>/);
    // Without `page` the quote is as it was for every other caller.
    expect(quote({ where: "2 Results" })).toContain("§2 Results</a></span>");
    expect(quote({ where: "2 Results" })).not.toContain("p.");
    // A page with no linkable heading still reads as one attribution.
    expect(quote({ where: "4 Discussion", page: 12 })).toContain("— §4 Discussion · p.12</span>");
    expect(quote({ where: "4 Discussion", page: 12 })).not.toContain("<a");
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

  // P2-09 (§1g.14): the quota notice is the first thing in the slot — the
  // reason the report is the shorter one comes before what the report says.
  it("is preceded by the quota notice: QuotaNotice, then ForYourQuestions, then PaperNotes", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    const decision = source.indexOf("decision={");
    const additions = source.indexOf("additions={");
    const quota = source.indexOf("<QuotaNotice", additions);
    const questions = source.indexOf("<ForYourQuestions", additions);
    const notes = source.indexOf("<PaperNotes", additions);

    expect(decision).toBeGreaterThan(-1);
    expect(additions).toBeGreaterThan(decision);
    expect(quota).toBeGreaterThan(additions);
    expect(quota).toBeLessThan(questions);
    expect(questions).toBeLessThan(notes);
  });
});
