import type { JobSourceAdapter, JobsQuery, RawJobItem } from "../types";
import {
  isOperatorFundedSearch,
  operatorSearchAvailability,
  resolveSystemSearchKeys,
} from "@/lib/search/system-key";
import { recordUsageEvent } from "@/lib/usage/events";
import { consumeForcedRebuild } from "@/lib/usage/rebuild-breaker";
import { looksLikeHostBrand, urlHashId } from "@/lib/opportunities/shared";
import {
  JOB_QUERY_BUDGET,
  RESULTS_PER_SEARCH,
} from "@/lib/opportunities/query-budget";
import {
  geminiSearchDeadline,
  resolveWebSearchProvider,
  searchGemini,
} from "@/lib/sources/gemini-search";
import { searchVertex } from "@/lib/sources/vertex-search";
import {
  cleanJobDescription,
  cleanJobSubtitlePart,
  cleanJobTitle,
} from "@/lib/opportunities/job-cleanup";
import {
  COUNTRY_NAMES,
  US_STATE_CODES,
} from "@/lib/opportunities/structured-extract";

// Web discovery for research and R&D positions across academic and industry
// employers. Search providers reach public listings that frequently block
// direct server-side crawling. Disabled when neither key is present.

const KNOWN_JOB_BOARD_DOMAINS = [
  "higheredjobs.com",
  "jobs.ac.uk",
  "academicpositions.com",
  "euraxess.ec.europa.eu",
  "nature.com",
  "timeshighereducation.com",
  "academicjobsonline.org",
  "science.org",
];

// A22-07 (round 22 C): `jobdetails` added. `lanl.jobs`'s real Los Alamos
// vacancy lives at `/search/jobdetails/<slug>/<uuid>` — a single role, a UUID
// posting id — and dropped because the list required a segment that IS `job`
// or `jobs`. `jobdetails` is an applicant-tracking-system ROUTING convention,
// closed by construction in the same sense `FORUM_THREAD_URL_RE`'s own doc
// comment defends its list: fixed by the software that emits them, not by
// English. This is Ruling 48b's first non-zero wrongly-dropped column in six
// rounds, and the cause was a vocabulary list that had never been widened.
//
// `job-details`, `jobdetail`, `jobDetail` and the rest of the family are
// DELIBERATELY LEFT OUT. B searched this pull and found no live case for any of
// them; §3's vacuity rule says an added token needs a red case of its own, so
// they are named here as UNEARNED and a later round may earn them.
export const JOB_PATH_RE =
  /\/(?:job|jobs|jobdetails|career|careers|position|positions|vacancy|vacancies|opportunity|opportunities|job-search|jobsearch)(?:\/|$)/i;
// A22-06 (round 22 C): `collections` added. `batteryjunction.com/collections/
// batteries` — a retail shop's product CATEGORY page, role title `Batteries` —
// was admitted as a job posting because `JOB_TEXT_RE` matched the shop's own
// `Apply Now` BUTTON in the provider snippet. `/collections/` is Shopify's
// storefront routing convention, the same closed-by-construction kind of
// signal as the ATS routes above, and this regex runs BEFORE the two-clause
// OR below, so it beats the text clause outright.
//
// WHY NOT "REMOVE `apply now` FROM JOB_TEXT_RE": B priced that and it is the
// wrong instrument. `apply now` is the only clause keeping several real single
// postings alive whose URL is not job-shaped, so removing it would WIDEN
// A22-07's class while closing A22-06 — the two halves must land together or
// the drop rate moves the wrong way. Recorded so it is not re-proposed.
//
// `products`, `product`, `shop`, `cart` and `category` are LEFT OUT for the
// same vacuity reason as the ATS family above: no live case in this pull.
//
// Phase 3 round 3 C, ITEM 3 (J2, Ruling 120g item 3): THE SHIPPED COMMENT
// ABOVE PREDICTED THIS EXACT GAP IN ADVANCE, and Phase 3 round 2 B's fresh
// Tier-2 census supplied the live case it was waiting on — a chemical
// company's product-catalogue page
// (`https://neicorporation.com/products/batteries/cathode-anode-powders/
// lithium-cobalt-oxide/`, rendered "Lithium Cobalt Oxide Powder") admitted
// as a job posting, 1 of 5 pulls. Confirmed by direct execution against the
// real path: `NON_JOB_PATH_RE` returned false, `JOB_PATH_RE` returned false
// too, and the title carries none of `JOB_TEXT_RE`'s closed vocabulary — the
// row only survives via `snippetAbsent`. This promotes ONLY `products` —
// the identical vacuity discipline this file already applies elsewhere
// (J1's placeholder list, F8/F9's tail regexes): ship the measured token,
// name the reasoned-but-unwitnessed siblings for a future round. `product`,
// `shop`, `cart` and `category` still have no live witness THIS round
// either, so none of them is added — they remain exactly as deferred as the
// comment above already states.
//
// FAILURE DIRECTION: `NON_JOB_PATH_RE` is a DROP-the-row guard, held to a
// higher bar than an admitting one (Ruling 55c: "a guard that DROPS is held
// to a higher bar than one that admits"). No real posting URL plausibly
// contains a whole `/products/` path segment — an ATS/careers routing
// convention never uses this word, and it is retail/e-commerce vocabulary,
// disjoint from job-board routing by construction, the same closed-by-
// construction argument `COMMERCE_PATH_RE` already relies on for the
// identical word on the EVENT surface.
export const NON_JOB_PATH_RE =
  /\/(?:article|articles|doi|paper|papers|publication|publications|news|blog|posts|collections|products)(?:\/|$)/i;

// ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — COMPONENT A: a closed host list
// for encyclopedias, the same shipped SHAPE as the event side's
// `DENY_HOSTS`/`PAPER_PAGE_HOSTS` (`eventweb.ts:193-219,246-254`), justified
// by Ruling 84c's own doctrine that a closed host list is the right tool
// when the host CLASS is genuinely closed.
//
// WHY HOST, NOT PATH. Wikipedia's `/wiki/` path is a MediaWiki software
// convention that other, unrelated sites also run, so the path alone is not
// a reliable signal. The host is what is actually closed here. Suffix-matched
// so every language subdomain is caught (`de.wikipedia.org`, `en.wikipedia.org`,
// …) — the same idiom `eventweb.ts`'s own `isDeniedUrl` already uses.
const NON_JOB_HOSTS = ["wikipedia.org"] as const;
function isNonJobHost(host: string): boolean {
  return NON_JOB_HOSTS.some((h) => host === h || host.endsWith(`.${h}`));
}

// ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — COMPONENT B: a path-structure
// signal for date-stamped publishing paths (`/YYYY/MM/DD/…`), mirroring the
// event side's own preference for path-STRUCTURE over host enumeration where
// the shape itself is the signal (Ruling 84c, `TICKER_NEWS_PATH_RE`,
// `eventweb.ts:430`) — a lab or research institute's own dated news/blog
// post, not a posting.
//
// THE TITLE HALF IS NOT NEW INVENTION. It is `isCareersSectionRoot`'s own
// already-shipped safety net (`:1495-1501`, below) reused rather than
// redesigned: a suspicious URL shape cannot drop a title that states real
// job vocabulary, so a genuine posting that happens to sit at a
// date-structured path is not silenced.
const DATE_STRUCTURED_PATH_RE = /^\/\d{4}\/\d{2}\/\d{2}\//;
function isDateStructuredResearchPath(
  title: string,
  pathAndQuery: string,
): boolean {
  const path = pathAndQuery.split("?")[0] ?? "";
  if (!DATE_STRUCTURED_PATH_RE.test(path)) return false;
  return !JOB_TEXT_RE.test(title); // same title-half safety net isCareersSectionRoot already uses (jobweb.ts:1495-1501)
}

/**
 * Search-results and category pages on job aggregators. These match every
 * job-shaped heuristic (job-ish URL, hiring language, a role in the title) but
 * are not postings — you cannot apply to "60 Molten Salt Jobs". They are the
 * jobs-side equivalent of the social-media noise the events adapter denies.
 *
 * B13-02 part 1 (round 13): the leading count could not read a thousands
 * separator, so `1,000+ Molten Salt jobs in United States` (live, linkedin.com)
 * sailed through while the identical `1000+ …` was caught. Only this first
 * alternative's number changed; every other alternative is byte-identical.
 *
 * THE ALTERNATION SHAPE IS LOAD-BEARING — DO NOT "TIDY" IT INTO
 * `\d{1,3}(?:,\d{3})*`. B measured that tidier form and it silently LOSES two
 * shapes the pre-B13-02 regex already caught (`1000+ …`, `12345 vacancies`),
 * because with the comma group optional `\d{1,3}` can never consume a 4- or
 * 5-digit run. Shipped 6/9, the tidy draft 7/9 with two NEW misses, this form
 * 9/9 with zero false fires. The regression cases are asserted below.
 *
 * B15-01 (round 15) DELIBERATELY DID NOT TOUCH THIS REGEX — not one byte, and
 * specifically NOT the leading count in the first alternative. Round 15 A found
 * a listing page that survives precisely because the count was absent, and the
 * obvious repair is to make that count optional. It was measured: 71/92, 19
 * FALSE FIRES, four of them shapes this suite already asserts as must-keeps.
 * The fix went into `isTopicLandingPage` instead, so the count-form regression
 * lock above stands BY CONSTRUCTION rather than by re-testing. Do not
 * re-litigate the count.
 *
 * B16-02 (round 16, Ruling 47c): TWO NARROWINGS. Round 16 A did the measurement
 * fifteen rounds had never done — it scored ALL 298 rows the provider OFFERED,
 * not just the ones that survived into the pool — and found this regex DESTROYING
 * REAL SINGLE POSTINGS: `careers.inl.gov`'s `Molten Salt R&D Engineer` (the
 * profile's strongest topic, on the employer's own careers system) and
 * `lensa.com`'s Kairos Power internship. **An item this guard drops is by
 * definition not in the pool, so every earlier round's "did it over-fire?" check
 * was structurally incapable of finding them.** 2 of 298 offered rows (0.7%).
 *
 * **THESE ARE TWO INDEPENDENT GAPS FIRING TWO DIFFERENT ALTERNATIVES, AND
 * NEITHER NARROWING FIXES THE OTHER — proved by execution, both by B and again
 * by C before this edit was written.** They are asserted separately below so a
 * later round cannot collapse them into one.
 *
 *  1. **ALTERNATIVE 4 WAS UNANCHORED, so it fired on a site's own trailing
 *     `<title>` CHROME.** `Molten Salt R&D Engineer - Search Jobs` is one
 *     requisition with an applicant-tracking-system toolbar button label glued
 *     on after a separator. The rule could not tell it from a page genuinely
 *     titled `Browse Chemistry Jobs`. Now anchored with `^\s*`: the listing
 *     verb must OPEN the title. The class is at least three verbs wide —
 *     `- Find Jobs` and `- Browse Jobs` were destroyed too, and `- View Jobs`
 *     survived only because `view` is not in the verb list.
 *  2. **A FOUR-DIGIT YEAR WAS BEING READ AS A JOB COUNT.** Alternative 1 wants
 *     `<number> [words] <job noun>` — designed for `60 Molten Salt Jobs` — and
 *     `Summer 2027 job` satisfies it exactly. Same arithmetic B14-01 recorded
 *     when it cut NodeBB: a four-digit year is a four-digit id. The lookahead
 *     excludes a bare `19xx`/`20xx` run and NOTHING ELSE — **a `+` suffix or a
 *     fifth digit releases it, because those mean the run really IS a count**
 *     (`2000+ Battery Jobs in Germany`, `20000 Battery Jobs`, both asserted).
 *
 * **THE SHIPPED BASELINE WAS WORSE THAN A COULD SEE: TEN false-fire shapes, not
 * two.** The eight beyond A's two live instances are CONSTRUCTED, not sighted —
 * A's 0.7% stands as the only measured rate. What they establish is that this is
 * a class, not two strings.
 *
 * **THIS NARROWS; IT DOES NOT WIDEN, so B15-01's and B13-02's locks above are
 * untouched and are NOT re-litigated.** B15-01 refused to make the leading count
 * OPTIONAL (71/92, 19 false fires); this moves in the opposite direction —
 * strictly fewer titles match. B13-02's five locked count shapes all still fire,
 * verified by execution rather than by argument, because the lookahead sits in
 * FRONT of the alternation and the alternation shape is byte-identical.
 *
 * **THE OBVIOUS FIX — STRIP SITE CHROME BEFORE THE TITLE RULES RUN — IS DEAD ON
 * A NUMBER, NOT ON TASTE: 184/191 with SIX false fires.** It cannot reach the
 * year gap at all, and it still destroys the pipe-separated chrome form
 * `Senior Battery Engineer | Search Jobs | Acme Careers`, because that chrome is
 * not trailing. That title is asserted below as a must-keep and is the lock:
 * any design that leaves alternative 4 unanchored fails it.
 *
 * **NO HOST LIST** for `careers.inl.gov` or `lensa.com` — Ruling 32's headline
 * complaint. The `- Search Jobs` chrome is an ATS convention, not one site's
 * quirk, and the fix is asserted on unrelated hosts.
 *
 * ───────────────────────────────────────────────────────────────────────
 * A27-02 (round 27, item 2). ALTERNATIVE 1's RUN IS NARROWED TO
 * WORD-INITIAL TOKENS.
 *
 * The old run `[\w\s,&/-]{0,40}` contained the HYPHEN and the SPACE, so it
 * bridged a title's own segment separator. On the real, on-topic vacancy
 * `Nuclear Materials and Molten Salt Technologist 1 - LANL Jobs` the engine
 * read the job-GRADE `1` as a count, walked `- LANL ` straight across the
 * ` - `, landed on `Jobs`, and dropped a single national-laboratory posting as
 * an aggregate listing. Not host-specific: `Research Technologist 3 - Sandia
 * Jobs` on `sandia.gov` reproduced it.
 *
 * The true aggregate shape is count-noun ADJACENCY WITHIN ONE SEGMENT, not
 * magnitude and not position. Magnitude fails (`5 Jobs` is a real aggregate and
 * `999 Battery Openings` is a shipped must-drop); position fails (`Explore 60
 * Molten Salt Jobs` counts mid-title). In a genuine aggregate everything
 * between the number and the noun is one noun phrase; in the false positive a
 * separator sits between them, which means the two belong to different parts of
 * the title.
 *
 * **THIS INVENTS NO POLICY — IT GIVES THE HYPHEN THE TREATMENT THE PIPE ALREADY
 * HAD.** `[\w\s,&/-]` never contained `|`, so `1,200 | Engineering Jobs` was
 * already admitted by this rule before the change.
 *
 * Every token must BEGIN with a word character; `[\w,&/-]*` inside a token
 * keeps `Full-Time`, `Entry-Level` and `R&D` dropping; `{0,6}` keeps the reach
 * bounded the way `{0,40}` did; the group is optional with a trailing `\s+` so
 * the empty run (`12345 vacancies`) still fires. Strictly fewer titles match —
 * the same direction of travel as the year lookahead above.
 *
 * KNOWN, BOUNDED RESIDUALS, named rather than hidden. (1) A separator-led count
 * on a NON-aggregator host (`1,200 - Engineering Jobs` at `example.test/jobs`)
 * is now admitted; it is CONSTRUCTED, not sighted, the pipe form was already
 * admitted, and on the nine `AGGREGATOR_HOSTS` the URL limb still drops it —
 * asserted below. (2) A grade digit with NO separator (`Technologist 1 LANL
 * Jobs`) is refused today and stays refused: undecidable from the title alone,
 * and no measured row earns a further clause.
 *
 * Direction, from this file's own precedent at the second `isListingPage` call
 * site: a guard that DROPS is held to a higher bar than a guard that ADMITS, so
 * the undecidable case admits and faces the later layers.
 */
export const LISTING_TITLE_RE =
  /(?:^|\s)(?!(?:19|20)\d{2}(?![\d+]))(?:\d{1,3}(?:,\d{3})+|\d{1,5})[+]?\s+(?:[\w][\w,&/-]*(?:\s+[\w][\w,&/-]*){0,6}\s+)?\b(?:jobs?|vacancies|openings?|positions?|opportunities)\b|\bjobs?,\s*employment\b|\b(?:jobs?|vacancies|openings?|positions?)\s+(?:in|near|at|for)\b.*\|\s*[\w.-]+\.\w+\s*$|^\s*(?:browse|search|find|latest|top|best)\s+[\w\s]{0,20}\b(?:jobs?|vacancies|openings?)\b/i;

/** Query-string or path shapes that mean "this is a search result listing". */
export const LISTING_URL_RE =
  /\/(?:job-search|jobsearch|search|browse|listings?|q-[\w-]*jobs?)(?:\/|$|\.)|[?&](?:q|query|keywords?|search|k)=/i;

/**
 * B13-02 part 2 (round 13): a syndication endpoint is a list of many items by
 * definition, never one posting. `lco-cdo.org/en/author/lco_admin/feed/` — an
 * author RSS feed — was ingested as a job and rendered the bare host slug
 * `lco-cdo` as its role title; `isListingPage` had no concept of a feed at all,
 * and the item did not even arrive through `JOB_PATH_RE` (it entered on
 * `JOB_TEXT_RE` matching "vacancies" in its text).
 *
 * Closed by construction, which is Ruling 37's bar: this enumerates the
 * standardised RSS/Atom endpoint conventions — a finite set fixed by the
 * syndication specs and by what CMSs emit — not a grammatical class English
 * keeps extending. Nothing about a real posting URL is drawn from that
 * vocabulary.
 *
 * THE WHOLE-SEGMENT ANCHORING IS LOAD-BEARING, and the four hardest
 * counterexamples are why: `/jobs/feedstock-process-engineer`,
 * `/careers/rss-platform-engineer`, `/jobs/atomic-layer-deposition-scientist`
 * and `/jobs/feeder-line-technician` are real-shaped posting slugs carrying a
 * feed token as a substring. All four are untouched, and all four are asserted
 * below. Same anchoring discipline `NAV_CHROME_SEGMENT_RE` uses.
 *
 * Failure direction: an unlisted feed convention survives — the status quo,
 * never a wrong value.
 */
const FEED_PATH_RE =
  /(?:^|\/)(?:feed|rss|atom)(?:\/|$)|\.(?:rss|atom|xml)$|[?&]feed=/i;

/**
 * B14-01 (round 14, Ruling 43): a FORUM THREAD is a discussion, not a posting.
 * `openmc.discourse.group/t/job-vacancies-looking-for-openmc-skills/1727?page=2`
 * rendered the forum CATEGORY (`Announcements`, and in another round `Users`) in
 * the employer slot, unanimously across all five of round 14 A's pulls.
 *
 * **THIS IS A PAGE-KIND RULE, NOT A STRING RULE, AND THAT IS THE WHOLE POINT.**
 * The three wrong-or-empty employer values recorded for this host are three
 * TITLES of ONE page. A string-side guard has to beat each separately; this
 * beats all of them at once because `isListingPage` is consulted BEFORE the
 * employer chain ever runs — the wrong value cannot be derived from an item that
 * never exists. B verified by execution that ALL FIVE recorded title shapes drop
 * from this one URL rule (paginated `Announcements`, page-1 `Announcements`,
 * `Users`, the `|`-separated r12 variant, and the no-category variant), which is
 * how Ruling 43's "both observed shapes, not one string" is satisfied. A sixth
 * title shape appearing tomorrow drops too. **The rule never reads the title.**
 *
 * Closed by construction, the same bar `FEED_PATH_RE` cleared: it enumerates
 * FORUM SOFTWARE'S OWN ROUTING CONVENTIONS — fixed by the software that emits
 * them, not by English — so it is not Ruling 37's open-class trap.
 *  1. Discourse: `/t/[<slug>/]<topic-id>[/<post-no>]` (the live shape).
 *  2. phpBB / vBulletin: the literal script filenames. A filename is as closed
 *     as a vocabulary gets.
 *  3. XenForo: `/threads/<slug>.<thread-id>` — the `.` + id suffix is XenForo's
 *     own and is REQUIRED, rather than matching the bare word `threads`.
 *
 * EVERY ALTERNATIVE IS WHOLE-SEGMENT ANCHORED AND EVERY ALTERNATIVE REQUIRES A
 * CONFIRMING STRUCTURAL TOKEN — a numeric id or a literal script filename. None
 * fires on a word alone. The naive token-only form (`/t/`, `/topic/`, `/thread/`,
 * `/forum/` …) was measured at 46/58 with EIGHT FALSE FIRES; do not simplify to
 * it. `/jobs/threading-machine-operator`, `/careers/discourse-analysis-researcher`,
 * `/t-shirt-designer/jobs/1234`, `/t/battery-research-scientist` (a `/t/` segment
 * with no id) and `/threads/hiring.today` (a dot with no id) are all real-shaped
 * posting URLs it would have destroyed. All are asserted below as must-keeps.
 *
 * TWO NARROWINGS B MEASURED AND C MUST NOT REVERSE:
 *  1. **NodeBB/Invision's `/topic/<id>` is DELIBERATELY ABSENT.** Adding it
 *     scores 58/58 instead of 57/58, and it is still wrong: its true-fire shape
 *     `/topic/8891-hiring-battery-postdocs/` and its false-fire shapes
 *     `/topic/12-month-battery-fellowship`, `/topic/2026-summer-internship` are
 *     both `/topic/<digits>-<slug>` and NO structural test separates them — a
 *     four-digit year is a four-digit id, so a digit floor does not help. The
 *     miss costs the status quo; the false fire destroys a real posting. Same
 *     arithmetic `LISTING_SECTION_TITLE_RE` used to exclude `for`. The miss is
 *     asserted below as a deliberate named miss so a later widening is a
 *     deliberate act rather than a drift.
 *  2. **Do NOT anchor the Discourse alternative to `^\/t\/`.** Measured at
 *     55/58: it stops catching subfolder Discourse installs
 *     (`/community/t/hiring-postdocs/8891`, a documented deployment shape) AND
 *     this suite's own idea of a forum thread URL.
 *
 * Ruling 39c's recorded preference was a HOST LIST, and this is neither a host
 * list nor phrase matching. 39c's own stated REASON for that preference —
 * avoiding an open class — endorses a URL-route rule; and a host list would not
 * have closed this item at all, because Discourse is a PLATFORM, not a site
 * (`discuss.example.org` and a subfolder install are the same defect on
 * different hosts, and both are caught here). Fixing one site is Ruling 32's
 * headline complaint. **The manager verified round 14 B and ENDORSED this
 * departure: the route rule is ruled the correct instrument. Do not "fix" it
 * back into a host list.**
 *
 * THE ASYMMETRY THAT SHAPED EVERY NARROWING: this is the first drop this loop
 * has designed for a wrong VALUE rather than a wrong ITEM. A guard's false fire
 * leaves a field empty; a DROP's false fire destroys a whole real posting. That
 * is why a matrix point was given up rather than keep `/topic/<id>`.
 *
 * Accepted cost, stated rather than hidden: if a forum thread is ever the only
 * home of a real vacancy, this drops it. What such a thread renders TODAY is a
 * thread title in the role slot (`Job vacancies looking for OpenMC skills` — not
 * a role anyone can apply to) and a forum category in the employer slot. That is
 * wrong data, which Ruling 23 ranks ABOVE missing data.
 *
 * Failure direction when it does NOT fire: exactly today's behaviour — an
 * unlisted forum convention stays in the pool with whatever employer the chain
 * derives. Never a new wrong value.
 */
const FORUM_THREAD_URL_RE =
  /(?:^|\/)t\/(?:[\w%.~-]+\/)?\d+(?:\/\d+)?(?:\/|$|\?)|(?:^|\/)(?:viewtopic|showthread|viewforum|forumdisplay)\.php(?:$|[?&])|(?:^|\/)threads\/[\w%.~-]*?\.\d+(?:\/|$|\?)/i;

/**
 * B15-01 (round 15, Ruling 45c/46a): A GENERATED SEARCH-RESULTS PAGE RESTATES
 * ITS OWN QUERY. `linkedin.com/jobs/ion-exchange-resin-jobs` rendered
 * `Ion Exchange Resin jobs in United States` as a job card — no employer, no
 * summary, and a link that opens a search page rather than a vacancy.
 *
 * THE COUNT WAS THE ONLY THING GUARDING THIS CLASS, AND IT IS AN ACCIDENT OF
 * RENDERING. `LISTING_TITLE_RE`'s first alternative needs a numeric run before
 * the job noun, and the board omits the count when the result set is small.
 * B proved by replay that B13-02's OWN named target
 * (`Molten Salt jobs in United States` @ `/jobs/molten-salt-jobs`) is still
 * KEPT today whenever that count is absent — so round 14's confirmation of
 * B13-02 was weather, not coverage. The countless form is asserted below.
 *
 * `LISTING_TITLE_RE` IS DELIBERATELY NOT TOUCHED — not even to make its
 * leading count optional. That naive widening was MEASURED at 71/92 with 19
 * FALSE FIRES, four of which are shapes this suite ALREADY ASSERTS as
 * must-keeps (`Jobs Data Analyst at the Bureau of Labor Statistics`,
 * `Jobs for Veterans Program Manager`, `Job for a Battery Engineer`,
 * `Research positions at CERN`). It fails existing tests immediately. Leaving
 * that regex byte-identical is what preserves B13-02's count-form regression
 * lock by construction rather than by re-testing. Two other title-side routes
 * were also measured and rejected: widening `LISTING_SECTION_TITLE_RE`'s
 * leading budget from one word to four (83/92, 7 false fires, including
 * `Head of Careers at Imperial College London`), and a bare `<noun> in|near`
 * title rule with no URL confirmation (84/92, 6 false fires — which is why
 * `LISTING_TITLE_RE`'s third alternative demands a `| host.tld` tail).
 *
 * So the signal moves off the count and onto URL/TITLE AGREEMENT: the URL slug
 * IS the query, and the title is that same query followed by a location. A real
 * posting's title is a ROLE, not a query — and even when a role legitimately
 * ends in the word "jobs", the two rarely agree EXACTLY, because a board
 * inserts an employer (`… at Rocket Jobs …`) or punctuation
 * (`Manager, Green Jobs`) that the slug does not carry.
 *
 * FOUR CONJUNCTS. EVERY ONE WAS FORCED BY A COUNTEREXAMPLE THAT KILLED THE
 * DRAFT WITHOUT IT — DO NOT SIMPLIFY ANY OF THEM OUT:
 *  1. The URL's final segment ends in a plural job noun. ALONE: 79/92 with 10
 *     false fires — it destroys `Director of Green Jobs`, `Manager, Green
 *     Jobs`, `Head of Jobs in Manchester`, `Battery Engineer at Rocket Jobs`.
 *  2. The title carries `<content word> <job noun> in|near`. The FUNCTION-WORD
 *     negative lookahead separates a compound query (`Resin jobs`) from a
 *     prepositional role title (`Head of Jobs`). 79 → 84/92. Function words are
 *     a CLOSED class fixed by grammar — the opposite of Ruling 37's open-class
 *     trap, and the same bar `FEED_PATH_RE` and `FORUM_THREAD_URL_RE` cleared.
 *  3. The leaf, de-slugified, is the OPENING PHRASE of the title. The
 *     restated-query signature and the strongest single conjunct: 84 → 86/92.
 *     It is what saves `Battery Engineer at Rocket Jobs in Berlin`, whose slug
 *     says `battery-engineer-rocket-jobs` while the title's `at` breaks the
 *     match.
 *  4. The leaf carries no function word ANYWHERE. 86 → 88/92, and it is what
 *     saves `Director of Green Jobs in Boston` and `Head of Green Jobs in
 *     Ontario`, whose slugs carry `of` even though the word beside the noun
 *     does not. Allowing a slug tail after the noun (the locale form
 *     `<query>-jobs-<place>`) then closes the last miss at 89/92.
 *
 * `careers`, `positions` and `opportunities` ARE DELIBERATELY ABSENT FROM ALL
 * THREE LISTS, and that is measured rather than stylistic: adding them scores
 * 79/92 with 10 false fires, one of them this suite's own `Research positions
 * at CERN` must-keep. Same arithmetic B13-02 used to exclude the preposition
 * `for`, and its recorded reason — real postings legitimately use `positions`
 * — applies unchanged.
 *
 * THIS IS NOT A HOST LIST AND NOT PHRASE MATCHING. `linkedin.com` appears
 * nowhere; the identical shape on `jobboard.test` is asserted below and drops
 * there too. A host list is Ruling 32's headline complaint.
 *
 * THE ONE FALSE FIRE IS NAMED, NOT HIDDEN: `Manager Green Jobs in Ontario` @
 * `/jobs/manager-green-jobs` drops. A role title that is a function-word-free
 * noun phrase ending in a bare plural job noun, rendered `<phrase> in <place>`,
 * with a slug that is exactly that phrase, IS a search query grammatically —
 * no structural test separates them. Same argument B14-01 used to cut NodeBB.
 * Measured frequency: across rounds 8–15's censuses (150+ observed postings)
 * ZERO titles end in a bare plural job noun before a location. The nearest real
 * shapes all survive and are asserted: the comma form `Manager, Green Jobs in
 * Ontario`, the natural order `Green Jobs Program Manager`, and `Youth Jobs
 * Coordinator in Ontario`. It is asserted below as a named accepted cost so the
 * price sits in a test rather than only in a comment.
 *
 * A LETTER-CASE TEST IS REJECTED — RULING 46a, DO NOT "IMPROVE" TOWARD IT.
 * Requiring the job noun to be lowercase removes that false fire and scores
 * 88/92 with zero false fires, but it MISSES THE TITLE-CASE FORM, and B13-02's
 * own recorded live target `Intern Jobs at Battery Ventures Companies` proves
 * Title-Case listing titles occur in this loop's real data. Shipping a fix that
 * a re-casing defeats is precisely the failure that created this item. Round 15
 * C re-measured this by execution before writing the code: the letter-case
 * variant turns the one false fire into a THIRD miss on
 * `Ion Exchange Resin Jobs in United States`. The manager ENDORSED B's refusal
 * (Ruling 46a); the trade is not open to a later round without new evidence.
 *
 * TWO NAMED MISSES, both constructed, both the safe direction (status quo), and
 * both asserted below so a later widening is a deliberate act:
 *  1. `LinkedIn | Ion Exchange Resin jobs in United States` — brand-first
 *     titles put the query in the SECOND segment, and `webResultToRawJobItem`
 *     only re-tests the FIRST. Closing it means changing that call pattern — a
 *     wider blast radius than a constructed case earns.
 *  2. `Ion Exchange Resin jobs` with no location. Allowing end-of-title instead
 *     of `in`/`near` scores 81/92 with 8 false fires; the miss is bought
 *     deliberately.
 *
 * Accepted cost, stated rather than hidden: if a real vacancy is ever titled as
 * a bare query-shaped noun phrase and slugged the same way, this drops it. What
 * such a page renders TODAY is a card promising a job that opens a search
 * results page — wrong data, which Ruling 23 ranks ABOVE missing data.
 *
 * Failure direction when it does NOT fire: exactly today's behaviour — the page
 * stays in the pool with an empty employer and no summary. Never a new wrong
 * value.
 *
 * B19-01 (round 19, Ruling 52a): THREE CHARACTER CLASSES GAIN FIVE CHARACTERS
 * (`, . & ( )`). NOT A NEW RULE — the removal of an accidental shield.
 *
 * `jobright.ai` rendered a "1000+ results" search page as a single job card on
 * 5 pulls of 5, headed `Internship, Battery Engineering (summer 2026) Jobs in
 * United States`, in the SAME run in which this file correctly dropped
 * `linkedin.com`'s `1,000+ Molten Salt jobs in United States`. The two rows are
 * separated by two DIFFERENT clauses and that is what sized the fix: LinkedIn
 * drops on the leading count (`LISTING_TITLE_RE`), and the jobright title
 * carries no count at all — its `(1000+)` lives in the page's own `<h1>`, which
 * this guard runs too early to ever see. So the clause that should have caught
 * it is this one, and it failed on TWO of its four conjuncts, both because a
 * character class written from three punctuation-free examples excluded the
 * punctuation this host's LOSSLESS slugifier preserves. Conjunct 3 — B15-01's
 * own strongest conjunct — was satisfied exactly, punctuation and all.
 *
 * WHY THREE TOKENS AND NOT ONE, ESTABLISHED BY EXECUTION AND RE-ESTABLISHED BY
 * ROUND 19's C BEFORE THIS EDIT WAS WRITTEN. Widening the leaf alone leaves the
 * live row KEPT; widening the title token alone leaves it KEPT; only all three
 * together drop it. A later round must not "simplify" this back to one edit —
 * the leaf-tail token has its own uniquely-red test below, and the leaf-head
 * token has two.
 *
 * THE CLASS IS CLOSED AND EVERY ADDED CHARACTER IS EARNED BY A TEST. Apostrophe,
 * plus and percent were measured and are DELIBERATELY EXCLUDED: no row reaches
 * them, so they would be characters no test could turn red.
 *
 * AN OPEN CLASS IS REJECTED ON A NUMBER, NOT ON TASTE. The `[^/]` / `\S` form
 * was scored against the identical corpus and is IDENTICAL verdict-for-verdict
 * on every row — same catches, same false fires, same zero misses. It buys
 * nothing, so the enumerated list is free. Do not "generalise" it later.
 *
 * THE PRICE, AND WHAT KIND OF PRICE IT IS. Two constructed false fires, both
 * the comma form of the accepted cost named directly above (`Manager, Green
 * Jobs in Ontario` and `Senior Engineer, Green Jobs in Ontario at Hydro One`).
 * THE UN-PUNCTUATED TWIN OF EACH ONE ALREADY DROPS UNDER THE SHIPPED RULE
 * TODAY — measured, and asserted below as a documented-known control. So this
 * change creates no new failure MODE; it stops punctuation from accidentally
 * shielding a cost B15-01 already named, priced and shipped. `LISTING_TITLE_RE`
 * is NOT touched by this item — not one byte — so B13-02's and B15-01's count
 * locks stand by construction, and Ruling 46a is not re-opened.
 *
 * ROUTES MEASURED AND REJECTED, recorded so they are not re-proposed: adding
 * `jobright.ai` to AGGREGATOR_HOSTS (dead on a number — the path contains
 * `2026`, so `POSTING_ID_RE` matches and the aggregator branch returns false);
 * making the leading count optional (Ruling 46a); and a `(1000+)`-in-the-heading
 * rule (structurally impossible — this guard never sees the page).
 */
/** The final path segment, and the head of it up to a job noun. */
const TOPIC_LANDING_LEAF_RE =
  /^([a-z0-9,.&()-]*?-(?:jobs|vacancies|openings))(?:-[a-z0-9,.&()-]+)?$/i;
/** A query is a noun phrase. A role title uses function words. CLOSED class. */
const TOPIC_LANDING_FUNCTION_WORD_RE =
  /(?:^|-)(?:of|for|and|or|to|with|in|on|at|the|a|an)(?:-|$)/i;
/** `<content word> <job noun> in|near …` — the search-results title grammar. */
const TOPIC_LANDING_TITLE_RE =
  /(?:^|\s)(?!(?:of|for|and|or|to|with|in|on|at|the|a|an|&)\s)[\w&/,.()-]+\s+(?:jobs|vacancies|openings)\s+(?:in|near)\b/i;

function isTopicLandingPage(title: string, pathAndQuery: string): boolean {
  const leaf = (pathAndQuery.split("?")[0] ?? "").split("/").filter(Boolean).pop();
  if (!leaf) return false;
  const match = TOPIC_LANDING_LEAF_RE.exec(leaf);
  if (!match) return false;
  const head = match[1] ?? "";
  if (TOPIC_LANDING_FUNCTION_WORD_RE.test(head)) return false;
  const phrase = head.replace(/-/g, " ").toLowerCase();
  if (!title.trim().toLowerCase().startsWith(`${phrase} `)) return false;
  return TOPIC_LANDING_TITLE_RE.test(title);
}

/** Aggregators whose deep links are fine but whose listing pages are noise. */
const AGGREGATOR_HOSTS = [
  "indeed.com",
  "glassdoor.com",
  "ziprecruiter.com",
  "simplyhired.com",
  "monster.com",
  "careerjet.com",
  "jooble.org",
  "neuvoo.com",
  "talent.com",
];

/**
 * Titles that name a careers section rather than a role. An employer's
 * "/careers" index passes every job-shaped heuristic but is not something the
 * user can apply to.
 *
 * B16-01 (round 16, Ruling 47b): `internships` added, and it is ONE WORD — not
 * a new class and not a new vocabulary. `lco.global/about/interns` is an
 * internships PROGRAMME INDEX that reached the job pool in 5 of 5 pulls in each
 * of rounds 13, 14, 15 and 16, rendering the bare word `Internships` as its
 * role title. The card promises a vacancy and names no role: not the field, not
 * the term, not the closing date, not whether it is even open.
 *
 * WHY THE TITLE AND NOT THE URL, measured rather than argued. The obvious fix
 * is a URL rule, as B13-02/B14-01/B15-01 all shipped. All three URL routes were
 * scored and all three are WORSE: `/about/` unconditional has FOUR false fires,
 * two of them ordinary real postings (`/about/careers/battery-engineer`,
 * `/about/jobs/1234`) — employers really do file careers pages under `/about/`;
 * the conditional form still breaks B14-01's own `/about/t/team` must-keep; and
 * the leaf-word form (`/interns`, `/internships`) is a hand-written vocabulary
 * in a URL costume that STILL cannot reach the shape that matters most, an
 * employer's own `/careers/internships` index. This title rule reaches it on any
 * host at any path. Scored 184/184 end to end against the shipped corpus, zero
 * false fires, against a 177/184 baseline.
 *
 * LEGITIMACY OF THE DESTINATION IS NOT THIS RULE'S CRITERION, and the list
 * above is the proof: `Careers`, `Vacancies`, `Open Positions` and
 * `Opportunities` are all real places a real person can really apply. They are
 * dropped anyway, because a card whose whole role title is a section label
 * tells the reader nothing. `Internships` is the same kind of word as
 * `Opportunities`, in the same grammatical slot, doing the same job.
 *
 * **PLURAL ONLY, AND THE SINGULAR IS PRICED RATHER THAN ASSUMED.** Allowing
 * `internships?` has ONE FALSE FIRE, on the bare title `Internship` — a real
 * posting can be titled the bare singular; an index page is titled the plural.
 * Same narrowing B13-02 part 3 established for `LISTING_SECTION_TITLE_RE`,
 * re-measured on this item's own data rather than carried over on faith. The
 * singular is asserted below as a must-keep. **Do not add it.**
 *
 * B14-01's `lco.global/about/interns` must-keep row is deliberately UNTOUCHED
 * and still KEEPS, because it carries the role title `Battery Research
 * Scientist` — that row is the proof this is a title rule and not a URL rule,
 * and Ruling 47b is not authority to drop that URL on its path.
 *
 * One deliberate side effect, named rather than discovered later: this regex
 * has a SECOND call site, the employer-candidate veto chain (B13-01 Gap A), so
 * a segment reading the bare word `Internships` is now vetoed in the employer
 * slot too. That is correct — a section label is a section label in either
 * slot — and it inherits that chain's established honest-omission behaviour.
 */
export const CAREERS_INDEX_TITLE_RE =
  /^\s*(?:careers?|jobs?|vacancies|open(?:ings?)?|open positions?|current openings?|job openings?|work (?:with|for) us|join (?:us|our team)|employment|opportunities|internships)\s*$/i;

/**
 * B13-02 part 3 (round 13): a title that NAMES A SECTION rather than a role.
 * `Jobs at Battery Ventures Companies` and `Intern Jobs at Battery Ventures
 * Companies` (live, `jobs.battery.com`) are one board's listing views, not
 * postings. `LISTING_TITLE_RE` already knows the `jobs at …` shape but only
 * when the title also ends in a `| host.tld` tail — the tail is the gap. The
 * LEADING ANCHOR here is what makes the tail unnecessary: it is the difference
 * between this check and `LISTING_TITLE_RE`'s unanchored alternative.
 *
 * TWO NARROWINGS, EACH FORCED BY A COUNTEREXAMPLE B WROTE TO BREAK ITS OWN
 * FIRST DRAFT. C MUST NOT SIMPLIFY THEM BACK OUT:
 *  1. `for` is DELIBERATELY NOT in the preposition list. With it, the check
 *     false-fires on three plausible real role titles — `Jobs for Veterans
 *     Program Manager`, `Job for a Battery Engineer`, `Career for Life
 *     Coordinator`. Measured: 3 of 15 real postings destroyed with it, 0 of 15
 *     without, and no loss of catch (8/8 listings still fire). All three are
 *     asserted below as must-keeps.
 *  2. The section word must be PLURAL. Strictly narrower at no cost — same 8/8
 *     catch — and it removes the whole singular-role-title risk class.
 *
 * The deliberate trap `Jobs Data Analyst at the Bureau of Labor Statistics` — a
 * real posting whose role BEGINS with `Jobs` — does not fire, because the
 * preposition must follow the section word immediately. `Research positions at
 * CERN` does not fire either: `positions` is deliberately absent from the list,
 * since a real posting legitimately uses it.
 *
 * Ruling 39c's host-list preference was tested and is NOT what landed, for two
 * recorded reasons: Ruling 32's headline is "stop fixing it one site at a
 * time", and the host route's safety rests on an unmeasured assumption about
 * `jobs.battery.com`/`linkedin.com` posting-URL shapes. If a later round finds
 * a board listing view with no section-form title, the host list is the right
 * second tool — kept here as a tested lead so it is not re-derived.
 */
const LISTING_SECTION_TITLE_RE =
  /^\s*(?:[\w&/-]+\s+)?(?:jobs|vacancies|openings|careers)\s+(?:at|in|near|with)\b/i;

/**
 * B17-01 (round 17, Ruling 49a): AN EMPLOYER'S OWN INTERNSHIP/PROGRAMME
 * BROCHURE PAGE, admitted as if it were a vacancy. Two live instances, both in
 * round 17 A's census: `enersys.com/en/careers/enersys-internship-program`
 * (5 of 5 pulls, role title `EnerSys Internship Program: Powering Future
 * Innovators`) and `ev.careers/catl-internships` (1 of 5, role title
 * `CATL Internships`). Both are BROCHURES — they name a programme and no role,
 * no field, no term, no closing date, and nothing to apply to. Same class
 * B16-01 closed on `lco.global`, arriving in two shapes its whole-title,
 * bare-word vocabulary could never reach: one carries a brand BEFORE the noun,
 * the other a marketing tagline AFTER a colon.
 *
 * **TWO CHECKS, NOT ONE, AND THE SPLIT IS SETTLED BY EXECUTION RATHER THAN BY
 * TASTE.** The tempting unified rule — normalise away the tagline and the
 * `Program(me)` suffix, then test for a section label with an owner in front —
 * reaches both pages with one statement. It also **DESTROYS `M.S. Internship
 * Program – Oregon Center for Electrochemistry`**, a posting round 11 A fetched
 * directly, scored CORRECT, and described as "an own-domain research center
 * hosting its own internship posting". Both its full title and the segment the
 * card renders (`M.S. Internship Program`) fire the unified rule, because
 * grammatically the Oregon posting and the EnerSys brochure ARE THE SAME
 * STRING. Measured by B on 92 rows and re-measured by C on 95: the unified rule
 * is worth **+1 net while destroying real postings**, dead on the asymmetry
 * B14-01 named — a miss costs the status quo, a false fire destroys a whole
 * real posting. Ruling 49a refused to reclassify the Oregon page to make the
 * one-signal design available: that would be rounding the corpus to fit the
 * fix. **Do not merge these two checks.**
 *
 * **THE SECOND CHECK IS NOT A PATCH ON THE FIRST — IT CARRIES A CONFIRMING
 * STRUCTURAL TOKEN THE FIRST DOES NOT NEED**, the same discipline
 * `FORUM_THREAD_URL_RE` (an id or a filename) and `NAV_CHROME_SEGMENT_RE`
 * (verb + job noun) already ship. Check (a) needs no host relation because a
 * bare `<Owner> Internships` is a section label whoever hosts it. Check (b)
 * admits the far looser `<X> Internship Program` shape ONLY when `<X>` is the
 * site's own brand, so it is a TITLE/HOST RELATION AND NOT A HOST LIST —
 * `Acme Fellowship Program` at an unrelated host is kept, and is asserted.
 *
 * **THE `of` TRAP.** Check (a)'s unnarrowed form destroys four ordinary HR and
 * university role titles — `Head of Careers`, `Head of Careers - Imperial
 * College London`, `Manager of Vacancies`, `Head of Internships` (C measured
 * six on a corpus carrying two more). The narrowing is not invented:
 * `TOPIC_LANDING_FUNCTION_WORD_RE` above already ships a closed function-word
 * list for exactly this reasoning ("a query is a noun phrase; a role title uses
 * function words"), and `LISTING_SECTION_TITLE_RE` excludes `for` on the same
 * grounds. Six false fires → zero, no catch lost. `positions` is deliberately
 * absent from the section-noun list for the same reason it is absent above:
 * `Research positions at CERN` is a shipped must-keep.
 *
 * **THESE ARE THEIR OWN CONSTANTS, READ ONLY BY `isListingPage`, AND THAT IS
 * LOAD-BEARING RATHER THAN STYLISTIC.** The obvious move is to widen
 * `CAREERS_INDEX_TITLE_RE` again, as B16-01 did. That regex has a SECOND call
 * site — the employer-candidate veto chain — where a brand-prefixed section
 * label is NOT furniture but a real employer with careers chrome attached,
 * which `stripTrailingCareersChrome` exists to recover. Measured on the shipped
 * chain: widening it turns `Tesla Careers` → `Tesla` and `Kairos Power Careers`
 * → `Kairos Power` into SILENCE, and breaks the shipped `Idaho National
 * Laboratory Careers` assertion outright. A BARE section label is a section
 * label in either slot; a BRAND-PREFIXED one is a company name wearing a
 * suffix. Two end-to-end assertions below fail if these shapes are ever moved
 * into the shared regex, which is the point of them.
 *
 * **THE NAMED MISS, RECORDED SO A LATER WIDENING IS A DELIBERATE ACT RATHER
 * THAN A DRIFT:** a THREE-token owner (`Idaho National Laboratory
 * Internships`) is NOT caught. The three-token budget that catches it scores
 * 95/95 on C's corpus against the recommended design's 94/95, and it is
 * refused today for one reason: the miss costs only the status quo, while the
 * widened form is one careless edit away from breaking the shipped
 * `Idaho National Laboratory Careers` employer assertion if a later round ever
 * moves it into the shared regex. Asserted below as a known miss.
 *
 * ROUTES MEASURED AND REJECTED, so they are not re-proposed: a URL rule / leaf
 * vocabulary / host list (three false fires, one of them B16-02's own named
 * accepted cost, and it cannot reach EnerSys at all); the colon tagline as a
 * signal on its own (it destroys `Internship Program: Battery Characterization
 * Track`, a real posting whose colon introduces a track rather than a slogan).
 *
 * Failure direction: a brochure shape outside these two grammars survives —
 * the status quo, never a new wrong value.
 *
 * **ROUND 21, ITEM 1 (A21-01): `jobs` ADDED TO THE SECTION-NOUN LIST HERE, AND
 * TO NOTHING ELSE.** `Internship EV Jobs` (@ `ev.careers/jobs/internship`) is a
 * category page that rendered as a single job card on 5 of 5 pulls; the page's
 * own `og:description` says it lists many employers' jobs. The omission was an
 * INCONSISTENCY, not a decision, and this file's own comments prove it: `jobs`
 * is already in `CAREERS_INDEX_TITLE_RE`, `LISTING_SECTION_TITLE_RE` and
 * `TRAILING_CAREERS_CHROME_RE`, and the one word that IS deliberately excluded
 * (`positions`, five lines above) is recorded as such. Nothing was ever
 * recorded about `jobs`.
 *
 * Measured before shipping: 387/387 shipped assertions unchanged, and the two
 * larger designs were both refused ON A NUMBER rather than on taste — adding
 * `jobs` to `BRAND_PROGRAMME_TITLE_RE` as well scores identically, so no test
 * can turn it red; and a host-brand rule cannot reach this row at all, because
 * `looksLikeHostBrand("EV", "ev.careers")` is false. Both re-executed by round
 * 21 C, not taken on trust.
 */
const OWNER_INDEX_TITLE_RE =
  /^\s*([\w&.'’-]+)(?:\s+([\w&.'’-]+))?\s+(?:internships|jobs|careers|vacancies|opportunities|openings)\s*$/i;
/** A role title uses function words; an owner's name does not. CLOSED class. */
const INDEX_OWNER_FUNCTION_WORD_RE =
  /^(?:of|for|and|or|to|with|in|on|at|the|a|an)$/i;

/** (a) An owner's name in front of a plural careers-section label. */
function isOwnerSectionIndexTitle(title: string): boolean {
  const m = OWNER_INDEX_TITLE_RE.exec(title);
  if (!m) return false;
  return ![m[1], m[2]].some((w) => w && INDEX_OWNER_FUNCTION_WORD_RE.test(w));
}

const BRAND_PROGRAMME_TITLE_RE =
  /^\s*([\w&.'’-]+)\s+(?:(?:internship|graduate|apprenticeship|co-?op|fellowship|placement|trainee)s?\s+program(?:me)?s?|internships|careers|vacancies|opportunities|openings)\s*(?::[^:]*)?$/i;

/** (b) The SITE'S OWN brand in front of a programme designation. */
function isHostBrandProgrammePage(title: string, host: string): boolean {
  const m = BRAND_PROGRAMME_TITLE_RE.exec(title);
  if (!m) return false;
  return looksLikeHostBrand(m[1] ?? "", host);
}

/**
 * B28-01 (round 28, item 1; Ruling 76b): A28-01's CONJOINED SECTION LABEL.
 * A whole title that is nothing but careers-section or audience nouns joined
 * by `&`/`and` — `Internships & Co-ops`, `Battelle Internships and Co-ops`,
 * `Students and Graduates` — is the same class B16-01/B17-01 already close,
 * arriving in a shape none of the five existing title-side checks reads:
 * `CAREERS_INDEX_TITLE_RE` is a bare SINGLE section word, so a second noun
 * joined by a conjunction escapes it; `isOwnerSectionIndexTitle` allows one
 * trailing section noun, not two joined by a conjunction; and
 * `isHostBrandProgrammePage` requires the site's OWN brand in front, which a
 * bare `Summer Internship Program` does not carry. This is designed INSIDE
 * round 16's frame (B16-01/Ruling 47b): a TITLE rule, no URL clause and no
 * host list (destination legitimacy is not the criterion — these are real
 * places a real person can apply, dropped because the title itself names no
 * role); the section nouns stay PLURAL; and it is its OWN constant with ONE
 * call site inside `isListingPage`, never folded into `CAREERS_INDEX_TITLE_RE`
 * — that regex has a second call site, the employer-candidate veto chain
 * (B13-01 Gap A), where widening it would turn `Tesla Careers` and
 * `Kairos Power Careers` into silence.
 *
 * SHAPE TWO — a modifier directly in front of a bare `Internship Program`
 * (`Summer Internship Program`, `Science Undergraduate Laboratory
 * Internships (SULI)`) — is MEASURED AND REFUSED, on Ruling 49a's own
 * evidence: a rule of the form `^<modifier> Internship Program$` DESTROYS
 * `M.S. Internship Program`, the segment round 11 A fetched and scored
 * CORRECT for the Oregon Center for Electrochemistry posting. Recorded as a
 * named accepted miss, not designed for.
 *
 * THE `of`-TRAP NARROWING, carried forward from B17-01/49a: an owner or
 * modifier token BEFORE either noun may not be a function word
 * (`of|for|and|or|to|with|in|on|at|the|a|an`) — `INDEX_OWNER_FUNCTION_WORD_RE`
 * above is that same closed class, reused rather than redefined. Without it,
 * `Head of Careers` and `Director of Careers and Opportunities` would fire;
 * with it, neither can, because `of` can be neither a modifier nor a noun and
 * nothing else in the title is section vocabulary.
 *
 * THE TITLE HEAD, NOT THE RAW STRING. Applied to the segment before the
 * title's first ` | `, ` - ` or `: ` separator — the same head the card
 * itself renders once the raw title is split (`webResultToRawJobItem`'s own
 * `roleTitle`, below). A trailing `- Youth & Young Adult Programs ...` on an
 * otherwise ordinary role title must not make the WHOLE title read as a
 * section label.
 *
 * `positions` IS DELIBERATELY ABSENT from the noun list, the third time in
 * this file and for the same reason: `Research positions at CERN` is a
 * shipped must-keep.
 *
 * FAILURE DIRECTION: the rule can only REMOVE a card. A programme page
 * outside this grammar survives exactly as it does today — no admission
 * changes, ever, on this clause.
 */
const CONJOINED_SECTION_NOUN_RE =
  "(?:internships|jobs|careers|vacancies|opportunities|openings|fellowships|co-ops|students|graduates|undergraduates)";
const CONJOINED_SECTION_TRAILING_RE = "(?:programs|programmes)";
const CONJOINED_SECTION_MODIFIER_RE =
  "(?!(?:of|for|and|or|to|with|in|on|at|the|a|an)\\b)[\\w&.'’-]+";
const CONJOINED_SECTION_LABEL_RE = new RegExp(
  "^\\s*" +
    `(?:${CONJOINED_SECTION_MODIFIER_RE}\\s+){0,2}${CONJOINED_SECTION_NOUN_RE}` +
    "\\s+(?:&|and)\\s+" +
    `(?:${CONJOINED_SECTION_MODIFIER_RE}\\s+){0,2}${CONJOINED_SECTION_NOUN_RE}` +
    `(?:\\s+(?:${CONJOINED_SECTION_MODIFIER_RE}\\s+){0,2}(?:${CONJOINED_SECTION_NOUN_RE}|${CONJOINED_SECTION_TRAILING_RE}))?` +
    "\\s*$",
  "i",
);
/** The segment before the title's first ` | `, ` - ` or `: ` separator. */
function conjoinedSectionLabelHead(title: string): string {
  const idx = title.search(/\s\|\s|\s-\s|:\s/);
  return (idx === -1 ? title : title.slice(0, idx)).trim();
}
function isConjoinedSectionLabelTitle(title: string): boolean {
  return CONJOINED_SECTION_LABEL_RE.test(conjoinedSectionLabelHead(title));
}

/**
 * ROUND 21, ITEM 2 (A21-02): A LINK A READER CANNOT FOLLOW.
 *
 * `jobs.manchester.ac.uk/Job/GetJobAdvertDocument?Id=` shipped as a card with a
 * working-looking apply link. The `Id` is EMPTY and the response body is nine
 * bytes — no title, no heading, no posting. It is the first link-integrity
 * defect this loop has recorded.
 *
 * **THE SIGNAL IS CLOSED AND COSTS ZERO FETCHES:** an identifier-NAMED query
 * parameter with an EMPTY value, on a path that carries no posting identifier
 * of its own. Both facts are already in the URL Peer has parsed.
 *
 * **TWO CONJUNCTS, EACH LOAD-BEARING ON ITS OWN SHARP CASE** (measured by
 * mutation; the round-21 live row `careers.inl.gov/job/1515?lastSelectedFacet=`
 * turned out to be protected by BOTH, so neither conjunct could be proved on
 * it and each needed its own case):
 * - drop conjunct 1 and an empty NON-identifier parameter on a slug path
 *   (`/jobs/battery-scientist?lastSelectedFacet=`) is wrongly dropped;
 * - drop conjunct 2 and a posting whose id is in the PATH
 *   (`/job/88123?reqId=`) is wrongly dropped.
 *
 * **THE FETCH ROUTE IS PRICED AND REFUSED** (Ruling 57a): catching a
 * well-formed URL that merely 404s needs a per-row HEAD/GET — 115 extra round
 * trips per cache-miss build on round 21's own offered-row count. **This item
 * closes the EMPTY-IDENTIFIER shape only; a well-formed URL that 404s is NOT
 * covered, and that boundary is stated rather than implied.**
 *
 * Failure direction: a dead link whose URL is well-formed survives — the
 * status quo, never a new wrong value. The guard can only remove a card.
 */
const EMPTY_IDENTIFIER_PARAM_RE =
  /[?&](?:[\w-]*id|jk|gh_jid|req|requisition|vacancy)=(?:&|$)/i;
function hasEmptyPostingIdentifier(pathAndQuery: string): boolean {
  if (!EMPTY_IDENTIFIER_PARAM_RE.test(pathAndQuery)) return false;
  return !/\d{4,}/.test(pathAndQuery.split("?")[0] ?? "");
}

/**
 * A posting URL almost always carries a numeric or long opaque identifier.
 *
 * **KNOWN AND DELIBERATELY LEFT ALONE (round 21, item 2):** `[?&](?:…|id)=`
 * matches `?Id=` whether or not anything follows it, so on an AGGREGATOR host
 * this regex positively believes an empty identifier IS an identifier — the one
 * thing keeping `isListingPage`'s last line from dropping the row. **That hole
 * is closed by `hasEmptyPostingIdentifier` running BEFORE `isListingPage`, not
 * by editing this regex**, which has other call sites and was ranked by B as a
 * latent finding rather than a defect. Asserted in the suite on `indeed.com`.
 */
const POSTING_ID_RE = /\d{4,}|[?&](?:jk|jobId|gh_jid|id)=/i;

/**
 * A title segment that names only an internship cohort or season, not a
 * company — "Battery R&D Intern - Summer 2027 - Acme Corp" split on its own
 * separators leaves "Summer 2027" as a candidate segment, and nothing
 * checked whether a segment actually reads like a company before accepting
 * it. `KNOWN_JOB_BOARD_DOMAINS` only screens out a specific denylist of job
 * board hostnames, which a season label obviously never matches, so it
 * passed straight through (R7).
 */
const SEASON_COHORT_LABEL_RE =
  /^(?:spring|summer|fall|autumn|winter)\s+20\d{2}$|^class\s+of\s+20\d{2}$|^cohort\s+\d+$|^20\d{2}$/i;

/**
 * A trailing-state-code build regex, matching the whole candidate segment
 * against real, uppercase US state codes (case matters — see
 * `structured-extract.ts`'s `hasTrailingStateCode`, which this mirrors).
 * `US_STATE_CODES` is imported, not re-declared, so the two lists cannot
 * drift apart.
 */
const TRAILING_STATE_CODE_RE = new RegExp(`,\\s*(${US_STATE_CODES.join("|")})$`);

/**
 * Phase 3 round 6 C, ITEM 6 (J7, Rulings 123f/123g item 6). A SECOND,
 * STRUCTURAL (not vocabulary) location signal, alongside the state-code
 * check above — a trailing US ZIP code. Live witness (J7, Phase 3 round 4
 * A): `diedremoire.com/Battery-Materials-Research-Scientist-Lansing-MI-
 * 1044-1-11021.html` renders company `"Lansing, MI, Michigan, 11021"` — this
 * string IS location-shaped (the state code "MI" is right there) but
 * `TRAILING_STATE_CODE_RE` above requires the candidate to END in a bare
 * two-letter code, and this one ends in a 5-digit ZIP with "MI" sitting in
 * the MIDDLE, so the anchored regex misses it even though a human reads
 * this as an obvious address.
 *
 * A genuinely disjoint, ADDITIVE shape — not a widening of
 * `TRAILING_STATE_CODE_RE`'s own contract, which stays byte-unchanged
 * (regression-tested in jobweb.test.ts). n=1 live witness, shipped anyway on
 * the same precedent as F8/F9/J2 (each shipped on exactly one live witness),
 * because the signal is structural/numeric-shaped rather than a vocabulary
 * guess — the same "closed by construction, not by English" reasoning
 * `POSTING_ID_RE`'s own digit-run check and `TRAILING_STATE_CODE_RE`'s own
 * closed code list already rely on.
 *
 * CHECKED AGAINST A DIFFERENT MECHANISM IN THE SAME GUARD CHAIN THAT
 * DELIBERATELY DOES THE OPPOSITE FOR A RELATED SHAPE, so the two do not
 * fight: `trimEmployerAddressTail` (Ruling 49b/62d, below) TRIMS a
 * winning candidate that is ONLY a full "City, State, Country" address
 * rather than rejecting it to blank ("Alameda, California, United States"
 * stays visible whole — Ruling 49b, "a hidden defect is worse than a
 * deferred one"). That case does NOT end in a ZIP, so this check is inert on
 * it; the two mechanisms answer genuinely different questions
 * (`trimEmployerAddressTail` only ever runs on the WINNER, after this guard
 * chain has already rejected or passed every candidate) and neither can
 * reach the other's own territory.
 */
const TRAILING_ZIP_RE = /,\s*\d{5}(?:-\d{4})?$/;

/**
 * A title segment shaped like a bare US address ("Cambridge, MA") is a
 * location, not a company (B5-03/R7) — the same structural signal
 * `hasTrailingStateCode()` in structured-extract.ts already uses to keep a
 * bare address out of the event WHERE tile (B4-02/R2), applied here to keep
 * one out of the job company slot instead.
 */
function looksLikeBareLocation(candidate: string): boolean {
  const match = candidate.match(TRAILING_STATE_CODE_RE);
  if (match && match[1] === match[1].toUpperCase()) return true;
  // Phase 3 round 6 C, ITEM 6 (J7) — see TRAILING_ZIP_RE above.
  return TRAILING_ZIP_RE.test(candidate);
}

/**
 * A23-01(c) / Ruling 62d. A candidate the search provider TRUNCATED. Mirrors
 * `TRUNCATED_TITLE_RE` (`enrich.ts:160`) rather than importing it: that one
 * repairs a page title from its own heading, this one vetoes an employer
 * candidate, and the two must be free to diverge. End-anchored, because a
 * mid-string ellipsis is a different shape entirely.
 */
const TRUNCATED_CANDIDATE_RE = /(?:\.\.\.|…)\s*$/;

/**
 * A23-01(c) / Ruling 62d. A university or college CAREERS OFFICE, which posts
 * other organisations' vacancies and is not the employer of any of them.
 * `CAREERS_INDEX_TITLE_RE` already rejects the bare word `Careers` but not
 * `Career Services`, the live render on
 * `Nuclear Engineering Internship Summer 2027 - Career Services`.
 *
 * Deliberately a SEPARATE constant from `CAREERS_INDEX_TITLE_RE` and consulted
 * only in the employer chain: that one has a second call site in
 * `isListingPage`, where widening it would start DROPPING rows, and Ruling 55c
 * holds a row-dropping guard to a higher standard than this one has met.
 *
 * VACUITY, STATED AGAINST C's OWN INTEREST: only `Career Services` is earned by
 * a live row. The other three are the same closed class, and unlike
 * `ORG_DESIGNATOR_RE` — whose every token can only ADMIT a name that is silent
 * today — every token HERE can only REMOVE one, so the list is kept as short as
 * the shape allows and is whole-segment anchored so no real name can match it.
 */
const CAREERS_OFFICE_LABEL_RE =
  /^\s*careers?\s+(?:services?|centers?|centres?|offices?)\s*$/i;

/**
 * ROUND 30, RULING 81a (B's item 1, the three-clause partial that discharges
 * Ruling 79b's commission). Ruling 79b asked for a full positive-organisation
 * test separating real employer acronyms (`BD`, `INL`, `BMS`, `Tesla`) from
 * department/programme acronyms (`CSE`) reaching the same slot. B measured,
 * on the full recorded corpus, that **no honest signal exists**: both shapes
 * are short, both are ALL-CAPS-or-title-case, both arrive via the identical
 * `titleEmployer` "at X" capture, and telling them apart requires knowing
 * what the letters STAND FOR — semantic knowledge no regex classifier has
 * (see `ORG_DESIGNATOR_RE` above, already refused for the same reason under
 * Ruling 62d). **That full test is not built here, and is not claimed to be
 * built.**
 *
 * **TWO OF THE THREE DESIGNED CLAUSES SHIP HERE.** The third,
 * `CAREERS_OFFICE_HEAD_RE` (a HEAD-anchored careers-office label, meant to
 * reach `Career Connections Center University of Florida`), was implemented
 * exactly as designed and then measured, on the FIRST gate run, to also veto
 * the shipped must-keep `Career Services International Ltd`
 * (`jobweb.test.ts`, "is WHOLE-SEGMENT anchored — a real name CONTAINING the
 * phrase survives", B13-01 Gap A) — the same collision that guard's own
 * whole-segment anchor was built to avoid. A head anchor with no end anchor
 * is REQUIRED to reach past the trailing institution name in the target
 * string, so the collision is structural, not a tuning slip. Per this
 * round's own STOP protocol: not shipped, filed `POLICY — manager decides`
 * in the round log rather than redesigned inline. Round 30 C's own §4 entry
 * has the full measurement.
 *
 * The other two residuals from B's design are named and watched, not
 * solved: the `CSE`-class acronym collision (the true hard case above), the
 * segment-order problem (`Chemistry` / `Chemical Engineering` — 62d(a)'s own
 * held half, not reopened), and the `Medicinal Chemistry (Graduate Student
 * level) @ Septerna` shape (teaching `titleEmployer` to also recognise
 * `@ X` was already measured and explicitly DECLINED — see
 * `BOARD_SELF_NAME_RE`'s doc comment above — because `@` is far looser than
 * the shipped `at ` capture and a recovered value that comes back wrong is
 * not a win, Ruling 48a).
 */

/**
 * A ROLE/TITLE WORD, not an organisation name, reaching the employer slot.
 * Live and recorded instances: `Research Technologist 1`,
 * `Internship battery R&D`, `Co-ops`, `Membrane Scientist for
 * Electrodialysis`, and a fresh live catch of the bare word `Scientist`.
 *
 * **DELIBERATELY NARROW VOCABULARY, A CHOICE NOT AN OVERSIGHT.** `Associate`,
 * `Analyst`, `Coordinator`, `Manager`, `Director` are NOT in this list,
 * because those are realistic REAL FIRM-NAME suffixes (`Smith & Associates`
 * is a common consulting/law naming convention) — the false-drop risk of
 * including them was not measured and is not taken on faith.
 * `Engineer`/`Engineering` is also deliberately excluded: it is both a role
 * word and a legitimate business-name component, and this corpus's own
 * `Chemical Engineering` (a bare department noun, must-drop) and a
 * hypothetical `XYZ Engineering Ltd` (must-keep) cannot be told apart by the
 * word alone — left as part of the segment-order residual above, not
 * force-fit into this list.
 *
 * Failure direction: an unlisted role word survives — the status quo, never
 * a new wrong value.
 */
const ROLE_TEXT_CANDIDATE_RE =
  /\b(?:scientist|technologist|intern(?:ship)?s?|postdoc(?:toral)?|fellows?|researchers?|co-ops?)\b/i;

/**
 * A JOB-BOARD BRAND NAME expressed as a domain-shaped string, e.g.
 * `EV.Careers`. Tests the CANDIDATE STRING's own tail, not the page host.
 *
 * **A MEASURED, NOT ASSUMED, GAP.** `looksLikeHostBrand("EV.Careers",
 * "ev.careers")` returns FALSE — it only compares the candidate against the
 * host's FIRST DNS LABEL (`"ev"`, 2 characters), so the full board-brand
 * name clears that guard untouched. Today's shipped code is saved from this
 * only because `titleEmployer`'s "at Tesla" capture wins FIRST in the array
 * before `EV.Careers` (a later `employerSegments` entry) is ever reached —
 * the recorded corpus has no row where `EV.Careers` is the SOLE surviving
 * candidate. This clause closes that latent gap directly rather than relying
 * on priority-order luck.
 *
 * Failure direction: an unlisted board-brand domain string survives — the
 * status quo, never a new wrong value.
 */
const BOARD_DOMAIN_BRAND_RE = /\.(?:careers|jobs)$/i;

/**
 * A23-01(c) / Ruling 62d. `Nuclear Engineering Internship - Summer 2027 at
 * Kairos Power, Alameda, California, United States | Intern Insider` renders
 * the RIGHT employer with a full postal address welded on. The instruction is
 * TRIM, NEVER REJECT: rejecting would replace a mostly-right name with silence,
 * and the name is not wrong, only long.
 *
 * Applied to the WINNER, after the guard chain — never to candidates. That
 * ordering is load-bearing: trim `Cambridge, MA` before the chain runs and
 * `looksLikeBareLocation` no longer sees the trailing state code it exists to
 * catch, so a bare location would start rendering as an employer.
 *
 * The trigger is the LAST comma-part naming a gazetteer COUNTRY — not merely
 * "some part looks place-ish". A firm called `Smith, Jones & Co` must not be
 * cut down to `Smith`.
 *
 * A US-STATE-CODE ARM WAS BUILT AND REMOVED, because it is UNREACHABLE rather
 * than merely unearned: any candidate ending `, MA` is rejected by
 * `looksLikeBareLocation` before a winner exists to trim, and moving the trim
 * earlier to reach it is the forbidden ordering above. `Acme Energy Ltd,
 * Cambridge, MA` therefore stays silent — today's behaviour, asserted below so
 * the interaction is recorded rather than rediscovered.
 *
 * THE MULTI-WORD HEAD REQUIREMENT IS THE CLAUSE'S OWN SAFETY BOUNDARY, and C
 * added it after building the clause without one. A candidate that is ONLY an
 * address — `Alameda, California, United States` — has a single-word head, and
 * trimming it would print `Alameda` as an employer: still wrong, but no longer
 * VISIBLY wrong to a census reading the column. Ruling 49b's principle is that
 * a hidden defect is worse than a deferred one, so the whole address is left
 * standing where there is no multi-word name in front of it. Cost, stated
 * plainly: a genuine one-word employer with a full address welded on
 * (`Tesla, Fremont, California, United States`) is NOT trimmed — a miss, which
 * is the status quo, never a new wrong value.
 */
function trimEmployerAddressTail(candidate: string | undefined): string | undefined {
  if (!candidate) return candidate;
  const parts = candidate.split(",");
  if (parts.length < 2) return candidate;

  const tail = parts[parts.length - 1].trim();
  const isCountry = COUNTRY_NAMES.some(
    (name) => name.toLowerCase() === tail.toLowerCase(),
  );
  if (!isCountry) return candidate;

  const head = parts[0].trim();
  if (head.split(/\s+/).length < 2) return candidate;
  return head;
}

/**
 * A22-04(a) (round 22 C): the closed vocabulary that lets a title's trailing
 * parenthetical name an EMPLOYER rather than a place or a qualifier. See the
 * call site in `webResultToRawJobItem` for why this is required and for the
 * vacuity statement (only `Ltd` is earned by a live row).
 *
 * Anchored at the end of the candidate, so the designator has to be the thing
 * the name FINISHES on — `Ion Exchange Ltd.` qualifies, `Limited Openings` does
 * not.
 */
const ORG_DESIGNATOR_RE =
  /\b(?:ltd|limited|inc|incorporated|llc|llp|plc|pvt|corp|corporation|co|gmbh|ag|sa|bv|nv|ab|oy|as|pty|university|universit[ée]|institute|institut|laboratory|laboratories|labs?|college|hospital|foundation|academy|centre|center)\b\.?\s*$/i;

/**
 * Round 31 C (Ruling 84a, implementing B's item 1 §1.2 verbatim). A30-01:
 * `BALDER Project (Licensing Support for a Molten Salt Reactor)` rendered as
 * the employer for a real `psi.ch` internship posting. No existing guard's
 * vocabulary covers "Project" — a bare-word veto on "Project" was rejected
 * WITHOUT being built, because "Project" genuinely appears in real
 * organisation names (`Project44`, `Project HOPE`, `Project Management
 * Institute`, `The Manhattan Project`, `Project Canary`). The actual defect
 * is narrower and structural: a segment shaped
 * `<label> Project (<long descriptive qualifier>)`, where "Project" is the
 * last word before an opening parenthesis and the parenthetical itself reads
 * as a DESCRIPTION (multiple words, no institutional designator) rather than
 * a short qualifying tag (`(US)`, `(Ltd)`, `(PMI)`).
 */
const PROGRAMME_LABEL_TAIL_RE = /\bprojects?\s*\(([^()]{2,80})\)\s*$/i;

// Deliberately NOT the shipped ORG_DESIGNATOR_RE (which is END-anchored, for
// a different job — admitting a trailing parenthetical AS an employer name).
// This is an UNANCHORED presence check over the same vocabulary, used to ask
// "does this parenthetical smell like it is naming/describing an
// institution ANYWHERE in it" — deliberately excludes "co" and "as" from the
// shipped list, both high-collision bare short tokens unsafe unanchored.
//
// DO NOT "simplify" this back to the shipped, end-anchored `ORG_DESIGNATOR_RE`
// — the first draft of this veto did exactly that and let
// `Genome Research Project (Institute of Genomics)` through as a false
// positive, because "Institute" does not END that inner string. This
// unanchored form is the reason that adversarial case now survives.
const ORG_DESIGNATOR_ANYWHERE_RE =
  /\b(?:ltd|limited|inc|incorporated|llc|llp|plc|pvt|corp|corporation|gmbh|ag|sa|bv|nv|ab|oy|pty|university|universit[ée]|institute|institut|laboratory|laboratories|labs?|college|hospital|foundation|academy|centre|center)\b/i;

function looksLikeProjectLabelWithDescription(candidate: string): boolean {
  const m = candidate.match(PROGRAMME_LABEL_TAIL_RE);
  if (!m) return false;
  const inner = m[1].trim();
  if (ORG_DESIGNATOR_ANYWHERE_RE.test(inner)) return false; // e.g. "(... Institute)" -- let it through
  return inner.split(/\s+/).filter(Boolean).length >= 3; // a short tag ("(US)", "(PMI)") is not a description
}

/**
 * A whole-candidate sentence naming the HOSTING PLATFORM's own posting
 * boilerplate, not the employer (B10-01, items 1+2). `looksLikeHostBrand`
 * is deliberately one-directional — it only rejects a candidate no LONGER
 * than a DNS label of the host (`shared.ts`'s own doc comment) — so a long,
 * well-formed sentence like "Job posted on PostdocJobs.com" survives it
 * untouched, the same way a real, long employer name is designed to. No
 * real employer name is grammatically shaped like this: closed,
 * sentence-shape check, not a general parser, matching this file's own
 * "catch a known shape" convention used by `SEASON_COHORT_LABEL_RE` et al.
 */
const HOST_BOILERPLATE_PHRASE_RE =
  /^(?:job\s+posted\s+on|posted\s+by|listing\s+on|see\s+more\s+jobs\s+at)\s+\S/i;

function looksLikeHostBoilerplatePhrase(candidate: string): boolean {
  return HOST_BOILERPLATE_PHRASE_RE.test(candidate.trim());
}

/**
 * B12-06 (round 12): `openmc.discourse.group` rendered the employer as
 * `"Page 2"`. Round 12 A ranked it the worst single value of the round.
 *
 * **This is not "a missing pagination rule" — it is a missing FAMILY MEMBER.**
 * The event side has had a whole family of chrome checks since round 5
 * (`isGenericPageTitle`, `isAllGenericWords`, `isEventIndexPage`, the filename
 * and markup regexes, the bare-date and bare-location checks) whose shared job
 * is "this segment is site furniture, not a name" — its `GENERIC_TITLE_WORD_RE`
 * even lists `page` explicitly. The employer slot had **no member of that family
 * at all**: all six of its existing rejections ask "is this a known-bad KIND of
 * name", never "is this navigation". So Ruling 32's shape shows up here in its
 * plainest form — the slot is filled by whatever survives, and nothing was ever
 * asked to recognise furniture.
 *
 * The vocabulary of pagination and navigation controls is **genuinely closed**:
 * it is a finite set of UI affordances, not an open grammatical class, so this
 * is not §1x Ruling 37's trap. Same anchored, narrow, closed style as
 * `SEASON_COHORT_LABEL_RE` above.
 *
 * **The `^…$` whole-segment anchor is load-bearing** and the four hardest
 * must-survive cases are why: `Home Depot`, `Page Industries`, `First Solar` and
 * `Next Energy Technologies` are all real companies whose names BEGIN with a
 * rejected word. Same anchor `SEASON_COHORT_LABEL_RE` and
 * `CAREERS_INDEX_TITLE_RE` already use in this file.
 *
 * Ruling 32's question, answered from the render side: when every candidate is
 * rejected, `.find()` returns `undefined`, `company` is `undefined`, and the UI
 * **omits the employer line entirely**. No placeholder, nothing rejected
 * reinserted, and it is this field's own existing behaviour: round 12 A's census
 * already has six null employers rendering exactly that way.
 *
 * CORRECTION (B13-01, round 13): this comment originally named TWO render
 * sites. There are **FOUR**, and all four omit rather than substitute —
 * `cards/job-card.tsx:87` and `cards/feed-tile.tsx:535` guard on
 * `job.companyOrLab`; `cards/briefing-hero.tsx:133` and
 * `cards/briefing-quick-hit.tsx:49` build an array and
 * `.filter(Boolean).join(" · ")`, so the separator disappears with the value
 * and no dangling middle dot is left behind. Checked in the components, not
 * assumed. Anything added to the candidate veto chain below inherits this
 * same honest-omission behaviour on all four.
 *
 * B16-02 gap 2C (round 16, Ruling 47c/48a): THE ATS ACTION CONTROLS. This is
 * the PAIRED half of the two title narrowings above and it is NOT optional —
 * Ruling 48a requires it to land in the same change, for a reason that is a
 * measurement rather than a preference.
 *
 * **RECOVERING A DROPPED POSTING IS NOT A WIN IF IT COMES BACK WRONG.** Ruling
 * 32's mandatory question ("what renders?") runs backwards on that item: those
 * postings did not render wrongly, they did not render at all — so the question
 * is what renders when they come BACK. Run end to end: the Kairos posting
 * returns clean (`Kairos Power`), but `Molten Salt R&D Engineer - Search Jobs`
 * returns the employer **`Search`**. `parts.slice(1)` offers `Search Jobs`, it
 * clears all eight existing vetoes, and `stripTrailingCareersChrome` then
 * removes the trailing ` Jobs`. **Landing the drop fix alone would convert a
 * MISSING item into a WRONG one, and Ruling 23 ranks wrong data ABOVE missing
 * data.** This is what makes the field render honest silence instead.
 *
 * **AND THE DEFECT IS ALREADY LIVE WITHOUT ANY OF THIS ROUND'S CHANGES:**
 * `Battery Research Scientist - View Jobs` is KEPT by the shipped guard today
 * (`view` was never in the title rule's verb list) and renders the employer
 * **`View`**. Confirmed by executing the real chain, by B and again by C.
 * **EVIDENCE CLASS, STATED HONESTLY: LATENT, NOT LIVE** — no census has ever
 * recorded a `View` employer. Same class B13-01 Gap A recorded for itself.
 * Round 17's A looks for this shape live as its own line (Ruling 48a).
 *
 * **THE STRIP CANNOT BE THE FIX, AND THAT IS PROVED RATHER THAN ASSERTED.**
 * `stripTrailingCareersChrome` returns the ORIGINAL candidate when the strip
 * would empty it (`return stripped || candidate`), so even a widened strip hands
 * back `Search Jobs` unchanged. **Only the veto chain can produce silence** —
 * which is Ruling 32's own required answer.
 *
 * EVERY ADDED ALTERNATIVE IS WHOLE-SEGMENT ANCHORED AND EVERY ONE REQUIRES
 * VERB + JOB NOUN. **No bare single word is added** — `search` alone is NOT in
 * here and does not need to be, because this veto runs BEFORE the strip. That is
 * what lets eight adversarial real company names built from the very same verbs
 * survive (`Search Party Media`, `View Systems Inc`, `Find Therapeutics`,
 * `Browse AI`, `Best Buy`, `Top Glove Corporation`, `All Jobs Ltd`,
 * `Search Laboratories`), alongside B12-06's own four hardest. Scored 41/41,
 * zero real employers destroyed, against a 25/41 baseline. All asserted below.
 */
const NAV_CHROME_SEGMENT_RE =
  /^(?:page\s+\d+(?:\s+of\s+\d+)?|\d+\s+of\s+\d+|next|previous|prev|first|last|next\s+page|previous\s+page|home|back|(?:browse|search|find|view|see)\s+(?:all\s+)?(?:jobs?|careers?|openings?|opportunities|positions?|vacancies)|all\s+(?:jobs?|openings?|positions?|vacancies)|job\s+search)$/i;

function looksLikeNavChrome(candidate: string): boolean {
  return NAV_CHROME_SEGMENT_RE.test(candidate.trim());
}

/**
 * ROUND 21, ITEM 3(a) (A21-03): A JOB BOARD NAMING ITSELF IN THE EMPLOYER SLOT.
 *
 * `befjobs.breakthroughenergy.org` rendered the employer as
 * **`Breakthrough Energy Fellows Job Board`** — the board's own name, and
 * literally that page's `og:title`. The real employer is `Mantel`, named twice
 * over (in the role title after `@`, and in the URL path).
 *
 * The segment cleared all nine existing vetoes: it is a NAME, not a domain, so
 * `KNOWN_JOB_BOARD_DOMAINS` cannot see it, and `looksLikeHostBoilerplatePhrase`
 * matches a SENTENCE (`Job posted on …`), not a name. Ruling 32's shape in its
 * plainest form — the slot is filled by whatever survives, and nothing ever
 * asked "is this the board rather than the employer".
 *
 * **THE ADJACENCY REQUIREMENT IS THE CONFIRMING STRUCTURAL TOKEN, AND IT IS
 * WHAT KEEPS REAL EMPLOYERS ENDING IN `Board` ALIVE.** A job word must sit
 * IMMEDIATELY in front of the board noun, at the end of the segment.
 * `National Labor Relations Board` is the case that proves it: drop the
 * adjacency requirement and that real employer is wrongly vetoed (measured).
 * `Board of Regents` — this file's own named reason a trailing-word strip is
 * forbidden — cannot prove it either way, because its board noun is not at the
 * end; it is an ADMITTED CONTROL here, not evidence.
 *
 * **THE `@` SEPARATOR IS DELIBERATELY NOT TAUGHT TO `titleEmployer`.** B
 * measured recovering `Mantel` as a separate, larger change and declined it for
 * Ruling 48a's reason: recovering a value is not a win if it comes back wrong,
 * and `@` is far looser than the shipped `at ` capture (handles, address
 * fragments, `9am @ HQ`). The veto alone produces honest silence, which is
 * Ruling 32's own required answer. Recorded so a later round takes it up as its
 * own item rather than re-deriving it.
 *
 * Failure direction: an unlisted board noun survives — the status quo, never a
 * new wrong value.
 */
const BOARD_SELF_NAME_RE =
  /\b(?:jobs?|careers?|vacanc(?:y|ies)|hiring|talent|recruit(?:ment|ing))\s+(?:board|portal|site|hub|exchange|network|directory)$/i;

function looksLikeBoardSelfName(candidate: string): boolean {
  return BOARD_SELF_NAME_RE.test(candidate.trim());
}

/**
 * B17-02 (round 17, Ruling 48a's paired half, landed in the SAME commit as
 * B17-01 by Ruling 49b): A LIST OF PROGRAMME AREAS sitting where a company name
 * belongs. `ev.careers` renders the employer `Battery Cell, R&D & Gigafactory
 * Programs` where the real employer is CATL — a description of what a board
 * covers, not an organisation. Sighted live by round 17 A (minority, 1 of 5,
 * reported rather than let majority scoring delete it).
 *
 * **WHY THIS LANDS WITH THE DROP RATHER THAN AFTER IT, AND RULING 48a RUNS
 * BACKWARDS HERE.** 48a's literal trigger is a drop fix RESURRECTING an item
 * with a wrong value; that is not what happens this round — B17-01 removes the
 * brochure page that carries this value, so nothing is converted into anything.
 * It fires on the consequence instead. **The wrong value is a property of that
 * board's `<title>` template, not of the brochure page**, and it lands on
 * ordinary vacancies too: executed on the shipped chain,
 * `Battery Cell Engineer - Battery Cell, R&D & Gigafactory Programs -
 * EV.Careers` — a real posting shape on the same board — renders the identical
 * wrong employer. **Land B17-01 alone and this defect stops being VISIBLE
 * without stopping being REAL**: the only row a census could ever sight it on
 * has left the pool. Ruling 49b: a hidden defect is worse than a deferred one.
 *
 * **THE OBVIOUS REPAIR IS THE FORBIDDEN MOVE, MEASURED RATHER THAN ASSERTED.**
 * Adding `programs?` to `TRAILING_CAREERS_CHROME_RE` turns
 * `Battery Cell, R&D & Gigafactory Programs` into `Battery Cell, R&D &
 * Gigafactory` — a DIFFERENTLY WRONG value, which is exactly what Ruling 48a
 * forbids. It cannot ever produce silence either, because
 * `stripTrailingCareersChrome` returns the ORIGINAL candidate when the strip
 * would empty it. **Only the veto chain can produce silence**, which is Ruling
 * 32's own required answer. A must-keep below locks that widening out.
 *
 * **THE COORDINATION REQUIREMENT IS LOAD-BEARING AND MEASURED.** A list of
 * programme areas is a COORDINATED phrase — it carries `,` or `&` or `and`. A
 * real company name that merely ends in `Programs` does not. Dropping that
 * conjunct destroys five real names (`Advanced Technology Programs`,
 * `Head Start Programs`, `Youth Programs`, `Special Programs`,
 * `Wildlife Conservation Programs`), all asserted below as must-keeps. Same
 * "require a confirming structural token" discipline as
 * `NAV_CHROME_SEGMENT_RE` above.
 *
 * **THE TRAILING-NOUN LIST IS ONLY `programs` / `programmes`, AND A STRING
 * SWEEP FOUND THE NARROWING RATHER THAN INSPECTION.** The first draft also
 * allowed `careers` / `vacancies` / `openings` and fired on
 * `Research Fellow - Alphabet, Inc. Careers` — A SHIPPED ASSERTION expecting
 * the employer `Alphabet, Inc.` — because a real company name with a comma plus
 * trailing careers chrome is the same shape. Those words are
 * `TRAILING_CAREERS_CHROME_RE`'s territory and a candidate ending in one of
 * them is a real employer with chrome attached, which the strip recovers
 * correctly today. `programs` / `programmes` are the two words nothing owns.
 * Five destroyed real employers → zero.
 *
 * **NOT A HOST RULE.** `ev.careers` also hosts postings that render the correct
 * employer `Tesla` in this very round's census; Ruling 32's headline complaint
 * is "stop fixing it one site at a time".
 *
 * Failure direction: an uncoordinated programme-area label survives — the
 * status quo. And this is a VETO, not a blanket: a real employer later in the
 * chain still wins, which is asserted (`… - CATL - <vetoed> - EV.Careers`
 * renders `CATL`).
 */
const PROGRAMME_AREA_LIST_RE =
  /^[^,&]*(?:,|\s&\s|\sand\s)[^,]*\s(?:programmes|programs)$/i;

function looksLikeProgrammeAreaList(candidate: string): boolean {
  return PROGRAMME_AREA_LIST_RE.test(candidate.trim());
}

/**
 * A trailing chrome word left on an otherwise-real employer candidate that
 * has already cleared every guard below (B9-02a/R13) — "Idaho National
 * Laboratory Careers" names the real employer with a careers-page suffix
 * still attached, not a different kind of string.
 * `CAREERS_INDEX_TITLE_RE` above already rejects a *bare* title drawn from
 * this same vocabulary; this strips the identical short, closed word list
 * when it trails a longer, otherwise-accepted candidate, instead of
 * duplicating a new list. Deliberately narrow, matching this file's own
 * "catch known shapes, not a general parser" convention: a rule that
 * stripped any trailing capitalised word would eat a real org name that
 * legitimately ends in an ordinary word ("Board of Regents"). The leading
 * `\s+` also means a candidate that IS only this word, with nothing before
 * it to strip, is left untouched here — it is the guards above's business,
 * not this one's.
 */
const TRAILING_CAREERS_CHROME_RE =
  /\s+(?:careers?|jobs?|employment|job\s+openings?)$/i;

function stripTrailingCareersChrome(
  candidate: string | undefined,
): string | undefined {
  if (!candidate) return candidate;
  const stripped = candidate.replace(TRAILING_CAREERS_CHROME_RE, "").trim();
  return stripped || candidate;
}

/**
 * A research-subject/field label rendered as if it were the employer
 * (B9-02b/c/R13) — "Molten Salt Chemical and Electrochemical Engineering"
 * (`postdocjobs.com`), "Molten Salt Characterization"
 * (`careerservices.upenn.edu`, unchanged across two rounds). Both live
 * examples clear every guard above cleanly, because none of them has any
 * concept of "reads as a field of study, not an organisation."
 *
 * Fix direction B recommended (of two offered, chosen as "the safer
 * starting point"): reuse the profile's own search topics — which is
 * exactly what put this posting in the pool in the first place — rather
 * than a structural "field phrasing" grammar B explicitly warned risks
 * becoming a general parser. Two narrow, closed checks:
 *  1. The candidate IS one of the profile's own topics, verbatim
 *     (case/whitespace-insensitive) — a job's "employer" being literally
 *     the search topic that found it is never a real organisation name.
 *  2. The candidate STARTS WITH one of the profile's own topics as a
 *     whole-word prefix, and everything after it is drawn from a short,
 *     closed academic-field vocabulary (an adjective, "and", or a field
 *     noun) — the exact shape of both live-confirmed repros
 *     ("<topic> Characterization", "<topic> Chemical and Electrochemical
 *     Engineering"). Deliberately narrow and deliberately incomplete, per
 *     B's own framing: a real org name sharing one word with a topic
 *     ("Acme Molten Salt Technologies") survives, because the topic is not
 *     a PREFIX of the candidate (it's in the middle) and "Technologies" is
 *     not in the closed vocabulary — this under-catches on purpose rather
 *     than risk rejecting a real employer name.
 */
const FIELD_LABEL_CONTINUATION_WORD_RE =
  /^(?:and|chemical|electrochemical|mechanical|materials?|characterization|characterisation|engineering|chemistry|science|sciences)$/i;

function normalizeTopicText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function looksLikeTopicLabel(candidate: string, topics: string[]): boolean {
  if (topics.length === 0) return false;
  const normalizedCandidate = normalizeTopicText(candidate);
  if (!normalizedCandidate) return false;
  for (const topic of topics) {
    const normalizedTopic = normalizeTopicText(topic);
    if (!normalizedTopic) continue;
    if (normalizedCandidate === normalizedTopic) return true;
    if (!normalizedCandidate.startsWith(`${normalizedTopic} `)) continue;
    const remainder = normalizedCandidate.slice(normalizedTopic.length).trim();
    // Round 21, item 3, OPTIONAL LATENT CLOSURE. A truncation marker is not a
    // word: a provider that clips `Molten Salt Chemical and Electrochemical
    // Engineering` to `… Electrochemical ...` left a token that is not in the
    // closed continuation vocabulary, so the `every` below failed and a field
    // label reached the employer slot. **EVIDENCE CLASS: LATENT, NOT LIVE** —
    // no census has recorded this shape, and with item 3(b) shipped the two
    // rows that inspired it never reach this check. It closes NOTHING on its
    // own and is NOT counted as closing A21-03. Asserted on a constructed
    // hyphen-only title, which is the only way it can still be reached.
    const words = remainder
      .split(/\s+/)
      .filter(Boolean)
      .filter((word) => word !== "..." && word !== "…");
    if (words.length > 0 && words.every((word) => FIELD_LABEL_CONTINUATION_WORD_RE.test(word))) {
      return true;
    }
  }
  return false;
}

/**
 * True when the result is an aggregate listing or a careers index rather than
 * a single posting.
 *
 * Title shape is authoritative ("60 Molten Salt Jobs, Employment ...",
 * "CAREERS"). On known aggregator hosts we additionally require a posting
 * identifier in the URL, because their category pages
 * ("/Jobs/Battery-Research-Scientist/-in-San-Jose,CA") are indistinguishable
 * from postings by path shape alone. Employer sites are left alone so a real
 * posting at `/careers/internship-battery-research` still gets through.
 *
 * B13-02 (round 13) added three checks here, all in this one function because
 * this function is already this class's one home (Ruling 32). None of the five
 * pre-existing checks fired on ANY of round 13 A's four non-posting pool items;
 * each of the three additions carries exactly one of them, with no overlap.
 * B14-01 (round 14) and B15-01 (round 15) landed in the same home for the same
 * reason: `FORUM_THREAD_URL_RE` and `isTopicLandingPage` are both page-KIND
 * rules, and both run BEFORE the employer chain, so a wrong value cannot be
 * derived from an item that never exists.
 *
 * The single elegant rule — "require `POSTING_ID_RE` on every host" — was
 * considered and is NOT available: it drops
 * `hyetlithium.com/careers/internship-battery-research`, a real posting this
 * file's own tests already require to survive, and the doc comment above says
 * so deliberately. Recorded so nobody re-proposes it.
 */
/**
 * A29-04 (round 29 C, item 3). **THE FIX IS STRUCTURE, NOT VOCABULARY.**
 *
 * `ionexchangeglobal.com/int/careers/` — one site, one path, one section — is
 * DROPPED when it prints `Careers` and ADMITTED, as a role title, when it
 * prints `キャリア`. Round 29 B widened A's falsifier pair and measured the same
 * split on `Carrières`, `Empleo`, `Karriere`, `採用情報` and `Vagas`: **the
 * English label is refused and every other language reaches a reader as a job.**
 *
 * **WHY NOT JUST ADD THE WORDS.** Three separate reasons, all measured:
 *  1. A non-English section label is an **OPEN CLASS**. No list finishes, and
 *     every new locale is a new recorded miss forever.
 *  2. **RULING 37/40's TRAP, EXACTLY.** `jobs`/`careers` are ordinary nouns in
 *     real role titles — a leading-word budget false-fired 7 times, including
 *     `Head of Careers at Imperial College London`. **Every language's word for
 *     *career* is an ordinary noun in that language too, and there is no corpus
 *     in those languages to measure the false fires against.**
 *  3. **THE 76b/49a LOCK FORBIDS THE CHEAP ROUTE.** `CAREERS_INDEX_TITLE_RE`
 *     has a documented SECOND call site — the employer-candidate veto chain
 *     (B13-01 Gap A) — so widening it reaches the employer slot and can silence
 *     `Tesla Careers` / `Kairos Power Careers`. **It is not touched by this
 *     item, so that cannot happen by construction.**
 *
 * **THE DISCRIMINATOR THAT NEEDS NO VOCABULARY: a careers SECTION ROOT is a
 * path that ENDS at the section segment; a POSTING is a path that CONTINUES
 * past it.** It is **language-independent by construction** — it reads the URL
 * a site builds in ASCII, not the words a site prints. B measured **0 of 10
 * wrong**, with both live must-keep hosts (`lanl.jobs`, and `hyetlithium.com`'s
 * real posting path) classifying as POSTING so the rule cannot reach them.
 *
 * **THE PATH LIST IS A LIST TOO, AND ITS RESIDUAL IS STATED NOT HIDDEN.** Sites
 * overwhelmingly romanise path segments even when the page is not English —
 * `ionexchangeglobal.com` prints `キャリア` at `/int/careers/`, which is the whole
 * point — but **a site using a fully localised non-ASCII path would be a named
 * miss.** B did not sight one; neither did C.
 */
/**
 * ROUND 30, RULING 81b (B's item 2, the V2 structural-guard extensions,
 * approved as written). Two live specimens reproduced the class Ruling 80b
 * named ("a careers-explorer page"): `dmse.mit.edu/about-us/career-paths/`
 * and `physics.missouristate.edu/MaterialsScience/careers.htm`. Both fail
 * the ORIGINAL exact-equality anchor above for a shallow, structural reason,
 * not a vocabulary gap: `career-paths` is the ONE witnessed compound of an
 * already-recognised word, and `careers.htm` is an already-recognised word
 * with a static-page file extension still attached. **Both extensions are
 * additive to the closed vocabulary above, not a broadening of its shape** —
 * they let the SAME recognised nouns survive a page-serving suffix, and add
 * exactly the one compound actually seen live.
 */
const CAREERS_SECTION_SEGMENT_RE =
  /^(?:(?:careers?|jobs?|vacancy|vacancies|openings?|opportunities|employment|recruit|recruiting|recruitment|empleo|empleos|karriere|carrieres|vagas|werken-bij)(?:\.html?|\.php|\.aspx?|\.jsp)?|career-paths?)$/i;

/**
 * A29-04's conjunction, and **BOTH HALVES ARE LOAD-BEARING.**
 *
 * **THE PATH HALF.** The last non-empty segment must be a section word:
 * `/careers/` and `/int/careers/` and `/jp/recruit/` and `/careers/jobs/` are
 * section roots; `/careers/postdoc-2026` and
 * `/careers/internship-battery-research/` and `/jobs/12345` and
 * `/search/jobdetails/x/1` are postings.
 *
 * **A QUERY STRING ALSO CANNOT FIRE THIS RULE, AND IT COSTS NO CLAUSE TO SAY
 * SO.** C first wrote an explicit `includes("?")` guard for the board that
 * hangs a posting id off a section root (`/careers/?gh_jid=…`) — **and the
 * mandated revert proved it VACUOUS.** The input here is `pathAndQuery`, so the
 * query rides in the LAST segment and fails the section test on its own:
 * `/careers/?gh_jid=1234` ends at `?gh_jid=1234`, `/careers?gh_jid=1234` ends
 * at `careers?gh_jid=1234`, and neither matches. The redundant clause was
 * deleted rather than shipped; **the assertion it was written for is kept**, so
 * the protection is still checked by execution rather than by this paragraph.
 *
 * **THE TITLE HALF.** *"A real posting that happens to sit at `/careers/` with
 * a role-shaped title must not be dropped"* — B's boundary, verbatim. The role
 * test is the file's **already-shipped** `JOB_TEXT_RE`, chosen because
 * inventing a second role vocabulary inside a fix for a vocabulary problem is
 * the exact mistake this item exists to avoid. **RESIDUAL, NAMED:** a bare role
 * title with none of that vocabulary (`Battery Engineer`) sitting at a section
 * ROOT url would still be dropped. C did not sight one and does not claim the
 * class is empty.
 *
 * **ABSENT TITLE ⇒ THE RULE DOES NOT FIRE.** It is a kind rule, so a miss falls
 * to ADMISSION (item 1 §1.3), and a row with no title has already been dropped
 * upstream anyway.
 *
 * **NEITHER LOCKED CONSTANT IS TOUCHED.** `CAREERS_INDEX_TITLE_RE` keeps its
 * two call sites unchanged; `LISTING_URL_RE` is not read here at all, so the
 * aggregator behaviour 76b/B13-02 locked stays byte-identical.
 */
function isCareersSectionRoot(title: string, pathAndQuery: string): boolean {
  if (!title.trim()) return false;
  const segments = pathAndQuery.split("/").filter(Boolean);
  const last = segments[segments.length - 1];
  if (!last || !CAREERS_SECTION_SEGMENT_RE.test(last)) return false;
  return !JOB_TEXT_RE.test(title);
}

/**
 * ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — COMPONENT C: the live-confirmed
 * `jobright.ai` brand-only-title bypass. Additive; reuses the ALREADY-SHIPPED
 * `TOPIC_LANDING_LEAF_RE` and `looksLikeHostBrand` (`shared.ts:420-434`)
 * rather than inventing new vocabulary, and does NOT touch `isTopicLandingPage`
 * itself — zero risk to that function's own locked assertions.
 *
 * WHY THIS FIRES WHERE `isTopicLandingPage` DOES NOT. `isTopicLandingPage`
 * requires the offered TITLE to start with the URL-derived query phrase — a
 * corroboration check. `jobright.ai`'s live rows carry the SITE'S OWN BRAND
 * TAGLINE as the offered title instead of the per-query listing phrase, so
 * that corroboration check fails even though the URL-leaf evidence
 * (`TOPIC_LANDING_LEAF_RE`, a genuine `<query>-jobs-in-<location>` search
 * slug) is unambiguous.
 *
 * THE REASONING: a title that is purely `"<host's own brand>: <tagline with
 * no job vocabulary>"` supplies ZERO corroborating OR contradicting evidence
 * about the query — the same "absence is not evidence" doctrine A29-01/
 * family(ii) already applies to an empty snippet (`:1580-1601` below). When
 * title corroboration is structurally unavailable, the already-trusted
 * URL-leaf signal is allowed to stand un-contradicted rather than being read
 * as a title MISMATCH.
 */
function isBrandOnlySearchResultsPage(
  title: string,
  host: string,
  pathAndQuery: string,
): boolean {
  const leaf = (pathAndQuery.split("?")[0] ?? "").split("/").filter(Boolean).pop();
  if (!leaf || !TOPIC_LANDING_LEAF_RE.test(leaf)) return false;
  const idx = title.indexOf(":");
  if (idx === -1) return false;
  const brand = title.slice(0, idx).trim();
  const tail = title.slice(idx + 1).trim();
  if (!brand || !tail) return false;
  if (JOB_TEXT_RE.test(tail)) return false; // tail carries real job vocabulary -- not chrome
  return looksLikeHostBrand(brand, host);
}

export function isListingPage(
  title: string,
  host: string,
  pathAndQuery: string,
): boolean {
  if (FEED_PATH_RE.test(pathAndQuery)) return true;
  if (FORUM_THREAD_URL_RE.test(pathAndQuery)) return true;
  if (isTopicLandingPage(title, pathAndQuery)) return true; // B15-01
  if (LISTING_TITLE_RE.test(title)) return true;
  if (CAREERS_INDEX_TITLE_RE.test(title)) return true;
  if (LISTING_SECTION_TITLE_RE.test(title)) return true;
  if (isOwnerSectionIndexTitle(title)) return true; // B17-01a
  if (isHostBrandProgrammePage(title, host)) return true; // B17-01b
  if (isConjoinedSectionLabelTitle(title)) return true; // B28-01 / A28-01
  // A29-04: the ONE call site of the structural rule, and it is deliberately
  // ABOVE the aggregator gate. `isListingPage` already receives the path and
  // already has a `LISTING_URL_RE`, but `if (!isAggregator) return false;`
  // runs first — so on an ordinary employer's own site the path was **never
  // looked at at all**, which is exactly why `ionexchangeglobal.com`'s
  // `/int/careers/` was invisible.
  if (isCareersSectionRoot(title, pathAndQuery)) return true;
  // ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — COMPONENT C, additive, same
  // pattern as the `isCareersSectionRoot` call directly above.
  if (isBrandOnlySearchResultsPage(title, host, pathAndQuery)) return true;

  const isAggregator = AGGREGATOR_HOSTS.some(
    (h) => host === h || host.endsWith(`.${h}`),
  );
  if (!isAggregator) return false;
  if (LISTING_URL_RE.test(pathAndQuery)) return true;
  return !POSTING_ID_RE.test(pathAndQuery);
}
const JOB_TEXT_RE =
  /\b(job opening|job posting|open position|position available|vacanc(?:y|ies)|now hiring|we(?:'re| are) hiring|apply (?:now|today|for)|applications? (?:are )?(?:open|invited)|research (?:scientist|engineer|intern)|postdoc(?:toral)?|internship|r&d (?:scientist|engineer))\b/i;

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

interface BraveResult {
  title?: string;
  url?: string;
  description?: string;
}

export function webResultToRawJobItem(
  result: {
    title?: string;
    url?: string;
    snippet?: string;
  },
  // B9-02b/c (round 9): additive and optional, defaults to "no topics" so
  // every existing caller (this file's own two search functions before
  // this item, and every test in jobweb.test.ts) is unaffected unless it
  // opts in. The profile's own search topics — plumbed from JobsQuery,
  // which already carries them for scoring — are the signal
  // looksLikeTopicLabel needs.
  topics: string[] = [],
): RawJobItem | null {
  const title = cleanJobTitle(result.title);
  const url = result.url?.trim();
  if (!title || !url) return null;
  let parsed: URL;
  let host = "";
  try {
    parsed = new URL(url);
    host = parsed.hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  // Round 21, item 2 (A21-02). Before any field is derived: a link a reader
  // cannot follow is a wrong ITEM, not a wrong field.
  // Round 21, item 2 (A21-02). Before any field is derived: a link a reader
  // cannot follow is a wrong ITEM, not a wrong field.
  if (hasEmptyPostingIdentifier(`${parsed.pathname}${parsed.search}`)) return null;
  const text = `${title} ${result.snippet ?? ""}`;
  if (NON_JOB_PATH_RE.test(parsed.pathname)) return null;
  // ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — COMPONENTS A and B, same early
  // kind-rejection point as `NON_JOB_PATH_RE` directly above, same family,
  // same failure direction (row -> null, never a value change).
  if (isNonJobHost(host)) return null;
  if (isDateStructuredResearchPath(title, `${parsed.pathname}${parsed.search}`)) {
    return null;
  }
  // ROUND 29 C, ITEM 1 — **ABSENCE IS NOT EVIDENCE (family (ii)), JOB SIDE.**
  //
  // A29-01: 63 job rows were refused HERE while carrying an empty snippet, and
  // round 29 A proved 71 of 138 such rows admit once wording is supplied. This
  // gate is already a disjunction, so the change is exact and small: when the
  // snippet is EMPTY AFTER TRIM the text arm has nothing to read and **stops
  // voting**. It neither admits nor refuses.
  //
  // **THE TITLE STILL VOTES.** `text` is unchanged, so a title that names the
  // kind matches `JOB_TEXT_RE` and admits exactly as it does today. **"Absent"
  // means EMPTY, never "short"** — a present description, however brief, is
  // tested byte-for-byte as before.
  //
  // **THE GUARDS DO NOT WEAKEN TO NOTHING; ONE STARVED ARM STOPS VOTING.**
  // `NON_JOB_PATH_RE` runs ABOVE this line and still refuses. `isListingPage`
  // runs BELOW it, in both its arms, and still refuses — so B's adversarial
  // listing-page shapes drop exactly as they did. `hasEmptyPostingIdentifier`
  // and the URL checks above are untouched.
  //
  // No page-declared channel is read on this surface: channel L's `pageKind`
  // is an EVENT declaration and this mapper deliberately ignores it (B item 7
  // §7.2 — each surface keeps its own policy).
  const snippetAbsent = (result.snippet ?? "").trim() === "";
  if (
    !snippetAbsent &&
    !JOB_PATH_RE.test(parsed.pathname) &&
    !JOB_TEXT_RE.test(text)
  ) {
    return null;
  }
  if (isListingPage(title, host, `${parsed.pathname}${parsed.search}`)) return null;

  // Split "Postdoc in X - University of Y | board.com" style titles.
  //
  // ROUND 21, ITEM 3(b) (A21-03): THE SPLIT NOW KEEPS ITS SEPARATORS.
  // Hyphen, en dash, em dash, pipe and middot were all collapsed into one
  // class, so the split could not tell a role-internal dash from site chrome.
  // Both `postdocjobs.com` cards are `<role> – <specialisation> - <site
  // boilerplate>` — TWO different separator kinds in one title — and
  // `parts.slice(1)` handed the specialisation to the employer slot first,
  // rendering `Molten Salt Chemical and Electrochemical ...` and
  // `MSR Fuel Cycle` as employers. ONE edit closes BOTH cards.
  //
  // **THE "ALSO USES A CHROME SEPARATOR" CONJUNCT IS LOAD-BEARING AND IT IS
  // RULING 49a's LOCK.** `M.S. Internship Program – Oregon Center for
  // Electrochemistry` uses an en dash and NOTHING else, so nothing is excluded
  // and it still renders `Oregon Center for Electrochemistry`. Drop the
  // conjunct and that must-keep goes silent — measured, and asserted below.
  const splitParts = title.split(/\s+([-–—|·])\s+/);
  const parts = splitParts.filter((_, i) => i % 2 === 0);
  const separators = splitParts.filter((_, i) => i % 2 === 1);
  const usesChromeSeparator = separators.some((s) => s !== "–" && s !== "—");
  const employerSegments = parts
    .slice(1)
    .filter(
      (_, i) =>
        !(usesChromeSeparator && (separators[i] === "–" || separators[i] === "—")),
    );
  const roleTitle = parts[0]?.trim() || title;
  // The check above saw the full title; the card shows only this first
  // segment. "CAREER | Acme Corp" clears a whole-title test and then renders
  // as the bare word "CAREER", so the segment needs the same test.
  if (isListingPage(roleTitle, host, `${parsed.pathname}${parsed.search}`)) {
    return null;
  }
  // B6-04 (round 6): a result title can state the employer as "Role at
  // Employer" without any punctuation segment. Keep it in the existing
  // guarded candidate pool so it cannot bypass the board/location checks.
  // B8-01 (round 8): the character class had no space, so this could only
  // ever match a one-word employer ("at Tesla") and silently matched
  // nothing for the far more common multi-word case ("at Idaho National
  // Laboratory"), falling through to the older, unguarded parts.slice(1)
  // path below.
  //
  // The naive fix (just add a space to the character class) was tried and
  // rejected: with any char + space allowed, an unpunctuated title like
  // "... at Bell Labs remote position with great benefits" wrongly captured
  // the whole trailing clause as the employer, turning a silent absence
  // into wrong data - exactly the failure this loop treats as worse than
  // missing. Instead, the capture is a run of Title-Case words (each
  // starting with an uppercase letter, matching this file's own "catch
  // known shapes" style used by KNOWN_JOB_BOARD_DOMAINS et al.) optionally
  // joined by a small closed list of lowercase connectors real org names
  // use ("University of California", "Johnson & Johnson"). Ordinary lower-
  // case prose is not in that grammar, so it cannot be swallowed: the
  // repetition simply stops, and if what follows is not a separator or the
  // end of the string, the whole match fails and titleEmployer is
  // correctly undefined rather than a guess.
  //
  // B10-01 (round 10): "See more jobs at PostdocJobs.com" is one of the
  // closed hosting-platform boilerplate phrases `looksLikeHostBoilerplatePhrase`
  // rejects below, but its own "at X" shape would otherwise be captured
  // HERE first, before the candidate-pool guard chain ever sees the whole
  // sentence \u2014 the same platform name, stripped of the very words that mark
  // it as boilerplate. The negative lookbehind keeps that one closed lead-in
  // out of this capture so the full segment reaches the guard chain intact.
  const titleEmployer = title.match(
    /(?<!more\s+jobs\s+)\bat\s+([A-Z][\w&.,'\u2019]*(?:\s+(?:[A-Z][\w&.,'\u2019]*|of\b|and\b|for\b|the\b|&))*)\s*(?:[-\u2013\u2014|\u00b7(]|$)/,
  )?.[1];
  // A22-04(a) (round 22 C, Ruling 60a): THE PARENTHETICAL EMPLOYER.
  //
  // `Opening For Marketing Intern (Ion Exchange Ltd.)` names its employer
  // plainly and rendered NO employer line at all, because the split above uses
  // the separator class `([-–—|·])` and `(` is not in it, and the `at <X>`
  // capture does not apply either. So no candidate was ever produced and the
  // slot stayed silent — a wrong SILENCE, which Ruling 32 says to close.
  //
  // **THIS DOES NOT CLOSE A22-04 AND NOBODY CLAIMS IT DOES.** B executed the
  // counterfactual: running the shipped 57b guard WITH this name supplied still
  // returns `false`, so surfacing the employer does not remove the row from the
  // pool. **The guard half is DEFERRED by Ruling 60a** — four rows is not a
  // matrix, B searched 99 offered job rows and 138 offered event rows and found
  // no fifth instance — and **no clause of the shipped 57b guard is touched
  // here.**
  //
  // IT IS AN ORDINARY CANDIDATE AND NOTHING MORE. It goes through the same
  // guard chain below as every other one, and it is placed LAST — after
  // `titleEmployer` and after the separator segments — so the `find` reaches it
  // only when every better-evidenced candidate was absent or rejected.
  // **It can turn a silence into a name; it can never turn a name into a
  // different name, and it cannot move a row into or out of any pool.**
  //
  // End-anchored on purpose: a trailing parenthetical is the observed shape,
  // and a mid-title one is far more often a qualifier (`Research Scientist
  // (Batteries) - Idaho`) than an employer. Failure direction is the silence
  // that ships today.
  //
  // **AND IT MUST NAME AN ORGANISATION, WHICH B's GUIDE DID NOT REQUIRE AND
  // C's OWN TEST FORCED.** B's blast radius says the existing candidate guard
  // chain below still applies and that is true — but C wrote the must-keep
  // cases and found the chain does not screen this shape at all:
  // `looksLikeBareLocation` (`:733`) only matches a TRAILING US STATE CODE, so
  // `Battery Research Intern (Mumbai, India)` would have rendered
  // `Mumbai, India` as the employer. A trailing parenthetical in a job title
  // holds a LOCATION or a qualifier at least as often as an employer
  // (`(Remote)`, `(Boston, MA)`, `(Full-time)`), so admitting every one of them
  // trades a wrong silence for a wrong VALUE — which this loop ranks as worse.
  //
  // So the parenthetical must end in a corporate or institutional designator.
  // That is this file's own "catch a known shape with a closed vocabulary"
  // convention, the same instrument as `KNOWN_JOB_BOARD_DOMAINS`,
  // `SEASON_COHORT_LABEL_RE` and `FIELD_LABEL_CONTINUATION_WORD_RE`.
  //
  // **VACUITY, STATED HONESTLY: only `Ltd` is earned by a live row**
  // (`Ion Exchange Ltd.`). The rest are the same closed grammatical class and
  // are covered by constructed assertions, not live ones. That is proportionate
  // HERE and would not be for a guard that drops rows (Ruling 55c): every token
  // in this list can only ever ADMIT a name that is silent today, and a token
  // that never fires costs nothing.
  const parenthetical = title.match(/\(([^()]{2,60})\)\s*$/)?.[1];
  const parentheticalEmployer =
    parenthetical && ORG_DESIGNATOR_RE.test(parenthetical) ? parenthetical : undefined;
  // A23-01(a) IS NOT SHIPPED, AND THE REASON IS MEASURED — see the entry for
  // round 23 C item 2. Ruling 62d approved "prefer the LAST surviving segment",
  // but this file's own locked case
  // `Battery Cell Engineer - CATL - Battery Cell, R&D & Gigafactory Programs -
  // EV.Careers` has TWO surviving segments — `CATL` and `EV.Careers` — and the
  // last one is the JOB BOARD. `looksLikeHostBrand` cannot see it there because
  // the posting's host is not the board's own domain, and `BOARD_SELF_NAME_RE`
  // requires a board noun (`board|portal|site|…`) that `EV.Careers` does not
  // carry. So the preference turns a CORRECT employer into a wrong one on a
  // shape structurally identical to `lanl.jobs` — two survivors, same chain —
  // which is the one trade this loop never makes. Held under the escape clause
  // rather than widened inline; half (c) below is independent and ships.
  const company = trimEmployerAddressTail(
    stripTrailingCareersChrome(
      [titleEmployer, ...employerSegments, parentheticalEmployer]
        .map(cleanJobSubtitlePart)
        .find(
          (p) =>
            p &&
          !KNOWN_JOB_BOARD_DOMAINS.some((d) => p.toLowerCase().includes(d)) &&
          !SEASON_COHORT_LABEL_RE.test(p) &&
          !looksLikeBareLocation(p) &&
          !looksLikeHostBrand(p, host) &&
          !looksLikeTopicLabel(p, topics) &&
          !looksLikeHostBoilerplatePhrase(p) &&
          // B12-06: the family member this slot never had — see above.
          !looksLikeNavChrome(p) &&
          // Round 21, item 3(a): the board naming itself. See above.
          !looksLikeBoardSelfName(p) &&
          // B17-02 (round 17, Rulings 48a + 49b): a list of PROGRAMME AREAS
          // where a company name belongs. See the constant's doc comment above
          // for why the strip cannot be the fix and why the coordination
          // requirement and the two-word trailing list are both load-bearing.
          !looksLikeProgrammeAreaList(p) &&
          // B13-01 Gap A (round 13): a BARE careers-section label reaching the
          // employer slot. `Battery Research Scientist - Careers - Idaho
          // National Laboratory` rendered the employer as `Careers`.
          //
          // Nothing is invented here: `CAREERS_INDEX_TITLE_RE` is defined at
          // the top of this same file, is already anchored end to end, and is
          // already asserted by six tests through `isListingPage` — it was
          // simply never consulted on an employer CANDIDATE, only on a whole
          // title and on `roleTitle`. `stripTrailingCareersChrome`'s own doc
          // comment already states the intent ("a candidate that IS only this
          // word ... is the guards above's business, not this one's") — the
          // intent was documented and the guard was missing. This is it.
          //
          // The whole-segment anchor is why this costs nothing: all four
          // anchored trap names (`Home Depot`, `Page Industries`, `First
          // Solar`, `Next Energy Technologies`) and every other protected
          // employer survive, because a real company whose name merely
          // CONTAINS one of these words is not matched. Measured 19/21 on B's
          // matrix, the best of six designs, regressing nothing.
          //
          // EVIDENCE CLASS, recorded honestly rather than dressed up: Gap A is
          // LATENT, not live. Round 13 A's census contains no `Careers`
          // employer render; B found this by executing the chain against
          // breadcrumb shapes. It landed because it costs nothing and closes a
          // gap this file's own comment already says should be closed.
          //
          // Failure direction: a careers-section label not in the list
          // survives — the status quo, never a new wrong value.
          //
          // NOT FIXED HERE, deliberately: the `openmc.discourse.group`
          // `Announcements` render (Gap B). It is a site CATEGORY name, an
          // OPEN class with no string-side signal separating it from a real
          // employer, and every candidate design either misses it or deletes
          // correct employers. Ruling 42a rules it deferred to Ruling 39c's
          // forum-thread drop. Do not widen this clause to reach it.
            !CAREERS_INDEX_TITLE_RE.test(p) &&
          // A23-01(c) / Ruling 62d. A candidate ENDING in a literal ellipsis is
          // a provider string the search API truncated, not a name. Live:
          // `Focused Ion Beam, Electron Microscopy ...` and `Youth & Young
          // Adult Programs ...`. END-ANCHORED on purpose — `Johnson & Johnson
          // … Careers` mid-string is a different shape — and the precedent
          // instrument is `TRUNCATED_TITLE_RE` (`enrich.ts:160`), which this
          // mirrors rather than imports, because that one is a page-title
          // repair and this one is a candidate veto.
          !TRUNCATED_CANDIDATE_RE.test(p) &&
          // A23-01(c) / Ruling 62d. A CAREERS-OFFICE label.
          // `CAREERS_INDEX_TITLE_RE` above already rejects the bare word
          // `Careers`; it does not reject `Career Services`, which is what
          // `Nuclear Engineering Internship Summer 2027 - Career Services`
          // renders as its employer. Whole-segment anchored, exactly as
          // B13-01 Gap A set it, so a real employer whose name merely CONTAINS
          // one of these words survives untouched.
          !CAREERS_OFFICE_LABEL_RE.test(p) &&
          // Round 30, Ruling 81a (B's item 1, the three-clause partial
          // discharging Ruling 79b's commission). Two of three clauses
          // ship; `CAREERS_OFFICE_HEAD_RE` does not — see the block comment
          // above `ROLE_TEXT_CANDIDATE_RE` for the measured collision that
          // held it back, filed `POLICY — manager decides`.
          !ROLE_TEXT_CANDIDATE_RE.test(p) &&
          !BOARD_DOMAIN_BRAND_RE.test(p) &&
          // Round 31 C (Ruling 84a, A30-01). A trailing
          // `Project (<long descriptive qualifier>)` shape — see the doc
          // comment above `PROGRAMME_LABEL_TAIL_RE` for why this is keyed on
          // STRUCTURE, not the bare word "Project".
          !looksLikeProjectLabelWithDescription(p),
        ),
    ),
  );
  return {
    id: `jobweb:${urlHashId(url)}`,
    source: "jobweb",
    title: roleTitle,
    company,
    location: "",
    isRemote: /\bremote\b/i.test(text),
    description: cleanJobDescription(result.snippet),
    url,
    tags: ["web job listing", host],
  };
}

async function searchTavily(
  query: string,
  apiKey: string,
  limit: number,
  topics: string[],
): Promise<RawJobItem[]> {
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
      }),
      signal: AbortSignal.timeout(7000),
      next: { revalidate: 3 * 60 * 60 },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as { results?: TavilyResult[] };
    return (data.results ?? [])
      .map((r) => webResultToRawJobItem({ title: r.title, url: r.url, snippet: r.content }, topics))
      .filter((item): item is RawJobItem => item !== null);
  } catch (err) {
    console.error("[jobs/jobweb] tavily error:", err);
    return [];
  }
}

async function searchBrave(
  query: string,
  apiKey: string,
  limit: number,
  topics: string[],
): Promise<RawJobItem[]> {
  const params = new URLSearchParams({
    q: query,
    count: String(limit),
    freshness: "pm",
  });
  try {
    const res = await fetch(
      `https://api.search.brave.com/res/v1/web/search?${params}`,
      {
        headers: { Accept: "application/json", "X-Subscription-Token": apiKey },
        signal: AbortSignal.timeout(7000),
        next: { revalidate: 3 * 60 * 60 },
      },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as { web?: { results?: BraveResult[] } };
    return (data.web?.results ?? [])
      .map((r) =>
        webResultToRawJobItem({ title: r.title, url: r.url, snippet: r.description }, topics),
      )
      .filter((item): item is RawJobItem => item !== null);
  } catch (err) {
    console.error("[jobs/jobweb] brave error:", err);
    return [];
  }
}

/**
 * RULING 75 — the gemini branch. This surface maps INSIDE its search functions
 * (eventweb maps in `fetchImpl`), so the mapping call stays here and
 * `searchGemini`'s shared `WebResult` contract is what makes one adapter fit
 * both surfaces.
 *
 * **No `denyHosts` is passed.** `AGGREGATOR_HOSTS` is the obvious candidate and
 * it is exactly the wrong one: this surface does not DENY those hosts, it
 * REQUIRES a posting id on them, so pre-screening them away would drop rows the
 * shipped rule admits. Only outright, title-independent denies may pre-screen.
 */
async function searchGeminiJobs(
  query: string,
  limit: number,
  deadlineAt: number,
  topics: string[],
): Promise<RawJobItem[]> {
  const results = await searchGemini(query, {
    maxResults: limit,
    deadlineAt,
  });
  return results
    .map((r) => webResultToRawJobItem({ title: r.title, url: r.url, snippet: r.snippet }, topics))
    .filter((item): item is RawJobItem => item !== null);
}

/**
 * The vertex branch — the credit-funded engine, same contract, same mapper.
 *
 * `denyHosts` is omitted for exactly the reason stated above `searchGeminiJobs`:
 * this surface does not DENY `AGGREGATOR_HOSTS`, it REQUIRES a posting id on
 * them, so pre-screening there would drop rows the shipped rule admits.
 * `detectPageKind` is not set either — `pageKind` is an EVENT signal and this
 * surface's mapper ignores it, so paying for a page fetch here would buy
 * nothing.
 */
async function searchVertexJobs(
  query: string,
  limit: number,
  deadlineAt: number,
  topics: string[],
): Promise<RawJobItem[]> {
  const results = await searchVertex(query, {
    maxResults: limit,
    deadlineAt,
  });
  return results
    .map((r) => webResultToRawJobItem({ title: r.title, url: r.url, snippet: r.snippet }, topics))
    .filter((item): item is RawJobItem => item !== null);
}

/**
 * ABC-freemium 1-05 · R-KEY-3 — this used to be
 * a bare "the request key, or else the operator's environment key", which
 * handed the operator's key to anyone who could reach the route, signed in or
 * not. The gate now lives in one shared resolver; see `lib/search/system-key.ts`
 * for why the flag defaults to `false`.
 */
function resolveKeys(query: JobsQuery): {
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
 * RULING 75 requirement 2. Like eventweb, this surface used a bare ternary and
 * **never read `webSearch.provider`**; uniformity means it starts. The order
 * lives once in `sources/gemini-search.ts`.
 */
export function resolveSearchProvider(
  query: JobsQuery,
): "gemini" | "vertex" | "brave" | "tavily" | null {
  const requestTavilyKey = query.webSearch?.tavilyApiKey?.trim();
  const keys = resolveKeys(query);
  return resolveWebSearchProvider(query.webSearch?.provider, {
    // ABC-freemium 2-04 — these two used to be read straight from the
    // environment, so a free or anonymous caller reached Vertex AI Search or
    // Gemini grounding on the operator's project with no gate at all. They now
    // come from the same predicate the Tavily and Brave keys do.
    //
    // **Gating the availability inputs is what closes the hole**, not the
    // ordering: the pipeline sets an explicit `provider` from the server's own
    // environment, so `resolveWebSearchProvider` returns from its explicit
    // branch before any ordering clause runs. Both branches read this object.
    ...operatorSearchAvailability({
      systemSearchAllowed: query.webSearch?.systemSearchAllowed === true,
    }),
    braveKeyPresent: Boolean(keys.brave),
    tavilyKeyPresent: Boolean(keys.tavily),
    requestTavilyKeyPresent: Boolean(requestTavilyKey),
  });
}

async function fetchImpl(query: JobsQuery): Promise<RawJobItem[]> {
  const keys = resolveKeys(query);
  const provider = resolveSearchProvider(query);
  if (!provider) return [];

  const searches = query.queries.slice(0, JOB_QUERY_BUDGET);
  if (searches.length === 0) return [];

  // ABC-freemium 1-21 · R-QUOTA-2, D4 — the daily cap on operator-funded
  // search, charged before the fan-out and only when the key is the
  // operator's. A BYOK fan-out costs the owner nothing and is not counted.
  //
  // A tripped breaker returns `[]`, which is the SAME degraded value a keyless
  // reader already gets here: the pipeline serves its free structured sources.
  // No error, no new shape.
  // 2-04 — the predicate is now `isOperatorFundedSearch`, so Brave, Vertex and
  // grounding are charged too. They were free of the cap before, which meant
  // the 500/day breaker protected only one of the four ways to spend money.
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
      "jobs",
    );
    if (!allowed) return [];
  }
  // Providers bill per search, not per result — see RESULTS_PER_SEARCH.
  const perQuery = RESULTS_PER_SEARCH;

  // One shared deadline for the whole fan-out — see eventweb for why.
  const deadlineAt = geminiSearchDeadline();
  const resultSets = await Promise.all(
    searches.map((q) => {
      const jobQuery = `${q} position opening apply`;
      if (provider === "vertex") {
        return searchVertexJobs(jobQuery, query.limit, deadlineAt, query.topics);
      }
      if (provider === "gemini") {
        return searchGeminiJobs(jobQuery, query.limit, deadlineAt, query.topics);
      }
      return provider === "tavily"
        ? searchTavily(jobQuery, keys.tavily!, perQuery, query.topics)
        : searchBrave(jobQuery, keys.brave!, perQuery, query.topics);
    }),
  );
  // ABC-freemium 1-05 / 2-04 · R-METER-2 — one row per operator-funded fan-out,
  // whichever provider ran it. This is the one place that knows the surface, who
  // is paying and the query count. A BYOK search costs the operator nothing, so
  // attributing it would be noise and `isOperatorFundedSearch` excludes it.
  //
  // `provider` is the VARIABLE, not the literal `"tavily"` it used to be — that
  // literal made a Brave or Vertex fan-out impossible to tell apart from a
  // Tavily one in the ledger, on the rare occasion it wrote a row at all.
  if (operatorFunded) {
    recordUsageEvent({
      user_id: query.webSearch?.userId ?? null,
      kind: "search",
      surface: "jobs",
      query_count: searches.length,
      provider,
      ok: true,
      byok: false,
    });
  }

  const all: RawJobItem[] = [];
  for (const items of resultSets) {
    all.push(...items);
  }
  return Array.from(new Map(all.map((item) => [item.id, item])).values()).slice(
    0,
    query.limit,
  );
}

export const jobweb: JobSourceAdapter = {
  id: "jobweb",
  enabled: (query) => resolveSearchProvider(query) !== null,
  fetch: fetchImpl,
};
