"use client";

// The report's restored sections — what the reader had before the 2026-09
// rewrite, set in the reader's own vocabulary.
//
// The rewrite kept the report's evidence discipline and dropped four things
// the founder asked for back: what is new (the proposal's novelty and each
// result's), the proposal itself, why the paper is on this reader's page,
// and the paper's figures under the sections they belong to — plus a review's
// contents, a glance and today's related papers. They are here, in the old
// order, above the blocks the rewrite added.
//
// Two voices, kept apart as the rest of the page keeps them: a claim with a
// receipt (the paper's sentence, verbatim) reads as before; a block Peer
// wrote with no sentence to show for it — novelty, fit — carries a footer
// saying so, in the machine's face. Nothing here is a status string.
//
// Figures: a result's bound figure (the deep report chose it) shows as
// before. Where the report bound none, the section asks the figure service
// for one that matches its own words, as the old page did; a figure already
// on the page is never repeated, whichever section resolved it first.

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import type { Paper } from "@/types";
import type { PaperReport, PaperReportKeyResult, PaperReportReviewSection } from "@/lib/papers/report";
import { placeEvidence } from "@/lib/papers/evidence";
import { formatDayAge } from "@/lib/format";
import { Band } from "@/components/ui/band";
import { useResolvedFigure } from "@/components/paper-figure";
import { EvidenceQuote } from "./evidence-quote";
import { MattedFigure } from "./matted-figure";
import { BlockHeading } from "./block-heading";
import { FIT_KEYWORDS, GLANCE, PEERS_READING, REPORT_HEADING, WHATS_NEW } from "./copy";

const CLAIM_CLASS = "font-reading text-lead leading-[1.6] text-text";
/** The pull quote over the results: the deck's face, the headline result. */
const PULL_CLASS = "font-reading text-title-lg leading-[1.45] text-heading measure";
const FOOTER_CLASS = "font-mono text-caption text-text-faint mt-3";

function Section({
  stagger,
  children,
}: {
  stagger: number;
  children: React.ReactNode;
}) {
  return (
    <section className="animate-fade-in-up" style={{ "--i": stagger } as React.CSSProperties}>
      {children}
    </section>
  );
}

function Heading({ label }: { label: string }) {
  return <Band label={label} className="mt-12 mb-4" />;
}

// ── Figures ────────────────────────────────────────────────────────────

/**
 * Which section owns each image the page found for itself.
 *
 * Bound figures are known in render (they are on the report), so the page
 * dedupes those with a local set as it lays the sections out. The figures a
 * section asks the service for arrive later, one per section, and two
 * sections can be handed the same image; this store settles that. The first
 * section to claim a URL keeps it, every other section reads the owner and
 * stands down. An external store rather than state, so a claim is a
 * subscription event and not a setState inside an effect.
 */
export class FigureRegistry {
  private owners = new Map<string, string>();
  private listeners = new Set<() => void>();

  // Keyed by paper as well as URL, so one registry serves the page for its
  // whole life: j/k to the next paper starts that paper's claims fresh
  // without the page having to know when to make a new store.
  private static key(paperId: string, url: string): string {
    return `${paperId}${url}`;
  }

  ownerOf = (paperId: string, url: string | null): string | null =>
    url ? (this.owners.get(FigureRegistry.key(paperId, url)) ?? null) : null;

  claim(paperId: string, url: string, slot: string): void {
    const key = FigureRegistry.key(paperId, url);
    if (this.owners.has(key)) return;
    this.owners.set(key, slot);
    for (const listen of this.listeners) listen();
  }

  subscribe = (listen: () => void): (() => void) => {
    this.listeners.add(listen);
    return () => {
      this.listeners.delete(listen);
    };
  };
}

/**
 * A figure the section finds for itself — the old page's per-section lookup
 * — shown only when it is the section's own: not one the report already
 * bound somewhere on the page, and not one another section claimed first.
 */
function SectionFigure({
  paper,
  query,
  index,
  slot,
  registry,
  bound,
}: {
  paper: Paper;
  query: string;
  index: number;
  /** This section's name in the registry. */
  slot: string;
  registry: FigureRegistry;
  /** Image URLs the report bound and the page is already showing. */
  bound: ReadonlySet<string>;
}) {
  const figure = useResolvedFigure({
    itemId: paper.id,
    url: paper.linkPaper ?? paper.linkArxiv,
    doi: paper.doi,
    query,
    paperTitle: paper.title,
    figureIndex: index,
  });
  const url = figure.imageUrl && !figure.hideFigure && !bound.has(figure.imageUrl)
    ? figure.imageUrl
    : null;
  const owner = useSyncExternalStore(registry.subscribe, () => registry.ownerOf(paper.id, url));
  useEffect(() => {
    if (url) registry.claim(paper.id, url, slot);
  }, [paper.id, url, slot, registry]);
  if (!url || owner !== slot) return null;
  return <MattedFigure src={url} caption={figure.caption} />;
}

// ── Novelty ────────────────────────────────────────────────────────────

export function NoveltyBlock({
  report,
  paper,
  figure,
  registry,
  bound,
  stagger,
}: {
  report: PaperReport;
  paper: Paper;
  /** The proposal's bound figure, if the page is not already showing it. */
  figure: { url: string; caption?: string | null } | null;
  registry: FigureRegistry;
  bound: ReadonlySet<string>;
  stagger: number;
}) {
  const novelty = report.whatItProposes.novelty ?? [];
  if (novelty.length === 0) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.novelty} />
      <div className="space-y-4 measure">
        {novelty.map((sentence, i) => (
          <p key={`${i}:${sentence}`} className={CLAIM_CLASS}>
            {sentence}
          </p>
        ))}
      </div>
      <p className={FOOTER_CLASS}>{PEERS_READING}</p>
      {figure ? (
        <MattedFigure src={figure.url} caption={figure.caption} />
      ) : (
        <SectionFigure
          paper={paper}
          query={novelty[0]}
          index={0}
          slot="novelty"
          registry={registry}
          bound={bound}
        />
      )}
    </Section>
  );
}

// ── Proposal ───────────────────────────────────────────────────────────

export function ProposalBlock({ report, stagger }: { report: PaperReport; stagger: number }) {
  const summary = report.whatItProposes.summary.trim();
  if (!summary) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.proposal} />
      <p className={`${CLAIM_CLASS} measure`}>{summary}</p>
    </Section>
  );
}

// ── Results ────────────────────────────────────────────────────────────

function Receipt({
  claim,
  abstractSentences,
}: {
  claim: Pick<PaperReportKeyResult, "evidence" | "evidenceWhere">;
  abstractSentences: string[];
}) {
  // An abstract sentence is answered by the ink above, not repeated.
  if (placeEvidence(claim.evidence, abstractSentences).kind === "mark") return null;
  return <EvidenceQuote text={claim.evidence} where={claim.evidenceWhere ?? "abstract"} />;
}

/**
 * The results, with the headline over them and each result's own novelty
 * line and figure under it — the old "Results & significance", on the
 * rewrite's own results heading.
 */
export function ResultsBlock({
  report,
  paper,
  abstractSentences,
  figures,
  registry,
  bound,
  stagger,
}: {
  report: PaperReport;
  paper: Paper;
  abstractSentences: string[];
  /** Per result, its bound figure when the page is not already showing it. */
  figures: ReadonlyArray<{ url: string; caption?: string | null } | null>;
  registry: FigureRegistry;
  bound: ReadonlySet<string>;
  stagger: number;
}) {
  const results = report.resultsAndSignificance.keyResults;
  const summary = report.resultsAndSignificance.summary.trim();
  if (results.length === 0 && !summary) return null;
  return (
    <Section stagger={stagger}>
      <BlockHeading block="findings" />
      {summary && <p className={`${PULL_CLASS} mb-6`}>{summary}</p>}
      <div className="space-y-6 measure">
        {results.map((result, i) => (
          // Keyed by position: a model can write the same title twice.
          <div key={`${i}:${result.title}`}>
            <p className={CLAIM_CLASS}>
              <b className="font-medium text-heading">{result.title}.</b> {result.detail}
            </p>
            <Receipt claim={result} abstractSentences={abstractSentences} />
            {result.novelty && (
              <p className="font-reading text-body leading-[1.55] text-text-muted mt-2">
                <span className="font-mono text-meta text-text-faint mr-2">{WHATS_NEW}</span>
                {result.novelty}
              </p>
            )}
            {figures[i] ? (
              <MattedFigure src={figures[i]!.url} caption={figures[i]!.caption} />
            ) : result.figureImageUrl ? null : (
              // Bound elsewhere on the page already, or never bound: only the
              // latter asks the service.
              <SectionFigure
                paper={paper}
                query={`${result.title} ${result.detail}`}
                index={i + 1}
                slot={`result-${i}`}
                registry={registry}
                bound={bound}
              />
            )}
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── A review's contents ────────────────────────────────────────────────

export function ReviewContentsBlock({
  sections,
  stagger,
}: {
  sections: PaperReportReviewSection[];
  stagger: number;
}) {
  if (sections.length === 0) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.review} />
      <div className="space-y-5 measure">
        {sections.map((section, i) => (
          <div key={`${i}:${section.heading}`}>
            {/* The paper's own heading, in the machine's face: it is a label
                here, not the paper's prose. */}
            <p className="font-mono text-meta text-heading">{section.heading}</p>
            <p className={`${CLAIM_CLASS} mt-1`}>{section.summary}</p>
          </div>
        ))}
      </div>
    </Section>
  );
}

// ── Why it fits you ────────────────────────────────────────────────────

/** The reader's own terms, set heavier where a reason names them. */
function emphasise(text: string, terms: string[]): React.ReactNode[] {
  const cleaned = terms.map((t) => t.trim()).filter((t) => t.length >= 2);
  if (cleaned.length === 0) return [text];
  // Longest first, so "solid state" is not split by "state".
  const pattern = new RegExp(
    `(${[...cleaned]
      .sort((a, b) => b.length - a.length)
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
      .join("|")})`,
    "gi",
  );
  return text.split(pattern).map((part, i) =>
    i % 2 === 1 ? (
      <b key={i} className="font-medium text-heading">
        {part}
      </b>
    ) : (
      part
    ),
  );
}

export function FitBlock({
  fit,
  terms,
  stagger,
}: {
  fit: NonNullable<PaperReport["whyItFitsYou"]>;
  /** The reader's topics, emphasised where a reason names them. */
  terms: string[];
  stagger: number;
}) {
  if (fit.reasons.length === 0 && fit.keywords.length === 0) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.fit} />
      {fit.reasons.length > 0 && (
        <div className="space-y-4 measure">
          {fit.reasons.map((reason, i) => (
            <p key={`${i}:${reason}`} className={CLAIM_CLASS}>
              {emphasise(reason, terms)}
            </p>
          ))}
        </div>
      )}
      {fit.keywords.length > 0 && (
        <p className="font-mono text-meta text-text-muted mt-4">
          <span className="text-text-faint mr-2">{FIT_KEYWORDS}</span>
          {fit.keywords.join(" · ")}
        </p>
      )}
      <p className={FOOTER_CLASS}>{PEERS_READING}</p>
    </Section>
  );
}

// ── At a glance ────────────────────────────────────────────────────────

export function GlanceBlock({
  paper,
  now,
  stagger,
}: {
  paper: Paper;
  now: number;
  stagger: number;
}) {
  const facts: string[] = [];
  if (paper.source === "arxiv" || paper.linkArxiv) facts.push(GLANCE.preprint);
  else if (paper.venue) facts.push(GLANCE.journal(paper.venue));
  if (paper.linkCode) facts.push(GLANCE.code);
  const age = formatDayAge(paper.publishedDate, now);
  if (age) facts.push(age);
  if (paper.authors.length > 0) facts.push(GLANCE.team(paper.authors.length));
  if (typeof paper.relevanceScore === "number" && paper.relevanceScore > 0) {
    facts.push(GLANCE.match(paper.relevanceScore));
  }
  if (facts.length === 0) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.glance} />
      <ul className="font-mono text-meta text-text-muted space-y-1.5">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
    </Section>
  );
}

// ── Related from your feed ─────────────────────────────────────────────

/**
 * The old page's picker: today's other papers, by shared keywords first,
 * then the same venue, then Peer's own score.
 */
export function pickRelated(current: Paper, pool: Paper[], limit = 3): Paper[] {
  const kw = new Set(current.summaryExperimentKeywords.map((k) => k.toLowerCase()));
  return pool
    .filter((p) => p.id !== current.id)
    .map((p) => {
      const sharedKw = p.summaryExperimentKeywords.filter((k) => kw.has(k.toLowerCase())).length;
      const sameVenue = p.venue && p.venue === current.venue ? 1 : 0;
      return { p, score: sharedKw * 2 + sameVenue + (p.relevanceScore ?? 0) };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.p);
}

export function RelatedBlock({
  related,
  now,
  stagger,
}: {
  related: Paper[];
  now: number;
  stagger: number;
}) {
  if (related.length === 0) return null;
  return (
    <Section stagger={stagger}>
      <Heading label={REPORT_HEADING.related} />
      <ul className="space-y-4 measure">
        {related.map((p) => (
          <li key={p.id}>
            <Link
              href={`/papers/${encodeURIComponent(p.id)}`}
              className="font-reading text-lead leading-[1.4] text-heading transition-colors duration-150 ease-snap hover:text-text"
            >
              {p.title}
            </Link>
            <p className="font-mono text-meta text-text-faint mt-1">
              {[p.venue, p.publishedDate ? formatDayAge(p.publishedDate, now) : null]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </li>
        ))}
      </ul>
    </Section>
  );
}
