"use client";

// The verified answers to the reader's own questions (P2-04). The report
// verifier has already made every claim's evidence a sentence from the paper;
// this component only presents that bounded material and resolves reading-map
// metadata locally. It never adds report terms (P3-01 owns that strip).

import type { PaperReport, QuestionAnswers } from "@/lib/papers/report";
import type { ReadingMap, ReadingMapSection } from "@/lib/papers/reading-map";
import { Band } from "@/components/ui/band";
import { EvidenceQuote } from "./evidence-quote";
import { FOR_YOUR_QUESTIONS } from "./copy";

function readNextLabel(section: ReadingMapSection): string {
  return [
    `§${section.heading}`,
    ...(typeof section.page === "number" ? [`p.${section.page}`] : []),
    `${section.minutes} min`,
  ].join(" · ");
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
                        <p className="font-mono text-meta text-text-muted">
                          {readNextLabel(section)}
                          {item.kind === "background" && <span className="ml-2">{FOR_YOUR_QUESTIONS.background}</span>}
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
