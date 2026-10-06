"use client";

// The reading surface — one paper, in a fixed order the reader learns once:
// the plate and title, the abstract as written with the claim and the
// numbers in ink, one sentence saying what Peer has and has not read, and
// the decision. Below the decision, first the report as it read before the
// 2026-09 rewrite — the proposal (what is new, folded in — S6), how it was
// done, the results with their figures, a review's contents, a glance, and
// today's related papers (components/reader/report-sections.tsx) — and under
// that the blocks the rewrite added: where it is thin, the next step, the
// paper itself. Both arrive after first paint and change nothing above.
//
// The page holds the wiring — which paper, the store, the keys, the swipe,
// when "read" happens — and the components in `components/reader/` hold the
// blocks. No status string is typed here: the Decision sentence is
// `describeAvailability`'s, the keys are `PAPER_KEYS`, absence is `omitted`.

import { use, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { useRouter } from "next/navigation";
import type { Paper } from "@/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { ApiError, apiFetch } from "@/lib/api";
import { PageContainer } from "@/components/ui/page-container";
import { useReveal } from "@/components/ui/reveal";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";
import { hasImmediateFeedHistoryEntry } from "@/lib/navigation/feed-history";
import { NONE } from "@/lib/navigation/card-focus";
import { paperNav } from "@/lib/reader/paper-nav";
import { paperKeysFor, registerReaderActions, type ReaderActions } from "@/lib/reader/reader-keys";
import { recommendationLine } from "@/lib/reader/recommendation";
import { allocatePlateTerms } from "@/lib/papers/plate-terms";
import { placeEvidence } from "@/lib/papers/evidence";
import {
  PDF_NO_TEXT_MESSAGE,
  describeAvailability,
  omittedForReader,
  sharedTerms,
  type AvailabilityReport,
  type PaperReading,
} from "@/lib/papers/reading";
import { readingToMarkdown } from "@/lib/papers/reading-markdown";
import type { Claim, PaperReport } from "@/lib/papers/report";
import type { Route } from "next";
import { aiAvailability } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import { PaperPlate } from "@/components/cards/paper-plate";
import { SwipeableCard } from "@/components/cards/swipe-card";
import { useResolvedFigure } from "@/components/paper-figure";
import { TitleBlock } from "@/components/reader/title-block";
import { PaperWords } from "@/components/reader/paper-words";
import { PaperBody, mergeQuestionRoute, questionRouteOverlay } from "@/components/reader/paper-body";
import { RecordBlock } from "@/components/reader/record-block";
import { InYourLibrary } from "@/components/reader/in-your-library";
import { KeyLegend } from "@/components/reader/key-legend";
import { DecisionBlock } from "@/components/reader/decision-block";
import { QuoteList } from "@/components/reader/quote-list";
import { ClaimList } from "@/components/reader/claim-list";
import {
  GlanceBlock,
  ProposalBlock,
  RelatedBlock,
  ResultsBlock,
  ReviewContentsBlock,
  FigureRegistry,
  pickRelated,
} from "@/components/reader/report-sections";
import { ForYourQuestions } from "@/components/reader/for-your-questions";
import { QuotaNotice } from "@/components/reader/quota-notice";
import { NextRow } from "@/components/reader/next-row";
import { LoadingMat } from "@/components/reader/loading-mat";
import { ReaderToast, useReaderToast } from "@/components/reader/reader-toast";
import {
  ReaderLayout,
  usePageZoom,
  useResolvedReadingScale,
  useSpread,
} from "@/components/reader/reader-layout";
import { THUMB_BAR_PX, THUMB_BAR_QUERY } from "@/components/shell/thumb-bar";
import { PAGE_CLASS, SPREAD_GRID } from "@/components/reader/spread";
import { useReading } from "@/components/reader/use-reading";
import { PaperNotes } from "@/components/notes/paper-notes";
import { PAPER_BODY_ID } from "@/components/reader/paper-body";
import { PaperContents } from "@/components/reader/paper-contents";
import { QuestionField, focusFirstEmptyQuestion } from "@/components/reader/question-field";
import { ReadingMapView, readingRoute } from "@/components/reader/reading-map";
import { SectionLinks } from "@/components/reader/evidence-quote";
import { settledQuestions, useReadingQuestionsHydrated, useReadingQuestionsStore } from "@/store/reading-questions";
import { exampleQuestions } from "@/lib/reader/question-examples";
import { useModelReport } from "@/components/reader/use-model-report";
import { usePrivateSupplement } from "@/components/reader/use-private-supplement";
import { PrivatePdfStatus } from "@/components/reader/private-pdf-status";
import { UploadButton } from "@/components/briefing/upload-button";
import { useAuthUser } from "@/components/account/use-auth-user";
import { useUploadsAvailable, uploadsReady } from "@/lib/papers/use-uploads-available";
import {
  BODY,
  NOT_FOUND,
  RAIL,
  RETRY_LABEL,
  SWIPE,
  TOAST,
  UPLOAD_RETRY_EMPTY_MESSAGE,
  UPLOAD_TRANSIENT_MESSAGE,
  UPLOAD_UNAVAILABLE_MESSAGE,
  plateCaption,
  sharedTermsLine,
} from "@/components/reader/copy";

/** The Decision block has been seen: this share of it, for this long. */
const DECIDED_VISIBLE = 0.6;
const DECIDED_MS = 1000;

/**
 * UPLOAD-FETCH-TIMEOUT: how long the fetch effect below waits on an uploaded
 * paper's own record before giving up and treating a hung server the same
 * as any other transient failure (§1bi.8b) — never the permanent 404
 * outcome (`uploadFetchErrorKind` already classifies an aborted fetch as
 * "transient" by construction: it is never an `ApiError` with
 * `status === 404`). Without this, a server that never answers leaves the
 * reader on `LoadingMat` forever instead of ever reaching the transient
 * "Try again" state. Only the upload id's own fetch gets this timeout — a
 * non-upload paper's fetch (`isExternalId`) is unchanged, as before.
 */
const UPLOAD_FETCH_TIMEOUT_MS = 15000;

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

/**
 * UPLOAD-404 (§1bi): true once the live fetch for this uploaded paper's
 * record or file has actually settled with nothing — any cause at all
 * (expired, wrong owner, purged, a different machine, a synced pointer —
 * `ownedUpload`'s single 404 hides which one), never while it is still in
 * flight or has not been attempted yet. Pure and exported so this decision
 * is directly testable: this file has no component-render harness (`Reader`
 * below reaches `useRouter`, several Zustand stores and
 * `IntersectionObserver`) — the same reason the sibling `app/page.tsx`
 * extracts `shouldAttemptBatchAcknowledgement` instead of rendering its own
 * whole effectful page.
 */
export function isUploadFetchFailure(
  isUploadId: boolean,
  fetchDoneForId: boolean,
  fetchedPaperForId: Paper | null,
): boolean {
  return isUploadId && fetchDoneForId && !fetchedPaperForId;
}

/**
 * UPLOAD-404 (§1bi.8b): whether a failed record fetch is permanent (a 404 —
 * `ownedUpload` found nothing, for any of guide B's causes) or transient (a
 * 5xx, a dropped connection, a timeout — the server or the network, not the
 * record itself). `apiFetch` (`lib/api.ts`, unchanged) throws `ApiError`
 * with a `.status` for any non-2xx HTTP response and a plain `Error`/
 * `TypeError` for a network failure — both distinguishable, which is what
 * this function reads. Pure and exported for the same testability reason
 * as `isUploadFetchFailure` above.
 */
export function uploadFetchErrorKind(error: unknown): "not-found" | "transient" {
  return error instanceof ApiError && error.status === 404 ? "not-found" : "transient";
}

/**
 * UPLOAD-404 (§1bi): the saved copy to render instead of a dead end, with
 * the one field that only ever points at THIS SAME upload's now-unreachable
 * file-bytes route removed — every place that would otherwise open it (the
 * decision block's "open" action via `pickSource`, the record block's
 * "Publisher" door, the plate) must not offer a link that fails the exact
 * same way the record fetch just did. `undefined` when there is nothing
 * saved either — the page's existing, unchanged "not found" stands then.
 */
export function resolveUploadFallback(storePaper: Paper | undefined): Paper | undefined {
  return storePaper ? { ...storePaper, linkPaper: undefined } : undefined;
}

/** What `resolveUploadPageState` decides the page should do, for an upload id. */
export interface UploadPageDecision {
  /** True whenever the honest-unavailable view (or the no-content retry
   *  view) should show instead of the normal render. */
  unavailable: boolean;
  /** The content to show inside the honest-unavailable view; `undefined`
   *  means there is nothing at all (the plain not-found / retry-empty
   *  states, distinguished by `transient`). */
  fallbackPaper: Paper | undefined;
  /** Only meaningful while `unavailable` is true: a momentary failure (5xx,
   *  network, timeout) rather than a definite fact (a 404, or a 200 whose
   *  file bytes are specifically missing). */
  transient: boolean;
}

/**
 * UPLOAD-404 (§1bi/§1bi.8): the one place that combines every signal the
 * page has about an uploaded paper's own id into what to actually show.
 * Pure and exported, the same testability reason as the other functions in
 * this group — every combination (file missing, a 404, a transient
 * failure, with and without a saved copy) is directly testable here with
 * plain values, with no fetch, no timers and no component render involved.
 */
export function resolveUploadPageState(args: {
  isUploadId: boolean;
  fetchDoneForId: boolean;
  fetchedPaperForId: Paper | null;
  errorKind: "none" | "not-found" | "transient";
  storePaper: Paper | undefined;
}): UploadPageDecision {
  // §1bi.8a: the record fetch succeeded, but this record's own PDF bytes
  // are separately missing — the freshly-fetched record is still the best
  // content to show (fresher than whatever might also be saved), and this
  // is always a definite fact: re-fetching the same successful record
  // would report the same missing bytes, so it is never "transient".
  const fileMissing =
    args.isUploadId && !!args.fetchedPaperForId && args.fetchedPaperForId.fileAvailable === false;
  const fetchFailed = isUploadFetchFailure(args.isUploadId, args.fetchDoneForId, args.fetchedPaperForId);
  return {
    unavailable: fileMissing || fetchFailed,
    fallbackPaper: fileMissing
      ? resolveUploadFallback(args.fetchedPaperForId ?? undefined)
      : fetchFailed
        ? resolveUploadFallback(args.storePaper)
        : undefined,
    // §1bi.8b: only a genuinely failed fetch can be transient.
    transient: fetchFailed && args.errorKind === "transient",
  };
}

/**
 * UPLOAD-404 (§1bi): the reading page's honest-unavailable view — shown for
 * a fetch that settled with nothing (any cause) AND for a fetch that
 * succeeded but whose PDF bytes are separately missing (§1bi.8a) — same
 * component, same content shape, either way; `paper` is already whichever
 * content the caller resolved (the freshly-fetched record when only the
 * file is the problem, else the saved copy) with `linkPaper` already
 * stripped by `resolveUploadFallback`. Exported (the same reason
 * `BriefingEmpty`/`ReadingStrip` are, in the sibling `app/page.tsx`) so it
 * is directly render-testable with `renderToStaticMarkup` (this file's own
 * test uses the same technique as `private-pdf-status.test.tsx`). Takes
 * plain `onBack`/`onRetry` callbacks rather than calling `useRouter()`
 * itself, for the same testability reason.
 *
 * Modelled on the `paper.textStatus === "empty"` branch further down in
 * `Reader`: the title, then one honest sentence, no Decision block (no
 * report is requested, no PDF-only action is offered) and no
 * `PrivatePdfStatus` (its "retained for 30 days" line would be false here —
 * this state means the opposite, for the same reason whether the record
 * itself is gone or just its bytes). Unlike that branch, this one has an
 * abstract to show (the resolved content almost always carries one —
 * `PaperWords` itself renders nothing when it truly does not) and the
 * reader's own notes, both named explicitly in the ruling.
 *
 * §1bi.8b: `transient` is true only for a 5xx/network/timeout failure — a
 * momentary blip, not a definite fact — so it alone gets a different,
 * non-permanent sentence and a Try again control. A 404 and a file
 * specifically missing are both definite (retrying would give the same
 * answer), so they share `UPLOAD_UNAVAILABLE_MESSAGE` with no retry offered.
 */
export function UploadFallbackReading({
  paper,
  reading,
  now,
  onBack,
  transient = false,
  onRetry,
}: {
  paper: Paper;
  reading: PaperReading;
  now: number;
  onBack: () => void;
  transient?: boolean;
  /** Only rendered (and only meaningful) while `transient` is true. */
  onRetry?: () => void;
}) {
  return (
    <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
      <div className={SPREAD_GRID}>
        <div>
          <TitleBlock paper={paper} recommendation={null} now={now} />
          <PaperWords reading={reading} marks={reading.abstract.marks} skim={[]} basis={null} quotedSkim={[]} />
          <p className="font-reading text-lead leading-[1.6] text-text mt-6 reading-justify">
            {transient ? UPLOAD_TRANSIENT_MESSAGE : UPLOAD_UNAVAILABLE_MESSAGE}
          </p>
          {transient && onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="font-sans text-meta text-text-faint hover:text-heading mt-2 underline underline-offset-4"
            >
              {RETRY_LABEL}
            </button>
          )}
          <PaperNotes paper={paper} />
          <BackToFeedLink
            onBack={onBack}
            className="font-sans text-meta text-text-faint hover:text-heading mt-3 inline-block"
          >
            {RAIL.back}
          </BackToFeedLink>
          <RecordBlock paper={paper} primaryUrl={reading.source?.url ?? null} />
        </div>
      </div>
    </PageContainer>
  );
}

/**
 * UPLOAD-404 (§1bi.8b): the reading page's own transient-failure empty
 * state — no content at all (no live record, no saved copy) but the
 * failure itself was momentary, so this is NOT `NOT_FOUND` (which claims a
 * permanent fact this page cannot back up). Exported for the same
 * render-testability reason as `UploadFallbackReading` above; same
 * plain-callback shape.
 */
export function UploadRetryEmpty({
  onBack,
  onRetry,
}: {
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
      <div className={SPREAD_GRID}>
        <div>
          <p className="font-reading text-lead text-text-muted">{UPLOAD_RETRY_EMPTY_MESSAGE}</p>
          <div className="mt-3 flex items-center gap-4">
            <button
              type="button"
              onClick={onRetry}
              className="font-sans text-meta text-text-faint hover:text-heading underline underline-offset-4"
            >
              {RETRY_LABEL}
            </button>
            <BackToFeedLink onBack={onBack} className="font-sans text-meta text-text-faint hover:text-heading inline-block">
              {RAIL.back}
            </BackToFeedLink>
          </div>
        </div>
      </div>
    </PageContainer>
  );
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
  // 1-31: an uploaded paper's id matches neither prefix above, so on a cold
  // load (a fresh tab on `/papers/upload:<hash16>`, nothing in the client
  // store yet) the page would otherwise fall straight to the "not found"
  // branch below instead of ever fetching the record.
  const isUploadId = id.startsWith("upload:");
  const auth = useAuthUser();
  const accountScope = auth.kind === "signed-in" ? auth.user.id : auth.kind;
  const fetchKey = `${accountScope}:${id}`;

  const feedPapers = useFeedStore((s) => s.papers);
  const savedPapers = useFeedStore((s) => s.savedPapers);
  const feedbackForId = useFeedStore((s) => s.paperFeedback[id]);
  const pending = useFeedStore((s) => s.pendingDismissal);

  const [fetchResult, setFetchResult] = useState<{
    id: string;
    paper: Paper | null;
    done: boolean;
    // UPLOAD-404 (§1bi.8b): which kind of nothing a failed fetch settled
    // with — "none" on a success (or before any attempt), so a stale kind
    // from an earlier attempt is never read for a fresh one.
    errorKind: "none" | "not-found" | "transient";
  }>(() => ({ id: fetchKey, paper: null, done: false, errorKind: "none" }));

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
  const fetchedPaperForId = fetchResult.id === fetchKey ? fetchResult.paper : null;
  const fetchDoneForId = fetchResult.id === fetchKey && fetchResult.done;
  const fetchErrorKindForId = fetchResult.id === fetchKey ? fetchResult.errorKind : "none";
  // UPLOAD-404 (§1bi/§1bi.8): every signal this page has about an upload id,
  // combined in one pure, directly-tested place — see
  // `resolveUploadPageState`'s own doc comment.
  const uploadPageState = resolveUploadPageState({
    isUploadId,
    fetchDoneForId,
    fetchedPaperForId,
    errorKind: fetchErrorKindForId,
    storePaper,
  });
  const uploadUnavailable = uploadPageState.unavailable;
  const uploadTransient = uploadPageState.transient;
  const baseContent = isUploadId
    ? (uploadUnavailable ? uploadPageState.fallbackPaper : fetchedPaperForId) ?? undefined
    : storePaperIsEnriched
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
    (isExternalId || isUploadId) && (isUploadId || !storePaperIsEnriched) && !fetchDoneForId && !pendingPaper;

  useEffect(() => {
    if (!shouldFetchById) return;
    let cancelled = false;
    // UPLOAD-FETCH-TIMEOUT: only the upload id's own record fetch gets a
    // timeout — mirrors this repo's own AbortController-based-timeout idiom
    // (lib/decisions/jev-client.ts's attemptFetch). The non-upload branch
    // below is untouched: no controller, no signal, exactly as before.
    const controller = isUploadId ? new AbortController() : undefined;
    const timer = controller
      ? window.setTimeout(() => controller.abort(), UPLOAD_FETCH_TIMEOUT_MS)
      : undefined;
    apiFetch<Paper>(
      isUploadId
        ? `/api/papers/upload/${encodeURIComponent(id.slice("upload:".length))}`
        : `/api/papers/${encodeURIComponent(id)}`,
      controller ? { signal: controller.signal } : undefined,
    )
      .then((p) => {
        if (!cancelled) setFetchResult({ id: fetchKey, paper: p, done: true, errorKind: "none" });
      })
      .catch((err: unknown) => {
        if (!cancelled) setFetchResult({ id: fetchKey, paper: null, done: true, errorKind: uploadFetchErrorKind(err) });
      })
      .finally(() => {
        if (timer !== undefined) window.clearTimeout(timer);
      });
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [id, fetchKey, shouldFetchById, isUploadId]);

  // UPLOAD-404 (§1bi.8b): the one way any failed fetch is retried — resets
  // this id's own result back to "not done", which re-arms `shouldFetchById`
  // above (already gated on `!fetchDoneForId`) so the SAME effect fires
  // again with no separate retry effect needed. The reader sees the
  // existing loading state in between, then whatever the new attempt earns.
  const retryUploadFetch = useCallback(() => {
    setFetchResult({ id: fetchKey, paper: null, done: false, errorKind: "none" });
  }, [fetchKey, setFetchResult]);

  if (!paper) {
    if (shouldFetchById) {
      return (
        // The page's own container and grid, so from xl the mat stands in the
        // panel column at the plate's width and the plate replaces it in place.
        <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
          <div className={SPREAD_GRID}>
            <div>
              <LoadingMat />
            </div>
          </div>
        </PageContainer>
      );
    }
    // UPLOAD-404 (§1bi.8b): nothing to show AND the failure was momentary —
    // never the permanent NOT_FOUND wording for a state that might well
    // resolve on its own next time.
    if (isUploadId && uploadTransient) {
      return <UploadRetryEmpty onBack={() => router.back()} onRetry={retryUploadFetch} />;
    }
    return (
      <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
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
  return (
    <Reader
      key={`${accountScope}:${paper.id}`}
      paper={paper}
      reason={recommendationLine(storePaper?.relevanceReason)}
      uploadUnavailable={uploadUnavailable}
      uploadTransient={uploadTransient}
      onRetryUpload={retryUploadFetch}
    />
  );
}

function Reader({
  paper: originalPaper,
  reason,
  uploadUnavailable,
  uploadTransient,
  onRetryUpload,
}: {
  paper: Paper;
  /** The briefing's `relevanceReason`, already known to be a real one; null otherwise. */
  reason: string | null;
  /** UPLOAD-404 (§1bi/§1bi.8a): `paper` is `PaperReadingPage`'s own
   *  fallback content — either the live fetch settled with nothing (any
   *  cause) and this is the saved copy, or the fetch succeeded but the PDF
   *  bytes are separately missing and this is the freshly-fetched record. */
  uploadUnavailable: boolean;
  /** §1bi.8b: only true for a 5xx/network/timeout failure — never for a
   *  file specifically missing (that is always a definite fact). */
  uploadTransient: boolean;
  onRetryUpload: () => void;
}) {
  const router = useRouter();
  // P1-08 (§1a.6, §1f.19): a standalone uploaded PDF — the same test as the
  // page's own `isUploadId`. Its page keeps no "Not interested, then next":
  // no Skip button, no `x skip` in the legend, no `skip` for the keyboard,
  // no swipe-left. A public paper with an attached PDF keeps all four.
  const isUploadId = originalPaper.id.startsWith("upload:");
  const { paper, upload, ready, setUpload } = usePrivateSupplement(originalPaper);
  // UPLOAD-404 (§1bi.2): whether the server can even store a NEW private PDF
  // right now — gates only the "upload a PDF" entry point below, never an
  // existing saved upload's own view/delete actions (those never call
  // `hostedUploadsEnabled()`). Skipped entirely on an upload's own page,
  // where that entry point never renders anyway (see `uploadAction` below).
  const uploadsAvailable = uploadsReady(useUploadsAvailable(!originalPaper.id.startsWith("upload:")));
  const profile = useProfileStore((s) => s.profile);
  const feedPapers = useFeedStore((s) => s.papers);
  const markRead = useFeedStore((s) => s.markRead);
  const [now] = useState(() => Date.now());
  // The sections' own figure claims, for the page's life; keyed by paper
  // inside, so j/k to the next paper starts its claims fresh.
  const [figureRegistry] = useState(() => new FigureRegistry());
  // ≥ xl: the spread. Owned here so the decided-read observer can follow the
  // DecisionBlock when the structure switches and it remounts.
  const spread = useSpread();
  // S20/S21: the page-zoom multiplier, set on the one `<PageContainer>`
  // below so its `max-w` (page-container.tsx's `spread` variant) and
  // `SPREAD_GRID`'s 2xl column track (both `calc(... * var(--reading-scale,
  // 1))`) scale together. `useResolvedReadingScale` — not the raw
  // `scaleIndex` — because it must resolve to the SAME value
  // `reader-layout.tsx` uses for the grid track, manual step or Fit's own,
  // or the panel-width invariant those two calc()s are built on breaks
  // while Fit is on (see that hook's own comment). The other 4
  // `width="spread"` call sites in this file never set this variable, so
  // `var(--reading-scale, 1)` falls back to `1` there — byte-identical to
  // before S20.
  const readingScale = useResolvedReadingScale();
  // Ruling 19 (round 7, second pass): Fit's own whole-page CSS `zoom`,
  // composing on top of `readingScale` above rather than replacing it —
  // `usePageZoom` is 1 (no-op) unless Fit is on. `--page-zoom` mirrors the
  // same number as a custom property so `globals.css`'s `reader-panel`
  // utility (a descendant, however many levels down — custom properties
  // inherit) can cancel the sticky `top` offset's own zoom-multiplication.
  const pageZoom = usePageZoom();
  const readingScaleStyle = {
    "--reading-scale": readingScale,
    zoom: pageZoom,
    "--page-zoom": pageZoom,
  } as CSSProperties;

  const nav = useMemo(
    () => paperNav(feedPapers.map((p) => p.id), paper.id),
    [feedPapers, paper.id],
  );
  const nextPaper = nav.nextId ? (feedPapers.find((p) => p.id === nav.nextId) ?? null) : null;

  const { reading, fromServer } = useReading(paper);
  // P1-05 (§1f.13): the reader's questions for this paper — a subscription,
  // so the route follows the field as it writes through. P2-03 (§1g.11 b):
  // the deep report is asked about the settled ones only (never the gist).
  const asked = useReadingQuestionsStore((state) => state.byPaper[paper.id]);
  const model = useModelReport({ paper: ready ? paper : undefined, profile, questions: settledQuestions(asked) });
  // Where Peer has read the paper, the text is already on the page — the
  // command and the contents are ways down to it, not ways to open it.
  const hasBody = (reading?.body?.length ?? 0) > 0;
  // P1-04 (§1f.12): a claim's "§Heading" links to the body section of that
  // name; the quotes read the headings from `SectionLinks` below.
  const bodyHeadings = useMemo(() => (reading?.body ?? []).map((section) => section.heading), [reading]);
  // P1-05 (§1f.13): those questions routed through the reading this page
  // holds — here, in the browser, from the live `items`.
  const tier0Route = useMemo(() => readingRoute(reading, asked), [reading, asked]);
  const readHere = useCallback(() => {
    const block = document.getElementById(PAPER_BODY_ID);
    if (!block) return;
    const top = block.getBoundingClientRect().top;
    // Only where it is not already on the screen — scrolling to a block the
    // reader is looking at throws the page for nothing.
    if (top < 0 || top > window.innerHeight * 0.6) {
      block.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);
  const report = model.report;
  // P2-04: all route consumers receive this one display route. Tier 0 still
  // stands unchanged if there is no verified report/question overlay. P2-04b:
  // the contents rail, the map and the body all take it as a `DrawRoute`
  // (the shared `RouteResult` contract is untouched), so no cast is needed.
  const route = useMemo(
    () => mergeQuestionRoute(tier0Route, questionRouteOverlay(report?.forYourQuestions)),
    [tier0Route, report?.forYourQuestions],
  );

  // S5: the "matrix" scramble reveal, restored. `revealingReportKey` is the
  // key of a report that just arrived fresh in this visit; while it matches
  // the current report's key, every report-derived text block scrambles into
  // place instead of rendering plainly. Cleared after REVEAL_DURATION_MS-scale
  // time (immediately under reduced motion) so it never lingers and re-fires
  // on an unrelated re-render.
  //
  // Setting it happens during render, not inside an effect: this is the
  // "adjust state when a prop changes" pattern React's own docs recommend
  // over an effect for exactly this shape (derive-and-store), and it is the
  // only way to avoid the react-hooks/set-state-in-effect violation 1-01
  // fixed elsewhere — an effect that calls setState unconditionally in its
  // body is the same violation, model.fresh/model.reportKey as the "prop"
  // that changed. The guard (`!== model.reportKey`) keeps this a one-time
  // adjustment per fresh report, not a render loop.
  const [revealingReportKey, setRevealingReportKey] = useState<string | null>(null);
  if (model.fresh && model.reportKey && revealingReportKey !== model.reportKey) {
    setRevealingReportKey(model.reportKey);
  }
  useEffect(() => {
    if (!revealingReportKey) return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const t = window.setTimeout(
      () => setRevealingReportKey((k) => (k === revealingReportKey ? null : k)),
      reducedMotion ? 0 : 900,
    );
    return () => window.clearTimeout(t);
  }, [revealingReportKey]);
  const shouldScrambleReport = revealingReportKey === model.reportKey && model.fresh;

  // One tier: a signed-in reader has Peer's model; a reader with their own key has theirs.
  // (2026-09-23 merge note: replaces a dangling call to `reportProviderConfigured`,
  // whose file main deleted upstream of this branch's own last edit to it —
  // `use-model-report.ts`'s own `userProviderConfigured` was already reconciled
  // to this same `aiAvailability` call during this merge.)
  const entitlement = useProfileStore((s) => s.entitlement);
  const providerConfigured = aiAvailability(profile, entitlementGrants(entitlement)) !== "none";
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
  // P1-09 (user decision §1a.7, §1f.20): the example tags under the
  // question field — the reader's questions on earlier papers, and their
  // profile asked as questions. No shared-terms gate: the profile group
  // shows whenever the profile has something in it.
  const askedByPaper = useReadingQuestionsStore((state) => state.byPaper);
  const examples = useMemo(
    () => exampleQuestions({ profile, byPaper: askedByPaper, paperId: paper.id }),
    [profile, askedByPaper, paper.id],
  );
  // The questions are read once the stores have loaded, so the field starts
  // from what this browser kept.
  const questionsHydrated = useReadingQuestionsHydrated();

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
  // A paper with neither a figure nor a term of its own has no plate at all
  // (`PaperPlate` renders nothing for it), and the card shell that frames the
  // plate must go with it — an empty swipeable card above the title reads as a
  // picture that failed to load. The page then opens on the title, which is
  // what the one-column phone layout has always done when the plate is short.
  const hasPlate =
    Boolean(boundFigure?.imageUrl) ||
    Boolean(resolvedFigure.imageUrl) ||
    plateTerms.length > 0;

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
  const decide = useCallback(() => markRead(paper.id, paper), [markRead, paper]);
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
      {
        threshold: [DECIDED_VISIBLE],
        // The phone's thumb bar is fixed over the viewport's last 56px, and
        // the observer's root is the viewport: without this the block
        // counted as 60% seen while its lower part was under the glass.
        rootMargin: window.matchMedia(THUMB_BAR_QUERY).matches
          ? `0px 0px -${THUMB_BAR_PX}px 0px`
          : "0px",
      },
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

  // The approach. One observer for every `[data-reveal]` in the scope below.
  // The deps are the two things that arrive after first paint — the server
  // reading and the model report — plus the spread flip, which remounts the
  // blocks. `useReveal` reveals anything already on screen synchronously, so
  // neither page open nor the xl flip shows an animation.
  //
  // Never make `decisionRef`'s or `wordsEndRef`'s block a `[data-reveal]`
  // host: IntersectionObserver reports geometry, not opacity, so a paper
  // would be marked read from a block sitting at opacity 0.
  useReveal([reading, report, spread]);

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
    router.push((here.nextId ? paperHref(here.nextId) : "/") as Route);
  };
  const like = () => {
    useFeedStore.getState().moreLikePaper(paper);
    decide();
  };
  const next = () => {
    if (!nav.nextId) return;
    decide();
    router.push(paperHref(nav.nextId) as Route);
  };
  const prev = () => {
    if (!nav.prevId) return;
    decide();
    router.push(paperHref(nav.prevId) as Route);
  };
  const undoOrToggleRead = () => {
    const store = useFeedStore.getState();
    if (store.pendingDismissal) store.undoDismiss();
    else if (store.readItems[paper.id]) store.markUnread(paper.id);
    else store.markRead(paper.id, paper);
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
      new Date(),
      // P2-05: the settled questions, never the gist; the report's answers ride in `report`.
      settledQuestions(asked),
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
      ...(isUploadId ? {} : { skip }),
      like,
      undoOrToggleRead,
      ...(hasBody ? { read: readHere, ask: focusFirstEmptyQuestion } : {}),
      open,
      copy,
      back,
    };
    return registerReaderActions(actions);
  });

  if (!reading) return null;

  // UPLOAD-404 (§1bi/§1bi.8a): either the live fetch for this uploaded
  // paper's record came back empty (any cause — expired, wrong owner,
  // purged, a different machine, a synced pointer — `ownedUpload` hides
  // which one behind a single 404, so this page cannot and does not guess)
  // and `paper` is `PaperReadingPage`'s own fallback onto the saved copy —
  // or the record fetch succeeded but the PDF bytes are separately missing,
  // and `paper` is that same freshly-fetched record. Either way nothing
  // below claims the file itself is still reachable. Checked BEFORE the
  // narrower `textStatus === "empty"` branch just below: content with no
  // extractable text either still gets this honest "unavailable" treatment,
  // not the unrelated "no readable text" wording (which would equally imply
  // a live file that no longer exists).
  if (uploadUnavailable) {
    return (
      <UploadFallbackReading
        paper={paper}
        reading={reading}
        now={now}
        onBack={() => router.back()}
        transient={uploadTransient}
        onRetry={uploadTransient ? onRetryUpload : undefined}
      />
    );
  }

  // S7(e) / 2-05 (A2-02): an uploaded PDF the extractor read successfully
  // but found nothing in (most likely scanned, no text layer) gets this
  // plain message, never a report — known instantly from the paper record
  // itself (`paper.textStatus`), so this renders without waiting on
  // `reading`'s own fetch to resolve the same fact through
  // `provenance.fullText === "pdf_empty"`. `useModelReport`'s own effect
  // never asks for a report for this paper either way (guarded there on
  // the same field) — this is only about what the page shows.
  if (paper.textStatus === "empty") {
    return (
      <PageContainer width="spread" rhythm="reader" className={PAGE_CLASS}>
        <div className={SPREAD_GRID}>
          <div>
            <TitleBlock paper={paper} recommendation={null} now={now} />
            <p className="font-reading text-lead leading-[1.6] text-text mt-6 reading-justify">
              {PDF_NO_TEXT_MESSAGE}
            </p>
            {upload && <PrivatePdfStatus upload={upload} onDeleted={() => router.replace("/")} />}
            <BackToFeedLink
              onBack={() => router.back()}
              className="font-sans text-meta text-text-faint hover:text-heading mt-3 inline-block"
            >
              {RAIL.back}
            </BackToFeedLink>
            <RecordBlock paper={paper} primaryUrl={reading.source?.url ?? null} />
          </div>
        </div>
      </PageContainer>
    );
  }

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
  // The report's bound figures, deduped in page order: the plate first, then
  // the proposal's, then each result's. The binder can hand one figure to
  // several places; it is shown once, at the first. Known in render, so a
  // local set does it; only the figures the sections fetch for themselves
  // need the registry.
  const boundShown = new Set<string>(boundFigure?.imageUrl ? [boundFigure.imageUrl] : []);
  const takeBound = (url: string | null | undefined, caption?: string | null) => {
    if (!url || boundShown.has(url)) return null;
    boundShown.add(url);
    return { url, caption };
  };
  // S6: the proposal figure — the old "What is new" section's figure slot,
  // now the merged proposal block's.
  const proposalFigure = report
    ? takeBound(report.whatItProposes.figureImageUrl, report.whatItProposes.figureCaption)
    : null;
  const resultFigures = keyResults.map((r) => takeBound(r.figureImageUrl, r.figureCaption));
  const limitations = report?.limitations ?? [];
  const relation = report?.relationToYourWork;
  const nextStep = report?.nextStep ?? null;
  // One boundary per object. `PaperPlate` draws `cropmarks` at a 6px inset on
  // the figure branch, and the `:has(> .tile-cover[data-plate="figure"])`
  // suppression in globals.css cannot reach it here — SwipeableCard's outer
  // div and its translate div sit between. So a framed SwipeableCard around a
  // marked plate is four hi-contrast corners inside a 1px rectangle twelve
  // pixels further out: two frames saying one thing. The corners say more, so
  // the rectangle goes. The TERMS plate keeps the frame: it is set on
  // `--color-surface`, the card's own colour, and with no frame it would have
  // no edge against the page at all.
  const plateIsFigure =
    Boolean(boundFigure?.imageUrl) ||
    (Boolean(resolvedFigure.imageUrl) && !resolvedFigure.hideFigure);
  // Blocks that were not there at first paint fade in, staggered in order.
  let stagger = 0;
  const related = pickRelated(paper, feedPapers);
  const reviewSections = report?.reviewContents?.sections ?? [];

  return (
    // `tabIndex={-1}`: Next's layout router focuses the segment's first
    // element after a client navigation, and an article that cannot take
    // focus makes that a no-op — j/k would change the paper without
    // assistive technology announcing anything.
    // `data-motion="reveal"` is the switch for globals.css's approach rules
    // and the ONLY place in the product that sets it. Static in JSX rather
    // than written from an effect on purpose: written afterwards, the page
    // would paint once at full opacity and then snap to hidden.
    <PageContainer
      width="spread"
      rhythm="reader"
      className={`${PAGE_CLASS} md:pb-16 outline-none`}
      tabIndex={-1}
      style={readingScaleStyle}
      // S22: withZoomTransition's own document.querySelector target — the
      // element S20 already puts --reading-scale on.
      data-zoom-root=""
      data-motion="reveal"
    >
      {/* The blocks, in the spec's order; `ReaderLayout` places them — one
          column below xl, the spread from it. Later-arriving content (the
          server reading, a model report) is `additions`: on the spread it
          lands only in the right column, so nothing can move the decision;
          in one column it is below the decision, as before. */}
      <SectionLinks headings={bodyHeadings}>
      <ReaderLayout
        spread={spread}
        plate={
          !hasPlate ? null : (
          // A real figure: the caption is the image's, read once, from the
          // figcaption. First on the page: the rail — position and the way
          // back — is the masthead's on desktop and the thumb bar's on a phone.
          <figure>
            <SwipeableCard
              onSwipeRight={save}
              {...(isUploadId ? {} : { onSwipeLeft: skip, leftLabel: SWIPE.notInterested })}
              rightLabel={paper.isSaved ? SWIPE.unsave : SWIPE.save}
              rightActive={paper.isSaved}
              className={plateIsFigure ? undefined : "shadow-card"}
            >
              <PaperPlate
                paper={paper}
                terms={plateTerms}
                figure={boundFigure}
                imageAlt={caption ? "" : undefined}
                lightbox
              />
            </SwipeableCard>
            {caption && (
              <figcaption className="font-reading text-body-sm text-text-muted mt-2">
                {caption}
              </figcaption>
            )}
          </figure>
          )
        }
        title={<TitleBlock paper={paper} recommendation={recommendation} now={now} />}
        ask={
          // P1-03 (§1f.10): only where Peer has the paper's text — without
          // it there is nothing to point a question at, and the Decision
          // block already says why. One field per paper.
          // P1-04 (§1f.12): the map under it, from the reading the server
          // built (absent without a body).
          hasBody ? (
            <>
              {questionsHydrated && (
                <QuestionField key={paper.id} paperId={paper.id} examples={examples} vague={route?.vague ?? false} />
              )}
              {reading.map && <ReadingMapView key={`map:${paper.id}`} map={reading.map} route={route} />}
            </>
          ) : undefined
        }
        words={
          <PaperWords
            endRef={wordsEndRef}
            reading={reading}
            marks={marks}
            skim={report?.skim ?? []}
            basis={report?.provenance.basis ?? null}
            quotedSkim={quotedSkim}
            scramble={shouldScrambleReport}
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
            onSkip={isUploadId ? undefined : skip}
            onCopy={copy}
            onOpen={decide}
            onCopyDoi={copyDoi}
            onRead={hasBody ? readHere : undefined}
            readLabel={BODY.open}
            uploadAction={!paper.id.startsWith("upload:") && uploadsAvailable ? <UploadButton targetPaper={paper} onUploaded={setUpload} /> : undefined}
            uploadStatus={upload ? <PrivatePdfStatus upload={upload}
              attachedToTitle={!paper.id.startsWith("upload:") ? paper.title : undefined}
              onDeleted={() => {
                setUpload(null);
                if (paper.id.startsWith("upload:")) router.replace("/");
              }} /> : undefined}
          />
        }
        contents={<PaperContents reading={reading} route={route} />}
        additions={
          <>
            {/* P2-09 (§1g.14): why this is the shorter report — first, under the
                Decision block, only when the server said a cap or an outage
                refused the deep read. No other notice of the report's own is
                rendered on this page (quota-notice.test.tsx pins that), so a
                report never shows two lines for one cause. */}
            {report?.quota && <QuotaNotice quota={report.quota} />}

            {report?.forYourQuestions && <ForYourQuestions report={report} map={reading.map} />}

            {/* The reader's own notes on this paper, and the way into them —
                first, because taking notes is what follows keeping it. */}
            <PaperNotes
              paper={paper}
              questions={settledQuestions(asked)}
              forYourQuestions={report?.forYourQuestions}
            />

            {/* ── The report as it read before the rewrite, in its order ── */}

            {/* S6: "What is new" merged into "What it proposes" — one block,
                one figure slot. */}
            {report && (
              <ProposalBlock
                report={report}
                paper={paper}
                figure={proposalFigure}
                registry={figureRegistry}
                bound={boundShown}
                stagger={stagger++}
                scramble={shouldScrambleReport}
              />
            )}

            {methods.length > 0 ? (
              <ClaimList
                block="method"
                claims={methods}
                abstractSentences={abstractSentences}
                scramble={shouldScrambleReport}
              />
            ) : (
              fromServer && (
                <QuoteList block="method" quotes={reading.method} />
              )
            )}

            {/* A review's contents stand where its results would; a research
                paper's results carry the headline, each result's novelty
                and its figure. Without a report, the paper's own sentences. */}
            {reviewSections.length > 0 ? (
              <ReviewContentsBlock
                sections={reviewSections}
                stagger={stagger++}
                scramble={shouldScrambleReport}
              />
            ) : report && (keyResults.length > 0 || report.resultsAndSignificance.summary) ? (
              <ResultsBlock
                report={report}
                paper={paper}
                abstractSentences={abstractSentences}
                figures={resultFigures}
                registry={figureRegistry}
                bound={boundShown}
                stagger={stagger++}
                scramble={shouldScrambleReport}
              />
            ) : (
              fromServer && (
                <QuoteList block="findings" quotes={reading.findings} />
              )
            )}

            {/* S6 deleted "Why it fits you"; the rewrite's project relation,
                then the shared terms line, stand in its place, as before. */}
            {relation && relation.items.length > 0 ? (
              <ClaimList
                block="forYou"
                claims={relation.items}
                abstractSentences={abstractSentences}
                anchor={relation.basedOn}
                scramble={shouldScrambleReport}
              />
            ) : (
              shared.length > 0 && (
                <section>
                  <p className="font-reading text-lead leading-[1.6] text-text mt-12 reading-justify">
                    {sharedTermsLine(shared)}
                  </p>
                </section>
              )
            )}

            <GlanceBlock paper={paper} now={now} stagger={stagger++} />

            <RelatedBlock related={related} now={now} stagger={stagger++} />

            {/* ── The blocks the rewrite added, kept under the old report ── */}

            {limitations.length > 0 ? (
              <ClaimList
                block="caveats"
                claims={limitations}
                abstractSentences={abstractSentences}
                scramble={shouldScrambleReport}
              />
            ) : (
              fromServer && (
                <QuoteList block="caveats" quotes={reading.caveats} />
              )
            )}

            {nextStep?.text && (
              <ClaimList
                block="nextStep"
                claims={[nextStep]}
                abstractSentences={abstractSentences}
                scramble={shouldScrambleReport}
              />
            )}

            {/* The paper, when Peer reached it: everything the extractor
                read, under everything Peer had to say about it. */}
            <PaperBody reading={reading} route={route} />

            {/* Last, and always there: the facts that need no key. On a page with no model
                page it is the only block under the abstract, which is the
                point — the column used to end at the abstract's footer with
                half the page under it. */}
            <RecordBlock paper={paper} primaryUrl={reading.source?.url ?? null} />

            {/* And last, the reader's own context: what they read or kept
                under the same topics, and the topics as searches. On a paper
                with no full text this stands where the column used to end
                in air. */}
            <InYourLibrary paper={paper} />
          </>
        }
        next={<NextRow nav={nav} next={nextPaper} />}
      />
      </SectionLinks>
      <ReaderToast toast={toast} />
      <KeyLegend keys={paperKeysFor({ upload: isUploadId })} />
    </PageContainer>
  );
}
