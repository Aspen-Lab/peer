import { describe, it, expect } from "vitest";
import {
  diversifyByType,
  MIN_SCORE,
  scoreEvents,
  scoreRank,
  scoreUrgency,
} from "./scoring";
import { dedupEvents } from "./dedup";
import { ccfConfToRawItem, parseCcfDateRange, parseCcfDeadline } from "./sources/ccfddl";
import { confsTechConfToRawItem } from "./sources/confstech";
import { rsTalkToRawItem } from "./sources/researchseminars";
import {
  DENY_HOSTS,
  DENY_PATH_RE,
  eventNameFrom,
  isEventIndexPage,
  isEventIndexResult,
  isNewsArticleTitle,
  extractDeadline,
  extractEventDate,
  guessEventType,
  webResultToRawEventItem,
} from "./sources/eventweb";
import type { RawEventItem, ScoredEventItem } from "./types";
import { applyOpportunityFacetPreferenceSignal } from "@/lib/preferences/ledger";

const NOW = Date.parse("2026-07-19T00:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

function iso(offsetDays: number): string {
  return new Date(NOW + offsetDays * DAY).toISOString();
}

function event(overrides: Partial<RawEventItem>): RawEventItem {
  return {
    id: "ccfddl:test",
    source: "ccfddl",
    name: "Machine Learning Conf 2026",
    type: "conference",
    startDate: iso(90),
    location: "Vienna, Austria",
    isOnline: false,
    description: "A conference on machine learning.",
    url: "https://example.com",
    tags: ["machine learning"],
    ...overrides,
  };
}

describe("scoreUrgency", () => {
  it("ranks a near deadline above a far one", () => {
    const near = event({ deadline: iso(20) });
    const far = event({ deadline: iso(150) });
    expect(scoreUrgency(near, NOW)).toBeGreaterThan(scoreUrgency(far, NOW));
  });

  it("falls back to event-start proximity when no deadline", () => {
    const soon = event({ startDate: iso(15), deadline: undefined });
    const distant = event({ startDate: iso(180), deadline: undefined });
    expect(scoreUrgency(soon, NOW)).toBeGreaterThan(scoreUrgency(distant, NOW));
  });
});

describe("scoreRank", () => {
  it("orders A* above B above unranked", () => {
    expect(scoreRank("CCF A · CORE A*")).toBeGreaterThan(scoreRank("CCF B"));
    expect(scoreRank("CCF B")).toBeGreaterThan(scoreRank(undefined));
  });
});

describe("scoreEvents", () => {
  it("keeps report evidence out of discovery scoring and ranking", () => {
    const base = event({ id: "evidence-invariant", description: "Battery research conference." });
    const plain = scoreEvents([base], { topics: ["battery"] }, NOW);
    const proved = scoreEvents([
      { ...base, reportSummary: { text: "Source-owned summary.", authority: "source-record" } },
    ], { topics: ["battery"] }, NOW);
    expect(proved.map(({ id, score }) => ({ id, score }))).toEqual(
      plain.map(({ id, score }) => ({ id, score })),
    );
  });
  it("drops fully-past events and keyword-gates the rest", () => {
    const past = event({ id: "a", startDate: iso(-30), deadline: undefined });
    const unrelated = event({
      id: "b",
      name: "Pottery Expo",
      description: "Clay and glaze.",
      tags: [],
    });
    const good = event({ id: "c" });
    // `NOW` IS NOT OPTIONAL WHENEVER A FIXTURE DATE COMES FROM `iso()`.
    // `scoreEvents` defaults its third argument to `Date.now()`, so omitting it
    // silently scores `NOW`-relative fixtures against the real clock — and the
    // test then keeps passing until the wall clock walks past the fixture. This
    // one drops `good` (NOW + 90 days) the day that date arrives; the one below
    // had already reached its own expiry and was failing.
    const scored = scoreEvents(
      [past, unrelated, good],
      { topics: ["machine learning"] },
      NOW,
    );
    expect(scored.map((s) => s.id)).toEqual(["c"]);
  });

  it("keeps an event whose deadline passed but start date is upcoming", () => {
    const attendOnly = event({ id: "a", deadline: undefined, startDate: iso(40) });
    const scored = scoreEvents(
      [attendOnly],
      { topics: ["machine learning"] },
      NOW,
    );
    expect(scored).toHaveLength(1);
  });

  it("does not let a method-only AI conference pass a battery required-topic gate", () => {
    const aiConference = event({
      id: "eventweb:ai",
      source: "eventweb",
      name: "Artificial Intelligence Conference",
      startDate: "",
      description: "A machine learning research conference.",
      tags: ["machine learning"],
    });
    expect(
      scoreEvents([aiConference], {
        topics: ["battery"],
        methods: ["machine learning"],
      }),
    ).toEqual([]);
  });

  it("keeps a relevant date-less web event with one scoped required match", () => {
    const summit = event({
      id: "eventweb:battery",
      source: "eventweb",
      name: "Solid-State Battery Summit",
      startDate: "",
      description: "An industry conference in Chicago.",
      tags: [],
    });
    const scored = scoreEvents([summit], { topics: ["battery"] });
    expect(scored).toHaveLength(1);
    expect(scored[0].relevanceReason.toLowerCase()).toContain("battery");
    expect(scored[0].relevanceReason).not.toContain("Upcoming in your field");
  });

  it("joins multiple match reasons as one sentence, not dot-separated fragments", () => {
    // B2-08 / Ruling 12. Plate 03's "Why Peer sent this to you" reads as one
    // flowing sentence. Adding a rank onto a matched-topic event produces two
    // clauses — enough to prove they join with "and", not the old " · ".
    const ranked = event({
      id: "eventweb:battery-ranked",
      source: "eventweb",
      name: "Solid-State Battery Summit",
      startDate: "",
      description: "An industry conference in Chicago.",
      tags: [],
      rank: "CCF-B",
    });
    const scored = scoreEvents([ranked], { topics: ["battery"] });
    expect(scored).toHaveLength(1);
    expect(scored[0].relevanceReason.toLowerCase()).toContain("focus and ccf-b");
    expect(scored[0].relevanceReason).not.toContain(" · ");
  });

  it("requires two distinct full-text matches when title and summary do not match", () => {
    const prefix = "x".repeat(320);
    const oneBroadMatch = event({
      id: "eventweb:one",
      source: "eventweb",
      name: "Research Conference",
      startDate: "",
      description: `${prefix} battery`,
      tags: [],
    });
    const twoBroadMatches = event({
      id: "eventweb:two",
      source: "eventweb",
      name: "Research Conference",
      startDate: "",
      description: `${prefix} battery and molten salt`,
      tags: [],
    });
    const profile = { topics: ["battery", "molten salt"] };
    expect(scoreEvents([oneBroadMatch], profile)).toEqual([]);
    expect(scoreEvents([twoBroadMatches], profile)).toHaveLength(1);
  });

  it("does not allow an explore-only match through the required gate", () => {
    const exploreOnly = event({
      id: "eventweb:explore",
      source: "eventweb",
      name: "Electroplating Symposium",
      startDate: "",
      description: "A conference about electroplating.",
      tags: [],
    });
    expect(
      scoreEvents([exploreOnly], {
        topics: ["battery"],
        softTopics: ["electroplating"],
      }),
    ).toEqual([]);
  });

  it("applies the score floor after ranking", () => {
    const lowSignal = event({
      id: "low",
      source: "confstech",
      name: "General Conference",
      startDate: iso(300),
      description: "",
      tags: [],
    });
    const unfiltered = scoreEvents(
      [lowSignal],
      { topics: [] },
      NOW,
      { applyFloor: false },
    );
    expect(unfiltered).toHaveLength(1);
    expect(unfiltered[0].score).toBeLessThan(MIN_SCORE);
    expect(scoreEvents([lowSignal], { topics: [] }, NOW)).toEqual([]);
  });

  it("applies a weak location-facet boost to the matching event", () => {
    const berlin = event({
      id: "berlin",
      location: "Berlin, Germany",
      place: { city: "Berlin", country: "Germany" },
    });
    const chicago = event({
      id: "chicago",
      location: "Chicago, IL",
      place: {
        city: "Chicago",
        region: "IL",
        country: "United States",
      },
    });
    const preferenceLedger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      "Chicago",
      { at: new Date(NOW).toISOString(), origin: "event" },
    );
    const ranked = scoreEvents(
      [berlin, chicago],
      { topics: ["machine learning"], preferenceLedger },
      NOW,
      { applyFloor: false },
    );

    expect(ranked[0].id).toBe("chicago");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[0].facetPreferenceReason).toBeUndefined();
  });

  it("explains a facet boost only when it materially changes event rank", () => {
    const candidates = [
      ["berlin", "Berlin"],
      ["boston", "Boston"],
      ["austin", "Austin"],
      ["chicago", "Chicago"],
    ].map(([id, city]) =>
      event({
        id,
        location: `${city}, Test`,
        place: { city },
      }),
    );
    const preferenceLedger = applyOpportunityFacetPreferenceSignal(
      undefined,
      "location",
      "Chicago",
      { at: new Date(NOW).toISOString(), origin: "event" },
    );
    const ranked = scoreEvents(
      candidates,
      { topics: ["machine learning"], preferenceLedger },
      NOW,
      { applyFloor: false },
    );

    expect(ranked[0].id).toBe("chicago");
    expect(ranked[0].facetPreferenceReason).toBe(
      "Because you often view Chicago",
    );
    expect(
      ranked.slice(1).every(
        (item) => item.facetPreferenceReason === undefined,
      ),
    ).toBe(true);
  });
});

describe("event source report-summary authority", () => {
  it("tags only an explicit CCF description, never its title fallback", () => {
    const common = { title: "MLConf", confs: [{ id: "mlconf-26", year: 2026, date: "October 1, 2026" }] };
    expect(ccfConfToRawItem({ ...common, description: "Source record." }, NOW)?.reportSummary).toEqual(
      { text: "Source record.", authority: "source-record" },
    );
    expect(ccfConfToRawItem(common, NOW)?.reportSummary).toBeUndefined();
  });

  it("tags a ResearchSeminars abstract but not its assembled speaker discovery text", () => {
    const common = { title: "Battery talk", seminar_id: "series", seminar_ctr: 1, start_time: "2026-09-01 10:00:00", speaker: "A Speaker" };
    expect(rsTalkToRawItem({ ...common, abstract: "Direct abstract." })?.reportSummary).toEqual(
      { text: "Direct abstract.", authority: "source-record" },
    );
    expect(rsTalkToRawItem(common)?.reportSummary).toBeUndefined();
  });

  it("keeps a confs.tech synthesized description untagged", () => {
    const item = confsTechConfToRawItem(
      { name: "Battery Summit", url: "https://example.test", startDate: "2026-10-01" },
      "battery",
      NOW,
    );
    expect(item?.description).toContain("battery conference");
    expect(item?.reportSummary).toBeUndefined();
  });
});

describe("diversifyByType", () => {
  it("caps a single type and lets others through", () => {
    const items = [
      ...[1, 2, 3, 4].map((i) => ({ ...event({ id: `c${i}` }), score: 1 - i * 0.1 })),
      { ...event({ id: "s1", type: "seminar" as const }), score: 0.5 },
    ].map((e) => ({ ...e, matchedKeywords: [], relevanceReason: "" }) as ScoredEventItem);
    const out = diversifyByType(items, 3);
    expect(out.slice(0, 4).map((o) => o.id)).toEqual(["c1", "c2", "c3", "s1"]);
  });

  it("uses a default cap of five for the ten-item daily slice", () => {
    const items = [
      ...[1, 2, 3, 4, 5, 6].map((i) => ({
        ...event({ id: `c${i}` }),
        score: 1 - i * 0.05,
      })),
      { ...event({ id: "s1", type: "seminar" as const }), score: 0.5 },
    ].map(
      (item) =>
        ({
          ...item,
          matchedKeywords: [],
          relevanceReason: "",
        }) as ScoredEventItem,
    );

    expect(diversifyByType(items).map((item) => item.id)).toEqual([
      "c1",
      "c2",
      "c3",
      "c4",
      "c5",
      "s1",
      "c6",
    ]);
  });
});

describe("dedupEvents", () => {
  it("prefers ccfddl over web discovery for the same conference+year", () => {
    const web = event({
      id: "eventweb:x",
      source: "eventweb",
      name: "Machine Learning Conf 2026",
    });
    const curated = event({ id: "ccfddl:mlconf26" });
    const out = dedupEvents([web, curated]);
    expect(out).toHaveLength(1);
    expect(out[0].source).toBe("ccfddl");
  });
});

describe("ccfddl parsing", () => {
  it("parses date ranges spanning months", () => {
    const { start, end } = parseCcfDateRange("February 22 - March 1, 2027");
    expect(start!.slice(0, 10)).toBe("2027-02-22");
    expect(end!.slice(0, 10)).toBe("2027-03-01");
  });

  it("parses same-month day ranges", () => {
    const { start, end } = parseCcfDateRange("June 10-17, 2027");
    expect(start!.slice(0, 10)).toBe("2027-06-10");
    expect(end!.slice(0, 10)).toBe("2027-06-17");
  });

  it("treats TBD deadlines as absent", () => {
    expect(parseCcfDeadline("TBD")).toBeUndefined();
    expect(parseCcfDeadline("2027-08-15 23:59:59")).toBe(
      "2027-08-15T23:59:59.000Z",
    );
  });

  it("picks the newest upcoming edition and expands category tags", () => {
    const item = ccfConfToRawItem(
      {
        title: "AAAI",
        description: "AAAI Conference on Artificial Intelligence",
        sub: "AI",
        rank: { ccf: "A", core: "A*" },
        confs: [
          {
            year: 2025,
            id: "aaai25",
            date: "February 25 - March 4, 2025",
            place: "Philadelphia, USA",
            timeline: [{ deadline: "2024-08-15 23:59:59" }],
          },
          {
            year: 2027,
            id: "aaai27",
            link: "https://aaai.org",
            date: "January 20 - January 27, 2027",
            place: "Singapore",
            timeline: [{ deadline: "2026-08-15 23:59:59" }],
          },
        ],
      },
      NOW,
    );
    expect(item).not.toBeNull();
    expect(item!.id).toBe("ccfddl:aaai27");
    expect(item!.deadline).toBe("2026-08-15T23:59:59.000Z");
    expect(item!.rank).toBe("CCF A · CORE A*");
    expect(item!.tags).toContain("machine learning");
  });
});

describe("eventweb extraction", () => {
  it("exports the documented quality deny signals", () => {
    expect(DENY_HOSTS).toContain("instagram.com");
    expect(DENY_HOSTS).toContain("iopscience.iop.org");
    expect(DENY_HOSTS).toContain("waset.org");
    expect(DENY_PATH_RE.test("/article/example")).toBe(true);
    expect(DENY_PATH_RE.test("/events/example")).toBe(false);
  });

  it.each([
    "https://instagram.com/reel/example",
    "https://iopscience.iop.org/article/example",
    "https://subdomain.waset.org/conference/example",
    "https://example.org/doi/10.1000/example",
  ])("drops denied web result URL %s", (url) => {
    expect(
      webResultToRawEventItem(
        {
          title: "Solid-State Battery Summit 2026",
          url,
          snippet: "Conference on August 11, 2026 in Chicago",
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("drops a dated result that does not have positive event shape", () => {
    expect(
      webResultToRawEventItem(
        {
          title: "Plasma-assisted surface modification of LCO cathodes",
          url: "https://example.org/research",
          snippet: "Published August 11, 2026",
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("extracts month-day-year event dates", () => {
    expect(
      extractEventDate("MRS Fall Meeting, November 29 - December 4, 2026, Boston")!.slice(0, 10),
    ).toBe("2026-11-29");
  });

  it("extracts deadlines near deadline keywords", () => {
    expect(
      extractDeadline("Abstract submission deadline: August 14, 2026.")!.slice(0, 10),
    ).toBe("2026-08-14");
  });

  it("guesses event types", () => {
    expect(guessEventType("ICML Workshop on X")).toBe("workshop");
    expect(guessEventType("Weekly Colloquium")).toBe("seminar");
    expect(guessEventType("Materials Career Fair")).toBe("career-fair");
    expect(guessEventType("Climate Tech Hackathon")).toBe("hackathon");
    expect(guessEventType("Annual Meeting")).toBe("conference");
  });

  it("keeps recruiting events and classifies them from the title", () => {
    expect(
      webResultToRawEventItem(
        {
          title: "Advanced Materials Career Fair 2026",
          url: "https://x.test/materials-career-fair",
          snippet: "Meet research employers on September 14, 2026.",
        },
        NOW,
      ),
    ).toMatchObject({ type: "career-fair" });
  });

  it("drops event pages whose only year token is in the past", () => {
    expect(
      webResultToRawEventItem(
        { title: "Some Conference", url: "https://x.test", snippet: "held in 2019" },
        NOW,
      ),
    ).toBeNull();
  });

  it("drops non-event pages that carry no date", () => {
    expect(
      webResultToRawEventItem(
        { title: "A blog post about batteries", url: "https://x.test", snippet: "some article text" },
        NOW,
      ),
    ).toBeNull();
  });

  it("keeps a dated future event", () => {
    expect(
      webResultToRawEventItem(
        {
          title: "Materials Symposium",
          url: "https://x.test",
          snippet: "Join us September 14-18, 2026 in Berlin",
        },
        NOW,
      ),
    ).not.toBeNull();
  });

  it("keeps a date-less event page that reads as a conference (shown as TBA)", () => {
    const item = webResultToRawEventItem(
      {
        title: "International Battery Symposium",
        url: "https://x.test",
        snippet: "Annual call for papers — abstract submission now open",
      },
      NOW,
    );
    expect(item).not.toBeNull();
    expect(item?.startDate).toBe("");
  });

  it.each(["Battery Materials Expo", "Energy Storage Industry Forum"])(
    "keeps a date-less industry event shape: %s",
    (title) => {
      expect(
        webResultToRawEventItem(
          {
            title,
            url: "https://example.test/events/2026",
            snippet: "Registration and speakers announced",
          },
          NOW,
        ),
      ).not.toBeNull();
    },
  );
});

describe("event name extraction", () => {
  it("recovers a real event name when the page title is generic", () => {
    expect(
      eventNameFrom(
        "Meeting Summary",
        "2026 International Round Table on Titanium Production in Molten Salts. Registration is open.",
      ),
    ).toBe("2026 International Round Table on Titanium Production in Molten Salts.");
  });

  it("prefers the event-like segment over site chrome", () => {
    expect(
      eventNameFrom("Solid-State Battery Summit | Cambridge EnerTech", ""),
    ).toBe("Solid-State Battery Summit");
  });

  it("keeps a clean title unchanged", () => {
    expect(eventNameFrom("6th Annual Solid-State Battery Summit", "")).toBe(
      "6th Annual Solid-State Battery Summit",
    );
  });

  // B9-04 Fix 1 (round 9, Ruling 32): this used to assert "Home" — the same
  // bare title `isGenericPageTitle` had already rejected as chrome a few
  // lines earlier inside `bestEventTitleSegment`, reinstated verbatim by
  // the old `segments[0] ?? title.trim()` absolute last resort. Found while
  // landing B9-04 Fix 1 — not in B's own tests-at-risk list, which named
  // only `eventweb.test.ts` — the same defect shape reached from a second
  // test file exercising the same line. With no URL to read an honest host
  // from, the new last resort is a literal placeholder, never the same
  // rejected string looked at twice.
  it("falls back to a literal placeholder when the title is chrome and the snippet has nothing usable", () => {
    expect(eventNameFrom("Home", "Nothing useful here")).toBe("Untitled event");
  });
});

describe("event index and org pages", () => {
  it.each([
    "Events for July 2026",
    "Upcoming Events",
    "Events Calendar",
    "All Events",
    "Nuclear and Applied Materials Research Group",
    "Department of Materials Science",
    "Upcoming Energy Storage Conferences",
  ])("rejects non-event page: %s", (title) => {
    expect(isEventIndexPage(title)).toBe(true);
  });

  it.each([
    "Solid-State Battery Summit",
    "6th Annual Solid-State Battery Summit",
    "2026 International Round Table on Titanium Production in Molten Salts",
    "EMEA2026: Workshop on Ion Exchange Membranes for Energy Applications",
  ])("keeps a real event: %s", (title) => {
    expect(isEventIndexPage(title)).toBe(false);
  });

  // A24-01 / RULING 64b. THE SINGULAR ARM OF THE BROWSE ALTERNATIVE IS GONE.
  // "All-solid-state battery" is a core term in this corpus — the pool's own
  // headline row is a Solid-State Battery Summit — so a single event named
  // `All Solid State Battery Workshop` was being dropped as if it were an
  // index. The HYPHENATED spelling escaped only because a hyphen is not `\s`.
  it("keeps a single event whose name starts with a browse word and ends singular", () => {
    // Before the narrowing this was `true` — a real event dropped by name.
    expect(isEventIndexPage("All Solid State Battery Workshop")).toBe(false);
    // Already kept, by accident of spelling. Now kept for a reason.
    expect(isEventIndexPage("All-Solid-State Battery Workshop")).toBe(false);
    // The PLURAL still drops. An index lists many.
    expect(isEventIndexPage("Upcoming Energy Storage Conferences")).toBe(true);
    expect(isEventIndexPage("All Battery Workshops")).toBe(true);
    expect(isEventIndexPage("Browse Battery Events")).toBe(true);
  });
});

// A24-01. ROW ADMISSION vs the raw predicate. `isEventIndexPage`'s own contract
// above is UNCHANGED and its table stays green; `isEventIndexResult` is what
// `webResultToRawEventItem` calls, and it feeds the title's FIRST SEGMENT in as
// a second derived input.
//
// This is a STRING table on purpose. A24-01 is INTERMITTENT — the provider's
// title for `cambridgeenertech.com/cet/conferences` varies between windows, and
// round 24 B's own five live pulls could not reproduce the pool row at all. The
// mechanism is deterministic even when the row is not, so the regression test
// replays the recorded STRING and never a live pull.
describe("A24-01: index-page admission reads the first title segment", () => {
  it.each([
    // The row A24-01 was filed on, in the exact string A's window recorded.
    "Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech",
    // Same page, same URL, the title B's five pulls saw. Already dropped by the
    // shipped guard — this arm must not be given up.
    "Upcoming Energy Storage Conferences",
    // The ONE new drop across 150 live offered titles: a genuine events hub.
    "Events - Gateway for Accelerated Innovation in Nuclear",
  ])("drops the index page: %s", (title) => {
    expect(isEventIndexResult(title)).toBe(true);
  });

  it.each([
    // THE CONTROL THAT KILLED THE `any segment` VARIANT: a real event whose
    // site chrome names the organiser's own events hub. `any segment` drops it.
    "Battery Safety Summit 2026 | Upcoming Conferences",
    // A real, live, correctly-kept pool row whose FIRST segment is the bare
    // generic noun "Conference".
    "Conference Overview | The Battery Show South",
    // Sibling sessions, tracks and co-located workshops on one event's own page
    // — the class the brief named. None of them moves.
    "Sessions and Tracks | Advanced Battery Conference 2026",
    "Programme | 32nd SolarPACES Conference",
    "Co-located Workshops | The Battery Show North America",
    "Battery Workshops 2026",
    "Upcoming Battery Technology Conference 2026 | Chicago, IL",
    "All-Solid-State Battery Symposium 2026 | Tokyo",
    "26th Advanced Automotive Battery Conference (AABC) | December 7-10, 2026 | San Diego, CA",
    "Battery Safety Summit | August 12-13, 2026 | Chicago, IL",
    "Solid-State Battery Summit | August 11-12, 2026",
    "Turkey Battery Technologies Summit 2026 – October 21-22, 2026",
    "Solid-State Battery Summit (Aug 2026), Chicago USA",
    // Ruling 64b's own witness, and the chrome-tailed form the first-segment
    // input would otherwise have EXTENDED the old over-reach to.
    "All Solid State Battery Workshop",
    "All Solid State Battery Workshop | Tokyo 2026",
  ])("admits the real event page: %s", (title) => {
    expect(isEventIndexResult(title)).toBe(false);
  });

  it("leaves the raw predicate's own contract alone", () => {
    // The first-segment input lives at ROW ADMISSION only. `isChromeSegment`
    // still asks `isEventIndexPage` about whole segments, so nothing widens in
    // name selection — the blast radius round 24 B priced.
    expect(
      isEventIndexPage("Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech"),
    ).toBe(false);
    expect(isEventIndexPage("Events - Gateway for Accelerated Innovation in Nuclear")).toBe(false);
  });

  it("keeps dropping SIPS-shaped org tails, which alternative 4 owns unanchored", () => {
    // Pre-existing and NOT touched here. Recorded because `flogen.org` renders
    // `SIPS 2026` as a correct, kept pool row, and a title of this shape loses
    // it — a cost that exists before and after this item, unchanged.
    expect(isEventIndexResult("SIPS 2026 - Department of Materials")).toBe(true);
  });
});

describe("site-chrome titles", () => {
  it("recovers the event name from the URL slug when every title segment is chrome", () => {
    expect(
      eventNameFrom(
        "DLR Events | Events for July 2026",
        "",
        "https://event.dlr.de/en/event/emea2026-workshop-on-ion-exchange-membranes-for-energy-applications",
      ),
    ).toBe("Emea2026 workshop on ion exchange membranes for energy applications");
  });

  it("still prefers a real title segment over the slug", () => {
    expect(
      eventNameFrom(
        "Solid-State Battery Summit | Cambridge EnerTech Events",
        "",
        "https://www.cambridgeenertech.com/solid-state-batteries",
      ),
    ).toBe("Solid-State Battery Summit");
  });
});

describe("commerce and news pages", () => {
  it.each([
    ["https://batteriesinaflash.com/shop/chargers", "Batteries, Charger & More"],
    ["https://example.test/store/battery-packs", "Battery Packs Conference Store"],
    ["https://example.test/products/cells", "Battery Cells Symposium"],
  ])("rejects storefront URL %s", (url, title) => {
    expect(
      webResultToRawEventItem(
        { title, url, snippet: "Conference registration and pricing" },
        NOW,
      ),
    ).toBeNull();
  });

  it.each([
    "The Year Ahead: Key Events at the IAEA in 2026",
    "Top 10 Battery Conferences to Watch",
    "What to Expect at the 2026 Summit",
    "Highlights from the 2026 Battery Congress",
  ])("rejects news/editorial title: %s", (title) => {
    expect(isNewsArticleTitle(title)).toBe(true);
  });

  it.each([
    "Solid-State Battery Summit",
    "6th Annual Battery Safety Summit",
    "International Meeting on Lithium Batteries",
  ])("keeps a real event title: %s", (title) => {
    expect(isNewsArticleTitle(title)).toBe(false);
  });

  // B12-03 gap B (round 12): adt.media rendered a conference name for a page
  // that is an ARTICLE ABOUT the conference. B established the filter's
  // vocabulary is not missing anything — its INPUT was wrong. It only ever saw
  // the search provider's title, and on this page the tell is in the <h1> and
  // the URL, not the title. So the URL path became a second input.
  describe("news article detected from the URL path (B12-03 gap B)", () => {
    // adt.media's live repro. The title alone carries no tell at all.
    it("drops an article whose path begins with a listicle headline", () => {
      const title = "Automotive Battery Conference 2026: key topics and speakers";
      expect(isNewsArticleTitle(title)).toBe(false);
      expect(
        isNewsArticleTitle(
          title,
          "https://adt.media/what-to-expect-at-the-automotive-battery-conference-2026",
        ),
      ).toBe(true);
    });

    // THE must-survive case, and the reason the path check uses ONLY the
    // anchored headline forms and never NEWS_TITLE_RE whole. That regex's last
    // alternative (`news|press release|blog post|newsletter`) is UNANCHORED, so
    // on a path it matches "news call for abstracts" — which is
    // battery2030.eu's own URL, the other host on this very item. A page under
    // /news/ on an organiser's own site is routinely a real announcement.
    it("keeps a real event page that merely lives under a /news/ path", () => {
      expect(
        isNewsArticleTitle(
          "Call for Abstracts for the Battery 2030+ Annual Conference 2026",
          "https://battery2030.eu/news/call-for-abstracts",
        ),
      ).toBe(false);
    });

    // The path check must not fire on an ordinary event path either.
    it("keeps a real event page whose path is its own name", () => {
      expect(
        isNewsArticleTitle(
          "Advanced Battery Power Conference 2026",
          "https://example.org/events/advanced-battery-power-conference-2026",
        ),
      ).toBe(false);
    });

    // Every existing caller passes one argument; the second is optional and a
    // malformed URL must be treated as "no path", not as a match.
    it("behaves exactly as before with no URL, or with a malformed one", () => {
      expect(isNewsArticleTitle("Solid-State Battery Summit")).toBe(false);
      expect(isNewsArticleTitle("Solid-State Battery Summit", "not a url")).toBe(false);
      expect(isNewsArticleTitle("The Year Ahead: Key Events at the IAEA in 2026", "not a url")).toBe(
        true,
      );
    });
  });
});

// RULING 57b (round 21, item 5): THE WIRING, ASSERTED END TO END ON THE EVENT
// SURFACE. Ruling 57b requires the guard on BOTH surfaces. It ships here
// DESIGNED BUT ORGANICALLY UNWITNESSED: round 21 A's event-side count was 1
// instance / 0 admitted, and no event pull has ever caught this shape, so
// these rows are CONSTRUCTED and are labelled as such rather than presented as
// evidence the defect occurs on events. Round 22 A's line.
describe("owner-name topic collisions leave the event pool (Ruling 57b)", () => {
  const PE_BODY =
    "Battery is a private equity and venture capital firm with over 40 years of heritage investing in category-leading technology companies.";

  it("drops an event whose ORGANISER's name is the only reason it matched", () => {
    const collision = event({
      id: "pe",
      name: "2027 Summer Investment Showcase",
      organisations: [{ name: "Battery Ventures" }],
      description: PE_BODY,
      tags: [],
    });
    const real = event({
      id: "real",
      name: "International Battery Materials Symposium",
      description: "Three days on battery cathode chemistry.",
      tags: [],
    });
    const scored = scoreEvents([collision, real], { topics: ["battery"] }, NOW);
    expect(scored.map((s) => s.id)).toEqual(["real"]);
  });

  it("keeps an on-topic organiser whose name legitimately contains the topic", () => {
    const operating = event({
      id: "op",
      name: "Water Treatment Technical Day",
      organisations: [{ name: "Ion Exchange Global" }],
      description: "A day on ion exchange resin manufacturing.",
      tags: [],
    });
    const scored = scoreEvents([operating], { topics: ["ion exchange"] }, NOW);
    expect(scored.map((s) => s.id)).toEqual(["op"]);
  });
});

// A23-02 / Ruling 62b. The scoring pass's own expiry gate must read a
// month-granularity start at MONTH granularity. Reading `2026-08` as a
// day-level date puts it at 1 August, so a live August row would be dropped
// from the pool on the first of its own month — expiring it wrongly EARLY,
// which is the failure the ruling names.
describe("month-granularity expiry in the scoring pass", () => {
  it("keeps a month-granularity row mid-month", () => {
    const row = event({ id: "m", startDate: "2026-08", endDate: undefined, deadline: undefined });
    const scored = scoreEvents([row], { topics: ["machine learning"] }, Date.parse("2026-08-15T00:00:00Z"));
    expect(scored.map((s) => s.id)).toEqual(["m"]);
  });

  it("keeps it on the first of the month", () => {
    const row = event({ id: "m", startDate: "2026-08", endDate: undefined, deadline: undefined });
    const scored = scoreEvents([row], { topics: ["machine learning"] }, Date.parse("2026-08-01T12:00:00Z"));
    expect(scored.map((s) => s.id)).toEqual(["m"]);
  });

  it("drops it once the month has fully passed", () => {
    const row = event({ id: "m", startDate: "2026-08", endDate: undefined, deadline: undefined });
    const scored = scoreEvents([row], { topics: ["machine learning"] }, Date.parse("2026-09-02T00:00:00Z"));
    expect(scored).toHaveLength(0);
  });
});
