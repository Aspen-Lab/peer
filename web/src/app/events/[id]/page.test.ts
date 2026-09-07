import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  MODEL_WRITTEN_BADGE,
  NO_MODEL_BADGE,
} from "@/components/reports/report-badge";
import type { AiMode } from "@/lib/feed/ai-tier";
import type { Plan } from "@/lib/entitlement/types";
import type {
  CareerStage,
  Event,
  IndustryAcademiaPreference,
} from "@/types";
import type {
  EventEnrichment,
  OpportunityPageReadingReason,
} from "@/lib/opportunities/enrichment";
import { cn } from "@/lib/cn";
import { EventReport } from "./page";

// B-02. A fixed clock so the countdowns and the "Today" milestone render the
// same string on every run. Mirrors the job report's own test constant.
const NOW = Date.parse("2026-07-30T12:00:00Z");

function baseEvent(overrides: Partial<Event> = {}): Event {
  return {
    id: "event:1",
    name: "Battery Interfaces Summit",
    type: "conference",
    date: "2027-07-20",
    location: "Chicago, IL",
    isOnline: false,
    shortDescription: "",
    relevanceReason: "",
    ...overrides,
  };
}

function renderReport(
  event: Event,
  // B2-17. Was inferred from `"PhD Year 3" as const` — a narrow literal type
  // that rejected any other real CareerStage value. Widened so a test can
  // exercise a different career stage without dropping to createElement.
  careerStage: CareerStage = "PhD Year 3",
  completion = { registered: false, submitted: false },
  enrichment: EventEnrichment | null = null,
  providerConfigured = false,
  isInterested = false,
  pageReadingReason?: OpportunityPageReadingReason,
  enrichmentLoading = false,
  // ABC-freemium 1-26 — the upsell is plan-aware now. This harness's
  // `providerConfigured` argument has always meant "this reader has their own
  // key", so its faithful translation is `aiMode: "byok"` — which is what makes
  // every existing case that passed `true` keep asserting the same thing. A
  // case that wants a different plan passes it explicitly.
  aiMode: AiMode = providerConfigured ? "byok" : "none",
  // ABC-freemium 6-04 — the type gained `null` ("not known yet") because the
  // production views dropped their `= "free"` default, which is what let a paid
  // reader look free mid-hydration. The harness default stays `"free"`: these
  // 38 cases were written for a free reader — the locked block only renders for
  // one — and moving the default would silently change what every one of them
  // asserts. The unknown reader is passed explicitly, by the 6-04 suite, where
  // that state is the subject rather than the backdrop.
  effectivePlan: Plan | null = "free",
): string {
  return renderToStaticMarkup(
    createElement(EventReport, {
      event,
      careerStage,
      enrichment,
      pageReadingReason,
      enrichmentLoading,
      providerConfigured,
      aiMode,
      effectivePlan,
      isSaved: false,
      isRegistered: completion.registered,
      isSubmitted: completion.submitted,
      isInterested,
      nowMs: NOW,
      starredKeys: new Set<string>(),
      onToggleStar: () => undefined,
      onToggleSave: () => undefined,
      onRegisteredChange: () => undefined,
      onSubmittedChange: () => undefined,
      onDismiss: () => undefined,
    }),
  );
}

/**
 * B2-19. The happenings footnote is the only consumer of the reader's sector
 * lean, and `sector` would be the ninth positional argument to `renderReport`
 * — six `undefined`s deep. A dedicated two-line helper is more readable than
 * that, and leaves all 38 existing `renderReport` call sites untouched (they
 * render with no sector, which is what their assertions already expect).
 */
function renderWithSector(
  event: Event,
  careerStage: CareerStage,
  sector: IndustryAcademiaPreference | undefined,
): string {
  return renderToStaticMarkup(
    createElement(EventReport, {
      // ABC-freemium 6-04 — `effectivePlan` is REQUIRED now: the production
      // views dropped their `= "free"` default, because a default on a
      // pass-through handed a paid reader back to the upsell mid-hydration.
      // These trees were always written for a free reader (the locked block is
      // only theirs to see), so they now say so out loud instead of leaning on
      // a default. The unknown state has its own cases below.
      effectivePlan: "free",
      event,
      careerStage,
      sector,
      enrichment: null,
      providerConfigured: false,
      isSaved: false,
      isRegistered: false,
      isSubmitted: false,
      isInterested: false,
      nowMs: NOW,
      starredKeys: new Set<string>(),
      onToggleStar: () => undefined,
      onToggleSave: () => undefined,
      onRegisteredChange: () => undefined,
      onSubmittedChange: () => undefined,
      onDismiss: () => undefined,
    }),
  );
}

/**
 * B2-15. Cost-table rows never nest, so splitting on the closing tag isolates
 * one row's own cells cleanly — simpler and less error-prone than a single
 * regex trying to bound both a start and an end across two adjacent rows
 * that share the same `data-cost-support-row` marker.
 */
function costSupportRow(html: string, label: string): string | undefined {
  return html.split("</tr>").find((row) => row.includes(label));
}

describe("EventReport", () => {
  it("renders one wrapping action row with the paired feedback controls", () => {
    const html = renderReport(
      baseEvent({ linkOfficial: "https://events.example.test" }),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      false,
      true,
    );
    const actionRows = html.match(
      /<div[^>]*data-report-action-row="event"[^>]*>/g,
    );
    const interested = html.match(
      /<button[^>]*data-feedback-control="interested"[^>]*>/,
    )?.[0];

    expect(actionRows).toHaveLength(1);
    expect(actionRows?.[0]).toContain("flex flex-wrap items-center");
    expect(html).not.toContain("flex flex-col items-start");
    expect(html.match(/data-opportunity-feedback-pair="true"/g)).toHaveLength(1);
    expect(interested).toContain('aria-pressed="true"');
    expect(html).toContain("Interested");
    expect(html).toContain("Not interested");
  });

  it("renders every organisation in a 30-entry roster", () => {
    const organisations = Array.from({ length: 30 }, (_, index) => ({
      name: `Battery Organisation ${index + 1}`,
      descriptor: index % 2 === 0 ? "Exhibitor" : "Sponsor",
    }));
    const html = renderReport(baseEvent({ organisations }));

    expect(html.match(/data-roster-row="organisation"/g)).toHaveLength(30);
    expect(html).toContain("Battery Organisation 30");
    // B-07 rewrote the two assertions below. They used to forbid the strings
    // "+29" and "collapsed" outright, but plate 03's own footnote uses both
    // words to promise the reader that nothing is hidden. What they were
    // protecting is that no row is actually hidden — asserted by the count
    // above, which is every organisation in the roster.
    expect(html).toContain(
      "Nothing is collapsed behind a “+29” — Peer’s guess about what matters to you is not good enough to hide anything.",
    );
    expect(html).not.toMatch(/show more/i);
    const layout = html.match(
      /<div[^>]*data-roster-layout="full-width"[^>]*>/,
    )?.[0];
    expect(layout).toContain("w-full space-y-10");
    expect(layout).not.toContain("grid-cols-2");
    // B-14 replaced "Organisations at the event" with plate 03's heading and
    // its counts sub-line — how many of the room matter to YOU, not how many
    // the model processed.
    expect(html).toContain("Who’ll be in the room");
    expect(html).toContain("0 of 30 exhibitors concern you");
    expect(html).not.toContain("attendees");
    // B-07. The tail is its own titled block with a live count, a filter and
    // the star explainer — none of which the build had.
    expect(html).toContain("Every other organisation attending · 30");
    expect(html).toContain('placeholder="Filter this list"');
    expect(html).toContain(
      "Star anyone Peer got wrong. It moves to the top here, and every future event highlights them automatically.",
    );
  });

  it("moves a starred organisation out of the tail and shrinks its count", () => {
    // B-07. The tail count is the plain-list length computed live, so starring
    // someone visibly moves them from the tail into the Tier 0 cards.
    const organisations = Array.from({ length: 4 }, (_, index) => ({
      name: `Battery Organisation ${index + 1}`,
      descriptor: "Exhibitor",
    }));
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({ organisations }),
        careerStage: "PhD Year 3" as const,
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set(["organisation:battery organisation 2"]),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain("Every other organisation attending · 3");
    expect(html).toContain("1 of 4 exhibitors concern you");
    expect(html.match(/data-roster-card="true"/g)).toHaveLength(1);
    expect(html.match(/data-roster-row="organisation"/g)).toHaveLength(4);
  });

  it("locked block's exhibitor count agrees with the tail RosterSection shows, and both move together when starring changes it", () => {
    // B3-09. The locked block's item 1 used to always read "The other
    // exhibitors, judged" with no count — a static module-level constant
    // with no access to per-event data. The count is the same live number
    // as "Every other organisation attending · N": both now read one shared
    // computation (partitionEventRoster), so they cannot disagree.
    const organisations = [
      { name: "Volta Lab", relevance: "Runs the annual keynote track." },
      { name: "Amp Systems", relevance: "You saved a role here." },
      { name: "Battery Org 1" },
      { name: "Battery Org 2" },
      { name: "Battery Org 3" },
    ];

    const unstarredHtml = renderReport(baseEvent({ organisations }));
    expect(unstarredHtml).toContain("Every other organisation attending · 3");
    expect(unstarredHtml).toContain("The other 3 exhibitors, judged");

    // Starring one of the three untagged organisations moves it into the
    // Tier 0 cards, shrinking the tail from 3 to 2 — the locked block's
    // count must shrink with it, in the same render.
    const starredHtml = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({ organisations }),
        careerStage: "PhD Year 3" as const,
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set(["organisation:battery org 1"]),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );
    expect(starredHtml).toContain("Every other organisation attending · 2");
    expect(starredHtml).toContain("The other 2 exhibitors, judged");
  });

  it("locked block falls back to the generic phrasing when everything is tagged but organisations exist", () => {
    // B3-09. Never print "The other 0 exhibitors" — the old generic
    // phrasing stays when the untagged count is zero, as long as real
    // organisations exist at all (one fully-tagged organisation here).
    // Unaffected by B4-08 immediately below: organisationCount = 1 > 0, so
    // item 1 still renders.
    const allTaggedHtml = renderReport(
      baseEvent({
        organisations: [
          { name: "Volta Lab", relevance: "Runs the annual keynote track." },
        ],
      }),
    );
    expect(allTaggedHtml).toContain("The other exhibitors, judged");
    expect(allTaggedHtml).not.toContain("The other 0 exhibitors");
  });

  // B4-08 (R10, round 4) DELIBERATELY REVERSES this same fixture's
  // expectation from B3-09's own test above (which used to assert the
  // OPPOSITE — that "The other exhibitors, judged" DID appear for
  // `organisations: []`). B3-09 built the >0-untagged branch correctly for
  // "nothing untagged, but organisations exist"; round 4 found the
  // uncovered case B3-09 didn't: zero organisations at all, where the same
  // generic fallback text ("Reads the full list...") reads as a promise to
  // judge a list that does not exist. The manager's own ruling (R10) says
  // so explicitly: "Round 3 made that count live precisely so it would
  // tell the truth; with an empty roster it now advertises reading a list
  // that is empty." This is that reversal, made on purpose, not an
  // oversight.
  it("locked block drops the exhibitors item entirely when there are no organisations at all", () => {
    const noOrgsHtml = renderReport(baseEvent({ organisations: [] }));
    expect(noOrgsHtml).not.toContain("The other exhibitors, judged");
    expect(noOrgsHtml).not.toContain("The other 0 exhibitors");
  });

  it("repeats the cheapest line and renders the required four-column cost table", () => {
    const html = renderReport(
      baseEvent({
        deadline: "2027-01-28",
        registrationDeadline: "2027-06-15",
        fees: [
          {
            label: "Early bird",
            standard: "$500",
            student: "$250",
            online: "$150",
            deadline: "2027-04-15",
          },
          {
            label: "Regular",
            standard: "$650",
            student: "$325",
            online: "$225",
          },
        ],
      }),
    );

    // KEEP the count at 2. Both sites are on plate 03 — the written sentence
    // up top and a compressed restatement at the head of the table — and
    // HANDOFF-report-overhaul.md §P3.2 records the duplication as deliberate.
    // B2-18 gave the table head its own punctuation (no comma before "for
    // you"), so the comma is no longer common to both forms — the pattern
    // matches the substring that still is.
    expect(html.match(/Cheapest way in,? for you/g)).toHaveLength(2);
    // B2-18. The table head now reads "Cheapest way in for you:" (no comma)
    // and its restatement continues in lower case; the callout above keeps
    // its comma and capital letter.
    expect(html).toContain("<strong>Cheapest way in for you:</strong>");
    expect(html).not.toContain("<strong>Cheapest way in, for you:</strong>");
    // B-11 rewrote this. The old assertion pinned a machine-assembled string,
    // "$250 student rate · Early bird · by Apr 15, 2027". It is now a sentence.
    expect(html).toContain("Student ticket in person before Apr 15, 2027 — $250.");
    for (const header of ["Item", "Standard", "Student", "Deadline"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain("Online · $150");
    // B-08. §1c's order: the cost table sits after the roster and immediately
    // before "Why Peer sent this to you". It used to jump the queue ahead of
    // both the programme and the roster.
    expect(html.indexOf("Two deadlines, one event")).toBeLessThan(
      html.indexOf("What it costs you"),
    );
    // B-09 relabelled "Submit by" to the plate's "Abstract" and gave the strip
    // its missing heading, so the ordering anchors on the heading instead.
    expect(html.indexOf("Cheapest way in, for you")).toBeLessThan(
      html.indexOf("Two deadlines, one event"),
    );
    // B2-07 / Ruling 11. Plate 03 badges this heading TIER 0. The section has
    // no data attribute of its own to anchor a regex on, so this checks a
    // window right after the heading rather than the whole rest of the page.
    const costsIndex = html.indexOf("What it costs you");
    expect(html.slice(costsIndex, costsIndex + 500)).toContain(NO_MODEL_BADGE);
  });

  it("names the travel grant and never signs off with the higher price", () => {
    // B-11. Three defects in the old generated string, all fixed here:
    //   1. field-concatenation rather than a sentence;
    //   2. it ended by quoting "$620 after" — the tail of the deadline text —
    //      so the one line whose job is to name the CHEAPEST way in finished
    //      with the most expensive number on the page;
    //   3. it never mentioned the travel grant sitting in the same record.
    const html = renderReport(
      baseEvent({
        deadline: "2026-10-30",
        travelGrant: "30 grants available, apply with your abstract",
        fees: [
          {
            label: "Early bird",
            standard: "$620",
            student: "$180",
            deadline: "Early bird ends Jan 9 · $620 after",
          },
        ],
      }),
    );

    expect(html).toContain(
      "Student ticket in person before Jan 9, with a travel grant — $180, applied for alongside the abstract you were going to write anyway.",
    );
    // The compressed restatement in the table head drops only the tail
    // clause. B2-18 lower-cases its first letter so it reads as a
    // continuation of the label's own colon ("Cheapest way in for you:
    // student ticket…") — the callout above keeps the capital letter.
    expect(html).toContain(
      "student ticket in person before Jan 9, with a travel grant — $180.",
    );
    expect(html).not.toContain(
      "Cheapest way in for you: Student ticket",
    );
    // The callout must not end on the higher price.
    const callout = html.match(
      /Cheapest way in, for you<\/p>[\s\S]{0,400}?<\/aside>/,
    )?.[0];
    expect(callout).not.toContain("$620");
    expect(callout).toContain("Student ticket");
  });

  it("puts the travel grant and invitation letter in the cost table only", () => {
    // Manager's ruling 6. Both used to print as prose under "What actually
    // happens there" AND as rows in the table — the same fact twice, which
    // say-it-once forbids. Plate 03 has them in the table only.
    const html = renderReport(
      baseEvent({
        activities: ["poster session"],
        travelGrant: "30 grants available",
        invitationLetter: true,
        fees: [{ label: "Early bird", standard: "$620", student: "$180" }],
      }),
    );

    expect(html.match(/data-cost-support-row/g)).toHaveLength(2);
    expect(html.match(/30 grants available/g)).toHaveLength(1);
    expect(html).toContain("Visa invitation letter");
    expect(html).not.toContain("<strong>Travel grant:</strong>");
    expect(html).not.toContain("Invitation letters are available.");
    // B2-15 / Ruling 15. The two support rows get different treatments. The
    // invitation letter is a boolean with a genuine three-column shape —
    // STANDARD / STUDENT both "On request", DEADLINE "—" because no field
    // carries the plate's own "Allow 3 weeks" turnaround. Old assertion
    // pinned the merged-cell text "Available on request." — the row is now
    // three real cells, not one sentence.
    const letterRow = costSupportRow(html, "Visa invitation letter");
    expect(letterRow?.match(/>On request</g)).toHaveLength(2);
    expect(letterRow).toMatch(/>—<\/td>/);
    // The travel grant stays one cell spanning the value columns — splitting
    // its free text on punctuation would be a guess, not an extraction.
    const grantRow = costSupportRow(html, "Travel grant");
    expect(grantRow).toContain('colSpan="3"');
    expect(grantRow).toContain("30 grants available");
    // B-13. The plate's closing footnote.
    expect(html).toContain("Full price with no grant would be $620.");
    expect(html).toContain(
      "The gap between the two is the reason this line sits at the top of the report.",
    );
  });

  it("costs footnote quotes the after-early-bird price, not the discounted standard price", () => {
    // B3-01. The headline row's own `standard` cell can be the *discounted*
    // early-bird price ($480) — the true worst case ($620) exists only as
    // trailing text in that same row's `deadline` string. Reading `standard`
    // alone understated the exact gap this sentence exists to dramatise.
    const html = renderReport(
      baseEvent({
        fees: [
          {
            label: "Early bird",
            standard: "$480",
            student: "$180",
            deadline: "Early bird ends Jan 9 · $620 after",
          },
        ],
      }),
    );

    expect(html).toContain("Full price with no grant would be $620.");
    expect(html).not.toContain("Full price with no grant would be $480.");
  });

  it("splits the travel grant into three columns when its text has the plate's own two-clause shape", () => {
    // B3-07 / Ruling 15's other half (B2-15 only closed the invitation
    // letter row). The plate wants — / 30 available / Apply with your
    // abstract; this is the round-3 fixture's own exact wording.
    const html = renderReport(
      baseEvent({
        travelGrant: "30 available, apply with your abstract",
        fees: [{ label: "Early bird", standard: "$620", student: "$180" }],
      }),
    );
    const grantRow = costSupportRow(html, "Travel grant");

    expect(grantRow).not.toContain('colSpan="3"');
    expect(grantRow?.match(/<td[^>]*>[\s\S]*?<\/td>/g)).toEqual([
      expect.stringContaining(">—<"),
      expect.stringContaining(">30 available<"),
      expect.stringContaining(">Apply with your abstract<"),
    ]);
  });

  it("keeps the travel grant as one spanning cell when its text has no comma", () => {
    // B3-07's own guard: only split text shaped like the plate's example.
    // "30 grants available" (no comma) must fall through unchanged — this
    // is the exact fixture the pre-existing "puts the travel grant..." test
    // above uses, confirmed still green there; this test isolates the guard
    // itself with a comment naming why it must stay a single cell.
    const html = renderReport(
      baseEvent({
        travelGrant: "30 grants available",
        fees: [{ label: "Early bird", standard: "$620", student: "$180" }],
      }),
    );
    const grantRow = costSupportRow(html, "Travel grant");

    expect(grantRow).toContain('colSpan="3"');
    expect(grantRow).toContain("30 grants available");
  });

  it("prints Not provided (not On request) when no invitation letter is offered", () => {
    // B2-15. event.invitationLetter === false is an explicit negative, not
    // silence — still a real three-column row, just the other value.
    const html = renderReport(
      baseEvent({
        invitationLetter: false,
        fees: [{ label: "Early bird", standard: "$620", student: "$180" }],
      }),
    );
    const letterRow = costSupportRow(html, "Visa invitation letter");

    expect(letterRow?.match(/>Not provided</g)).toHaveLength(2);
    expect(letterRow).toMatch(/>—<\/td>/);
    expect(letterRow).not.toContain("On request");
  });

  it("renders the plate's fact tiles and a venue-format-duration subtitle", () => {
    // B-05 + B-16. The build had no tile row at all — a two-cell When/Where
    // grid in the header, and SCALE appeared nowhere in the report.
    const html = renderReport(
      baseEvent({
        date: "2027-03-08",
        endDate: "2027-03-11",
        location: "San Diego, US",
        deadline: "2026-10-30",
        registrationDeadline: "2027-02-20",
        expectedSize: 2400,
        fees: [
          {
            label: "Early bird",
            standard: "$480",
            student: "$180",
            deadline: "Early bird ends Jan 9 · $620 after",
          },
        ],
      }),
    );

    expect(html.match(/data-event-fact=/g)).toHaveLength(6);
    // The date range collapses what the two ends share; the old header printed
    // "Monday, March 8, 2027 · Mar 11, 2027".
    expect(html).toContain("Mar 8 – 11, 2027");
    expect(html).toContain("Mon – Thu");
    // B2-14 (A: event 1d). formatCount is the app's compact vocabulary
    // ("2.4k"); the plate spells the number out with comma grouping.
    expect(html).toContain("~2,400");
    expect(html).not.toContain("~2.4k");
    expect(html).toContain("last edition");
    // B2-12 (A: event 1a). The early-bird cutoff was two lines away in scope
    // and simply never read; cutoffPhrase reuses B-01's ISO guard so the
    // compound deadline string still yields a clean "Jan 9" with no invented
    // year and no trailing "$620 after". Scoped to the FEE tile itself: the
    // cost table further down legitimately prints the full deadline string,
    // "$620" included, in its own DEADLINE column.
    const feeTile = html.match(
      /<div[^>]*data-event-fact="fee"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];
    expect(feeTile).toContain("student $180 · early bird to Jan 9");
    expect(feeTile).not.toContain("$620");
    expect(html).toContain("San Diego, US · in person · 4 days");
    // B2-01. ABSTRACT DUE: plate 03's own vocabulary is "92 days left", not
    // the feed's "in 3 months" — always days, never bucketed into months.
    // This fixture's deadline is 92 days from the fixed clock, the plate's
    // own illustrative number.
    expect(html).toContain("Oct 30");
    expect(html).toContain("92 days left");
  });

  // A24-02 / Ruling 62b. THE ROUTE-LEVEL PROOF. Plate 03 held THREE of the five
  // wrong render sites: the DATES tile's value, its weekday sub-line, and the
  // deadline strip's "Event" milestone. The card said "Aug 2026" the whole time.
  it("renders a month-granularity date as its month on every plate-03 surface", () => {
    const html = renderReport(
      baseEvent({
        date: "2026-08",
        endDate: "",
        deadline: "",
        registrationDeadline: "",
        location: "San Diego, US",
      }),
    );
    const datesTile = html.match(
      /<div[^>]*data-event-fact="dates"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];

    // Reverted: the tile value reads "Aug 1, 2026" and the strip reads "Aug 1".
    expect(datesTile).toContain("Aug 2026");
    expect(html).not.toContain("Aug 1, 2026");
    expect(html).not.toContain(">Aug 1<");
    // Reverted: the sub-line reads "Sat" — a day of WEEK invented from a
    // month-only value. `formatWeekdayRange` returns null, so it disappears.
    expect(datesTile).not.toContain("Sat");
  });

  it("computes the subtitle duration from the LOCAL date, and from nothing at all when the date is unreadable", () => {
    // A24-02, site 8 — the last raw `new Date()` on this path. Its effect is
    // invisible at small UTC offsets (Math.round absorbs them), so the FIRST
    // assertion is a CONVENTION PIN rather than a proof: it is green both ways
    // at |offset| < 12h and red beyond it. Stated, not dressed up.
    expect(
      renderReport(
        baseEvent({ date: "2026-08", endDate: "2026-08-04", location: "San Diego, US" }),
      ),
    ).toContain("San Diego, US · in person · 4 days");
    // The SECOND assertion IS uniquely red: `parseDate(...)?.getTime()` alone,
    // without the `?? NaN`, hands `daysUntil` an `undefined` that its default
    // parameter turns into Date.now() — printing a duration measured from
    // TODAY for a row whose start date could not be read at all. The raw
    // `new Date()` produced NaN here and no segment; so must the replacement.
    const unreadable = renderReport(
      baseEvent({ date: "", endDate: "2027-03-11", location: "San Diego, US" }),
    );
    expect(unreadable).toContain("San Diego, US · in person");
    expect(unreadable).not.toContain(" days");
  });

  it("hides the scale tile when no crowd size was extracted", () => {
    // B-05, updated by B4-10: expectedSize now has a real extractor
    // (event-details.ts), but it only ever sets the field when the page
    // states an explicit figure -- baseEvent()'s own default has none, and
    // the tile is left absent here rather than filled with a guessed size.
    const html = renderReport(baseEvent());
    expect(html).not.toContain('data-event-fact="scale"');
    expect(html).not.toContain("last edition");
  });

  it("prints REGISTER BY with no invented sub-line", () => {
    // B2-13 / Ruling 10 (A: event 1c). The plate's sub-line here is a fixed
    // qualitative note ("on-site registration available") — whether walk-in
    // registration stays open — not a countdown. Peer does not track that
    // fact, and a countdown implies the deadline is hard, which we do not
    // know. Suppressed rather than substituted; excluded from parity scoring
    // (exclusion 7 in §1e).
    const html = renderReport(
      baseEvent({ registrationDeadline: "2027-02-20" }),
    );
    const registerTile = html.match(
      /<div[^>]*data-event-fact="register-by"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];

    expect(registerTile).toContain("Feb 20");
    expect(registerTile).not.toContain("data-report-fact-detail");
  });

  it("gives the deadline strip its heading and a Today milestone", () => {
    // B-09. The strip was rendered bare — no ReportSection, so no heading —
    // and had only three points. Plate 03 opens it with Today so the two
    // deadlines read as distances, exactly as the job report's timeline does.
    const html = renderReport(
      baseEvent({ deadline: "2027-01-28", registrationDeadline: "2027-06-15" }),
    );

    expect(html).toContain("Two deadlines, one event");
    // Anchored on the milestone keys, not the visible words: B-05's fact row
    // sits above the strip and legitimately repeats "Abstract" and
    // "Register by", so a text search finds the tile first.
    expect(
      html.match(/data-deadline-milestone="[a-z]+"/g),
    ).toEqual([
      'data-deadline-milestone="today"',
      'data-deadline-milestone="submission"',
      'data-deadline-milestone="registration"',
      'data-deadline-milestone="event"',
    ]);
    expect(html).not.toContain("Submit by");
    // B3-02. Plate 03's Today milestone is the bare word with nothing
    // underneath — same fix, same shared cause, as the job report's
    // Timeline. No date renders under it any more, and the fixture's other
    // three dates (Jan 28 / Jun 15 / Jul 20) never coincide with Jul 30, so
    // its total absence here is a clean signal that nothing prints under it.
    expect(html).not.toContain("Jul 30");
  });

  // B4-06 (R3). baseEvent() sets a start date but neither deadline field by
  // default -- every OTHER test that touches this section happens to
  // override both explicitly (see the two above), which is exactly why the
  // empty-promise case shipped unnoticed for three rounds: 100% of this
  // file's own tests set both fields until now.
  it("does not promise two deadlines when the event has neither", () => {
    const html = renderReport(baseEvent({ date: "2027-07-20" }));
    expect(html).not.toContain("Two deadlines, one event");
  });

  it("keeps real activity vocabulary title-cased and leaves prose alone", () => {
    // B2-09 / Ruling 16. The old rule asked "does this look like a slug?"
    // (short, lowercase, only spaces/hyphens) and ordinary prose passed just
    // as easily as a real vocabulary value: "vendor exhibition" and
    // "early-career mixer" both qualified and both came out title-cased and
    // de-hyphenated — the same bug class B-12 fixed, triggered by different
    // strings than B-12's own fixture used. The fix is a membership test:
    // only an actual EventType value or one of the extractor's own fixed
    // activity labels goes through formatEventType; everything else keeps its
    // own words and hyphens, with only its first letter raised.
    const html = renderReport(
      baseEvent({
        activities: ["poster session", "vendor exhibition", "early-career mixer"],
      }),
    );

    // Real vocabulary (from ACTIVITY_LABELS): title-cased, as before.
    expect(html).toContain(">Poster Session<");
    // Prose the extractor never emits: first letter only, hyphen intact.
    expect(html).toContain(">Vendor exhibition<");
    expect(html).toContain(">Early-career mixer<");
    expect(html).not.toContain("Vendor Exhibition");
    expect(html).not.toContain("Early Career Mixer");
  });

  it("names the highlighted activities and shortens the career stage in the happenings footnote", () => {
    // B2-17. Three gaps in the plate's own sentence: "PhD Year 4" now
    // shortens to the plate's own "PhD 4"; the old generic close ("Those are
    // the ones") now names the actual highlighted chips.
    //
    // B2-19 changed the third gap. The sector clause was left out under
    // `POLICY — manager decides`; the manager then ruled it IN, because
    // `industryVsAcademia` is a value the reader set themselves rather than
    // one Peer inferred. With no sector supplied the sentence is unchanged,
    // which is what this test now pins.
    const html = renderReport(
      baseEvent({
        activities: ["poster session", "career fair", "keynote"],
        matchedTerms: ["poster", "career fair"],
      }),
      "PhD Year 4",
    );

    // B3-04. "Career fair" (title-cased first word only, the spec's own
    // EventType label), not "Career Fair" (formatEventType's old
    // every-word title-casing) -- formatActivityLabel("career fair") now
    // resolves to the career-fair EventType and prints that kind's label.
    expect(html).toContain(
      "Highlighted because they line up with your topics and because you’re a PhD 4 — Poster Session and Career fair are the ones you’d be sorry to miss.",
    );
    expect(html).not.toContain("looking at");
    expect(html).not.toContain("PhD Year 4");
    expect(html).not.toContain("Those are the ones");
  });

  it("names the reader's own sector lean in the happenings footnote", () => {
    // B2-19. The plate's own clause, from the reader's stated preference.
    const html = renderWithSector(
      baseEvent({
        activities: ["poster session", "career fair", "keynote"],
        matchedTerms: ["poster", "career fair"],
      }),
      "PhD Year 4",
      "industry",
    );

    // B3-04. "Career fair", not "Career Fair" -- see the sibling test above.
    expect(html).toContain(
      "because you’re a PhD 4 looking at industry — Poster Session and Career fair are the ones",
    );
  });

  it("prints no sector clause when the reader has stated no lean", () => {
    // B2-19. "both" is the default every profile starts on. It is the absence
    // of a preference, not a preference, so it must not become a sentence on
    // the page claiming the reader chose something.
    const html = renderWithSector(
      baseEvent({
        activities: ["poster session", "career fair", "keynote"],
        matchedTerms: ["poster", "career fair"],
      }),
      "PhD Year 4",
      "both",
    );

    expect(html).toContain("because you’re a PhD 4 — Poster Session");
    expect(html).not.toContain("looking at");
  });

  it("uses singular grammar when exactly one activity is highlighted", () => {
    const html = renderReport(
      baseEvent({
        activities: ["poster session", "keynote"],
        matchedTerms: ["poster"],
      }),
      "PhD Year 3",
    );

    expect(html).toContain(
      "Poster Session is the one you’d be sorry to miss.",
    );
  });

  it("Oxford-commas three or more highlighted activities", () => {
    const html = renderReport(
      baseEvent({
        activities: ["poster session", "career fair", "workshop", "banquet"],
        matchedTerms: ["poster", "career fair", "workshop"],
      }),
      "PhD Year 3",
    );

    // B3-04. "Career fair", not "Career Fair" -- see the earlier test in
    // this file for why.
    expect(html).toContain(
      "Poster Session, Career fair, and Workshop are the ones you’d be sorry to miss.",
    );
  });

  it("swaps the footnote's lead-in punctuation when a highlighted label already contains an em-dash", () => {
    // B3-11. "Poster session — open call" is a real ACTIVITY_LABELS-shaped
    // string carrying its own em-dash. Leading the sentence with the same
    // glyph would read as two of the same kind of break run together:
    // "...your topics — Poster session — open call, ... are the ones...".
    // The fix swaps only the sentence's own lead-in to a colon when this
    // collision would happen; every other case (tested elsewhere in this
    // file) keeps the em-dash. No career stage, exactly like the sibling
    // test above, so the "about" clause doesn't complicate the assertion —
    // this test is about the dash collision only.
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({
          activities: ["poster session — open call", "workshop"],
          matchedTerms: ["poster", "workshop"],
        }),
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set<string>(),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    const footnote = html.match(
      /<p data-happenings-footnote="true"[^>]*>[\s\S]*?<\/p>/,
    )?.[0];
    expect(footnote).toContain(
      "Highlighted because they line up with your topics: Poster session — open call and Workshop are the ones you’d be sorry to miss.",
    );
    // Exactly one em-dash in the whole footnote -- the one inside the
    // label's own name. If the sentence's own lead-in had also used an
    // em-dash (the bug this item fixes), there would be two.
    expect(footnote?.match(/—/g)).toHaveLength(1);
  });

  it("omits the career-stage clause entirely when no career stage is known", () => {
    // renderReport's own `careerStage` parameter defaults to "PhD Year 3"
    // even if undefined is passed explicitly (that's what a JS default
    // parameter does) — createElement is the only way to genuinely leave the
    // prop unset and exercise EventReport's own `careerStage?: CareerStage`.
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({
          activities: ["poster session"],
          matchedTerms: ["poster"],
        }),
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set<string>(),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain(
      "Highlighted because they line up with your topics — Poster Session is the one you’d be sorry to miss.",
    );
    expect(html).not.toContain("because you’re");
  });

  it("does not print a separate in-person/online header chip", () => {
    // B2-10 / Ruling 7. §1c's line for this row was a transcription error —
    // the plate's chip row is kind · secondary kind · rank · match %, with no
    // separate online/in-person chip. The subtitle (and the WHERE tile)
    // already state the format; a header chip said it a second time.
    const html = renderReport(baseEvent({ rank: "CCF-B", relevanceScore: 0.88 }));
    const header = html.match(
      /<div class="mb-4 flex flex-wrap gap-2">[\s\S]*?<\/div>/,
    )?.[0];

    expect(header).not.toContain("In person");
    expect(header).not.toContain(">Online<");
    // The subtitle keeps the fact — this is what B2-10 leaves alone.
    expect(html).toContain("Chicago, IL · in person");
  });

  it("labels the primary kind chip from plate 04's own vocabulary, not a mechanical humanisation", () => {
    // B3-04 / Ruling 19. formatEventType used to title-case every word
    // ("Career Fair"); the spec's own label map (plate 04, PDF page 9)
    // title-cases only the first word of a multi-word label ("Career
    // fair"), and the default fixture's type ("conference") gets a
    // different word entirely ("Academic conference"), not just different
    // casing -- no earlier test asserted the primary chip's text for the
    // default type at all.
    const conference = renderReport(baseEvent({ type: "conference" }));
    expect(conference).toContain(">Academic conference<");
    expect(conference).not.toContain(">Conference<");

    const careerFair = renderReport(baseEvent({ type: "career-fair" }));
    expect(careerFair).toContain(">Career fair<");
    expect(careerFair).not.toContain(">Career Fair<");
  });

  it("builds a secondary kind chip from a recognised fair activity", () => {
    // B2-11 / Ruling 14. event.type is one coarse enum value and cannot carry
    // a second, more specific kind — but the activities list sometimes names
    // one in plain prose. "Recruiting fair, day 3" is the plate's own example
    // activity string.
    const html = renderReport(
      baseEvent({ type: "summit", activities: ["Recruiting fair, day 3"] }),
    );
    const header = html.match(
      /<div class="mb-4 flex flex-wrap gap-2">[\s\S]*?<\/div>/,
    )?.[0];

    // B3-05. "Recruiting fair" is evidence for the career-fair kind, so the
    // chip prints that kind's own canonical label -- not the activity's raw
    // words.
    expect(header).toContain("+ career fair");
    // B3-04 / Ruling 19 (reverses round-2's B2-11 / §1f Ruling 17). Plate 04
    // (PDF page 9) prints "Industry summit" as the spec's own display label
    // for the `summit` kind -- the same way "Academic conference" labels
    // `conference`. It is a label map, not an inference about this
    // particular event, so the primary chip now prints the spec's label.
    expect(header).toContain(">Industry summit<");
  });

  it("omits the secondary kind chip when no activity names a fair", () => {
    const html = renderReport(
      baseEvent({ activities: ["poster session", "keynote"] }),
    );
    const header = html.match(
      /<div class="mb-4 flex flex-wrap gap-2">[\s\S]*?<\/div>/,
    )?.[0];

    expect(header).not.toContain("+ ");
  });

  it("does not restate the primary kind as its own secondary chip", () => {
    // A career-fair event whose activities also say "career fair" would
    // otherwise get "Career fair · + career fair" — the same fact twice.
    const html = renderReport(
      baseEvent({ type: "career-fair", activities: ["career fair"] }),
    );
    const header = html.match(
      /<div class="mb-4 flex flex-wrap gap-2">[\s\S]*?<\/div>/,
    )?.[0];

    expect(header).not.toContain("+ career fair");
  });

  it("never invents a year for a free-text fee deadline", () => {
    // B-01. Plate 03's DEADLINE column is prose and carries no year. The old
    // formatFeeDeadline handed every string to `new Date()`, whose legacy
    // parser defaults a missing year to 2001 — "Rate held until Feb 6" printed
    // as "Feb 6, 2001", a fabricated fact. Free text now round-trips verbatim;
    // only a whole ISO date is reformatted.
    const html = renderReport(
      baseEvent({
        fees: [
          {
            label: "Hotel block",
            standard: "$210 / night",
            deadline: "Rate held until Feb 6",
          },
          { label: "Abstract", standard: "—", deadline: "Oct 30" },
          { label: "Travel grant", standard: "—", deadline: "Allow 3 weeks" },
          {
            label: "Early bird",
            standard: "$500",
            student: "$250",
            deadline: "2027-04-15",
          },
        ],
      }),
    );

    expect(html).not.toContain("2001");
    expect(html).toContain("Rate held until Feb 6");
    expect(html).toContain(">Oct 30</td>");
    expect(html).toContain("Allow 3 weeks");
    // A whole machine date is still formatted for the reader.
    expect(html).toContain("Apr 15, 2027");
  });

  it("renders Why Peer sent this to you before the locked block", () => {
    // B-03 / §1b Correction 2. Same Tier 0 block as the job report, restored
    // after P10.4 deleted it. §1c puts it after the cost table and before the
    // locked block.
    const html = renderReport(
      baseEvent({
        relevanceReason:
          "Matches 3 required topics and the abstract deadline is 92 days out",
        facetPreferenceReason: "Because you often view battery summits",
      }),
    );

    const why = html.indexOf("Why Peer sent this to you");
    expect(why).toBeGreaterThan(-1);
    expect(html).toContain(
      "Matches 3 required topics and the abstract deadline is 92 days out",
    );
    // B2-08 / Ruling 12. Plate prints ONE sentence, not two paragraphs;
    // facetReason's "Because ..." lower-cases into a trailing clause.
    expect(html).toContain("because you often view battery summits.");
    expect(html).not.toContain("Because you often view battery summits");
    expect(why).toBeLessThan(html.indexOf("Also in this report on Peer Pro"));
    // B2-07 / Ruling 11. Plate 03 badges this heading TIER 0, same as the job report.
    const whySection = html.match(
      /<section[^>]*data-report-section="why-peer-sent-this"[^>]*>[\s\S]*?<\/section>/,
    )?.[0];
    expect(whySection).toContain(NO_MODEL_BADGE);
  });

  it("hides Why Peer sent this to you when there is no reason to show", () => {
    // B-03. baseEvent leaves relevanceReason empty on purpose.
    expect(renderReport(baseEvent())).not.toContain("Why Peer sent this to you");
  });

  it("keeps Registered and Submitted independent", () => {
    const html = renderReport(baseEvent(), "PhD Year 3", {
      registered: true,
      submitted: false,
    });
    const registeredButton = html.match(
      /<button[^>]*data-completion-control="registered"[^>]*>/,
    )?.[0];
    const submittedButton = html.match(
      /<button[^>]*data-completion-control="submitted"[^>]*>/,
    )?.[0];

    expect(registeredButton).toContain('aria-pressed="true"');
    expect(registeredButton).toContain("bg-done-dim");
    expect(submittedButton).toContain('aria-pressed="false"');
    expect(html).toContain(">Registered<");
    expect(html).toContain(">Submitted<");
  });

  it("moves five judged attendees into cards and leaves the other 25 as plain rows", () => {
    const organisations = Array.from({ length: 30 }, (_, index) => ({
      name: `Battery Organisation ${index + 1}`,
      descriptor: "Exhibitor",
    }));
    const enrichment: EventEnrichment = {
      judgedAttendees: organisations.slice(0, 5).map((item, index) => ({
        name: item.name,
        worthIt: index < 3,
        why: `Judgment ${index + 1}`,
      })),
    };
    const html = renderReport(
      baseEvent({ organisations }),
      "PhD Year 3",
      { registered: false, submitted: false },
      enrichment,
    );

    expect(html.match(/data-roster-row="organisation"/g)).toHaveLength(30);
    expect(html.match(/data-roster-card="true"/g)).toHaveLength(5);
    expect(html.match(/data-roster-plain="true"/g)).toHaveLength(25);
    // V26-E06 (round 26 C) RESTATED THIS ASSERTION — it is NOT deleted, and the
    // restatement IS the item's own witness. It used to demand every name
    // appear exactly TWICE: once as the row's own name and once inside the
    // `StarButton`'s `aria-label`. **Plate 03 gives highlighted cards only a
    // right-aligned tinted descriptor badge — stars appear ONLY on the
    // `EVERY OTHER …` roster rows** — so the five carded names now appear ONCE
    // and the twenty-five plain rows still appear twice.
    //
    // What this assertion actually protects is unchanged and is stated
    // explicitly below: NOBODY IS COLLAPSED. Every one of the thirty is still
    // rendered, and the roster tail keeps every one of its star controls.
    let totalMentions = 0;
    for (let index = 1; index <= 30; index += 1) {
      const hits =
        html.match(new RegExp(`Battery Organisation ${index}(?!\\d)`, "g")) ?? [];
      expect(hits.length).toBeGreaterThanOrEqual(1);
      totalMentions += hits.length;
    }
    // 5 cards × 1 mention + 25 plain rows × 2 (name + star label)
    expect(totalMentions).toBe(5 * 1 + 25 * 2);
    // and the star CONTROL survives on exactly the rows the plate keeps it on
    expect(html.match(/aria-label="(?:Star|Unstar) Battery Organisation/g)).toHaveLength(
      25,
    );
  });

  it("computes a Tier 0 paper-count descriptor for a person card, from local data only", () => {
    // B2-16 / Ruling 13. Plate 03's people cards carry a short descriptor
    // ("2 papers in your feed") that organisation cards already have and
    // people never did. Both plate examples are Tier 0 — computable with no
    // AI key — so this comes from rosterContext, never from `enrichment`
    // (the model), which would make it vanish for a reader with no AI key.
    // paperAuthors is a flat list, one entry per paper per author, so
    // counting a name in it IS counting how many of their papers are in the
    // feed.
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({ people: [{ name: "Ada Lovelace" }] }),
        careerStage: "PhD Year 3" as const,
        rosterContext: {
          savedEmployers: [],
          paperAuthors: ["Ada Lovelace", "Ada Lovelace"],
          declaredTopics: [],
          positiveLedgerLabels: [],
        },
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set<string>(),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain("2 papers in your feed");
  });

  it("falls back to a topic-match descriptor when the person has no papers in the feed", () => {
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({ people: [{ name: "Grace Hopper" }] }),
        careerStage: "PhD Year 3" as const,
        rosterContext: {
          savedEmployers: [],
          paperAuthors: [],
          declaredTopics: ["compilers, in the tradition of Grace Hopper"],
          positiveLedgerLabels: [],
        },
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set<string>(),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain("Matches a topic you typed");
  });

  it("prefers an already-populated descriptor over the computed ones", () => {
    // Mirrors EventOrg.descriptor's own priority: an upstream-supplied value
    // wins, and the local Tier 0 computation is only ever a fallback. Gives
    // the paper-count signal a real match too, so this proves priority
    // rather than merely that the fallback wasn't reachable.
    const html = renderToStaticMarkup(
      createElement(EventReport, {
      effectivePlan: "free",
        event: baseEvent({
          people: [
            {
              name: "Marie Curie",
              relevance: "Runs the annual keynote track.",
              descriptor: "Speaking twice this year",
            },
          ],
        }),
        careerStage: "PhD Year 3" as const,
        rosterContext: {
          savedEmployers: [],
          paperAuthors: ["Marie Curie", "Marie Curie", "Marie Curie"],
          declaredTopics: [],
          positiveLedgerLabels: [],
        },
        enrichment: null,
        providerConfigured: false,
        isSaved: false,
        isRegistered: false,
        isSubmitted: false,
        isInterested: false,
        nowMs: NOW,
        starredKeys: new Set<string>(),
        onToggleStar: () => undefined,
        onToggleSave: () => undefined,
        onRegisteredChange: () => undefined,
        onSubmittedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(html).toContain("Speaking twice this year");
    expect(html).not.toContain("papers in your feed");
    expect(html).not.toContain("Matches a topic you typed");
  });

  it("renders the AI sections in order and hides the locked block", () => {
    const html = renderReport(
      baseEvent({
        activities: ["poster session"],
        organisations: [{ name: "Volta Lab", descriptor: "Exhibitor" }],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Volta Lab", worthIt: true, why: "Relevant interface work." },
        ],
        talkSummaries: [
          {
            title: "Interface Stability in Solid-State Cells",
            about: "A focused session on interphase stability.",
          },
        ],
        posterFit: {
          fits: true,
          points: ["The supplied scope overlaps with the current project."],
        },
      },
    );

    // B-14 repointed this anchor: the roster heading is now plate 03's
    // "Who'll be in the room", and the "· N judged" suffix is gone.
    const attendees = html.indexOf("Who’ll be in the room");
    const talks = html.indexOf("What each talk is actually about");
    const poster = html.indexOf("Is your work a fit for the poster call");
    expect(attendees).toBeGreaterThan(-1);
    expect(attendees).toBeLessThan(talks);
    expect(html).toContain("Interface Stability in Solid-State Cells");
    expect(html).toContain("A focused session on interphase stability.");
    // B-04 rewrote this. It asserted P10.3's deletion of the day-by-day plan;
    // §1b Correction 1 reverses that — the plate does show it. The section now
    // renders when the model returns a verified plan, and sits between the
    // talks and the poster fit, matching the locked block's promise order.
    // This fixture returns no plan, so nothing renders here.
    expect(talks).toBeLessThan(poster);
    expect(html).not.toContain("A day-by-day plan for you");
    expect(html).not.toContain("Also in this report on Peer Pro");
  });

  // ════════════════════════════════════════════════════════════════════════
  // RULING 66a / 68a (round 25 C, item 2). **THE `Tier 0` BADGE ON THE ROSTER
  // SUB-HEADINGS IS NOW PER CARD.**
  //
  // These two sub-headings were the only place on either report where model
  // prose could render under a badge saying it had not been used:
  // `partitionEventRoster` merges `judgedAttendees[].why` into a card's reason
  // whenever that card has no Tier 0 reason of its own. The merge is per card,
  // so the provenance claim is too — the heading keeps its badge only while
  // every card beneath it is Tier 0.
  //
  // The other three `Tier 0` ReportBadges ("Skills they ask for", "What it
  // costs you", `why-peer-sent-this`) read no enrichment and stay literal;
  // making those conditional would be over-reach.
  // ════════════════════════════════════════════════════════════════════════
  function badgesUnder(html: string, heading: string): string[] {
    const start = html.indexOf(`>${heading}`);
    if (start === -1) return [];
    const rest = html.slice(start);
    // Bound the slice at whichever comes first: the NEXT sub-heading, or this
    // section's own tail block. Without both bounds the organisations slice
    // runs into the people section and reports its badges as well.
    const end = Math.min(
      ...[rest.indexOf("<h3", 1), rest.indexOf("Every other")]
        .filter((index) => index > 0)
        .concat(rest.length),
    );
    return [...rest.slice(0, end).matchAll(/data-report-badge[^>]*>([^<]*)</g)].map(
      (m) => m[1],
    );
  }

  it("keeps the roster heading's Tier 0 badge when every card is Tier 0", () => {
    // THE UNCHANGED WORLD, and the one Ruling 69's Phase 1 census measures:
    // no enrichment, so no card carries a judgment. The markup must be exactly
    // what the plate has always shown.
    const html = renderReport(
      baseEvent({
        organisations: [
          { name: "Solid Power", relevance: "They work on the interface you study." },
        ],
        people: [
          { name: "Dana Reyes", relevance: "They chair the session you asked about." },
        ],
      }),
    );
    expect(badgesUnder(html, "Organisations")).toEqual([NO_MODEL_BADGE]);
    expect(badgesUnder(html, "People")).toEqual([NO_MODEL_BADGE]);
  });

  it("withdraws the heading badge and labels the card when the model wrote its reason", () => {
    // `Volta Lab` has no Tier 0 reason, so `judgedAttendees[].why` supplies it
    // — the exact shape that used to sit under a badge reading `Tier 0`.
    const html = renderReport(
      baseEvent({ organisations: [{ name: "Volta Lab", descriptor: "Exhibitor" }] }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Volta Lab", worthIt: true, why: "Relevant interface work." },
        ],
      },
    );
    // The model's prose is on the page …
    expect(html).toContain("Relevant interface work.");
    // … and it is NOT under a blanket `Tier 0` claim any more.
    expect(badgesUnder(html, "Organisations")).toEqual([MODEL_WRITTEN_BADGE]);
  });

  it("labels a mixed roster card by card, not by section", () => {
    // THE CASE THAT FORCED "PER CARD, NOT PER SECTION": one card keeps its own
    // Tier 0 reason while its neighbour takes the model's. A section-level
    // badge cannot be true for both.
    const html = renderReport(
      baseEvent({
        organisations: [
          { name: "Solid Power", relevance: "They work on the interface you study." },
          { name: "Volta Lab", descriptor: "Exhibitor" },
        ],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Volta Lab", worthIt: true, why: "Relevant interface work." },
        ],
      },
    );
    // Sorted Tier 0 first by `byPriority`, so: the kept card, then the judged one.
    expect(badgesUnder(html, "Organisations")).toEqual([NO_MODEL_BADGE, MODEL_WRITTEN_BADGE]);
  });

  it("decides each roster section's provenance independently", () => {
    // The organisations went to the model; the people did not. Neither section
    // may borrow the other's provenance.
    const html = renderReport(
      baseEvent({
        organisations: [{ name: "Volta Lab", descriptor: "Exhibitor" }],
        people: [
          { name: "Dana Reyes", relevance: "They chair the session you asked about." },
        ],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Volta Lab", worthIt: true, why: "Relevant interface work." },
        ],
      },
    );
    expect(badgesUnder(html, "Organisations")).toEqual([MODEL_WRITTEN_BADGE]);
    expect(badgesUnder(html, "People")).toEqual([NO_MODEL_BADGE]);
  });

  it("renders the day plan in order, between the talks and the poster fit", () => {
    // B-04 / §1b Correction 1. Plate 03: "Which sessions to attend and who to
    // find, in order." Ordering is the feature, so the rows render exactly as
    // the parser accepted them — no day names anywhere.
    const html = renderReport(
      baseEvent({ organisations: [{ name: "Volta Lab", descriptor: "Exhibitor" }] }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        talkSummaries: [
          { title: "Interface Stability", about: "On interphase stability." },
        ],
        plan: [
          { kind: "session", label: "Interface Stability", when: "09:00" },
          { kind: "person", label: "Volta Lab" },
        ],
        posterFit: { fits: true, points: ["Overlaps the current project."] },
      },
    );

    const plan = html.indexOf("A day-by-day plan for you");
    expect(plan).toBeGreaterThan(-1);
    expect(html.indexOf("What each talk is actually about")).toBeLessThan(plan);
    expect(plan).toBeLessThan(html.indexOf("Is your work a fit for the poster call"));
    expect(html.match(/data-plan-entry="session"/g)).toHaveLength(1);
    expect(html.match(/data-plan-entry="person"/g)).toHaveLength(1);
    expect(html).toContain("Person to find");
    expect(html).toContain("Session · 09:00");
    expect(html).not.toMatch(/Day 1|Day 2/);
  });

  it("survives a cached enrichment written before the day plan existed", () => {
    // B-04. The cache holds entries for seven days and is still at v4, so a
    // report must tolerate an entry with no plan field rather than crash —
    // the failure mode the v4 bump was made to fix.
    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        talkSummaries: [
          { title: "Interface Stability", about: "On interphase stability." },
        ],
      },
    );

    expect(html).toContain("Interface Stability");
    expect(html).not.toContain("A day-by-day plan for you");
  });

  it("never sells a key to someone who already has one", () => {
    // P10.9. Three states, three screens. A configured key that produced
    // nothing gets an explanation, never an upgrade pitch — the old behaviour
    // told the reader to connect a key on the exact screen where they were
    // checking whether the key they had was working.
    const withKeyNoResult = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      true,
      false,
      "read-failed",
    );
    expect(withKeyNoResult).not.toContain("Also in this report on Peer Pro");
    expect(withKeyNoResult).toContain(
      "Peer could not finish reading the programme page this time.",
    );

    const withoutKey = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      false,
      false,
      "no-provider",
    );
    expect(withoutKey).toContain("Also in this report on Peer Pro");
    // The block already says it. Do not say it twice.
    expect(withoutKey).not.toContain("data-page-reading-note");
  });

  it.each([
    [
      "no-quotable-details",
      "Peer read the page but found no talk titles it could quote.",
    ],
    [
      "read-failed",
      "Peer could not finish reading the programme page this time.",
    ],
  ] as const)(
    "renders only the %s programme-reading note",
    (pageReadingReason, sentence) => {
      const html = renderReport(
        baseEvent(),
        "PhD Year 3",
        { registered: false, submitted: false },
        {
          posterFit: {
            fits: true,
            points: ["The supplied scope overlaps."],
          },
        },
        true,
        false,
        pageReadingReason,
      );
      const allSentences = [
        "Peer read the page but found no talk titles it could quote.",
        "Peer could not finish reading the programme page this time.",
      ];

      expect(html.match(/data-page-reading-note="event"/g)).toHaveLength(1);
      expect(html).toContain(sentence);
      for (const other of allSentences.filter((item) => item !== sentence)) {
        expect(html).not.toContain(other);
      }
    },
  );

  it("hides the programme-reading note when a real talk renders", () => {
    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        talkSummaries: [
          {
            title: "Interface Stability in Solid-State Cells",
            about: "A focused session on interphase stability.",
          },
        ],
      },
      false,
      false,
      "read-failed",
    );

    expect(html).toContain("Interface Stability in Solid-State Cells");
    expect(html).not.toContain("data-page-reading-note");
  });

  it("leads poster fit with the verdict and caps cached long reasoning", () => {
    const reasoning = Array.from(
      { length: 180 },
      (_, index) => `reason${index + 1}`,
    ).join(" ");
    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      { posterFit: { fits: true, points: [reasoning, "Second point."] } },
    );

    expect(html).toContain("Overlaps your topics");
    expect(html.indexOf("Overlaps your topics")).toBeLessThan(html.indexOf("reason1"));
    expect(html).toContain("reason60\u2026");
    expect(html).not.toContain("reason61");
  });

  it("does not revive stale cached refusals or generic talk definitions", () => {
    const html = renderReport(
      baseEvent({
        activities: ["tutorial"],
        organisations: [{ name: "Download Brochure" }],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          {
            name: "Download Brochure",
            worthIt: false,
            why: "This is a navigation link rather than an attendee.",
          },
        ],
        talkSummaries: [
          { title: "tutorial", about: "A guided learning experience." },
        ],
      },
      true,
      false,
      "read-failed",
    );

    expect(html).not.toContain("navigation link rather than an attendee");
    expect(html).not.toMatch(
      /<h2[^>]*>What each talk is actually about<\/h2>/,
    );
    expect(html).not.toContain("A guided learning experience");
    expect(html).not.toContain("Download Brochure");
    // P10.9: a configured key that produced nothing gets the explanation, not
    // an upgrade pitch.
    expect(html).not.toContain("Also in this report on Peer Pro");
    expect(html.match(/data-page-reading-note="event"/g)).toHaveLength(1);
  });

  it("cleans a stale cached measured description before rendering", () => {
    const html = renderReport(
      baseEvent({
        shortDescription:
          "than a quarter of a century. It will review the criteria necessary to achieve such extended life in commercially manufactured Li-ion cells. [...] This work presents an in situ diagnosis system of large capacity lithium-ion battery based on a sponge-type battery swelling sensor, w",
        reportSummary: {
          text: "than a quarter of a century. It will review the criteria necessary to achieve such extended life in commercially manufactured Li-ion cells. [...] This work presents an in situ diagnosis system of large capacity lithium-ion battery based on a sponge-type battery swelling sensor, w",
          authority: "source-record",
        },
      }),
    );

    expect(html).not.toContain("What actually happens there");
    expect(html).not.toContain("than a quarter of a century");
  });

  it("uses the condensed description when enrichment provides one", () => {
    const html = renderReport(
      baseEvent({
        shortDescription:
          "The source repeats a long marketing introduction. A second source sentence follows.",
        reportSummary: {
          text: "The source repeats a long marketing introduction. A second source sentence follows.",
          authority: "source-record",
        },
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        condensedDescription:
          "Researchers present interface results. Workshops compare cell-design methods.",
      },
    );

    expect(html).toContain("Researchers present interface results.");
    expect(html).toContain("Workshops compare cell-design methods.");
    expect(html).not.toContain("long marketing introduction");
  });
});

describe("stale cached enrichment shapes", () => {
  // A seven-day cache means a shape change ships alongside entries written by
  // the previous shape. posterFit.reasoning became posterFit.points[], and the
  // old entry had no `points` — the report crashed on `.map` and the reader got
  // "This view hit a snag." The cache key is bumped, but the render must not
  // trust the shape it is handed either.
  it("renders instead of crashing when posterFit has no points", () => {
    const legacy = {
      posterFit: { fits: true, reasoning: "Written by the previous shape." },
    } as unknown as EventEnrichment;

    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      legacy,
      true,
    );

    expect(html).toContain("Battery Interfaces Summit");
    expect(html).not.toContain("Is your work a fit for the poster call");
  });

  it("survives an empty points array", () => {
    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      { posterFit: { fits: true, points: [] } },
      true,
    );
    expect(html).toContain("Battery Interfaces Summit");
    expect(html).not.toContain("Is your work a fit for the poster call");
  });

  it("shows a reading indicator while the model is still working", () => {
    const html = renderReport(
      baseEvent(),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      true,
      false,
      undefined,
      true,
    );
    expect(html).toContain('data-enrichment-loading="event"');
    expect(html).toContain("Peer is reading the programme page");
    // The explanation line must not race the spinner.
    expect(html).not.toContain("data-page-reading-note");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// B20-01 (A: event A20-01), render sites 2 and 3 of 6 — THE EVENT REPORT.
//
// Plate 03 IS this report, so these two are the surface the parity loop
// measures. Both used to collapse `isOnline ? "Online" : location`, which
// deletes the venue of a HYBRID event, because schema.org's Mixed attendance
// mode is stored as `isOnline: true`.
//
// NEGATIVE PROOF: reverting either site to the raw `event.isOnline ?` form
// turns its own test below red, and only that one — the WHERE tile and the
// subtitle are asserted separately on purpose, so a half-applied fix cannot
// pass.
// ─────────────────────────────────────────────────────────────────────────
describe("B20-01 — a hybrid event keeps its venue in the report", () => {
  const hybrid = () =>
    baseEvent({
      isOnline: true,
      location: "Rome, Italy",
      place: { city: "Rome", country: "Italy" },
      date: "2027-06-21",
      endDate: "2027-06-23",
    });

  it("render site 2 — the WHERE tile names the city", () => {
    const html = renderReport(hybrid());
    const whereTile = html.match(
      /<div[^>]*data-event-fact="where"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];
    expect(whereTile).toContain("Rome, Italy");
    expect(whereTile).not.toContain("Online");
  });

  it("render site 3 — the subtitle names the city", () => {
    const html = renderReport(hybrid());
    expect(html).toContain("Rome, Italy · online · 3 days");
  });

  it("LOCK, not coverage: a genuinely-online event still says Online at both sites", () => {
    // Passes before and after — an ADMITTED CONTROL, not proof of the change.
    const html = renderReport(
      baseEvent({ isOnline: true, location: "Online", date: "2027-06-21" }),
    );
    const whereTile = html.match(
      /<div[^>]*data-event-fact="where"[^>]*>[\s\S]*?<\/div>/,
    )?.[0];
    expect(whereTile).toContain("Online");
    expect(html).toContain("Online · online");
  });

  it("ADMITTED CONTROL: an in-person event is untouched at both sites", () => {
    const html = renderReport(
      baseEvent({ location: "San Diego, US", date: "2027-03-08", endDate: "2027-03-11" }),
    );
    expect(html).toContain("San Diego, US · in person · 4 days");
  });
});

/**
 * **RULING 111c (Phase 2 round 4, C item 3) — THE cn() TAILWIND-MERGE TRAP,
 * GENERAL FIX.** `tailwind-merge`'s own class-group model had no notion of
 * this app's custom `--text-*` size tokens, so any `cn()` call combining one
 * with a text-colour utility silently DROPPED the size class. Round 3 B's
 * sweep found FIVE live victims — the roster reason paragraph (commissioned,
 * V-P2-02) plus its previously-undocumented byte-identical twin on the People
 * card, the `HeaderChip` badges (both job and event surfaces), the activity
 * chip, and `StarButton` — all fixed at once by teaching `web/src/lib/cn.ts`
 * about the 9 tokens (`extendTailwindMerge`), no site-level edits needed.
 * These lock each site at its intended rendered class, both branches where a
 * branch exists, so a future regression to the old bare `twMerge` reds here.
 */
describe("Ruling 111c — the cn() tailwind-merge trap, general fix locks (event surface)", () => {
  /** Element-anchored capture: the FIRST tag of `tag` whose inner text contains `text`. */
  function classesOfTagContaining(html: string, tag: string, text: string): string {
    const open = new RegExp(`<${tag}\\b[^>]*>`, "g");
    for (const match of html.matchAll(open)) {
      const start = (match.index ?? 0) + match[0].length;
      const end = html.indexOf(`</${tag}>`, start);
      if (end < 0) continue;
      if (html.slice(start, end).includes(text)) {
        return /class="([^"]*)"/.exec(match[0])?.[1] ?? "";
      }
    }
    throw new Error(`no <${tag}> containing ${JSON.stringify(text)} was rendered`);
  }

  it("V-P2-02 — keeps text-caption on the Organisations roster card reason, BOTH branches", () => {
    // Positive/default branch: a Tier 0 reason, no negative judgment — renders text-accent.
    const positive = renderReport(
      baseEvent({
        organisations: [
          { name: "Solid Power", relevance: "They work on the interface you study." },
        ],
      }),
    );
    const positiveClasses = classesOfTagContaining(
      positive,
      "p",
      "They work on the interface you study.",
    );
    expect(positiveClasses).toContain("text-caption");
    expect(positiveClasses).toContain("text-accent");

    // Negative-judgment branch: no Tier 0 reason, so `judgedAttendees[].why`
    // supplies it and `worthIt: false` swaps the tone — renders text-text-muted.
    const negative = renderReport(
      baseEvent({ organisations: [{ name: "Volta Lab", descriptor: "Exhibitor" }] }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Volta Lab", worthIt: false, why: "Score-inflated, not actually relevant." },
        ],
      },
    );
    const negativeClasses = classesOfTagContaining(
      negative,
      "p",
      "Score-inflated, not actually relevant.",
    );
    expect(negativeClasses).toContain("text-caption");
    expect(negativeClasses).toContain("text-text-muted");
  });

  it("the undocumented twin — keeps text-caption on the People roster card reason, BOTH branches", () => {
    // Same mechanism, same two branches, on the People card (`:1670-1674`) —
    // the byte-identical twin B's sweep found unnoted next to the commissioned site.
    const positive = renderReport(
      baseEvent({
        people: [
          { name: "Dana Reyes", relevance: "They chair the session you asked about." },
        ],
      }),
    );
    const positiveClasses = classesOfTagContaining(
      positive,
      "p",
      "They chair the session you asked about.",
    );
    expect(positiveClasses).toContain("text-caption");
    expect(positiveClasses).toContain("text-accent");

    const negative = renderReport(
      baseEvent({ people: [{ name: "Ada Okafor", role: "Principal Scientist" }] }),
      "PhD Year 3",
      { registered: false, submitted: false },
      {
        judgedAttendees: [
          { name: "Ada Okafor", worthIt: false, why: "Not actually working on your topic." },
        ],
      },
    );
    const negativeClasses = classesOfTagContaining(
      negative,
      "p",
      "Not actually working on your topic.",
    );
    expect(negativeClasses).toContain("text-caption");
    expect(negativeClasses).toContain("text-text-muted");
  });

  it("keeps text-meta on the HeaderChip badges, both the plain kind tone and the accent match tone", () => {
    const kind = /<span[^>]*data-header-chip="kind"[^>]*>/.exec(
      renderReport(baseEvent()),
    )?.[0] ?? "";
    expect(kind).toContain("text-meta");

    // The accent match chip only renders once `matchPct` is non-null, which
    // requires a real `relevanceScore` — see the component's own gate.
    const accent = /<span[^>]*data-header-chip="accent"[^>]*>/.exec(
      renderReport(baseEvent({ relevanceScore: 0.91 })),
    )?.[0] ?? "";
    expect(accent).toContain("text-meta");
  });

  it("keeps text-meta on the activity chip, both the highlighted and the plain branch", () => {
    const html = renderReport(
      baseEvent({
        activities: ["poster session", "career fair"],
        matchedTerms: ["poster"],
      }),
    );
    const highlighted = /<span[^>]*data-activity-chip="matched"[^>]*>/.exec(html)?.[0] ?? "";
    const plain = /<span[^>]*data-activity-chip="plain"[^>]*>/.exec(html)?.[0] ?? "";
    expect(highlighted).toContain("text-meta");
    expect(plain).toContain("text-meta");
  });

  it("keeps text-title on StarButton's INACTIVE glyph, reached through the real page", () => {
    // StarButton lives on the roster TAIL rows (plain, untagged entries), so
    // this needs an organisation with no Tier 0 reason and no judgment.
    const html = renderReport(
      baseEvent({ organisations: [{ name: "Battery Org 1" }] }),
    );
    const star =
      /<button[^>]*aria-label="Star Battery Org 1"[^>]*>/.exec(html)?.[0] ?? "";
    expect(star).toContain("text-title");
  });

  it("keeps text-title on StarButton's ACTIVE glyph — unreachable through the page, so tested at the cn() call itself", () => {
    // `partitionEventRoster`'s own `concerns` gate (`Boolean(reason) ||
    // starred`) means a starred tail row is ALWAYS promoted into a card
    // instead, and cards render no `StarButton` at all (V26-E06's own
    // doctrine: "highlighted cards carry no star") — so `active={true}` is
    // UNREACHABLE by construction through the full page, the same admitted-
    // control shape as V26-J07's divide-by-zero guard above. `StarButton`
    // itself is not exported, so this locks the fix directly against the
    // component's own literal `cn()` call (`events/[id]/page.tsx:1271-1276`),
    // copied verbatim — exactly B's own diagnostic method (round 3 item 3:
    // "executed the REAL shipped cn() against each site's actual class
    // arguments").
    const classes = cn(
      "shrink-0 rounded-full px-2 py-1 text-title transition-colors",
      true ? "bg-accent/10 text-accent" : "text-text-faint hover:bg-accent/10 hover:text-accent",
    );
    expect(classes).toContain("text-title");
  });
});

/**
 * ABC-freemium 6-04 · R-UI-3 · Ruling 16 points 2-3 — **the report VIEW carries
 * the unknown plan through, and upsells nobody with it.**
 *
 * The two component suites prove `QuotaNotice` and `TierUpgradeBlock` stay
 * silent on `null`. This proves the layer between them and the page does too —
 * which is where the fix could quietly be undone, because `EventReport` and its
 * jobs twin used to declare `effectivePlan?: Plan` with a `= "free"` default.
 * A page that forgot the prop therefore handed both components a confident
 * `"free"` for a reader nobody had looked up yet: the required prop that makes
 * the leaves safe was being satisfied one file away by a guess.
 *
 * **These cases do not catch the default coming back, and saying so matters.**
 * A parameter default fires on `undefined`, never on an explicit `null`, so
 * every case here would go on passing with `= "free"` restored — measured, not
 * assumed. What catches it is the source case in `quota-notice.test.tsx`
 * ("gives the plan no default anywhere on its way down"), which reads these two
 * views directly. These cases prove the other half: that a `null` handed to the
 * view reaches both leaves intact instead of being coerced on the way.
 */
describe("EventReport before the entitlement is known (6-04)", () => {
  it("renders no upsell at all while the plan is unknown", () => {
    const html = renderReport(
      baseEvent({
        organisations: [
          { name: "Volta Lab" },
          { name: "Amp Systems" },
          { name: "Battery Org 1" },
        ],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      false,
      false,
      undefined,
      false,
      "none",
      null,
    );

    expect(html).not.toContain("Also in this report on Peer Pro");
    expect(html).not.toContain("Peer Pro is $12/month");
  });

  it("still renders the report itself — silence is for the upsell only", () => {
    // The reader has their complete deterministic report either way. Dropping
    // the whole view while the plan loads would trade a wrong prompt for a
    // blank screen, which is the worse of the two.
    const html = renderReport(
      baseEvent({
        relevanceReason:
          "Matches 3 required topics and the abstract deadline is 92 days out",
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      false,
      false,
      undefined,
      false,
      "none",
      null,
    );

    expect(html).toContain("Why Peer sent this to you");
  });

  it("shows the same reader the upsell once the plan is known to be free", () => {
    // The negative twin: without it, a view that never rendered the block
    // would pass the first case while removing the upsell for everyone.
    const html = renderReport(
      baseEvent({
        organisations: [
          { name: "Volta Lab" },
          { name: "Amp Systems" },
          { name: "Battery Org 1" },
        ],
      }),
      "PhD Year 3",
      { registered: false, submitted: false },
      null,
      false,
      false,
      undefined,
      false,
      "none",
      "free",
    );

    expect(html).toContain("Also in this report on Peer Pro");
  });
});
