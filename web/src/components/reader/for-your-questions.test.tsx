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

// P9-05 (X10): the minutes ride on a no-break space, so "3 min" never wraps apart.
const NB = "\u00a0";

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

  // P2-08b (§1g.21 (2)): when the model offered answers and verification dropped
  // every one, the page says so — not that the paper does not address the
  // question. The label-face line, no answers heading, the Read next rows kept.
  it("renders the unverified verdict as the one label-face line, with no answers and the Read next rows kept (P2-08b)", () => {
    const html = render({
      forYourQuestions: [
        {
          question: "Does the method improve retention?",
          verdict: "unverified",
          answers: [],
          readNext: [
            { sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" },
            { sectionId: "s1", why: "It explains the comparison baseline.", kind: "background" },
          ],
        },
      ],
    });

    expect(FOR_YOUR_QUESTIONS.unverified).toBe("Peer could not verify an answer in the paper's own words.");
    expect(html).toMatch(/<p class="[^"]*font-mono[^"]*">Peer could not verify an answer in the paper(?:'|&#x27;)s own words\.<\/p>/);
    expect(html).not.toContain("does not address");
    expect(html).not.toContain("Answered");
    expect(html).not.toContain("Partly answered");
    // No answer rows: no quote, no attribution.
    expect(html).not.toContain("italic");
    expect(html).not.toContain("—");
    // Read next keeps both rows.
    expect(html).toContain("Read next");
    expect(html).toContain(`§2 Results · p.7 · 3${NB}min`);
    expect(html).toContain("It reports the measured retention result.");
    expect(html).toContain(`§1 Introduction · p.2 · 2${NB}min · background</p>`);
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
    expect(html).toContain(`§2 Results · p.7 · 3${NB}min`);
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

  // P9-05 (X10, the feature walk): a background item's meta line read "11 minbackground" — the role
  // word was a separate span with no separator — and at 1440 it wrapped as "11 / min background".
  // It is one string now, parts joined with " · ", the minutes on a no-break space, the role word
  // only for a background item. (The DOM cannot measure a wrap; the no-break space is what pins it.)
  it("joins the Read next meta line's parts with · in one string: §heading · p.N · N min · background, with no 'minbackground' (P9-05, X10)", () => {
    const lines = (html: string) => [...html.matchAll(/<p class="[^"]*text-meta[^"]*">([^<]*)<\/p>/g)].map((match) => match[1]);
    const html = render();

    // The question's two surviving rows, in order: the answer row has no role word, the background row ends in it.
    expect(lines(html)).toEqual([`§2 Results · p.7 · 3${NB}min`, `§1 Introduction · p.2 · 2${NB}min · background`]);
    expect(html).not.toContain("minbackground");
    expect(html.replace(NB, " ")).not.toMatch(/min\s*background/);
    // The role word is not a span of its own any more.
    expect(html).not.toContain("<span class=\"ml-2\">background</span>");
    // The minutes never wrap apart: the space between the number and "min" is the no-break one.
    for (const line of lines(html)) expect(line).toMatch(new RegExp(`\\d+${NB}min`));
    expect(lines(html).join("")).not.toMatch(/\d min/);
    // The page keeps its plain form: "p.7", no space, no no-break space.
    expect(html).toContain("p.7 · 3");
    expect(html).not.toMatch(/p\.[\s\u00a0]\d/);
  });

  it("puts the role word last on a background row whatever the row order, and an answer row never carries it (P9-05, X10)", () => {
    const html = render({
      forYourQuestions: [
        {
          question: "Does the method improve retention?",
          verdict: "partly",
          answers: [],
          readNext: [
            { sectionId: "s1", why: "It explains the comparison baseline.", kind: "background" },
            { sectionId: "s2", why: "It reports the measured retention result.", kind: "answer" },
          ],
        },
      ],
    });
    const lines = [...html.matchAll(/<p class="[^"]*text-meta[^"]*">([^<]*)<\/p>/g)].map((match) => match[1]);

    expect(lines).toEqual([`§1 Introduction · p.2 · 2${NB}min · background`, `§2 Results · p.7 · 3${NB}min`]);
    expect(lines[1]).not.toContain("background");
  });

  it("resolves Read next against the map, including page, minutes, background and why, and silently drops an unknown id", () => {
    const html = render();

    expect(html).toContain("Read next");
    expect(html).toContain(`§2 Results · p.7 · 3${NB}min`);
    expect(html).toContain("It reports the measured retention result.");
    expect(html).toContain(`§1 Introduction · p.2 · 2${NB}min · background</p>`);
    expect(html).not.toContain("This must not render.");
  });

  // P7-14 (R10, Q6): the answers are one of the blocks BOTH tabs share, so they are no longer the
  // first thing in `additions` (which is the active tab's blocks): they are built once, as
  // `answers`, and drawn in the layout's `common` slot, after "Before you read" and above the
  // active tab's blocks — after the Decision block and before "What it proposes", as §3d 9 says,
  // on either tab. A paper with no body has no tabs and no common slot, and keeps them first in
  // its additions, as before.
  it("is built once and drawn in the common slot: after Decision, after the question field, before the additions", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    const decision = source.indexOf("decision={");
    const common = source.indexOf("common={", decision);
    const field = source.indexOf("<QuestionField", common);
    const shown = source.indexOf("{answers}", common);
    const additions = source.indexOf("additions={", common);
    const proposal = source.indexOf("<ProposalBlock", additions);

    expect(source.split("<ForYourQuestions").length - 1).toBe(1);
    expect(source).toContain("const answers = report?.forYourQuestions ? <ForYourQuestions report={report} map={reading.map} /> : null;");
    expect(decision).toBeGreaterThan(-1);
    expect(common).toBeGreaterThan(decision);
    expect(field).toBeGreaterThan(common);
    expect(shown).toBeGreaterThan(field);
    expect(additions).toBeGreaterThan(shown);
    expect(proposal).toBeGreaterThan(additions);
  });

  it("is not inside the tab's own blocks: the additions hold it only for a paper with no body, first", () => {
    const source = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");
    const additions = source.indexOf("additions={");
    const shown = source.indexOf("{!hasBody && answers}", additions);
    const proposal = source.indexOf("<ProposalBlock", additions);

    expect(additions).toBeGreaterThan(-1);
    expect(shown).toBeGreaterThan(additions);
    // First in the summary's blocks: nothing but a comment between the branch and the answers (P7-14, R9: the
    // notes band that used to follow them is a button at the right edge now, not a block here).
    expect(source.slice(source.indexOf(") : (", additions), shown).replace(/\s+/g, " ").trim()).toBe(") : ( <>");
    expect(shown).toBeLessThan(proposal);
    // Not under Paper digestion: the first branch of the additions never names it.
    const digestion = source.slice(additions, source.indexOf(") : (", additions));
    expect(digestion).not.toContain("answers");
    expect(digestion).not.toContain("<ForYourQuestions");
    expect(source).not.toContain("QuotaNotice");
  });
});
