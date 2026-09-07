"use client";

import { use, useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { Job, RoleKind } from "@/types";
import type { JobSourceId } from "@/lib/jobs/types";
import { useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { aiAvailability, type AiMode } from "@/lib/feed/ai-tier";
import { entitlementGrants } from "@/lib/entitlement/allowance";
import type { Plan } from "@/lib/entitlement/types";
import {
  daysUntil,
  formatDate,
  formatDaysAgo,
  formatDaysLeft,
  formatMatchPct,
} from "@/lib/format";
import { reportShortDate } from "@/components/reports/report-date";
import { formatSalaryRange } from "@/lib/opportunities/salary";
import {
  cleanJobDescription,
  cleanJobSubtitlePart,
  cleanJobTitle,
} from "@/lib/opportunities/job-cleanup";
import {
  buildEnrichmentContext,
  canAttemptOpportunityEnrichment,
  hasJobEnrichment,
  loadConfiguredOpportunityEnrichment,
  opportunityPageReadingReason,
  opportunityEnrichmentCacheKey,
  type JobEnrichment,
  type OpportunityEnrichmentLoadResult,
  type OpportunityPageReadingReason,
} from "@/lib/opportunities/enrichment";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { PageContainer } from "@/components/ui/page-container";
import { TierUpgradeBlock } from "@/components/reports/tier-upgrade-block";
import { QuotaNotice } from "@/components/reports/quota-notice";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { WhyPeerSentThis } from "@/components/reports/why-peer-sent-this";
import { ReportTimelineTrack } from "@/components/reports/timeline-track";
import {
  REPORT_LABEL_CLASS,
  REPORT_LABEL_STEP,
  ReportSection as SharedReportSection,
} from "@/components/reports/report-section";
import { ReportFactTile } from "@/components/reports/fact-tile";
import { NO_MODEL_BADGE, ReportBadge } from "@/components/reports/report-badge";
import { CompletionPill } from "@/components/opportunities/completion-pill";
import { OpportunityFeedbackPair } from "@/components/opportunities/feedback-pair";
import { BackToFeedLink } from "@/components/navigation/back-to-feed-link";

/**
 * B-20. Plate 02's wording for the promises that survive.
 *
 * Two of the plate's four are deliberately absent under manager ruling §1d:
 * "How competitive this actually is" (Peer presents, the reader judges) and
 * "The role in three clean sentences" (merged into "What the role is"). A
 * promise for a feature we will not build is the exact dishonesty this block
 * was rewritten to remove, so neither is listed.
 */
const JOB_TIER_UPGRADE_ITEMS = [
  {
    title: "Sponsorship read when the posting is silent",
    description:
      "Judges this employer's track record instead of leaving it at “not stated”.",
  },
  {
    // Not on the plate. Ruling §1d keeps it: Phase 9 built it, it quotes the
    // posting verbatim, and the plate predates the feature.
    title: "What this employer actually asks for",
    description:
      "Quotes the specific requirements and duties from the posting itself.",
  },
  {
    title: "What to emphasise in your application",
    description:
      "Which of your papers and methods to lead with, given this team's work.",
  },
];

const JOB_PAGE_READING_NOTES: Record<OpportunityPageReadingReason, string> = {
  "no-provider": "Connect an AI key to let Peer read the job posting.",
  "no-quotable-details":
    "Peer read the job posting but found no requirements or duties it could quote.",
  "read-failed": "Peer could not finish reading the job posting this time.",
};

const ROLE_LABELS: Record<RoleKind, string> = {
  internship: "Internship",
  "phd-position": "PhD position",
  postdoc: "Postdoc",
  staff: "Staff",
  faculty: "Faculty",
};

type VisaState = NonNullable<Job["visa"]>["state"];

const VISA_LABELS: Record<VisaState, string> = {
  // B2-04. Plate 02's header chip reads "Visa sponsorship", not
  // "Sponsorship available" — this wording never matched the plate. The
  // other two states have no plate example to check against, so they are
  // left as they were rather than guessed at.
  sponsors: "Visa sponsorship",
  "not-stated": "Visa not stated",
  "wont-sponsor": "No sponsorship",
};

/**
 * B4-05 (R6). `job.sourceId` is one of jobweb.ts's seven internal adapter
 * ids — a real fact worth stating ("found on Adzuna"), but the raw id is
 * not display copy; nothing translated it before, so the report printed
 * literal strings like "jobweb". Five of the seven are real, named products
 * a reader could look up and recognise. `jobweb` (general Tavily/Brave web
 * search) and `jsearch` (a RapidAPI aggregator wrapping Google for Jobs)
 * are not brand names — rather than dressing up an internal slug as if it
 * were a company, they get an honest, generic description instead.
 * Presentation-only: `job.sourceId` itself is untouched, since
 * `jobPrestige()` (`lib/jobs/card.ts`) branches on its exact value.
 */
const JOB_SOURCE_LABELS: Record<JobSourceId, string> = {
  adzuna: "Adzuna",
  usajobs: "USAJOBS",
  remotive: "Remotive",
  arbeitnow: "Arbeitnow",
  himalayas: "Himalayas",
  jobweb: "Web search",
  jsearch: "Job search aggregator",
};

function jobSourceLabel(sourceId: string | undefined): string | undefined {
  const cleaned = clean(sourceId);
  if (!cleaned) return undefined;
  return JOB_SOURCE_LABELS[cleaned as JobSourceId] ?? cleaned;
}

/**
 * B-06. The VISA tile's short value, from plate 02. Deliberately different
 * words from the header chip above it: the tile is labelled "VISA" already, so
 * repeating "Visa sponsorship" would print the same fact twice in the
 * same eyeful.
 */
const VISA_TILE_LABELS: Record<VisaState, string> = {
  sponsors: "Sponsors",
  "not-stated": "Not stated",
  "wont-sponsor": "No",
};

/** B-06. The SALARY tile's sub-line: "per year", not the value's "/ yr". */
const SALARY_PERIODS: Record<
  NonNullable<Job["salary"]>["period"],
  string
> = {
  year: "per year",
  month: "per month",
  hour: "per hour",
};

type JobFactKey =
  | "salary"
  | "employment-type"
  | "work-mode"
  | "posted"
  | "deadline"
  | "start"
  | "visa";

interface JobFact {
  key: JobFactKey;
  label: string;
  value: string;
  /**
   * B-06. Plate 02's second grey line under every tile. It carries the two
   * highest-value numbers on the row — "47 days left" and "8 days ago" —
   * which appeared nowhere in the report before.
   */
  detail?: string;
  tone?: "accent" | "danger";
}

interface TimelinePoint {
  key: "posted" | "today" | "deadline" | "start";
  label: string;
  // B3-02. Optional: the "Today" point prints the bare word with nothing
  // beneath it, on the plate. Every other point still has one.
  value?: string;
  accent?: boolean;
}

// Full stops inside initials and abbreviations do not end a sentence — "Y. Chen"
// and "e.g." would otherwise each start a new bullet.
const NOT_A_BULLET_BREAK_RE =
  /(?:^|[\s("'[])(?:[A-Z]|[Ee]\.g|[Ii]\.e|U\.S|U\.K|Dr|Prof|Mr|Mrs|Ms|St|vs|etc|No|Fig|Vol|Jr|Sr|Ph\.D|cf|al)$/;

const MAX_ROLE_BULLETS = 5;

/** Split the posting's own prose into whole-sentence bullets. Never mid-word. */
export function splitIntoBullets(text: string | undefined): string[] {
  const source = text?.replace(/\s+/g, " ").trim();
  if (!source) return [];
  const bullets: string[] = [];
  let start = 0;
  for (const match of source.matchAll(/[.!?](?:["')\]]*)?(?=\s|$)/g)) {
    if (match.index === undefined) continue;
    if (NOT_A_BULLET_BREAK_RE.test(source.slice(0, match.index))) continue;
    const end = match.index + match[0].length;
    const sentence = source.slice(start, end).trim();
    if (sentence) bullets.push(sentence);
    start = end;
  }
  const tail = source.slice(start).trim();
  // A trailing fragment with no full stop is an unfinished sentence — drop it
  // rather than print half a thought, unless it is all we have.
  if (tail && bullets.length === 0) bullets.push(tail);
  return bullets.slice(0, MAX_ROLE_BULLETS);
}

function clean(value: string | null | undefined): string | undefined {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed || undefined;
}

/**
 * B5-04/R12. `scoredJobToJob()` (`jobs/mapper.ts`) writes the literal string
 * "See posting" into `job.location` when nothing better is known and the job
 * isn't remote — a placeholder, not a real value, but nothing downstream
 * used to treat it as one. The event report already guards its own
 * equivalent placeholder ("see event page") at both of its call sites; the
 * job report never mirrored it. One constant, compared lower-cased, so both
 * call sites below cannot drift into checking two different strings.
 */
const JOB_LOCATION_PLACEHOLDER = "see posting";

/**
 * B2-03. `job.employmentType` arrives as a slug ("full-time", "part_time")
 * and the plate wants it capitalised as ONE phrase — "Full-time" — not every
 * word capitalised. The old body stripped hyphens before capitalising, so a
 * single hyphenated word lost its hyphen and became two separate capitalised
 * words, "Full Time". Same bug class as B-12's activity-label mangling: a
 * formatter meant for slugs applied to a value that already reads as prose.
 * An underscore is a genuine slug separator and becomes a space; a hyphen is
 * not and stays exactly where it is.
 */
function humanize(value: string): string {
  const words = value.replace(/_+/g, " ").replace(/\s+/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * B2-04 / Ruling 9. The plate states the same contract length twice, in two
 * phrasings — "3 years" in the header chip, "3-yr contract" in the TYPE
 * tile's detail line. A's round-2 report called this a structural conflict
 * (one field, two different strings); Ruling 9 overruled that: one field plus
 * two formatters produces both.
 *
 * `job.contractLength` is scraped free text ("3-year fixed-term position",
 * "fixed-term appointment for 3 years", or occasionally no duration at all)
 * — it is not normalised at the source, and this does not change that.
 * `expandContractLength` pulls a clean "N years" / "N months" out of that text
 * when one is there; `abbreviateContractLength` then turns that into the
 * tile's short form. Neither invents a duration: text that does not parse
 * comes back verbatim, unabbreviated, in both places.
 */
const CONTRACT_WORD_NUMBERS: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};
const CONTRACT_DURATION_RE =
  /\b(\d+(?:\.\d+)?|one|two|three|four|five)[\s-]*(year|month)s?\b/i;

function expandContractLength(value: string): string {
  const match = CONTRACT_DURATION_RE.exec(value);
  if (!match) return value;
  const amount = CONTRACT_WORD_NUMBERS[match[1].toLowerCase()] ?? Number(match[1]);
  const unit = match[2].toLowerCase();
  return `${amount} ${unit}${amount === 1 ? "" : "s"}`;
}

function abbreviateContractLength(value: string): string {
  const match = /^(\d+(?:\.\d+)?)\s+(year|month)s?$/i.exec(value);
  if (!match) return value;
  const unit = match[2].toLowerCase() === "year" ? "yr" : "mo";
  return `${match[1]}-${unit} contract`;
}

/**
 * The VISA FACT TILE's tone. Unchanged, and deliberately so.
 *
 * **DEVIATION FROM B's DESIGN, TRACED BEFORE IT WAS TAKEN (round 26 C,
 * V26-J08).** B wrote *"point `visaTone`'s `sponsors` branch at `info`"* — but
 * `visaTone` feeds TWO consumers, the header chip AND the fact tile, and the
 * typecheck caught it immediately (`JobFact["tone"]` admits only
 * `accent | danger`). Moving this function would have retinted a fact tile that
 * no item asked to change, which standard 7 forbids: a visual commit must not
 * move anything the value census reads.
 *
 * So the CHIP gets its own mapping below and this one is untouched. B's intent
 * — "only the `sponsors` branch of the CHIP moves" — is honoured exactly; only
 * the mechanism differs, because B priced it without knowing the function was
 * shared.
 */
function visaTone(state: VisaState): "accent" | "danger" | undefined {
  if (state === "sponsors") return "accent";
  if (state === "wont-sponsor") return "danger";
  return undefined;
}

/**
 * V26-J08. The HEADER CHIP's tone, which is the one the plate distinguishes.
 * `sponsors` was rendering `accent` — identical to the `91% match` chip beside
 * it — and plate 02 gives it its own blue. `wont-sponsor` KEEPS `danger`: the
 * plate has no won't-sponsor chip to copy and turning a red warning blue would
 * be a real regression.
 */
function visaChipTone(
  state: VisaState,
): "accent" | "danger" | "info" | "kind" | undefined {
  if (state === "sponsors") return "info";
  if (state === "wont-sponsor") return "danger";
  return undefined;
}

const WORK_MODE_LABELS: Record<NonNullable<Job["workMode"]>, string> = {
  "on-site": "On-site",
  hybrid: "Hybrid",
  remote: "Remote",
};

/**
 * B2-06. Prefers the new three-state field; falls back to the boolean so a
 * job whose mapper hasn't populated `workMode` yet (or was scored before this
 * field existed) still shows exactly what it showed before — "Remote" when
 * `isRemote`, nothing otherwise.
 */
function workModeLabel(job: Job): string | undefined {
  if (job.workMode) return WORK_MODE_LABELS[job.workMode];
  return job.isRemote ? "Remote" : undefined;
}

/**
 * B4-13 / B3-08. Plate's LOCATION sub-line prints the two-letter form
 * ("Hybrid · US"); `job.place.country` arrives normalised to the full
 * canonical name ("United States") via `matchCountryToken`/`COUNTRY_ALIASES`
 * (`web/src/lib/opportunities/structured-extract.ts`) — this report gets its
 * own vocabulary to bridge the two, the same precedent B2-01 set for date
 * formatting. ISO 3166-1 alpha-2, ordered and spelled to match this
 * codebase's own `COUNTRY_NAMES` gazetteer (`structured-extract.ts:806-819`)
 * entry for entry — `page.test.ts`'s "every COUNTRY_NAMES entry has an
 * abbreviation" case is what keeps the two from silently drifting apart, not
 * anything the compiler can check on its own (`COUNTRY_NAMES` is a runtime
 * string list, not a union type `Record` could be keyed on). "United States"
 * and "United States of America" are both real `COUNTRY_NAMES` entries (the
 * gazetteer's own alias handling) and deliberately both map to "US".
 *
 * Exported (unlike this file's other label maps) specifically so a test can
 * check it against `COUNTRY_NAMES` directly — the other maps are keyed by a
 * real TypeScript union (`RoleKind`, `JobSourceId`, `Job["workMode"]`), so
 * the compiler already refuses a missing case; this one has no such
 * guarantee to lean on.
 */
export const COUNTRY_ABBREVIATIONS: Readonly<Record<string, string>> = {
  Afghanistan: "AF",
  Albania: "AL",
  Algeria: "DZ",
  Andorra: "AD",
  Angola: "AO",
  "Antigua and Barbuda": "AG",
  Argentina: "AR",
  Armenia: "AM",
  Australia: "AU",
  Austria: "AT",
  Azerbaijan: "AZ",
  Bahamas: "BS",
  Bahrain: "BH",
  Bangladesh: "BD",
  Barbados: "BB",
  Belarus: "BY",
  Belgium: "BE",
  Belize: "BZ",
  Benin: "BJ",
  Bhutan: "BT",
  Bolivia: "BO",
  "Bosnia and Herzegovina": "BA",
  Botswana: "BW",
  Brazil: "BR",
  Brunei: "BN",
  Bulgaria: "BG",
  "Burkina Faso": "BF",
  Burundi: "BI",
  "Cabo Verde": "CV",
  Cambodia: "KH",
  Cameroon: "CM",
  Canada: "CA",
  "Central African Republic": "CF",
  Chad: "TD",
  Chile: "CL",
  China: "CN",
  Colombia: "CO",
  Comoros: "KM",
  "Costa Rica": "CR",
  Croatia: "HR",
  Cuba: "CU",
  Cyprus: "CY",
  "Czech Republic": "CZ",
  Czechia: "CZ",
  "Democratic Republic of the Congo": "CD",
  Denmark: "DK",
  Djibouti: "DJ",
  Dominica: "DM",
  "Dominican Republic": "DO",
  Ecuador: "EC",
  Egypt: "EG",
  "El Salvador": "SV",
  "Equatorial Guinea": "GQ",
  Eritrea: "ER",
  Estonia: "EE",
  Eswatini: "SZ",
  Ethiopia: "ET",
  Fiji: "FJ",
  Finland: "FI",
  France: "FR",
  Gabon: "GA",
  Gambia: "GM",
  Georgia: "GE",
  Germany: "DE",
  Ghana: "GH",
  Greece: "GR",
  Grenada: "GD",
  Guatemala: "GT",
  Guinea: "GN",
  "Guinea-Bissau": "GW",
  Guyana: "GY",
  Haiti: "HT",
  Honduras: "HN",
  Hungary: "HU",
  Iceland: "IS",
  India: "IN",
  Indonesia: "ID",
  Iran: "IR",
  Iraq: "IQ",
  Ireland: "IE",
  Israel: "IL",
  Italy: "IT",
  "Ivory Coast": "CI",
  Jamaica: "JM",
  Japan: "JP",
  Jordan: "JO",
  Kazakhstan: "KZ",
  Kenya: "KE",
  Kiribati: "KI",
  Kuwait: "KW",
  Kyrgyzstan: "KG",
  Laos: "LA",
  Latvia: "LV",
  Lebanon: "LB",
  Lesotho: "LS",
  Liberia: "LR",
  Libya: "LY",
  Liechtenstein: "LI",
  Lithuania: "LT",
  Luxembourg: "LU",
  Madagascar: "MG",
  Malawi: "MW",
  Malaysia: "MY",
  Maldives: "MV",
  Mali: "ML",
  Malta: "MT",
  "Marshall Islands": "MH",
  Mauritania: "MR",
  Mauritius: "MU",
  Mexico: "MX",
  Micronesia: "FM",
  Moldova: "MD",
  Monaco: "MC",
  Mongolia: "MN",
  Montenegro: "ME",
  Morocco: "MA",
  Mozambique: "MZ",
  Myanmar: "MM",
  Namibia: "NA",
  Nauru: "NR",
  Nepal: "NP",
  Netherlands: "NL",
  "New Zealand": "NZ",
  Nicaragua: "NI",
  Niger: "NE",
  Nigeria: "NG",
  "North Korea": "KP",
  "North Macedonia": "MK",
  Norway: "NO",
  Oman: "OM",
  Pakistan: "PK",
  Palau: "PW",
  Palestine: "PS",
  Panama: "PA",
  "Papua New Guinea": "PG",
  Paraguay: "PY",
  Peru: "PE",
  Philippines: "PH",
  Poland: "PL",
  Portugal: "PT",
  Qatar: "QA",
  "Republic of the Congo": "CG",
  Romania: "RO",
  Russia: "RU",
  Rwanda: "RW",
  "Saint Kitts and Nevis": "KN",
  "Saint Lucia": "LC",
  "Saint Vincent and the Grenadines": "VC",
  Samoa: "WS",
  "San Marino": "SM",
  "Sao Tome and Principe": "ST",
  "Saudi Arabia": "SA",
  Senegal: "SN",
  Serbia: "RS",
  Seychelles: "SC",
  "Sierra Leone": "SL",
  Singapore: "SG",
  Slovakia: "SK",
  Slovenia: "SI",
  "Solomon Islands": "SB",
  Somalia: "SO",
  "South Africa": "ZA",
  "South Korea": "KR",
  "South Sudan": "SS",
  Spain: "ES",
  "Sri Lanka": "LK",
  Sudan: "SD",
  Suriname: "SR",
  Sweden: "SE",
  Switzerland: "CH",
  Syria: "SY",
  Taiwan: "TW",
  Tajikistan: "TJ",
  Tanzania: "TZ",
  Thailand: "TH",
  "Timor-Leste": "TL",
  Togo: "TG",
  Tonga: "TO",
  "Trinidad and Tobago": "TT",
  Tunisia: "TN",
  Turkey: "TR",
  Turkmenistan: "TM",
  Tuvalu: "TV",
  Uganda: "UG",
  Ukraine: "UA",
  "United Arab Emirates": "AE",
  "United Kingdom": "GB",
  "United States": "US",
  "United States of America": "US",
  Uruguay: "UY",
  Uzbekistan: "UZ",
  Vanuatu: "VU",
  "Vatican City": "VA",
  Venezuela: "VE",
  Vietnam: "VN",
  Yemen: "YE",
  Zambia: "ZM",
  Zimbabwe: "ZW",
};

/**
 * Never omits a country for lack of a short form — falls back to the full
 * name exactly as every LOCATION sub-line did before this table existed,
 * rather than dropping real, sourced data because it has no code yet.
 */
function countryAbbreviation(country: string | undefined): string | undefined {
  if (!country) return undefined;
  return COUNTRY_ABBREVIATIONS[country] ?? country;
}

/**
 * B-06. Plate 02's seven tiles, each with a label, a value and a grey
 * sub-line. Two were missing entirely — LOCATION was built only for remote
 * jobs, and VISA was in the key union but never pushed, so the visa state
 * lived only as a header chip.
 *
 * B2-06 added a work-mode field, so the LOCATION sub-line can now show
 * "Hybrid" or "On-site" when the posting says so, not only "Remote". The
 * plate's parenthetical, "(3 days on-site)", has no field behind it and is
 * not invented — just the mode word prints.
 */
export function buildJobFacts(job: Job, nowMs: number = Date.now()): JobFact[] {
  // B2-01 / Ruling 8. Plate 02 shows dates without a year inside the report's
  // own horizon ("Sep 15", not "Sep 15, 2026") and STARTS at month+year only
  // ("Jan 2027") — never a day of month. `reportShortDate` also guards
  // against a date more than ~12 months out silently losing its year.
  const posted = reportShortDate(job.postedDate, nowMs);
  const deadline = reportShortDate(job.applicationDeadline, nowMs);
  const start = formatDate(job.startDate, "monthYear");
  const location = clean(job.location);
  // B2-04. Expand once, abbreviate for the tile; the header chip below uses
  // the same expanded value unabbreviated.
  const contractLengthExpanded = clean(job.contractLength)
    ? expandContractLength(clean(job.contractLength)!)
    : undefined;
  const facts: Array<JobFact | undefined> = [
    job.salary
      ? {
          key: "salary",
          label: "Salary",
          // B2-02. The period used to print twice — once inside this value
          // (formatSalary's own "/ yr" suffix) and again in the detail line
          // below. formatSalaryRange carries no period; the detail line below
          // is the only place it appears now.
          value: formatSalaryRange(job.salary),
          detail: `${SALARY_PERIODS[job.salary.period]} · ${
            job.salaryIsEstimated ? "estimated" : "from posting"
          }`,
        }
      : undefined,
    job.roleKind || clean(job.employmentType)
      ? {
          key: "employment-type",
          label: "Type",
          value: job.roleKind
            ? ROLE_LABELS[job.roleKind]
            : humanize(job.employmentType!),
          detail:
            [
              job.roleKind && clean(job.employmentType)
                ? humanize(job.employmentType!)
                : undefined,
              // B2-04. The plate's short form, "3-yr contract" — abbreviated
              // from the same expanded value the header chip states in full.
              contractLengthExpanded
                ? abbreviateContractLength(contractLengthExpanded)
                : undefined,
            ]
              .filter(Boolean)
              .join(" · ") || undefined,
        }
      : undefined,
    location && location.toLowerCase() !== JOB_LOCATION_PLACEHOLDER
      ? {
          key: "work-mode",
          label: "Location",
          value: location,
          // B2-06 / B3-08 / B4-13. Plate's "Hybrid · US" sub-line — the mode
          // word comes from job.workMode when the posting states it, and the
          // country (when job.place carries one) now joins it here,
          // abbreviated to the plate's two-letter form. Kept local to this
          // tile rather than folded into workModeLabel() itself, which the
          // subtitle's third segment also calls and whose own plate example
          // ("Hybrid (3 days on-site)") never shows a country — appending it
          // inside workModeLabel would leak it there too.
          detail:
            [workModeLabel(job), countryAbbreviation(clean(job.place?.country))]
              .filter(Boolean)
              .join(" · ") || undefined,
        }
      : undefined,
    // B2-05 / B3-06 / Ruling 20. The plate's "flexible" sub-line states
    // whether the start date is negotiable. `job.startDateFlexible` is
    // `undefined` unless the posting itself says so (extracted upstream in
    // `extractJobDetails`, never inferred from silence, same convention as
    // `workMode`) — the detail only ever prints the fixed word "flexible",
    // never invented for a posting that doesn't say it.
    start
      ? {
          key: "start",
          label: "Starts",
          value: start,
          detail: job.startDateFlexible ? "flexible" : undefined,
        }
      : undefined,
    deadline
      ? {
          key: "deadline",
          label: "Apply by",
          value: deadline,
          detail: formatDaysLeft(daysUntil(job.applicationDeadline!, nowMs)),
        }
      : undefined,
    posted
      ? {
          key: "posted",
          label: "Posted",
          value: posted,
          detail: formatDaysAgo(-daysUntil(job.postedDate!, nowMs)),
        }
      : undefined,
    job.visa
      ? {
          key: "visa",
          label: "Visa",
          // The plate's short value. The header chip keeps the long one, so
          // the two never print the same words twice.
          value: VISA_TILE_LABELS[job.visa.state],
          detail: clean(job.visa.evidence)
            ? "stated in the posting"
            : undefined,
          tone: visaTone(job.visa.state),
        }
      : undefined,
  ];
  return facts.filter((fact): fact is JobFact => Boolean(fact?.value));
}

function buildTimeline(job: Job, nowMs: number): TimelinePoint[] {
  // B2-01. Mirrors buildJobFacts's date styling exactly, so the facts row and
  // the Timeline never disagree about the same date.
  const posted = reportShortDate(job.postedDate, nowMs);
  const deadline = reportShortDate(job.applicationDeadline, nowMs);
  const start = formatDate(job.startDate, "monthYear");
  if (!posted && !deadline && !start) return [];

  const points: TimelinePoint[] = [];
  if (posted) points.push({ key: "posted", label: "Posted", value: posted });
  // B3-02. The plate's Timeline shows the bare word "Today" with nothing
  // underneath — it is the anchor the other three points are measured
  // against, not a fourth date. Printing a date here (this milestone's own
  // computed "now") made the one accented point read like just another
  // date. No `today` variable is needed any more; the point always renders
  // once there is at least one other point (guarded by the `!posted &&
  // !deadline && !start` return above).
  points.push({ key: "today", label: "Today", accent: true });
  if (deadline) {
    points.push({ key: "deadline", label: "Deadline", value: deadline });
  }
  if (start) points.push({ key: "start", label: "Start", value: start });
  return points;
}

function distinct(values: readonly string[]): string[] {
  const seen = new Set<string>();
  return values.flatMap((value) => {
    const trimmed = clean(value);
    if (!trimmed) return [];
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return [];
    seen.add(key);
    return [trimmed];
  });
}

/** B-10. Known site chrome that scraping picks up and files as a requirement. */
const SITE_CHROME_RE =
  /^(?:apply(?:\s+now)?|apply\s+for\s+this\s+job|sign\s*in|sign\s*up|log\s*in|login|register|submit|search|share|save(?:\s+job)?|view\s+job|view\s+details|more\s+details|back(?:\s+to\s+results)?|next|previous|home|menu|careers?(?:\s+page)?|jobs?(?:\s+page)?|job\s+(?:listing|description|alerts?)|web\s+job\s+listing|about\s+us|contact\s+us|cookies?|privacy(?:\s+policy)?|terms(?:\s+(?:of\s+(?:use|service)|and\s+conditions))?|newsletter|follow\s+us|read\s+more|learn\s+more|see\s+all|show\s+more|full\s+time|part\s+time|remote|hybrid|on\s*-?\s*site)$/i;

/**
 * B-10. A skill is something a person can have. "tesla.com" and "Sign in" are
 * not, and the report was listing them under "Not matched in your profile" —
 * telling the reader they were missing a skill called Sign in.
 *
 * The guard sits here, at the report layer, deliberately. Upstream,
 * `keyRequirements` comes from `item.tags`, which also feeds cards, search and
 * the preference ledger; tightening it there would change ranking. This filter
 * changes only what the skills section is willing to print.
 */
function isPlausibleRequirement(value: string): boolean {
  const text = value.replace(/\s+/g, " ").trim();
  if (!text) return false;
  // A URL or a bare domain is a link, not a skill.
  if (/https?:\/\/|www\.|\S+\.(?:com|org|net|io|co|edu|gov|ai|jobs)\b/i.test(text)) {
    return false;
  }
  return !SITE_CHROME_RE.test(text);
}

function skillComparison(job: Job): {
  matched: string[];
  unmatched: string[];
  pct: number;
} | null {
  const requirements = distinct(job.keyRequirements).filter(
    isPlausibleRequirement,
  );
  // Nothing survived the guard: hide the section rather than print an empty
  // chip row under a heading promising skills.
  if (requirements.length === 0) return null;
  const terms = distinct(job.matchedTerms ?? []).map((term) =>
    term.toLowerCase(),
  );
  const matched = requirements.filter((requirement) => {
    const normalized = requirement.toLowerCase();
    return terms.some(
      (term) => normalized.includes(term) || term.includes(normalized),
    );
  });
  const matchedSet = new Set(matched.map((item) => item.toLowerCase()));
  const unmatched = requirements.filter(
    (requirement) => !matchedSet.has(requirement.toLowerCase()),
  );
  return {
    matched,
    unmatched,
    pct: Math.round((matched.length / requirements.length) * 100),
  };
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
  tone,
}: {
  children: ReactNode;
  tone?: "accent" | "danger" | "info" | "kind";
}) {
  return (
    <span
      data-header-chip={tone ?? "neutral"}
      className={cn(
        "inline-flex min-h-7 items-center rounded-full border px-3 py-1 text-meta font-medium",
        tone === "accent"
          ? "border-accent/25 bg-accent/10 text-accent"
          : tone === "danger"
            ? "border-red/25 bg-red/10 text-red"
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

/** B-05/B-06 moved the tile body into a component both reports share. */
function FactTile({ fact }: { fact: JobFact }) {
  return <ReportFactTile fact={fact} attribute="data-job-fact" />;
}

/**
 * V26-E01 / V26-J10 (round 26 C). The body of this component moved to
 * `components/reports/report-section.tsx` — it was DEFINED TWICE, here and at
 * `app/events/[id]/page.tsx`, so a heading-level prop added to one copy would
 * have done nothing on the other surface. This thin wrapper keeps the job
 * report's own `animate-fade-in-up` entrance and leaves every call site in this
 * file untouched.
 */
function ReportSection(props: {
  title: string;
  /** V26-J07: plate 02 right-aligns a section's counter on the label line. */
  subtitle?: string;
  children: ReactNode;
  className?: string;
  sectionKey?: string;
}) {
  return (
    <SharedReportSection
      {...props}
      className={cn("animate-fade-in-up", props.className)}
    />
  );
}

function JobActionRow({
  applyUrl,
  isSaved,
  isApplied,
  isInterested,
  onToggleSave,
  onAppliedChange,
  onInterested,
  onDismiss,
}: {
  applyUrl?: string;
  isSaved: boolean;
  isApplied: boolean;
  isInterested: boolean;
  onToggleSave: () => void;
  onAppliedChange: (next: boolean) => void;
  onInterested: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      data-report-action-row="job"
      className="mt-7 flex flex-wrap items-center gap-2"
    >
      {applyUrl && (
        <a
          href={applyUrl}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(
            buttonVariants({ tone: "primary" }),
            "h-11 px-4 text-body font-semibold",
          )}
        >
          {/* B-18. Plate 02 says where the link goes. "Apply" alone reads like
              Peer takes the application; it does not — it hands you off. */}
          Apply on employer site
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
        label="Mark as applied"
        controlKey="applied"
        checked={isApplied}
        onChange={onAppliedChange}
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

export function JobReport({
  job,
  isSaved,
  isApplied,
  isInterested = false,
  nowMs,
  enrichment = null,
  pageReadingReason,
  providerConfigured = false,
  // ABC-freemium 1-26 · R-UI-3 — the upsell is plan-aware now, so the view
  // needs the reader's plan as well as whether a model is reachable.
  //
  // ABC-freemium 6-04 · Ruling 16 points 2-3 — **`effectivePlan` lost its
  // `= "free"` default and is now required.** `QuotaNotice` and
  // `TierUpgradeBlock` both take the plan as a required prop precisely so a
  // caller cannot forget it and fail open — and this component sat between
  // them and the page handing that discipline straight back, because a
  // forgotten prop here arrived downstream as a confident `"free"`. A default
  // on a pass-through is the same defect as a default on the leaf, one file
  // further away from where anyone looks for it.
  aiMode = "none",
  effectivePlan,
  // ABC-freemium 2-07 · R-QUOTA-1 — absent whenever the reader was served.
  quota,
  enrichmentLoading = false,
  onToggleSave,
  onAppliedChange,
  onDismiss,
  onInterested = () => undefined,
  onBack,
}: {
  job: Job;
  isSaved: boolean;
  isApplied: boolean;
  isInterested?: boolean;
  nowMs: number;
  enrichment?: JobEnrichment | null;
  pageReadingReason?: OpportunityPageReadingReason;
  /** Legacy test seam: provider availability alone must not hide the locked block. */
  providerConfigured?: boolean;
  aiMode?: AiMode;
  /** 6-04 — required, and `null` means the plan is not known yet. */
  effectivePlan: Plan | null;
  quota?: QuotaSignal;
  enrichmentLoading?: boolean;
  onToggleSave: () => void;
  onAppliedChange: (next: boolean) => void;
  onDismiss: () => void;
  onInterested?: () => void;
  onBack?: () => void;
}) {
  // Three states, three screens. Showing "connect a key" to somebody who has
  // one — because their page fetch failed — was the report contradicting itself
  // on the exact screen where they check whether their key works.
  const matchPct = formatMatchPct(job.relevanceScore);
  const facts = buildJobFacts(job, nowMs);
  /**
   * B2-04 / Ruling 9. Plate 02 states employment type and contract length
   * together in one header chip ("Full-time · 3 years") — the same expanded
   * value the TYPE tile abbreviates into "3-yr contract" below. One field
   * (`job.contractLength`), two formatters; neither invents a duration.
   */
  const contractChipText =
    [
      clean(job.employmentType) ? humanize(job.employmentType!) : undefined,
      clean(job.contractLength)
        ? expandContractLength(clean(job.contractLength)!)
        : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || undefined;
  const timeline = buildTimeline(job, nowMs);
  const skills = skillComparison(job);
  const roleSummary = cleanJobDescription(job.summary) || undefined;
  // Plate 02 shows one role block of bullets, not a paragraph and not the same
  // content three times. Tier 1/2 supplies its own sentences; Tier 0 splits the
  // posting's own text on sentence boundaries so it is never a wall of prose.
  const roleBullets = enrichment?.roleSummary?.length
    ? enrichment.roleSummary
    : splitIntoBullets(roleSummary);
  // Ruling 111b (Phase 2 round 4 C item 2, B1). `roleBullets` is EITHER the
  // posting's own text (Tier 0) OR Class-B's LLM-composed sentences, never
  // both. Only the posting's own prose earns the reading serif below — the
  // LLM's own voice is Peer's, not the posting's, so it stays sans.
  const roleBulletsAreLlmVoice = Boolean(enrichment?.roleSummary?.length);
  const materials = distinct(job.applicationMaterials ?? []);
  const visaEvidence = clean(job.visa?.evidence);
  const roleTitle = cleanJobTitle(job.roleTitle) || job.roleTitle;
  const company = cleanJobSubtitlePart(job.companyOrLab);
  const rawLocation = cleanJobSubtitlePart(job.location);
  // B5-04/R12. Same placeholder guard as the LOCATION tile above — without
  // it, "See posting" printed here too, between the company and work-mode
  // segments.
  const location =
    rawLocation && rawLocation.toLowerCase() !== JOB_LOCATION_PLACEHOLDER
      ? rawLocation
      : undefined;
  /**
   * B-18 / B2-06. Plate 02's subtitle has three segments — employer, place,
   * work mode ("Toyota Research Institute · Los Altos, CA · Hybrid (3 days
   * on-site)"). The mode word now comes from `job.workMode` when the posting
   * states it, falling back to "Remote" from `isRemote` alone. The plate's
   * "(3 days on-site)" parenthetical has no field behind it and stays out —
   * nothing is invented. Remote used to *replace* the location, which threw
   * away where the team actually sits; it no longer does.
   */
  const workMode = workModeLabel(job);
  // B-17. Plate 02's labelled rows, built only from fields that exist.
  // V26-J06 / Ruling 74 (round 27, item 7). The plate's own order —
  // MATERIALS, ELIGIBILITY, TEAM, SEEN ON — with the same rule every row here
  // already follows: an absent field HIDES rather than printing empty. No
  // placeholder, no "not stated", no empty <dd>.
  //
  // **THE `TEAM` ROW RENDERS ITS HEADCOUNT'S HONEST ABSENCE, AND THAT IS
  // RULING 74's ACCEPTED, NAMED COST — NOT A GAP TO CLOSE.** Plate 02 reads
  // `Energy & Materials, 14 researchers`; this row will read
  // `Energy & Materials`. No schema.org property carries a team size,
  // `numberOfEmployees` describes the whole employer (so it would be a WRONG
  // number, not a partial one), a number lifted from prose is A22-01's exact
  // mechanism, and an LLM guess is a fabricated fact about a real employer.
  // Ruling 74 re-examines it at Phase 2. **Do not "fix" this into invention.**
  const eligibility = clean(job.eligibility);
  // No `?? company` anywhere below: an absent unit renders nothing rather than
  // restating the employer that is already in the header (Ruling 26's shape).
  const team = clean(job.team);
  const applyRows: Array<{ label: string; value: string }> = [
    materials.length > 0
      ? { label: "Materials", value: materials.join(", ") }
      : undefined,
    eligibility ? { label: "Eligibility", value: eligibility } : undefined,
    team ? { label: "Team", value: team } : undefined,
    jobSourceLabel(job.sourceId)
      ? { label: "Seen on", value: jobSourceLabel(job.sourceId)! }
      : undefined,
  ].filter(Boolean) as Array<{ label: string; value: string }>;
  const hasEnrichment = hasJobEnrichment(enrichment);

  return (
    <PageContainer
      width="detail"
      className="px-6 py-14 print:relative print:z-[60] print:bg-bg"
    >
      <BackToFeedLink
        onBack={onBack}
        className="inline-flex items-center gap-1 text-body-sm text-text-faint transition-colors hover:text-link"
      >
        <span aria-hidden>←</span>
        Back
      </BackToFeedLink>

      <header className="mt-8 animate-fade-in-up">
        {(job.roleKind ||
          contractChipText ||
          job.visa ||
          matchPct !== null) && (
          <div className="mb-5 flex flex-wrap gap-2" aria-label="Job summary">
            {job.roleKind && <HeaderChip tone="kind">{ROLE_LABELS[job.roleKind]}</HeaderChip>}
            {contractChipText && <HeaderChip>{contractChipText}</HeaderChip>}
            {job.visa && (
              <HeaderChip tone={visaChipTone(job.visa.state)}>
                {VISA_LABELS[job.visa.state]}
              </HeaderChip>
            )}
            {matchPct !== null && (
              <HeaderChip tone="accent">{matchPct}% match</HeaderChip>
            )}
          </div>
        )}

        {/* V26-J02 (round 26 A/B; landed round 26 C). PLATE 02 sets the report
            title in `Georgia 21.0` `#2b180a` — B re-extracted the PDF's own
            spans and confirmed A's measurement exactly. The build has shipped,
            loaded and DOCUMENTED the family since `globals.css:279` ("Sans is
            the UI default; long-form prose opts INTO serif with the
            `font-reading` utility") and the paper report already obeys it at
            four call sites; the two opportunity reports were the only report
            surfaces in the app that never opted in. `font-display` for titles,
            `font-reading` for prose — the app's own existing convention, no new
            token. */}
        <h1 className="font-display text-[30px] font-semibold leading-[1.15] tracking-[-0.015em] text-heading lg:text-[36px]">
          {roleTitle}
        </h1>
        {(company || location || workMode) && (
          <p className="mt-3 text-body text-text-muted">
            {[company, location, workMode].filter(Boolean).map((part, index) => (
              <span key={part}>
                {index > 0 && <span aria-hidden> · </span>}
                {part}
              </span>
            ))}
          </p>
        )}

        <JobActionRow
          applyUrl={clean(job.linkPosting)}
          isSaved={isSaved}
          isApplied={isApplied}
          isInterested={isInterested}
          onToggleSave={onToggleSave}
          onAppliedChange={onAppliedChange}
          onInterested={onInterested}
          onDismiss={onDismiss}
        />
      </header>

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
        <dl className="mt-10 grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border sm:grid-cols-4">
          {facts.map((fact) => (
            <FactTile key={fact.key} fact={fact} />
          ))}
        </dl>
      )}

      {/* V26-J02, element 5. Plate 02 sets the visa evidence quote below in
          `Georgia 10.5` `#9c8b78` — the smallest of the plate's five serif
          elements, and serif because it is the POSTING's prose, not chrome. */}
      {visaEvidence && !enrichment?.sponsorshipRead && (
        <blockquote className="mt-4 border-l-2 border-accent/50 pl-4 font-reading text-body leading-7 text-text-muted">
          “{visaEvidence}”{" "}
          {/* B-19. Plate 02 closes the quote with its source. Without it the
              sentence reads as Peer's own words, which is the one thing this
              block exists to avoid: it is the posting's promise, not ours.

              V27-02 (round 27, item 6). THE ATTRIBUTION RUNS INLINE, AND THE
              PLATE'S OWN WRAP IS THE PROOF. Plate 02 sets the closing quote
              mark, the em dash and `from the job` in the SAME span as the
              quotation, and `description` begins the next line at the
              quotation's own left margin — a detached caption cannot wrap
              mid-phrase out of its parent's text run. Every span is
              `Georgia 10.5 #9c8b78`: same family, same size, same colour as the
              quote.

              THE FIX IS SUBTRACTION. `mt-1`, `block`, `text-caption` and
              `text-text-faint` are gone; the `<cite>` now inherits
              `font-reading`, the size and the colour from the blockquote it
              already lives in, which is what "same run" means in CSS.

              FOUR THINGS THAT MUST NOT CHANGE:
                * `not-italic` STAYS — browsers italicise `<cite>` by default and
                  the plate's attribution is `Georgia`, NOT `Georgia-Italic`.
                  Plate 02's only italic is the matched topics in the why-block.
                * the `<cite>` ELEMENT stays — it carries B-19's semantic.
                * `data-visa-attribution` stays — the only stable test hook here.
                * the space before it is EXPLICIT (`{" "}`) because JSX collapses
                  whitespace at a line break; without it the render reads
                  `transfers.”— from the job description`.

              The empty state is already correct: this whole block is gated on
              `visaEvidence`, so the attribution cannot appear without the
              sentence it attributes. DO NOT ADD A SECOND GATE. */}
          <cite data-visa-attribution className="not-italic">
            — from the job description
          </cite>
        </blockquote>
      )}

      {timeline.length > 0 && (
        <ReportSection
          title="Timeline"
          sectionKey="timeline"
          className="break-inside-avoid"
        >
          {/* V26-J03 (round 26 C). Was four bordered boxes written inline here,
              byte-identical to the event report's `DeadlineTimeline`. Now the one
              shared track, so plate 02's continuous rule with its filled
              `Posted -> Today` segment and plate 03's render from one component.
              The job surface also GAINS the `data-deadline-milestone` hook the
              event surface already had, so both are testable the same way — an
              addition, not a rename. */}
          <ReportTimelineTrack milestones={timeline} />
        </ReportSection>
      )}

      {/* B-10. Plate 02: one heading with NEW and TIER 0 badges, the line
          "6 of 9 you already have", ONE flat wrapping row of chips, then the
          footnote. The build had a different heading and a two-column split
          into "Matched" and "Not matched" lists — which turned a glance into
          a comparison exercise. Both are correctly gone.

          **V26-J07 / RULING 72b (round 26). THE REST OF B-10's COMMENT WAS
          FACTUALLY WRONG AND IS CORRECTED HERE.** It read "a progress bar the
          plate does not have" and "the progress bar is gone under
          say-it-once". THE PLATE HAS THE BAR. Neither a page image nor a
          text-span dump can settle it, because a bar is a vector DRAWING;
          round 26 B pulled the rectangles for this region of plate 02 (p3):

            y 283.5  x 79.5  w 453.0  h 4.5  #e9dfcc   <- the track
            y 283.5  x 79.5  w 303.8  h 4.5  #ff520d   <- the filled segment

          303.8 / 453.0 = 0.6706, against the plate's OWN counter one line
          above reading `6 of 9 you already have` = 0.6667. They agree to
          within half a percent, and the construction is identical to the
          timeline track measured on the same plate.

          Per the §1b precedent — treat the plate as correct and the record as
          wrong — Ruling 72b REVERSED the removal. The bar is restored below
          on B's extracted geometry, with zero new data: both counts are
          already in scope. The comment is corrected rather than deleted so
          the reversal is legible to the next reader. */}
      {skills && (
        <ReportSection
          title="Skills they ask for"
          sectionKey="skills"
          // V26-J07, second half. Plate 02 right-aligns this counter ON THE
          // LABEL LINE; the build printed it on its own line beneath. Passing
          // it as the section subtitle uses the one shared heading-row
          // treatment, so the job report and the event roster now agree.
          subtitle={`${skills.matched.length} of ${
            skills.matched.length + skills.unmatched.length
          } you already have`}
        >
          <p className="-mt-2 mb-4 flex flex-wrap items-center gap-2">
            <ReportBadge>New</ReportBadge>
            <ReportBadge tone="accent">{NO_MODEL_BADGE}</ReportBadge>
          </p>
          {/* V26-J07 / Ruling 72b. The bar, on B's extracted geometry: one
              track and one fill, the fill at the matched fraction — the
              plate's 303.8/453.0 = 0.671 against its own stated 6 of 9 =
              0.667. Zero new data and zero new tokens. `aria-hidden` because
              the counter above states the same ratio in words, so a screen
              reader would otherwise hear it twice. */}
          <div
            aria-hidden
            data-skills-progress
            className="mb-4 h-1 w-full overflow-hidden rounded-full bg-border"
          >
            <div
              data-skills-progress-fill
              className="h-1 rounded-full bg-accent"
              style={{
                width: `${
                  skills.matched.length + skills.unmatched.length > 0
                    ? (skills.matched.length /
                        (skills.matched.length + skills.unmatched.length)) *
                      100
                    : 0
                }%`,
              }}
            />
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {skills.matched.map((skill) => (
              <span
                key={skill}
                data-skill-requirement="matched"
                className="inline-flex items-center gap-1.5 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-body-sm font-medium text-accent"
              >
                {skill}
                <span aria-hidden>✓</span>
              </span>
            ))}
            {skills.unmatched.map((skill) => (
              <span
                key={skill}
                data-skill-requirement="unmatched"
                className="inline-flex items-center rounded-full border border-border bg-surface px-3 py-1 text-body-sm text-text-muted"
              >
                {skill}
              </span>
            ))}
          </div>
          <p
            data-skills-explainer
            className="mt-4 border-l-2 border-accent/50 pl-4 text-caption leading-5 text-text-faint"
          >
            Highlighted chips come from your Required and Explore topics plus
            your project text. The plain ones are the gaps — worth seeing before
            you spend an evening on the application.
          </p>
        </ReportSection>
      )}

      {(roleBullets.length > 0 || materials.length > 0) && (
        <div className="mt-10 grid gap-8 md:grid-cols-2" data-role-and-materials>
          {roleBullets.length > 0 && (
            <section data-section="what-the-role-is">
              {/* V26-J10 (round 26 C). The plate has ONE label step; the build
                  had two. These two headings used the smaller one
                  (`text-micro` 10.5 px / 0.16em) while every other section
                  label used `text-caption` 11.5 px / 0.18em. Unified onto the
                  shared constant — the token itself is app-wide and its MEANING
                  is not changed, only which token this call site uses. */}
              <h2 className={REPORT_LABEL_CLASS}>
                What the role is
              </h2>
              <ul className="mt-4 space-y-3">
                {roleBullets.map((point) => (
                  <li
                    key={point}
                    data-role-bullet
                    /* V26-J02, element 4. Plate 02 sets the role bullets in
                       `Georgia 12.0` `#4d3a28`, 7 spans over 3 bullets — for
                       the POSTING's own prose (Tier 0). Ruling 111b (Phase 2
                       round 4 C item 2, B1): when this slot instead holds
                       Class-B's LLM-composed `roleSummary` sentences, that is
                       Peer's own voice, not the posting's, so it stays sans. */
                    className={`relative pl-5 ${roleBulletsAreLlmVoice ? "" : "font-reading "}text-body-lg leading-8 text-text`}
                  >
                    <span
                      aria-hidden
                      className="absolute left-0 top-[0.7em] h-1.5 w-1.5 rounded-full bg-accent/60"
                    />
                    {point}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {/* B4-07 (R5). The heading promises what to prepare; applyRows.length
              alone let a job with a sourceId but no applicationMaterials
              render the whole section for "Seen on" alone -- a true fact,
              but not something you prepare. Gated on materials specifically;
              applyRows's own construction is unchanged. */}
          {materials.length > 0 && (
            <section data-section="to-apply-have-ready">
              {/* V26-J10 (round 26 C). The plate has ONE label step; the build
                  had two. These two headings used the smaller one
                  (`text-micro` 10.5 px / 0.16em) while every other section
                  label used `text-caption` 11.5 px / 0.18em. Unified onto the
                  shared constant — the token itself is app-wide and its MEANING
                  is not changed, only which token this call site uses. */}
              <h2 className={REPORT_LABEL_CLASS}>
                To apply, have ready
              </h2>
              {/*
                B-17. Plate 02 has labelled rows — MATERIALS / ELIGIBILITY /
                TEAM / SEEN ON — not a bare list.

                V26-J06 / Ruling 74 (round 27, item 7): all four now have a
                field behind them. `ELIGIBILITY` and `TEAM` come from
                `extractJobDetails` (schema.org `educationRequirements` /
                `qualifications` and `employmentUnit` first, a closed
                labelled-line vocabulary second) and each hides when absent,
                which is this block's own standing rule. The `TEAM` row carries
                the unit NAME only — see `applyRows` above for why the plate's
                headcount is Ruling 74's accepted, named cost.
              */}
              <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-3">
                {applyRows.map((row) => (
                  <div key={row.label} className="contents">
                    <dt
                      data-apply-row={row.label.toLowerCase()}
                      /* V26-J10 — the plate uses the same label step here. */
                      className={`pt-0.5 ${REPORT_LABEL_CLASS}`}
                    >
                      {row.label}
                    </dt>
                    <dd className="text-body-sm text-heading">{row.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
        </div>
      )}

      {Boolean(enrichment?.specificRequirements?.length) && (
        <ReportSection
          title="What this employer actually asks for"
          sectionKey="specific-requirements"
        >
          <ul className="space-y-2">
            {enrichment?.specificRequirements?.map((requirement) => (
              <li
                key={requirement}
                /* Ruling 111b (Phase 2 round 4 C item 2, A1). Verbatim quote
                   from the posting, mechanically enforced by
                   `quotableStringList` — the posting's own prose, so it
                   takes the reading serif like the other verbatim-quote
                   sites (`visaEvidence` at :1456). */
                className="rounded-lg border border-border bg-surface px-4 py-3 font-reading text-body text-heading"
              >
                {requirement}
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      {Boolean(enrichment?.specificDuties?.length) && (
        <ReportSection
          title="What the person would actually do"
          sectionKey="specific-duties"
        >
          <ul className="space-y-2">
            {enrichment?.specificDuties?.map((duty) => (
              <li
                key={duty}
                /* Ruling 111b (Phase 2 round 4 C item 2, A2). Same mechanism
                   as A1 above: verbatim quote, mechanically enforced by
                   `quotableStringList`, so it takes the reading serif. */
                className="rounded-lg border border-border bg-surface px-4 py-3 font-reading text-body text-heading"
              >
                {duty}
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      {enrichmentLoading && (
        <p
          data-enrichment-loading="job"
          role="status"
          aria-live="polite"
          className="mt-8 flex items-center gap-2 text-body-sm text-text-faint"
        >
          <span
            aria-hidden
            className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
          />
          Peer is reading the job posting…
        </p>
      )}
      {!enrichmentLoading &&
        !enrichment?.specificRequirements?.length &&
        !enrichment?.specificDuties?.length &&
        providerConfigured &&
        pageReadingReason && (
          <p
            data-page-reading-note="job"
            className="mt-8 text-body-sm text-text-faint"
          >
            {JOB_PAGE_READING_NOTES[pageReadingReason]}
          </p>
        )}

      {enrichment?.sponsorshipRead && (
        <ReportSection title="Sponsorship read">
          <div className="grid gap-3 md:grid-cols-2">
            {visaEvidence && (
              <blockquote className="rounded-xl border border-accent/20 bg-accent/5 px-5 py-4 font-reading text-body leading-7 text-text-muted">
                {/* Round 28 items 2+3 (V28-01/V28-02): shared step, colour
                    stays `text-accent` — this quote is deliberately tinted. */}
                <span className={`mb-2 block ${REPORT_LABEL_STEP} text-accent`}>
                  Posting evidence
                </span>
                “{visaEvidence}”
              </blockquote>
            )}
            <div className="rounded-xl border border-border bg-bg-secondary/50 px-5 py-4">
              {/* Round 28 item 2 (V28-01): shared step. */}
              <p className={REPORT_LABEL_CLASS}>
                Peer inference — verify with the employer
              </p>
              <p className="mt-2 text-title font-semibold text-heading">
                {enrichment.sponsorshipRead.likelihood}
              </p>
              <p className="mt-2 text-body leading-7 text-text-muted">
                {enrichment.sponsorshipRead.basis}
              </p>
            </div>
          </div>
        </ReportSection>
      )}

      {enrichment?.emphasise && (
        <ReportSection title="What to emphasise in your application">
          <ul className="grid gap-2 sm:grid-cols-2">
            {enrichment.emphasise.map((point) => (
              <li
                key={point}
                className="rounded-lg border border-accent/20 bg-accent/5 px-4 py-3 text-body-sm text-heading"
              >
                {point}
              </li>
            ))}
          </ul>
        </ReportSection>
      )}

      {/* B-03 / §1b Correction 2. Plate 02's last block before the locked
          block. P10.4 deleted it on the grounds that it was a one-line
          restatement; the plate shows a substantive Tier 0 paragraph. */}
      <WhyPeerSentThis
        reason={job.matchReason}
        facetReason={job.facetPreferenceReason}
        sectionKey="why-peer-sent-this"
        surface="job"
        matchedTerms={job.matchedTerms}
      />

      {/* ABC-freemium 2-07 · R-QUOTA-1 — the message the server has always
          computed and nothing ever rendered. It sits beside the existing
          degraded report rather than replacing it: the reader still has their
          complete deterministic report. Renders null when there is no signal. */}
      {/* ABC-freemium 3-01 · R-UI-3 — same plan the block below takes; a paid
          reader at the daily breaker is never upsold. */}
      <QuotaNotice quota={quota} effectivePlan={effectivePlan} />

      {/* ABC-freemium 1-26 — see the matching note in the events report:
          nothing locked means nothing to advertise. */}
      <TierUpgradeBlock
        items={hasEnrichment ? [] : JOB_TIER_UPGRADE_ITEMS}
        aiMode={aiMode}
        effectivePlan={effectivePlan}
      />
    </PageContainer>
  );
}

export default function JobDetailPage({
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
  const feedJobs = useFeedStore((state) => state.jobs);
  const jobPool = useFeedStore((state) => state.jobPool);
  const savedJobs = useFeedStore((state) => state.savedJobs);
  const isApplied = useFeedStore((state) => Boolean(state.appliedAt[id]));
  const markRead = useFeedStore((state) => state.markRead);
  const saveJob = useFeedStore((state) => state.saveJob);
  const unsaveJob = useFeedStore((state) => state.unsaveJob);
  const setJobApplied = useFeedStore((state) => state.setJobApplied);
  const notInterestedJob = useFeedStore((state) => state.notInterestedJob);
  const moreLikeJob = useFeedStore((state) => state.moreLikeJob);
  const feedback = useFeedStore((state) => state.jobFeedback[id]);
  const profile = useProfileStore((state) => state.profile);
  // ABC-freemium 1-14 — what the server says this reader may use.
  // ABC-freemium 6-04 — `null` until the profile fetch answers. `grants` is the
  // capability view (anonymous while unknown, so AI and enrichment stay off);
  // the raw `entitlement` is what the upsell props read, because they must be
  // able to tell "free" from "we have not asked yet".
  const entitlement = useProfileStore((state) => state.entitlement);
  const grants = entitlementGrants(entitlement);
  const [nowMs] = useState(Date.now);
  const [enrichmentResult, setEnrichmentResult] = useState<{
    key: string;
    result: OpportunityEnrichmentLoadResult<JobEnrichment> | null;
    done: boolean;
  }>({ key: "", result: null, done: false });
  // ABC-freemium 2-07 · R-QUOTA-1 — held OUTSIDE the enrichment result on
  // purpose. `loadConfiguredOpportunityEnrichment` caches its return value in
  // browser storage, and a cached quota signal is a stale one: it would keep
  // telling a reader they had spent their allowance after they upgraded, which
  // is the cache-poisoning shape R-UI-4 exists to prevent. This is set only
  // when the fetch actually runs, so a cache hit correctly shows nothing.
  const [quota, setQuota] = useState<QuotaSignal | undefined>(undefined);

  const job =
    feedJobs.find((candidate) => candidate.id === id) ??
    jobPool.find((candidate) => candidate.id === id) ??
    savedJobs.find((candidate) => candidate.id === id);
  const isSaved = savedJobs.some((candidate) => candidate.id === id);
  const contextHint = buildEnrichmentContext(profile);
  const enrichmentKey = job
    ? opportunityEnrichmentCacheKey(
        "job",
        job.id,
        contextHint,
        profile.feedAiProvider,
      )
    : "";

  useEffect(() => {
    if (job) markRead(job.id);
  }, [job, markRead]);

  useEffect(() => {
    if (!job || !enrichmentKey) return;

    let cancelled = false;
    void loadConfiguredOpportunityEnrichment<
      OpportunityEnrichmentLoadResult<JobEnrichment>
    >(
      {
        feedAiProvider: profile.feedAiProvider,
        feedAiApiKey: profile.feedAiApiKey,
      },
      enrichmentKey,
      async (llmOverride) => {
        const response = await fetch("/api/jobs/report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ job, contextHint, llmOverride }),
        });
        if (!response.ok) {
          throw new Error(`Job report failed: ${response.status}`);
        }
        const result = (await response.json()) as {
          enrichment: JobEnrichment | null;
          sourceReadStatus?:
            | "read"
            | "failed"
            | "not-requested";
          // ABC-freemium 2-07 — the field the server has always sent and this
          // fetcher always dropped.
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
    job,
    contextHint,
    enrichmentKey,
    profile,
  ]);

  if (!job) {
    return (
      <PageContainer width="narrow" className="px-6 py-20">
        <p className="italic text-text-muted">Job not found.</p>
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
    <JobReport
      job={job}
      isSaved={isSaved}
      isApplied={isApplied}
      isInterested={
        (feedback ?? job.feedback) === "moreLikeThis" ||
        (feedback ?? job.feedback) === "liked"
      }
      nowMs={nowMs}
      enrichment={currentEnrichmentResult?.enrichment ?? null}
      pageReadingReason={pageReadingReason}
      enrichmentLoading={!currentEnrichmentDone && canAttemptOpportunityEnrichment(profile, grants)}
      providerConfigured={canAttemptOpportunityEnrichment(profile, grants)}
      aiMode={aiAvailability(profile, grants)}
      effectivePlan={entitlement?.effectivePlan ?? null}
      quota={quota}
      onToggleSave={() => (isSaved ? unsaveJob(job.id) : saveJob(job))}
      onAppliedChange={(next) => setJobApplied(job, next)}
      onInterested={() => moreLikeJob(job)}
      onDismiss={() => {
        notInterestedJob(job);
        window.history.back();
      }}
      onBack={() => router.back()}
    />
  );
}
