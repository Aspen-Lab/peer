import type { EventType } from "@/types";
import type { EventSourceAdapter, EventsQuery, RawEventItem } from "../types";
import {
  isOperatorFundedSearch,
  operatorSearchAvailability,
  resolveSystemSearchKeys,
} from "@/lib/search/system-key";
import { recordUsageEvent } from "@/lib/usage/events";
import { consumeForcedRebuild } from "@/lib/usage/rebuild-breaker";
import {
  DATE_TOKEN_PATTERN,
  DAY_PATTERN,
  looksLikeHostBrand,
  MONTH_PATTERN,
  urlHashId,
} from "@/lib/opportunities/shared";
import {
  COUNTRY_NAMES,
  US_STATE_CODES,
} from "@/lib/opportunities/structured-extract";
import {
  EVENT_QUERY_BUDGET,
  RESULTS_PER_SEARCH,
} from "@/lib/opportunities/query-budget";
import {
  geminiSearchDeadline,
  resolveWebSearchProvider,
  searchGemini,
} from "@/lib/sources/gemini-search";
import { searchVertex } from "@/lib/sources/vertex-search";
import { classifyEventType } from "../mapper";
import { dateClaimEndMs } from "@/lib/format";

// Web discovery for academic events. The curated feeds (ccfddl, confs.tech)
// are CS-heavy; this adapter is what finds a materials-science symposium or a
// neuroscience summer school: profile-driven queries (LLM-refined when a
// provider is available — see lib/opportunities/query-gen) through Tavily
// (BYOK or TAVILY_API_KEY) or Brave (BRAVE_SEARCH_API_KEY).

interface WebResult {
  title?: string;
  url?: string;
  snippet?: string;
  /**
   * ROUND 29 C, ITEM 1 — channel L. The page's own `schema.org` `@type`, read
   * by the adapter off the HTML it already fetched (`sources/gemini-search.ts`,
   * `pageDeclaresEventFromHtml`). **Optional and absent on every non-gemini
   * provider**, so Tavily and Brave rows behave exactly as they did.
   */
  pageKind?: "event";
}

const MONTH =
  "(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";
// First "Month D" token — the year is resolved separately so cross-month
// ranges ("November 29 - December 4, 2026") anchor on the range start.
const MONTH_DAY_RE = new RegExp(`${MONTH}\\.?\\s+(\\d{1,2})\\b(?!\\d)`, "i");
const DATE_DMY_RE = new RegExp(`(\\d{1,2})(?:\\s*[-–]\\s*\\d{1,2})?\\s+${MONTH}\\.?,?\\s+(\\d{4})`, "i");
const YEAR_RE = /\b(20\d{2})\b/;
const DEADLINE_RE = new RegExp(
  `(?:deadline|submissions? (?:due|close)|abstracts? due)[^.]{0,40}?(${MONTH}\\.?\\s+\\d{1,2},?\\s+\\d{4}|\\d{1,2}\\s+${MONTH}\\.?,?\\s+\\d{4}|\\d{4}-\\d{2}-\\d{2})`,
  "i",
);

function parseDateToken(token: string): string | undefined {
  const ms = Date.parse(`${token.replace(/[-–].*?(?=,|\s\d{4})/, "")} 12:00:00 UTC`);
  if (Number.isFinite(ms)) return new Date(ms).toISOString();
  const iso = Date.parse(token);
  return Number.isFinite(iso) ? new Date(iso).toISOString() : undefined;
}

/** Best-effort event start date from title+snippet text. */
export function extractEventDate(text: string): string | undefined {
  const md = text.match(MONTH_DAY_RE);
  if (md) {
    // Year: prefer the first year appearing after the month-day token,
    // falling back to the first year anywhere in the text.
    const after = text.slice((md.index ?? 0) + md[0].length);
    const year = after.match(YEAR_RE)?.[1] ?? text.match(YEAR_RE)?.[1];
    if (year) return parseDateToken(`${md[1]} ${md[2]}, ${year}`);
  }
  const dmy = text.match(DATE_DMY_RE);
  if (dmy) return parseDateToken(`${dmy[2]} ${dmy[1]}, ${dmy[3]}`);
  return undefined;
}

// A22-01 (round 22 C, Ruling 59a draft 3): THE CANDIDATE COUNTER.
//
// `extractEventDate` above takes the FIRST month-day token in the whole string
// and stops. On `ans.org` — a conference CALENDAR page — the first token was a
// DIFFERENT event's, advertised in a `Conference Spotlight` block 339
// characters before the selected item's own heading, so Peer rendered another
// event's date and the finished event survived the expiry check on it.
//
// The defect is never "unowned text was read". It is "unowned text was read,
// there was more than one thing it could have meant, and the tie was broken by
// POSITION". So ownership is demanded exactly there and nowhere else — which is
// what separates this from the draft that gated every snippet field on a title
// witness and destroyed 18 correct dates.
//
// BUILT FROM THE SHIPPED CONSTANTS, NOT COPIES. B's own counter was written
// from copies and disagreed with the shipped extractor on two rows. The global
// variants below are compiled from `.source` of the very regexes
// `extractEventDate` uses, so the two cannot drift apart; the invariant
// (`extractEventDate` returning a value implies at least one candidate) is
// asserted in `eventweb.test.ts` AND made harmless at runtime by the
// `candidates.length === 0` fall-through at the call site.
const MONTH_DAY_RE_G = new RegExp(MONTH_DAY_RE.source, "gi");
const DATE_DMY_RE_G = new RegExp(DATE_DMY_RE.source, "gi");

/** Every event day the text could be read as offering. */
export function extractEventDayCandidates(text: string): string[] {
  const days: string[] = [];
  for (const match of text.matchAll(MONTH_DAY_RE_G)) {
    const after = text.slice((match.index ?? 0) + match[0].length);
    const year = after.match(YEAR_RE)?.[1] ?? text.match(YEAR_RE)?.[1];
    if (!year) continue;
    const day = parseDateToken(`${match[1]} ${match[2]}, ${year}`);
    if (day) days.push(day);
  }
  for (const match of text.matchAll(DATE_DMY_RE_G)) {
    const day = parseDateToken(`${match[2]} ${match[1]}, ${match[3]}`);
    if (day) days.push(day);
  }
  return days;
}

// A conference's own run ("October 12-15", "November 29 - December 4") is ONE
// reading of the text; a sibling event four months away is a second. 21 days is
// wide enough to hold any single event's own range and far short of the gap to
// another event on the same hub page. Chaining from the previous day rather
// than the cluster's first means a genuine multi-week programme stays one
// cluster — which fails toward today's behaviour, the safe direction.
const CLUSTER_WINDOW_MS = 21 * 24 * 60 * 60 * 1000;

/** Groups candidate days into distinct readings of the text. */
export function clusterEventDays(days: string[]): string[][] {
  const sorted = [...new Set(days)]
    .map((day) => Date.parse(day))
    .filter((ms) => Number.isFinite(ms))
    .sort((a, b) => a - b);
  const clusters: number[][] = [];
  for (const day of sorted) {
    const current = clusters[clusters.length - 1];
    if (current && day - current[current.length - 1] <= CLUSTER_WINDOW_MS) current.push(day);
    else clusters.push([day]);
  }
  return clusters.map((cluster) => cluster.map((ms) => new Date(ms).toISOString()));
}

function normalizeWitness(value: string): string {
  return value.replace(/[^a-z0-9]+/gi, " ").trim().toLocaleLowerCase();
}

/**
 * The span of a snippet that the item's own title introduces, running to the
 * next heading. Ownership witness for an ambiguous snippet: only a date inside
 * this span belongs to the selected item.
 *
 * Searched over the SNIPPET ALONE, never `title + snippet` — the title is
 * prepended to that string by the caller, so a search over the whole thing
 * would match its own copy at offset 0 and prove nothing.
 */
export function ownedTitleSpan(snippet: string, title: string): string | undefined {
  const wanted = normalizeWitness(title);
  if (wanted.length < 8) return undefined;
  const lines = snippet.split(/\r?\n|(?=#{1,6}\s)/g);
  const start = lines.findIndex((line) => normalizeWitness(line).includes(wanted));
  if (start < 0) return undefined;
  const span: string[] = [lines[start]];
  for (const line of lines.slice(start + 1)) {
    if (/^\s*#{1,6}\s/.test(line)) break;
    span.push(line);
  }
  return span.join("\n");
}

/** Best-effort CFP deadline from snippet text. */
export function extractDeadline(text: string): string | undefined {
  const match = text.match(DEADLINE_RE);
  if (!match) return undefined;
  return parseDateToken(match[1]);
}

export function guessEventType(text: string): EventType {
  return classifyEventType(text, "");
}

// Signals that a web result is actually an event page (a conference, CFP,
// meeting, symposium…) rather than an arbitrary article. Used to keep
// date-less results that still clearly describe an event, since conference
// pages routinely omit a parseable date from their search snippet.
const EVENT_SIGNAL_RE =
  /\b(conference|symposium|workshop|seminar|colloquium|congress|meeting|summit|expo|exhibition|forum|round ?table|convention|career (?:fair|expo)|job fair|hiring fair|recruiting (?:fair|event)|hackathon|hack day|call for papers|cfp|abstract submission|registration|keynote|proceedings|society meeting|gordon research)\b/i;

export function looksLikeEvent(text: string): boolean {
  return EVENT_SIGNAL_RE.test(text);
}

export const DENY_HOSTS = [
  "instagram.com",
  "facebook.com",
  "twitter.com",
  "x.com",
  "tiktok.com",
  "youtube.com",
  "reddit.com",
  "pinterest.com",
  "iopscience.iop.org",
  "sciencedirect.com",
  "link.springer.com",
  "onlinelibrary.wiley.com",
  "nature.com",
  "pubs.acs.org",
  "pubs.rsc.org",
  "arxiv.org",
  "researchgate.net",
  "semanticscholar.org",
  "doi.org",
  "waset.org",
  "conferenceseries.com",
  "omicsonline.org",
  "alliedacademies.org",
  "iaras.org",
  "scitechseries.com",
  // Encyclopedias. An article ABOUT a topic is never an event you attend.
  // Witnessed live 2026-08-19 on the Tier-2 (LLM-generated query) event pool:
  // `en.wikipedia.org/wiki/Topochemical_polymerization` rendered as an event
  // card. The JOB surface already refuses this exact host class
  // (`isNonJobHost`, `jobweb.ts`, Ruling 87a Component A); this is that same
  // ruling mirrored to the event surface, the same way A32-01 mirrored the
  // job-content guard in the other direction. `isDeniedUrl` suffix-matches, so
  // every language subdomain (`en.`, `de.`, …) is covered by the one entry.
  "wikipedia.org",
] as const;

export const DENY_PATH_RE = /\/(?:article|doi|abs|reel|posts|p)(?:\/|$)/i;

/**
 * Storefront paths. A battery retailer's catalogue mentions "batteries" and
 * "charger" constantly and can clear the relevance gate, but it is a shop, not
 * an event — "Batteries, Charger & More" reached a live top 10 this way.
 *
 * Phase 3 round 6 C, ITEM 4 (F10, Ruling 123f/123g item 4). `product-category`
 * added: `dynalene.com/product-category/heat-transfer-fluids/dynalene-
 * molten-salts/` (rendered "Dynalene Molten Salts") admitted as an event, 1
 * of 5 pulls — the event surface's own sibling of J2's identical gap on the
 * job surface one round ago, same regex family, same anchoring cause: the
 * `product` alternative is anchored `(?:\/|$)` immediately after the word,
 * so it matches `/product/` but not the compound hyphenated segment
 * `/product-category/`. ONE measured token, the identical vacuity
 * discipline J2/F8/F9 already ship on (n=1 witness; siblings like
 * `collections-category` are unwitnessed and NOT added blind).
 *
 * FAILURE DIRECTION: this is a DROP guard, held to the higher bar Ruling 55c
 * sets for a guard that drops rather than admits — checked against the full
 * 13-URL must-keep corpus (F11's own corpus, `eventweb.test.ts`) plus
 * `permies.com`'s `/t/.../` path as an adversarial cross-check: zero real
 * event URL plausibly carries a `/product-category/` segment, retail/
 * e-commerce vocabulary disjoint from event-hosting URL conventions by the
 * same closed-by-construction argument this regex already relies on.
 */
export const COMMERCE_PATH_RE =
  /\/(?:shop|store|product|products|product-category|collections?|cart|checkout|catalog(?:ue)?|pricing|buy)(?:\/|$)/i;

/**
 * Editorial coverage *about* events rather than an event page. "The Year Ahead:
 * Key Events at the IAEA in 2026" is a news article; there is nothing to
 * register for. These read as events to a keyword check because they are full
 * of event vocabulary.
 */
export const NEWS_TITLE_RE =
  /^\s*(?:the\s+year\s+ahead|year\s+in\s+review|(?:top|best)\s+\d+\b|what\s+to\s+(?:expect|watch)|a\s+look\s+(?:back|ahead)|recap|highlights\s+from|report\s+from|announcing\b)|\b(?:news|press\s+release|blog\s+post|newsletter)\b/i;

/**
 * Paper and abstract pages. Conference proceedings sites host one page per
 * *paper*, and those pages carry the parent conference's event vocabulary, so
 * they clear both the event-signal check and the relevance gate. A user
 * looking for somewhere to go cannot attend an abstract.
 */
export const PAPER_PAGE_HOSTS = [
  "programmaster.org",
  "hal.science",
  "hal.archives-ouvertes.fr",
  "ui.adsabs.harvard.edu",
  "ouci.dntb.gov.ua",
  "colab.ws",
  "scilit.com",
] as const;

export const PAPER_TITLE_RE =
  /^\s*(?:about\s+this\s+abstract|abstract\s*[:#-]|archive\s+ouverte)\b|\b(?:archive\s+ouverte|hal\s+open\s+science)\b/i;

/**
 * Phase 3 round 6 C, ITEM 1 (F11, Rulings 123b/123e(1)). Wire-distribution and
 * trade-media hosts whose entire business is publishing OTHER organisations'
 * news — `prnewswire.com` (a live specimen of Ruling 118's own witness #4
 * press-release class) and `news.metal.com` (an industry trade outlet
 * reporting ON a real battery summit, not hosting it). Phase 3 round 5 B,
 * Deliverable 2 re-fetched F11's witnesses live and measured that title
 * vocabulary reaches ZERO of them — `isNewsArticleTitle`'s closed vocabulary
 * cannot close this family, because the tell is the HOST, not the title.
 *
 * OWN SIBLING LIST, NOT APPENDED TO `DENY_HOSTS` (Ruling 123e(1)) —
 * `PAPER_PAGE_HOSTS` above is the shipped precedent for keeping a
 * semantically distinct denial reason legible rather than folding it into
 * the general list a reader would have to infer the reason for.
 *
 * SAFE BY CONSTRUCTION, UNLIKE AN ORGANISATION'S OWN DOMAIN. F11's other
 * witnesses this round (`ornl.gov`, `fz-juelich.de`, `pi-kem.co.uk`,
 * `djk.co.jp`) are all DISPOSITIONED, not fixed, exactly because a lab,
 * company or institute can legitimately host both a real event page and
 * third-party-style news content on different subpaths — proven unsafe by
 * execution against `events.ornl.gov` (Ruling 84b(1)'s own standing
 * must-keep; Phase 3 round 5 B, Deliverable 1). A wire-distribution or
 * trade-media outlet's entire purpose is publishing about things it does not
 * organise, so there is no legitimate "this host hosts its own real event"
 * counter-case to protect, and no such host appears anywhere in this file's
 * own must-keep corpus (verified — see eventweb.test.ts).
 */
export const NEWS_MEDIA_HOSTS = ["prnewswire.com", "news.metal.com"] as const;

function isDeniedUrl(rawUrl: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return true;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;
  const host = parsed.hostname.toLocaleLowerCase().replace(/^www\./, "");
  if (
    DENY_HOSTS.some(
      (denied) => host === denied || host.endsWith(`.${denied}`),
    ) ||
    PAPER_PAGE_HOSTS.some(
      (denied) => host === denied || host.endsWith(`.${denied}`),
    ) ||
    NEWS_MEDIA_HOSTS.some(
      (denied) => host === denied || host.endsWith(`.${denied}`),
    )
  ) {
    return true;
  }
  return (
    DENY_PATH_RE.test(parsed.pathname) || COMMERCE_PATH_RE.test(parsed.pathname)
  );
}

// Page titles that name the page rather than the event. Taking the first
// title segment blindly produced cards reading "Meeting Summary" or "Home",
// which tell the user nothing about what the event is.
//
// B5-06/R13 gap 1. A segment does not have to equal one of these words
// EXACTLY to be just as uninformative — "Agenda & Information" tells the
// reader nothing more than bare "Agenda" does, but the old anchored
// whole-segment match required an exact word and let the "+ trailing text"
// shape through as if it were the event's own name. The optional group
// below is deliberately bounded (a short connector, then <=24 more
// characters, then end of segment) so a genuinely long, substantive title
// that happens to start with one of these common words is not caught by
// accident — it reuses the same word list rather than a second, separate one.
//
// B10-03 (round 10): `call\s+for\s+(?:papers|abstracts)|cfp` added —
// `ecs.confex.com`'s live repro, "Call for Papers", a real conference-
// platform page/section label standing in for the event's own name, in
// none of this list's phrases. `EVENT_SIGNAL_RE` below lists this exact
// phrase as one of its own POSITIVE event signals, which is what lets a
// page carrying it be recognised as an event page in the first place —
// the same signal that gets a page through the front door then wins the
// segment-selection tie-break over a plainer chrome segment. Not adding
// the sibling labels ("Program"/"Technical Program"/"Registration") B also
// named as plausible on the same class of platform — B had no live
// evidence any of them has actually fired, and this loop's own standing
// practice (Ruling 32/34b) is to land what is confirmed, not what merely
// seems likely; left for a future A to measure.
const GENERIC_PAGE_TITLE_RE =
  /^(?:meeting\s+summary|summary|home|homepage|welcome|index|about(?:\s+us)?|agenda|programme?|schedule|overview|main\s+page|news|events?|conferences?|call\s+for\s+(?:papers|abstracts)|cfp)(?:\s*&\s*[\w\s]{1,24}|\s+(?:and|or)\s+[\w\s]{1,24})?$/i;

/**
 * B8-06 (round 8): GENERIC_PAGE_TITLE_RE above only recognises ONE exact
 * generic phrase, optionally plus a connector-joined trailing phrase — it
 * has no form for two generic words concatenated directly with no
 * connector, which is exactly how a real page titled bare "Conference
 * Program" reads (A's own reconfirmed live example, round 6 and round 8
 * both). Checking this as "every space-separated word is itself one of the
 * same generic words" (rather than widening the regex into an unreadable
 * alternation) catches that shape without touching the single-phrase-plus-
 * connector form above. Requires 2+ words so this stays additive to, not a
 * replacement for, the exact single-word/single-phrase form
 * GENERIC_PAGE_TITLE_RE already owns.
 *
 * `program(?:me)?s?` deliberately does NOT reuse GENERIC_PAGE_TITLE_RE's own
 * `programme?` spelling verbatim: verified directly (before writing this)
 * that `programme?` matches only "programme"/"programm", never the American
 * "program" — and "Conference Program" (the actual live-confirmed repro) uses
 * the American spelling. Copying the existing pattern here would have shipped
 * a check that cannot catch its own named example. Not fixing this same gap
 * in GENERIC_PAGE_TITLE_RE itself — that form's own bare/connector shape is
 * not one of this round's three named shapes and has no live evidence behind
 * it; flagged in the round log for the next A instead of silently expanding
 * scope.
 */
const GENERIC_TITLE_WORD_RE =
  /^(?:meeting|summary|home|homepage|welcome|index|about|us|agenda|program(?:me)?s?|schedule|overview|main|page|news|events?|conferences?|sessions?|workshops?)$/i;

function isAllGenericWords(candidate: string): boolean {
  const words = candidate.trim().split(/\s+/).filter(Boolean);
  return words.length >= 2 && words.every((word) => GENERIC_TITLE_WORD_RE.test(word));
}

function isGenericPageTitle(candidate: string): boolean {
  const trimmed = candidate.trim();
  return GENERIC_PAGE_TITLE_RE.test(trimmed) || isAllGenericWords(trimmed);
}

/**
 * Calendar indexes, archives, and organisation homepages. These pass the
 * event-signal check (they are full of the word "events") but are not a single
 * event you can attend — the events-side equivalent of a job-board search
 * page. "Events for July 2026" and "Nuclear and Applied Materials Research
 * Group" both reached a live top-5 before this filter existed.
 *
 * A24-01 / RULING 64b (round 24 C). The BROWSE alternative — the third one,
 * `(?:upcoming|browse|all) … <noun>` — now requires the PLURAL noun. An index
 * lists MANY; a singular noun is a single event's own page. The witness is this
 * corpus's own vocabulary: `All Solid State Battery Workshop` is a real event
 * shape here (the pool's headline row is a *Solid-State Battery Summit*), and
 * the singular arm dropped it. The hyphenated spelling escaped by accident —
 * a hyphen is not `\s` — and the unhyphenated one did not, which is a coin
 * toss, not a policy. The alternative's own recorded witnesses
 * (`Events for July 2026`, `Nuclear and Applied Materials Research Group`)
 * belong to alternatives 1 and 4 and are untouched; the singular arm had no
 * witness at all. Measured on 150 live offered titles over 5 pulls by round 24
 * B: identical to the un-narrowed variant — same hits, 0 drops lost.
 * This narrows a ROW-DROPPING guard, which is the direction Ruling 55c points.
 */
export const EVENT_INDEX_TITLE_RE =
  /^\s*(?:all\s+|upcoming\s+|past\s+|our\s+)?events?\b(?:\s+(?:for|in|calendar|archive|list|listing)\b|\s*$)|^\s*(?:events?|conferences?|seminars?)\s+(?:calendar|archive|listings?|schedule)\b|^\s*(?:upcoming|browse|all)\s+[\w\s]{0,30}\b(?:events|conferences|seminars|workshops)\s*$|\b(?:research\s+group|research\s+laboratory|research\s+center|research\s+centre|department\s+of|faculty\s+of)\b/i;

/**
 * B12-03 gap B (round 12): the news-article filter's VOCABULARY is not missing
 * anything — its INPUT is wrong. `adt.media` publishes an article about a
 * conference; the tell sits in the page's own `<h1>` ("What to expect at the
 * Automotive Battery Conference 2026") and in its URL path, while the search
 * provider hands Peer a title with no tell in it at all
 * ("Automotive Battery Conference 2026: key topics and speakers"). So the filter
 * gets a second input: the URL path, normalised to spaced words.
 *
 * ONLY THE ANCHORED HEADLINE FORMS ARE APPLIED TO THE PATH, never
 * `NEWS_TITLE_RE` whole. B tested the whole regex on a path and it over-reaches
 * badly: its final alternative `\b(?:news|press release|blog post|newsletter)\b`
 * is unanchored, so it matches `news/call-for-abstracts` — which is
 * `battery2030.eu`'s own URL, the OTHER host on this very item. A page living
 * under `/news/` on an organiser's own site is routinely a real event
 * announcement; a path that BEGINS with a listicle headline never is.
 *
 * When this fires the result is dropped entirely (`webResultToRawEventItem`
 * returns null) — one fewer card, not a different name, which is correct: there
 * is no name on that page that would be right, because it is not the
 * conference's own page.
 */
const NEWS_HEADLINE_PATH_RE =
  /^(?:the\s+year\s+ahead|year\s+in\s+review|(?:top|best)\s+\d+\b|what\s+to\s+(?:expect|watch)|a\s+look\s+(?:back|ahead)|recap|highlights\s+from|report\s+from|announcing\b)/i;

/** The URL's path as spaced lowercase words, so a slug reads as a headline. */
function urlPathPhrase(url: string | undefined): string | undefined {
  if (!url) return undefined;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const phrase = path.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean).join(" ");
  return phrase || undefined;
}

/**
 * Round 31 C (Ruling 84c, implementing B's item 3 §3.2 design A verbatim).
 * A30-03: `stocktitan.net` investor-PR headlines admit as events because
 * `isNewsArticleTitle`'s closed vocabulary doesn't reach financial-newswire
 * PR shapes. This is a PATH-STRUCTURE signal, not a host-name list — a
 * short, ALL-UPPERCASE segment (a stock ticker, e.g. `BCHT`) immediately
 * after `/news/` is specific to financial-newswire URL conventions, and
 * generalises across every host using this convention without naming one
 * (see `DENY_HOSTS`/`PAPER_PAGE_HOSTS` above for the shipped precedent of a
 * closed host/path signal; Rulings 41c/45a are measurement-method rulings
 * about this loop's OWN live-census probing, not a production-code
 * host-list prohibition).
 *
 * Reads the RAW (un-lowercased) URL path, since `urlPathPhrase()` lowercases
 * everything and would destroy the very signal (the ALL-CAPS shape) that
 * makes this reliable — a separate small check, not a change to
 * `urlPathPhrase`/`NEWS_HEADLINE_PATH_RE`.
 */
const TICKER_NEWS_PATH_RE = /\/news\/[A-Z]{1,5}\//;

function isTickerNewsPath(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return TICKER_NEWS_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Phase 3 round 6 C, ITEM 1 (F11, Ruling 123b). A second URL-path signal for
 * the same family `isTickerNewsPath` above polices — mirroring its precedent
 * exactly: a narrow, UNANCHORED raw-pathname regex, not routed through the
 * existing `^`-anchored `urlPathPhrase`/`NEWS_HEADLINE_PATH_RE`, which
 * PROVABLY CANNOT reach this witness (Phase 3 round 5 B, Deliverable 2):
 * `fz-juelich.de`'s path-phrase is "en iet iet 1 news event reports
 * electra...", and "event reports" sits mid-phrase, not at index 0, so the
 * existing anchor structurally misses it.
 *
 * Catches the `event-report(s)` URL shape — the live witness is an
 * organiser's OWN post-event retrospective report page
 * (`.../news/event-reports/electra-battery-symposium-2026`, written entirely
 * in past tense about an already-concluded event), a distinct sub-shape from
 * a third party's news coverage.
 *
 * n=1 witness — the same vacuity discipline this campaign applies to every
 * closed-list/path addition (F8, F9, J2). Verified by execution against the
 * full must-keep corpus with zero collisions — see eventweb.test.ts. Does
 * NOT reach `djk.co.jp` (`/news/detail.html`), `ornl.gov`
 * (`/news/ten-years-...`, no "report(s)" token) or `pi-kem.co.uk`
 * (`/articles/...`) — a narrow, partial close, not a general "news path" fix.
 */
const EVENT_REPORT_PATH_RE = /\/event[-\s]?reports?\//i;

function isEventReportPath(url: string | undefined): boolean {
  if (!url) return false;
  try {
    return EVENT_REPORT_PATH_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

/**
 * Round 31 C (Ruling 84c, implementing B's item 3 §3.2 design B verbatim).
 * A30-03's title-shape sibling: mirrors this file's own precedented
 * "subject (1-5 title-case-ish words) + closed PR-style verb" convention
 * (the same shape `PRESENT_NARRATIVE_RE` already uses for
 * `attends?|announces?|hosts?|presents?|joins?|visits?`, applied here to a
 * DIFFERENT consumer — whole-row rejection, not segment selection — so it
 * is designed and tested separately rather than importing that constant).
 * Requires BOTH a leading proper-noun-shaped subject AND the verb
 * `plans`/`schedules` AND an immediately following digit.
 *
 * Only "plans"/"schedules" are included, not the fuller PR-verb family
 * (`announces`, `to exhibit at`, `attends`) — those are UNWITNESSED on this
 * item (one live specimen only) and are NOT added blind, per this loop's own
 * "land what is confirmed" practice. Named as a residual for a future round
 * if any of those verbs is ever organically witnessed in this shape.
 */
const PR_ANNOUNCEMENT_HEADLINE_RE =
  /^\s*[A-Z][\w&.,'-]*(?:\s+[A-Z]?[\w&.,'-]*){0,4}\s+(?:plans?|schedules?)\s+(?:to\s+)?\d+\b/;

/**
 * Round 37 B (Ruling 102b, M36-01): the Ruling-93-named PR-headline
 * verb-sibling residual's reopen trigger fired -- the manager's own
 * independent re-measurement window organically witnessed the verb `sets`
 * in exactly the shape this file's own round-31 doc comment named as
 * residual-watched: `scanx.trade`'s "Ion Exchange sets 62nd AGM for
 * September 11, 2026" (a stock-news site's corporate-shareholders'-AGM
 * announcement, not a scholarly event), admitted and rendered as an event
 * card with a real date.
 *
 * KEPT AS A SEPARATE CONST, NOT MERGED INTO PR_ANNOUNCEMENT_HEADLINE_RE
 * ABOVE, on purpose: the witnessed shape's digit is an ORDINAL ("62nd"),
 * not the bare count PR_ANNOUNCEMENT_HEADLINE_RE's own `\d+\b` arm was
 * built for and is *structurally incapable* of matching (`\d+\b` requires
 * a word-boundary immediately after the digit run; an ordinal's trailing
 * letters leave no such boundary -- measured directly, see the round log).
 * Isolating the new shape in its own regex means the existing, already-
 * tested plans/schedules+bare-digit contract stays byte-unchanged --
 * zero re-derivation risk on it, confirmed by the unmodified regression
 * test below.
 *
 * Only `sets` is included, not the fuller unwitnessed PR-verb family
 * (`announces`, `to exhibit at`, `attends`, `hosts`) -- those remain
 * UNWITNESSED in this shape and are NOT added blind, per this loop's own
 * "land what is confirmed" practice (round 31 B's own precedent on this
 * exact guard). Still residual-watched by name below.
 *
 * A standalone veto on the bare token `AGM`/"Annual General Meeting" was
 * measured and DROPPED (not shipped): four constructed, plausible real
 * scholarly/professional-society titles (e.g. "Royal Society of Chemistry
 * Annual General Meeting and Conference 2026") all false-drop under a
 * standalone AGM-token veto, because the token alone cannot distinguish a
 * corporate-shareholders' AGM from a genuine scholarly society's own
 * AGM-plus-conference page, and `isNewsArticleTitle` has no rescue clause
 * (unlike `isJobListingContentTitle`'s `looksLikeEvent` safety net) to
 * protect against it. The verb+ordinal fix below already closes M36-01
 * without it, so the AGM signal is not needed and was not added.
 */
const PR_SETS_ORDINAL_HEADLINE_RE =
  /^\s*[A-Z][\w&.,'-]*(?:\s+[A-Z]?[\w&.,'-]*){0,4}\s+sets\s+\d+(?:st|nd|rd|th)\b/;

/**
 * `url` is optional so every existing one-argument caller keeps working
 * unchanged — the path check simply does not run without it.
 */
export function isNewsArticleTitle(title: string, url?: string): boolean {
  const trimmedTitle = title.trim();
  if (NEWS_TITLE_RE.test(trimmedTitle)) return true;
  if (PR_ANNOUNCEMENT_HEADLINE_RE.test(trimmedTitle)) return true;
  if (PR_SETS_ORDINAL_HEADLINE_RE.test(trimmedTitle)) return true;
  if (isTickerNewsPath(url)) return true;
  // Phase 3 round 6 C, ITEM 1 (F11, Ruling 123b) — see isEventReportPath above.
  if (isEventReportPath(url)) return true;
  const phrase = urlPathPhrase(url);
  return phrase !== undefined && NEWS_HEADLINE_PATH_RE.test(phrase);
}

export function isPaperPageTitle(title: string): boolean {
  return PAPER_TITLE_RE.test(title.trim());
}

/**
 * A29-07 (round 29 C, item 1c — B's item 7 OPTION C). **A THING PRODUCED AT AN
 * EVENT IS NOT THE EVENT.**
 *
 * `scholarsarchive.byu.edu/facpub/9603/` — a Digital Commons repository record
 * titled `Instructional Slides from Molten Salt Electrochemistry Symposium
 * (MoSES)…` — was ADMITTED as a conference, because `looksLikeEvent` is true on
 * the word `Symposium` sitting inside the *artefact's* own name. A keyword test
 * cannot tell "the thing" from "a thing produced at the thing"; the title's
 * GRAMMAR can, and round 29 B measured the class to be larger than one row
 * (`Slides from the 2026 Battery Symposium`, `Proceedings of the Molten Salt
 * Workshop` are both `looksLikeEvent`-true today).
 *
 * **THE HEAD ANCHOR IS THE WHOLE RULE.** The real event
 * `Molten Salt Electrochemistry Symposium (MoSES) 2026` — which renders
 * correctly 5 of 5 from `pyro.byu.edu/moses` — must not match, and it cannot:
 * its head is the event's own name, not an artefact noun. B checked that rather
 * than assuming it.
 *
 * **THE ATTRIBUTION PREPOSITION IS THE SECOND HALF AND IT IS LOAD-BEARING.**
 * `Poster Session` is part of a real conference programme; a bare `Poster` must
 * never fire. The artefact noun only counts when the title goes on to say what
 * it was produced *from / of / at*.
 *
 * **ONE optional leading modifier, no more.** The live row needs it
 * (`Instructional Slides from …`). Two would admit `Call for Posters at …`,
 * a shape B never measured — so the budget stops at one.
 *
 * **NOUN LIST HELD TO B's FOUR MEASURED SHAPES.** `talk`, `lecture`, `keynote`
 * and `abstract` are all plausible siblings and NONE of them is implemented
 * here: B's design spans slides / proceedings / poster / presentation and the
 * escape clause forbids widening a design inline. **RESIDUAL, RECORDED NOT
 * CLEARED:** an artefact whose title does not announce itself (a deposited deck
 * titled simply `Molten Salt Electrochemistry Symposium 2026`) is invisible to
 * this rule. B did not sight one.
 *
 * **It is a KIND rule, so a miss falls to ADMISSION** — an artefact this list
 * does not name is rendered, not silently deleted. An absent title never
 * reaches here: the row already drops on no-title.
 */
const EVENT_ARTEFACT_HEAD_RE =
  /^(?:[a-z][a-z-]*\s+)?(?:slides?|proceedings|posters?|presentations?)\s+(?:presented\s+)?(?:from|of|at)\s+\S/i;

export function isEventArtefactTitle(title: string): boolean {
  return EVENT_ARTEFACT_HEAD_RE.test(title.trim());
}

/**
 * B18-01 (round 18, Ruling 50b/51a): a SHAREHOLDER-REPORTING OCCASION IS NOT A
 * SCHOLARLY EVENT. `specterfi.com/companies/1539/concalls/Feb2026` — a stock
 * research page for "Ion Exchange (India) Limited Q3 & 9M FY26 Earnings
 * Conference Call" — sat in the live event pool 5 pulls out of 5, rendering as
 * the event card `1539 Feb2026 Concall Summary`, where `1539` is the site's
 * internal company ID.
 *
 * THE ADMISSION MECHANISM, ESTABLISHED BY EXECUTION, NOT INFERRED: the gate's
 * front door is `looksLikeEvent(title + snippet)` and `EVENT_SIGNAL_RE` lists
 * `conference`. "Conference Call" contains it. Nothing downstream ever asks
 * whether the page is a shareholder-reporting occasion rather than a scholarly
 * one. The topic collision that made it RELEVANT (`ion exchange` matching the
 * company's legal name rather than the chemistry) is a separate question and
 * is NOT what admitted it — this is a page-KIND defect, so the fix belongs at
 * the page-kind gate and not in the matcher.
 *
 * FAILURE DIRECTION, STATED DELIBERATELY, because it is the whole safety
 * argument: a MISS leaves the row exactly where it is today (status quo, no new
 * wrong value); a FALSE FIRE deletes a real event. So this is tuned for ZERO
 * false fires with under-catching as the accepted, named failure direction —
 * Ruling 40's own accepted shape, and the identical contract `isListingPage`
 * already runs under on the job surface. It is NOT Ruling 37's open-class trap:
 * there, a miss produced a WRONG value (a mutilated sentence).
 *
 * **BARE `conference call` IS DELIBERATELY ABSENT AND MUST NOT BE ADDED IN ANY
 * POSITION.** Measured on live data it catches 12 of 12 positives and then
 * deletes a real scholarly event: `ascl.org`'s "2026 YCC Conference Call for
 * Papers (and Student Awards)", where "Conference" and "Call for Papers" are
 * adjacent by accident. Asserted as a must-keep below.
 *
 * Every candidate term was measured ALONE and seven were cut for earning
 * nothing on real data — and the cut also removed the only adversarial false
 * fire (`quarterly results`, which killed "Quarterly Results Review Seminar
 * Series — Physics Dept"). The evidence-minimal list and the safe list are the
 * same list. Do not re-add `earnings webcast`, `earnings release`,
 * `analysts meet`, `investor day`, `investor call`, `investor webcast` or
 * `quarterly results`.
 *
 * NO HOST LIST AND NO URL-ONLY RULE: the shipped gate also admits earnings-call
 * pages on `scribd.com`, `adanienterprises.com`, `piindustries.com`,
 * `balchem.com` and `roberthalf.com`. A `specterfi.com` entry or a bare
 * `/concalls/` path rule would close one row and leave the class open — the
 * exact move Ruling 40 rejects.
 */
const EARNINGS_CALL_PAGE_RE =
  /\b(?:concalls?|earnings\s+(?:conference\s+)?call|results\s+conference\s+call)\b/i;

/**
 * The page names itself an ARTEFACT of a call — a page KIND, not an event.
 *
 * Ruling 51a landed this clause alongside the occasion clause above with the
 * redundancy disclosed rather than hidden: on the measured corpus the occasion
 * clause alone already reaches the same 5/5 and 3/5. It is kept because it
 * independently catches 4 of 5 and 1 of 5 with zero false fires across 94
 * must-keeps, and because it is the only clause that reaches a sibling site
 * whose TITLE says "Conference Call Summary" while its path carries none of the
 * vocabulary. Redundancy on the measured corpus is not redundancy on the
 * reachable class.
 */
const CALL_ARTEFACT_TITLE_RE =
  /\b(?:conference\s+call|concall|earnings\s+call)\s+(?:summary|transcript|highlights|recap|notes)\b/i;

/**
 * The URL is a SECOND INPUT, and that is shipped precedent rather than a new
 * idea: `isNewsArticleTitle` already feeds `urlPathPhrase(url)` to an anchored
 * subset of its own regex (B12-03 gap B). The same helper is reused; there is
 * deliberately no second copy of it.
 *
 * Only the OCCASION regex is applied to the path — the artefact regex is a
 * title shape and has no business matching a slug. The path clause is what
 * catches a provider title truncated before its vocabulary
 * ("Associated Alcohols & Breweries Ltd Nov2025 ... - SpecterFi").
 *
 * The SNIPPET is deliberately not an input: measured, the snippet variant
 * false-fires 3 times on real admitted rows.
 */
export function isEarningsCallPage(title: string, url?: string): boolean {
  const phrase = urlPathPhrase(url);
  return (
    EARNINGS_CALL_PAGE_RE.test(title) ||
    CALL_ARTEFACT_TITLE_RE.test(title) ||
    (phrase !== undefined && EARNINGS_CALL_PAGE_RE.test(phrase))
  );
}

export function isEventIndexPage(title: string): boolean {
  return EVENT_INDEX_TITLE_RE.test(title.trim());
}

/**
 * A24-01 (round 24). ROW ADMISSION's version of the check above, and the only
 * one `webResultToRawEventItem` uses.
 *
 * `EVENT_INDEX_TITLE_RE`'s browse alternative is END-ANCHORED, so a site-chrome
 * tail walks straight past it: the SAME `/cet/conferences` page was dropped
 * when the provider handed Peer `Upcoming Energy Storage Conferences` and
 * ADMITTED when it handed over
 * `Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech`.
 * A natural experiment, not an argument — and once admitted, the index page
 * supplied a NAME (`Provided by Cambridge EnerTech`, the only segment left
 * after the picker rejected segment 1) and a PLACE (`Chicago, IL` — another
 * event's city, read out of a page listing many). One mechanism, three faces.
 *
 * So the FIRST SEGMENT becomes a second derived input, exactly as
 * `isEarningsCallPage` and `isNewsArticleTitle` already feed themselves
 * `urlPathPhrase(url)`. `isChromeSegment` has classified segments this way at
 * its own call to `isEventIndexPage` all along — row admission was strictly
 * WEAKER than the naming check sitting above it in this same file.
 *
 * **FIRST SEGMENT ONLY.** An `any segment` variant is dead, killed by its own
 * control: `Battery Safety Summit 2026 | Upcoming Conferences` is a REAL event
 * whose site chrome names the organiser's events hub, and `any segment` drops
 * it. A page's SUBJECT is its first segment; everything after is chrome — the
 * same reading `selectEventTitleSegment` already takes, so the two stay
 * consistent instead of drifting.
 *
 * `isEventIndexPage`'s own contract is deliberately UNCHANGED so the name
 * picker at `isChromeSegment` keeps testing whole segments and nothing widens
 * there. A miss here falls to ADMISSION: this check only ever removes a whole
 * row, never edits a value and never renders a partial card.
 */
export function isEventIndexResult(title: string): boolean {
  if (isEventIndexPage(title)) return true;
  const first = titleSegments(title)[0];
  return first !== undefined && isEventIndexPage(first);
}

/**
 * A27-01 (round 27, item 3). THE INDEX CHECK IS THE ONLY EVENT-SIDE KIND GUARD
 * THAT NEVER READS THE URL — one missing input, three faces.
 *
 * Three listing/hub pages were admitted at ingestion 5 of 5:
 * `volta.foundation/event` (`Battery Events`, which then rendered the BARE HOST
 * as its name), `annexushealth.com/conferences` and `iongroup.com/careers`
 * (`Career - Join Our Passionate Team` — and the event surface has no careers
 * guard at all, where the job side has `CAREERS_INDEX_TITLE_RE`). Every one of
 * the five shipped kind guards returns `false` on all three, because
 * `EVENT_INDEX_TITLE_RE`'s alternatives are anchored on the index noun leading
 * the title, and these titles lead with a topic, a brand or a bare "Career".
 *
 * **A TITLE-ONLY RULE IS PROVABLY IMPOSSIBLE HERE, AND THAT IS MEASURED RATHER
 * THAN ASSUMED.** A fifth alternative on `EVENT_INDEX_TITLE_RE` — "a plural
 * index noun ending the first segment" — was swept over 1 747 string literals
 * in the event test files and it drops TWO SHIPPED MUST-KEEPS:
 * `Co-located Workshops | The Battery Show North America` and
 * `DLR Events | Events for July 2026`. **`DLR Events` and `Battery Events` are
 * the same shape, `<Word> Events`.** No rule reading only the title can
 * separate them, so the URL is not a convenience here — it is the only
 * available discriminator.
 *
 * BOTH SIGNALS ARE REQUIRED, and either alone is measurably unsafe: signal 2
 * alone drops `Co-located Workshops`; signal 1 alone drops a single-event site
 * whose own page sits at a bare `/conference`.
 *
 * FIVE CLAUSES:
 *
 *  1. **Signal 2's index nouns are PLURAL ONLY.** This is Ruling 64b's boundary
 *     honoured by construction — `All Solid State Battery Workshop` is
 *     SINGULAR, so the signal can never fire on it whatever its URL.
 *  2. **The head is taken with the SHIPPED `titleSegments` splitter** (spaced
 *     separators only), plus a cut at the first colon. No new splitting rule is
 *     written, so a bare hyphen inside `Co-located` is not a separator — the
 *     same reading `selectEventTitleSegment` already takes.
 *  3. **Signal 1 is the TERMINAL path segment.** A hub noun with an item below
 *     it is a real page: `event.dlr.de/en/event/emea2026-workshop-...` must
 *     survive, and the shipped slug-recovery test depends on it.
 *  4. **`careers?` sits in BOTH signals.** In signal 1 alone it would not reach
 *     `iongroup.com`; in signal 2 alone the path clause would drop a real event
 *     hosted under a `/careers` path.
 *  5. **`url` is optional and the predicate returns `false` without one.** That
 *     is what makes every existing one-argument assertion on
 *     `isEventIndexResult`/`isEventIndexPage` safe BY CONSTRUCTION rather than
 *     by inspection — and those two keep their contracts byte-untouched, which
 *     is what the shipped "leaves the raw predicate's own contract alone" test
 *     exists to protect.
 *
 * Failure direction: a hub path with a singular or topic title is ADMITTED,
 * exactly as today. The undecidable case admits — a guard that DROPS is held to
 * a higher bar than one that admits. A dropped row renders nothing at all; this
 * predicate never edits a value.
 *
 * NOT CLOSED BY THIS, AND FLAGGED RATHER THAN REVERSED: `eventNameFrom`'s
 * URL-host last resort (B9-04 Fix 1 / Ruling 35) is a separate, recorded design
 * and stays reachable by any row whose segments are all rejected. Dropping
 * these three rows removes their bare-host names, not the mechanism. No round
 * has yet witnessed a bare host on a RENDERED row; when one is witnessed, that
 * is the moment to price a name-path guard.
 */
/**
 * ROUND 30, RULING 81b (B's item 2, the V2 structural-guard extensions,
 * approved as written). A live specimen reproduced the class Ruling 80b
 * named ("a similar-conferences listing"): `electrochem.org/upcoming-
 * meetings`, title `Upcoming Meetings - ECS`. `meetings?` was simply absent
 * from both this list and `EVENT_HUB_TITLE_TAIL_RE` below.
 *
 * **THE HYPHEN-BOUNDED QUALIFIER-PREFIX ALTERNATIVE IS A CLOSED,
 * ANCHORED ALTERNATIVE — NOT A SUBSTRING OR PREFIX RULE.** It reads
 * `<alnum-run>-<one recognised word>`, the WHOLE terminal segment, nothing
 * before the alnum run and nothing after the word. `upcoming-meetings`
 * matches (one hyphen, one recognised word). A multi-hyphen slug like
 * `co-located-workshops.html` (Ruling 64b's own must-keep) does NOT match:
 * the character class excludes `-`, so the run before the (single) required
 * literal hyphen can only ever be the segment's FIRST hyphen-delimited
 * piece, and the remainder (`located-workshops.html`) is not itself one of
 * the closed words — the alternative fails by construction, not by luck.
 * The word list here is deliberately its OWN five words
 * (`events?|conferences?|seminars?|workshops?|meetings?`), not the full
 * eight-word list above — `careers?`/`jobs` are excluded from the hyphen
 * form on purpose, so a hyphen-qualified careers path (the job side's own
 * `careers-advisor-job` boundary case) cannot be reached from this side
 * either.
 */
const EVENT_HUB_PATH_SEGMENT_RE =
  /^(?:events?|conferences?|seminars?|workshops?|symposium|symposia|calendar|agenda|careers?|jobs|meetings?|[a-z0-9]+-(?:events?|conferences?|seminars?|workshops?|meetings?))$/i;

const EVENT_HUB_TITLE_TAIL_RE =
  /(?:^|\s)(?:events|conferences|seminars|workshops|symposia|meetings)$/i;

const EVENT_HUB_TITLE_HEAD_RE = /^careers?\b/i;

export function isEventHubResult(title: string, url?: string): boolean {
  if (!url) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  const segments = path.split("/").filter(Boolean);
  const terminal = segments[segments.length - 1];
  if (terminal === undefined || !EVENT_HUB_PATH_SEGMENT_RE.test(terminal)) {
    return false;
  }
  const beforeColon = title.split(":")[0];
  const head = (titleSegments(beforeColon)[0] ?? title.trim()).replace(
    /[.,;!?]+$/,
    "",
  );
  return EVENT_HUB_TITLE_TAIL_RE.test(head) || EVENT_HUB_TITLE_HEAD_RE.test(head);
}

/**
 * Best available human-readable event name from a search result.
 *
 * Page titles arrive in three shapes: a clean event name, an event name with
 * site chrome appended ("… | Cambridge EnerTech"), or a generic page label
 * ("Meeting Summary"). Prefer the most informative segment of the title, and
 * when the whole title is generic, recover the event name from the snippet
 * rather than showing the user a meaningless card.
 */
/**
 * B5-06/R13 gap 2. A short filler word ("the"/"a"/"an") stuck in front of
 * what's otherwise the page's own domain restated — "The Engine" on
 * engine.xyz — is the same site-brand shape `looksLikeHostBrand` already
 * catches, just with an article attached. Deliberately its own function
 * rather than folding the filler-strip into `looksLikeHostBrand` itself
 * (shared.ts, built for B5-03's job-board-brand problem): a real company's
 * own display name legitimately elaborates its domain root with a TRAILING
 * descriptor far more often than a real name is genuinely "[article] +
 * [domain root]" the way a media/platform brand's name commonly is, so
 * widening the shared, job-side function itself to also strip a leading
 * article would raise its false-rejection risk for the job side for no
 * benefit there. Only reused where the shape is actually expected.
 */
const BRAND_FILLER_PREFIX_RE = /^(?:the|an?)\s+/i;

function looksLikeArticledHostBrand(candidate: string, host: string): boolean {
  const withoutFiller = candidate.replace(BRAND_FILLER_PREFIX_RE, "");
  if (withoutFiller === candidate) return false;
  return looksLikeHostBrand(withoutFiller, host);
}

/**
 * Site chrome: a title segment that names the website or a calendar view
 * rather than an event ("DLR Events", "Events for July 2026"). Real listings
 * routinely wrap a good event page in two of these, as in
 * "DLR Events | Events for July 2026" — whose URL is a specific workshop.
 *
 * B5-06/R13 gap 2 added the last two checks: a segment that is essentially
 * the page's own domain restated (a site's own brand, not an event's name)
 * — same mechanism B5-03 built for a job board's own brand leaking into the
 * job company slot, reused rather than reinvented here. `host` is optional
 * because `eventNameFrom` is sometimes called without a URL (see its own
 * tests); the brand checks simply do not run when there is nothing to
 * compare against, matching every other optional-signal convention in this
 * codebase.
 */
/**
 * B8-06 (round 8): a served document's own filename with its extension
 * ("AA ECC10 POSTERS 08072026.xlsx") is neither a page label, an index, nor
 * a brand — it's a raw filename that happened to be the page's own <title>.
 * Traced which function this actually passes through before writing
 * anything: nameFromUrlSlug (below) already strips a trailing extension
 * before it can return one, so a segment still carrying its extension did
 * NOT come from the URL-slug fallback — it reaches here, straight from
 * bestEventTitleSegment's own title-segment split. Narrow and high-
 * confidence: a real event name essentially never ends this way.
 */
const DOCUMENT_FILENAME_RE = /\.(?:pdf|docx?|xlsx?|pptx?|csv|zip)$/i;

/**
 * B11-03 (round 11): scraped widget/markup chrome — a class B11-01's
 * enumeration named that NO guard on either candidate path had ever
 * targeted, and the one that produced two of round 11's three confirmed
 * wrong event names. Distinct from every check above it: these strings are
 * not a page label, not an index, not a date, not a location, and not
 * narration either — B11-01 confirmed by execution that both live repros
 * pass `looksLikeEventTitle` unchanged, so B11-02's guard alone cannot
 * reach them. What they are is raw page furniture that survived text
 * extraction and got stitched into what reads as one 20-120-character
 * fragment.
 *
 * Both follow this file's own established convention (NARRATIVE_VERB_RE,
 * HEADLINE_PASSIVE_RE, PRESENT_NARRATIVE_RE): a narrow, closed regex per
 * confirmed shape, not a general markup parser.
 *
 * A media/document filename with its extension, optionally followed by a
 * query-string suffix, ANYWHERE in the segment. Deliberately not anchored
 * to the end the way DOCUMENT_FILENAME_RE above is — that check targets a
 * segment that IS a filename, whereas this shape is a filename STITCHED to
 * other scraped text (internationalbatteryseminar.com's live repro: an
 * image filename with a cache-busting query string, then a bracketed
 * ellipsis, then a carousel widget's own label). The trailing `\b` is
 * load-bearing: it keeps a real word that merely CONTAINS an extension's
 * letters after a period (".docs", ".zipper") from matching, since there is
 * no word boundary mid-word.
 */
const EMBEDDED_FILENAME_RE =
  /\.(?:jpe?g|png|gif|webp|svg|bmp|tiff?|pdf|docx?|xlsx?|pptx?|csv|zip)(?:\?[\w=&%-]*)?\b/i;

/**
 * B11-03 (round 11), second shape: raw Markdown syntax leaking through text
 * extraction — an ATX heading marker or a bracketed ellipsis, both artifacts
 * of the extraction step rather than anything a real event name contains.
 * thebatteryshowsouth.com's live repro carried both.
 *
 * The `{2,6}` hash floor is deliberate and was verified against a
 * constructed adversarial case before being written here, per Ruling 31: a
 * SINGLE `#` followed by a space is closer to plausible real-title
 * punctuation ("Session # 3: ...") than to markup, and this shape has
 * exactly one live confirmation to justify it on. `{1,6}` would have been
 * wider for no evidence. The must-not-reject test for that boundary is in
 * eventweb.test.ts and exists specifically so a future round cannot relax
 * the floor without a test telling it what it just gave up.
 */
const MARKDOWN_CHROME_RE = /#{2,6}\s|\[\s*\.\.\.\s*\]/;

/**
 * B9-04's bare-date guard (round 9): a segment that is ONLY a date —
 * "March 15-18, 2027" — clears every check above cleanly (none of them has
 * any concept of "this is only a date, not a name") and clears
 * looksLikeEventTitle too (no narrative verb, not multi-sentence, well
 * under the word ceiling), so nothing else in the chain rejects it either.
 * Confirmed live: internationalbatteryseminar.com rendered exactly this
 * string as an event's name.
 *
 * Reuses shared.ts's MONTH_PATTERN/DAY_PATTERN/DATE_TOKEN_PATTERN (moved
 * there this round specifically so this file could reuse them without a
 * circular import with event-details.ts, which already imports
 * looksLikeEventTitle FROM this file) rather than a new from-scratch date
 * parser. DATE_TOKEN_PATTERN alone does not cover the live repro — its
 * "Month Day[, Year]" alternative allows only a single day, not a range —
 * so this adds two more alternatives with a day range in the middle
 * ("15-18"), the same optional-range shape this file's own DATE_DMY_RE
 * already uses for the other date order (day before month).
 *
 * Anchored to the WHOLE trimmed segment on both ends: "SolarPACES 2026"
 * (an existing passing case that must not be affected) contains a bare
 * year but is not a date-shaped segment as a whole, so it does not match
 * here — this rejects a segment that IS a date, not one that merely
 * contains one.
 */
const BARE_DATE_SEGMENT_RE = new RegExp(
  `^(?:${DATE_TOKEN_PATTERN}` +
    `|${MONTH_PATTERN}\\.?\\s+${DAY_PATTERN}\\s*[-–]\\s*${DAY_PATTERN}(?:,?\\s+\\d{4})?` +
    `|${DAY_PATTERN}\\s*[-–]\\s*${DAY_PATTERN}\\s+${MONTH_PATTERN}\\.?(?:,?\\s+\\d{4})?)$`,
  "i",
);

function isBareDateSegment(candidate: string): boolean {
  return BARE_DATE_SEGMENT_RE.test(candidate.trim());
}

/**
 * B10-02 (round 10): a segment that IS only a US city/state location
 * ("Orlando, FL") reads as a perfectly fine "title" to every check above —
 * none has any concept of "this is only a location, not a name." Confirmed
 * live: internationalbatteryseminar.com rendered exactly this string once
 * B9-04's bare-date guard removed the sibling date segment that used to sit
 * next to it, leaving the location as the sole survivor — the event side's
 * own version of a gap `looksLikeBareLocation` already closed for the job
 * side (`jobweb.ts`), reusing the same `US_STATE_CODES` list so the two
 * cannot drift apart.
 *
 * Deliberately NOT a straight copy of the job side's check, which is
 * unanchored (it only requires the candidate to END in ", ST", with no
 * bound on what precedes it — safe there because a job-title split segment
 * carrying a location is already isolated to just the location in
 * practice). An event segment could legitimately be a longer, real title
 * that merely ENDS in a city/state — a live, already-correct example this
 * round is `10times.com`'s own "Solid-State Battery Summit (Aug 2026),
 * Chicago USA". Anchored to the WHOLE trimmed segment instead, mirroring
 * `isBareDateSegment`'s own `^...$` convention: "the segment IS a bare
 * location," not "the segment ENDS WITH one." Bounded to at most four
 * Title-Case-or-lowercase words before the comma so a long real title that
 * happens to end in a real city/state is not caught by accident.
 */
const BARE_LOCATION_SEGMENT_RE = new RegExp(
  `^[A-Za-z][\\w.'-]*(?:\\s+[A-Za-z][\\w.'-]*){0,3},\\s*(${US_STATE_CODES.join("|")})$`,
);

function isBareLocationSegment(candidate: string): boolean {
  const match = candidate.trim().match(BARE_LOCATION_SEGMENT_RE);
  return Boolean(match && match[1] === match[1].toUpperCase());
}

/**
 * B9-04 Fix 2 (round 9): additive and optional, same "thread an option
 * through, default preserves old behaviour" convention this file already
 * used for `host` itself (B8-04). `skipHostBrand` lets a caller ask "is this
 * chrome for any reason OTHER than matching the page's own host brand" —
 * built for `enrich.ts`'s typedName rescue, which legitimately needs to
 * un-reject a structured/typed event name for host-brand collisions only
 * (an organisation's own domain commonly IS its own name) while still
 * rejecting it for every other reason a segment can be chrome. Every
 * existing caller omits this and is unaffected.
 */
interface ChromeSegmentOptions {
  skipHostBrand?: boolean;
}

/**
 * A closed list of event-kind NOUNS — the words English uses to name a scholarly
 * gathering. Genuinely finite, unlike a verb list (§1x Ruling 37), and already
 * enumerated twice in this codebase (`EVENT_SIGNAL_RE` above, `eventKindIn` in
 * `events/mapper.ts`). Used by TWO items, which is why it lives up here:
 * B12-03's welded-label strip and B12-04's host-brand exemption.
 *
 * This list is single-word. Both enumerations it is drawn from ALSO carry
 * MULTI-WORD kinds, which `EVENT_KIND_PHRASE_RE` below now covers; the two are
 * used together only where a miss would be unsafe. See that comment for which
 * use takes which, and why — that is the reconciliation the round-12 note here
 * asked for, done in this one place.
 */
const EVENT_KIND_NOUN_RE =
  /\b(?:conference|symposium|workshop|seminar|colloquium|congress|meeting|summit|expo|exposition|exhibition|forum|convention|show|school|hackathon|roundtable|fair)\b/i;

/**
 * The MULTI-WORD half of the same closed enumeration, added by B12-01 under
 * §1aa Ruling 40. Every phrase here is COPIED from one of the two sources the
 * comment above names, at implementation time, spelled as that source spells it
 * — none is added from memory or invention:
 *
 *  - from `EVENT_SIGNAL_RE` (this file): `round ?table`, `career (?:fair|expo)`,
 *    `job fair`, `hiring fair`, `recruiting (?:fair|event)`, `hack day`,
 *    `society meeting`, `gordon research`.
 *  - from `eventKindIn` (`events/mapper.ts`):
 *    `(?:career|student|graduate|campus) (?:fair|expo)`,
 *    `(?:job|hiring|recruiting|recruitment) (?:fair|expo|event)`, `hack day`,
 *    `trade show`, `lecture series`, `networking event`, `annual meeting`.
 *
 * The two fair/expo families are written in `eventKindIn`'s wider spelling,
 * which is a superset of `EVENT_SIGNAL_RE`'s four. `EVENT_SIGNAL_RE`'s other
 * multi-word entries — `call for papers` and `abstract submission` — are
 * DELIBERATELY ABSENT: they are page labels, not event kinds, and admitting
 * that class is exactly why Ruling 40 rejected reusing the whole regex here
 * (it would qualify `"Registration Desk Hours"` as an event's name).
 *
 * Several phrases are already implied by a single word above (`annual meeting`
 * by `meeting`, `trade show` by `show`, the fair families by `fair`). They are
 * kept anyway, because the instruction was to copy the sources rather than to
 * filter them, and because the list stays correct if the single-word one is
 * ever narrowed.
 *
 * WHICH USE TAKES WHICH, and the failure direction that decides it:
 *  - `leadingNameSpan` (B12-01) tests BOTH, phrase-level over the joined span,
 *    because there the kind test is a hard veto on whether a name exists at all
 *    — a two-word kind missing from the list turned
 *    `"2026 International Round Table on Titanium Production in Molten Salts"`
 *    into `"Untitled event"`, which is why B12-01's first attempt was stopped.
 *  - `stripWeldedPageTypeLabel` (B12-03) and `isChromeSegment`'s host-brand
 *    exemption (B12-04) keep the single-word list ALONE, unchanged. In both of
 *    those the failure direction is already "do nothing" (leave the segment
 *    unstripped; leave it rejected as chrome), so a missed kind costs a missed
 *    fix and never a wrong value. Widening them is a separate change with its
 *    own evidence, not a side effect of this one.
 *
 * THE FAILURE DIRECTION OF THIS LIST ITSELF, stated explicitly because Ruling
 * 40 turns on it: a kind that is NOT listed here means the span is DROPPED, and
 * execution falls through to `eventNameFrom`'s honest URL-host last resort
 * (B9-04 Fix 1) — so a miss costs a MISSED RECOVERY and can NEVER produce a
 * wrong value. That is what makes an openly-maintained list acceptable here and
 * not in §1x Ruling 37's verb list, whose misses mutilated correct sentences.
 * A's standing honest-host count is the tally that surfaces the misses: a bare
 * hostname rendered over a page whose name carries an unlisted kind is the
 * evidence that extends this list.
 */
const EVENT_KIND_PHRASE_RE =
  /\b(?:round ?table|(?:career|student|graduate|campus) (?:fair|expo)|(?:job|hiring|recruiting|recruitment) (?:fair|expo|event)|hack day|trade show|lecture series|networking event|annual meeting|society meeting|gordon research)\b/i;

function isChromeSegment(
  segment: string,
  host: string | undefined,
  options?: ChromeSegmentOptions,
): boolean {
  const trimmed = segment.trim();
  if (
    isGenericPageTitle(trimmed) ||
    isEventIndexPage(trimmed) ||
    /^[\w\s.-]{0,24}\bevents?$/i.test(trimmed) ||
    DOCUMENT_FILENAME_RE.test(trimmed) ||
    EMBEDDED_FILENAME_RE.test(trimmed) ||
    MARKDOWN_CHROME_RE.test(trimmed) ||
    isBareDateSegment(trimmed) ||
    isBareLocationSegment(trimmed)
  ) {
    return true;
  }
  if (options?.skipHostBrand || !host) return false;
  const isBrand =
    looksLikeHostBrand(trimmed, host) || looksLikeArticledHostBrand(trimmed, host);
  // B12-04 (round 12): the host-brand check destroys the correct name whenever
  // an event is named after its own domain — `"International Battery Seminar"`
  // on `internationalbatteryseminar.com` normalises to the DNS label exactly, so
  // the guard fires and the title stage returns nothing, which is the only
  // reason that host's render comes from the snippet at all. This is the mirror
  // image of B12-02: that host defeats the check by having a domain that looks
  // NOTHING like its name, this one by having a domain that IS its name. Neither
  // is fixable by widening the check, which is also why Rulings 33/34a declined
  // that direction twice.
  //
  // The exemption is deliberately here in `isChromeSegment` and NOT in
  // `looksLikeHostBrand`: that function is shared with the job side, where
  // B5-03's job-board-brand fix and B8-02's every-label fix both depend on its
  // current behaviour. Editing it would put the employer field at risk to solve
  // an event-side problem. Scoping it to the event side's own wrapper costs
  // nothing and leaves the job side provably untouched.
  //
  // It defers to `isEventIndexPage` by construction — that check has already
  // returned `true` above if it fires, so a directory site cannot reach here.
  //
  // The exemption can only ever UN-reject. When it does not fire the segment
  // stays chrome and the existing chain runs exactly as today (Ruling 32): slug
  // -> snippet -> honest URL host -> "Untitled event". It adds no fallback and
  // reinserts nothing — the value it admits is the page's own title segment,
  // which no other guard rejected.
  if (isBrand && EVENT_KIND_NOUN_RE.test(trimmed)) return false;
  return isBrand;
}

/**
 * Recognises a segment that reads as a narrative sentence *about* an event
 * rather than the event's own name. B4-01's own repro — a real event whose
 * H1 rendered as "TiRT7 was originally planned for 2020 but was delayed due
 * to the COVID-19 pandemic." — clears isChromeSegment/isGenericPageTitle/
 * EVENT_INDEX_TITLE_RE cleanly, because none of them check whether a segment
 * reads as narration; it isn't a page label, an index, or a calendar view,
 * it is a grammatical sentence.
 *
 * Two independent signals, either is enough to reject:
 *  - a finite "to be" verb immediately before a past participle ("was
 *    planned", "was delayed", "has been postponed") — an event's own NAME is
 *    a noun phrase, not a conjugated claim about itself. This is the check
 *    that actually catches the repro above.
 *  - sentence-terminal punctuation with more text after it (more than one
 *    sentence). Requires a real word (3+ letters) before the punctuation so
 *    an abbreviation like "Dr." or "U.S." mid-title is not mistaken for a
 *    sentence boundary.
 *
 * Deliberately no length ceiling on its own: real event names run long ("The
 * First European Conference on Molten Salt Reactor Chemistry and
 * Technology" is eleven words), so length alone is never treated as proof of
 * narration. A generous word ceiling still applies as a last-resort net for
 * a long run of prose with neither shape above (no conjugated verb, no
 * terminal punctuation at all) — well above any real title's length, so it
 * should essentially never be the reason a real name is rejected.
 */
const NARRATIVE_VERB_RE =
  /\b(?:was|were|is|are|has been|have been|had been|will be)\s+\w+(?:ed|en)\b/i;

/**
 * B5-06/R13 gap 3, the second half. "Abstract submission deadline extended"
 * is narration about the event, exactly the same kind NARRATIVE_VERB_RE
 * already rejects when an auxiliary verb is present ("the deadline WAS
 * extended") — but a real headline routinely drops the auxiliary
 * ("deadline extended," not "deadline was extended"), and that elliptical
 * passive has no conjugated verb for NARRATIVE_VERB_RE to catch. Bounded to
 * a short, closed list of common headline subjects and participles — the
 * same "catch known shapes, not a general parser" approach
 * NARRATIVE_VERB_RE itself already uses — rather than a general
 * subject-verb parser.
 */
const HEADLINE_PASSIVE_RE =
  /\b(?:deadline|registration|abstract|submission|call\s+for\s+(?:papers|abstracts)|date)\b[^.]{0,30}\b(?:extended|postponed|cancell?ed|delayed|announced|updated|moved|rescheduled|confirmed)\b/i;

/**
 * B8-06 (round 8): a present-tense, active-voice sentence NAMING an event
 * ("Ruggiero Group Attends the 2026 Crystal Engineering GRC" — A's own
 * reconfirmed live example, round 6 and round 8 both) has no "to be"
 * auxiliary for NARRATIVE_VERB_RE to catch (it isn't a participle) and
 * matches none of HEADLINE_PASSIVE_RE's closed noun list — simple present
 * tense is a different grammatical shape from both existing checks. Same
 * "catch known shapes, not a general parser" practice as HEADLINE_PASSIVE_RE
 * itself: a small, closed verb list, not "any present-tense verb" (which
 * would risk rejecting a real terse name that happens to contain a common
 * verb-shaped word). Anchored to the START of the segment — a leading
 * subject phrase (1-5 words) immediately followed by one of the verbs — so
 * a long real title that merely contains one of these words well after its
 * own subject is not caught by accident. Verified directly against both the
 * confirmed repro and this file's own existing "must not over-reject"
 * precedents before being written here (see eventweb.test.ts's
 * "present-tense narrative sentence (B8-06)" block).
 *
 * B10-04 (round 10): the subject words were originally required to be
 * `[A-Z]`-led (Title-Case), built and tested against a real page `<h1>`/
 * `<title>`, which is normally Title-Cased. But `nameFromUrlSlug` — one of
 * `eventNameFrom`'s own fallback stages — capitalises only the FIRST
 * character of its entire output, so a slug-derived narrative sentence
 * ("Ruggiero group attends the 2026 crystal engineering GRC") stays
 * lowercase from the second word on. The identical sentence was correctly
 * rejected Title-Cased and wrongly accepted sentence-cased, confirmed live,
 * 2 of 2 pulls, character-for-character. Fix is casing-only: the leading
 * subject words no longer require an uppercase letter (`\w` in place of
 * `[A-Z]`), and the verb alternation drops its manual `[Aa]`-style casing in
 * favour of the `i` flag doing the same job — `nameFromUrlSlug`'s own output
 * casing is untouched, only which casing reaches this check changes.
 */
const PRESENT_NARRATIVE_RE =
  /^\w[\w&.'-]*(?:\s+\w[\w&.'-]*){0,4}\s+(?:attends?|announces?|hosts?|presents?|joins?|visits?)\b/i;

const MULTI_SENTENCE_RE = /\w{3,}[.!?]\s+[A-Z][a-z]/;
const MAX_TITLE_WORDS = 20;

export function looksLikeEventTitle(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (!trimmed) return false;
  if (NARRATIVE_VERB_RE.test(trimmed)) return false;
  if (HEADLINE_PASSIVE_RE.test(trimmed)) return false;
  if (PRESENT_NARRATIVE_RE.test(trimmed)) return false;
  if (MULTI_SENTENCE_RE.test(trimmed)) return false;
  if (trimmed.split(/\s+/).length > MAX_TITLE_WORDS) return false;
  return true;
}

/**
 * A token that can be part of an event's NAME: a capitalised or digit-led word
 * (`Battery`, `ECS`, `2026`, `Battery2030+`) or an ordinal (`250th`).
 */
const NAME_SPAN_TOKEN_RE = /^(?:[A-Z0-9][\w&.'’+-]*|\d+(?:st|nd|rd|th))$/;

/**
 * Closed list of words a real event name may contain in lower case. Anything
 * else ends the span, which is what stops a name running on into the sentence
 * that carries it.
 */
const NAME_SPAN_JOINERS = new Set([
  "of", "for", "on", "and", "the", "in", "at", "de", "du", "des", "und", "&",
]);

const MIN_NAME_SPAN_WORDS = 2;

/**
 * B12-01 (round 12, §1aa Ruling 40): the snippet stage stops returning the
 * SENTENCE and returns the NAME INSIDE it, or nothing.
 *
 * B12-01 established that `ecs.confex.com` did not slip past B11-02's guard —
 * the guard ran and correctly returned "not narration". The snippet stage's
 * *contract* was to hand back a whole sentence, and the suite asserted that
 * nine times, so every fix that only tightened WHICH sentences qualify still
 * left the slot holding a sentence, and a sentence is never a name. That is why
 * this changes what the stage RETURNS. All nine of those assertions are
 * restated to the better value (the name inside the sentence they asserted);
 * none is deleted, per §2.
 *
 * Five steps, every one of them a veto:
 *  1. Walk tokens from the START of the candidate. Anchoring matters and was
 *     verified, not assumed: an unanchored "longest span anywhere" finds
 *     `"Friday, 4 September 2026"` inside the live deadline sentence this item
 *     exists to reject.
 *  2. Drop trailing joiners ("Registration for the" -> "Registration").
 *  3. Require >= 2 words AND an event kind, tested PHRASE-LEVEL over the joined
 *     span against both halves of the closed enumeration. See
 *     `EVENT_KIND_PHRASE_RE` for the list, its two sources, and the failure
 *     direction that makes an open-ended list acceptable at this step.
 *  4. Re-run the shipped `looksLikeEventTitle` on the result — reuse, not a new
 *     parallel check (Ruling 35). That function is UNCHANGED by this item.
 *  5. Anything that fails returns nothing: the candidate is DROPPED, never
 *     substituted. When every candidate is dropped, `eventNameFrom` falls
 *     through to its existing honest URL-host last resort (B9-04 Fix 1). No new
 *     fallback is added and no rejected value is reinserted anywhere — Ruling
 *     32's mandatory question, answered by construction.
 *
 * Deliberately NO leading-determiner strip (Ruling 39a point 4, binding):
 * `"The Battery Show South"` and `"The 250th ECS Meeting"` are perfectly good
 * names with their article left on. The determiner strip belongs only in
 * `recoverFromNarrative` (B12-02), where the article is demonstrably a sentence
 * artefact.
 *
 * ONE HONEST MISS, asserted in the suite rather than hidden:
 * `"Conference Image Gallery Carousel"` survives this — every token is
 * Title-Case and `Conference` is an event kind. That host
 * (`internationalbatteryseminar.com`) has its own cause and its own fix,
 * B12-04; this item does not fix it and does not make it worse.
 */
function leadingNameSpan(candidate: string): string | undefined {
  const span: string[] = [];
  for (const token of candidate.trim().split(/\s+/).filter(Boolean)) {
    if (NAME_SPAN_TOKEN_RE.test(token)) {
      span.push(token);
      continue;
    }
    if (span.length > 0 && NAME_SPAN_JOINERS.has(token.toLocaleLowerCase())) {
      span.push(token);
      continue;
    }
    break;
  }
  while (
    span.length > 0 &&
    NAME_SPAN_JOINERS.has(span[span.length - 1].toLocaleLowerCase())
  ) {
    span.pop();
  }
  if (span.length < MIN_NAME_SPAN_WORDS) return undefined;
  const joined = span.join(" ");
  if (!EVENT_KIND_NOUN_RE.test(joined) && !EVENT_KIND_PHRASE_RE.test(joined)) {
    return undefined;
  }
  if (!looksLikeEventTitle(joined)) return undefined;
  return joined;
}

/** Human-readable event name recovered from a deep event URL's slug. */
function nameFromUrlSlug(url: string): string | undefined {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const slug = path
    .split("/")
    .filter(Boolean)
    .reverse()
    .find((part) => /[a-z]/i.test(part) && part.replace(/[^a-z]/gi, "").length >= 8);
  if (!slug) return undefined;
  // B12-05 (round 12): the slug stage was LAUNDERING a document filename past
  // the guard built to reject it. `DOCUMENT_FILENAME_RE` exists precisely to
  // stop a served document's own filename becoming an event name (B8-06), and
  // it works at the title stage — `bestEventTitleSegment("ECC102026-POSTERS-v2.pdf",
  // url)` correctly returns nothing. Execution then arrives here, where the
  // FIRST act used to be stripping the extension, so the guard could never see
  // one: "a filename, just without the dot and three letters", as round 9's B
  // put it. `euchems2026.eu` rendered `ECC102026 POSTERS v2` this way, and it
  // rotates the document, so the mechanism mints a new wrong name each time.
  //
  // Reuses the two existing extension lists rather than writing a third — a
  // closed list of file extensions, no open class sampled. Note the generic
  // `\.\w{2,5}$` strip below deliberately stays: page extensions (.html, .php,
  // .aspx) are not documents and must still be stripped, not rejected.
  //
  // Ruling 32's question: when this fires, execution continues to the snippet
  // stage and then to B9-04 Fix 1's honest URL host. The suppressed value is
  // the slug's own derivative and nothing rejected is reinserted — the reader
  // sees a bare organiser hostname instead of a filename dressed as a
  // conference name.
  if (DOCUMENT_FILENAME_RE.test(slug) || EMBEDDED_FILENAME_RE.test(slug)) {
    return undefined;
  }
  const words = slug
    .replace(/\.\w{2,5}$/, "")
    .replace(/[-_+]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (words.split(" ").length < 3) return undefined;
  return words.charAt(0).toLocaleUpperCase() + words.slice(1);
}

/**
 * B11-02 (round 11): extracted verbatim from `bestEventTitleSegment`'s own
 * inline block, unchanged in behaviour, because `eventNameFrom`'s snippet
 * stage now needs the identical value to run the identical guards. Two
 * copies of this derivation that must agree for the two stages to guard the
 * same way is exactly the drift this loop has been bitten by before; one
 * function cannot drift from itself. `eventNameFrom`'s final URL-host
 * fallback deliberately does NOT use this helper — it must return an empty
 * hostname verbatim where this helper's callers want a falsy "no host,
 * don't run the brand checks" instead.
 */
function hostFromUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return undefined;
  }
}

/**
 * B12-02 (round 12, §1w Ruling 36's pre-set third strike + §1y Ruling 38's
 * binding addition): `ruggedthz.com` publishes one blog post per event
 * attended, and every such title has the same STRUCTURE —
 * `<narrative sentence naming the event> – <the lab's own brand>`. The brand
 * half always survives the guards (it is a perfectly well-formed organisation
 * name); the naming half is always rejected by PRESENT_NARRATIVE_RE. **The
 * name the reader wants only ever exists inside the rejected half**, which is
 * why widening the host-brand check cannot fix this host even in principle,
 * and why Ruling 36's recorded design lead (recover from the rejected sibling)
 * is the only route.
 *
 * Nothing here is parsed from scratch and no new fallback is created (Ruling
 * 35): the verb is located by the guard that already rejected the segment, the
 * remainder is re-admitted only by the SAME shipped guard pair, and every step
 * is a veto — when any of them fails the function returns undefined and the
 * existing chain continues byte-identically.
 *
 * Corroboration by the page's own URL slug (step 5) and the stand-down when a
 * surviving sibling is corroborated instead (step 6) are the two steps that
 * make this safe. B's first version had neither and was killed by its own
 * counterexample — `"SolarPACES Announces the 2026 Call Deadline – SolarPACES
 * 2026"`, where the correct answer IS the sibling and a naive recovery
 * replaces a real name with a label. Both steps have their own must-survive
 * tests; see the B12-02 block in eventweb.test.ts.
 *
 * Ruling 37's open-class trap was checked deliberately: step 4's two tests are
 * a 4-digit year and this file's existing `looksLikeEvent` vocabulary of event
 * NOUNS. Both are genuinely finite. No verb list is extended here.
 */
const NARRATIVE_DETERMINER_RE = /^(?:the|an?|its|our|their|his|her)\s+/i;

/**
 * The page's own URL path as a set of whole lowercase alphanumeric words.
 * `undefined` when there is no URL (or it is malformed) — which is what makes
 * the recovery impossible to fire on a caller that passes no URL, and is why
 * `eventweb.test.ts`'s existing no-URL Ruggiero assertion is untouched.
 */
function urlPathWords(url: string | undefined): Set<string> | undefined {
  if (!url) return undefined;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return undefined;
  }
  const words = path.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  return words.length > 0 ? new Set(words) : undefined;
}

/** Every alphanumeric word of the candidate appears as a whole word in the path. */
function isSlugCorroborated(
  candidate: string,
  pathWords: Set<string> | undefined,
): boolean {
  if (!pathWords) return false;
  const words = candidate.toLocaleLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  if (words.length === 0) return false;
  return words.every((word) => pathWords.has(word));
}

/**
 * Steps 1-5 of B12-02. Step 6 (the surviving-sibling stand-down) lives in
 * `bestEventTitleSegment`, because that is the only place siblings exist.
 *
 * IMPLEMENTATION NOTE, flagged by B because B hit it: the re-guard on line
 * "guard pair" below must call `isChromeSegment` + `looksLikeEventTitle`
 * DIRECTLY. Calling `bestEventTitleSegment` from here would be infinite
 * recursion, since `bestEventTitleSegment` is this function's own caller.
 */
function recoverFromNarrative(
  segment: string,
  host: string | undefined,
  pathWords: Set<string> | undefined,
): string | undefined {
  if (!pathWords) return undefined;
  const trimmed = segment.trim();
  // 1. Locate the verb with the guard that already found it — the text AFTER
  //    PRESENT_NARRATIVE_RE's own match, nothing parsed from scratch.
  const match = PRESENT_NARRATIVE_RE.exec(trimmed);
  if (!match) return undefined;
  // 2. Strip one leading determiner. It belongs HERE and nowhere else: in this
  //    shape the article is demonstrably a sentence artefact ("Attends THE 2026
  //    Crystal Engineering GRC"), which is not true of a title segment in
  //    general — see B12-01, which deliberately does not strip one.
  const rest = trimmed
    .slice(match[0].length)
    .trim()
    .replace(NARRATIVE_DETERMINER_RE, "")
    .trim();
  if (!rest) return undefined;
  // 3. Re-run the shipped guard pair on the remainder.
  if (isChromeSegment(rest, host) || !looksLikeEventTitle(rest)) return undefined;
  // 4. The remainder must actually look like an event's name, by one of two
  //    closed tests. Blocks "Its Annual Review" and "Berlin And Munich".
  if (!YEAR_RE.test(rest) && !looksLikeEvent(rest)) return undefined;
  // 5. The page's own URL slug must corroborate it.
  if (!isSlugCorroborated(rest, pathWords)) return undefined;
  return rest;
}

/**
 * B12-03 gap A (round 12): the welded page-type label. Every guard in this file
 * only ever operates on a segment the SPLITTER already produced, and the
 * splitter needs a separator surrounded by whitespace
 * (`/\s+[-|·–—]\s+/`). So `"Call for papers - Battery Conference 2027"` splits,
 * the label half is caught by `GENERIC_PAGE_TITLE_RE`, and the real name
 * survives — while `"Call for Abstracts for the Battery 2030+ Annual Conference
 * 2026"` and `"Advanced Battery Power Conference 2026 Call for Papers"` are ONE
 * segment each, are not generic (not every word is a generic word) and are not
 * narration, so they pass every guard and reach the reader with the label welded
 * on. Same defect, two hosts, one cause; established by execution in B12-03.
 *
 * This is the job side's own precedent reused, not a new invention:
 * `stripTrailingCareersChrome` (`jobs/sources/jobweb.ts`, B9-02a) strips a short
 * closed chrome word off an otherwise-accepted candidate in exactly this shape.
 *
 * `\s+for\s+(?:the\s+)?` on the FRONT form is LOAD-BEARING and B found it only by
 * running the design against the existing suite. Without it the front form also
 * eats `"Call for Papers now open for the 2026 Battery Symposium"` down to
 * `"now open for the 2026 Battery Symposium"`, breaking the must-survive
 * assertion B10-03 already put in `eventweb.test.ts`. Requiring the label to be
 * IMMEDIATELY followed by `for (the)` separates the live defect ("Call for
 * Abstracts FOR THE Battery 2030+…") from the protected string ("Call for
 * Papers NOW OPEN…").
 *
 * Every check is a veto and the fallback is "do not modify" — this edits an
 * accepted candidate rather than adding or removing one, so no rejected value
 * can be introduced anywhere (Ruling 32's mandatory question).
 */
const WELDED_LABEL =
  "(?:call\\s+for\\s+(?:papers|abstracts)|cfp|registration|programme|program|agenda|schedule)";
const WELDED_LABEL_FRONT_RE = new RegExp(`^${WELDED_LABEL}\\s+for\\s+(?:the\\s+)?`, "i");
const WELDED_LABEL_BACK_RE = new RegExp(`[\\s:–—-]+${WELDED_LABEL}$`, "i");

/** B12-03 gap A. Returns the segment with a welded label removed, or unchanged. */
function stripWeldedPageTypeLabel(segment: string): string {
  for (const pattern of [WELDED_LABEL_FRONT_RE, WELDED_LABEL_BACK_RE]) {
    if (!pattern.test(segment)) continue;
    const remainder = segment.replace(pattern, "").trim();
    if (!remainder) continue;
    if (!EVENT_KIND_NOUN_RE.test(remainder)) continue;
    if (!looksLikeEventTitle(remainder)) continue;
    return remainder;
  }
  return segment;
}

/**
 * B13-03 (round 13): the BANNER LEAD-IN. `flogen.org` rendered
 * `WELCOME TO SIPS 2026` — a page's greeting banner standing where its event
 * name belongs, for five rounds.
 *
 * WHY THE FIX IS HERE AND NOT WHERE ANYBODY EXPECTED. B established by
 * execution that **no stage ever sees the clean title and no guard eats it**:
 * the page's own `<title>` (`SIPS 2026 by FLOGEN Stars Outreach`) passes every
 * guard untouched, so if any stage had it, it would be the render. It never
 * arrives — the provider hands Peer the page's `og:title`/`<h1>`, and the
 * enrichment path reads JSON-LD `name` and `og:title` and never parses a
 * `<title>` element at all. Both routes end at this same function, which is
 * why one attachment point covers both: the enrichment path also runs its
 * `og:title` through `bestEventTitleSegment`.
 *
 * Two nearer-looking homes were tried and are both structurally unavailable,
 * recorded so they are not re-proposed: B12-01's `leadingNameSpan` DROPS this
 * value to the bare host `flogen.org` rather than repairing it (the span
 * carries no event-kind noun), which is strictly worse than today; and
 * B12-02's sibling recovery cannot fire, because the title has no separator to
 * split on and the slug `sips2026` has none either, so `isSlugCorroborated` is
 * false on this host and always will be.
 *
 * `to` IS MANDATORY AND IT IS LOAD-BEARING. C MUST NOT SIMPLIFY IT TO
 * OPTIONAL. B's first draft made it optional and B's own traps destroyed three
 * of four real event names — `Welcome Reception and Poster Session` →
 * `Reception and Poster Session`, `Welcome Week Careers Fair 2026` → `Week
 * Careers Fair 2026`, `Welcome Home Veterans Summit 2026` → `Home Veterans
 * Summit 2026`. `Welcome` is a perfectly ordinary first word of a real event
 * name; `Welcome to` never is. All four traps are asserted in the suite.
 *
 * Ruling 37's bar, answered directly: the vocabulary is a SINGLE TWO-WORD
 * PHRASE, not a grammatical class. It cannot be "widened without being closed"
 * because there is nothing to widen — `welcome to` either prefixes the string
 * or it does not.
 *
 * Ruling 32's mandatory question, and the answer here is unlike every other
 * item this round: this is a REPAIR, not a selection. Every check below is a
 * VETO and the fallback is `return segment` unchanged. **When it does not
 * fire, the render is byte-identical to today's value. There is no path by
 * which this can produce a bare hostname, `"Untitled event"`, or any
 * placeholder** — nothing is rejected, nothing is dropped, no fallback is
 * reached. That is the same failure-direction property `stripWeldedPageTypeLabel`
 * above claims, and it is why this design is safe in a way a rejection-based
 * one would not be.
 *
 * IMPLEMENTATION NOTE, and it is this file's own recorded lesson: veto 3 is
 * "the remainder must still pass what `bestEventTitleSegment` accepts", and it
 * is written as the guard pair DIRECTLY — `isChromeSegment` +
 * `looksLikeEventTitle` — exactly as `recoverFromNarrative` step 3 does, and
 * for the identical reason recorded there: calling `bestEventTitleSegment`
 * from here would be infinite recursion, since it is this function's own
 * caller. Veto 2 reuses `recoverFromNarrative` step 4's disjunction verbatim
 * rather than re-inventing a corroboration test (Ruling 35).
 */
const BANNER_LEAD_IN_RE = /^welcome\s+to\s+(?:the\s+)?/i;

function stripBannerLeadIn(segment: string, host: string | undefined): string {
  if (!BANNER_LEAD_IN_RE.test(segment)) return segment;
  const remainder = segment.replace(BANNER_LEAD_IN_RE, "").trim();
  // 1. Non-empty.
  if (!remainder) return segment;
  // 2. The remainder must actually look like an event's name, by one of two
  //    closed tests — the same disjunction `recoverFromNarrative` step 4 uses.
  //    This is what leaves `Welcome to Our Site`, `Welcome to the Department of
  //    Chemistry` and `Welcome to FLOGEN` alone: nothing corroborates them.
  if (!YEAR_RE.test(remainder) && !looksLikeEvent(remainder)) return segment;
  // 3. The remainder must still pass the shipped guard pair unchanged.
  if (isChromeSegment(remainder, host) || !looksLikeEventTitle(remainder)) {
    return segment;
  }
  return remainder;
}

/**
 * Phase 3 round 3 C, ITEM 4 (F8, Ruling 120g item 4) — THE APPLICATION-STATUS
 * TAIL. Two live witnesses: `"Battery Young Researcher Award: Applications
 * Open Today!"` and `"2026 SPEC Battery Boot Camp APP is NOW OPEN"` — an
 * otherwise-real event name with a trailing "applications open" announcement
 * clause welded on.
 *
 * NOT CAUGHT BY THIS FILE'S OWN EXISTING, STRUCTURALLY IDENTICAL SIBLING,
 * `HEADLINE_PASSIVE_RE` (deadline/registration/abstract/submission/date +
 * extended/postponed/cancelled/delayed/announced/updated/moved/rescheduled/
 * confirmed): "applications" is not in that subject list and adjectival
 * "open" is not in that participle list. A new, DISJOINT vocabulary sibling,
 * following the identical established convention — not a widening of
 * `HEADLINE_PASSIVE_RE` itself.
 *
 * Manually verified against both live strings (per Phase 3 round 2 B's own
 * design, traced by hand before this item, not run): matches
 * `": Applications Open Today!"` as a trailing clause on witness 1, and
 * `" APP is NOW OPEN"` on witness 2 (case-insensitive covers the literal
 * ALL-CAPS witness). End-anchored, mirroring `WELDED_LABEL_BACK_RE`'s own
 * convention.
 *
 * Vacuity, stated honestly (unchanged from B's own design): only
 * "applications/app + open" is witnessed, 2 of 2 live rows. No sibling
 * ("registration open," "enrollment open") has a live witness this round —
 * named as reasoned-by-analogy, NOT shipped, matching this file's own stated
 * discipline throughout (`EARNINGS_CALL_PAGE_RE`'s own comment: "Every
 * candidate term was measured ALONE and seven were cut for earning nothing
 * on real data").
 *
 * VETO-ONLY, three vetoes, no fourth. B's own design deliberately does not
 * carry `stripBannerLeadIn`'s extra YEAR_RE-or-`looksLikeEvent` corroboration
 * veto (sibling above) or `stripWeldedPageTypeLabel`'s `EVENT_KIND_NOUN_RE`
 * veto: B judged the TRIGGER regex itself narrow enough (a whole closed
 * trailing-clause shape, not a generic short prefix like "welcome to") that
 * the remainder only needs to still pass the shipped guard pair. If the
 * remainder is empty, still fails `isChromeSegment`, or fails
 * `looksLikeEventTitle`, the ORIGINAL segment is returned unchanged — a miss
 * renders exactly as today, and nothing rejected can ever be introduced
 * (Ruling 32's mandatory question).
 */
const APPLICATION_STATUS_TAIL_RE =
  /[\s:]+(?:applications?|app)\s+(?:is\s+|are\s+)?(?:now\s+)?open(?:\s+today)?[!.]*$/i;

function stripApplicationStatusTail(segment: string, host: string | undefined): string {
  if (!APPLICATION_STATUS_TAIL_RE.test(segment)) return segment;
  const remainder = segment.replace(APPLICATION_STATUS_TAIL_RE, "").trim();
  if (!remainder) return segment;
  if (isChromeSegment(remainder, host) || !looksLikeEventTitle(remainder)) {
    return segment;
  }
  return remainder;
}

/**
 * Phase 3 round 3 C, ITEM 5 (F9, Ruling 120g item 5) — THE DRAFT-ANNOTATION
 * TAIL. Live witness: `https://web.cvent.com/event/db0a52d9-68fa-4c07-9bee-
 * f3903554b231/summary` rendered **"Investor Showcase for Battery Storage
 * TEST"** for a real, correctly-linked, currently-open event (real June 2026
 * date, real venue, active registration). Phase 3 round 2 B re-fetched the
 * exact URL live and closed the root cause A had left as "inference, not
 * verification": the page's `og:title` meta tag reads, byte-for-byte,
 * `"Investor Showcase for Battery Storage TEST"` TODAY — the defect
 * reproduces character for character — while the SAME page's plain
 * `<title>` HTML tag (a DIFFERENT field) carries the CORRECT name with no
 * "TEST" anywhere. `pageTitleFromHtml` (`gemini-search.ts`) strictly prefers
 * `og:title` over `<title>` and only falls back when `og:title` is absent —
 * here it IS present, so the stale one wins. **Root cause, confirmed: a
 * live, real, upstream data-quality defect on the event organiser's OWN
 * Cvent page setup** — almost certainly a "social-sharing title" field set
 * during draft setup and never updated, while the page's real, visible
 * title was separately finalised. Structurally the same KIND of defect as
 * J1 (a live upstream field carrying operator-leftover text, not a pipeline
 * bug) but a different SHAPE (a QA/draft annotation word, not a bare
 * placeholder label).
 *
 * Deliberately CASE-SENSITIVE and end-anchored: requires the standalone,
 * all-caps token `TEST` as the segment's own last word, preceded by
 * whitespace. Does not touch the ordinary lowercase/Title-Case English word
 * "test" appearing mid-title in a real name.
 *
 * **EVENT-ONLY PLACEMENT — RULING 120d(2), NOT THE SHARED `gemini-search.ts`
 * LAYER.** B named this as an open placement question (same composed strip
 * chain here, OR the shared upstream layer, since the underlying defect
 * shape — a stale `og:title` social-sharing field — is plausible on a job
 * posting's ATS setup too, unwitnessed this round). The manager ruled: the
 * witness is ONE organiser's live Cvent `og:title` bug; putting the strip in
 * the shared adapter would apply it to the paper and job surfaces on the
 * strength of a single event-surface witness — blast radius without
 * evidence. **NAMED PROMOTION THRESHOLD (record this, do not re-derive it):
 * a witness of the same shape (a stale draft-annotation tail on a
 * provider-supplied title) on a SECOND surface promotes this strip to the
 * shared `gemini-search.ts` seam — no further escalation needed beyond
 * that one additional witness.**
 *
 * Vacuity, stated honestly (unchanged from B's own design): only `TEST` is
 * witnessed, 1 live row. `DRAFT`/`SAMPLE`/`DO NOT USE` are NOT proposed — no
 * witness, named as unwitnessed siblings only.
 *
 * VETO-ONLY, same three-veto shape as `stripApplicationStatusTail`
 * immediately above (empty-after-trim, `isChromeSegment`,
 * `looksLikeEventTitle`) — a miss renders exactly as today, and nothing
 * rejected can ever be introduced (Ruling 32's mandatory question).
 */
const DRAFT_ANNOTATION_TAIL_RE = /\s+TEST\s*$/;

function stripDraftAnnotationTail(segment: string, host: string | undefined): string {
  if (!DRAFT_ANNOTATION_TAIL_RE.test(segment)) return segment;
  const remainder = segment.replace(DRAFT_ANNOTATION_TAIL_RE, "").trim();
  if (!remainder) return segment;
  if (isChromeSegment(remainder, host) || !looksLikeEventTitle(remainder)) {
    return segment;
  }
  return remainder;
}

/**
 * A23-02 gap (a) / Ruling 62b — THE LISTING-FURNITURE STRIP.
 *
 * `10times.com` rendered the event name as
 * `Solid-State Battery Summit (Aug 2026), Chicago USA` — a listing aggregator's
 * row, with the date and the city welded on where the NAME belongs. The `|
 * 10times` host chrome is already stripped correctly; the furniture INSIDE the
 * chosen segment is what no split reaches, because it is not on a separator.
 *
 * This is the THIRD strip on the chosen segment, composing with
 * `stripWeldedPageTypeLabel` and `stripBannerLeadIn` exactly as B13-03 composed
 * with B12-03 — three disjoint vocabularies, none able to undo another.
 *
 * Two END-ANCHORED shapes, and the boundaries are what keep them honest:
 *  - a trailing parenthetical whose whole content is month/year/day/punctuation
 *    tokens. NEVER one carrying WORDS: `(Hybrid)`, `(Virtual)`, `(ICMS 2026)`
 *    and `(Formerly Battery Show Asia)` are part of the name.
 *  - a trailing `, <place> <COUNTRY>` tail. THE COMMA IS REQUIRED, which is what
 *    leaves `Battery Show Detroit` and `Oslo Battery Days Conference` alone —
 *    there the city IS the name's distinguishing content.
 *
 * Never leading or mid-string: `EUCHEMS (Molten Salts) 2026` is a name. And if
 * a strip would empty the segment or leave something that no longer reads as an
 * event, the ORIGINAL is kept — a wrong name is bad, an empty one is worse.
 *
 * The month-year it removes is not thrown away: it is handed to the date field
 * as a MONTH-GRANULARITY value (Ruling 62b's approved partial), so the card
 * stops contradicting itself by showing a date in a name it also calls undated.
 * A parenthetical carrying ONLY a year strips but yields NO date —
 * **never a year-only fallback**, which would invent a January instant.
 */
const TRAILING_PARENTHETICAL_RE = /\s*\(([^()]{1,48})\)\s*$/;
const TRAILING_PLACE_TAIL_RE = /\s*,\s*([^,()]{2,48}?)\s*$/;

/**
 * Country tokens a listing tail may end on. `COUNTRY_NAMES` carries the formal
 * names; these are the postal abbreviations it does not. VACUITY, stated: only
 * `USA` is earned by the live row (`…, Chicago USA`); the other three are the
 * same closed class and cost nothing, because a missing token means no strip,
 * which is today's name.
 */
const COUNTRY_ABBREVIATIONS = ["USA", "U.S.A.", "UK", "U.K."];

const MONTH_TOKEN_RE =
  /^(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)(?:uary|ruary|ch|il|e|y|ust|tember|ober|ember)?$/i;

const MONTH_INDEX: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * True only when every token is a month name, a year, a day number or bare
 * punctuation — the test that separates `(Aug 11-12, 2026)` from `(ICMS 2026)`.
 * Returns the month-granularity date when a month AND a year are both present,
 * and `null` for a date-shaped parenthetical that names no month.
 */
function readDateOnlyParenthetical(content: string): { monthYear: string | null } | undefined {
  const tokens = content.split(/[\s,\-–—/.]+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  let month: number | undefined;
  let year: number | undefined;
  for (const token of tokens) {
    if (MONTH_TOKEN_RE.test(token)) {
      month ??= MONTH_INDEX[token.slice(0, 3).toLowerCase()];
      continue;
    }
    if (/^\d{4}$/.test(token)) {
      year ??= Number(token);
      continue;
    }
    if (/^\d{1,2}(?:st|nd|rd|th)?$/i.test(token)) continue;
    // Anything else is a WORD, so the parenthetical is part of the name.
    return undefined;
  }
  if (!year && !month) return undefined;
  return {
    monthYear:
      month && year ? `${year}-${String(month).padStart(2, "0")}` : null,
  };
}

function endsInCountry(tail: string): boolean {
  const trimmed = tail.trim();
  if (COUNTRY_ABBREVIATIONS.some((abbr) => trimmed.toUpperCase().endsWith(abbr))) {
    return true;
  }
  const lower = trimmed.toLowerCase();
  return COUNTRY_NAMES.some((name) => lower.endsWith(` ${name.toLowerCase()}`));
}

function stripListingFurniture(
  segment: string,
  host: string | undefined,
): { segment: string; monthYear?: string } {
  let current = segment;
  let monthYear: string | undefined;

  const keeps = (remainder: string) =>
    Boolean(remainder) &&
    !isChromeSegment(remainder, host) &&
    looksLikeEventTitle(remainder) &&
    (YEAR_RE.test(remainder) || looksLikeEvent(remainder));

  const placeMatch = current.match(TRAILING_PLACE_TAIL_RE);
  if (placeMatch && endsInCountry(placeMatch[1])) {
    const remainder = current.slice(0, placeMatch.index).trim();
    if (keeps(remainder)) current = remainder;
  }

  const parenMatch = current.match(TRAILING_PARENTHETICAL_RE);
  if (parenMatch) {
    const read = readDateOnlyParenthetical(parenMatch[1]);
    if (read) {
      const remainder = current.slice(0, parenMatch.index).trim();
      if (keeps(remainder)) {
        current = remainder;
        monthYear = read.monthYear ?? undefined;
      }
    }
  }

  return { segment: current, monthYear };
}

export function bestEventTitleSegmentDetailed(
  title: string,
  url?: string,
  options?: ChromeSegmentOptions,
): { segment: string; monthYear?: string } | undefined {
  const selected = selectEventTitleSegment(title, url, options);
  if (!selected) return undefined;
  return stripListingFurniture(selected, hostFromUrl(url));
}

/**
 * The name every existing caller already asks for. Unchanged in shape; it now
 * carries A23-02's furniture strip, and `…Detailed` above is the same work with
 * the removed month-year kept rather than discarded.
 */
export function bestEventTitleSegment(
  title: string,
  url?: string,
  options?: ChromeSegmentOptions,
): string | undefined {
  return bestEventTitleSegmentDetailed(title, url, options)?.segment;
}

/**
 * B5-06/R13 gap 3, the first half. The split only ever recognised a pipe,
 * middle dot, en dash or em dash — a plain ASCII hyphen ("Deadline
 * extended - SiteName") was never a recognised separator at all, so a title
 * using one stayed a single, unsplit segment no matter what else the name
 * picker did to it.
 *
 * A24-01 (round 24 C). EXTRACTED from `selectEventTitleSegment`, unchanged, so
 * `isEventIndexResult` below can reuse the SHIPPED splitter rather than
 * hand-roll a second one that drifts. Two callers, one definition.
 *
 * KNOWN LIMIT, recorded by round 24 B so no future round "fixes" it: a pipe
 * with NO surrounding spaces does not split, so
 * "Upcoming Conferences|Cambridge EnerTech" stays one segment and escapes.
 * Unwitnessed across 150 offered rows, and widening the separator would change
 * name selection everywhere this runs, for no measured gain.
 */
function titleSegments(title: string): string[] {
  return title
    .split(/\s+[-|·–—]\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/**
 * A29-05 (round 29 C, item 4). **COUNT THE TRAIL. DO NOT MATCH THE SEPARATOR.**
 *
 * `ans.org` returned the title `Molten Salt Fuel Chemistry -- ANS / Conferences
 * / 2026 ANS Annual Conference / Technical Sessions` and Peer rendered **the
 * whole string** as the event's name: a navigation menu in the name slot, which
 * is the least defensible thing that slot can hold. `--` and ` / ` are not in
 * `titleSegments`' separator set, so no head was ever taken.
 *
 * **A's IMPLIED FIX — "add `--` and ` / ` to the separators" — IS REFUTED BY
 * MEASUREMENT, AND ROUND 29 B DID THE MEASURING. It truncates 3 of 5 real event
 * names:** `Gordon Research Conference / Batteries` loses its subject,
 * `Electrochemistry -- Fundamentals and Applications Symposium` loses the kind
 * word with it, and `R&D / Innovation Summit 2026` renders the two-character
 * name `R&D`. **A separator rule cannot tell a trail from a name, because ONE
 * separator is not a trail — it is ordinary punctuation.**
 *
 * **A breadcrumb is a PATH, so it has THREE OR MORE chrome separators. A name
 * has nought or one.** B measured **0 of 8 wrong** on that threshold: both
 * trails cut correctly, all six real names byte-identical.
 *
 * **THE SEPARATORS MUST BE SPACE-DELIMITED.** `AI/ML for Energy Storage
 * Workshop 2026` has no spaces round its slash and must never count — measured,
 * and it is the reason the naive rule spared that one row.
 *
 * **≥ 3, NOT ≥ 2.** Two is reachable by an ordinary subtitled name
 * (`Conference / Workshop / 2026` is a real risk at 2). B set the threshold
 * where the measured corpus separates and **stated plainly that 2 is untested
 * rather than that it is safe.** C keeps it at 3 for that reason.
 *
 * **ABSENT TITLE ⇒ nothing to split; the rule cannot fire. No invention.**
 */
const TRAIL_SEPARATOR_RE = /\s(?:\/|--)\s/g;
const TRAIL_MIN_SEPARATORS = 3;

function breadcrumbTrailHead(title: string): string | undefined {
  const separators = title.match(TRAIL_SEPARATOR_RE);
  if (!separators || separators.length < TRAIL_MIN_SEPARATORS) return undefined;
  const head = title.split(TRAIL_SEPARATOR_RE)[0]?.trim();
  return head || undefined;
}

function selectEventTitleSegment(
  title: string,
  url?: string,
  options?: ChromeSegmentOptions,
): string | undefined {
  // A29-05: the trail is cut FIRST, and then the head is handed to the whole
  // existing pipeline rather than returned straight to a reader.
  //
  // **THIS IS B's OWN RESIDUAL, ANSWERED RATHER THAN INHERITED.** B observed
  // that `Home / Events / 2026 / Battery Summit` is correctly identified as a
  // trail and yields the head `Home`, which is a WORTHLESS name — "a trail
  // whose head is chrome should render honest silence rather than `Home`" —
  // and asked C to pair the rule with the existing name-quality path. Passing
  // the head through `isChromeSegment` / `looksLikeEventTitle` below IS that
  // pairing: a chrome head leaves nothing informative, this function returns
  // undefined, and `eventNameFrom` falls through to the slug and snippet
  // stages exactly as it does for any all-chrome title. **Nothing new is
  // invented and `Home` never reaches a card.**
  const trailHead = breadcrumbTrailHead(title);
  const segments = titleSegments(trailHead ?? title);

  // B5-06/R13 gap 2. host is undefined when eventNameFrom is called without
  // a URL (some tests, and any future caller that doesn't have one) — the
  // brand checks inside isChromeSegment simply don't run in that case.
  const host = hostFromUrl(url);

  const informative = segments.filter(
    (part) => !isChromeSegment(part, host, options) && looksLikeEventTitle(part),
  );

  // B12-02, attachment point 1 of 2 (ruggedthz.com failure mode 1: the
  // provider returns the real page <title>). Step 6 — the recovery runs ONLY
  // when no surviving sibling is itself corroborated by the same slug. When
  // one is, that sibling IS the event ("SolarPACES 2026" on a
  // /solarpaces-announces-… path) and the selection below runs untouched.
  const pathWords = urlPathWords(url);
  if (pathWords && !informative.some((part) => isSlugCorroborated(part, pathWords))) {
    for (const part of segments) {
      const recovered = recoverFromNarrative(part, host, pathWords);
      if (recovered) return recovered;
    }
  }

  if (informative.length > 0) {
    // Prefer a segment that actually reads as an event, else the longest one:
    // site chrome is normally shorter than the event name.
    const eventLike = informative.filter((part) => looksLikeEvent(part));
    const pool = eventLike.length > 0 ? eventLike : informative;
    // B12-03 gap A: strip a welded page-type label off the CHOSEN segment.
    // Deliberately last, after selection: the label is part of why a segment
    // wins the longest-wins tie-break, so stripping earlier would change which
    // segment is picked, which is not what this fix is for.
    // B13-03: strip a banner lead-in off the CHOSEN segment, after the welded
    // label. Same place and same "edit an accepted candidate" shape as
    // B12-03's strip above; the two vocabularies are disjoint, so composing
    // them is strictly better than either alone and neither can undo the
    // other. This one attachment point also covers the enrichment route,
    // which runs its own `og:title` back through this function.
    // Phase 3 round 3 C, ITEM 4 (F8): strip an application-status tail off
    // the CHOSEN segment last, after the banner lead-in — same "edit an
    // accepted candidate" shape, a third disjoint vocabulary that cannot
    // undo either of the other two (this file's own A23-02 "three-plus
    // disjoint vocabularies" convention).
    // Phase 3 round 3 C, ITEM 5 (F9): strip a draft-annotation tail off the
    // CHOSEN segment last of all, after the application-status tail — a
    // fourth disjoint vocabulary, same "edit an accepted candidate" shape,
    // event-only placement per Ruling 120d(2) (see the doc comment above
    // `stripDraftAnnotationTail` for the named promotion threshold).
    return stripDraftAnnotationTail(
      stripApplicationStatusTail(
        stripBannerLeadIn(
          stripWeldedPageTypeLabel(
            pool.reduce((best, part) => (part.length > best.length ? part : best)),
          ),
          host,
        ),
        host,
      ),
      host,
    );
  }

  return undefined;
}

export function eventNameFrom(
  title: string,
  snippet: string,
  url?: string,
): string {
  const titleSegment = bestEventTitleSegment(title, url);
  if (titleSegment) return titleSegment;

  // Every title segment is chrome. A deep event URL's slug is the most
  // reliable remaining source of the actual event name — try it before the
  // snippet, whose longest sentence is often prose ("Networking: An opening
  // get-together...") rather than a name.
  const fromSlug = url ? nameFromUrlSlug(url) : undefined;
  if (fromSlug) {
    if (bestEventTitleSegment(fromSlug, url) === fromSlug) {
      return fromSlug;
    }
    // B12-02, attachment point 2 of 2 (ruggedthz.com failure mode 2, which A
    // caught on its fifth pull: the SAME page, but the provider returned a
    // chrome-only title that minute, so the title stage yields nothing and the
    // slug re-guard correctly rejects the slug's own narrative sentence —
    // B10-04's casing fix working as designed). Without this the snippet stage
    // below supplies a mid-sentence prose fragment. One host, two confirmed
    // failure modes, so one design has to attach at two points.
    //
    // There are no siblings here, so step 6 is vacuous by construction.
    // Capitalisation follows `nameFromUrlSlug`'s own documented convention
    // (first character only) because the recovery returns a substring of that
    // function's output; cosmetic, not load-bearing.
    const recovered = recoverFromNarrative(
      fromSlug,
      hostFromUrl(url),
      urlPathWords(url),
    );
    if (recovered) {
      return recovered.charAt(0).toLocaleUpperCase() + recovered.slice(1);
    }
  }

  // Otherwise mine the snippet for its most informative event-like phrase.
  //
  // B11-02 (round 11, Rulings 32/35): this stage used to filter candidates
  // with `looksLikeEvent` ALONE — a topicality check (does this text mention
  // a conference/keynote/symposium at all?) already used upstream to decide
  // whether a web result is about an event, with no concept of sentence
  // shape, narration, or scraped markup. It is not a name-quality check and
  // was never meant to be one. The title-segment stage above has had every
  // guard this loop built since round 4 (`isChromeSegment` +
  // `looksLikeEventTitle`); this stage had none of them, so a full narrative
  // sentence containing one topic keyword sailed through here after being
  // correctly rejected one stage earlier. Live-confirmed on ecs.confex.com,
  // which rendered "Invited speakers present keynote lectures." as an event
  // name: `looksLikeEvent` passes it ("keynote"), `looksLikeEventTitle`
  // rejects it, and only the first check ran. Reuse of the existing pair,
  // not a new parallel check — B11-01's enumeration confirmed the URL-slug
  // stage above is already re-guarded by this same pair, so this makes the
  // snippet stage the last one to get them rather than inventing anything.
  //
  // Applying them to `nameLike` FIRST, ahead of the `looksLikeEvent`
  // preference tier, also closes B11-01's enumeration shape 4 for free: the
  // `eventLike.length > 0 ? ... : ...` ternary now falls back to the
  // hard-filtered `nameLike`, never to raw `substantial`, so a snippet in
  // which nothing scores as event-like can no longer discard the guard's
  // verdict wholesale and hand back its longest unfiltered fragment. When
  // every candidate is rejected, execution falls through to the honest URL-
  // host last resort below (B9-04 Fix 1), which already exists — per Ruling
  // 35, no new fallback needed designing.
  const host = hostFromUrl(url);
  const substantial = snippet
    .split(/(?<=[.!?])\s+|\s+[|·–—]\s+|\n/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 20 && part.length <= 120);
  //
  // B12-01 (round 12, §1aa Ruling 40): B11-02's hard pre-filter above is
  // UNTOUCHED and still runs first; `leadingNameSpan` is chained onto its
  // output, so a fragment must clear every guard this loop has built AND then
  // yield a name span. It can only ever narrow a candidate to its own leading
  // name or drop it — it never introduces a string the pre-filter did not
  // already accept.
  const nameLike = substantial
    .filter((part) => !isChromeSegment(part, host) && looksLikeEventTitle(part))
    .map((part) => leadingNameSpan(part))
    .filter((part): part is string => part !== undefined);
  const eventLike = nameLike.filter((part) => looksLikeEvent(part));
  const pool = eventLike.length > 0 ? eventLike : nameLike;
  if (pool.length > 0) {
    return pool.reduce((best, part) => (part.length > best.length ? part : best));
  }

  // B9-04 Fix 1 (round 9, Ruling 32): every title segment was already
  // rejected by bestEventTitleSegment above -- that rejection is the only
  // way execution reaches this line -- so re-splitting the title and
  // returning segments[0] here would hand back one of those exact rejected
  // strings, verbatim (confirmed live: "Conference Program" in, "Conference
  // Program" out). The URL host is never itself a value a guard rejected,
  // and mirrors this codebase's own honest-placeholder precedent on the job
  // side ("See posting", jobs/mapper.ts). Falls back to a literal
  // placeholder only when there is no URL to read a host from at all.
  if (url) {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      // Malformed url - fall through to the placeholder below.
    }
  }
  return "Untitled event";
}

// ROUND 33 C, ITEM 1 (Ruling 89b/90a, mirror of A31-01 / Round 32 C's
// job-side trio, Ruling 87a): the EVENT pipeline had no guard for
// JOB-CONTENT vocabulary at all. Witnessed live, round 32 A:
// industrialguide.co.in's "Ion Exchange Mumbai Job Openings Check here" --
// a job-listings roundup blog post, not an event -- admitted and rendered
// as an event card. NONE of the six existing title/URL kind guards
// (isEventIndexResult, isEventHubResult, isNewsArticleTitle,
// isPaperPageTitle, isEventArtefactTitle, isEarningsCallPage) carry any
// job/vacancy vocabulary, so a kind miss here fell to ADMISSION -- this
// file's own documented doctrine (Ruling 32).
//
// ROUND 33 B's OWN LIVE TRACE (5 fresh pulls) found the class is not a
// single specimen -- three more live rows that window carried the exact
// same defect (jobitus.com, shine.com, iimjobs.com), widening the
// must-catch corpus from one witness to four -- see the round log.
//
// THE SIGNAL IS TITLE VOCABULARY, NOT PATH SHAPE -- measured and
// rejected, see the round log: two of the three fresh witnesses carry no
// date-structured path at all, so a path clause would miss them.
//
// ROUND 34 C (Ruling 92b/93, A33-01): a fifth job-content shape falls through
// all seven guards -- a company's own job-postings ARCHIVE/INDEX page ("Job
// Postings Archive - Ion Exchange" @ ionexchangeglobal.com/job_posting/,
// witnessed 2 of 5 pulls, round 33 A). Round 33's own two triggers both miss
// it: hasRepeatedJobsMention needs "job"/"jobs" stated TWICE, this title
// states it once ("Job Postings"); the phrase list above has no "job
// postings" phrase at all. isEventHubResult also misses it -- its path word
// list has "jobs" but not the singular, underscored "job_posting" terminal
// segment (measured and rejected as the fix site, see the round log:
// extending the path list alone does not catch this specimen, because
// isEventHubResult ALSO requires the title head to match its own separate
// tail/head vocabulary, which "Job Postings Archive" does not; the
// coordinated second change that WOULD catch it was measured and found to
// introduce new collateral on a real single-event "Event Archive" title, an
// older and far more broadly shared guard than this one).
//
// BARE "job postings" was measured and REJECTED: "Job Postings Fair 2026"
// contains the phrase but is not rescued by looksLikeEvent (EVENT_SIGNAL_RE's
// "job fair" alternative requires the words adjacent; "Postings" sits
// between them here), so a bare trigger would wrongly drop a real fair --
// the fair title the safety net cannot structurally rescue. Requiring an
// index/archive-shaped TAIL word alongside "job postings" or "job listings"
// -- the same shape the specimen itself carries, and the same shape
// round-25's own EVENT_INDEX_TITLE_RE already recognises for the EVENT noun
// ("archive" is one of that regex's own tail words) -- closes exactly the
// witnessed gap without re-opening the fair false-positive.
const JOB_LISTING_CONTENT_RE =
  /\bjob\s+openings?\b|\bjob\s+vacanc(?:y|ies)\b|\bvacanc(?:y|ies)\b|\bcompany\s+page\b|\bjob\s+(?:postings?|listings?)\s+(?:archive|board|directory)\b/i;

// A second, independent trigger: the word "job"/"jobs" stated twice or
// more in one title is the SEO-keyword-stuffed shape a job-board's own
// listing title commonly takes ("X Jobs, Jobs for X - SiteName"). Zero
// collisions with any must-keep title tested (none mentions "job" more
// than once, most mention it zero times) -- see the round log's corpus
// table.
function hasRepeatedJobsMention(title: string): boolean {
  const matches = title.match(/\bjobs?\b/gi) ?? [];
  return matches.length >= 2;
}

// The safety net: a suspicious title cannot drop a row that ALSO states
// the event kind's own vocabulary -- the same shape Round 32 C's
// Components B/C already established as this loop's precedent
// (jobweb.ts:107,1576). Reuses the file's OWN existing front-door check
// (looksLikeEvent, EVENT_SIGNAL_RE, :189-191) rather than a new word
// list, so every "Career Fair"/"Job Fair"/"Career Expo" must-keep is
// protected for free.
export function isJobListingContentTitle(title: string): boolean {
  if (!JOB_LISTING_CONTENT_RE.test(title) && !hasRepeatedJobsMention(title)) {
    return false;
  }
  return !looksLikeEvent(title);
}

// Phase 3 round 3 C, ITEM 2 (F2, Ruling 120g item 2): a path-structure signal
// for date-stamped publishing paths (`/YYYY/MM/DD/…`), PORTED STRUCTURALLY
// from the job surface's own already-shipped, already-measured
// `isDateStructuredResearchPath` (`jobweb.ts:100-108`) — a lab or research
// institute's own dated news/blog post, not an event. This surface had no
// equivalent at all before this item (Ruling 118's own witness table already
// named the gap: "the JOB surface already refuses this exact host class...
// The event surface has no equivalent").
//
// Phase 3 round 2 B verified by execution that both named witnesses'
// paths (`/2025/07/11/...`, `/2025/04/27/...`, foundry.lbl.gov) match this
// regex exactly, and both titles independently fail `looksLikeEvent`, so a
// ported guard fires on both. Blast radius grepped before shipping: zero
// `eventweb.test.ts` fixtures carry this path shape, and zero of A's 6
// sampled correct-event control URLs do either.
//
// THE TITLE HALF IS NOT NEW INVENTION EITHER — same precedent this file
// already used for `isJobListingContentTitle` immediately above
// (round 32 C, jobweb.ts:107,1576): `looksLikeEvent(title)` is this file's
// own existing front-door kind-signal, reused here as the exact event-side
// mirror of the job side's `!JOB_TEXT_RE.test(title)` safety net. A
// suspicious URL shape cannot drop a title that itself states real event
// vocabulary — a real event genuinely announced via a dated-blog-shaped URL
// survives unchanged, exactly as the job side's own precedent already
// protects its equivalent must-keep case.
//
// PLACEMENT: a new, event-surface-OWNED copy of the pattern, not a
// cross-file import. `DATE_STRUCTURED_PATH_RE`/`isDateStructuredResearchPath`
// are module-private in `jobweb.ts` (no `export` keyword), and this file's
// own convention is parallel-but-separate guards per surface (`DENY_PATH_RE`/
// `COMMERCE_PATH_RE` vs `NON_JOB_PATH_RE`, `PAPER_PAGE_HOSTS` event-only)
// rather than cross-importing between the job and event source files. B
// named sharing via an export as a valid alternative without deciding
// between them; this follows B's own stated convention-matching default —
// the option B actually wrote up as the design, not merely named alongside it.
const DATE_STRUCTURED_PATH_RE = /^\/\d{4}\/\d{2}\/\d{2}\//;
function isDateStructuredResearchPath(title: string, url: string): boolean {
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  if (!DATE_STRUCTURED_PATH_RE.test(path)) return false;
  return !looksLikeEvent(title); // event-side mirror of the job side's own title safety net (jobweb.ts:107)
}

/**
 * Phase 3 round 6 C, ITEM 5 (F12, Rulings 123f/123e(2)/123g item 5). A
 * discussion-forum website admitted as an event via the bare "forum" word in
 * `EVENT_SIGNAL_RE` — the same mechanism round 1's F3 named, a second live
 * witness on a new host (`permies.com`). Disposition 6's own reopen
 * threshold fired on a second, distinct forum-platform host (Phase 3 round 5
 * B, IF-BUDGET-REMAINS ITEMS); investigated rather than reopened blind, and
 * the new witness's URL (`/t/26737/composting/...`) carries a NUMERIC
 * thread ID after `/t/` — a structurally different, narrower shape than
 * F3's original non-numeric witness (`/t/lithium`), which stays
 * dispositioned, UNCHANGED, and is NOT reopened or re-argued here.
 *
 * PORTED FROM THE JOB SURFACE'S OWN ALREADY-SAFE, ALREADY-SHIPPED
 * `FORUM_THREAD_URL_RE` (`jobweb.ts:368-369`) — an event-surface-OWNED copy,
 * not a cross-file import, mirroring `isDateStructuredResearchPath`'s own
 * precedent immediately above (this file's parallel-but-separate-guards-
 * per-surface convention). Byte-identical regex, tested against the same
 * `pathname + search` shape the job surface's own `pathAndQuery` uses.
 * Confirmed by direct execution: still correctly misses F3's own
 * non-numeric witness (`/t/lithium`) while catching `permies.com`'s
 * numeric-thread-ID witness — see eventweb.test.ts.
 *
 * OWN GUARD, NOT AN `isDeniedUrl` CLAUSE (Ruling 123e(2)) — kept traceable
 * to the shape it was borrowed from, the same reasoning that keeps
 * `NEWS_MEDIA_HOSTS` (ITEM 1) its own sibling list rather than folded into
 * `DENY_HOSTS`. No title safety net, unlike `isDateStructuredResearchPath`
 * above — the job surface's own `FORUM_THREAD_URL_RE` clause inside
 * `isListingPage` is unconditional on the URL shape alone, and this port
 * mirrors that exactly rather than inventing a rescue the precedent does
 * not have.
 */
const FORUM_THREAD_URL_RE =
  /(?:^|\/)t\/(?:[\w%.~-]+\/)?\d+(?:\/\d+)?(?:\/|$|\?)|(?:^|\/)(?:viewtopic|showthread|viewforum|forumdisplay)\.php(?:$|[?&])|(?:^|\/)threads\/[\w%.~-]*?\.\d+(?:\/|$|\?)/i;

function isForumThreadUrl(url: string | undefined): boolean {
  if (!url) return false;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  return FORUM_THREAD_URL_RE.test(`${parsed.pathname}${parsed.search}`);
}

export function webResultToRawEventItem(
  result: WebResult,
  now: number,
): RawEventItem | null {
  const title = result.title?.trim();
  const url = result.url?.trim();
  if (!title || !url) return null;
  if (isDeniedUrl(url)) return null;
  // A24-01: the first title segment is a second derived input here — see
  // isEventIndexResult. This check is 4 of 6 and runs BEFORE any date logic or
  // place extraction, so an index page leaves by KIND and never reaches the
  // place guard at all.
  if (isEventIndexResult(title)) return null;
  // A27-01: the same question the index check asks, but with the URL as a
  // second input — see isEventHubResult. A separate predicate, so
  // isEventIndexResult's own contract stays byte-unchanged.
  if (isEventHubResult(title, url)) return null;
  // B12-03 gap B: the URL is now a second input — see isNewsArticleTitle.
  if (isNewsArticleTitle(title, url)) return null;
  if (isPaperPageTitle(title)) return null;
  // A29-07 (round 29 C, item 1c): the artefact produced AT the event is not the
  // event. Sits here, beside its sibling title-side kind predicates, because
  // that is the layer where every other kind guard already lives — and because
  // B's item 7 §7.2 proved the decisive page-declared signal cannot reach this
  // chain at all without the contract change this same item makes.
  if (isEventArtefactTitle(title)) return null;
  // B18-01: a company's earnings call is not a scholarly event.
  if (isEarningsCallPage(title, url)) return null;
  // ROUND 33 C, ITEM 1 (Ruling 89b/90a): a job-listings/vacancy content
  // page is not a scholarly event -- see isJobListingContentTitle above.
  if (isJobListingContentTitle(title)) return null;
  // Phase 3 round 3 C, ITEM 2 (F2, Ruling 120g item 2): a lab/research
  // institute's own dated blog post is not an event -- see
  // isDateStructuredResearchPath above. Same layer as the other title/URL
  // kind guards immediately above it; the job surface's own mirror sits in
  // the identical position, right before its own topicality gate.
  if (isDateStructuredResearchPath(title, url)) return null;
  // Phase 3 round 6 C, ITEM 5 (F12, Ruling 123e(2)): a numeric-thread-ID
  // discussion-forum URL is not an event -- see isForumThreadUrl above.
  // Same layer as the other URL-shape kind guards immediately above it.
  if (isForumThreadUrl(url)) return null;
  const text = `${title} ${result.snippet ?? ""}`;
  // ROUND 29 C, ITEM 1 — **ABSENCE IS NOT EVIDENCE (family (ii)), AND THE
  // PAGE'S OWN DECLARATION OUTRANKS A KEYWORD (channel L).**
  //
  // A29-01: 251 of round 29 A's 716 offered rows carry an EMPTY snippet, and
  // 109 event rows were refused here while carrying one. The refusal was being
  // read off text the row never had. `looksLikeEvent` is a KIND test, and the
  // loop's doctrine puts a kind miss on the ADMISSION side, so a starved arm
  // must ABSTAIN — neither admit nor refuse — and let the guards with evidence
  // decide.
  //
  // **"ABSENT" MEANS EMPTY AFTER TRIM. NEVER "SHORT".** The median snippet is
  // 111 characters; a short description is PRESENT and is tested exactly as it
  // was. Two clauses, two separate reasons not to refuse:
  //
  //   1. `snippetAbsent` — the text arm has no snippet to read. **THE TITLE
  //      STILL VOTES**: a title naming the kind admits through `looksLikeEvent`
  //      exactly as it does today, and this clause only stops the *refusal* of
  //      a row whose evidence was never supplied.
  //   2. `pageKind === "event"` — channel L. The publisher declared the page an
  //      Event in its own markup. Zero adversarial cost measured (B §1.4).
  //
  // **RULING 62b IS UNTOUCHED AND THAT IS DELIBERATE.** `text` is byte-for-byte
  // what it was; neither clause adds a character to it. `extractEventDate` and
  // `extractDeadline` below therefore read exactly the same string they always
  // did, so **no furniture date can reach them** — which is precisely why B
  // measured the rival "append page text to the snippet" family HARMFUL and
  // refused it (§1.2: it manufactures date evidence, and it is non-monotone).
  // `pageSnippetFromHtml` stays byte-for-byte as shipped.
  //
  // A row that abstains here falls through to the DATELESS BRANCH, which
  // carries its own "every year token is past ⇒ drop" rule — so a stale row
  // still leaves. Round 28 B's design always claimed the dateless branch was
  // unaffected by an empty snippet; that claim was true only because the branch
  // was never REACHED. This makes it true as written (see §1.5's amendment).
  //
  // **NAMED COST, RULING 79a — `The Battery Saloon` @ `batteryinnovationsummit.com/`
  // IS NOT RESCUED AND IS NOT MEANT TO BE.** It publishes a 157-character
  // description with no kind word, no `og:site_name`, NO JSON-LD, and
  // `extractPageText` returns 0 characters (a JavaScript shell). Clause 1
  // cannot fire — its snippet is PRESENT. Clause 2 cannot fire — there is no
  // declaration to read. The only measured rescue was channel H-prime (the
  // registrable host names the kind at a bare root), and 79a REFUSED it: it
  // admits 2 of 9 adversarial rows, which is the wrong-admission direction this
  // loop spent rounds eradicating. **The row is a recorded, accepted cost of
  // the Ruling 75 provider switch. Do not rescue it here.** Re-examine only if
  // the host ever publishes structured event data channel L can read.
  const snippetAbsent = (result.snippet ?? "").trim() === "";
  const pageDeclaresEvent = result.pageKind === "event";
  if (!looksLikeEvent(text) && !snippetAbsent && !pageDeclaresEvent) return null;
  // A22-01 (round 22 C, Ruling 59a draft 3): position may decide the date only
  // when the text offers ONE reading of it. Two or more readings and the
  // snippet is ambiguous, so the item must prove which one is its own — its
  // title standing as a line, with the date inside that heading's span. No
  // witness, no date. B's measured matrix over all 50 ingestion-kept rows of a
  // live pull: 44 unchanged, 4 dates lost (none of them in the pool), 2 moved,
  // 0 invented.
  //
  // The `candidates.length === 0` arm is the counter's own safety net: if the
  // counter ever disagrees with the extractor it guards, the row falls through
  // to today's behaviour instead of losing a date to a bookkeeping mismatch.
  const firstReading = extractEventDate(text);
  const deadline = extractDeadline(text);
  // A DEADLINE TOKEN IS NOT A RIVAL READING OF THE EVENT DAY, and this is C's
  // one correction to draft 3's step 1 rather than a preference. Item 1 above
  // already established that a token the deadline extractor owns has a
  // different ROLE; counting it as a second candidate event day manufactures
  // ambiguity out of the commonest honest snippet there is — "the conference
  // runs X, abstracts are due Y" — and would silence every one of those rows.
  // Caught by item 1's own must-keep control going red, and B's measured
  // matrix (4 losses across 50 rows) could not have held with those rows
  // counted, so the correction restores B's numbers rather than departing from
  // them.
  const candidates = extractEventDayCandidates(text).filter(
    (day) => !deadline || Date.parse(day) !== Date.parse(deadline),
  );
  const clusters = clusterEventDays(candidates);
  const ownedSpan =
    clusters.length > 1 ? ownedTitleSpan(result.snippet ?? "", title) : undefined;
  const extractedDate =
    clusters.length > 1 && candidates.length > 0
      ? ownedSpan && extractEventDate(ownedSpan)
      : firstReading;
  // A22-02 (round 22 C): one token cannot be both the day the event happens
  // and the day its call for papers closes. DEADLINE_RE only matches a date
  // that a "deadline"/"submissions due"/"abstracts due" phrase introduces,
  // while extractEventDate matches any month-day shape — so when both return
  // the identical instant, the token belongs to the deadline and the event
  // date is unknown. Keep the deadline (it is evidenced), drop the start date;
  // the card falls back to the "date TBA" this function already documents
  // below. Cannot delete a row: the expiry anchor below takes the max of the
  // two, and the two are equal here.
  const dayLevelStart =
    extractedDate && deadline && Date.parse(extractedDate) === Date.parse(deadline)
      ? undefined
      : extractedDate;
  // A23-02 / Ruling 62b, THE APPROVED PARTIAL. The month-year the name strip
  // removed is a date claim the page made about this very event, so it is
  // handed to the date field rather than thrown away — but only as a
  // MONTH-GRANULARITY value, and only when nothing finer was extracted. The
  // card then reads "Aug 2026" instead of "Date not listed", which is TRUE, and
  // the self-contradiction of a name carrying a date the card calls unknown is
  // gone. This does not close the expiry evasion and nothing here claims it
  // does: the row still leaves only when its month has fully passed.
  const nameDetail = bestEventTitleSegmentDetailed(title, url);
  const startDate = dayLevelStart ?? nameDetail?.monthYear;
  // Expiry reads the LAST INSTANT the claim can still be true. For a day-level
  // date that is `Date.parse`; for a month-granularity one it is the end of the
  // month. Entering `2026-08` as a day-level date would expire an August row on
  // 1 August — wrongly EARLY, which is worse than the late expiry it replaces.
  const anchor = [startDate, deadline]
    .filter((d): d is string => Boolean(d))
    .map((d) => dateClaimEndMs(d));
  // A parsed date that's already in the past means the page describes a
  // finished event — drop it.
  if (anchor.length > 0 && Math.max(...anchor) < now) return null;
  if (anchor.length === 0) {
    // No parseable date is common for conference pages (the date lives in a
    // table the snippet doesn't capture). Keep the result only if it clearly
    // reads as an event; the card shows "date TBA" until opened.
    // Guard against past events that mention only a bare year ("held in 2019"):
    // if every year token in the text is in the past, treat it as finished.
    const years = [...text.matchAll(/\b(20\d{2})\b/g)].map((m) => Number(m[1]));
    const currentYear = new Date(now).getUTCFullYear();
    if (years.length > 0 && years.every((y) => y < currentYear)) return null;
    // A27-03 (round 27, item 4). THE BLINDNESS THIS ARM HAD INSIDE THE CURRENT
    // YEAR.
    //
    // The dates on these pages are not unread. Peer extracts every token; then
    // A22-01 above correctly refuses to PUBLISH one, because two or more
    // readings with no owned title span is genuine ambiguity. The anchor is
    // therefore empty and the only surviving expiry test is the bare-year arm
    // directly above — which compares YEARS. A page that says "the 2026
    // conference was held June 8, 2026", read in August 2026, has every scrap
    // of its evidence pointing at the past and not one year token older than
    // this one, so nothing here could see it. Measured: every candidate day
    // returns `past = true` while the bare-year arm returns `false`.
    //
    // This clause reads the finer evidence the function already computed forty
    // lines above and then never consulted again.
    //
    // **IT PUBLISHES NOTHING.** There is no line here that assigns a date;
    // `startDate` stays `""` on every surviving row, so Ruling 62b's
    // invented-date column stays ZERO by construction, no year-only fallback is
    // created, and month-granularity rows never reach this arm at all (a
    // month-granularity `startDate` makes the anchor non-empty). A22-01 still
    // decides what is PUBLISHED — this decides only whether the row has
    // EXPIRED, from evidence that guard already produced. A recorded design is
    // flagged, not reversed.
    //
    // **`every`, NOT "the earliest".** A's own control, `The Battery Saloon`,
    // carries a past cluster AND a future one; written the other way this
    // clause would delete a live event. The word is load-bearing and it has its
    // own test.
    //
    // **THE FUTURE-YEAR ESCAPE COSTS SOMETHING AND IS KEPT ANYWAY.** Without
    // it, "our 2026 congress was held May 5; the 2027 edition follows" — a real
    // next-edition page — would drop. The clause can only ever ADMIT relative
    // to the rule without it, which is the safer direction for a row-DROPPING
    // guard. Its named price: a genuinely finished page that mentions any later
    // year survives, dateless, exactly as it does today.
    //
    // The dateless branch is untouched: zero candidates and this cannot fire.
    if (
      candidates.length > 0 &&
      candidates.every((day) => dateClaimEndMs(day) < now) &&
      !years.some((y) => y > currentYear)
    ) {
      return null;
    }
  }

  const isOnline = /\b(online|virtual|hybrid)\b/i.test(text);
  const name = eventNameFrom(title, result.snippet ?? "", url);
  return {
    id: `eventweb:${urlHashId(url)}`,
    source: "eventweb",
    name,
    type: classifyEventType(title, result.snippet ?? ""),
    startDate: startDate && dateClaimEndMs(startDate) > now ? startDate : "",
    location: isOnline ? "Online" : "See event page",
    isOnline,
    deadline: deadline && Date.parse(deadline) > now ? deadline : undefined,
    description: (result.snippet ?? "").trim().slice(0, 600),
    url,
    tags: ["web discovery"],
  };
}

async function searchTavily(
  query: string,
  apiKey: string,
  limit: number,
): Promise<WebResult[]> {
  try {
    const res = await fetch("https://api.tavily.com/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        api_key: apiKey,
        query,
        search_depth: "basic",
        max_results: limit,
        include_answer: false,
        exclude_domains: ["arxiv.org", "openalex.org", "semanticscholar.org"],
      }),
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 6 * 60 * 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      results?: Array<{ title?: string; url?: string; content?: string }>;
    };
    return (data.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.content,
    }));
  } catch (err) {
    console.error("[events/eventweb] tavily error:", err);
    return [];
  }
}

async function searchBrave(
  query: string,
  apiKey: string,
  limit: number,
): Promise<WebResult[]> {
  const params = new URLSearchParams({ q: query, count: String(limit) });
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(7000),
        next: { revalidate: 6 * 60 * 60 },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as {
      web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
    };
    return (data.web?.results ?? []).map((r) => ({
      title: r.title,
      url: r.url,
      snippet: r.description,
    }));
  } catch (err) {
    console.error("[events/eventweb] brave error:", err);
    return [];
  }
}

/**
 * RULING 75 — the gemini branch. `searchGemini` returns the same unmapped
 * `WebResult[]` Tavily and Brave are normalised to, so `webResultToRawEventItem`
 * stays exactly where it is in `fetchImpl` and this surface's admission rules
 * are untouched. `DENY_HOSTS` is forwarded as a stage-2b pre-screen: it is an
 * outright, title-independent deny (see its call site below), so skipping those
 * hosts before a page fetch cannot change which rows are admitted.
 */
async function searchGeminiEvents(
  query: string,
  limit: number,
  deadlineAt: number,
): Promise<WebResult[]> {
  return searchGemini(query, {
    denyHosts: DENY_HOSTS,
    // The same three the Tavily branch excludes, so the offered corpus stays
    // comparable across providers.
    excludeDomains: ["arxiv.org", "openalex.org", "semanticscholar.org"],
    maxResults: limit,
    deadlineAt,
  });
}

/**
 * The vertex branch — the credit-funded engine, same contract, same mapper.
 *
 * **`detectPageKind` is set HERE AND ONLY HERE, and it is not optional for this
 * surface.** `searchGemini` reads the page's `schema.org` `@type` for free off
 * the HTML buffer it already holds for title recovery; `searchVertex` fetches
 * no pages at all, so without this flag every vertex-sourced row would arrive
 * with `pageKind` undefined and `webResultToRawEventItem`'s channel-L
 * publisher-declaration admission would go silently dead — rows the shipped
 * rule admits would simply stop existing, with nothing in the report saying so.
 *
 * `DENY_HOSTS` and the three excluded academic domains are forwarded exactly as
 * the gemini branch forwards them, so the offered corpus stays comparable
 * across providers.
 */
async function searchVertexEvents(
  query: string,
  limit: number,
  deadlineAt: number,
): Promise<WebResult[]> {
  return searchVertex(query, {
    denyHosts: DENY_HOSTS,
    excludeDomains: ["arxiv.org", "openalex.org", "semanticscholar.org"],
    maxResults: limit,
    deadlineAt,
    detectPageKind: true,
  });
}

/**
 * ABC-freemium 1-05 · R-KEY-3 — this used to be
 * a bare "the request key, or else the operator's environment key". This
 * surface was the largest single leak in the round: an unauthenticated request
 * produced seven outgoing searches on the operator's key. See
 * `lib/search/system-key.ts`.
 */
function resolveKeys(query: EventsQuery): {
  tavily?: string;
  brave?: string;
  provenance: "byok" | "system" | "none";
} {
  return resolveSystemSearchKeys({
    requestTavilyKey: query.webSearch?.tavilyApiKey,
    systemSearchAllowed: query.webSearch?.systemSearchAllowed === true,
  });
}

/**
 * RULING 75 requirement 2. This surface used a bare
 * `keys.tavily ? tavily : brave` ternary and **never read
 * `webSearch.provider` at all** — "all three surfaces uniform" therefore means
 * ADDING preference reading here, not extending a switch. The order itself
 * lives once in `sources/gemini-search.ts`.
 */
export function resolveSearchProvider(
  query: EventsQuery,
): "gemini" | "vertex" | "brave" | "tavily" | null {
  const requestTavilyKey = query.webSearch?.tavilyApiKey?.trim();
  const keys = resolveKeys(query);
  return resolveWebSearchProvider(query.webSearch?.provider, {
    // ABC-freemium 2-04 — gated at the availability inputs, which both the
    // explicit and the auto branch of `resolveWebSearchProvider` consult. See
    // the matching note in `jobweb.ts`.
    ...operatorSearchAvailability({
      systemSearchAllowed: query.webSearch?.systemSearchAllowed === true,
    }),
    braveKeyPresent: Boolean(keys.brave),
    tavilyKeyPresent: Boolean(keys.tavily),
    requestTavilyKeyPresent: Boolean(requestTavilyKey),
  });
}

async function fetchImpl(query: EventsQuery): Promise<RawEventItem[]> {
  const keys = resolveKeys(query);
  const provider = resolveSearchProvider(query);
  if (!provider) return [];

  const searches = query.queries.slice(0, EVENT_QUERY_BUDGET);
  if (searches.length === 0) return [];

  // ABC-freemium 1-21 · R-QUOTA-2, D4 — the daily cap on operator-funded
  // search, charged before the fan-out and only when the key is the
  // operator's. A BYOK fan-out costs the owner nothing and is not counted.
  //
  // A tripped breaker returns `[]`, which is the SAME degraded value a keyless
  // reader already gets here: the pipeline serves its free structured sources.
  // No error, no new shape.
  // 2-04 — charged for ANY operator-funded provider, not only system Tavily.
  //
  // **ABC-freemium 6-01 · Ruling 14 point 3 — THIS CALL SITE IS UNREACHABLE,
  // and it is KEPT on purpose (Ruling 12 point 2).** The chain, end to end:
  // `systemSearchAllowed` is a hard `false` on every producer (D2a), so
  // `resolveSystemSearchKeys` returns no Brave key and Tavily can only be
  // `"byok"` or `"none"`; `operatorSearchAvailability` is frozen false for
  // both providers; so the only provider selectable here is Tavily with
  // `provenance: "byok"`, and `isOperatorFundedSearch` answers `false` for
  // exactly that pair. `operatorFunded` is therefore never `true` and the
  // breaker below never runs. Deleting it would remove the metering that has
  // to exist BEFORE the gate is ever reopened, not the round after.
  //
  // **If operator-funded search is restored, this counter must be SPLIT — do
  // not just flip the flag.** These sites are dead because no operator-funded
  // provider can be *selected*, not because anything refuses them:
  // `isOperatorFundedSearch` still returns `true` for Brave, Vertex and
  // Gemini. Reopening the gate would start charging **search fan-outs** to a
  // counter named `forced_rebuilds_today`, which re-creates the exact
  // false-audit defect 6-01 exists to fix, in reverse.
  const operatorFunded = isOperatorFundedSearch(provider, keys);
  if (operatorFunded) {
    const allowed = await consumeForcedRebuild(
      query.webSearch?.userId ?? null,
      searches.length,
      undefined,
      "events",
    );
    if (!allowed) return [];
  }
  // Search providers bill per *search*, not per result, so asking each query
  // for a full page of results is free. The previous formula divided a fixed
  // cap across the query set, which meant every added query starved the
  // others — 18 queries yielded 4 results each. Measured: 4/query produced a
  // 65-item candidate pool where 10/query produces ~157, and the facet panel
  // is only as useful as the pool behind it.
  const perQuery = RESULTS_PER_SEARCH;

  const now = Date.now();
  const all: RawEventItem[] = [];
  // One shared deadline for the whole fan-out, so sixteen concurrent queries
  // stop recovering page titles at the same moment instead of each starting a
  // fresh budget (RULING 76a's 25 s source cap is what they are fitting into).
  const deadlineAt = geminiSearchDeadline();
  // Run the daily allocation concurrently so the source's wall-clock timeout
  // cannot strand later, more specific queries.
  const resultSets = await Promise.all(
    searches.map((q) =>
      provider === "vertex"
        ? searchVertexEvents(q, query.limit, deadlineAt)
        : provider === "gemini"
          ? searchGeminiEvents(q, query.limit, deadlineAt)
          : provider === "tavily"
            ? searchTavily(q, keys.tavily!, perQuery)
            : searchBrave(q, keys.brave!, perQuery),
    ),
  );
  // ABC-freemium 1-05 / 2-04 · R-METER-2 — one row per operator-funded fan-out,
  // carrying the provider's own name. A BYOK search costs the operator nothing.
  if (operatorFunded) {
    recordUsageEvent({
      user_id: query.webSearch?.userId ?? null,
      kind: "search",
      surface: "events",
      query_count: searches.length,
      provider,
      ok: true,
      byok: false,
    });
  }

  for (const results of resultSets) {
    for (const result of results) {
      const item = webResultToRawEventItem(result, now);
      if (item) all.push(item);
    }
  }
  return Array.from(new Map(all.map((item) => [item.id, item])).values()).slice(
    0,
    query.limit,
  );
}

export const eventweb: EventSourceAdapter = {
  id: "eventweb",
  enabled: (query) => resolveSearchProvider(query) !== null,
  fetch: fetchImpl,
};
