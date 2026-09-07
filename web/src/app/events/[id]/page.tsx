"use client";

import {
  use,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import type {
  CareerStage,
  IndustryAcademiaPreference,
  Event,
  EventFee,
  EventOrg,
  EventPerson,
  EventType,
} from "@/types";
import { eventTypes } from "@/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { aiAvailability, type AiMode } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import type { Plan } from "@/lib/entitlement/types";
import {
  daysUntil,
  formatDate,
  formatDateRange,
  formatDaysLeft,
  formatMatchPct,
  formatWeekdayRange,
  parseDate,
} from "@/lib/format";
import { reportShortDate } from "@/components/reports/report-date";
import { cleanOwnedEventReportSummary } from "@/lib/events/mapper";
import { ACTIVITY_LABELS } from "@/lib/opportunities/event-details";
import { isOnlineOnly } from "@/lib/opportunities/facets";
import {
  buildEnrichmentContext,
  canAttemptOpportunityEnrichment,
  capGeneratedReasoning,
  hasEventEnrichment,
  loadConfiguredOpportunityEnrichment,
  opportunityPageReadingReason,
  opportunityEnrichmentCacheKey,
  resolveEventReportDescription,
  type EventEnrichment,
  type OpportunityEnrichmentLoadResult,
  type OpportunityPageReadingReason,
} from "@/lib/opportunities/enrichment";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PageContainer } from "@/components/ui/page-container";
import {
  TierUpgradeBlock,
  type TierUpgradeItem,
} from "@/components/reports/tier-upgrade-block";
import { QuotaNotice } from "@/components/reports/quota-notice";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { WhyPeerSentThis } from "@/components/reports/why-peer-sent-this";
import { ReportTimelineTrack } from "@/components/reports/timeline-track";
import {
  REPORT_LABEL_CLASS,
  REPORT_LABEL_STEP,
  ReportSection as SharedReportSection,
} from "@/components/reports/report-section";
import {
  ReportFactTile,
  type ReportFact,
} from "@/components/reports/fact-tile";
import { MODEL_WRITTEN_BADGE, NO_MODEL_BADGE, ReportBadge } from "@/components/reports/report-badge";
import { CompletionPill } from "@/components/opportunities/completion-pill";
import { OpportunityFeedbackPair } from "@/components/opportunities/feedback-pair";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";

const ROSTER_STARS_KEY = "peer-event-roster-stars-v1";

/**
 * B3-09. Item 1's count used to be hardcoded absent because this was a
 * module-level constant with no access to any per-event data. It is
 * genuinely live: the untagged organisation tail's own length, the same
 * number `RosterSection`'s "Every other organisation attending" heading
 * already prints a few sections above — both now read from the one
 * computation `partitionEventRoster` does, rather than two separate counts
 * that could drift apart. Falls back to the old generic phrasing when
 * there is nothing untagged (or no organisations at all), rather than
 * printing "The other 0 exhibitors."
 *
 * B4-08 (R10). That fallback still assumed SOME organisation exists — with
 * zero real organisations at all, it read "Reads the full list and tells
 * you which strangers are worth your day" over a list that does not exist.
 * `organisationCount` is `partitionEventRoster`'s own total (junk-filtered)
 * list, the same standard `RosterSection` itself already uses to decide
 * whether to render at all — item 1 now only appears when that is nonzero.
 */
function buildEventTierUpgradeItems(
  organisationCount: number,
  untaggedOrganisationCount: number,
): TierUpgradeItem[] {
  const items: TierUpgradeItem[] = [];
  if (organisationCount > 0) {
    items.push({
      // B-20. Plate 03's wording, "The other 29 exhibitors, judged".
      title:
        untaggedOrganisationCount > 0
          ? `The other ${untaggedOrganisationCount} exhibitors, judged`
          : "The other exhibitors, judged",
      description:
        "Reads the full list and tells you which strangers are worth your day.",
    });
  }
  items.push(
    {
      title: "What each talk is actually about",
      description: "Reads the programme abstracts, not just the session titles.",
    },
    {
      // B-04 / §1b Correction 1. Restored as item 3 of 4 with the plate's exact
      // copy. P10.3 deleted the promise along with the feature.
      title: "A day-by-day plan for you",
      description: "Which sessions to attend and who to find, in order.",
    },
    {
      title: "Is your work a fit for the poster call",
      description:
        "Compares the call's scope against your project and says yes or no.",
    },
  );
  return items;
}

const EVENT_PAGE_READING_NOTES: Record<
  OpportunityPageReadingReason,
  string
> = {
  "no-provider": "Connect an AI key to let Peer read the programme.",
  "no-quotable-details":
    "Peer read the page but found no talk titles it could quote.",
  "read-failed": "Peer could not finish reading the programme page this time.",
};

export interface EventRosterContext {
  savedEmployers: string[];
  paperAuthors: string[];
  declaredTopics: string[];
  positiveLedgerLabels: string[];
}

interface CheapestWay {
  /** B-11. The long written sentence, for the callout at the top. */
  text: string;
  /** B-11. The compressed restatement, for the cost table's header row. */
  short: string;
  value: string;
  tier: "standard" | "student" | "online";
}

/**
 * B2-15 / Ruling 15. Travel grant and invitation letter both live in the cost
 * table (Ruling 6) but they are not the same shape of fact, and forcing them
 * through one shared "one merged cell" render loses real content the plate
 * shows in three columns.
 *
 * - `event.invitationLetter` is a boolean — "available on request" for both
 *   ticket types, no per-tier difference — so it genuinely has three
 *   separate cells: STANDARD, STUDENT, DEADLINE. `"columns"`.
 * - `event.travelGrant` is one free-text string a human wrote
 *   ("30 grants available, apply with your abstract"). The plate happens to
 *   show it split across three columns, but splitting a blob on punctuation
 *   is a guess that will mangle a real string differently shaped than the
 *   example. It stays one cell spanning the value columns. `"span"`.
 */
type CostSupportRow =
  | { label: string; kind: "span"; detail: string }
  | {
      label: string;
      kind: "columns";
      standard: string;
      student: string;
      deadline: string;
    };

/**
 * B-11. Only the date-ish head of a compound deadline may enter the "before X"
 * clause. "Early bird ends Jan 9 · $620 after" pasted whole is how the one line
 * whose job is to name the CHEAPEST way in ended up finishing with the most
 * expensive number on the page.
 */
function cutoffPhrase(value: string | undefined): string | undefined {
  const text = formatFeeDeadline(value);
  if (!text) return undefined;
  const head = clean(text.split(/\s*[·|;]\s*/)[0]);
  // A clause still carrying a price is a price, not a cutoff.
  if (!head || /[$€£]|\b(?:USD|EUR|GBP|CAD|AUD|NZD)\b/i.test(head)) {
    return undefined;
  }
  // "Early bird ends Jan 9" reads as "before Jan 9", not "before Early bird
  // ends Jan 9".
  return clean(/(?:ends?|until|closes?|by)\s+(.+)$/i.exec(head)?.[1]) ?? head;
}

interface DeadlineMilestone {
  key: "today" | "submission" | "registration" | "event";
  label: string;
  // B3-02/B3-03. Optional: the "Today" point prints the bare word with
  // nothing beneath it, on the plate. Mirrors TimelinePoint on the job
  // report -- same bug, same fix, duplicated across both files.
  value?: string;
  accent?: boolean;
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

/** B2-18. So the cost table's cheapest-way restatement reads as a
 * continuation of its own label's colon, not a second capitalised sentence. */
function lowercaseFirst(value: string): string {
  return value.charAt(0).toLowerCase() + value.slice(1);
}

function capitalizeFirst(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * B3-07. `event.travelGrant` is one free-text string a human wrote. B2-15's
 * own comment explains why it stayed one spanning cell rather than being
 * split on punctuation: "a guess that will mangle a real string differently
 * shaped than the example." That caution still holds for any string that
 * ISN'T shaped like the plate's own example -- this only converts to the
 * plate's three-column shape when the text visibly has the plate's own
 * two-clause shape (a count/availability clause, a comma, an
 * application-method clause); anything else keeps the single spanning cell
 * exactly as before. Verbatim, not trimmed -- "30 grants available" prints
 * as "30 grants available," not stripped down to "30 available" to match
 * the plate's own wording more closely than the split itself requires.
 */
function travelGrantColumns(
  value: string,
): { student: string; deadline: string } | undefined {
  const parts = value
    .split(",")
    .map((part) => clean(part))
    .filter((part): part is string => Boolean(part));
  if (parts.length !== 2) return undefined;
  return { student: parts[0], deadline: capitalizeFirst(parts[1]) };
}

function isCachedRosterRejection(value: string): boolean {
  return /\b(?:not|rather\s+than|instead\s+of|isn['’]t|does\s+not\s+(?:represent|appear))\b[^.]*?\b(?:attendee|participant|exhibitor|speaker|delegate|person\s+attending|organisation|organization|company)\b/i.test(
    value,
  );
}

function isCachedRosterFurniture(value: string): boolean {
  return /^(?:download\s+(?:the\s+)?brochure|companies?\s+[a-z]\s*(?:-|to)\s*[a-z]|executive\s+team|mailing\s+list|request\s+(?:more\s+)?information|privacy\s+policy|contact\s+us|terms(?:\s+(?:of\s+(?:use|service)|and\s+conditions))?|site\s*map)$/i.test(
    value.replace(/\s+/g, " ").trim(),
  );
}

function isCachedGenericSessionLabel(value: string): boolean {
  const core = value
    .replace(/\s+(?:session|track|talk|day|programme|program)s?$/i, "")
    .trim();
  return (
    !core ||
    !/\s/.test(core) ||
    /^(?:tutorials?|panels?|keynotes?|workshops?|posters?|receptions?|plenar(?:y|ies)|breakouts?|networking|exhibitions?|symposi(?:um|a)|seminars?|round\s*tables?|short\s+courses?|demos?|registration|lunch(?:es)?|breaks?)$/i.test(
      core,
    )
  );
}

function normalized(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function formatEventType(value: string): string {
  return value
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * B3-04 / Ruling 19. Plate 04 (PDF page 9) prints the Events tab's kind
 * filter with the spec's own vocabulary -- `Industry summit`, `Career fair`,
 * `Academic conference` -- title-casing only the FIRST word of a multi-word
 * label, not every word the way `formatEventType` mechanically does.
 * `Industry summit` is this label map's entry for `summit`, not an inference
 * about any particular event (§1g reversed §1f's exclusion on exactly this
 * point).
 *
 * Seven of these nine come straight off plate 04's own filter row
 * (`conference`, `workshop`, `career-fair`, `summit`, `expo`, `seminar`,
 * `hackathon`). `job-fair` and `meetup` are NOT shown on plate 04's filter
 * row at all -- they follow the same title-case-first-word-only convention
 * the other seven use, so the risk of being wrong is low, but this half is
 * "consistent with the pattern," not verified against the spec.
 */
const EVENT_TYPE_LABELS: Record<EventType, string> = {
  conference: "Academic conference",
  workshop: "Workshop",
  seminar: "Seminar",
  meetup: "Meetup",
  "job-fair": "Job fair",
  "career-fair": "Career fair",
  summit: "Industry summit",
  expo: "Expo",
  hackathon: "Hackathon",
};

function eventTypeLabel(type: EventType): string {
  return EVENT_TYPE_LABELS[type];
}

/**
 * B3-04. Case/hyphen-insensitive reverse lookup from prose ("career fair")
 * to the `EventType` it names ("career-fair"), so `formatActivityLabel` can
 * route an activity string through `eventTypeLabel` when it names a real
 * kind, and only fall through to the mechanical humaniser for the rest of
 * `KNOWN_ACTIVITY_LABELS`.
 */
const EVENT_TYPE_BY_TEXT = new Map<string, EventType>(
  eventTypes.map((type) => [type.replace(/-/g, " "), type]),
);

function matchEventType(value: string): EventType | undefined {
  return EVENT_TYPE_BY_TEXT.get(
    value.trim().toLowerCase().replace(/-/g, " "),
  );
}

/** A whole machine date and nothing else — "2027-04-15", "2027-04-15T09:00Z". */
const WHOLE_ISO_DATE = /^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/;

/**
 * B-01. A fee deadline is source text, not a date value: plate 03's DEADLINE
 * column is free prose ("Rate held until Feb 6", "Early bird ends Jan 9 · $620
 * after", "Oct 30"). None of it carries a year, so none of it may print one.
 *
 * The old body was `formatDate(value) ?? clean(value)`, which handed every
 * string to `new Date()`. V8's legacy parser skips tokens it does not
 * recognise and **defaults a missing year to 2001**, so "Rate held until Feb 6"
 * rendered as "Feb 6, 2001" — a fabricated year printed as fact. Only reformat
 * when the whole string is a machine date; everything else prints verbatim.
 */
/**
 * B2-09 / Ruling 16. `formatEventType` is an enum humaniser: it strips
 * hyphens and title-cases every word, which is right for `job-fair` and wrong
 * for prose. The old rule asked "does this look like a slug?" (short,
 * lowercase, only spaces/hyphens) — but ordinary prose passes that test just
 * as easily as a real vocabulary value does: "vendor exhibition" and
 * "early-career mixer" both qualified, and both got title-cased and
 * de-hyphenated ("Vendor Exhibition", "Early Career Mixer") — the same bug
 * class B-12 targeted, just triggered by different strings than B-12's own
 * fixture used.
 *
 * A label is vocabulary only if it actually IS one: an `EventType` value, or
 * one of the extractor's own fixed activity labels (`ACTIVITY_LABELS`,
 * `event-details.ts`) — not "shaped like" either. Word count has nothing to
 * do with whether a string is an enum, so that test is gone too.
 */
const KNOWN_ACTIVITY_LABELS = new Set<string>(
  [...eventTypes, ...ACTIVITY_LABELS].map((label) => label.toLowerCase()),
);

function formatActivityLabel(value: string): string {
  const text = value.trim();
  // B3-04. An activity string that names a real EventType ("career fair")
  // gets that kind's own spec label ("Career fair"), same as the primary
  // chip. Only the broader ACTIVITY_LABELS vocabulary ("poster session",
  // "keynote") still falls through to the all-words-title-cased humaniser --
  // B2-09 already confirmed that behaviour is correct for those and left it
  // alone; this does not touch it.
  const matchedType = matchEventType(text);
  if (matchedType) return eventTypeLabel(matchedType);
  return KNOWN_ACTIVITY_LABELS.has(text.toLowerCase())
    ? formatEventType(text)
    : text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * B2-11 / Ruling 14. `event.type` is one coarse enum value and cannot carry
 * the plate's second, more specific kind chip ("+ career fair"). But
 * `event.activities` sometimes names a fair-type session in plain prose
 * ("Recruiting fair, day 3" is the plate's own example) — a fact the event
 * page itself stated, not a guess. Matched against this fixed, short
 * vocabulary only: a generic "any X fair" pattern would start guessing at
 * genres the event never named. `event.type`'s own two fair-like values are
 * spelled with a hyphen ("job-fair", "career-fair"); this list is the prose
 * form activities actually use.
 *
 * The plate's "Industry" qualifier on the PRIMARY chip ("Summit" →
 * "Industry summit") **was** ruled to have no honest source (round-2 loop
 * log, item B2-11) -- that ruling is reversed, see B3-04/Ruling 19. This
 * function is about the SECONDARY chip, always was, and is unaffected by
 * that reversal beyond now returning a real `EventType` instead of raw
 * activity prose (B3-05).
 *
 * B3-05. `"recruiting fair"` is not itself an `EventType` -- it maps to
 * `career-fair`, the same kind of thing as a career fair in every source
 * this app has. There is no separate `EventType` for "recruiting fair."
 */
const SECONDARY_KIND_TERMS: Record<string, EventType> = {
  "career fair": "career-fair",
  "job fair": "job-fair",
  "recruiting fair": "career-fair",
};

function secondaryEventKind(
  activities: string[],
  primaryKind: EventType,
): EventType | undefined {
  for (const activity of activities) {
    const label = activity.toLowerCase();
    const match = Object.entries(SECONDARY_KIND_TERMS).find(([term]) =>
      label.includes(term),
    );
    // Don't state the primary kind a second time as though it were a second
    // fact — e.g. a career-fair event whose own activities also say
    // "career fair" gets no "+ career fair" chip; it would just repeat chip 1.
    if (match && match[1] !== primaryKind) return match[1];
  }
  return undefined;
}

/**
 * B2-17. The plate's own example shortens "PhD Year 4" to "PhD 4" in running
 * prose. Neither `jobs/scoring.ts`'s nor `events/scoring.ts`'s own
 * `reasonFor` has a short form — both print the full `CareerStage` value
 * verbatim ("fits a PhD Year 4 profile") — so this is a report-display
 * convention, not a duplicate of an existing mapping.
 */
function shortCareerStage(stage: CareerStage | undefined): string | undefined {
  if (!stage) return undefined;
  const match = /^PhD Year (\d+)$/.exec(stage);
  return match ? `PhD ${match[1]}` : stage;
}

/** Ordinary sentence conjunction — mirrors `joinReasonClauses` in
 * `jobs/scoring.ts` / `events/scoring.ts` (B2-08), kept local here rather
 * than imported: this joins chip *labels*, not scoring reason clauses, and
 * duplicating a two-line join is cheaper than coupling a report component to
 * the scoring module for it. */
function joinNaturally(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  if (parts.length === 2) return `${parts[0]} and ${parts[1]}`;
  return `${parts.slice(0, -1).join(", ")}, and ${parts[parts.length - 1]}`;
}

/**
 * B2-17. Plate 03: "Highlighted because they line up with your topics and
 * because you're a PhD 4 looking at industry — the poster call and the
 * recruiting fair are the two you'd be sorry to miss." Three gaps, closed to
 * different degrees:
 *  - "PhD Year 4" now shortens to the plate's own "PhD 4" (`shortCareerStage`).
 *  - the generic close ("Those are the ones") now names the actual
 *    highlighted chips, whatever the count — the plate's own "the two" only
 *    describes its own fixture.
 *  - "looking at industry" is a sector-preference clause. B2-19 wires it in.
 *    C found the profile already carries the preference and correctly refused
 *    to use it without a ruling; the manager then ruled it in, because the
 *    value is one the reader set themselves rather than one Peer inferred.
 *    This is NOT the same situation as B2-11's `Industry` qualifier, which
 *    describes the *event* and has no source at all.
 */
const SECTOR_CLAUSES: Partial<Record<IndustryAcademiaPreference, string>> = {
  industry: "looking at industry",
  academia: "looking at academia",
  startups: "looking at startups",
  bigTech: "looking at big tech",
  // B2-19. "both" is the default every profile starts on, so it states no
  // lean at all. Printing "looking at both" would put a sentence on the page
  // that the reader never chose — the clause is here to explain a highlight,
  // and a non-preference explains nothing.
};

function happeningsFootnote(
  highlightedLabels: string[],
  careerStage: CareerStage | undefined,
  sector: IndustryAcademiaPreference | undefined,
): string | undefined {
  if (highlightedLabels.length === 0) return undefined;
  const stage = shortCareerStage(careerStage);
  const sectorClause = sector ? SECTOR_CLAUSES[sector] : undefined;
  const named = joinNaturally(highlightedLabels);
  const verb = highlightedLabels.length === 1 ? "is the one" : "are the ones";
  // The plate reads "…because you're a PhD 4 looking at industry —". The two
  // clauses are one phrase, so the sector cannot stand alone without the
  // stage; with no stage it would read "because you're looking at industry",
  // which is a different and weaker claim.
  const about = stage
    ? ` and because you’re a ${stage}${sectorClause ? ` ${sectorClause}` : ""}`
    : "";
  // B3-11. A highlighted label can itself contain an em-dash ("Poster
  // session — open call" is a real ACTIVITY_LABELS-shaped string) — leading
  // with the sentence's own em-dash then collides with it: "...your topics
  // — Poster session — open call, ... are the ones..." reads as if both
  // dashes are the same kind of break. Swap to a colon lead-in only in that
  // one case; every other case (one label, several labels, none containing
  // a dash) keeps the em-dash exactly as before.
  const separator = named.includes("—") ? ":" : " —";
  return (
    "Highlighted because they line up with your topics" +
    about +
    `${separator} ${named} ${verb} you’d be sorry to miss.`
  );
}

function formatFeeDeadline(value: string | undefined): string | undefined {
  const text = clean(value);
  if (!text) return undefined;
  if (!WHOLE_ISO_DATE.test(text)) return text;
  return formatDate(text) ?? text;
}

function parsePrice(value: string): { currency: string; amount: number } | null {
  if (/^\s*free\s*$/i.test(value)) return { currency: "free", amount: 0 };
  const amount = Number.parseFloat(value.replace(/[^\d.]/g, ""));
  if (!Number.isFinite(amount)) return null;
  const currency =
    value.match(/\b(?:USD|EUR|GBP|CAD|AUD|NZD)\b/i)?.[0].toUpperCase() ??
    value.match(/€|£|(?:US|C|A|CA|AU|NZ)?\$/i)?.[0].toUpperCase();
  return currency ? { currency, amount } : null;
}

function preferredFeeTier(
  event: Event,
  careerStage: CareerStage | undefined,
): "standard" | "student" | "online" {
  if (/^PhD Year /.test(careerStage ?? "")) return "student";
  if (event.isOnline) return "online";
  return "standard";
}

export function cheapestWayIn(
  event: Event,
  careerStage?: CareerStage,
): CheapestWay | null {
  const fees = event.fees ?? [];
  if (fees.length === 0) return null;
  const preferred = preferredFeeTier(event, careerStage);
  const tierOrder = [
    preferred,
    ..."student,online,standard"
      .split(",")
      .filter((tier) => tier !== preferred),
  ] as Array<"standard" | "student" | "online">;

  for (const tier of tierOrder) {
    const candidates = fees.flatMap((fee, index) => {
      const value = clean(fee[tier]);
      return value ? [{ fee, value, index, parsed: parsePrice(value) }] : [];
    });
    if (candidates.length === 0) continue;
    const comparable =
      candidates.every((candidate) => candidate.parsed) &&
      new Set(candidates.map((candidate) => candidate.parsed!.currency)).size ===
        1;
    const selected = comparable
      ? [...candidates].sort(
          (left, right) =>
            left.parsed!.amount - right.parsed!.amount ||
            left.index - right.index,
        )[0]
      : candidates[0];
    // B-11. A written sentence, not fields glued with dots. The old string
    // read "$180 student rate · Registration, in person · by Early bird ends
    // Jan 9 · $620 after" — machine assembly that never mentioned the travel
    // grant sitting in the same record, and signed off with the higher price.
    const cutoff = cutoffPhrase(selected.fee.deadline);
    const ticket =
      tier === "student"
        ? "Student ticket"
        : tier === "online"
          ? "Online ticket"
          : "Standard ticket";
    const mode = tier === "online" || event.isOnline ? "online" : "in person";
    const grant = clean(event.travelGrant);
    const sentence =
      `${ticket} ${mode}${cutoff ? ` before ${cutoff}` : ""}` +
      `${grant ? ", with a travel grant" : ""} — ${selected.value}`;
    return {
      value: selected.value,
      tier,
      short: `${sentence}.`,
      // The long form adds why the grant is not extra work, which is the whole
      // reason this line is worth acting on.
      text:
        grant && clean(event.deadline)
          ? `${sentence}, applied for alongside the abstract you were going to write anyway.`
          : `${sentence}.`,
    };
  }
  return null;
}

/**
 * B2-14 (A: event 1d). `formatCount` (format.ts) is the app's *compact* count
 * vocabulary ("2.4k") and other surfaces rely on it; the plate spells this one
 * out with comma grouping ("~2,400"), so it gets its own formatter here
 * instead of a change to the shared one.
 */
function formatScaleCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

/**
 * B-09. Four milestones, not three: plate 03 opens the strip with **Today** so
 * the two deadlines can be read as distances rather than bare dates. Mirrors
 * `buildTimeline` on the job report exactly, so the two reports agree.
 */
/**
 * B-05. Plate 03's six tiles. The build had no tile row at all — just a
 * two-cell When/Where grid inside the header. FEE, ABSTRACT DUE and REGISTER BY
 * survived further down the page but were gone from the top, and SCALE appeared
 * nowhere in the report.
 *
 * **SCALE is no longer dead on live data as of B4-10 (round 4).**
 * `event.expectedSize` used to be declared on the type with no mapper ever
 * writing it; `extractEventDetails()` (`event-details.ts`) now looks for an
 * explicit attendance figure in the page's own text ("expected attendance:
 * 2,400", "1,800 attendees", "previous edition drew ..."). The tile still
 * renders only when that figure was actually found rather than printing a
 * guessed crowd size — most real pages will still say nothing, and the tile
 * stays silent exactly as before for those.
 *
 * The plate's WHERE sub-line ("in person · hybrid keynotes") and REGISTER BY
 * sub-line ("on-site registration available") have no field behind them; the
 * tiles print the format Peer actually knows and stop.
 */
export function buildEventFacts(event: Event, nowMs: number): ReportFact[] {
  const dates = formatDateRange(event.date, event.endDate);
  // B2-01 / Ruling 8. Both already dropped the year, but neither guarded
  // against one that is more than ~12 months out — where a bare "Mar 8" would
  // be ambiguous between two different years.
  const abstractDue = reportShortDate(event.deadline, nowMs);
  const registerBy = reportShortDate(event.registrationDeadline, nowMs);
  // B20-01, render site 2 of 6 — the report's WHERE tile. Plate 03 IS the
  // event report, so this is the surface the parity loop measures. Same
  // shipped predicate as the card and the Format facet chips.
  const location = isOnlineOnly(event) ? "Online" : clean(event.location);
  const headline = (event.fees ?? []).find((fee) => clean(fee.standard));
  const student = clean(headline?.student);
  // B2-12. Reuses B-11's own extraction: cutoffPhrase already applies B-01's
  // ISO guard and pulls only the date-ish head off a compound deadline
  // string ("Early bird ends Jan 9 · $620 after" -> "Jan 9"), so this never
  // acquires a fabricated year and never drags the trailing price along.
  const feeCutoff = cutoffPhrase(headline?.deadline);
  const facts: Array<ReportFact | undefined> = [
    dates
      ? {
          key: "dates",
          label: "Dates",
          value: dates,
          detail: formatWeekdayRange(event.date, event.endDate) ?? undefined,
        }
      : undefined,
    location && location.toLowerCase() !== "see event page"
      ? {
          key: "where",
          label: "Where",
          value: location,
          detail: event.isOnline ? undefined : "in person",
        }
      : undefined,
    headline
      ? {
          key: "fee",
          label: "Fee",
          value: clean(headline.standard)!,
          // B2-12 (A: event 1a). The plate's own sub-line names the
          // early-bird cutoff too ("student $180 · early bird to Jan 9") —
          // the deadline was already two lines away in scope and simply
          // never read.
          detail:
            [
              student ? `student ${student}` : undefined,
              feeCutoff ? `early bird to ${feeCutoff}` : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        }
      : undefined,
    abstractDue
      ? {
          key: "abstract-due",
          label: "Abstract due",
          value: abstractDue,
          // B2-01. Plate 03 reads "92 days left" — always days, never bucketed
          // into weeks or months.
          detail: formatDaysLeft(daysUntil(event.deadline!, nowMs)),
        }
      : undefined,
    registerBy
      ? {
          key: "register-by",
          label: "Register by",
          value: registerBy,
          // B2-13 / Ruling 10 (A: event 1c). The plate's sub-line here is a
          // fixed qualitative note — "on-site registration available" —
          // whether walk-in registration stays open, which Peer does not
          // track. It is NOT a countdown: a countdown implies the deadline is
          // hard, which we do not know. Suppressed rather than substituted
          // with a different fact (the old `formatDayDistance` call). This
          // slot is permanently excluded from parity scoring — exclusion 7.
        }
      : undefined,
    event.expectedSize
      ? {
          key: "scale",
          label: "Scale",
          value: `~${formatScaleCount(event.expectedSize)}`,
          detail: "last edition",
        }
      : undefined,
  ];
  return facts.filter((fact): fact is ReportFact => Boolean(fact?.value));
}

function deadlineMilestones(event: Event, nowMs: number): DeadlineMilestone[] {
  // B2-01. Mirrors buildEventFacts's date styling exactly, and buildTimeline
  // on the job report, so no two sections on either report disagree about the
  // same date.
  const submission = reportShortDate(event.deadline, nowMs);
  const registration = reportShortDate(event.registrationDeadline, nowMs);
  const eventDate = reportShortDate(event.date, nowMs);
  const milestones: DeadlineMilestone[] = [];
  if (!submission && !registration && !eventDate) return milestones;
  // B3-02. Same fix as the job report's buildTimeline: the plate's Today
  // point is the bare word, nothing underneath -- printing an actual date
  // here made the one accented milestone read like just another date.
  milestones.push({ key: "today", label: "Today", accent: true });
  if (submission) {
    milestones.push({
      key: "submission",
      // Plate 03 labels this "Abstract" — what the deadline is for, not what
      // the reader must do about it.
      label: "Abstract",
      value: submission,
    });
  }
  if (registration) {
    milestones.push({
      key: "registration",
      // B3-03. Plate 03's deadline strip reads bare "Register" -- only the
      // facts-row REGISTER BY tile keeps the "by" (untouched, see that tile
      // a few sections above; this label has no job-side counterpart).
      label: "Register",
      value: registration,
    });
  }
  if (eventDate) {
    // Accent stays on Today alone, as it does on the job report. Two accented
    // points in a four-point strip is no accent at all.
    milestones.push({ key: "event", label: "Event", value: eventDate });
  }
  return milestones;
}

export function organisationStarKey(item: EventOrg): string {
  return `organisation:${normalized(item.name)}`;
}

export function personStarKey(item: EventPerson): string {
  return `person:${normalized(item.name)}:${normalized(item.institution ?? "")}`;
}

function organisationReason(
  item: EventOrg,
  context: EventRosterContext,
): string | undefined {
  if (clean(item.relevance)) return clean(item.relevance);
  const name = normalized(item.name);
  const saved = context.savedEmployers.find(
    (employer) => normalized(employer) === name,
  );
  if (saved) return `You saved a role at ${saved}.`;
  const ledger = context.positiveLedgerLabels.find(
    (label) => normalized(label) === name,
  );
  return ledger ? `${ledger} appears in your positive preference history.` : undefined;
}

function personReason(
  item: EventPerson,
  context: EventRosterContext,
): string | undefined {
  if (clean(item.relevance)) return clean(item.relevance);
  const name = normalized(item.name);
  if (context.paperAuthors.some((author) => normalized(author) === name)) {
    return "They authored a paper in your feed.";
  }
  if (context.declaredTopics.some((topic) => normalized(topic).includes(name))) {
    return "Their name appears in a topic you declared.";
  }
  return undefined;
}

/**
 * B2-16 / Ruling 13. Plate 03's people cards carry a short descriptor line
 * ("2 papers in your feed", "Matches a topic you typed") that organisation
 * cards already have (`item.descriptor`, rendered) and people never did.
 * Both plate examples are Tier 0 — computable with no AI key — so this lives
 * beside `personReason` rather than coming from the model: sourcing it from
 * enrichment would make it vanish for a reader with no AI key configured,
 * which is backwards for a fact the plate treats as always shown.
 *
 * `context.paperAuthors` is a flat list of author names across every paper in
 * the feed and saved papers (one entry per paper per author, from
 * `EventDetailPage`'s `rosterContext`), so counting this person's normalised
 * name in it IS counting how many of their papers are in the feed.
 */
function personDescriptor(
  item: EventPerson,
  context: EventRosterContext,
): string | undefined {
  if (clean(item.descriptor)) return clean(item.descriptor);
  const name = normalized(item.name);
  const paperCount = context.paperAuthors.filter(
    (author) => normalized(author) === name,
  ).length;
  if (paperCount > 0) {
    return `${paperCount} paper${paperCount === 1 ? "" : "s"} in your feed`;
  }
  if (context.declaredTopics.some((topic) => normalized(topic).includes(name))) {
    return "Matches a topic you typed";
  }
  return undefined;
}

function useRosterStars(): [Set<string>, (key: string) => void] {
  const [stars, setStars] = useState<Set<string>>(() => {
    if (typeof window === "undefined") return new Set();
    try {
      const parsed = JSON.parse(
        window.localStorage.getItem(ROSTER_STARS_KEY) ?? "[]",
      );
      return new Set(
        Array.isArray(parsed)
          ? parsed.filter((value): value is string => typeof value === "string")
          : [],
      );
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((key: string) => {
    setStars((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      try {
        window.localStorage.setItem(
          ROSTER_STARS_KEY,
          JSON.stringify([...next]),
        );
      } catch {
        // The report still works when storage is unavailable.
      }
      return next;
    });
  }, []);

  return [stars, toggle];
}

/**
 * V26-J08 / V26-E08 (round 26 C). FOUR CHIP ROLES WHERE THE BUILD HAD TWO.
 *
 * Plate 02's header row: `Postdoc` amber `#a8642a` · `Full-time · 3 years`
 * neutral outline · **`Visa sponsorship` BLUE `#2b5c8f`** · `91% match` orange.
 * Plate 03's: `Industry summit` amber · `+ career fair` neutral · `CCF-B`
 * neutral · `88% match` orange. FOUR categories, four signals.
 *
 * The build had three tones and used two on the header row, and `visaTone`
 * returned `accent` for `sponsors` — WHICH IS WHY THE VISA CHIP AND THE MATCH
 * CHIP RENDERED IDENTICALLY. Two new roles fix it: `info` for the positive
 * visa state and `kind` for the role/event kind.
 *
 * **SEMANTIC TOKENS, NEVER THE PLATE'S LITERAL HEXES.** A scored this as ROLE
 * ASSIGNMENT, not palette fidelity, and palette fidelity is explicitly out of
 * the round's scope. The app is multi-theme (the live profile runs
 * `colorTheme: "system:ember"`), so a hard-coded hex would break in five other
 * themes. What must change is that four categories get four DISTINGUISHABLE
 * signals; which exact hue is the theme's business.
 *
 * **`danger` KEEPS FIRING FOR `wont-sponsor`.** The plate has no won't-sponsor
 * chip to copy, and turning a red warning blue would be a real regression.
 * Only the `sponsors` branch moves.
 */
function HeaderChip({
  children,
  accent = false,
  tone,
}: {
  children: ReactNode;
  accent?: boolean;
  tone?: "info" | "kind";
}) {
  return (
    <span
      data-header-chip={accent ? "accent" : tone ?? "neutral"}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-meta font-medium",
        accent
          ? "border-accent/25 bg-accent/10 text-accent"
          : tone === "info"
            ? "border-link/25 bg-link-dim text-link"
            : tone === "kind"
              ? "border-tag/25 bg-tag-dim text-tag"
              : "border-border bg-surface text-text-muted",
      )}
    >
      {children}
    </span>
  );
}

function EventActionRow({
  primaryHref,
  primaryLabel,
  abstractHref,
  isSaved,
  isRegistered,
  isSubmitted,
  isInterested,
  onToggleSave,
  onRegisteredChange,
  onSubmittedChange,
  onInterested,
  onDismiss,
}: {
  primaryHref?: string;
  primaryLabel: string;
  /**
   * B-16. Plate 03 has two primary links, "Register ↗" and "Submit abstract
   * ↗". There is no abstract-specific URL on `Event` — only linkRegistration
   * and linkOfficial — so this is set only when the event actually has an
   * abstract deadline, and points at the official site. No second URL is
   * fabricated.
   */
  abstractHref?: string;
  isSaved: boolean;
  isRegistered: boolean;
  isSubmitted: boolean;
  isInterested: boolean;
  onToggleSave: () => void;
  onRegisteredChange: (next: boolean) => void;
  onSubmittedChange: (next: boolean) => void;
  onInterested: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-report-action-row="event"
      className="mt-7 flex flex-wrap items-center gap-2"
    >
      {primaryHref && (
        <a
          href={primaryHref}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ tone: "primary" }),
            "h-11 px-4 text-body font-semibold",
          )}
        >
          {primaryLabel}
          <span aria-hidden>↗</span>
        </a>
      )}
      {abstractHref && (
        <a
          href={abstractHref}
          target="_blank"
          rel="noopener noreferrer"
          data-event-abstract-link
          className={cn(
            buttonVariants({ tone: "soft" }),
            "h-11 px-4 text-body font-semibold",
          )}
        >
          Submit abstract
          <span aria-hidden>↗</span>
        </a>
      )}
      <button
        type="button"
        onClick={onToggleSave}
        aria-pressed={isSaved}
        className={cn(
          buttonVariants({ tone: "soft" }),
          "h-11 px-3 text-body-sm",
          isSaved && "border-accent/35 bg-accent/10 text-accent",
        )}
      >
        {isSaved ? "Saved" : "Save"}
      </button>
      <CompletionPill
        label="Registered"
        checked={isRegistered}
        onChange={onRegisteredChange}
        className="h-11 px-3 text-body-sm"
      />
      <CompletionPill
        label="Submitted"
        checked={isSubmitted}
        onChange={onSubmittedChange}
        className="h-11 px-3 text-body-sm"
      />
      <OpportunityFeedbackPair
        isInterested={isInterested}
        onInterested={onInterested}
        onNotInterested={onDismiss}
      />
    </div>
  );
}

// V26-E01 / V26-J10 (round 26 C). This component's body moved to
// `components/reports/report-section.tsx`; it was defined identically here and
// on the job report, and `Who’ll be in the room` reaches its `<h2>` through
// THIS copy — so the heading level had to live in one place to be reachable
// from both surfaces. Re-exported under the local name so every call site in
// this file is unchanged.
const ReportSection = SharedReportSection;

function CheapestCallout({ cheapest }: { cheapest: CheapestWay }) {
  return (
    <aside className="mt-10 rounded-2xl border border-accent/20 bg-accent/8 px-5 py-4">
      {/* Round 28 item 2 (V28-01): step matches every other report label;
          colour stays `text-accent` — this callout is deliberately tinted. */}
      <p className={`${REPORT_LABEL_STEP} text-accent`}>
        Cheapest way in, for you
      </p>
      <p className="mt-1.5 text-title font-semibold text-heading">
        {cheapest.text}
      </p>
    </aside>
  );
}

// V26-J03 / V26-E03 (round 26 C). This component was one of TWO copies of the
// same shape — the job report carried the other, inline, differing only in a
// data hook and one breakpoint. Both are now `ReportTimelineTrack`, so the
// plates' continuous track with its filled `Posted -> Today` segment lands on
// both surfaces from one place. NO DATE LOGIC MOVED: the track reads the
// `accent` flag the milestone builder already sets, and nothing else.
function DeadlineTimeline({
  milestones,
}: {
  milestones: DeadlineMilestone[];
}) {
  return <ReportTimelineTrack milestones={milestones} />;
}

type PriceCandidate = {
  value: string;
  parsed: { currency: string; amount: number };
};

function priceCandidate(value: string | undefined): PriceCandidate | null {
  const text = clean(value);
  if (!text) return null;
  const parsed = parsePrice(text);
  return parsed ? { value: text, parsed } : null;
}

/** A bare price token -- "$620", "€45", "80 USD" -- and nothing else around it. */
const PRICE_TOKEN_RE =
  /(?:€|£|(?:US|C|A|CA|AU|NZ)?\$)\s?\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s?(?:USD|EUR|GBP|CAD|AUD|NZD)\b/i;

/**
 * B3-01. The tail of a compound deadline string can carry a second, higher
 * price -- "Early bird ends Jan 9 · $620 after" -- the true full price once
 * the early-bird window closes. Split on the same "·" delimiter
 * `cutoffPhrase` uses, then pull just the price token out of what's left --
 * the tail can carry trailing words ("after") that are not part of the price
 * itself and must not end up inside the rendered value.
 */
function priceAfterCutoff(value: string | undefined): PriceCandidate | null {
  const text = formatFeeDeadline(value);
  if (!text) return null;
  const [, ...rest] = text.split(/\s*[·|;]\s*/);
  const token = clean(PRICE_TOKEN_RE.exec(rest.join(" · "))?.[0]);
  return priceCandidate(token);
}

/**
 * B-13. Plate 03 closes the table with the gap between the cheapest route and
 * full price, and says why that gap earns the cheapest line its place at the
 * top of the report. Only renders when both numbers exist and actually differ.
 *
 * The plate's "plus four nights" clause is dropped: nights are not a field on
 * `Event`, and inventing a hotel count to match a mock is exactly the kind of
 * fabrication the rest of this work is removing.
 *
 * B3-01. A fee row's `standard` cell can itself be the *discounted*
 * early-bird price ($480), with the true worst case ($620) existing only as
 * trailing text inside that same row's `deadline` string. Reading `standard`
 * alone understated the exact gap this sentence exists to dramatise, so each
 * row now contributes whichever of the two readings is higher.
 */
function costsFootnote(fees: EventFee[], cheapest: CheapestWay | null): string {
  const closing =
    "The gap between the two is the reason this line sits at the top of the report.";
  const cheapestPrice = cheapest ? parsePrice(cheapest.value) : null;
  const fullPrices = fees
    .flatMap((fee) => {
      const candidates = [
        priceCandidate(fee.standard),
        priceAfterCutoff(fee.deadline),
      ].filter((candidate): candidate is PriceCandidate => candidate !== null);
      if (candidates.length === 0) return [];
      return [
        candidates.sort((left, right) => right.parsed.amount - left.parsed.amount)[0],
      ];
    })
    .filter(({ parsed }) => parsed.currency === cheapestPrice?.currency);
  const full = fullPrices.sort(
    (left, right) => right.parsed.amount - left.parsed.amount,
  )[0];
  if (!cheapestPrice || !full || full.parsed.amount <= cheapestPrice.amount) {
    return closing;
  }
  return `Full price with no grant would be ${full.value}. ${closing}`;
}

function CostsTable({
  fees,
  supportRows,
  cheapest,
}: {
  fees: EventFee[];
  /**
   * Ruling 6. The travel grant and the invitation letter belong in this table
   * and nowhere else — they used to print as prose under "What actually
   * happens there" AND as table rows on the plate, which say-it-once forbids.
   * See `CostSupportRow` for why the two rows do not share one shape.
   */
  supportRows: CostSupportRow[];
  cheapest: CheapestWay | null;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      {cheapest && (
        <p className="border-b border-border bg-accent/5 px-4 py-3 text-body-sm text-heading">
          {/* B-11. Plate 03 prints the written sentence up top and a compressed
              restatement here. Both sites are on the plate and deliberate; the
              defect was that they printed the same machine-assembled string.
              B2-18: this form has its own punctuation — no comma before "for
              you", and the restatement continues in lower case — the top
              callout above keeps its comma and capital letter unchanged. */}
          <strong>Cheapest way in for you:</strong>{" "}
          {lowercaseFirst(cheapest.short)}
        </p>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] border-collapse text-left">
          <thead className="bg-bg-secondary/70">
            <tr>
              {["Item", "Standard", "Student", "Deadline"].map((header) => (
                <th
                  key={header}
                  scope="col"
                  // Round 28 item 2 (V28-01): the fee table's own label step.
                  className={`border-b border-border px-4 py-3 ${REPORT_LABEL_CLASS}`}
                >
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fees.map((fee, index) => (
              <tr key={`${fee.label}-${index}`} className="border-b border-border last:border-0">
                <th
                  scope="row"
                  className="px-4 py-3 text-body-sm font-semibold text-heading"
                >
                  {fee.label}
                  {clean(fee.online) && (
                    <span className="mt-1 block text-caption font-normal text-text-faint">
                      Online · {fee.online}
                    </span>
                  )}
                </th>
                <td className="px-4 py-3 text-body-sm text-text-muted">
                  {clean(fee.standard)}
                </td>
                <td className="px-4 py-3 text-body-sm text-text-muted">
                  {clean(fee.student)}
                </td>
                <td className="px-4 py-3 text-body-sm text-text-muted">
                  {formatFeeDeadline(fee.deadline)}
                </td>
              </tr>
            ))}
            {supportRows.map((row) => (
              <tr
                key={row.label}
                data-cost-support-row
                className="border-b border-border last:border-0"
              >
                <th
                  scope="row"
                  className="px-4 py-3 text-body-sm font-semibold text-heading"
                >
                  {row.label}
                </th>
                {row.kind === "span" ? (
                  // B2-15. One free-text string a human wrote — splitting it
                  // on punctuation would be a guess. Spans the value columns.
                  <td
                    colSpan={3}
                    className="px-4 py-3 text-body-sm text-text-muted"
                  >
                    {row.detail}
                  </td>
                ) : (
                  // B2-15. A boolean genuinely has three separate cells here —
                  // build them, rather than folding them into one merged cell.
                  <>
                    <td className="px-4 py-3 text-body-sm text-text-muted">
                      {row.standard}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-muted">
                      {row.student}
                    </td>
                    <td className="px-4 py-3 text-body-sm text-text-muted">
                      {row.deadline}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p
        data-costs-footnote
        className="border-t border-border px-4 py-3 text-caption leading-5 text-text-faint"
      >
        {costsFootnote(fees, cheapest)}
      </p>
    </div>
  );
}

function StarButton({
  active,
  label,
  onClick,
}: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-label={`${active ? "Unstar" : "Star"} ${label}`}
      title={active ? "Marked as important" : "Tell Peer this matters"}
      className={cn(
        "shrink-0 rounded-full px-2 py-1 text-title transition-colors",
        active
          ? "bg-accent/10 text-accent"
          : "text-text-faint hover:bg-accent/10 hover:text-accent",
      )}
    >
      {active ? "★" : "☆"}
    </button>
  );
}

/** B-07. The plate's `★` explainer, identical over both tails. */
const ROSTER_STAR_EXPLAINER =
  "Star anyone Peer got wrong. It moves to the top here, and every future event highlights them automatically.";

/**
 * B-07. Plate 03 gives each long tail its own titled block with a live count, a
 * "Filter this list" input, a `★` column and a closing footnote. The build ran
 * the plain rows straight on under the same heading as the Tier 0 cards, with
 * no divider, no count, no filter and no explanation.
 *
 * The filter needs local state, so it lives in here and `EventReport` stays a
 * pure render. The count is the plain-list length, computed live, so starring
 * someone visibly moves them out of the tail.
 */
function RosterTail({
  kind,
  title,
  footnote,
  entries,
  onToggleStar,
}: {
  kind: "organisation" | "person";
  title: string;
  footnote: string;
  entries: Array<{
    key: string;
    name: string;
    secondary?: string;
    starred: boolean;
  }>;
  onToggleStar: (key: string) => void;
}) {
  const [filter, setFilter] = useState("");
  if (entries.length === 0) return null;
  const needle = filter.trim().toLowerCase();
  const visible = needle
    ? entries.filter(({ name, secondary }) =>
        `${name} ${secondary ?? ""}`.toLowerCase().includes(needle),
      )
    : entries;
  const inputId = `roster-filter-${kind}`;

  return (
    <div data-roster-tail={kind} className="mt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        {/* Round 28 item 2 (V28-01): shared step, tracking was `0.16em`. */}
        <h3 className={REPORT_LABEL_CLASS}>
          {title} · {entries.length}
        </h3>
        <div className="flex items-center gap-2">
          <label htmlFor={inputId} className="sr-only">
            Filter this list
          </label>
          <input
            id={inputId}
            type="search"
            value={filter}
            onChange={(clickEvent) => setFilter(clickEvent.target.value)}
            placeholder="Filter this list"
            className="w-44 rounded-lg border border-border bg-surface px-3 py-1.5 text-caption text-heading placeholder:text-text-faint focus:border-accent focus:outline-none"
          />
          <span
            aria-hidden
            title="Star anyone Peer got wrong"
            className="px-1 text-title text-text-faint"
          >
            ★
          </span>
        </div>
      </div>
      <p className="mt-2 text-caption leading-5 text-text-faint">
        {ROSTER_STAR_EXPLAINER}
      </p>
      <div className="mt-3 grid gap-2">
        {visible.map(({ key, name, secondary, starred }) => (
          <div
            key={key}
            data-roster-row={kind}
            data-roster-plain="true"
            className="flex items-start justify-between gap-3 border-b border-border px-1 py-3 last:border-0"
          >
            <div className="min-w-0">
              <p className="text-body-sm font-medium text-heading">{name}</p>
              {secondary && (
                <p className="mt-0.5 text-caption text-text-faint">
                  {secondary}
                </p>
              )}
            </div>
            <StarButton
              active={starred}
              label={name}
              onClick={() => onToggleStar(key)}
            />
          </div>
        ))}
      </div>
      <p className="mt-3 text-caption leading-5 text-text-faint">{footnote}</p>
    </div>
  );
}

/**
 * B3-09. Hoisted out of `RosterSection` so `EventReport` can also read the
 * untagged organisation tail's own length for the locked block's item 1
 * count — there should be exactly one place that decides "tagged vs.
 * untagged," not two separate computations that could quietly drift apart.
 * Everything here is unchanged from what used to run inline at the top of
 * `RosterSection`.
 */
function partitionEventRoster(
  event: Event,
  context: EventRosterContext,
  enrichment: EventEnrichment | null | undefined,
  starredKeys: ReadonlySet<string>,
) {
  const judgments = new Map(
    (enrichment?.judgedAttendees ?? []).map((item) => [item.name, item]),
  );
  const usedJudgments = new Set<string>();
  const takeJudgment = (name: string, hasTier0Reason: boolean) => {
    if (hasTier0Reason || usedJudgments.has(name)) return undefined;
    const judgment = judgments.get(name);
    if (judgment) usedJudgments.add(name);
    return judgment;
  };
  const organisations = (event.organisations ?? [])
    .filter((item) => !isCachedRosterFurniture(item.name))
    .map((item, index) => {
      const key = organisationStarKey(item);
      const tier0Reason = organisationReason(item, context);
      const judgment = takeJudgment(item.name, Boolean(tier0Reason));
      const reason = tier0Reason ?? judgment?.why;
      return {
        item,
        index,
        key,
        reason,
        judgment,
        starred: starredKeys.has(key),
      };
    });
  const people = (event.people ?? [])
    .filter((item) => !isCachedRosterFurniture(item.name))
    .map((item, index) => {
      const key = personStarKey(item);
      const tier0Reason = personReason(item, context);
      const judgment = takeJudgment(item.name, Boolean(tier0Reason));
      const reason = tier0Reason ?? judgment?.why;
      return {
        item,
        index,
        key,
        reason,
        judgment,
        // B2-16 / Ruling 13. Tier 0, computed locally — never from `judgment`
        // (which is model output).
        descriptor: personDescriptor(item, context),
        starred: starredKeys.has(key),
      };
    });
  const byPriority = <T extends { index: number; reason?: string; starred: boolean }>(
    left: T,
    right: T,
  ) =>
    Number(right.starred) - Number(left.starred) ||
    Number(Boolean(right.reason)) - Number(Boolean(left.reason)) ||
    left.index - right.index;
  organisations.sort(byPriority);
  people.sort(byPriority);

  const concerns = ({ reason, starred }: { reason?: string; starred: boolean }) =>
    Boolean(reason) || starred;
  const organisationCards = organisations.filter(concerns);
  const organisationTail = organisations.filter((row) => !concerns(row));
  const peopleCards = people.filter(concerns);
  const peopleTail = people.filter((row) => !concerns(row));

  return {
    organisations,
    people,
    organisationCards,
    organisationTail,
    peopleCards,
    peopleTail,
  };
}

function RosterSection({
  organisations,
  people,
  organisationCards,
  organisationTail,
  peopleCards,
  peopleTail,
  onToggleStar,
}: ReturnType<typeof partitionEventRoster> & {
  onToggleStar: (key: string) => void;
}) {
  if (organisations.length === 0 && people.length === 0) return null;

  // ════════════════════════════════════════════════════════════════════════
  // RULING 66a / 68a. **THE `Tier 0` BADGE ON THESE TWO SUB-HEADINGS WAS THE
  // ONE PLACE MODEL PROSE COULD RENDER UNDER A LABEL SAYING IT DID NOT.**
  //
  // The other three `Tier 0` ReportBadges on the reports are honest forever —
  // "Skills they ask for", "What it costs you" and `why-peer-sent-this` read
  // no enrichment at all, and Ruling 11 requires them on the heading. These
  // two are different: `partitionEventRoster` merges `judgedAttendees[].why`
  // into a card's `reason` whenever that card has no Tier 0 reason of its own,
  // so the text under the badge can be model-written.
  //
  // **THE MERGE IS PER CARD, SO THE PROVENANCE IS TOO.** The heading keeps its
  // badge only while EVERY card beneath it is Tier 0; once any card carries a
  // judgment the section is mixed, the blanket claim is withdrawn, and each
  // card states its own provenance instead. A card that falls back to
  // `tier0Reason` shows `Tier 0` again, which is the whole point.
  //
  // **THIS IS A NO-OP UNTIL ENRICHMENT LANDS.** With no `judgedAttendees` no
  // card has a judgment, `allTier0` is true on both sections, and the markup
  // is byte-identical to before — so Ruling 69's Phase 1 census and Ruling
  // 66b's visual baseline see exactly the plate they saw yesterday.
  // ════════════════════════════════════════════════════════════════════════
  const organisationsAllTier0 = organisationCards.every((row) => !row.judgment);
  const peopleAllTier0 = peopleCards.every((row) => !row.judgment);

  // B-14. Plate 03's sub-line counts how many of the room matter to YOU. The
  // build printed "· N judged" — a count of what the model processed, which is
  // Peer talking about its own machinery rather than about the reader.
  const counts = [
    organisations.length > 0
      ? `${organisationCards.length} of ${organisations.length} exhibitors`
      : undefined,
    people.length > 0
      ? `${peopleCards.length} of ${people.length} speakers`
      : undefined,
  ].filter(Boolean);

  return (
    <ReportSection
      // B-14. Fixed heading from plate 03.
      title="Who’ll be in the room"
      // V26-E01 (round 26 C). THE PROMOTION. Plate 03 sets this heading — and
      // only this heading, on either plate — in `Georgia 15.75` `#2b180a`,
      // sentence case: the deck's one L2 sub-head. It rendered here at the
      // build's SMALLEST step, 11.5 px uppercase faint sans. The string is not
      // touched; the sentence case comes from dropping `uppercase`.
      level="group"
      subtitle={`${counts.join(" and ")} concern you`}
      className="mt-14"
    >
      <div data-roster-layout="full-width" className="w-full space-y-10">
        {organisations.length > 0 && (
          <div>
            {organisationCards.length > 0 && (
              // V26-E01 (round 26 C). THE DEMOTION. Plate 03 sets
              // `Organisations` at exactly the LABEL size — the same
              // `SegoeUI-Semibold 7.88` as every section label — while the
              // build rendered it at 17.5 px semibold dark, its largest
              // sub-head step. Promoting `Who’ll be in the room` without this
              // would have left `Organisations` shouting over its own parent.
              // The `<h3>` element and the `ReportBadge` child both stay: the
              // badge sits on this line in the plate too.
              <h3
                className={`flex flex-wrap items-center gap-2 ${REPORT_LABEL_CLASS}`}
              >
                Organisations
                {organisationsAllTier0 && (
                  <ReportBadge tone="accent">{NO_MODEL_BADGE}</ReportBadge>
                )}
              </h3>
            )}
            <div className="mt-3 grid gap-2">
              {organisationCards
                .map(({ item, key, reason, judgment }) => (
                  <article
                    key={key}
                    data-roster-row="organisation"
                    data-roster-card="true"
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3",
                      judgment && !judgment.worthIt && "border-border bg-bg-secondary/50",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-heading">{item.name}</p>
                      {clean(item.descriptor) && (
                        <p className="mt-0.5 text-body-sm text-text-muted">
                          {item.descriptor}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-2 text-caption font-medium text-accent",
                          judgment && !judgment.worthIt && "text-text-muted",
                        )}
                      >
                        {reason ?? "You marked this organisation as important."}
                      </p>
                      {/* RULING 68a. Only in a MIXED section — the heading has
                          withdrawn its blanket claim, so each card says where
                          its own reason came from. */}
                      {!organisationsAllTier0 && (
                        <p className="mt-1.5">
                          <ReportBadge tone="accent">
                            {judgment ? MODEL_WRITTEN_BADGE : NO_MODEL_BADGE}
                          </ReportBadge>
                        </p>
                      )}
                      {clean(item.atEvent) && (
                        <p className="mt-1 text-caption text-text-faint">
                          At this event: {item.atEvent}
                        </p>
                      )}
                    </div>
                    {/* V26-E06 (round 26 C). The star is GONE from the highlighted
                        card. Plate 03 gives a highlighted card only its right-aligned
                        tinted descriptor badge; stars appear ONLY on the
                        `EVERY OTHER …` roster rows, where the control's own stated
                        purpose is "star anyone Peer got wrong" — which is meaningless
                        on a card Peer already put at the top.
                    
                        THE STATE AND THE CAPABILITY ARE UNTOUCHED. `ROSTER_STARS_KEY`,
                        `onToggleStar` and the roster-tail `StarButton` all stay: a
                        highlighted card and a roster row can be the SAME entity, so a
                        starred roster row must keep its star after the highlighted card
                        stops showing one. This removes a CONTROL from one render site,
                        not data and not a capability. */}
                  </article>
                ))}
            </div>
            <RosterTail
              kind="organisation"
              title="Every other organisation attending"
              footnote="Nothing is collapsed behind a “+29” — Peer’s guess about what matters to you is not good enough to hide anything."
              entries={organisationTail.map(({ item, key, starred }) => ({
                key,
                name: item.name,
                secondary: clean(item.descriptor),
                starred,
              }))}
              onToggleStar={onToggleStar}
            />
          </div>
        )}

        {people.length > 0 && (
          <div>
            {peopleCards.length > 0 && (
              // V26-E01 (round 26 C). THE SECOND DEMOTION — same plate
              // measurement, same reasoning as `Organisations` above.
              <h3
                className={`flex flex-wrap items-center gap-2 ${REPORT_LABEL_CLASS}`}
              >
                People
                {peopleAllTier0 && <ReportBadge tone="accent">{NO_MODEL_BADGE}</ReportBadge>}
              </h3>
            )}
            <div className="mt-3 grid gap-2">
              {peopleCards
                .map(({ item, key, reason, judgment, descriptor }) => (
                  <article
                    key={key}
                    data-roster-row="person"
                    data-roster-card="true"
                    className={cn(
                      "flex items-start justify-between gap-3 rounded-xl border border-accent/25 bg-accent/5 px-4 py-3",
                      judgment && !judgment.worthIt && "border-border bg-bg-secondary/50",
                    )}
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-heading">{item.name}</p>
                      {(clean(item.role) || clean(item.institution)) && (
                        <p className="mt-0.5 text-body-sm text-text-muted">
                          {[clean(item.role), clean(item.institution)]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                      {/* B2-16 / Ruling 13. Same slot the organisation card's
                          own descriptor uses, so the two card types read
                          alike. */}
                      {descriptor && (
                        <p className="mt-0.5 text-body-sm text-text-muted">
                          {descriptor}
                        </p>
                      )}
                      <p
                        className={cn(
                          "mt-2 text-caption font-medium text-accent",
                          judgment && !judgment.worthIt && "text-text-muted",
                        )}
                      >
                        {reason ?? "You marked this person as important."}
                      </p>
                      {/* RULING 68a. Per-card provenance in a MIXED section —
                          see the organisation card above. */}
                      {!peopleAllTier0 && (
                        <p className="mt-1.5">
                          <ReportBadge tone="accent">
                            {judgment ? MODEL_WRITTEN_BADGE : NO_MODEL_BADGE}
                          </ReportBadge>
                        </p>
                      )}
                      {clean(item.speaking) && (
                        <p className="mt-1 text-caption text-text-faint">
                          Speaking: {item.speaking}
                        </p>
                      )}
                    </div>
                    {/* V26-E06 (round 26 C). The star is GONE from the highlighted
                        card. Plate 03 gives a highlighted card only its right-aligned
                        tinted descriptor badge; stars appear ONLY on the
                        `EVERY OTHER …` roster rows, where the control's own stated
                        purpose is "star anyone Peer got wrong" — which is meaningless
                        on a card Peer already put at the top.
                    
                        THE STATE AND THE CAPABILITY ARE UNTOUCHED. `ROSTER_STARS_KEY`,
                        `onToggleStar` and the roster-tail `StarButton` all stay: a
                        highlighted card and a roster row can be the SAME entity, so a
                        starred roster row must keep its star after the highlighted card
                        stops showing one. This removes a CONTROL from one render site,
                        not data and not a capability. */}
                  </article>
                ))}
            </div>
            <RosterTail
              kind="person"
              title="Every other speaker"
              footnote="Full name, role and institution for everyone, pulled from the event’s own speaker page. Nobody is collapsed."
              entries={peopleTail.map(({ item, key, starred }) => ({
                key,
                name: item.name,
                secondary:
                  [clean(item.role), clean(item.institution)]
                    .filter(Boolean)
                    .join(" · ") || undefined,
                starred,
              }))}
              onToggleStar={onToggleStar}
            />
          </div>
        )}
      </div>
    </ReportSection>
  );
}

export function EventReport({
  event,
  careerStage,
  sector,
  rosterContext,
  enrichment = null,
  pageReadingReason,
  starredKeys = new Set<string>(),
  isSaved,
  isRegistered,
  isSubmitted,
  isInterested = false,
  nowMs,
  providerConfigured = false,
  // ABC-freemium 1-26 · R-UI-3 — the upsell is plan-aware now, so the view
  // needs the reader's plan as well as whether a model is reachable.
  //
  // ABC-freemium 6-04 · Ruling 16 points 2-3 — **`effectivePlan` lost its
  // `= "free"` default and is now required.** See the twin note in
  // `jobs/[id]/page.tsx`: a default on a pass-through hands back exactly the
  // fail-open discipline the two leaf components' required props were built to
  // enforce, one file further from where anyone would look for it.
  aiMode = "none",
  effectivePlan,
  // ABC-freemium 2-07 · R-QUOTA-1 — absent whenever the reader was served.
  quota,
  enrichmentLoading = false,
  onToggleStar,
  onToggleSave,
  onRegisteredChange,
  onSubmittedChange,
  onDismiss,
  onInterested = () => undefined,
  onBack,
}: {
  event: Event;
  careerStage?: CareerStage;
  /** B2-19. The reader's own stated sector lean, for the happenings footnote. */
  sector?: IndustryAcademiaPreference;
  rosterContext?: EventRosterContext;
  enrichment?: EventEnrichment | null;
  pageReadingReason?: OpportunityPageReadingReason;
  starredKeys?: ReadonlySet<string>;
  isSaved: boolean;
  isRegistered: boolean;
  isSubmitted: boolean;
  isInterested?: boolean;
  /**
   * B-02. Captured once by the page, never read from inside the component.
   * Plate 03 needs "92 days left" under ABSTRACT DUE and a "Today" milestone,
   * and every test here renders through renderToStaticMarkup against fixed
   * fixtures — calling Date.now() in the body would make them time-dependent.
   */
  nowMs: number;
  providerConfigured?: boolean;
  aiMode?: AiMode;
  /** 6-04 — required, and `null` means the plan is not known yet. */
  effectivePlan: Plan | null;
  quota?: QuotaSignal;
  enrichmentLoading?: boolean;
  onToggleStar: (key: string) => void;
  onToggleSave: () => void;
  onRegisteredChange: (next: boolean) => void;
  onSubmittedChange: (next: boolean) => void;
  onDismiss: () => void;
  onInterested?: () => void;
  onBack?: () => void;
}) {
  // Three states, three screens. Showing "connect a key" to somebody who has
  // one — because their page fetch failed — was the report contradicting itself
  // on the exact screen where they check whether their key works.
  const context = rosterContext ?? {
    savedEmployers: [],
    paperAuthors: [],
    declaredTopics: [],
    positiveLedgerLabels: [],
  };
  const matchPct = formatMatchPct(event.relevanceScore);
  const facts = buildEventFacts(event, nowMs);
  // B20-01, render site 3 of 6 — the report SUBTITLE's venue segment. The
  // format segment two lines below still prints "in person" for a hybrid;
  // that is a separate COPY question, deliberately left alone (writing
  // "hybrid" there would be inventing plate copy).
  const location =
    isOnlineOnly(event)
      ? "Online"
      : clean(event.location)?.toLowerCase() === "see event page"
        ? undefined
        : clean(event.location);
  // B-16. Plate 03's subtitle: venue · format · duration. "streamed keynotes"
  // is not a field, so the format segment says only what Peer knows. Duration
  // is derived from the two dates rather than invented.
  // A24-02 / Ruling 62b. Was `new Date(event.date).getTime()` — the ONE raw
  // `new Date()` left on this path, and the exact UTC trap `parseDate`'s own
  // header warns about: `new Date("2026-08")` and `new Date("2026-12-07")` are
  // UTC midnight and land on the PREVIOUS day (or month) in a behind-UTC zone,
  // while `daysUntil` parses the OTHER end of the same range as LOCAL. Two
  // conventions on one range. LATENT rather than firing — the live
  // month-granularity row's `endDate` is "" so the branch is skipped — and its
  // effect is invisible at small UTC offsets because `Math.round` absorbs
  // them, which is precisely why it must be closed before an `endDate`
  // arrives rather than after. `?? NaN` keeps an unparseable start producing
  // NO duration segment, exactly as the raw `new Date()` did; without it
  // `daysUntil`'s default would silently measure from NOW.
  const eventDays = event.endDate
    ? daysUntil(event.endDate, parseDate(event.date)?.getTime() ?? NaN) + 1
    : undefined;
  const subtitle = [
    location,
    event.isOnline ? "online" : "in person",
    eventDays && eventDays > 1 ? `${eventDays} days` : undefined,
  ]
    .filter(Boolean)
    .join(" · ");
  const primaryHref = clean(event.linkRegistration) ?? clean(event.linkOfficial);
  const primaryLabel =
    event.linkRegistration &&
    (!event.linkOfficial || event.linkRegistration !== event.linkOfficial)
      ? "Register"
      : "Official site";
  // B-16. Only when there is an abstract to submit, and only ever pointed at a
  // URL the event actually gave us.
  const abstractHref = clean(event.deadline)
    ? clean(event.linkOfficial) ?? clean(event.linkRegistration)
    : undefined;
  const cheapest = cheapestWayIn(event, careerStage);
  const milestones = deadlineMilestones(event, nowMs);
  const fees = event.fees ?? [];
  const activities = (event.activities ?? []).map(clean).filter(Boolean) as string[];
  // B2-11 / Ruling 14. The plate's second, more specific kind chip
  // ("+ career fair") — built only when the event's own activities actually
  // name a fair-type session.
  const secondaryKind = secondaryEventKind(activities, event.type);
  // B-12. Plate 03 marks three of six chips with a tick "because they line up
  // with your topics". Every chip rendered identically before, so the "which of
  // these matters to me" signal — the only reason to read the row — was gone.
  // Needles under four characters are dropped: a two-letter topic matches
  // almost any label and would highlight everything.
  const highlightedActivities = new Set(
    (() => {
      const needles = [
        ...new Set(
          [...(event.matchedTerms ?? []), ...context.declaredTopics]
            .map(normalized)
            .filter((term) => term.length >= 4),
        ),
      ];
      return activities.filter((activity) => {
        const label = normalized(activity);
        return needles.some(
          (needle) => label.includes(needle) || needle.includes(label),
        );
      });
    })(),
  );
  // B2-17. Same labels the chips themselves show (`formatActivityLabel`), in
  // the row's own order, so the footnote's list agrees with what the reader
  // just saw highlighted above it.
  const highlightedLabels = activities
    .filter((activity) => highlightedActivities.has(activity))
    .map(formatActivityLabel);
  const happeningsNote = happeningsFootnote(
    highlightedLabels,
    careerStage,
    sector,
  );
  const description = resolveEventReportDescription(
    event.reportSummary ? cleanOwnedEventReportSummary(event.reportSummary.text) : undefined,
    enrichment,
  );
  const travelGrant = clean(event.travelGrant);
  // Ruling 6. Both facts moved out of the happenings prose and into the cost
  // table, where the plate has them and where they are only stated once.
  // B2-15 / Ruling 15. The two rows get different treatments — see
  // `CostSupportRow`. Invitation letter is a boolean with a real STANDARD /
  // STUDENT / DEADLINE shape. Travel grant is one free-text blob; B3-07
  // converts it to the plate's own three-column shape (— / count clause /
  // application-method clause) only when the text visibly has that
  // two-clause shape (see `travelGrantColumns`) — anything else stays a
  // single spanning cell rather than being guessed apart.
  const travelGrantSplit = travelGrant
    ? travelGrantColumns(travelGrant)
    : undefined;
  const supportRows: CostSupportRow[] = [
    travelGrant
      ? travelGrantSplit
        ? {
            label: "Travel grant",
            kind: "columns",
            // Travel grants are student-targeted in every example this app
            // has — cheapestWayIn always describes a grant alongside a
            // student ticket — so STANDARD is the plate's own dash glyph.
            standard: "—",
            student: travelGrantSplit.student,
            deadline: travelGrantSplit.deadline,
          }
        : { label: "Travel grant", kind: "span", detail: travelGrant }
      : undefined,
    event.invitationLetter !== undefined
      ? {
          label: "Visa invitation letter",
          kind: "columns",
          standard: event.invitationLetter ? "On request" : "Not provided",
          student: event.invitationLetter ? "On request" : "Not provided",
          // The plate's own "Allow 3 weeks" turnaround has no field behind
          // it — invitationLetter is only a boolean. Printing the plate's
          // own example number here would be inventing a fact this event
          // never stated; the plate's own dash glyph goes here instead.
          deadline: "—",
        }
      : undefined,
  ].filter((row): row is CostSupportRow => Boolean(row));
  const hasHappenings = activities.length > 0 || Boolean(description);
  const displayedJudgments = (enrichment?.judgedAttendees ?? []).filter(
    ({ why }) => !isCachedRosterRejection(why),
  );
  const displayedTalks = (enrichment?.talkSummaries ?? []).filter(
    ({ title }) => !isCachedGenericSessionLabel(title),
  );
  const displayEnrichment: EventEnrichment | null = enrichment
    ? {
        ...enrichment,
        judgedAttendees:
          displayedJudgments.length > 0 ? displayedJudgments : undefined,
        talkSummaries: displayedTalks.length > 0 ? displayedTalks : undefined,
      }
    : null;
  const hasEnrichment = hasEventEnrichment(displayEnrichment);
  // B3-09. Computed once, read by both RosterSection (the roster cards and
  // the "Every other organisation attending · N" heading) and the locked
  // block's item 1 count below — the same live number in both places,
  // rather than two separate computations that could drift apart.
  const roster = partitionEventRoster(
    event,
    context,
    displayEnrichment,
    starredKeys,
  );

  return (
    <PageContainer
      width="wide"
      className="px-6 py-14 print:relative print:z-[60] print:bg-bg"
    >
      <div className="mx-auto max-w-[720px]">
        <BackToFeedLink
          onBack={onBack}
          className="inline-flex items-center gap-1 text-body-sm text-text-faint transition-colors hover:text-link"
        >
          <span aria-hidden>←</span>
          Back
        </BackToFeedLink>

        <header className="mt-8">
          <div className="mb-4 flex flex-wrap gap-2">
            {/* B3-04 / Ruling 19. The spec's own display label for this
                kind, not a mechanical humanisation of the raw enum value --
                see EVENT_TYPE_LABELS. */}
            <HeaderChip tone="kind">{eventTypeLabel(event.type)}</HeaderChip>
            {/* B2-10 / Ruling 7. §1c's line for this row was a transcription
                error — the plate's chip row is kind · secondary kind · rank ·
                match %, with no separate online/in-person chip. The format
                lives in the subtitle below (and the WHERE tile), which
                already prints "in person" / "online"; the chip stated it a
                second time. */}
            {/* B2-11 / Ruling 14. The plate's own text is lower-case ("+
                career fair"), read as a continuation of the primary chip
                rather than a second title. B3-05: now the resolved kind's
                own label, lower-cased, not the raw activity phrase that
                happened to match. */}
            {secondaryKind && (
              <HeaderChip>+ {lowercaseFirst(eventTypeLabel(secondaryKind))}</HeaderChip>
            )}
            {/* B-15. event.rank is written by the mapper and was read by
                nothing. §1c puts it here, between the format chip and the
                match chip. Most events have no rank, so it is guarded. */}
            {clean(event.rank) && <HeaderChip>{clean(event.rank)}</HeaderChip>}
            {matchPct !== null && (
              <HeaderChip accent>{matchPct}% match</HeaderChip>
            )}
          </div>
          {/* V26-E02 (round 26 A/B; landed round 26 C). Plate 03 sets the
              report title in `Georgia 21.0` `#2b180a`, one span, same treatment
              as plate 02's. See the twin comment on the job report's `<h1>`. */}
          <h1 className="font-display text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] text-heading lg:text-[40px]">
            {event.name}
          </h1>
          {/* B-16. Plate 03's subtitle — venue · format · duration. The
              When/Where grid used to sit here; B-05 moved both facts into the
              tile row below, which is where the plate puts them. */}
          {subtitle && (
            <p data-event-subtitle className="mt-3 text-body text-text-muted">
              {subtitle}
            </p>
          )}
          <EventActionRow
            primaryHref={primaryHref}
            primaryLabel={primaryLabel}
            abstractHref={abstractHref}
            isSaved={isSaved}
            isRegistered={isRegistered}
            isSubmitted={isSubmitted}
            isInterested={isInterested}
            onToggleSave={onToggleSave}
            onRegisteredChange={onRegisteredChange}
            onSubmittedChange={onSubmittedChange}
            onInterested={onInterested}
            onDismiss={onDismiss}
          />
        </header>

        {/* B-05. Plate 03's six-tile fact row, which the build did not have. */}
          {/* V26-J04 / V26-E04 (round 26 C). THE FACT-TILE BAND. Plates 02 and 03
              carry BYTE-IDENTICAL geometry here, pulled from the PDF's own vector
              rectangles: one backing rect at x 79.5, w 453.0, fill `#2a1709`, with
              FOUR lighter tiles laid on it (`#f1e8d9`) at x 79.5 / 192.8 / 306.8 /
              420.0 and 0.75 pt gaps between them. The gaps ARE the rules — the dark
              backing showing through — so `gap-px` over `bg-border` reproduces them
              with no divider element, no per-tile border and no new token.

              FOUR COLUMNS, CAPPED THERE, on both surfaces: the plate is 4-up on both,
              against the build's 7-up job and 6-up event.

              `grid-cols-2` at the narrowest width is a DISCLOSED DEVIATION — the plate
              has no narrow breakpoint to copy, and a single column of full-width tiles
              is not a band at all.

              The short second row carries NO backing rect on either plate, so rules
              must never trail into empty slots. A CSS grid with `gap-px` does that for
              free: a short final row simply ends, because there is no next cell to gap
              against. */}
        {facts.length > 0 && (
          <dl className="mt-8 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
            {facts.map((fact) => (
              <ReportFactTile
                key={fact.key}
                fact={fact}
                attribute="data-event-fact"
              />
            ))}
          </dl>
        )}

        {cheapest && <CheapestCallout cheapest={cheapest} />}
        {/* B-09. Every other block on the page is wrapped in a ReportSection;
            this one was rendered bare, so it emitted no heading at all. */}
        {/* B4-06 (R3). milestones always carries "Today", and "Event" whenever
            the event merely has a start date -- neither is a deadline, so
            gating on the array's raw length rendered this heading over an
            event with a known date but no abstract or registration deadline
            at all ("Two deadlines" over zero). Gate on an actual deadline
            existing instead; Today/Event still render inside the strip once
            the section does, unchanged -- they are the axis the deadlines
            are plotted against, not the promise being made. */}
        {milestones.some(
          (milestone) => milestone.key === "submission" || milestone.key === "registration",
        ) && (
          <ReportSection title="Two deadlines, one event">
            <DeadlineTimeline milestones={milestones} />
          </ReportSection>
        )}

        {hasHappenings && (
          <ReportSection title="What actually happens there">
            {/* V26-E05 (round 26 C). Plate 03 §9 badges this label `NEW`
                (`Consolas 8.25`, violet `#5b4bbf`) exactly as plate 02 badges
                the job report's structurally identical skills section — which
                already had it. THIS IS A COPY, NOT AN INVENTION.
            
                GATED ON THE CHIPS, which is the one way this cheap item can
                ship wrong: an event with no activities would otherwise carry a
                `NEW` badge and an explainer about chips that are not there. */}
            {activities.length > 0 && (
              <p className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
                <ReportBadge>New</ReportBadge>
              </p>
            )}
            {description && (
              <p className="text-body-lg leading-8 text-text">{description}</p>
            )}
            {activities.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-2">
                {activities.map((activity) => {
                  const highlighted = highlightedActivities.has(activity);
                  return (
                    <span
                      key={activity}
                      data-activity-chip={highlighted ? "matched" : "plain"}
                      className={cn(
                        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-meta",
                        highlighted
                          ? "border-accent/25 bg-accent/10 font-medium text-accent"
                          : "border-tag/20 bg-tag-dim text-tag",
                      )}
                    >
                      {formatActivityLabel(activity)}
                      {highlighted && <span aria-hidden>✓</span>}
                    </span>
                  );
                })}
              </div>
            )}
            {/* B2-17. The footnote only makes sense once something is
                highlighted, so it is tied to that. Names the actual
                highlighted chips (see `happeningsFootnote`) rather than the
                old generic "Those are the ones". The plate's "looking at
                industry" clause is left out on purpose — POLICY, see the
                round-2 loop log. */}
            {/* V26-E05 (round 26 C). Plate 03 §9 puts an explainer note
                beneath the chips, with a LEFT ORANGE RULE. The job report's
                equivalent note existed but had no rule; both now carry it, so
                A's observation closes on both surfaces at once.
            
                THE WORDS ARE WRITTEN FOR EVENTS, NOT COPIED. The job note ends
                "before you spend an evening on the application" — pasting that
                here would state something FALSE, because there is no
                application. The chip SEMANTICS transfer (`data-activity-chip`
                already mirrors `data-skill-requirement`), so the rule is
                described in the event's own terms.
            
                Gated on the chips, for the same reason as the badge above. */}
            {activities.length > 0 && (
              <p
                data-happenings-explainer
                className="mt-4 border-l-2 border-accent/50 pl-4 text-caption leading-5 text-text-faint"
              >
                Highlighted chips are the parts of this event that line up with
                your Required and Explore topics. The plain ones are everything
                else on the programme — worth a glance before you decide the
                trip is worth it.
              </p>
            )}
            {happeningsNote && (
              <p
                data-happenings-footnote
                className="mt-3 text-caption leading-5 text-text-faint"
              >
                {happeningsNote}
              </p>
            )}
            {/* Ruling 6. The travel grant and the invitation letter used to
                print here as prose AND as rows in the cost table below — the
                same fact twice. The plate has them in the table only. */}
          </ReportSection>
        )}
      </div>

      <RosterSection {...roster} onToggleStar={onToggleStar} />

      <div className="mx-auto max-w-[720px]">
        {displayEnrichment?.talkSummaries && (
          <ReportSection title="What each talk is actually about">
            <div className="space-y-3">
              {displayEnrichment.talkSummaries.map((talk) => (
                <article
                  key={talk.title}
                  className="rounded-xl border border-border bg-surface px-5 py-4"
                >
                  <h3 className="text-title font-semibold text-heading">{talk.title}</h3>
                  {talk.when && (
                    <p
                      data-talk-when
                      className="mt-1 text-caption font-medium text-accent"
                    >
                      {talk.when}
                    </p>
                  )}
                  <p className="mt-2 text-body leading-7 text-text-muted">{talk.about}</p>
                </article>
              ))}
            </div>
          </ReportSection>
        )}

        {/* B-04 / §1b Correction 1. Plate 03: "Which sessions to attend and
            who to find, in order." Every row was verified against the talk
            list or the attendee list at parse time, so nothing here can be a
            session or a person the event does not have. A cached entry from
            before this shipped simply has no plan and renders nothing. */}
        {displayEnrichment?.plan?.length ? (
          <ReportSection title="A day-by-day plan for you">
            <ol className="space-y-2">
              {displayEnrichment.plan.map((entry, index) => (
                <li
                  key={`${entry.kind}-${entry.label}`}
                  data-plan-entry={entry.kind}
                  className="flex gap-3 rounded-xl border border-border bg-surface px-5 py-3"
                >
                  <span
                    aria-hidden
                    className="text-body-sm font-semibold tabular-nums text-accent"
                  >
                    {index + 1}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-body-sm font-semibold text-heading">
                      {entry.label}
                    </span>
                    <span className="mt-0.5 block text-caption text-text-faint">
                      {entry.kind === "session" ? "Session" : "Person to find"}
                      {entry.when ? ` · ${entry.when}` : ""}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </ReportSection>
        ) : null}

        {enrichmentLoading && (
          <p
            data-enrichment-loading="event"
            role="status"
            aria-live="polite"
            className="mt-8 flex items-center gap-2 text-body-sm text-text-faint"
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
            />
            Peer is reading the programme page…
          </p>
        )}

        {!enrichmentLoading &&
          !displayEnrichment?.talkSummaries &&
          providerConfigured &&
          pageReadingReason && (
          <p
            data-page-reading-note="event"
            className="mt-8 text-body-sm text-text-faint"
          >
            {EVENT_PAGE_READING_NOTES[pageReadingReason]}
          </p>
        )}

        {displayEnrichment?.posterFit?.points?.length ? (
          <ReportSection title="Is your work a fit for the poster call">
            <div className="rounded-xl border border-accent/20 bg-accent/5 px-5 py-4">
              <p className="text-title font-semibold text-heading">
                {displayEnrichment.posterFit.fits
                  ? "Overlaps your topics"
                  : "Little overlap with your topics"}
              </p>
              <ul className="mt-3 space-y-2">
                {displayEnrichment.posterFit!.points.map((point) => (
                  <li
                    key={point}
                    data-poster-fit-point
                    className="relative pl-5 text-body leading-7 text-text-muted"
                  >
                    <span
                      aria-hidden
                      className="absolute left-0 top-[0.65em] h-1.5 w-1.5 rounded-full bg-accent/60"
                    />
                    {capGeneratedReasoning(point)}
                  </li>
                ))}
              </ul>
            </div>
          </ReportSection>
        ) : null}
      </div>


      <div className="mx-auto max-w-[720px]">
        {/* B-08. The cost table used to sit third from the top, ahead of both
            the programme and the roster. §1c puts it here — after "Who’ll be
            in the room" and immediately before "Why Peer sent this to you". */}
        {(fees.length > 0 || supportRows.length > 0) && (
          <ReportSection title="What it costs you">
            {/* B2-07 / Ruling 11. Plate 03 badges this heading TIER 0, same
                as "Why Peer sent this to you". */}
            <p className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
              <ReportBadge tone="accent">{NO_MODEL_BADGE}</ReportBadge>
            </p>
            <CostsTable
              fees={fees}
              supportRows={supportRows}
              cheapest={cheapest}
            />
          </ReportSection>
        )}

        {/* B-03 / §1b Correction 2. Per §1c this sits after "What it costs
            you" and before the locked block. */}
        <WhyPeerSentThis
          reason={event.relevanceReason}
          facetReason={event.facetPreferenceReason}
        />

        {/* ABC-freemium 2-07 · R-QUOTA-1 — beside the degraded report, never
            instead of it. Renders null when there is no signal. */}
        {/* ABC-freemium 3-01 · R-UI-3 — same plan the block below takes; a paid
            reader at the daily breaker is never upsold. */}
        <QuotaNotice quota={quota} effectivePlan={effectivePlan} />

        {/* ABC-freemium 1-26 — `hasEnrichment` still suppresses the block, and
            it is not about plans: if the enriched rows are already on the page
            there is nothing locked to advertise. It reaches the block through
            the existing `items.length === 0` guard rather than through a prop
            that would blur "already has it" into "already paid". */}
        <TierUpgradeBlock
          items={
            hasEnrichment
              ? []
              : buildEventTierUpgradeItems(
                  roster.organisations.length,
                  roster.organisationTail.length,
                )
          }
          aiMode={aiMode}
          effectivePlan={effectivePlan}
        />
      </div>
    </PageContainer>
  );
}

export default function EventDetailPage({
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
  const feedEvents = useFeedStore((state) => state.events);
  const eventPool = useFeedStore((state) => state.eventPool);
  const savedEvents = useFeedStore((state) => state.savedEvents);
  const isRegistered = useFeedStore((state) =>
    Boolean(state.registeredAt[id]),
  );
  const isSubmitted = useFeedStore((state) =>
    Boolean(state.submittedAt[id]),
  );
  const papers = useFeedStore((state) => state.papers);
  const savedPapers = useFeedStore((state) => state.savedPapers);
  const savedJobs = useFeedStore((state) => state.savedJobs);
  const markRead = useFeedStore((state) => state.markRead);
  const saveEvent = useFeedStore((state) => state.saveEvent);
  const unsaveEvent = useFeedStore((state) => state.unsaveEvent);
  const setEventRegistered = useFeedStore(
    (state) => state.setEventRegistered,
  );
  const setEventSubmitted = useFeedStore((state) => state.setEventSubmitted);
  const notInterestedEvent = useFeedStore((state) => state.notInterestedEvent);
  const moreLikeEvent = useFeedStore((state) => state.moreLikeEvent);
  const feedback = useFeedStore((state) => state.eventFeedback[id]);
  const profile = useProfileStore((state) => state.profile);
  // ABC-freemium 1-14 — what the server says this reader may use.
  // ABC-freemium 6-04 — `null` until the profile fetch answers. `grants` is the
  // capability view (anonymous while unknown, so AI and enrichment stay off);
  // the raw `entitlement` is what the upsell props read, because they must be
  // able to tell "free" from "we have not asked yet".
  const entitlement = useProfileStore((state) => state.entitlement);
  const grants = entitlementGrants(entitlement);
  const [starredKeys, toggleStar] = useRosterStars();
  const [nowMs] = useState(Date.now);
  const [enrichmentResult, setEnrichmentResult] = useState<{
    key: string;
    result: OpportunityEnrichmentLoadResult<EventEnrichment> | null;
    done: boolean;
  }>({ key: "", result: null, done: false });
  // ABC-freemium 2-07 · R-QUOTA-1 — held OUTSIDE the enrichment result, because
  // that result is cached in browser storage and a cached quota signal is a
  // stale one. See the matching note on the jobs report.
  const [quota, setQuota] = useState<QuotaSignal | undefined>(undefined);

  const event =
    feedEvents.find((candidate) => candidate.id === id) ??
    eventPool.find((candidate) => candidate.id === id) ??
    savedEvents.find((candidate) => candidate.id === id);
  const isSaved = savedEvents.some((candidate) => candidate.id === id);
  const contextHint = buildEnrichmentContext(profile);
  const enrichmentKey = event
    ? opportunityEnrichmentCacheKey(
        "event",
        event.id,
        contextHint,
        profile.feedAiProvider,
      )
    : "";

  useEffect(() => {
    if (event) markRead(event.id);
  }, [event, markRead]);

  useEffect(() => {
    if (!event || !enrichmentKey) return;

    let cancelled = false;
    void loadConfiguredOpportunityEnrichment<
      OpportunityEnrichmentLoadResult<EventEnrichment>
    >(
      {
        feedAiProvider: profile.feedAiProvider,
        feedAiApiKey: profile.feedAiApiKey,
      },
      enrichmentKey,
      async (llmOverride) => {
        const response = await fetch("/api/events/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ event, contextHint, llmOverride }),
        });
        if (!response.ok) {
          throw new Error(`Event report failed: ${response.status}`);
        }
        const result = (await response.json()) as {
          enrichment: EventEnrichment | null;
          sourceReadStatus?:
            | "read"
            | "failed"
            | "not-requested";
          // ABC-freemium 2-07 — the field this fetcher always dropped.
          quota?: QuotaSignal;
        };
        setQuota(result.quota);
        return {
          enrichment: result.enrichment ?? null,
          sourceReadStatus:
            result.sourceReadStatus === "read" ||
            result.sourceReadStatus === "not-requested"
              ? result.sourceReadStatus
              : "failed",
        };
      },
    ).then((result) => {
      if (cancelled) return;
      setEnrichmentResult({ key: enrichmentKey, result, done: true });
    });

    return () => {
      cancelled = true;
    };
  }, [
    event,
    contextHint,
    enrichmentKey,
    profile,
  ]);

  const rosterContext = useMemo<EventRosterContext>(
    () => ({
      savedEmployers: savedJobs
        .map((job) => job.companyOrLab)
        .filter((company): company is string => Boolean(company)),
      paperAuthors: [...papers, ...savedPapers].flatMap((paper) => paper.authors),
      declaredTopics: [
        ...profile.researchTopics,
        ...profile.eventRequiredTopics,
        ...profile.eventExploreTopics,
      ],
      positiveLedgerLabels: Object.values(
        profile.preferenceLedger ?? {},
      ).flatMap((entry) =>
        entry.positive + (entry.facetPositive ?? 0) > entry.negative
          ? [entry.label]
          : [],
      ),
    }),
    [
      papers,
      profile.eventExploreTopics,
      profile.eventRequiredTopics,
      profile.preferenceLedger,
      profile.researchTopics,
      savedJobs,
      savedPapers,
    ],
  );

  if (!event) {
    return (
      <PageContainer width="narrow" className="px-6 py-20">
        <p className="italic text-text-muted">Event not found.</p>
        <BackToFeedLink
          onBack={() => router.back()}
          className="mt-3 inline-block text-body text-link"
        >
          ← Back to feed
        </BackToFeedLink>
      </PageContainer>
    );
  }

  const currentEnrichmentDone =
    enrichmentResult.key === enrichmentKey && enrichmentResult.done;
  const currentEnrichmentResult = currentEnrichmentDone
    ? enrichmentResult.result
    : null;
  const pageReadingReason = currentEnrichmentDone
    ? opportunityPageReadingReason(
        currentEnrichmentResult,
        canAttemptOpportunityEnrichment(profile, grants),
      )
    : undefined;

  return (
    <EventReport
      event={event}
      careerStage={profile.careerStage}
      sector={profile.industryVsAcademia}
      rosterContext={rosterContext}
      enrichment={currentEnrichmentResult?.enrichment ?? null}
      pageReadingReason={pageReadingReason}
      enrichmentLoading={!currentEnrichmentDone && canAttemptOpportunityEnrichment(profile, grants)}
      providerConfigured={canAttemptOpportunityEnrichment(profile, grants)}
      aiMode={aiAvailability(profile, grants)}
      effectivePlan={entitlement?.effectivePlan ?? null}
      starredKeys={starredKeys}
      quota={quota}
      isSaved={isSaved}
      isRegistered={isRegistered}
      isSubmitted={isSubmitted}
      nowMs={nowMs}
      isInterested={
        (feedback ?? event.feedback) === "moreLikeThis" ||
        (feedback ?? event.feedback) === "liked"
      }
      onToggleStar={toggleStar}
      onToggleSave={() =>
        isSaved ? unsaveEvent(event.id) : saveEvent(event)
      }
      onRegisteredChange={(next) => setEventRegistered(event, next)}
      onSubmittedChange={(next) => setEventSubmitted(event, next)}
      onInterested={() => moreLikeEvent(event)}
      onDismiss={() => {
        notInterestedEvent(event);
        window.history.back();
      }}
      onBack={() => router.back()}
    />
  );
}
