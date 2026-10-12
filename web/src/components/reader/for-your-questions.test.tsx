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

// P9-22 (X10): the Read next meta row is a list of spans, so its words are read from the row's text (tags
// removed) — the same string whether the row is one text node or a list of parts. `metaRowsHtml` is the row's inner
// markup, for the tests that look at the parts themselves.
function metaRowsHtml(html: string): string[] {
  return [...html.matchAll(/<p class="[^"]*text-meta[^"]*">(.*?)<\/p>/g)].map((match) => match[1]);
}
function metaRows(html: string): string[] {
  return metaRowsHtml(html).map((inner) => inner.replace(/<[^>]+>/g, ""));
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
    expect(metaRows(html)).toContain(`§2 Results · p.7 · 3${NB}min`);
    expect(html).toContain("It reports the measured retention result.");
    expect(metaRows(html)).toContain(`§1 Introduction · p.2 · 2${NB}min · background`);
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
    expect(metaRows(html)).toContain(`§2 Results · p.7 · 3${NB}min`);
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
    const lines = metaRows;
    const html = render();

    // The question's two surviving rows, in order: the answer row has no role word, the background row ends in it.
    expect(lines(html)).toEqual([`§2 Results · p.7 · 3${NB}min`, `§1 Introduction · p.2 · 2${NB}min · background`]);
    expect(html).not.toContain("minbackground");
    expect(lines(html).join("\n").replace(NB, " ")).not.toMatch(/min\s*background/);
    // The role word is not a span of its own any more.
    expect(html).not.toContain("<span class=\"ml-2\">background</span>");
    // The minutes never wrap apart: the space between the number and "min" is the no-break one.
    for (const line of lines(html)) expect(line).toMatch(new RegExp(`\\d+${NB}min`));
    expect(lines(html).join("")).not.toMatch(/\d min/);
    // The page keeps its plain form: "p.7", no space, no no-break space.
    expect(lines(html).join("\n")).toContain("p.7 · 3");
    expect(html).not.toMatch(/p\.[\s\u00a0]\d/);
    expect(lines(html).join("\n")).not.toMatch(/p\.[\s\u00a0]\d/);
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
    const lines = metaRows(html);

    expect(lines).toEqual([`§1 Introduction · p.2 · 2${NB}min · background`, `§2 Results · p.7 · 3${NB}min`]);
    expect(lines[1]).not.toContain("background");
  });

  it("resolves Read next against the map, including page, minutes, background and why, and silently drops an unknown id", () => {
    const html = render();

    expect(html).toContain("Read next");
    expect(metaRows(html)).toContain(`§2 Results · p.7 · 3${NB}min`);
    expect(html).toContain("It reports the measured retention result.");
    expect(metaRows(html)).toContain(`§1 Introduction · p.2 · 2${NB}min · background`);
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

// P9-22 (A P9-W2's X10, round 3): the Read next meta row was one string, `§… · p.3 · 11 min · background`, and a
// browser set it as one run of text: at 1440 (632 px) and at 390 (350 px) it wrapped to two lines and line one ended on
// a dangling "·", with "background" alone on line two. The row is a list of parts now — the section, the page, the
// minutes, the role word — each part unbreakable (`white-space: nowrap`) and the separator the first word of the part it
// introduces ("· p.3"), the parts joined by one plain space that stands outside every part: the only place a line may
// break. So a wrapped line may begin with "· background" and none ends on a "·". The words, the order and the separators
// a screen reader or a copy gets are the string they were. (A DOM test cannot measure a wrap; it pins the markup that
// makes the wrap safe, and the measured wrap is in the P9-22 checkpoint.) The section's title is the one long part: it is
// left free to wrap inside itself.
describe("the Read next meta row never ends a line on its separator (P9-22, X10)", () => {
  interface Part {
    part: string;
    className: string;
    text: string;
  }
  const partsOf = (inner: string): Part[] =>
    [...inner.matchAll(/<span\b([^>]*)>([^<]*)<\/span>/g)].map((match) => ({
      part: /data-meta-part="([^"]*)"/.exec(match[1])?.[1] ?? "",
      className: /class="([^"]*)"/.exec(match[1])?.[1] ?? "",
      text: match[2],
    }));
  // What stands in the row outside its parts' elements.
  const outside = (inner: string) => inner.replace(/<span\b[^>]*>[^<]*<\/span>/g, "");

  const answerRow = (html: string) => metaRowsHtml(html)[0];
  const backgroundRow = (html: string) => metaRowsHtml(html)[1];

  it("puts each part in an element of its own, with the separator as the first word of the part it introduces", () => {
    const html = render();

    expect(partsOf(answerRow(html)).map(({ part, text }) => [part, text])).toEqual([
      ["section", "§2 Results"],
      ["page", "· p.7"],
      ["minutes", `· 3${NB}min`],
    ]);
    // The role word is a part too, on a background row only, with its separator in front of it.
    expect(partsOf(backgroundRow(html)).map(({ part, text }) => [part, text])).toEqual([
      ["section", "§1 Introduction"],
      ["page", "· p.2"],
      ["minutes", `· 2${NB}min`],
      ["role", "· background"],
    ]);
  });

  it("starts no part but the first with anything except '· ', and ends none on a separator or a space", () => {
    const html = render();

    for (const inner of [answerRow(html), backgroundRow(html)]) {
      const parts = partsOf(inner);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      parts.forEach(({ text }, index) => {
        expect(text, text).toMatch(index === 0 ? /^[^\s·]/ : /^· \S/);
        expect(text, text).not.toMatch(/[\s·]$/);
      });
    }
  });

  it("makes every short part unbreakable and leaves the section's title free to wrap inside itself", () => {
    const html = render();

    for (const inner of [answerRow(html), backgroundRow(html)]) {
      const parts = partsOf(inner);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      for (const { part, className, text } of parts) {
        if (part === "section") expect(className.split(/\s+/), text).not.toContain("whitespace-nowrap");
        else expect(className.split(/\s+/), text).toContain("whitespace-nowrap");
      }
    }
  });

  it("joins the parts with one plain space that stands outside every part, and nothing else stands outside them", () => {
    const html = render();

    for (const inner of [answerRow(html), backgroundRow(html)]) {
      const parts = partsOf(inner);
      expect(parts.length).toBeGreaterThanOrEqual(3);
      // The only break opportunity between two parts is that space: it is not inside either of them, so a line can
      // end on it and the next begin with "· …", and a part can neither end on the separator nor be split from it.
      expect(outside(inner)).toBe(" ".repeat(parts.length - 1));
      expect(inner).not.toMatch(/<\/span><span/);
    }
  });

  it("a section with no page has no page part and no doubled separator: the minutes' part opens the row's tail", () => {
    const noPage: ReadingMap = { sections: [{ id: "a", heading: "4 Appendix", canonical: "body", role: "body", words: 150, minutes: 1, paragraphs: [] }], totalMinutes: 1 };
    const html = renderToStaticMarkup(
      createElement(ForYourQuestions, {
        report: { forYourQuestions: [{ question: "Is there a survey?", verdict: "partly", answers: [], readNext: [{ sectionId: "a", why: "It lists the survey instrument.", kind: "background" }] }] },
        map: noPage,
      }),
    );
    const inner = metaRowsHtml(html)[0];

    expect(partsOf(inner).map(({ part, text }) => [part, text])).toEqual([
      ["section", "§4 Appendix"],
      ["minutes", `· 1${NB}min`],
      ["role", "· background"],
    ]);
    expect(metaRows(html)).toEqual([`§4 Appendix · 1${NB}min · background`]);
    expect(outside(inner)).toBe("  ");
  });

  it("keeps a long section title in the one wrappable part, with the page, the minutes and the role word whole after it", () => {
    const heading = "3 How the seaweed mulch was laid over the terrace soil, and how the soil water was logged through three dry spells";
    const long: ReadingMap = { sections: [{ id: "l", heading, canonical: "body", role: "body", page: 11, words: 2500, minutes: 11, paragraphs: [] }], totalMinutes: 11 };
    const html = renderToStaticMarkup(
      createElement(ForYourQuestions, {
        report: { forYourQuestions: [{ question: "How was it set out?", verdict: "partly", answers: [], readNext: [{ sectionId: "l", why: "How the plots were set out.", kind: "background" }] }] },
        map: long,
      }),
    );
    const parts = partsOf(metaRowsHtml(html)[0]);

    expect(parts.map(({ part, text }) => [part, text])).toEqual([
      ["section", `§${heading}`],
      ["page", "· p.11"],
      ["minutes", `· 11${NB}min`],
      ["role", "· background"],
    ]);
    expect(parts[0].className.split(/\s+/)).not.toContain("whitespace-nowrap");
    for (const part of parts.slice(1)) expect(part.className.split(/\s+/)).toContain("whitespace-nowrap");
  });

  // Green before and after (the words are the guard): whatever the markup, the row's text is the string it was.
  it("reads, to a screen reader and to a copy, as the same words in the same order with the same separators as before", () => {
    const html = render();

    expect(metaRows(html)).toEqual([`§2 Results · p.7 · 3${NB}min`, `§1 Introduction · p.2 · 2${NB}min · background`]);
    // One string for the row, whitespace included: no extra space, no line break, nothing hidden or added.
    for (const inner of metaRowsHtml(html)) {
      expect(inner).not.toMatch(/aria-hidden|aria-label|\n|<br|<wbr|&nbsp;|​/);
    }
  });
});
