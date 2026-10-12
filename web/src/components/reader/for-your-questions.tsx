"use client";

// The verified answers to the reader's own questions (P2-04). The report
// verifier has already made every claim's evidence a sentence from the paper;
// this component only presents that bounded material and resolves reading-map
// metadata locally. It never adds report terms (P3-01 owns that strip).

import { Fragment } from "react";
import type { PaperReport, QuestionAnswers } from "@/lib/papers/report";
import type { ReadingMap, ReadingMapSection } from "@/lib/papers/reading-map";
import { Band } from "@/components/ui/band";
import { EvidenceQuote } from "./evidence-quote";
import { FOR_YOUR_QUESTIONS } from "./copy";

/** The parts of a Read next meta row, in order: the section, the page when the map knows it, the minutes, and the
 * role word of a background row. */
type MetaPart = "section" | "page" | "minutes" | "role";

/** P9-22 (X10, round 3): the meta row is a list of parts, not one string. The separator belongs to the part it
 * introduces — "· p.3", "· 11 min", "· background" — so a part never opens a line without it and no line can end
 * on a "·": a line breaks only at the plain space the markup puts between two parts, never inside one. The
 * minutes still ride on a no-break space (P9-05), so "11" and "min" stay together even where the part is not
 * nowrap; the page keeps its plain `p.N`. */
export function readNextParts(
  section: ReadingMapSection,
  kind: QuestionAnswers["readNext"][number]["kind"],
): { part: MetaPart; text: string }[] {
  return [
    { part: "section", text: `§${section.heading}` },
    ...(typeof section.page === "number" ? [{ part: "page" as const, text: `· p.${section.page}` }] : []),
    { part: "minutes", text: `· ${section.minutes}\u00a0min` },
    ...(kind === "background" ? [{ part: "role" as const, text: `· ${FOR_YOUR_QUESTIONS.background}` }] : []),
  ];
}

/** The row as one string — what a screen reader and a copy hear: `§heading · p.N · N min`, then the role word for
 * a background row (P9-05). The markup is these same parts, joined by the same single space. */
export function readNextLabel(section: ReadingMapSection, kind: QuestionAnswers["readNext"][number]["kind"]): string {
  return readNextParts(section, kind)
    .map(({ text }) => text)
    .join(" ");
}

function verdict(question: QuestionAnswers): string {
  switch (question.verdict) {
    case "answered":
      return FOR_YOUR_QUESTIONS.answered;
    case "partly":
      return FOR_YOUR_QUESTIONS.partly;
    case "not_addressed":
      return FOR_YOUR_QUESTIONS.notAddressed(question.question);
    case "unverified":
      return FOR_YOUR_QUESTIONS.unverified;
  }
}

/** P2-04 (§1g.5): shown only for a report that carries verified question
 * answers. Unknown Read next ids are deliberately omitted: the verifier
 * should have removed them, but a stale response must not break the page. */
export function ForYourQuestions({
  report,
  map,
}: {
  report: Pick<PaperReport, "forYourQuestions">;
  map: ReadingMap | undefined;
}) {
  const questions = report.forYourQuestions;
  if (!questions || questions.length === 0) return null;
  const sections = new Map(map?.sections.map((section) => [section.id, section]));

  return (
    <section className="animate-fade-in-up" style={{ "--i": 0 } as React.CSSProperties}>
      <Band label={FOR_YOUR_QUESTIONS.heading} className="mt-12 mb-4" />
      <div className="space-y-8 measure">
        {questions.map((entry, questionIndex) => {
          const next = entry.readNext
            .map((item) => ({ item, section: sections.get(item.sectionId) }))
            .filter((value): value is { item: QuestionAnswers["readNext"][number]; section: ReadingMapSection } => Boolean(value.section));
          return (
            <div key={`${questionIndex}:${entry.question}`}>
              {/* The question is the reader's own words, in the same reading face as the field. */}
              <p className="font-reading text-lead leading-[1.6] text-heading reading-justify">{entry.question}</p>
              <p className="font-mono text-caption text-text-muted mt-2">{verdict(entry)}</p>

              {entry.answers.length > 0 && (
                <div className="mt-4 space-y-4">
                  {entry.answers.map((answer, answerIndex) => {
                    const section = answer.sectionId ? sections.get(answer.sectionId) : undefined;
                    const where = answer.evidenceWhere ?? section?.heading ?? "abstract";
                    const page = typeof answer.page === "number" ? answer.page : section?.page;
                    return (
                      <div key={`${answerIndex}:${answer.evidence}`}>
                        {/* Peer's prose is not a quotation; only the evidence below is paper text. */}
                        <p className="font-reading text-body leading-[1.6] text-text reading-justify">{answer.text}</p>
                        {/* The page rides inside the attribution (P2-04b), not on a line of its own. */}
                        <EvidenceQuote text={answer.evidence} where={where} page={page} />
                      </div>
                    );
                  })}
                </div>
              )}

              {next.length > 0 && (
                <div className="mt-5 space-y-2">
                  <p className="font-mono text-caption text-text-muted">{FOR_YOUR_QUESTIONS.readNext}</p>
                  <ul className="space-y-3">
                    {next.map(({ item, section }) => (
                      <li key={`${item.kind}:${item.sectionId}`}>
                        {/* One string to a reader and a copy; to the line breaker a list of whole parts (P9-22, X10).
                            Each short part is unbreakable and carries its own leading "·". The section's title is the one
                            part left free to wrap inside itself: a long heading must not run off a phone. */}
                        <p className="font-mono text-meta text-text-muted">
                          {readNextParts(section, item.kind).map(({ part, text }, index) => (
                            <Fragment key={part}>
                              {index > 0 ? " " : null}
                              <span data-meta-part={part} className={part === "section" ? undefined : "whitespace-nowrap"}>
                                {text}
                              </span>
                            </Fragment>
                          ))}
                        </p>
                        <p className="font-reading text-body-sm leading-[1.55] text-text reading-justify mt-1">{item.why}</p>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
