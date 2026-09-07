"use client";

// The reading surface — one paper, in a fixed order the reader learns once:
// the plate and title, the abstract as written with the claim and the
// numbers in ink, one sentence saying what Peer has and has not read, and
// the decision. Everything below the decision is the paper's own sentences
// (from the server reading) or a model claim carrying one (from the report);
// both arrive after first paint and change nothing above.
//
// The page holds the wiring — which paper, the store, the keys, the swipe,
// when "read" happens — and the components in `components/reader/` hold the
// blocks. No status string is typed here: the Decision sentence is
// `describeAvailability`'s, the keys are `PAPER_KEYS`, absence is `omitted`.

import { use, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { apiFetch } from "@/lib/api";
import { PageContainer } from "@/components/ui/page-container";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { hasImmediateFeedHistoryEntry } from "@/lib/navigation/feed-history";
import { NONE } from "@/lib/navigation/card-focus";
import { paperNav } from "@/lib/reader/paper-nav";
import { registerReaderActions, type ReaderActions } from "@/lib/reader/reader-keys";
import { recommendationLine } from "@/lib/reader/recommendation";
import { allocatePlateTerms } from "@/lib/papers/plate-terms";
import { placeEvidence } from "@/lib/papers/evidence";
import {
  describeAvailability,
  omittedForReader,
  sharedTerms,
  type AvailabilityReport,
} from "@/lib/papers/reading";
import { readingToMarkdown } from "@/lib/papers/reading-markdown";
import type { Claim, PaperReport } from "@/lib/papers/report";
import { reportProviderConfigured } from "@/components/reports/provider-configured";
import { PaperPlate } from "@/components/cards/paper-plate";
import { SwipeableCard } from "@/components/cards/swipe-card";
import { useResolvedFigure } from "@/components/paper-figure";
import { Rail } from "@/components/reader/rail";
import { TitleBlock } from "@/components/reader/title-block";
import { PaperWords } from "@/components/reader/paper-words";
import { DecisionBlock } from "@/components/reader/decision-block";
import { QuoteList } from "@/components/reader/quote-list";
import { ClaimList, KeyResultList } from "@/components/reader/claim-list";
import { NextRow } from "@/components/reader/next-row";
import { LoadingMat } from "@/components/reader/loading-mat";
import { ReaderToast, useReaderToast } from "@/components/reader/reader-toast";
import { ReaderLayout, useSpread } from "@/components/reader/reader-layout";
import { PAGE_CLASS, SPREAD_GRID } from "@/components/reader/spread";
import { useReading } from "@/components/reader/use-reading";
import { useModelReport } from "@/components/reader/use-model-report";
import {
  NOT_FOUND,
  RAIL,
  SWIPE,
  TOAST,
  plateCaption,
  sharedTermsLine,
} from "@/components/reader/copy";

/** The Decision block has been seen: this share of it, for this long. */
const DECIDED_VISIBLE = 0.6;
const DECIDED_MS = 1000;

function paperHref(id: string): string {
  return `/papers/${id}`;
}

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Where each model claim's evidence lands: an ink mark on an abstract
 * sentence, or a quote under the claim. The marks replace the reading's own
 * once a report is on the page, so the abstract is emphasised by what the
 * model actually cited and never repeated below.
 */
function evidenceMarks(report: PaperReport, sentences: string[]): number[] {
  const claims: Pick<Claim, "evidence">[] = [
    ...report.skim,
    ...report.whatItProposes.methods,
    ...report.resultsAndSignificance.keyResults,
    ...(report.limitations ?? []),
    ...(report.relationToYourWork?.items ?? []),
    ...(report.nextStep ? [report.nextStep] : []),
  ];
  const marks = new Set<number>();
  for (const claim of claims) {
    const placed = placeEvidence(claim.evidence, sentences);
    if (placed.kind === "mark") marks.add(placed.index);
  }
  return [...marks].sort((a, b) => a - b);
}

/** The clipboard, where the page has one: an insecure origin (a phone on the LAN) has none. */
function clipboard(): Clipboard | undefined {
  return typeof navigator !== "undefined" ? navigator.clipboard : undefined;
}

export default function PaperReadingPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const router = useRouter();
  const { id: rawId } = use(params);
  const id = (() => {
    try {
      return decodeURIComponent(rawId);
    } catch {
      return rawId;
    }
  })();
  const isExternalId = id.startsWith("openalex:") || id.startsWith("arxiv:");

  const feedPapers = useFeedStore((s) => s.papers);
  const savedPapers = useFeedStore((s) => s.savedPapers);
  const feedbackForId = useFeedStore((s) => s.paperFeedback[id]);
  const pending = useFeedStore((s) => s.pendingDismissal);

  const [fetchResult, setFetchResult] = useState<{
    id: string;
    paper: Paper | null;
    done: boolean;
  }>(() => ({ id, paper: null, done: false }));

  // A skip removes the paper from both lists before the route changes. For
  // that render the pending dismissal still holds it, so the reader stays
  // mounted (its swipe finishes, no mat flashes, no fetch fires) until the
  // navigation unmounts it.
  const pendingPaper =
    pending?.kind === "paper" && pending.id === id ? (pending.item as Paper) : undefined;
  const storePaper =
    feedPapers.find((p) => p.id === id) ??
    savedPapers.find((p) => p.id === id) ??
    pendingPaper;

  // Many publishers do not share abstracts with OpenAlex, so the store paper
  // may have an empty summaryIntro. Then the API-fetched paper, which
  // enriches missing abstracts, is preferred.
  const storePaperIsEnriched = !!storePaper?.summaryIntro?.trim();
  const fetchedPaperForId = fetchResult.id === id ? fetchResult.paper : null;
  const fetchDoneForId = fetchResult.id === id && fetchResult.done;
  const baseContent = storePaperIsEnriched
    ? storePaper
    : (fetchedPaperForId ?? storePaper ?? undefined);
  // Live state from the store (save flag + feedback) merged onto the resolved
  // content, so a fetched paper reflects save/like clicks. Memoised so the
  // `paper` reference is stable when nothing material changed.
  const isSavedInStore = savedPapers.some((p) => p.id === id);
  const paper = useMemo(
    () =>
      baseContent
        ? {
            ...baseContent,
            isSaved: isSavedInStore || baseContent.isSaved,
            feedback: feedbackForId ?? baseContent.feedback,
          }
        : undefined,
    [baseContent, isSavedInStore, feedbackForId],
  );
  const shouldFetchById =
    isExternalId && !storePaperIsEnriched && !fetchDoneForId && !pendingPaper;

  useEffect(() => {
    if (!shouldFetchById) return;
    let cancelled = false;
    apiFetch<Paper>(`/api/papers/${encodeURIComponent(id)}`)
      .then((p) => {
        if (!cancelled) setFetchResult({ id, paper: p, done: true });
      })
      .catch(() => {
        if (!cancelled) setFetchResult({ id, paper: null, done: true });
      });
    return () => {
      cancelled = true;
    };
  }, [id, shouldFetchById]);

  if (!paper) {
    if (shouldFetchById) {
      return (
        // The page's own container and grid, so from xl the mat stands in the
        // panel column at the plate's width and the plate replaces it in place.
        <PageContainer width="spread" className={PAGE_CLASS}>
          <div className={SPREAD_GRID}>
            <div>
              <LoadingMat />
            </div>
          </div>
        </PageContainer>
      );
    }
    return (
      <PageContainer width="spread" className={PAGE_CLASS}>
        <div className={SPREAD_GRID}>
          <div>
            <p className="font-reading text-lead text-text-muted">{NOT_FOUND}</p>
            <BackToFeedLink
              onBack={() => router.back()}
              className="font-sans text-meta text-text-faint hover:text-heading mt-3 inline-block"
            >
              {RAIL.back}
            </BackToFeedLink>
          </div>
        </div>
      </PageContainer>
    );
  }

  // The reason comes from the briefing's own copy, never the fetched one:
  // `/api/papers/[id]` stamps a deep-link line that is not a reason, and a
  // briefing paper with no abstract in the store is read from that route.
  return <Reader paper={paper} reason={recommendationLine(storePaper?.relevanceReason)} />;
}

function Reader({
  paper,
  reason,
}: {
  paper: Paper;
  /** The briefing's `relevanceReason`, already known to be a real one; null otherwise. */
  reason: string | null;
}) {
  const router = useRouter();
  const profile = useProfileStore((s) => s.profile);
  const feedPapers = useFeedStore((s) => s.papers);
  const markRead = useFeedStore((s) => s.markRead);
  const [now] = useState(() => Date.now());
  // ≥ xl: the spread. Owned here so the decided-read observer can follow the
  // DecisionBlock when the structure switches and it remounts.
  const spread = useSpread();

  const nav = useMemo(
    () => paperNav(feedPapers.map((p) => p.id), paper.id),
    [feedPapers, paper.id],
  );
  const nextPaper = nav.nextId ? (feedPapers.find((p) => p.id === nav.nextId) ?? null) : null;

  const { reading, fromServer } = useReading(paper);
  const model = useModelReport({ paper, profile });
  const report = model.report;

  const providerConfigured = reportProviderConfigured(profile);
  const projectText = useMemo(
    () => [profile.currentProject, profile.currentChallenges].filter(Boolean).join("\n"),
    [profile.currentProject, profile.currentChallenges],
  );
  const profileHasProject = projectText.trim().length > 0;

  // The report's provenance in the shape the reading's sentence table takes;
  // the reading never imports the report type. `deepRequested` is the
  // reader's setting: an abstract-basis report with deep on means the full
  // text was walled or unfound, and the sentence must not say "turn on deep".
  const deepRequested = Boolean(profile.deepReportEnabled);
  const availability = useMemo<AvailabilityReport | null>(
    () =>
      report
        ? {
            basis: report.provenance.basis,
            droppedClaims: report.provenance.droppedClaims,
            sourceKind: report.provenance.sourceKind ?? report.sourceKind,
            pageCount: report.provenance.pageCount,
            deepRequested,
          }
        : null,
    [report, deepRequested],
  );
  const sentences = useMemo(
    () =>
      reading
        ? describeAvailability({
            reading,
            report: availability,
            providerConfigured,
            profileHasProject,
            modelFailed: model.failed,
          })
        : [],
    [reading, availability, providerConfigured, profileHasProject, model.failed],
  );

  // The plate's own terms — allocated across the briefing when the paper is
  // in it, so the plate here is the plate on the card; alone otherwise.
  const plateTerms = useMemo(() => {
    const pool = nav.index !== NONE ? feedPapers : [paper];
    return allocatePlateTerms(pool, profile.researchTopics)[paper.id] ?? [];
  }, [feedPapers, nav.index, paper, profile.researchTopics]);
  const shared = useMemo(() => sharedTerms(plateTerms, projectText), [plateTerms, projectText]);

  // The same args as the card and the plate, so all three read the one
  // `/api/figure` entry. The plate shows the figure; this reads its caption.
  const resolvedFigure = useResolvedFigure({
    itemId: paper.id,
    url: paper.linkPaper ?? paper.linkArxiv,
    doi: paper.doi,
    paperTitle: paper.title,
  });
  const boundFigure = report?.whatItProposes.figureImageUrl
    ? {
        imageUrl: report.whatItProposes.figureImageUrl,
        caption: report.whatItProposes.figureCaption ?? null,
      }
    : null;
  const caption = plateCaption(
    boundFigure
      ? boundFigure.caption
      : resolvedFigure.imageUrl && !resolvedFigure.hideFigure
        ? resolvedFigure.caption
        : null,
  );

  const abstractSentences = useMemo(() => reading?.abstract.sentences ?? [], [reading]);
  const marks = useMemo(() => {
    if (!reading) return [];
    if (!report) return reading.abstract.marks;
    const placed = evidenceMarks(report, reading.abstract.sentences);
    return placed.length > 0 ? placed : reading.abstract.marks;
  }, [reading, report]);
  const quotedSkim = useMemo(
    () =>
      report
        ? report.skim.filter(
            (claim) => placeEvidence(claim.evidence, abstractSentences).kind === "quote",
          )
        : [],
    [report, abstractSentences],
  );

  const [toast, showToast] = useReaderToast();

  // ── Decided-read ──
  // Read means decided: the Decision block seen, or a decision made. Not
  // "opened" — that marked a paper read before its title had been looked at.
  // On the spread the decision is on screen at open, so seeing it says
  // nothing; there "seen" is the end of the paper's words (the abstract's
  // footer) on screen for the same second — the one-column rule
  // re-expressed, since in one column the decision sits under the abstract.
  // A page with no words (record only) falls back to the decision, which
  // keeps it read on open, as v0.13.1 says.
  const decide = useCallback(() => markRead(paper.id), [markRead, paper.id]);
  const decisionRef = useRef<HTMLDivElement>(null);
  const wordsEndRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    const el = spread ? (wordsEndRef.current ?? decisionRef.current) : decisionRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.intersectionRatio >= DECIDED_VISIBLE) {
          if (timer === undefined) timer = window.setTimeout(decide, DECIDED_MS);
        } else if (timer !== undefined) {
          window.clearTimeout(timer);
          timer = undefined;
        }
      },
      { threshold: [DECIDED_VISIBLE] },
    );
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearTimeout(timer);
    };
    // `spread` chooses the target and re-runs the effect when the layout
    // switches, so the observer attaches to the remounted block; `reading`
    // re-attaches when the words (and their footer) arrive or change.
  }, [decide, spread, reading]);

  // ── Actions ──
  // One set for the keys, the buttons and the swipe.
  const save = () => {
    const store = useFeedStore.getState();
    if (paper.isSaved) store.unsavePaper(paper.id);
    else store.savePaper(paper);
    decide();
  };
  const skip = () => {
    // Read the order before the store drops this paper from it.
    const store = useFeedStore.getState();
    const here = paperNav(store.papers.map((p) => p.id), paper.id);
    store.notInterestedPaper(paper);
    decide();
    router.push(here.nextId ? paperHref(here.nextId) : "/");
  };
  const like = () => {
    useFeedStore.getState().moreLikePaper(paper);
    decide();
  };
  const next = () => {
    if (!nav.nextId) return;
    decide();
    router.push(paperHref(nav.nextId));
  };
  const prev = () => {
    if (!nav.prevId) return;
    decide();
    router.push(paperHref(nav.prevId));
  };
  const undoOrToggleRead = () => {
    const store = useFeedStore.getState();
    if (store.pendingDismissal) store.undoDismiss();
    else if (store.readItems[paper.id]) store.markUnread(paper.id);
    else store.markRead(paper.id);
  };
  const open = () => {
    if (!reading?.source) return;
    window.open(reading.source.url, "_blank", "noopener,noreferrer");
    decide();
  };
  const copy = () => {
    const clip = clipboard();
    if (!reading || !clip) return;
    const markdown = readingToMarkdown(
      paper,
      { ...reading, omitted: omittedForReader(reading, availability, profileHasProject) },
      report,
      sentences,
    );
    clip
      .writeText(markdown)
      .then(() => showToast(TOAST.copied(wordCount(markdown))))
      .catch(() => {
        /* the clipboard refused; nothing to confirm */
      });
    decide();
  };
  const copyDoi = () => {
    const clip = clipboard();
    if (!paper.doi || !clip) return;
    clip
      .writeText(paper.doi)
      .then(() => showToast(TOAST.doi))
      .catch(() => {
        /* the clipboard refused; nothing to confirm */
      });
  };
  const back = () => {
    if (hasImmediateFeedHistoryEntry(window)) router.back();
    else router.push("/");
  };

  // Registered after every render so the keyboard layer always calls this
  // render's closures; the unregister is identity-guarded, so the cleanup
  // of the previous set never clears the new one.
  useEffect(() => {
    const actions: ReaderActions = {
      next,
      prev,
      save,
      skip,
      like,
      undoOrToggleRead,
      open,
      copy,
      back,
    };
    return registerReaderActions(actions);
  });

  if (!reading) return null;

  // Only a paper from today's briefing, and only when there are topics for
  // it to have matched; a deep link has no reason to show.
  const recommendation =
    nav.index !== NONE && profile.researchTopics.length > 0 ? reason : null;
  // No provider means the sentence names a key; the link is the way to one.
  // A record-only page names no key, so it gets no link.
  const sectionsRead =
    reading.provenance.fullText === "html" || reading.provenance.fullText === "pdf";
  const showAddKey =
    !providerConfigured &&
    !report &&
    reading.omitted.some((entry) => entry.reason === "needs_key") &&
    !(reading.provenance.abstract === "none" && !sectionsRead);

  const keyResults = report?.resultsAndSignificance.keyResults ?? [];
  const methods = report?.whatItProposes.methods ?? [];
  const limitations = report?.limitations ?? [];
  const relation = report?.relationToYourWork;
  const nextStep = report?.nextStep ?? null;
  const shownFigures = new Set(boundFigure ? [boundFigure.imageUrl] : []);
  // Blocks that were not there at first paint fade in, staggered in order.
  let stagger = 0;

  return (
    // `tabIndex={-1}`: Next's layout router focuses the segment's first
    // element after a client navigation, and an article that cannot take
    // focus makes that a no-op — j/k would change the paper without
    // assistive technology announcing anything.
    <PageContainer width="spread" className={`${PAGE_CLASS} outline-none`} tabIndex={-1}>
      {/* The blocks, in the spec's order; `ReaderLayout` places them — one
          column below xl, the spread from it. Later-arriving content (the
          server reading, a model report) is `additions`: on the spread it
          lands only in the right column, so nothing can move the decision;
          in one column it is below the decision, as before. */}
      <ReaderLayout
        spread={spread}
        rail={<Rail nav={nav} onBack={() => router.back()} />}
        plate={
          // A real figure: the caption is the image's, read once, from the figcaption.
          <figure className="mt-4">
            <SwipeableCard
              onSwipeRight={save}
              onSwipeLeft={skip}
              rightLabel={paper.isSaved ? SWIPE.unsave : SWIPE.save}
              leftLabel={SWIPE.notInterested}
              rightActive={paper.isSaved}
              className="shadow-card"
            >
              <PaperPlate
                paper={paper}
                terms={plateTerms}
                figure={boundFigure}
                imageAlt={caption ? "" : undefined}
              />
            </SwipeableCard>
            {caption && (
              <figcaption className="font-sans text-meta text-text-muted mt-2">
                {caption}
              </figcaption>
            )}
          </figure>
        }
        title={<TitleBlock paper={paper} recommendation={recommendation} now={now} />}
        words={
          <PaperWords
            endRef={wordsEndRef}
            reading={reading}
            marks={marks}
            skim={report?.skim ?? []}
            basis={report?.provenance.basis ?? null}
            quotedSkim={quotedSkim}
          />
        }
        decision={
          <DecisionBlock
            ref={decisionRef}
            sentences={sentences}
            stage={model.stage}
            source={reading.source}
            doi={paper.doi}
            isSaved={paper.isSaved}
            showAddKey={showAddKey}
            onSave={save}
            onSkip={skip}
            onCopy={copy}
            onOpen={decide}
            onCopyDoi={copyDoi}
          />
        }
        additions={
          <>
            {keyResults.length > 0 ? (
              <KeyResultList
                results={keyResults}
                abstractSentences={abstractSentences}
                stagger={stagger++}
                shownFigures={shownFigures}
              />
            ) : (
              fromServer && (
                <QuoteList block="findings" quotes={reading.findings} stagger={stagger++} />
              )
            )}

            {methods.length > 0 ? (
              <ClaimList
                block="method"
                claims={methods}
                abstractSentences={abstractSentences}
                stagger={stagger++}
              />
            ) : (
              fromServer && (
                <QuoteList block="method" quotes={reading.method} stagger={stagger++} />
              )
            )}

            {limitations.length > 0 ? (
              <ClaimList
                block="caveats"
                claims={limitations}
                abstractSentences={abstractSentences}
                stagger={stagger++}
              />
            ) : (
              fromServer && (
                <QuoteList block="caveats" quotes={reading.caveats} stagger={stagger++} />
              )
            )}

            {relation && relation.items.length > 0 ? (
              <ClaimList
                block="forYou"
                claims={relation.items}
                abstractSentences={abstractSentences}
                stagger={stagger++}
                anchor={relation.basedOn}
              />
            ) : (
              shared.length > 0 && (
                <section>
                  <p className="font-reading text-lead leading-[1.6] text-text mt-12">
                    {sharedTermsLine(shared)}
                  </p>
                </section>
              )
            )}

            {nextStep?.text && (
              <ClaimList
                block="nextStep"
                claims={[nextStep]}
                abstractSentences={abstractSentences}
                stagger={stagger++}
              />
            )}
          </>
        }
        next={<NextRow nav={nav} next={nextPaper} />}
      />
      <ReaderToast toast={toast} />
    </PageContainer>
  );
}
