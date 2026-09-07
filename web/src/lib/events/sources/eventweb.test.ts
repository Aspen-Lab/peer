import { afterEach, describe, expect, it, vi } from "vitest";

// RULING 75 (round 28 C, item 0). Only `searchGemini` is stood in for; the
// provider-order helpers stay REAL, so the resolution tests below still test
// shipped code rather than a stub.
const geminiSearchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sources/gemini-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/gemini-search")>()),
  searchGemini: geminiSearchMock,
}));

import {
  bestEventTitleSegment,
  bestEventTitleSegmentDetailed,
  clusterEventDays,
  COMMERCE_PATH_RE,
  DENY_HOSTS,
  eventNameFrom,
  eventweb,
  extractEventDate,
  extractEventDayCandidates,
  isEarningsCallPage,
  isEventArtefactTitle,
  isEventHubResult,
  isJobListingContentTitle,
  isNewsArticleTitle,
  looksLikeEventTitle,
  NEWS_MEDIA_HOSTS,
  ownedTitleSpan,
  resolveSearchProvider,
  webResultToRawEventItem,
} from "./eventweb";
// Phase 3 round 6 C, ITEM 2. `pageTitleFromHtml` is NOT stubbed above (only
// `searchGemini` is — see the RULING 75 comment) — this is the real, shipped
// title-extraction-plus-decode entry point gemini-sourced rows go through.
import { pageTitleFromHtml } from "@/lib/sources/gemini-search";
import {
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "@/lib/usage/events";
import { resetCounterStoreForTests } from "@/lib/usage/counters";

// No test file existed for this source adapter before B4-01 (round 4) — see
// MULTIAGENT-report-parity.md, B4-01's own risk note. These are foundational
// cases for the existing fallback chain plus the new title-shape guard;
// this file does not attempt full coverage of every helper in eventweb.ts.

describe("looksLikeEventTitle", () => {
  it("rejects a narrative sentence about the event, not its name", () => {
    // Same shape as B4-01's real repro (a page whose H1 rendered as a
    // sentence describing the event's history rather than its name),
    // paraphrased rather than quoted verbatim.
    expect(
      looksLikeEventTitle(
        "Rivertown Summit was originally planned for 2020 but was delayed due to a global outbreak.",
      ),
    ).toBe(false);
    expect(looksLikeEventTitle("The workshop has been postponed until further notice.")).toBe(
      false,
    );
  });

  it("rejects a candidate that is more than one sentence", () => {
    expect(
      looksLikeEventTitle("Registration is now open. Book your seat today for the workshop."),
    ).toBe(false);
  });

  it("does not mistake a mid-title abbreviation for a sentence boundary", () => {
    expect(looksLikeEventTitle("Dr. James Wong Memorial Lecture Series")).toBe(true);
    expect(looksLikeEventTitle("U.S. National Conference on Materials Science")).toBe(true);
  });

  it("accepts real, long event names", () => {
    expect(
      looksLikeEventTitle(
        "The First European Conference on Molten Salt Reactor Chemistry and Technology",
      ),
    ).toBe(true);
    expect(looksLikeEventTitle("Solid-State Battery Summit 2026")).toBe(true);
  });

  it("rejects an implausibly long run of prose with no other tell", () => {
    const longRun = Array.from({ length: 25 }, (_, i) => `topic${i}`).join(" ");
    expect(looksLikeEventTitle(longRun)).toBe(false);
  });

  it("rejects an empty or blank candidate", () => {
    expect(looksLikeEventTitle("")).toBe(false);
    expect(looksLikeEventTitle("   ")).toBe(false);
  });
});

describe("eventNameFrom", () => {
  it("picks the informative segment over site chrome", () => {
    expect(eventNameFrom("Solid-State Battery Summit | Cambridge EnerTech", "")).toBe(
      "Solid-State Battery Summit",
    );
  });

  it("does not turn generic Open Graph page chrome into an event title", () => {
    expect(bestEventTitleSegment("Home | Events", "https://example.com/event")).toBeUndefined();
  });

  it("falls through to snippet mining when the whole title is a sentence", () => {
    const title =
      "Rivertown Summit was originally planned for 2020 but was delayed due to a global outbreak.";
    const snippet =
      "Rivertown Summit is a two-day materials science conference held every spring.";
    // B12-01 (round 12, §1aa Ruling 40): restated, not deleted. The snippet
    // stage used to return the whole sentence; it now returns the name inside
    // it. Strictly better in the same direction — a sentence is never a name.
    expect(eventNameFrom(title, snippet)).toBe("Rivertown Summit");
  });

  it("falls through to the URL slug when both title and snippet fail every check", () => {
    const title = "Rivertown Summit was originally planned for 2020 but was delayed.";
    const snippet = "";
    const url = "https://example.com/events/rivertown-materials-summit-2026";
    // nameFromUrlSlug only title-cases the very first character; the rest of
    // the slug's own casing (already lowercase) passes through unchanged.
    expect(eventNameFrom(title, snippet, url)).toBe("Rivertown materials summit 2026");
  });

  it("does not use a headline-shaped URL slug as an event name", () => {
    expect(
      eventNameFrom(
        "Home | Events",
        "The International Battery Summit brings researchers together.",
        "https://example.com/events/registration-deadline-extended-march-2026",
      ),
      // B12-01 (round 12, §1aa Ruling 40): restated. The determiner stays on —
      // Ruling 39a point 4 is binding and this design strips none.
    ).toBe("The International Battery Summit");
  });

  // B9-04 Fix 1 (round 9, Ruling 32): this test used to assert "Home" — one
  // of the two segments isChromeSegment/GENERIC_PAGE_TITLE_RE had already
  // rejected a few lines above ("Home" and "Events" are both chrome here),
  // reinstated verbatim by the old `segments[0] ?? title.trim()` absolute
  // last resort. That is exactly the pattern Ruling 32 named the defect: a
  // guard rejects a candidate, then a fallback hands the reader that same
  // rejected candidate anyway. With no URL to read an honest host from, the
  // new last resort is a literal placeholder, not a second look at the
  // pool the guard just rejected.
  it("falls back to a literal placeholder when every title segment is chrome and there is no URL", () => {
    expect(eventNameFrom("Home | Events", "", undefined)).toBe("Untitled event");
  });

  // The same "every segment is chrome" shape, but WITH a URL present — the
  // last resort now reads the URL's own host, which is never a value any
  // guard rejected (only title segments were ever tested), matching this
  // codebase's own honest-placeholder precedent on the job side.
  it("falls back to the URL host when every title segment is chrome and a URL is available", () => {
    expect(eventNameFrom("Home | Events", "", "https://www.example.org/events/index")).toBe(
      "example.org",
    );
  });

  // B5-06/R13, three separate sub-gaps confirmed on real events A found,
  // none of them the shape R1's own guard (NARRATIVE_VERB_RE) targets.

  // Gap 1: a chrome segment that STARTS WITH a recognised generic word but
  // isn't an exact match for it ("Agenda & Information", paraphrased —
  // real event 2's title segment started with "Agenda" the same way).
  it("rejects a generic-title word with a short trailing phrase, not only an exact match", () => {
    expect(
      eventNameFrom("Agenda & Information | Riverside Materials Symposium", ""),
    ).toBe("Riverside Materials Symposium");
    expect(
      eventNameFrom("Schedule and Details | Example Energy Conference", ""),
    ).toBe("Example Energy Conference");
  });

  // Gap 2: a segment that is the page's OWN site/organisation brand, not the
  // event's name — "The Engine" on engine.xyz, paraphrased from real event
  // 2's other title segment. Reuses looksLikeHostBrand (B5-03).
  it("rejects a segment that is the page's own site brand (with or without a leading article)", () => {
    expect(
      eventNameFrom(
        "The Engine | Deep Tech Founders Expo",
        "",
        "https://engine.xyz/events/123",
      ),
    ).toBe("Deep Tech Founders Expo");
    expect(
      eventNameFrom(
        "Deep Tech Founders Expo | ExampleBoard",
        "",
        "https://exampleboard.io/events/123",
      ),
    ).toBe("Deep Tech Founders Expo");
  });

  // Without a URL, the brand checks have nothing to compare against and
  // simply don't run — the same segment that gets rejected once a host IS
  // available (previous test) is treated as informative instead. Isolated
  // to a single-segment title so the outcome actually depends on this,
  // rather than incidentally passing via the eventLike/longest-segment
  // tie-break the way a two-segment title would.
  it("does not attempt the site-brand check when no URL is available", () => {
    expect(eventNameFrom("The Engine", "")).toBe("The Engine");
  });

  // Gap 3, both halves together: a plain-hyphen-joined title now splits
  // (previously stayed one unsplit segment, matching real event 3's own
  // title shape), AND the headline segment this exposes ("Registration
  // deadline extended") is itself recognised as narration, not a name, even
  // with no auxiliary verb for NARRATIVE_VERB_RE to catch. Confirmed by
  // hand this test would fail without the headline check: "registration" is
  // itself an EVENT_SIGNAL_RE keyword, so without HEADLINE_PASSIVE_RE the
  // longer headline segment (31 chars) would out-rank the real name (26
  // chars) under the existing longest-segment tie-break.
  it("splits on a plain hyphen and rejects the elliptical-passive headline it exposes", () => {
    expect(
      eventNameFrom(
        "Registration deadline extended - Example Energy Conference",
        "",
      ),
    ).toBe("Example Energy Conference");
  });

  it("splits a hyphen-joined title the same way it already splits a pipe-joined equivalent", () => {
    const viaHyphen = eventNameFrom(
      "Riverside Materials Symposium - Example Host",
      "",
    );
    const viaPipe = eventNameFrom(
      "Riverside Materials Symposium | Example Host",
      "",
    );
    expect(viaHyphen).toBe("Riverside Materials Symposium");
    expect(viaHyphen).toBe(viaPipe);
  });

  // B8-06 (round 8): confirms what renders AFTER the shape-1 guard fires,
  // not only that looksLikeEventTitle itself returns false in isolation
  // (already covered above). This is the standard B's own log named
  // explicitly: a rejected segment must yield a real name from the same
  // fallback chain, not just disappear.
  it("falls through to a real event name when the narrative-sentence segment is rejected", () => {
    expect(
      eventNameFrom(
        "Ruggiero Group Attends the 2026 Crystal Engineering GRC | Crystal Engineering Symposium",
        "",
      ),
    ).toBe("Crystal Engineering Symposium");
  });

  // B8-06 (round 8), shape 2: two generic words concatenated with no
  // connector at all ("Conference Program") — round 6 first named this
  // shape, reconfirmed live again this round on the same URL.
  describe("bare concatenated generic words (B8-06)", () => {
    it("rejects a bare two-word generic phrase with no connector, keeping the real event name", () => {
      // A's own reconfirmed live example, verbatim.
      expect(
        eventNameFrom("Conference Program | Riverside Materials Symposium", ""),
      ).toBe("Riverside Materials Symposium");
    });

    it("does not treat a real two-word segment as chrome merely because one word is generic", () => {
      // Hardest inverse case: "Workshop" alone is in the same generic-word
      // list that must catch "Conference Program" above, but a real,
      // specific segment pairing it with a substantive word must survive —
      // the "every word must be generic" requirement is what protects this,
      // not the word list being short.
      expect(bestEventTitleSegment("Battery Workshop")).toBe("Battery Workshop");
    });
  });

  // B8-06 (round 8), shape 3: a served document's own filename with its
  // extension ("AA ECC10 POSTERS 08072026.xlsx") reaching the title-segment
  // path directly — new this round, traced to bestEventTitleSegment, not
  // the URL-slug fallback (nameFromUrlSlug already strips an extension
  // before it can return one).
  describe("raw filename with extension (B8-06)", () => {
    it("rejects a raw filename-with-extension segment, keeping the real event name", () => {
      // A's own reconfirmed live example, verbatim.
      expect(
        eventNameFrom("AA ECC10 POSTERS 08072026.xlsx | Advanced Composites Conference", ""),
      ).toBe("Advanced Composites Conference");
    });

    it("does not reject a real segment merely because it ends with a period-abbreviated word", () => {
      // Hardest inverse case: the extension check is anchored to a short,
      // closed document-extension list, not "ends with a period" — a real
      // segment ending in an unrelated period-abbreviation must survive.
      expect(
        bestEventTitleSegment("International Workshop on Molten Salt Chemistry, Inc."),
      ).toBe("International Workshop on Molten Salt Chemistry, Inc.");
    });
  });

  // B9-04 Fix 2 (round 9): unit-level coverage for the new skipHostBrand
  // option itself, independent of enrich.ts's own integration tests (which
  // cover the actual call site being changed). isChromeSegment bundles four
  // checks; skipHostBrand must bypass only the host-brand one.
  describe("skipHostBrand option (B9-04 Fix 2)", () => {
    it("rescues a segment rejected only for matching its own host's brand", () => {
      // Without the option: rejected, same as before this fix — an
      // organisation's own domain restating its own name still looks like
      // site chrome by default.
      expect(
        bestEventTitleSegment("SolarPACES", "https://solarpaces.example.org/conference"),
      ).toBeUndefined();
      // With it: rescued. This is the one thing skipHostBrand exists to do.
      expect(
        bestEventTitleSegment("SolarPACES", "https://solarpaces.example.org/conference", {
          skipHostBrand: true,
        }),
      ).toBe("SolarPACES");
    });

    it("still rejects a generic page title even with skipHostBrand set", () => {
      // "Conference Program" (B8-06/B9-01's live-confirmed repro) is chrome
      // for a reason that has nothing to do with the host — skipHostBrand
      // must not accidentally widen into "skip every check."
      expect(
        bestEventTitleSegment("Conference Program", "https://example.com/event", {
          skipHostBrand: true,
        }),
      ).toBeUndefined();
    });

    it("still rejects a raw document filename even with skipHostBrand set", () => {
      // The other B8-06/B9-01 shape, same reasoning: rejected for being a
      // filename, not for matching a host brand.
      expect(
        bestEventTitleSegment("AA ECC10 POSTERS 08072026.xlsx", "https://example.com/event", {
          skipHostBrand: true,
        }),
      ).toBeUndefined();
    });
  });

  // B9-04's bare-date guard (round 9): internationalbatteryseminar.com's
  // own live-confirmed repro — a segment that is only a date cleared every
  // existing check and rendered as the event's name.
  describe("bare date segment (B9-04)", () => {
    // Multi-word, punctuated hardest case per Ruling 31: the live repro
    // itself, with a day range and a comma, paired with a real name it must
    // lose to.
    it("rejects a segment that is only a date, falling through to a real name", () => {
      expect(
        eventNameFrom("March 15-18, 2027 | International Battery Seminar", ""),
      ).toBe("International Battery Seminar");
    });

    // The "should match nothing" hardest case, and the one this guard is
    // most likely to get wrong: "SolarPACES 2026" (an existing passing case
    // elsewhere in this file) legitimately CONTAINS a year but is not a
    // date-shaped segment as a whole — the guard must require the segment
    // be date-and-nothing-else, not merely date-containing.
    it("does not reject a real event name merely because it contains a year", () => {
      expect(bestEventTitleSegment("SolarPACES 2026")).toBe("SolarPACES 2026");
    });

    // The literal live shape: the WHOLE title is nothing but a date, no
    // second segment to fall back to within bestEventTitleSegment itself —
    // eventNameFrom must continue past it to the snippet, same fallback
    // chain every other chrome shape in this file already uses.
    it("continues past a bare date-only title with no other segment to the snippet", () => {
      expect(
        eventNameFrom(
          "March 15-18, 2027",
          "The International Battery Seminar brings together researchers.",
        ),
        // B12-01 (round 12, §1aa Ruling 40): restated to the name inside the
        // sentence. What this test guards — that execution continues PAST the
        // bare date to the snippet — is unchanged.
      ).toBe("The International Battery Seminar");
    });
  });

  // B10-02 (round 10): internationalbatteryseminar.com's own live-confirmed
  // repro — once B9-04's bare-date guard rejects the sibling date segment,
  // a bare "City, ST" location segment fills the slot instead, because
  // nothing in this file had any concept of "this is only a location."
  describe("bare location segment (B10-02)", () => {
    // The live repro itself: a bare location segment must lose to a real
    // name sitting in the same title.
    it("rejects a segment that is only a city/state location, falling through to a real name", () => {
      expect(
        eventNameFrom("March 15-18, 2027 | Orlando, FL | International Battery Seminar", ""),
      ).toBe("International Battery Seminar");
    });

    // The literal live shape: no other segment to fall back to within
    // bestEventTitleSegment itself.
    it("rejects a bare location-only title with no other segment, continuing to the snippet", () => {
      expect(
        eventNameFrom(
          "Orlando, FL",
          "The International Battery Seminar brings together researchers.",
        ),
        // B12-01 (round 12, §1aa Ruling 40): restated to the name inside the
        // sentence. What this test guards — that a location-only title falls
        // through to the snippet — is unchanged.
      ).toBe("The International Battery Seminar");
    });

    // The "should match nothing" hardest case, and the reason this check is
    // anchored to the WHOLE segment rather than copying the job side's
    // unanchored trailing check verbatim: a real, longer event name that
    // merely ENDS in a city/state must survive. A's own live, already-
    // correct 10times.com example, named explicitly per B10-02's own
    // instruction rather than a synthetic case.
    // A23-02 gap (a) / Ruling 62b RESTATEMENT (not a deletion). What THIS test
    // guards is unchanged and still asserted below: the bare-location check is
    // anchored to the WHOLE segment, so a real name is never REJECTED for
    // ending in a place. What changed is that the aggregator's date and city
    // are now recognised as listing FURNITURE and stripped off the accepted
    // segment — A ranked the old value as the defect, since the card printed a
    // date inside the name while also calling the event undated.
    it("does not reject a real event name merely because it ends in a city/state", () => {
      // Not rejected — accepted, then trimmed of its furniture.
      expect(
        bestEventTitleSegment("Solid-State Battery Summit (Aug 2026), Chicago USA"),
      ).toBe("Solid-State Battery Summit");
      // And a name whose city is its own distinguishing content, with no comma
      // in front of it, is untouched — the boundary that keeps the two apart.
      expect(bestEventTitleSegment("The Battery Show Detroit")).toBe(
        "The Battery Show Detroit",
      );
    });
  });

  // B10-03 (round 10): ecs.confex.com's live repro — a real conference-
  // platform page/section label ("Call for Papers") stands in for the
  // event's own name. Ironic mechanism named in B10-03: EVENT_SIGNAL_RE
  // treats the identical phrase as a POSITIVE event signal, which is part
  // of why the page is recognised as an event page at all.
  describe("Call for Papers page label (B10-03)", () => {
    it("rejects a bare 'Call for Papers' segment, falling through to a real name", () => {
      expect(eventNameFrom("Call for Papers | 250th ECS Meeting", "")).toBe("250th ECS Meeting");
    });

    it("rejects a bare 'Call for Papers' title with no other segment, continuing to the snippet", () => {
      expect(
        eventNameFrom("Call for Papers", "The 250th ECS Meeting welcomes abstract submissions."),
        // B12-01 (round 12, §1aa Ruling 40): restated. B11-02 wrote this test
        // and its asserted "correct" answer was itself a wrong event name —
        // the real name is "The 250th ECS Meeting", not a sentence about it.
        // This is the assertion that made the class visible.
      ).toBe("The 250th ECS Meeting");
    });

    // Must-survive: a longer, real sentence that legitimately CONTAINS the
    // phrase must not be caught as chrome — the generic-title check requires
    // either an exact phrase match or every word in the segment to be
    // generic, and a longer real sentence has words outside that closed
    // list, so it must reach bestEventTitleSegment's output untouched.
    it("does not reject a real sentence that merely contains the phrase", () => {
      expect(
        bestEventTitleSegment("Call for Papers now open for the 2026 Battery Symposium"),
      ).toBe("Call for Papers now open for the 2026 Battery Symposium");
    });
  });

  // B12-03 gap A (round 12): the WELDED page-type label. A's item 4 looked like
  // three hosts with one defect; B established by execution that it is two
  // different defects, and this describe covers the first.
  //
  // The mechanism, and it is the whole item: every guard in this file only ever
  // sees a segment the SPLITTER already produced, and the splitter needs a
  // separator with whitespace around it. `battery-power.eu` writes
  // "Call for papers - Battery Conference 2027", which splits, so B10-03's
  // generic-title check catches the label half and the real name survives.
  // The two hosts below weld the label on with no separator at all, so the
  // whole title is ONE segment which is neither generic (not every word is a
  // generic word) nor narration — it passes every guard and reaches the reader
  // with the label still attached.
  describe("welded page-type label (B12-03 gap A)", () => {
    // battery2030.eu's live repro, verbatim. Front form.
    it("strips a leading label welded on with 'for the'", () => {
      expect(
        bestEventTitleSegment("Call for Abstracts for the Battery 2030+ Annual Conference 2026"),
      ).toBe("Battery 2030+ Annual Conference 2026");
    });

    // isea.rwth-aachen.de's live repro, verbatim. Back form, no punctuation.
    it("strips a trailing label welded on with no separator", () => {
      expect(
        bestEventTitleSegment("Advanced Battery Power Conference 2026 Call for Papers"),
      ).toBe("Advanced Battery Power Conference 2026");
    });

    it("strips a trailing label attached by a colon", () => {
      expect(
        bestEventTitleSegment("Advanced Battery Power Conference 2026: Call for Papers"),
      ).toBe("Advanced Battery Power Conference 2026");
    });

    // The same shape with a SPACED hyphen resolves through the splitter and
    // B10-03's generic-title check instead, never reaching the strip. Asserted
    // because the two routes must agree on the answer — if a future round
    // changes one, this says the other exists.
    it("reaches the same answer through the splitter when the separator is spaced", () => {
      expect(
        bestEventTitleSegment("Advanced Battery Power Conference 2026 - Call for Papers"),
      ).toBe("Advanced Battery Power Conference 2026");
    });

    // THE must-survive case, and the one B12-03's design was shaped around.
    // B found this by running the design against the existing suite: without
    // requiring `for (the)` IMMEDIATELY after the label, the front form eats
    // this into "now open for the 2026 Battery Symposium" and breaks B10-03's
    // assertion four lines above. This is a second copy of that assertion,
    // stated here as a must-survive so the reason it matters is local to the
    // fix that endangers it.
    it("does not strip a label that continues into a real sentence", () => {
      expect(
        bestEventTitleSegment("Call for Papers now open for the 2026 Battery Symposium"),
      ).toBe("Call for Papers now open for the 2026 Battery Symposium");
    });

    // The remainder must still NAME an event. A real call for papers for a
    // PRIZE is not an event, so stripping would leave a non-name behind.
    it("does not strip when the remainder names no kind of event", () => {
      expect(bestEventTitleSegment("Call for Papers for the 2026 Ruggiero Prize")).toBe(
        "Call for Papers for the 2026 Ruggiero Prize",
      );
    });

    // Real names that merely resemble the shape, none of which must move.
    it.each([
      "26th Advanced Automotive Battery Conference (AABC)",
      "Battery Conference 2027",
      "SolarPACES 2026",
    ])("does not touch a real event name: %s", (title) => {
      expect(bestEventTitleSegment(title)).toBe(title);
    });

    // A bare label is NOT this fix's business — isGenericPageTitle already owns
    // it and rejects the segment outright, which is a different and better
    // outcome than stripping it to nothing.
    it("leaves a bare label to the generic-title check, which rejects it", () => {
      expect(bestEventTitleSegment("Call for Papers")).toBeUndefined();
    });

    // Recorded by B as correct-not-a-miss, and asserted so a future round does
    // not read it as over-reach that slipped through untested: this is the same
    // trade the job side already accepts when B9-02a strips "Careers" off
    // "Idaho National Laboratory Careers". The remainder still names the event.
    it("strips a trailing 'Programme' label, the same trade the job side accepts", () => {
      expect(bestEventTitleSegment("Riverside Materials Symposium Programme")).toBe(
        "Riverside Materials Symposium",
      );
    });
  });

  // B12-04 (round 12): an event named after its own domain. The host-brand
  // check normalises "International Battery Seminar" to
  // "internationalbatteryseminar" and asks whether any DNS label starts with
  // it — the label IS that string, so the guard fires and the correct name,
  // which is sitting right there in the page's own title, is thrown away. The
  // title stage then returns nothing, the root URL has no deep slug to mine,
  // and the render falls all the way through to the snippet.
  //
  // Mirror image of B12-02: that host defeats the brand check by having a
  // domain that looks NOTHING like its name; this one by having a domain that
  // IS its name. Same check, opposite failure, and neither is fixable by
  // widening the check.
  describe("event named after its own domain (B12-04)", () => {
    // THE live repro. Note the existing B10-02 assertion higher up uses this
    // same title with NO url — which is why it passed all along and never
    // exercised the defect. The URL is the entire difference.
    it("keeps a name that matches its own host when the name is an event kind", () => {
      expect(
        eventNameFrom(
          "March 15-18, 2027 | Orlando, FL | International Battery Seminar",
          "",
          "https://www.internationalbatteryseminar.com/",
        ),
      ).toBe("International Battery Seminar");
    });

    // The same segment on its own, so the outcome cannot come from the
    // sibling tie-break.
    it("keeps a lone host-matching segment that names an event kind", () => {
      expect(
        bestEventTitleSegment(
          "International Battery Seminar",
          "https://www.internationalbatteryseminar.com/",
        ),
      ).toBe("International Battery Seminar");
    });

    // MUST STAY REJECTED. Every one of these is a real site brand that matches
    // its host and names no kind of event, so the exemption cannot reach it.
    // These are B5-06's and B5-03's own repros — the fixes this exemption
    // could plausibly have undone.
    it.each([
      ["The Engine", "https://engine.xyz/events/123"],
      ["Climatebase", "https://climatebase.org/events/123"],
      ["10times", "https://10times.com/events/123"],
    ])("still rejects the site's own brand: %s", (segment, url) => {
      expect(bestEventTitleSegment(segment, url)).toBeUndefined();
    });

    // The exemption defers to isEventIndexPage by construction — that check
    // returns true before the host-brand branch is ever reached — so an events
    // DIRECTORY whose brand contains an event noun is still rejected. This is
    // the residual risk B named, asserted rather than left as prose.
    it("still rejects an events directory whose own brand names an event kind", () => {
      expect(
        bestEventTitleSegment("Upcoming Battery Conferences", "https://batteryconferences.com/"),
      ).toBeUndefined();
    });

    // §1z Ruling 39's recorded lead, acted on because its own condition fired:
    // "if the guard family is touched again, a year-less variant test is the
    // cheap way to make that fragility visible before it bites."
    //
    // The SolarPACES regression lock survives the host-brand check ONLY because
    // its title carries a trailing year, which makes the candidate longer than
    // the DNS label and trips looksLikeHostBrand's one-directional rule. These
    // two assertions state that plainly: with the year it survives, without the
    // year it does not — and B12-04 does NOT change that, because "SolarPACES"
    // names no event kind so the exemption cannot reach it either. Recorded as
    // the CURRENT behaviour, not as a behaviour anyone should want.
    it("shows the SolarPACES lock still depends on its trailing year", () => {
      expect(bestEventTitleSegment("SolarPACES 2026", "https://www.solarpaces.org/")).toBe(
        "SolarPACES 2026",
      );
      expect(bestEventTitleSegment("SolarPACES", "https://www.solarpaces.org/")).toBeUndefined();
    });
  });

  // B12-05 (round 12): the URL-slug stage was LAUNDERING a document filename
  // past the guard written to reject it. DOCUMENT_FILENAME_RE (B8-06) stops a
  // served document's filename becoming an event name, and it works at the
  // title stage — but the slug stage's first act was to strip the extension,
  // so the guard could never see one. Round 9's B named it exactly: "a
  // filename, just without the dot and three letters." Unchanged since, and
  // euchems2026.eu rotates the document, so the mechanism mints a fresh wrong
  // name every time it is measured.
  describe("document filename laundered through the URL slug (B12-05)", () => {
    // The live repro. Round 9 and round 12 saw different documents from the
    // same host, which is the point.
    it("does not turn a served document's filename into an event name", () => {
      expect(
        eventNameFrom(
          "ECC102026-POSTERS-v2.pdf",
          "",
          "https://www.euchems2026.eu/files/ECC102026-POSTERS-v2.pdf",
        ),
      ).toBe("euchems2026.eu");
    });

    // The title stage already rejected it; this asserts the two stages now
    // agree instead of the second undoing the first.
    it("keeps the title stage and the slug stage agreeing on a filename", () => {
      expect(
        bestEventTitleSegment(
          "ECC102026-POSTERS-v2.pdf",
          "https://www.euchems2026.eu/files/ECC102026-POSTERS-v2.pdf",
        ),
      ).toBeUndefined();
    });

    // Media extensions come from EMBEDDED_FILENAME_RE, the other existing list.
    it("does not turn an image filename into an event name", () => {
      expect(
        eventNameFrom("Home | Events", "", "https://example.org/media/battery-symposium-photo.jpg"),
      ).toBe("example.org");
    });

    // MUST-SURVIVE, and B named it as the assertion to protect: a slug with NO
    // extension is untouched. This is the same case as the existing
    // "falls through to the URL slug" test higher up, restated here so the
    // protection is local to the fix that could break it.
    it("still reads a real event name from an extensionless slug", () => {
      expect(
        eventNameFrom(
          "Rivertown Summit was originally planned for 2020 but was delayed.",
          "",
          "https://example.com/events/rivertown-materials-summit-2026",
        ),
      ).toBe("Rivertown materials summit 2026");
    });

    // MUST-SURVIVE, and the reason the generic `\.\w{2,5}$` strip below the new
    // check is deliberately left in place: a PAGE extension is not a document,
    // and rejecting those would throw away real names on every classic-CMS
    // site. Only the closed document/media lists reject.
    it.each(["html", "php", "aspx"])(
      "still reads a real event name from a slug ending .%s",
      (ext) => {
        expect(
          eventNameFrom(
            "Home | Events",
            "",
            `https://example.com/events/rivertown-materials-summit-2026.${ext}`,
          ),
        ).toBe("Rivertown materials summit 2026");
      },
    );
  });

  // B11-02 (round 11, Rulings 32/35): the sequel to B10-03 above, same host.
  // Once "Call for Papers" is correctly rejected as a title segment,
  // execution reaches the snippet-mining stage — which filtered candidates
  // with `looksLikeEvent` alone, a topicality check that happily passes a
  // full narrative sentence containing one topic keyword. ecs.confex.com
  // rendered "Invited speakers present keynote lectures." live as a result.
  describe("snippet stage shape guard (B11-02)", () => {
    // THE hardest real shape, and the case B11-01 identified as the actual
    // live mechanism: two candidates in one snippet, both passing
    // `looksLikeEvent` ("Meeting" and "keynote" are both on its list), where
    // the WRONG one wins the longest-fragment tie-break by two characters
    // (42 vs 40). Both fragments are real and confirmed present on the live
    // page by round 11 A part 2. No test in either file exercising this
    // stage had more than one viable candidate before this one, which is
    // why nothing caught the regression: with `looksLikeEvent` as the only
    // filter this returns the narrative sentence, not the name.
    it("prefers the real name over a longer narrative sentence in the same snippet", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "250th ECS Meeting (October 25-29, 2026). Invited speakers present keynote lectures.",
        ),
        // B12-01 (round 12, §1aa Ruling 40): restated, and this is the NINTH
        // such assertion — B12-01's design counted eight, because it enumerated
        // the ones asserting a SENTENCE. This one asserted a name with a
        // parenthetical date and a full stop welded on, which is the same
        // defect wearing different clothes. The span stops at "(October"
        // because an opening bracket is not a name token.
      ).toBe("250th ECS Meeting");
    });

    // The narrative sentence on its own, with nothing better beside it. The
    // guard is only a fix if what replaces the rejected value is defensible
    // (Ruling 26): here every candidate is rejected, so execution falls
    // through to the honest URL-host last resort (B9-04 Fix 1) rather than
    // reinstating the string the guard just rejected.
    it("falls through to the honest host when the only candidate is a narrative sentence", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Invited speakers present keynote lectures.",
          "https://www.ecs.confex.com/ecs/250/cfp.cgi",
        ),
      ).toBe("ecs.confex.com");
    });

    // B11-01's enumeration shape 4, closed as a side effect of filtering
    // BEFORE the `looksLikeEvent` preference tier rather than after it: when
    // no fragment is event-like at all, the old ternary discarded the
    // filter's verdict wholesale and returned the longest raw fragment. The
    // snippet here has no topic keyword and its longest fragment is a
    // narrative sentence, so the old code returned that sentence.
    it("does not reinstate an unfiltered fragment when nothing is event-like", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "The venue was refurbished last year and now seats twelve hundred people.",
          "https://example.org/cfp",
        ),
      ).toBe("example.org");
    });
  });

  // B12-01 (round 12, §1aa Ruling 40): the sequel to B11-02 above, same host,
  // same stage. B11-02's guard was not bypassed — it ran and correctly said
  // "not narration", because the stage's own CONTRACT was to return a whole
  // sentence and this file asserted that nine times. So this item changes what
  // the stage RETURNS: the leading NAME SPAN inside the fragment, or nothing.
  // Those nine assertions are restated above, each commented `B12-01`.
  //
  // Ruling 40 resolved the item's one open question: the event-kind test is
  // PHRASE-level over the joined span, not word-level, because both codebase
  // enumerations the design draws on carry multi-word kinds. The first attempt
  // was stopped for exactly that — see the must-recover cases at the end.
  describe("leading name span (B12-01)", () => {
    // THE live defect this item exists for, verbatim from round 12 A's log.
    // Every narrative check in `looksLikeEventTitle` passes it: it is a copular
    // predication ("are due" — an adjective, not a participle), so no verb
    // inventory can see it. The span rule stops at "Abstracts", one word.
    it("drops the live deadline sentence and falls through to the honest host", () => {
      const rendered = eventNameFrom(
        "Call for Papers",
        "Abstracts are due no later than Friday, 4 September 2026 at 11:59 PM Eastern Standard Time.",
        "https://www.ecs.confex.com/ecs/250/cfp.cgi",
      );
      expect(rendered).toBe("ecs.confex.com");
      // Why step 1 is anchored to the START, verified rather than assumed: an
      // unanchored "longest Title-Case run anywhere" finds this inside the very
      // sentence the item exists to reject.
      expect(rendered).not.toBe("Friday, 4 September 2026");
    });

    // The SHARPENED must-reject. Its first version ended "...no late work will
    // be accepted", which `NARRATIVE_VERB_RE` catches — so it passed pre-fix
    // for the wrong reason and proved nothing about the span rule. Rewritten to
    // clear all four narrative checks, so only the span rule can stop it.
    it("drops a deadline sentence that clears every narrative check", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "The deadline falls on Friday and nothing later than that counts.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    it("drops a sentence whose leading span is a page label and its joiners", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Registration for the conference opens in May.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    it("drops a submission-instruction sentence", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Papers must reach the committee by 30 June.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    it("drops a venue-change sentence", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "This year the meeting moves to Lisbon.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    it("drops a logistics sentence", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Delegates receive a printed programme on arrival.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    // ruggedthz.com's failure mode 2, the mid-sentence prose fragment a
    // provider snippet can start on. Nothing capitalised leads it, so the span
    // is empty before the walk takes a single step.
    it("drops a fragment that starts mid-sentence in lower case", () => {
      expect(
        eventNameFrom(
          "Home | Events",
          "sessions, even if breakfast occasionally became more of a debate than a meal.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    // The two-word floor. A lone event-kind noun is a topic, not a name — this
    // is the check that stops the rule claiming "Workshop" as an event's name.
    it("drops a span of a single event-kind word", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Workshop registration closes at noon on the final day.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    // Trailing joiners are dropped BEFORE the two-word floor is applied, so
    // "Symposium on the" counts as one word and not three.
    it("drops trailing joiners before applying the two-word floor", () => {
      expect(
        eventNameFrom(
          "Call for Papers",
          "Symposium on the future of grid storage begins in June.",
          "https://example.com/cfp",
        ),
      ).toBe("example.com");
    });

    // THE DOCUMENTED HONEST MISS, asserted rather than hidden. Every token is
    // Title-Case and "Conference" is an event kind, so this survives the span
    // rule unchanged — it passes both pre- and post-fix, which is the whole
    // point of writing it down. internationalbatteryseminar.com's carousel
    // label has its own cause and its own fix (B12-04); B12-01 neither fixes it
    // nor makes it worse, and this test is what will fail loudly if a future
    // round ever believes otherwise.
    it("does NOT fix a Title-Case widget label — the honest miss, stated in the suite", () => {
      expect(eventNameFrom("Home", "Conference Image Gallery Carousel")).toBe(
        "Conference Image Gallery Carousel",
      );
    });

    // MUST-RECOVER, and this is the regression that stopped B12-01's first
    // attempt. The design's noun list was single-word (`roundtable`), the real
    // name says `Round Table`, and the kind test is a hard veto — so a correct,
    // live-derived event name became "Untitled event", the one direction
    // Rulings 23/26 forbid. Ruling 40's phrase-level test is what recovers it.
    // The same fixture is asserted independently in events/scoring.test.ts.
    it("recovers a name whose event kind is two words (the Round Table regression)", () => {
      expect(
        eventNameFrom(
          "Meeting Summary",
          "2026 International Round Table on Titanium Production in Molten Salts. Registration is open.",
        ),
      ).toBe("2026 International Round Table on Titanium Production in Molten Salts.");
    });

    // MUST-RECOVER, second kind. `lecture series` appears in NO single-word
    // form anywhere in either enumeration, so this name is recoverable only
    // through the phrase list — it is the case that fails if that list is ever
    // quietly reduced back to single words.
    it("recovers a name whose event kind is only ever spelled as a phrase", () => {
      expect(
        eventNameFrom(
          "Meeting Summary",
          "Molten Salt Lecture Series on Reactor Chemistry begins in autumn.",
        ),
      ).toBe("Molten Salt Lecture Series on Reactor Chemistry");
    });
  });

  // B11-03 (round 11): scraped widget/markup chrome — the defect class
  // B11-01's enumeration named and neither existing guard had any concept
  // of. B11-01 confirmed by execution that BOTH live repros below pass
  // looksLikeEventTitle unchanged, so B11-02's guard alone cannot reach
  // them; these two checks are only reachable at all through the
  // isChromeSegment call B11-02 added to the snippet stage, which is why
  // that item had to land first.
  describe("scraped widget and markup chrome (B11-03)", () => {
    // internationalbatteryseminar.com's live repro. Everything the regex
    // actually keys on is verbatim from B11-01's own log — the image
    // extension, the cache-busting query string, the bracketed ellipsis and
    // the carousel widget's own label. Only the leading personal name of the
    // photographed speaker is substituted, since it is a real individual's
    // name, carries no part of the shape being tested, and this file already
    // has a precedent for paraphrasing the non-load-bearing part of a repro
    // (see the looksLikeEventTitle block at the top).
    it("rejects an embedded filename with a query string stitched into scraped text", () => {
      expect(
        bestEventTitleSegment(
          "Speaker Photo.jpeg?sfvrsn=2fdd4033_1) [...] Conference Image Gallery Carousel",
        ),
      ).toBeUndefined();
    });

    // The same value in the place it actually reached a reader: the snippet
    // stage, where it beat the real name on the longest-fragment tie-break.
    // This is the case that proves the two items compose — it fails with
    // B11-02 alone.
    it("keeps the real event name when scraped image chrome sits beside it in a snippet", () => {
      expect(
        eventNameFrom(
          "Home",
          "Speaker Photo.jpeg?sfvrsn=2fdd4033_1) [...] Conference Image Gallery Carousel. The International Battery Seminar brings researchers together.",
        ),
        // B12-01 (round 12, §1aa Ruling 40): restated to the name inside the
        // sentence. What this test guards — that the scraped image chrome loses
        // to the real name — is unchanged; B11-03's filter still rejects the
        // chrome fragment before B12-01's span rule ever sees it.
      ).toBe("The International Battery Seminar");
    });

    // thebatteryshowsouth.com's live repro, verbatim.
    it("rejects a raw Markdown heading marker and bracketed ellipsis", () => {
      expect(bestEventTitleSegment("[...] ## 2026 Keynote Speakers")).toBeUndefined();
    });

    it("keeps the real event name when scraped Markdown chrome sits beside it in a snippet", () => {
      expect(
        eventNameFrom(
          "Home",
          "[...] ## 2026 Keynote Speakers. The Battery Show South returns to Atlanta this year.",
        ),
        // B12-01 (round 12, §1aa Ruling 40): restated. The determiner stays on
        // — "The Battery Show South" is the event's actual name, and B12-01's
        // own mid-design correction is why no determiner strip exists here.
      ).toBe("The Battery Show South");
    });

    // THE must-survive case, and the reason the hash floor is {2,6} rather
    // than {1,6}. A single `#` followed by a space reads as ordinary title
    // punctuation, not markup, and this shape has exactly one live
    // confirmation behind it — so the narrower floor is doing deliberate
    // work. This test exists so a future round cannot quietly relax the
    // floor without a failing test telling it exactly what that costs.
    it("does not reject a real title containing a single hash as ordinary punctuation", () => {
      expect(
        bestEventTitleSegment("Session # 3: Advanced Battery Chemistry Track"),
      ).toBe("Session # 3: Advanced Battery Chemistry Track");
    });

    // The matching must-survive case for the filename check: it keys on a
    // literal period immediately before a closed extension list, not on the
    // format word appearing anywhere. A real workshop about a file format
    // must survive.
    it("does not reject a real title merely because it names a file format", () => {
      expect(
        bestEventTitleSegment("Workshop on PDF Accessibility Standards 2026"),
      ).toBe("Workshop on PDF Accessibility Standards 2026");
    });
  });

  // B12-02 (round 12): ruggedthz.com, the host §1w Ruling 36's pre-set third
  // strike authorised a fix for. The whole adversarial matrix B built is
  // reproduced here, including the case that killed B's own first version —
  // that one is the reason the design has a stand-down step at all, so it is
  // the single most load-bearing test in this block.
  describe("narrative-segment name recovery (B12-02)", () => {
    const RUGGED_URL =
      "https://ruggedthz.com/ruggiero-group-attends-the-2026-crystal-engineering-grc";

    // FAILURE MODE 1, the real host's real <title> (round 9 A fetched it
    // directly). Before this fix the reader was told the event is called
    // "Ruggiero Research Lab" — a correct organisation name that is not an
    // event, and the ONLY name in the title lives inside the segment the
    // narrative guard rejects.
    it("recovers the event name from the rejected narrative segment", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Attends the 2026 Crystal Engineering GRC – Ruggiero Research Lab",
          "",
          RUGGED_URL,
        ),
      ).toBe("2026 Crystal Engineering GRC");
    });

    // THE counterexample. B built this to break its own V1 and it did: with no
    // stand-down step the recovery replaces a real event name with a label
    // ("2026 Call Deadline"). Here the SIBLING is the slug-corroborated one,
    // so the recovery must not fire and selection runs untouched. If a future
    // round removes step 6, this is the test that says what that costs.
    it("stands down when a surviving sibling is the slug-corroborated one", () => {
      expect(
        eventNameFrom(
          "SolarPACES Announces the 2026 Call Deadline – SolarPACES 2026",
          "",
          "https://solarpaces.org/solarpaces-announces-the-2026-call-deadline",
        ),
      ).toBe("SolarPACES 2026");
    });

    // FAILURE MODE 2, the same page on a different pull: the provider returned
    // a chrome-only title, so the title stage yields nothing and the URL-slug
    // stage correctly rejects its own narrative sentence (B10-04's casing fix
    // working). Without the second attachment point the snippet stage supplies
    // a mid-sentence prose fragment — A's fifth pull rendered exactly that.
    // Lowercase after the first character is nameFromUrlSlug's own convention.
    it("recovers from the URL slug when the title is chrome and the snippet is prose", () => {
      expect(
        eventNameFrom(
          "Home | Events",
          "sessions, even if breakfast occasionally became more of an aspiration than a reality.",
          RUGGED_URL,
        ),
      ).toBe("2026 crystal engineering grc");
    });

    // Chrome-only sibling: nothing survives the title stage at all, so before
    // this fix execution fell all the way to the honest URL host. The recovery
    // is strictly better than a hostname here.
    it("recovers even when the only sibling segment is chrome", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Attends the 2026 Crystal Engineering GRC – Home",
          "",
          RUGGED_URL,
        ),
      ).toBe("2026 Crystal Engineering GRC");
    });

    // An organisation name that legitimately IS the host org still loses to
    // the event the sentence actually names — the reader wants the event.
    it("prefers the named event over the organisation doing the attending", () => {
      expect(
        eventNameFrom(
          "Gordon Research Conferences Presents the 2026 Crystal Engineering GRC – Gordon Research Conferences",
          "",
          RUGGED_URL,
        ),
      ).toBe("2026 Crystal Engineering GRC");
    });

    // MUST-SURVIVE: no URL at all means no slug, so step 5 can never pass and
    // the recovery is unreachable by construction. This is what protects the
    // existing B8-06 assertion above, which passes no URL.
    it("does not fire when eventNameFrom is called without a URL", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Attends the 2026 Crystal Engineering GRC – Ruggiero Research Lab",
          "",
        ),
      ).toBe("Ruggiero Research Lab");
    });

    // MUST-SURVIVE: the narrative segment names no event. Step 4's two closed
    // tests (a 4-digit year, or this file's existing event-noun vocabulary)
    // both fail, so nothing is recovered and the sibling stands.
    it("does not recover a narrative tail that names no event", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Presents Its Annual Review – Ruggiero Research Lab",
          "",
          "https://ruggedthz.com/ruggiero-group-presents-its-annual-review",
        ),
      ).toBe("Ruggiero Research Lab");
    });

    // MUST-SURVIVE: the tail is a pair of place names. Same step-4 veto.
    it("does not recover a narrative tail that is only places", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Visits Berlin And Munich – Ruggiero Research Lab",
          "",
          "https://ruggedthz.com/ruggiero-group-visits-berlin-and-munich",
        ),
      ).toBe("Ruggiero Research Lab");
    });

    // MUST-SURVIVE, and this one isolates STEP 5 specifically: the tail clears
    // step 4 (it carries an event noun) and the short sibling is not
    // corroborated either, so step 6 cannot be what saves it. Only the slug
    // corroboration blocks the recovery here. B's own version of this case was
    // additionally blocked by steps 4 and 6; sharpened so the test can only
    // pass for the intended reason.
    it("does not recover a tail the page's own URL does not corroborate", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Attends The Big Crystal Engineering Symposium In Boston – SSI24",
          "",
          "https://ruggedthz.com/blog/annual-roundup",
        ),
      ).toBe("SSI24");
    });

    // MUST-SURVIVE: a real conference sibling beside a narrative tail that
    // names nothing.
    it("keeps a real conference sibling beside an empty narrative tail", () => {
      expect(
        eventNameFrom(
          "Acme Corp Presents Summer Fun – Acme Battery Symposium 2026",
          "",
          "https://acme.example.org/acme-corp-presents-summer-fun",
        ),
      ).toBe("Acme Battery Symposium 2026");
    });

    // MUST-SURVIVE: no narrative segment anywhere means the recovery never
    // gets a candidate in the first place.
    it("leaves a title with no narrative segment completely alone", () => {
      expect(
        eventNameFrom(
          "Call for papers - Battery Conference 2027",
          "",
          "https://battery.example.org/call-for-papers-battery-conference-2027",
        ),
      ).toBe("Battery Conference 2027");
    });

    // DOCUMENTED-KNOWN RESIDUAL, recorded rather than hidden — B constructed
    // it deliberately and could not build a plausible real-world instance. A
    // fully slug-corroborated narrative tail that carries a year but names no
    // real event is recovered as if it were a name. Both the old value
    // ("Ruggiero Research Lab") and the new one are wrong, so this is not a
    // regression in reader terms, but it IS a new wrong string and this test
    // exists so the next round that touches the design sees it immediately
    // rather than rediscovering it.
    it("recovers a year-bearing tail that names no real event (known residual)", () => {
      expect(
        eventNameFrom(
          "Ruggiero Group Attends A Long Series Of 2026 Meetings – Ruggiero Research Lab",
          "",
          "https://ruggedthz.com/ruggiero-group-attends-a-long-series-of-2026-meetings",
        ),
      ).toBe("Long Series Of 2026 Meetings");
    });
  });

  // Must not over-trigger: a real name that merely mentions one of the
  // headline-subject words as its own topic, with no announcement-shaped
  // participle nearby, is not narration and must survive.
  it("does not reject a real title that merely mentions a headline-subject word as its topic", () => {
    expect(looksLikeEventTitle("International Symposium on Registration Systems and Data Standards")).toBe(
      true,
    );
  });

  // B8-06 (round 8), shape 1: a present-tense, active-voice sentence NAMING
  // an event has no "to be" auxiliary (NARRATIVE_VERB_RE) and matches none
  // of HEADLINE_PASSIVE_RE's closed noun list — a third grammatical shape,
  // still open two rounds after round 6 first named it, reconfirmed live
  // again this round.
  describe("present-tense narrative sentence (B8-06)", () => {
    it("rejects a subject-verb narrative sentence with no auxiliary verb", () => {
      // A's own reconfirmed live example, verbatim.
      expect(
        looksLikeEventTitle("Ruggiero Group Attends the 2026 Crystal Engineering GRC"),
      ).toBe(false);
    });

    it("does not reject a real event name sharing the same subject phrase but no verb", () => {
      // Hardest inverse case for this shape: the identical two-word subject
      // ("Ruggiero Group") that must be rejected above, immediately
      // followed by ordinary event-name words instead of a verb — proves
      // the check targets the VERB specifically, not "starts with a
      // capitalized organisation name."
      expect(
        looksLikeEventTitle("Ruggiero Group Battery Innovation Summit 2026"),
      ).toBe(true);
    });

    // B10-04 (round 10): ruggedthz.com's live repro — the SAME sentence as
    // above, sentence-cased instead of Title-Cased, reached via
    // nameFromUrlSlug (which capitalises only the string's first
    // character). Before this fix, casing alone flipped this from
    // correctly-rejected to wrongly-accepted; the check must reject it
    // regardless of casing now.
    it("rejects the identical narrative sentence when it is sentence-cased, not Title-Cased", () => {
      expect(
        looksLikeEventTitle("Ruggiero group attends the 2026 crystal engineering grc"),
      ).toBe(false);
    });

    // Must-not-break: the existing, load-bearing precedent this fix could
    // most plausibly widen into rejecting — a legitimate sentence-cased
    // slug-derived phrase (scoring.test.ts's own case) that contains none
    // of the closed verbs. Re-asserted here, at the unit level, alongside
    // the casing fix that touches the same regex.
    it("does not reject a legitimate sentence-cased slug-derived phrase with no narrative verb", () => {
      expect(
        looksLikeEventTitle("Emea2026 workshop on ion exchange membranes for energy applications"),
      ).toBe(true);
    });

    // Must-survive: proves the fix widened WHICH CASING reaches the verb
    // check, not WHICH VERBS the check itself accepts — a sentence-cased
    // subject followed by a verb-shaped word outside the closed list
    // ("builds") must still be treated as a real name, not narration.
    it("does not reject a sentence-cased subject followed by a verb outside the closed list", () => {
      expect(looksLikeEventTitle("Ruggiero group builds a new lab")).toBe(true);
    });
  });
});

describe("webResultToRawEventItem", () => {
  // A24-01. THE ROW LEAVES BY KIND, AND IT LEAVES BEFORE ANY VALUE IS READ.
  // The index check is 4 of 6 in this function — ahead of the date anchor and
  // far ahead of enrichment — so the wrong NAME ("Provided by Cambridge
  // EnerTech", the only segment left once the picker rejected the index
  // segment) and the wrong PLACE (Chicago, another event's city, read from a
  // page listing many) never get a chance to be computed. One mechanism, three
  // faces, one fix. The place guard is NOT touched and needs no clause.
  it("drops a chrome-tailed conference index as a whole row, before any value is read", () => {
    expect(
      webResultToRawEventItem(
        {
          title: "Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech",
          url: "https://www.cambridgeenertech.com/cet/conferences",
          snippet:
            "Browse our upcoming conferences. Battery Safety Summit, Chicago, IL, United States. Online and in person.",
        },
        Date.parse("2026-08-15T00:00:00Z"),
      ),
    ).toBeNull();
  });

  it("still admits a real event page whose site chrome names an events hub", () => {
    // The `any segment` variant's own killer, asserted at ROW level rather than
    // only at the predicate: a miss here would cost a real event.
    const item = webResultToRawEventItem(
      {
        title: "Battery Safety Summit 2026 | Upcoming Conferences",
        url: "https://example.com/events/battery-safety-summit-2026",
        snippet: "Join researchers for the annual summit on battery safety.",
      },
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(item).not.toBeNull();
    expect(item?.name).toBe("Battery Safety Summit 2026");
  });

  it("keeps a punctuated search snippet scoreable but untagged for reports", () => {
    const item = webResultToRawEventItem(
      { title: "Battery Summit 2026", url: "https://example.com/battery", snippet: "Battery research sessions are included." },
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(item?.description).toBe("Battery research sessions are included.");
    expect(item?.reportSummary).toBeUndefined();
  });

  it("uses the guarded name for a real-shaped result", () => {
    const item = webResultToRawEventItem(
      {
        title: "Advanced Battery Materials Workshop 2026",
        url: "https://example.com/events/advanced-battery-materials-workshop",
        snippet: "Join researchers for the annual workshop on battery materials.",
      },
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(item?.name).toBe("Advanced Battery Materials Workshop 2026");
  });

  it("does not let a narrative-sentence title through as the event name", () => {
    // No year mentioned here — webResultToRawEventItem separately drops a
    // result when every year it mentions is already in the past, which is
    // not what this case is testing.
    const item = webResultToRawEventItem(
      {
        title: "Rivertown Summit was originally scheduled early but was delayed significantly.",
        url: "https://example.com/events/rivertown-summit",
        snippet: "Rivertown Summit convenes battery researchers every spring in Ohio.",
      },
      Date.parse("2026-01-01T00:00:00Z"),
    );
    expect(item?.name).not.toMatch(/\bwas\b/i);
    // B12-01 (round 12, §1aa Ruling 40): restated to the name inside the
    // sentence. What this test guards — that the narrative TITLE never becomes
    // the event name — is unchanged and still asserted on the line above.
    expect(item?.name).toBe("Rivertown Summit");
  });

  // A22-02 (round 22, `battery-power.eu`): the snippet held exactly ONE date
  // token, it was the CFP deadline's, and both extractors claimed it — so the
  // card printed "Dates 31 Oct" beside "Abstract due 31 Oct" from one token.
  // An event cannot happen on the day its own call for papers closes.
  describe("a date token the deadline extractor owns (A22-02)", () => {
    const DEADLINE_NOW = Date.parse("2026-01-01T00:00:00Z");

    it("leaves the event date absent when it is the same instant as the deadline", () => {
      const item = webResultToRawEventItem(
        {
          title: "International Battery Power Conference 2026",
          url: "https://example.com/conference",
          snippet: "Deadline 31 October 2026 to submit your abstracts for the conference.",
        },
        DEADLINE_NOW,
      );
      // Both extractors return 2026-10-31 on this text. The deadline is the
      // evidenced reading (its regex demanded the word "deadline" in front of
      // the token); the event date is not, so it goes silent — "date TBA".
      expect(item?.deadline?.slice(0, 10)).toBe("2026-10-31");
      expect(item?.startDate).toBe("");
    });

    it("keeps the row alive rather than expiring it when the start date goes silent", () => {
      // The admitted control on the drop side: clearing the start date must
      // not delete the row. The expiry anchor takes the max of the two dates
      // and they were equal, so a real live conference survives with an
      // honest silence instead of a self-contradicting pair of tiles.
      const item = webResultToRawEventItem(
        {
          title: "International Battery Power Conference 2026",
          url: "https://example.com/conference",
          snippet: "Deadline 31 October 2026 to submit your abstracts for the conference.",
        },
        DEADLINE_NOW,
      );
      expect(item).not.toBeNull();
      expect(item?.name).toBe("International Battery Power Conference 2026");
    });

    it("does not touch a row whose event date and deadline are different days", () => {
      // The must-keep control: two distinct tokens, two distinct roles, and
      // the clause must not fire. This is the shape B measured on 49 of the
      // 50 live ingestion-kept rows.
      const item = webResultToRawEventItem(
        {
          title: "Advanced Battery Materials Conference 2026",
          url: "https://example.com/events/advanced-battery-materials",
          snippet:
            "The conference runs September 14, 2026 in Boston. Abstract submissions deadline: August 14, 2026.",
        },
        DEADLINE_NOW,
      );
      expect(item?.startDate?.slice(0, 10)).toBe("2026-09-14");
      expect(item?.deadline?.slice(0, 10)).toBe("2026-08-14");
    });

    it("does not touch a row that has an event date and no deadline at all", () => {
      const item = webResultToRawEventItem(
        {
          title: "Advanced Battery Materials Conference 2026",
          url: "https://example.com/events/advanced-battery-materials",
          snippet: "The conference runs September 14, 2026 in Boston.",
        },
        DEADLINE_NOW,
      );
      expect(item?.startDate?.slice(0, 10)).toBe("2026-09-14");
      expect(item?.deadline).toBeUndefined();
    });
  });
});

// B13-03 (round 13): the BANNER LEAD-IN. `flogen.org` rendered
// `WELCOME TO SIPS 2026` — a page's greeting banner standing where its event
// name belongs — for five rounds.
//
// The mechanism, established by B through execution: the page's own <title>
// (`SIPS 2026 by FLOGEN Stars Outreach`) passes every guard untouched, so no
// stage ever HAS it. The provider hands Peer the og:title/<h1> instead, and
// the enrichment path reads JSON-LD name and og:title and never parses a
// <title> element at all. Both routes end at bestEventTitleSegment, which is
// why this one attachment point covers both.
//
// EXPECTED RENDER AFTER THIS FIX: `SIPS 2026`. NOT
// `SIPS 2026 by FLOGEN Stars Outreach` — that string is the page <title> and
// it never reaches the pipeline, so no fix at this layer can produce it.
//
// This is a REPAIR, not a selection: every check is a veto and the fallback is
// the segment unchanged. When it does not fire the render is byte-identical to
// today's, and there is no path by which it can produce a bare hostname or a
// placeholder.
describe("banner lead-in strip (B13-03)", () => {
  it("repairs the live flogen.org value", () => {
    expect(
      bestEventTitleSegment("WELCOME TO SIPS 2026", "https://www.flogen.org/sips2026/"),
    ).toBe("SIPS 2026");
  });

  it.each([
    ["Welcome to SIPS 2026", "SIPS 2026"],
    ["Welcome to the SIPS 2026", "SIPS 2026"],
    ["WELCOME TO THE 2027 BATTERY CONFERENCE", "2027 BATTERY CONFERENCE"],
    ["Welcome to the International Battery Symposium", "International Battery Symposium"],
  ])("repairs the banner variant %s", (title, expected) => {
    expect(bestEventTitleSegment(title, "https://example.org/event")).toBe(expected);
  });

  // MUST-SURVIVE, AND THE REASON `to` IS MANDATORY IN THE PATTERN.
  // B's FIRST DRAFT MADE `to` OPTIONAL AND THESE THREE REAL EVENT NAMES WERE
  // MUTILATED — `Welcome Reception and Poster Session` became `Reception and
  // Poster Session`, `Welcome Week Careers Fair 2026` became `Week Careers
  // Fair 2026`, `Welcome Home Veterans Summit 2026` became `Home Veterans
  // Summit 2026`. `Welcome` is an ordinary first word of a real event name;
  // `Welcome to` never is. DO NOT SIMPLIFY `to` TO OPTIONAL.
  it.each([
    "Welcome Reception and Poster Session",
    "Welcome Week Careers Fair 2026",
    "Welcome Home Veterans Summit 2026",
    "Welcome Center Open House",
  ])("leaves the Welcome-initial real event name untouched: %s", (title) => {
    expect(bestEventTitleSegment(title, "https://example.org/event")).toBe(title);
  });

  // MUST-SURVIVE: banners whose remainder nothing corroborates. Veto 2 (a year
  // OR an event-kind signal, the same disjunction recoverFromNarrative uses)
  // stops the strip firing, so the outcome is byte-identical to today's.
  it.each(["Welcome to Our Site", "Welcome to FLOGEN"])(
    "leaves an uncorroborated banner untouched: %s",
    (title) => {
      expect(bestEventTitleSegment(title, "https://example.org/page")).toBe(title);
    },
  );

  // `Welcome to the Department of Chemistry` is B's third uncorroborated
  // banner, asserted separately because its shipped outcome is `undefined`,
  // not the input string — the WHOLE segment is rejected upstream by
  // bestEventTitleSegment's own guards, before this strip is ever reached.
  // VERIFIED IDENTICAL BEFORE AND AFTER B13-03 (checked by stashing the source
  // change and re-running), so this is the status quo, not a regression. What
  // matters for this item is the same thing B's matrix recorded: the strip
  // does not fire, and in particular it never manufactures a name here.
  it("does not manufacture a name from an uncorroborated department banner", () => {
    const result = bestEventTitleSegment(
      "Welcome to the Department of Chemistry",
      "https://example.org/page",
    );
    expect(result).not.toBe("Department of Chemistry");
    expect(result).toBeUndefined();
  });

  // MUST-SURVIVE: live-confirmed correct names from earlier rounds' fixes.
  // `32nd SolarPACES Conference` is the value the enrich.test.ts regression
  // lock asserts; `The Battery Show North America`'s leading article must
  // survive per Ruling 39a point 4.
  it.each([
    "2026 Crystal Engineering GRC",
    "32nd SolarPACES Conference",
    "International Battery Seminar",
    "The Battery Show North America",
    "Advanced Battery Power Conference 2026",
  ])("leaves the live-confirmed correct name untouched: %s", (title) => {
    expect(bestEventTitleSegment(title, "https://example.org/event")).toBe(title);
  });

  it("reaches the reader through eventNameFrom, not only the segment helper", () => {
    expect(
      eventNameFrom("WELCOME TO SIPS 2026", "", "https://www.flogen.org/sips2026/"),
    ).toBe("SIPS 2026");
  });

  // The two strips compose: B12-03's welded label comes off first, then this
  // one. Neither vocabulary can undo the other.
  it("composes with the welded page-type label strip", () => {
    expect(
      bestEventTitleSegment(
        "Welcome to the Battery Conference 2026 Call for Papers",
        "https://example.org/event",
      ),
    ).toBe("Battery Conference 2026");
  });
});

// Phase 3 round 3 C, ITEM 4 (F8, Ruling 120g item 4): THE APPLICATION-STATUS
// TAIL. Two live witnesses, both real events with an "applications open"
// announcement clause welded onto an otherwise-real name — see the doc
// comment above `stripApplicationStatusTail` in eventweb.ts for the full
// design trace (why `HEADLINE_PASSIVE_RE` doesn't already catch this, and
// why this strip deliberately carries only three vetoes, not
// `stripBannerLeadIn`'s extra corroboration one). Witness URLs recorded in
// this file's own Phase 3 round 1 A log (`MULTIAGENT-report-parity.md:91962-
// 91963`).
describe("application-status tail strip (F8, Phase 3 round 3)", () => {
  it("repairs the live bepassociation.eu witness", () => {
    expect(
      bestEventTitleSegment(
        "Battery Young Researcher Award: Applications Open Today!",
        "https://bepassociation.eu/battery-young-researcher-award-applications-open-today/",
      ),
    ).toBe("Battery Young Researcher Award");
  });

  it("repairs the live spec.ucsd.edu witness (all-caps 'APP is NOW OPEN')", () => {
    expect(
      bestEventTitleSegment(
        "2026 SPEC Battery Boot Camp APP is NOW OPEN",
        "https://spec.ucsd.edu/node/147",
      ),
    ).toBe("2026 SPEC Battery Boot Camp");
  });

  // MUST-KEEP CONTROL, AND NOT A VACUOUS ONE: A's own report records that the
  // identical real bootcamp ALSO has a clean row via this exact URL in the
  // same pull, so this is not a constructed hypothetical — it is the paired
  // control for the witness immediately above, the same real event with the
  // announcement clause already absent.
  it("must-keep: leaves the same bootcamp's already-clean name untouched (smelab.org)", () => {
    expect(
      bestEventTitleSegment(
        "SPEC Battery Bootcamp",
        "https://smelab.org/spec-battery-bootcamp",
      ),
    ).toBe("SPEC Battery Bootcamp");
  });

  it("reaches the reader through eventNameFrom, not only the segment helper", () => {
    expect(
      eventNameFrom(
        "Battery Young Researcher Award: Applications Open Today!",
        "",
        "https://bepassociation.eu/battery-young-researcher-award-applications-open-today/",
      ),
    ).toBe("Battery Young Researcher Award");
  });

  // Composes with its nearest neighbor in the chain, the banner lead-in
  // strip (this file's own B13-03 block asserts the same shape one strip
  // over, for the welded-label/banner-lead-in pair) — neither vocabulary can
  // undo the other.
  it("composes with the banner lead-in strip", () => {
    expect(
      bestEventTitleSegment(
        "Welcome to the Battery Symposium 2026: Applications Open Today!",
        "https://example.org/event",
      ),
    ).toBe("Battery Symposium 2026");
  });
});

// Phase 3 round 3 C, ITEM 5 (F9, Ruling 120g item 5): THE DRAFT-ANNOTATION
// TAIL. Live witness: a real, correctly-linked, currently-open event whose
// og:title carries a stale "TEST" annotation from the organiser's own Cvent
// draft setup — see the doc comment above `stripDraftAnnotationTail` in
// eventweb.ts for the full root-cause trace (why og:title wins over the
// page's own correct <title>) and the named EVENT-ONLY placement ruling
// (120d(2)) with its promotion threshold. Witness URL recorded in this
// file's own Phase 3 round 1 A log (`MULTIAGENT-report-parity.md:91969`).
describe("draft-annotation tail strip (F9, Phase 3 round 3)", () => {
  it("repairs the live web.cvent.com witness", () => {
    expect(
      bestEventTitleSegment(
        "Investor Showcase for Battery Storage TEST",
        "https://web.cvent.com/event/db0a52d9-68fa-4c07-9bee-f3903554b231/summary",
      ),
    ).toBe("Investor Showcase for Battery Storage");
  });

  // CASE-SENSITIVITY IS LOAD-BEARING. The ordinary lowercase/Title-Case
  // English word "test" appearing as a real name's own last word must not
  // be stripped — only the standalone, all-caps annotation token is a QA
  // leftover, never a real event's own chosen last word.
  it("does not strip an ordinary lowercase or Title-Case 'test' as a real name's last word", () => {
    expect(
      bestEventTitleSegment("Battery Materials Stress Test", "https://example.org/event"),
    ).toBe("Battery Materials Stress Test");
    expect(
      bestEventTitleSegment("Molten Salt Reactor Safety test", "https://example.org/event"),
    ).toBe("Molten Salt Reactor Safety test");
  });

  // MUST-KEEP, PER B'S OWN CORPUS CHECK: no real admitted event title in A's
  // sample ends in a bare uppercase "TEST" token, so this asserts the
  // regex's own narrowness rather than re-deriving the check — a title that
  // merely CONTAINS "TEST" mid-string, not as its own last word, is untouched.
  it("leaves a title with TEST in the middle, not at the end, untouched", () => {
    expect(
      bestEventTitleSegment("TEST Battery Storage Investor Showcase", "https://example.org/event"),
    ).toBe("TEST Battery Storage Investor Showcase");
  });

  it("reaches the reader through eventNameFrom, not only the segment helper", () => {
    expect(
      eventNameFrom(
        "Investor Showcase for Battery Storage TEST",
        "",
        "https://web.cvent.com/event/db0a52d9-68fa-4c07-9bee-f3903554b231/summary",
      ),
    ).toBe("Investor Showcase for Battery Storage");
  });

  // Composes with its nearest neighbor in the chain, the application-status
  // tail strip (F8, this round) — neither vocabulary can undo the other.
  // NOTE ON ORDERING: `TEST` must sit BEFORE the application-status clause
  // in the constructed input, not after. Both strips are end-anchored and
  // run in a fixed order (application-status, then draft-annotation) — a
  // "TEST" token trailing AFTER "Open Today!" would sit outside the
  // application-status regex's own end anchor and block it from firing at
  // all, leaving that clause unstripped. Verified by execution, not
  // assumed: an earlier draft of this test placed TEST last and asserted
  // the wrong value until this was run and corrected.
  it("composes with the application-status tail strip", () => {
    expect(
      bestEventTitleSegment(
        "Battery Investor Day TEST: Applications Open Today!",
        "https://example.org/event",
      ),
    ).toBe("Battery Investor Day");
  });
});

// B18-01 (round 18, Rulings 50b + 51a): A COMPANY'S EARNINGS CALL WAS IN THE
// EVENT POOL. `specterfi.com/companies/1539/concalls/Feb2026` — a stock
// research page for "Ion Exchange (India) Limited Q3 & 9M FY26 Earnings
// Conference Call" — was in the live event pool on 5 pulls out of 5 and
// rendered as the event card `1539 Feb2026 Concall Summary`, where `1539` is
// the site's internal company ID.
//
// It is admitted because `looksLikeEvent` sees the word "conference" inside
// "Conference Call". The name extraction is FAITHFUL — this is a page-KIND
// defect, not a naming defect, which is why the fix is a gate and not a
// rename, and why Ruling 33's matcher is deliberately not reopened.
//
// EVERY END-TO-END `toBeNull()` HERE IS PAIRED WITH A CONTROL. C measured that
// several of these rows are dropped by `looksLikeEvent` for reasons that have
// nothing to do with this rule, which would make a bare `toBeNull()` pass
// VACUOUSLY (round 14's two vacuous tests are the precedent). The control is
// the identical row with the finance vocabulary removed from BOTH the title and
// the URL path: it must be ADMITTED. If a control ever stops being admitted the
// paired assertion has gone vacuous and this test says so by going red.
describe("earnings-call page gate (B18-01)", () => {
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  function expectDroppedByThisRule(row: {
    title: string;
    url: string;
    snippet: string;
    controlTitle: string;
    controlUrl: string;
  }) {
    // The rule fires on the real row.
    expect(isEarningsCallPage(row.title, row.url)).toBe(true);
    // The control — same row, vocabulary removed — is genuinely admitted, so
    // the drop below cannot be attributed to any other check.
    expect(isEarningsCallPage(row.controlTitle, row.controlUrl)).toBe(false);
    expect(
      webResultToRawEventItem(
        { title: row.controlTitle, url: row.controlUrl, snippet: row.snippet },
        NOW,
      ),
    ).not.toBeNull();
    // And the real row leaves the pool at ingestion.
    expect(
      webResultToRawEventItem({ title: row.title, url: row.url, snippet: row.snippet }, NOW),
    ).toBeNull();
  }

  // `Feb2026` yields no year token — `\b(20\d{2})\b` cannot match inside it —
  // which is what let these rows survive the past-event anchor check in the
  // first place and reach a reader.
  it("drops the rendered og:title form", () => {
    expectDroppedByThisRule({
      title: "1539 Feb2026 Concall Summary",
      url: "https://specterfi.com/companies/1539/concalls/Feb2026",
      snippet: "Registration and investor conference details for the quarter.",
      controlTitle: "1539 Feb2026 Research Summary",
      controlUrl: "https://specterfi.com/companies/1539/quarters/Feb2026",
    });
  });

  // B's load-bearing correction to A: the string the INGESTION gate reads is
  // the PROVIDER's title, and the provider does not hand Peer the og:title.
  // The og:title form above is what RENDERS. Both are covered on purpose.
  it("drops the provider title form, which is the string the gate actually reads", () => {
    expectDroppedByThisRule({
      title: "1539 Feb2026 Conference Call Summary | Specter",
      url: "https://specterfi.com/companies/1539/concalls/Feb2026",
      snippet: "Home Companies Screeners Watchlist Login",
      controlTitle: "1539 Feb2026 Research Conference Summary | Specter",
      controlUrl: "https://specterfi.com/companies/1539/quarters/Feb2026",
    });
  });

  it("drops the form carrying the company's full legal name", () => {
    expectDroppedByThisRule({
      title: "Ion Exchange (India) Ltd Feb2026 Conference Call Summary",
      url: "https://specterfi.com/companies/1539/concalls/Feb2026",
      snippet: "Home Companies Screeners Watchlist Login",
      controlTitle: "Ion Exchange (India) Ltd Feb2026 Research Conference Summary",
      controlUrl: "https://specterfi.com/companies/1539/quarters/Feb2026",
    });
  });

  // THE PATH CLAUSE'S OWN ASSERTION. This provider title is truncated before
  // its vocabulary, so no title rule can reach it — only the URL path can.
  // Revert the path clause and this is the test that goes red.
  it("drops a title truncated before its vocabulary, by the URL path alone", () => {
    expectDroppedByThisRule({
      title: "Associated Alcohols & Breweries Ltd Nov2025 ... - SpecterFi",
      url: "https://specterfi.com/companies/303/concalls/Nov2025",
      snippet: "Registration and investor conference details for the quarter.",
      controlTitle: "Associated Alcohols & Breweries Ltd Nov2025 ... - SpecterFi",
      controlUrl: "https://specterfi.com/companies/303/quarters/Nov2025",
    });
  });

  // THE OCCASION-ON-TITLE CLAUSE'S OWN ASSERTION, added for the same measured
  // reason as the artefact one below: every real row carries the vocabulary in
  // BOTH its title and its URL path, so disabling the title clause alone turned
  // nothing red. This row is occasion-only — "Earnings Conference Call" has no
  // trailing artefact noun after it, so the artefact regex cannot match — and
  // its path is clean. THE THREE CLAUSES NOW EACH HAVE A TEST THAT ONLY THEY
  // SATISFY, so no later round can collapse them without failing a red test.
  it("drops an earnings-occasion title whose URL path carries no vocabulary", () => {
    expectDroppedByThisRule({
      title: "Adani Enterprises Q4 FY26 Earnings Conference Call",
      url: "https://www.adanienterprises.com/investors/quarterly-update",
      snippet: "A conference archive page for investors and analysts.",
      controlTitle: "Adani Enterprises Q4 FY26 Research Conference",
      controlUrl: "https://www.adanienterprises.com/investors/quarterly-update",
    });
  });

  // THE ARTEFACT CLAUSE'S OWN ASSERTION, AND IT EXISTS BECAUSE C MEASURED THAT
  // NOTHING ELSE PROTECTED IT. B disclosed that on the measured corpus the
  // artefact clause is REDUNDANT — the occasion clause alone reaches the same
  // 5/5 and 3/5 — and C reproduced that: with the artefact clause disabled and
  // this test absent, ZERO assertions went red, so a future round could have
  // deleted a clause Ruling 51a deliberately kept and no test would have said
  // so. This is the clause's REACHABLE case: a sibling site whose TITLE says
  // "Conference Call Summary" while its URL path carries none of the
  // vocabulary. "Conference Call" is not "Concall", so the occasion regex does
  // not match this title, and the path has nothing in it — only the artefact
  // clause can see this row.
  it("drops a call-artefact title whose URL path carries no vocabulary", () => {
    expectDroppedByThisRule({
      title: "Northwind Chemicals Q2 FY27 Conference Call Summary",
      url: "https://example.com/research/northwind-q2-fy27",
      snippet: "A conference archive page for investors and analysts.",
      controlTitle: "Northwind Chemicals Q2 FY27 Conference Programme Summary",
      controlUrl: "https://example.com/research/northwind-q2-fy27",
    });
  });

  // NOT A `specterfi.com` RULE. The class spans five other hosts the shipped
  // gate also admits (`scribd.com`, `adanienterprises.com`, `piindustries.com`,
  // `balchem.com`, `roberthalf.com`), which is why no host list and no bare
  // `/concalls/` path rule was offered — that would close one row and leave the
  // class open (Ruling 40).
  it("drops the same shape on an unrelated host", () => {
    expectDroppedByThisRule({
      title: "Acme Corp Q3 FY26 Earnings Call Transcript",
      url: "https://example.com/ir/earnings-call-transcript-q3",
      snippet: "A conference transcript archive for investors.",
      controlTitle: "Acme Corp Q3 FY26 Research Summit Transcript",
      controlUrl: "https://example.com/ir/research-summit-transcript-q3",
    });
  });

  // MUST-KEEPS. Every row is asserted `not.toBeNull()` explicitly and carries
  // no past date, so none of them can pass for the wrong reason.
  it.each([
    [
      // THE LIVE ROW THAT KILLED THE NAIVE RULE. Bare `conference call` catches
      // 12 of 12 positives and deletes this real scholarly event, where
      // "Conference" and "Call for Papers" are adjacent by accident. C
      // reproduced it on the real file: adding bare `conference call` destroys
      // THREE real events in this corpus to buy 2 extra catches. DO NOT ADD IT
      // IN ANY POSITION.
      "2026 YCC Conference Call for Papers (and Student Awards)",
      "https://ascl.org/meetings/ycc2026",
      "Abstract submissions open for the 2026 meeting.",
    ],
    [
      // WHY `quarterly results` IS NOT IN THE VOCABULARY. It earned zero on
      // real data and was the single term that failed the adversarial set.
      "Quarterly Results Review Seminar Series — Physics Dept",
      "https://example.edu/physics/seminars/quarterly-review",
      "Weekly seminar series hosted by the department.",
    ],
    [
      // A real scholarly event whose title names the very same company. The
      // fix must key on the page KIND, never on the company name.
      "Ion Exchange (India) Limited Sponsored Student Workshop",
      "https://example.edu/workshops/ion-exchange-student",
      "A sponsored hands-on workshop for graduate students.",
    ],
    [
      "Webcast: Live Conference Call with the Keynote Speakers",
      "https://example.org/summit/keynote-webcast",
      "Join the keynote session from anywhere.",
    ],
    [
      // `analysts meet` and `investor day` were both measured alone, earned
      // nothing on real data, and were cut.
      "Analyst Meeting on Molten Salt Corrosion Data",
      "https://example.org/meetings/molten-salt-analysis",
      "A technical meeting on corrosion measurements.",
    ],
    [
      "Investor Day for University Spin-out Founders Conference",
      "https://example.edu/entrepreneurship/investor-day",
      "A day of talks for founders and researchers.",
    ],
    [
      "Conference Calls for Abstracts Now Open — Materials Week",
      "https://example.org/materials-week/abstracts",
      "Abstract submission is open for Materials Week.",
    ],
  ])("keeps the real event %s", (title, url, snippet) => {
    expect(isEarningsCallPage(title, url)).toBe(false);
    expect(webResultToRawEventItem({ title, url, snippet }, NOW)).not.toBeNull();
  });

  // THE SNIPPET IS DELIBERATELY NOT AN INPUT. C measured the forbidden variant
  // on the real predicate: applied to `title + snippet` it false-fires on three
  // real admitted rows, on the three hosts B named. These are real events whose
  // snippet merely MENTIONS a company's earnings call.
  it.each([
    [
      "Samsung SDI Battery Technology Symposium 2027",
      "https://www.samsungsdi.com/events/battery-day",
      "Company news: the fourth quarter earnings call is scheduled separately.",
    ],
    [
      "Comcast NBCUniversal Research Symposium",
      "https://corporate.cmcsa.com/events/research-symposium",
      "See also the company's quarterly earnings conference call webcast.",
    ],
    [
      "Bank of America Sustainable Materials Forum",
      "https://investor.bankofamerica.com/events/materials-forum",
      "Investor relations also publishes the earnings call transcript.",
    ],
  ])("keeps an event whose SNIPPET mentions an earnings call: %s", (title, url, snippet) => {
    expect(isEarningsCallPage(title, url)).toBe(false);
    expect(webResultToRawEventItem({ title, url, snippet }, NOW)).not.toBeNull();
  });

  // THE NAMED UNDER-CATCH, asserted as documented-known rather than left to be
  // rediscovered. Both are reachable only by bare "conference call", the
  // rejected rule. The failure direction is deliberate: a miss leaves the row
  // exactly where it is today; a false fire deletes a real event.
  it.each([
    [
      "Conference Call for Fourth Quarter and Full Year 2026 Financial Results",
      "https://www.balchem.com/investors/news/conference-call-q4",
    ],
    [
      "Investor Center: Quarterly Conference Calls",
      "https://www.roberthalf.com/us/en/investor-center/quarterly-calls",
    ],
  ])("documents the accepted under-catch: %s", (title, url) => {
    expect(isEarningsCallPage(title, url)).toBe(false);
  });
});

// A22-01 (round 22, `ans.org`): the page's own event was `April 16, 2026` —
// already past — but Peer rendered the date and city of a DIFFERENT event
// advertised in a `Conference Spotlight` block on the same calendar page
// (`August 24-27, 2026`, `Dallas, TX`). `extractEventDate` takes the FIRST
// month-day token in the string and stops, and the sibling's token sat 339
// characters before the selected item's own heading. The wrong date is also
// why a finished event survived the expiry check.
describe("ambiguous snippets must prove which date is theirs (A22-01)", () => {
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  describe("extractEventDayCandidates", () => {
    it("collects every reading the text offers, not just the first", () => {
      const days = extractEventDayCandidates(
        "Conference Spotlight August 24-27, 2026 Dallas, TX # Molten Salt Research Reactor Tour Thursday, April 16, 2026",
      );
      expect(days.map((day) => day.slice(0, 10))).toEqual(
        expect.arrayContaining(["2026-08-24", "2026-04-16"]),
      );
    });

    // THE INVARIANT B REQUIRED IN WRITING. B's own cluster counter was built
    // from COPIES of the regexes and disagreed with the shipped extractor on
    // two live rows — a counter that can disagree with the extractor it guards
    // is a latent second defect. These are built from `.source` of the very
    // same constants, so the two cannot drift; this case is what would catch
    // it if someone later reintroduces a copy.
    it.each([
      "Battery Summit November 29 - December 4, 2026 in Boston",
      "Workshop on 31 October 2026 at the institute",
      "Symposium Sept. 3, 2027 programme published",
      "Meeting April 16, 2026 and Conference Spotlight August 24, 2026",
      "Annual review held in 2026 with sessions on May 7, 2026",
    ])("yields at least one candidate whenever extractEventDate yields a value: %s", (text) => {
      if (extractEventDate(text)) {
        expect(extractEventDayCandidates(text).length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  describe("clusterEventDays", () => {
    it("treats one conference's own run as a single reading", () => {
      expect(
        clusterEventDays([
          "2026-10-12T12:00:00.000Z",
          "2026-10-13T12:00:00.000Z",
          "2026-10-15T12:00:00.000Z",
        ]),
      ).toHaveLength(1);
    });

    it("treats a sibling event months away as a second reading", () => {
      expect(
        clusterEventDays(["2026-04-16T12:00:00.000Z", "2026-08-24T12:00:00.000Z"]),
      ).toHaveLength(2);
    });

    it("keeps a multi-week programme together rather than splitting it", () => {
      // Chained from the previous day, not the cluster's first: this fails
      // toward today's behaviour, which is the safe direction for a design
      // whose other branch DELETES a date.
      expect(
        clusterEventDays([
          "2026-10-01T12:00:00.000Z",
          "2026-10-20T12:00:00.000Z",
          "2026-11-05T12:00:00.000Z",
        ]),
      ).toHaveLength(1);
    });
  });

  describe("ownedTitleSpan", () => {
    it("returns the span the item's own heading introduces, stopping at the next heading", () => {
      const span = ownedTitleSpan(
        "# Conference Spotlight\nAugust 24-27, 2026 Dallas, TX\n# Molten Salt Research Reactor Tour\nThursday, April 16, 2026\n# Other Business\nMay 1, 2026",
        "Molten Salt Research Reactor Tour",
      );
      expect(span).toContain("April 16, 2026");
      expect(span).not.toContain("August 24");
      expect(span).not.toContain("May 1");
    });

    it("is silent when the snippet never names the item", () => {
      expect(
        ownedTitleSpan("Registration is open for two upcoming meetings.", "Molten Salt Research Reactor Tour"),
      ).toBeUndefined();
    });

    it("never matches the caller's own prepended copy of the title", () => {
      // The span is searched over the SNIPPET alone. Searching `title +
      // snippet` would match at offset 0 on every row and prove nothing, which
      // would make the whole witness test vacuous.
      expect(ownedTitleSpan("", "Molten Salt Research Reactor Tour")).toBeUndefined();
    });
  });

  describe("the rule end to end", () => {
    it("keeps a single-reading snippet exactly as it renders today", () => {
      // The 44-of-50 majority. This is the control that stops the fix from
      // being a blanket ban on snippet dates.
      const item = webResultToRawEventItem(
        {
          title: "Advanced Battery Materials Conference 2026",
          url: "https://example.com/events/advanced-battery-materials",
          snippet: "The conference runs October 12-15, 2026 in Boston with tutorials.",
        },
        NOW,
      );
      expect(item?.startDate?.slice(0, 10)).toBe("2026-10-12");
    });

    it("reads the item's own date when a calendar page offers two readings", () => {
      // The `ans.org` repro, with the witness present.
      const item = webResultToRawEventItem(
        {
          title: "Molten Salt Research Reactor Tour",
          url: "https://example.com/calendar/molten-salt-tour",
          snippet:
            "# Conference Spotlight\nAugust 24-27, 2026 Dallas, TX\n# Molten Salt Research Reactor Tour\nThursday, April 16, 2027 — meeting and tour.",
        },
        NOW,
      );
      expect(item?.startDate?.slice(0, 10)).toBe("2027-04-16");
    });

    it("is silent when two readings are offered and neither is proven to be the item's", () => {
      const item = webResultToRawEventItem(
        {
          title: "Molten Salt Research Reactor Tour",
          url: "https://example.com/calendar/molten-salt-tour",
          snippet:
            "Upcoming meetings: the summit runs August 24-27, 2027 in Dallas and the review follows on December 3, 2027.",
        },
        NOW,
      );
      expect(item).not.toBeNull();
      expect(item?.startDate).toBe("");
    });

    // THE INTENDED DEPARTURE, ASSERTED RATHER THAN ASSUMED (Ruling 60b).
    // Both `ans.org` and `batteryinnovationsummit.com` move to a date that is
    // already past, and a past anchor expires the row at `:1367`. Round 23 A
    // must read these two disappearances as this fix working, NOT as churn.
    it("lets a finished event correctly disappear once it stops borrowing a future date", () => {
      const item = webResultToRawEventItem(
        {
          title: "Molten Salt Research Reactor Tour",
          url: "https://example.com/calendar/molten-salt-tour",
          snippet:
            "# Conference Spotlight\nAugust 24-27, 2026 Dallas, TX\n# Molten Salt Research Reactor Tour\nThursday, April 16, 2026 — meeting and tour.",
        },
        Date.parse("2026-07-01T00:00:00Z"),
      );
      // The mechanism, stated in the assertion: the sibling's August date used
      // to be the expiry anchor and it was in the future, so a finished event
      // stayed in the pool. With the item's own April date read instead, the
      // newest anchor is past and the row leaves.
      expect(item).toBeNull();
    });

    it("does not treat a labelled deadline as a rival reading of the event day", () => {
      // C's one correction to draft 3's step 1, and the case that caught it:
      // "the conference runs X, abstracts are due Y" is the commonest honest
      // snippet there is, and counting the deadline token as a second
      // candidate event day would have silenced every one of those rows.
      const item = webResultToRawEventItem(
        {
          title: "Advanced Battery Materials Conference 2026",
          url: "https://example.com/events/advanced-battery-materials",
          snippet:
            "The conference runs September 14, 2026 in Boston. Abstract submissions deadline: August 14, 2026.",
        },
        NOW,
      );
      expect(item?.startDate?.slice(0, 10)).toBe("2026-09-14");
      expect(item?.deadline?.slice(0, 10)).toBe("2026-08-14");
    });

    it("invents no date it was not given", () => {
      const item = webResultToRawEventItem(
        {
          title: "Molten Salt Research Reactor Tour",
          url: "https://example.com/calendar/molten-salt-tour",
          snippet:
            "Upcoming meetings: the summit runs August 24-27, 2027 in Dallas and the review follows on December 3, 2027.",
        },
        NOW,
      );
      expect(item?.startDate).not.toContain("2027-08");
      expect(item?.startDate).not.toContain("2027-12");
    });
  });
});

// A23-02 / Ruling 62b — THE LISTING-FURNITURE STRIP AND THE MONTH-GRANULARITY
// PARTIAL.
//
// `10times.com` rendered `Solid-State Battery Summit (Aug 2026), Chicago USA`
// as the event NAME while the card's date line read "Date not listed" — one
// card contradicting itself on its own face. Gap (a) removes the furniture;
// the partial hands the removed month-year to the date field at the
// granularity the page actually evidenced.
//
// The expiry evasion — gap (b) — is DEFERRED by 62b and is NOT closed here.
describe("A23-02 — listing furniture in the event name", () => {
  it("strips the aggregator's date and city off the chosen segment", () => {
    expect(
      bestEventTitleSegment("Solid-State Battery Summit (Aug 2026), Chicago USA"),
    ).toBe("Solid-State Battery Summit");
  });

  it("composes with the two strips already on the chosen segment", () => {
    // Host chrome is split off first, the welded/banner strips run, and this
    // one runs last on what survives. Three disjoint vocabularies.
    expect(
      bestEventTitleSegment(
        "Solid-State Battery Summit (Aug 2026), Chicago USA | 10times",
      ),
    ).toBe("Solid-State Battery Summit");
  });

  it.each([
    "Molten Salt Congress (Hybrid)",
    "Molten Salt Congress (Virtual)",
    "Battery Show Asia (Formerly Battery Show Japan)",
    "Molten Salt Congress (ICMS 2026)",
  ])("never strips a parenthetical carrying WORDS — `%s`", (title) => {
    expect(bestEventTitleSegment(title)).toBe(title);
  });

  it("never strips a leading or mid-string parenthetical", () => {
    expect(bestEventTitleSegment("EUCHEMS (Molten Salts) 2026")).toBe(
      "EUCHEMS (Molten Salts) 2026",
    );
    // The end-anchor's own case: a DATE-shaped parenthetical that is not at the
    // end. Unanchored, everything after it is dropped with it.
    expect(bestEventTitleSegment("Molten Salt Congress (2026) Proceedings")).toBe(
      "Molten Salt Congress (2026) Proceedings",
    );
  });

  it("requires the COMMA before a place tail", () => {
    // B's boundary: `<name>, <City> <COUNTRY>` is furniture; `<name> <City>` is
    // a name. Without the comma requirement this loses its venue words.
    expect(bestEventTitleSegment("Molten Salt Congress Lyon France")).toBe(
      "Molten Salt Congress Lyon France",
    );
  });

  it("requires the tail to end in a COUNTRY, not merely follow a comma", () => {
    expect(bestEventTitleSegment("Molten Salt Congress, Volume 3")).toBe(
      "Molten Salt Congress, Volume 3",
    );
  });

  it.each([
    "The Battery Show Detroit",
    "Oslo Battery Days Conference 2027",
  ])("never strips a city that IS the name — `%s` (no comma)", (title) => {
    expect(bestEventTitleSegment(title)).toBe(title);
  });

  it("keeps the original when stripping would leave nothing at all", () => {
    // A wrong name is bad; an empty one is worse. The remainder must be
    // non-empty and must still read as an event, or the original ships.
    expect(bestEventTitleSegment("(Aug 2026)")).toBe("(Aug 2026)");
    expect(bestEventTitleSegment("Molten Salt Congress, Lyon France")).toBe(
      "Molten Salt Congress",
    );
  });

  it("keeps the original when the place strip would leave site chrome behind", () => {
    // The same guard on the other strip: `Conference Programme` does not pass
    // the shipped chrome/event-title pair, so the tail stays rather than
    // promoting chrome into the name slot.
    expect(bestEventTitleSegment("Conference Programme, Lyon France")).toBe(
      "Conference Programme, Lyon France",
    );
  });

  it("strips a day-range parenthetical too", () => {
    expect(
      bestEventTitleSegment("Solid-State Battery Summit (Aug 11-12, 2026)"),
    ).toBe("Solid-State Battery Summit");
  });

  // THE MONTH-GRANULARITY PARTIAL.
  it("hands the removed month-year to the date field at MONTH granularity", () => {
    expect(
      bestEventTitleSegmentDetailed(
        "Solid-State Battery Summit (Aug 2026), Chicago USA",
      ),
    ).toEqual({ segment: "Solid-State Battery Summit", monthYear: "2026-08" });
  });

  it("NEVER falls back to a year alone — an unparseable month leaves the date absent", () => {
    // `2026` as a date would render a January instant and INVENT a value. The
    // invented-date column has held zero since round 22 and stays zero.
    expect(
      bestEventTitleSegmentDetailed("Solid-State Battery Summit (2026)"),
    ).toEqual({ segment: "Solid-State Battery Summit", monthYear: undefined });
  });

  it("does not overwrite a day-level date the snippet already evidenced", () => {
    const item = webResultToRawEventItem(
      {
        title: "Solid-State Battery Summit (Aug 2026), Chicago USA",
        url: "https://10times.com/e1z2-0h5z-3pgr",
        snippet:
          "The Solid-State Battery Summit runs August 11-12, 2026 in Chicago.",
      },
      Date.parse("2026-06-01T00:00:00Z"),
    );
    expect(item?.startDate).toBe("2026-08-11T12:00:00.000Z");
  });

  it("publishes the month-granularity date when nothing finer exists", () => {
    const item = webResultToRawEventItem(
      {
        title: "Solid-State Battery Summit (Aug 2026), Chicago USA",
        url: "https://10times.com/e1z2-0h5z-3pgr",
        snippet: "Solid-State Battery Summit conference listing.",
      },
      Date.parse("2026-06-01T00:00:00Z"),
    );
    expect(item?.name).toBe("Solid-State Battery Summit");
    expect(item?.startDate).toBe("2026-08");
  });

  it("expires a month-granularity row only once its month has FULLY passed", () => {
    const row = (now: string) =>
      webResultToRawEventItem(
        {
          title: "Solid-State Battery Summit (Aug 2026), Chicago USA",
          url: "https://10times.com/e1z2-0h5z-3pgr",
          snippet: "Solid-State Battery Summit conference listing.",
        },
        Date.parse(now),
      );
    // Mid-month: still live. Reading "2026-08" as a day-level date would put it
    // at 1 August and retire it here — wrongly EARLY, the failure 62b names.
    expect(row("2026-08-15T00:00:00Z")).not.toBeNull();
    // First of the month: still live.
    expect(row("2026-08-01T12:00:00Z")).not.toBeNull();
    // The month is over: gone.
    expect(row("2026-09-02T00:00:00Z")).toBeNull();
  });
});

// ───────────────────────────────────────────────────────────────────────
// A27-01 (round 27, item 3). THE BARE HUB URL.
//
// Three listing/hub pages were admitted at ingestion 5 of 5 in round 27 A's
// census. Every one of the five shipped kind guards returns `false` on all
// three. The one thing they share is the thing nothing looked at: the URL path
// is a bare hub noun with no item below it.
//
// A TITLE-ONLY RULE IS IMPOSSIBLE, and that is the load-bearing finding: a
// draft fifth alternative on `EVENT_INDEX_TITLE_RE` (a plural index noun
// ending the first segment) drops two SHIPPED MUST-KEEPS, because `DLR Events`
// and `Battery Events` are the same shape. Both are asserted below on the NEW
// predicate, so any later attempt to make this a title rule reds a test.
// ───────────────────────────────────────────────────────────────────────
describe("A27-01: isEventHubResult", () => {
  const NOW = Date.parse("2026-08-15T00:00:00Z");

  it("drops the bare hub that rendered its own host as an event name", () => {
    expect(isEventHubResult("Battery Events", "https://volta.foundation/event")).toBe(true);
    // And the row leaves at admission, so nothing downstream can name it.
    expect(
      webResultToRawEventItem(
        {
          title: "Battery Events",
          url: "https://volta.foundation/event",
          snippet: "Upcoming battery conferences and workshops.",
        },
        NOW,
      ),
    ).toBeNull();
  });

  it("drops a careers hub — the face the event surface had no guard for at all", () => {
    expect(
      isEventHubResult("Career - Join Our Passionate Team", "https://iongroup.com/careers"),
    ).toBe(true);
  });

  it("drops a brand-led conferences hub", () => {
    expect(
      isEventHubResult(
        "Annexus Health Conferences: where to find us",
        "https://annexushealth.com/conferences",
      ),
    ).toBe(true);
  });

  it("agrees with the shipped index check on the rows it already drops", () => {
    // Kept in the corpus deliberately: the new predicate must AGREE with the
    // old one rather than fight it.
    expect(
      isEventHubResult(
        "Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech",
        "https://www.cambridgeenertech.com/cet/conferences",
      ),
    ).toBe(true);
    expect(
      isEventHubResult(
        "Events - Gateway for Accelerated Innovation in Nuclear",
        "https://gain.inl.gov/news/events",
      ),
    ).toBe(true);
  });

  it("keeps the two must-keeps that killed the title-only draft", () => {
    // `Co-located Workshops` — signal 2 fires, signal 1 does not. BOTH are
    // required, and this row is why.
    expect(
      isEventHubResult(
        "Co-located Workshops | The Battery Show North America",
        "https://www.thebatteryshow.com/en/co-located-workshops.html",
      ),
    ).toBe(false);
    // `DLR Events` — the hub noun is present but has an ITEM below it. The
    // shipped slug-recovery test depends on this row surviving.
    expect(
      isEventHubResult(
        "DLR Events | Events for July 2026",
        "https://event.dlr.de/en/event/emea2026-workshop-on-battery-technology/",
      ),
    ).toBe(false);
  });

  it("honours Ruling 64b by construction — a SINGULAR index noun never fires", () => {
    // 64b's own witness, restated on the new predicate. The URL is the most
    // hostile one available: a bare hub path.
    for (const url of [
      "https://example.test/workshops",
      "https://example.test/workshop",
      "https://example.test/conferences",
    ]) {
      expect(isEventHubResult("All Solid State Battery Workshop", url)).toBe(false);
      expect(isEventHubResult("All Solid-State Battery Workshop", url)).toBe(false);
    }
  });

  it("keeps a single-event site whose own page sits at a bare hub path", () => {
    // Signal 1 alone would drop both of these. They are the reason signal 2
    // exists.
    expect(
      isEventHubResult("32nd SolarPACES Conference", "https://www.solarpaces.org/conference"),
    ).toBe(false);
    expect(
      isEventHubResult(
        "Conference Overview | The Battery Show South",
        "https://www.thebatteryshowsouth.com/en/conference",
      ),
    ).toBe(false);
    // The one real row-admission call site in the URL sweep: the head ends in
    // a year, so signal 2 never fires and the row is still admitted.
    expect(
      isEventHubResult(
        "International Battery Power Conference 2026",
        "https://example.com/conference",
      ),
    ).toBe(false);
  });

  it("returns false with no url at all — every one-argument assertion is safe by construction", () => {
    for (const title of [
      "Battery Events",
      "Career - Join Our Passionate Team",
      "Annexus Health Conferences: where to find us",
      "Upcoming Energy Storage Conferences | Provided by Cambridge EnerTech",
      "Events - Gateway for Accelerated Innovation in Nuclear",
      "Co-located Workshops | The Battery Show North America",
      "DLR Events | Events for July 2026",
      "All Solid State Battery Workshop",
      "32nd SolarPACES Conference",
    ]) {
      expect(isEventHubResult(title)).toBe(false);
      expect(isEventHubResult(title, "not a url")).toBe(false);
    }
  });

  it("takes the head with the SHIPPED splitter — a bare hyphen is not a separator", () => {
    // CONSTRUCTED, not sighted, and labelled as such. `Co-located Workshops` on
    // a bare hub path IS a hub row and drops; cut the head at the bare hyphen
    // instead and the head becomes `Co`, which fires nothing. The shipped
    // `titleSegments` splitter requires SPACED separators and is reused rather
    // than re-written, so name selection and admission cannot drift apart.
    expect(isEventHubResult("Co-located Workshops", "https://example.test/workshops")).toBe(true);
  });
});

// Round 30, Ruling 81b (B's item 2, the V2 structural-guard extensions,
// approved as written). `meetings?` added to both `EVENT_HUB_PATH_SEGMENT_RE`
// and `EVENT_HUB_TITLE_TAIL_RE`, plus ONE hyphen-bounded qualifier-prefix
// alternative in the path regex's closed list. See both constants' doc
// comments in eventweb.ts.
describe("Round 30, Ruling 81b — the event-hub V2 extension", () => {
  it("catches the live similar-conferences-listing specimen B reproduced", () => {
    expect(
      isEventHubResult("Upcoming Meetings - ECS", "https://www.electrochem.org/upcoming-meetings"),
    ).toBe(true);
  });

  it("does not regress A27-01's own recorded rows", () => {
    // Ruling 64b's must-keep pair, replayed at their REAL asserted URLs.
    expect(
      isEventHubResult(
        "Co-located Workshops | The Battery Show North America",
        "https://www.thebatteryshow.com/en/co-located-workshops.html",
      ),
    ).toBe(false);
    expect(
      isEventHubResult(
        "DLR Events | Events for July 2026",
        "https://event.dlr.de/en/event/emea2026-workshop-on-battery-technology/",
      ),
    ).toBe(false);
    // The SolarPACES bare-hub-path single-event control.
    expect(
      isEventHubResult("32nd SolarPACES Conference", "https://www.solarpaces.org/conference"),
    ).toBe(false);
  });

  it("the hyphen-qualifier alternative is a closed, anchored alternative — not a substring rule", () => {
    // Pair a title that DOES satisfy signal 2 (a plural tail word) with a
    // multi-hyphen path, to isolate signal 1's own behaviour: if it wrongly
    // matched a multi-hyphen slug, this row would become a false catch.
    // The character class excludes `-`, so only the FIRST hyphen-delimited
    // piece can ever be the qualifier, and the remainder
    // (`located-workshops.html`) is not itself one of the five words — the
    // alternative fails by construction. This is exactly why the real
    // `co-located-workshops.html` must-keep above survives.
    expect(
      isEventHubResult("Upcoming Workshops", "https://example.test/co-located-workshops.html"),
    ).toBe(false);
    // A single, genuine hyphen-qualified compound DOES fire — this is the
    // shape the alternative exists for, and it needs no title-side help.
    expect(isEventHubResult("Upcoming Meetings", "https://example.test/upcoming-meetings")).toBe(
      true,
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
// A27-03 (round 27, item 4). WITHIN-YEAR EXPIRY BLINDNESS.
//
// The dates on these pages are read. A22-01 then correctly refuses to PUBLISH
// one, because two readings with no owned title span is real ambiguity. That
// leaves the expiry anchor empty, and the only surviving test compared YEARS —
// so a page whose every date is past, inside the current year, was kept.
//
// The fix DROPS ONLY. It publishes nothing: `startDate` is `""` on every
// surviving row before and after, so 62b's invented-date column stays zero by
// construction. These blocks pin the class AND the three boundaries that must
// not move.
// ───────────────────────────────────────────────────────────────────────
describe("A27-03: a page whose every reading is past inside the current year", () => {
  const NOW = Date.parse("2026-08-15T00:00:00Z");

  // TWO THINGS EVERY FIXTURE IN THIS BLOCK HAS TO GET RIGHT, both found by C's
  // own first draft going wrong, and written down so the next one does not
  // repeat them:
  //  (a) the snippet must carry EVENT VOCABULARY, or `looksLikeEvent` drops the
  //      row long before any date logic runs;
  //  (b) the TITLE MUST NOT APPEAR IN THE SNIPPET. If it does, `ownedTitleSpan`
  //      hands A22-01 a witness, the date IS published, the anchor is non-empty
  //      and the SHIPPED past-anchor check drops the row — so the fixture would
  //      pass with this whole clause deleted. That is exactly what C's first
  //      draft did, and the mutation run is what caught it.
  it("drops a page whose every day-level reading is past in the current year", () => {
    const item = webResultToRawEventItem(
      {
        title: "Molten Salt Research Reactor Tour",
        url: "https://example.com/events/molten-salt-tour",
        snippet:
          "Past meetings: the conference ran June 8, 2026 in Philadelphia and the review followed on March 3, 2026.",
      },
      NOW,
    );
    expect(item).toBeNull();
  });

  it("keeps A's control — one past reading and one future one is NOT finished", () => {
    // THE WORD `every` IS LOAD-BEARING. Written as "the earliest reading is
    // past" this clause would delete a live event. This block is what stops a
    // later round simplifying it.
    const item = webResultToRawEventItem(
      {
        title: "The Battery Saloon",
        url: "https://example.com/events/battery-saloon",
        snippet:
          "This conference previously ran April 22-24, 2026. The next session of the conference is November 5, 2026.",
      },
      NOW,
    );
    expect(item).not.toBeNull();
    // AND IT PUBLISHES NOTHING: the ambiguity guard's silence is intact.
    expect(item?.startDate).toBe("");
  });

  it("leaves the dateless branch exactly where it was — zero candidates cannot fire this", () => {
    // Ruling 62b's recorded design, locked so it cannot be purged by accident.
    const item = webResultToRawEventItem(
      {
        title: "Advanced Battery Materials Summit",
        url: "https://example.com/events/advanced-battery-materials-summit",
        snippet:
          "An international summit on battery materials. Registration is open; the programme will be announced.",
      },
      NOW,
    );
    expect(item).not.toBeNull();
    expect(item?.startDate).toBe("");
  });

  it("keeps a finished page that names a LATER year — the escape, with its price", () => {
    // A real next-edition page. The clause can only ever ADMIT relative to the
    // rule without it, which is the safer direction for a row-dropping guard.
    // Its named cost: a genuinely finished page mentioning any later year
    // survives, dateless, exactly as it does today.
    const item = webResultToRawEventItem(
      {
        title: "International Battery Congress",
        url: "https://example.com/events/international-battery-congress",
        snippet:
          "Our 2026 congress was held May 5, 2026 and the workshop ran March 2, 2026. The 2027 edition follows.",
      },
      NOW,
    );
    expect(item).not.toBeNull();
    expect(item?.startDate).toBe("");
  });

  it("does not reverse A22-01 — no surviving row gains a date it did not have", () => {
    // The whole item asserted from the other side: across every snippet above
    // that survives, `startDate` is the empty string. Nothing in this clause
    // assigns a date, and this is the assertion that would catch it if
    // something later did.
    for (const snippet of [
      "This conference previously ran April 22-24, 2026. The next session of the conference is November 5, 2026.",
      "Our 2026 congress was held May 5, 2026 and the workshop ran March 2, 2026. The 2027 edition follows.",
      "An international summit on battery materials. Registration is open; the programme will be announced.",
    ]) {
      const item = webResultToRawEventItem(
        {
          title: "Molten Salt Research Reactor Tour",
          url: "https://example.com/events/molten-salt-tour",
          snippet,
        },
        NOW,
      );
      expect(item?.startDate).toBe("");
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RULING 75 (round 28 C, item 0) — THE PROVIDER SEAM ON THIS SURFACE.
//
// This adapter used a bare `keys.tavily ? tavily : brave` ternary and **never
// read `webSearch.provider` at all**, so "all three surfaces uniform" meant
// ADDING preference reading here. These tests pin the two things that were
// actually broken: the surface was DARK with Tavily disabled, and it had no way
// to be told which provider to use.
// ═══════════════════════════════════════════════════════════════════════════

describe("RULING 75 — eventweb provider resolution", () => {
  const baseQuery = { topics: ["molten salt"], queries: ["molten salt conference"], limit: 80 };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function withoutKeys(): void {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    // CREDIT MIGRATION — stated, not inherited. Vitest loads every `GOOGLE_`
    // variable out of `.env.local`, so once a developer configures a real
    // Search App these cases would silently start resolving to `vertex` and
    // this block would be testing the machine instead of the code.
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_DATA_STORE_ID", "");
  }

  it("was DARK before this item: no keys, no webSearch block, no source", () => {
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    expect(resolveSearchProvider(baseQuery)).toBeNull();
    expect(eventweb.enabled(baseQuery)).toBe(false);
  });

  // ABC-freemium 2-04 — an ENTITLED query. Vertex and grounding sit behind
  // `systemSearchAllowed` now, exactly as the Tavily and Brave keys do.
  const entitledQuery = {
    ...baseQuery,
    webSearch: { systemSearchAllowed: true },
  };

  it("stays DARK even when Vertex is present and the query asks for gemini", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12), Ruling 13
    // point 4. Was "comes back on when Vertex is present…" and asserted
    // `.toBe("gemini")` with `enabled` true.
    //
    // This is a RULING 75 case inherited from the report-parity loop, and D2a
    // took away its subject: grounding is operator-funded, so it is now
    // unreachable on every plan. Rewritten in place rather than deleted, with
    // the same inputs, because the inverted assertion is worth having — it is
    // the proof that not even a fully configured Vertex project plus an
    // explicit `provider` preference plus a forced entitlement flag can reach
    // grounding. That is a stronger statement than the old one.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const query = {
      ...baseQuery,
      webSearch: { provider: "gemini" as const, systemSearchAllowed: true },
    };
    expect(resolveSearchProvider(query)).toBeNull();
    expect(eventweb.enabled(query)).toBe(false);
  });

  it("refuses an EXPLICIT gemini or vertex preference when the reader is not entitled", () => {
    // The case an order-only fix would have left open (2-04): the pipeline sets
    // `provider` from the server's own environment, so an unentitled caller
    // lands on the explicit branch and never reaches the auto order.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "peer-web");

    for (const provider of ["gemini", "vertex"] as const) {
      const query = {
        ...baseQuery,
        webSearch: { provider, systemSearchAllowed: false },
      };
      expect(resolveSearchProvider(query)).toBeNull();
      expect(eventweb.enabled(query)).toBe(false);
    }
  });

  it("picks NOTHING on auto, entitled or not, once the operator stops paying", () => {
    // REWRITTEN, NOT DELETED — 5-04 · D2a, Ruling 13 point 4. Was "picks gemini
    // on auto when the reader is entitled…" and asserted `.toBe("gemini")` for
    // the entitled query. Both halves now answer `null`, which is the whole of
    // D2a on this surface: entitlement no longer changes what search a reader
    // gets, because nobody gets operator-funded search.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(resolveSearchProvider(entitledQuery)).toBeNull();
    expect(resolveSearchProvider(baseQuery)).toBeNull();
  });

  // CREDIT MIGRATION — the new default, pinned in the same block as the old
  // one so the pair reads as the order it is: a configured Search App takes
  // the server-Vertex slot, grounding keeps it when there is none.
  it("does NOT pick vertex on auto, even with a Search App configured", () => {
    // REWRITTEN, NOT DELETED — 5-04 · D2a, Ruling 13 point 4. Was "picks vertex
    // on auto once a Search App is configured" and asserted `.toBe("vertex")`.
    // A configured Vertex AI Search app is operator-funded search, so under D2a
    // it is unreachable however completely it is configured. The CREDIT
    // MIGRATION ordering it used to pin (a Search App outranks grounding) is
    // dead code's business now, and this case records that it is unreachable
    // rather than pretending the ordering still decides anything.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "peer-web");
    expect(resolveSearchProvider(entitledQuery)).toBeNull();
    expect(resolveSearchProvider(baseQuery)).toBeNull();
  });

  it("still yields to a caller-supplied Tavily key", () => {
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(
      resolveSearchProvider({ ...baseQuery, webSearch: { tavilyApiKey: "caller-key" } }),
    ).toBe("tavily");
  });

  it("an explicit brave preference wins over an available Vertex project", () => {
    // REWRITTEN, NOT DELETED — 2-04. The preference still wins; the query has
    // to be entitled first, because Brave is operator-funded too.
    withoutKeys();
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "brave-key");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(
      resolveSearchProvider({
        ...baseQuery,
        webSearch: { provider: "brave" as const, systemSearchAllowed: true },
      }),
    ).toBe("brave");
    // ...and is refused outright without one.
    expect(
      resolveSearchProvider({
        ...baseQuery,
        webSearch: { provider: "brave" as const, systemSearchAllowed: false },
      }),
    ).toBeNull();
  });

  // ABC-freemium 1-05 · R-KEY-3 — REWRITTEN, NOT DELETED. This case asserted
  // that the operator's environment Tavily key alone resolved `"tavily"`. On
  // this surface that was the largest leak in the round: an unauthenticated
  // request produced seven outgoing searches on the operator's key. The env key
  // now requires `systemSearchAllowed`, which only the route can set and only
  // from the entitlement.
  it("NEVER spends the operator's env Tavily key, entitled or not (D2a)", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12). The entitled
    // half asserted `.toBe("tavily")` with `enabled` true; it now answers `null`
    // and `false` like the unentitled half. The env key is armed on purpose, so
    // zero is a statement about the gate and not about an empty environment.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("TAVILY_API_KEY", "env-tavily");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    expect(resolveSearchProvider(baseQuery)).toBeNull();
    expect(eventweb.enabled(baseQuery)).toBe(false);

    const entitled = {
      ...baseQuery,
      webSearch: { systemSearchAllowed: true },
    };
    expect(resolveSearchProvider(entitled)).toBeNull();
    expect(eventweb.enabled(entitled)).toBe(false);
  });

  it("spends the operator's env Brave key only when the request is entitled", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 2-04 · Ruling 5 point 2. Was
    // "keeps the shipped Brave behaviour exactly", with a comment saying
    // R-KEY-3 leaves Brave ungated because D2 bans it on Vercel. A ban on
    // Vercel is not a gate on a self-host or a developer machine.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "env-brave");

    expect(resolveSearchProvider(baseQuery)).toBeNull();
    expect(resolveSearchProvider(entitledQuery)).toBe("brave");
  });
});

/**
 * ABC-freemium 5-04 · **Ruling 12 point 7, standing tally 2** — `kind:"search"`
 * usage rows produced must be 0.
 *
 * **NEW FILE SECTION, and the reason it is new is the finding.** There are
 * exactly three producers of a `kind:"search"` row in production source —
 * `jobs/sources/jobweb.ts`, `events/sources/eventweb.ts` and
 * `sources/web-search.ts` — and only two of them had a row-capturing test.
 * The events one had none, so the tally would have been proved on two thirds of
 * its subject. This is the missing third.
 */
describe("5-04 — the events surface writes no kind:\"search\" row (D2a)", () => {
  const rows: UsageEventRow[] = [];

  afterEach(() => {
    vi.unstubAllEnvs();
    setUsageEventsClientForTests(undefined);
    resetCounterStoreForTests();
    geminiSearchMock.mockReset();
  });

  it("writes nothing, on the most generous input the surface accepts", async () => {
    rows.length = 0;
    resetCounterStoreForTests();
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "");
    setUsageEventsClientForTests({
      from: () => ({
        insert: (inserted: UsageEventRow[]) => {
          rows.push(...inserted);
          return Promise.resolve({ error: null });
        },
      }),
    } as never);
    // Every candidate armed: an operator Tavily key, a Brave key, a configured
    // Vertex project, an explicit provider, a real user id and the entitlement
    // flag forced true. Zero here is therefore a statement about the gate.
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "BRAVE-NOT-A-KEY");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    geminiSearchMock.mockResolvedValue([]);

    const items = await eventweb.fetch({
      topics: ["molten salt"],
      queries: ["molten salt conference"],
      limit: 80,
      webSearch: {
        provider: "gemini",
        systemSearchAllowed: true,
        userId: "user-1",
      },
    });

    expect(items).toEqual([]);
    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows.filter((row) => row.kind === "search")).toEqual([]);
    expect(rows).toEqual([]);
  });
});

// RULING 75 — STAGE 2b, PROVED AT THE SEAM RATHER THAN ARGUED.
// The event surface forwards `DENY_HOSTS` as a pre-screen because that list is
// an OUTRIGHT, title-independent deny (see its call site in the adapter), so
// skipping those hosts before a page fetch cannot change an admission.
describe("RULING 75 — eventweb hands the gemini adapter its deny list", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    geminiSearchMock.mockReset();
  });

  it("never calls the gemini adapter at all, so it forwards nothing (D2a)", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · **Ruling 13 point 4**, option
    // (a), which the manager adopted with the cost recorded.
    //
    // The old assertions, kept verbatim so the knowledge is not lost with the
    // coverage:
    //
    //     expect(geminiSearchMock).toHaveBeenCalledTimes(1);
    //     const options = geminiSearchMock.mock.calls[0][1] as Record<string, unknown>;
    //     expect(options.denyHosts).toBe(DENY_HOSTS);
    //     expect(options.excludeDomains).toEqual([
    //       "arxiv.org", "openalex.org", "semanticscholar.org",
    //     ]);
    //
    // **THE ACCEPTED COVERAGE COST, and the machinery for noticing it is owed.**
    // The code under test is eventweb's own option construction inside
    // `fetchImpl`, one layer above the adapter, and D2a makes that layer
    // unreachable. It cannot be re-pointed without extracting a production seam
    // D2a did not ask for. So the deny-list forwarding rule loses live coverage
    // and this case now asserts absence instead of content. **A tallies this
    // every round — "Ruling 75 option-building cases now asserting absence
    // rather than content", and the number is 4** (this one plus three in
    // `jobweb.test.ts`). **Threshold: if grounding is ever re-enabled for any
    // plan, all four are restored to content assertions in the same round.**
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    geminiSearchMock.mockResolvedValue([]);

    const items = await eventweb.fetch({
      topics: ["molten salt"],
      queries: ["molten salt conference"],
      limit: 80,
      webSearch: { provider: "gemini", systemSearchAllowed: true },
    });

    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(items).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 1 (A29-01 + A29-07) — the one contract change: family (ii)
// abstain-on-absence, channel L, and the title-side artefact-head rule.
// Ruling 79a. Every case below is uniquely red without its own clause.
// ---------------------------------------------------------------------------

describe("A29-01 — absence is not evidence (event side)", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");

  it("ABSTAINS instead of refusing when the snippet is empty after trim", () => {
    // The clause's uniquely-red case: neither the title nor the (absent)
    // snippet names the kind, so the shipped `!looksLikeEvent` arm refused it
    // on text the row never had. It must now fall through to the dateless
    // branch and be decided by guards that actually have evidence.
    const item = webResultToRawEventItem(
      {
        title: "Molten Salt Chemistry 2027",
        url: "https://example.org/molten-salt-chemistry-2027",
        snippet: "   ",
      },
      now,
    );
    expect(item).not.toBeNull();
  });

  it("still REFUSES when a snippet is present and no arm names the kind", () => {
    // The admitted control. "Absent" means EMPTY, never "short" — this is the
    // boundary that keeps the abstain clause from becoming a blanket amnesty.
    const item = webResultToRawEventItem(
      {
        title: "Molten Salt Chemistry 2027",
        url: "https://example.org/molten-salt-chemistry-2027",
        snippet: "A supplier of high purity salts for industrial customers.",
      },
      now,
    );
    expect(item).toBeNull();
  });

  it("keeps admitting on the TITLE alone when the snippet is empty", () => {
    // The title never stopped voting; only the starved arm did.
    const item = webResultToRawEventItem(
      {
        title: "International Molten Salt Symposium 2027",
        url: "https://example.org/imss-2027",
        snippet: "",
      },
      now,
    );
    expect(item).not.toBeNull();
  });

  it("does not hand extractEventDate one new character (Ruling 62b)", () => {
    // 62b's falsifier, stated as a test rather than as a claim: the abstain
    // clause changes WHICH rows survive the kind gate, never the text the date
    // extractors read. A row that abstains with no date in its own title and
    // no snippet must carry NO date, not an invented one.
    const item = webResultToRawEventItem(
      {
        title: "Molten Salt Chemistry Programme",
        url: "https://example.org/programme",
        snippet: "",
      },
      now,
    );
    expect(item).not.toBeNull();
    // The dateless branch's own shape, asserted as MEASURED rather than as
    // expected: `startDate` is the empty string and `endDate` is undefined.
    expect(item?.startDate).toBe("");
    expect(item?.endDate).toBeUndefined();
  });
});

describe("A29-01 — channel L: the page's own schema.org declaration", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");

  it("ADMITS a page that declares @type: Event even with a present, kind-free snippet", () => {
    // B's named rescue: `The Battery Show North America` publishes a
    // 154-character description with no kind word AND declares `Event` in its
    // JSON-LD. It was a VOCABULARY casualty, not an emptiness one, so the
    // abstain clause cannot reach it and only channel L can.
    const item = webResultToRawEventItem(
      {
        title: "The Battery Show North America",
        url: "https://www.thebatteryshow.com/",
        snippet:
          "The largest advanced battery gathering in North America, bringing together engineers and buyers across the supply chain in Detroit.",
        pageKind: "event",
      },
      now,
    );
    expect(item).not.toBeNull();
  });

  it("REFUSES the identical row when the page declares nothing", () => {
    // Uniquely red for channel L: same title, same snippet, no declaration.
    const item = webResultToRawEventItem(
      {
        title: "The Battery Show North America",
        url: "https://www.thebatteryshow.com/",
        snippet:
          "The largest advanced battery gathering in North America, bringing together engineers and buyers across the supply chain in Detroit.",
      },
      now,
    );
    expect(item).toBeNull();
  });

  it("RULING 79a NAMED COST — `The Battery Saloon` is NOT rescued, on purpose", () => {
    // `batteryinnovationsummit.com/` publishes a 157-character description with
    // no kind word, no `og:site_name`, NO JSON-LD, and `extractPageText`
    // returns 0 characters. Neither 78a family reaches it. The only measured
    // rescue was channel H-prime, REFUSED by 79a (2 of 9 adversarial rows
    // wrongly admitted). This test records the twice-adjudicated must-keep as a
    // LOST, accepted cost of the Ruling 75 provider switch rather than leaving
    // the loss silent. If a later round rescues it honestly, RESTATE this
    // assertion with that item named — do not delete it.
    const item = webResultToRawEventItem(
      {
        title: "The Battery Saloon",
        url: "https://batteryinnovationsummit.com/",
        snippet:
          "Join industry leaders for two days of networking, deal-making and hard-won lessons from the frontier of energy storage in Nashville.",
      },
      now,
    );
    expect(item).toBeNull();
  });
});

describe("A29-07 — an artefact produced at an event is not the event", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");

  it("drops the repository slide deck that names its own symposium", () => {
    const item = webResultToRawEventItem(
      {
        title:
          "Instructional Slides from Molten Salt Electrochemistry Symposium (MoSES)",
        url: "https://scholarsarchive.byu.edu/facpub/9603/",
        snippet: "",
      },
      now,
    );
    expect(item).toBeNull();
  });

  it("keeps the REAL event whose head is its own name", () => {
    // The admitted control, and the reason the rule is anchored at the head:
    // `pyro.byu.edu/moses` renders correctly 5 of 5 and must not move.
    expect(
      isEventArtefactTitle("Molten Salt Electrochemistry Symposium (MoSES) 2026"),
    ).toBe(false);
  });

  it("spans the class, not just the one row", () => {
    expect(isEventArtefactTitle("Slides from the 2026 Battery Symposium")).toBe(true);
    expect(isEventArtefactTitle("Proceedings of the Molten Salt Workshop")).toBe(true);
    expect(isEventArtefactTitle("Poster presented at the 2026 Battery Summit")).toBe(true);
    expect(isEventArtefactTitle("Presentation at the Nuclear Materials Conference")).toBe(true);
  });

  it("requires the attribution preposition — a bare artefact noun never fires", () => {
    // `Poster Session` is part of a real conference programme.
    expect(isEventArtefactTitle("Poster Session")).toBe(false);
    expect(isEventArtefactTitle("Poster Session and Reception 2026")).toBe(false);
    expect(isEventArtefactTitle("Presentation Skills Workshop")).toBe(false);
  });

  it("allows ONE leading modifier and no more", () => {
    // One is needed by the live row (`Instructional Slides from …`); two would
    // admit `Call for Posters at …`, a shape round 29 B never measured.
    expect(isEventArtefactTitle("Instructional Slides from the MoSES Symposium")).toBe(true);
    expect(isEventArtefactTitle("Call for Posters at the Battery Summit")).toBe(false);
  });
});

describe("ROUND 29 C, ITEM 1 — the must-keep corpus round 29 B set as the acceptance", () => {
  const now = Date.parse("2026-08-18T00:00:00Z");

  it("EUCHEMSIL 2026 @ euchemsil2026.com does not move", () => {
    // B §1.1: a 200-character og:description carrying no date, so it rides the
    // DATELESS BRANCH. Nothing in this item may disturb that.
    const item = webResultToRawEventItem(
      {
        title: "EUCHEMSIL 2026",
        url: "https://euchemsil2026.com/",
        snippet:
          "The European Conference on Molten Salts and Ionic Liquids brings together researchers working on high temperature salt chemistry and ionic liquid systems.",
      },
      now,
    );
    expect(item).not.toBeNull();
  });

  it("Quintus stays ADMITTED — the non-monotonicity canary", () => {
    // The row B used to falsify the rival "append page text to the snippet"
    // family: it is ADMITTED today and REFUSED once 1200 characters of its own
    // page text are appended. A widening that deletes currently-rendered rows
    // is not a widening, which is why `pageSnippetFromHtml` was left alone.
    const item = webResultToRawEventItem(
      {
        title: "Solid-State Battery Summit 2026 | Quintus Technologies",
        url: "https://quintustechnologies.com/events/solid-state-batteries-summit-2026/",
        snippet:
          "Quintus Technologies, The Global Leader in isostatic pressing, invites you to a summit on solid-state battery manufacturing in Chicago.",
      },
      now,
    );
    expect(item).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 4 (A29-05) — count the trail, do not match the separator.
// Round 29 B's eight-row corpus, run as assertions.
// ---------------------------------------------------------------------------

describe("A29-05 — a breadcrumb trail is not an event name", () => {
  const ANS_URL = "https://www.ans.org/meetings/c_1/sessions";

  it("cuts the live ANS trail down to its head", () => {
    expect(
      bestEventTitleSegment(
        "Molten Salt Fuel Chemistry -- ANS / Conferences / 2026 ANS Annual Conference / Technical Sessions",
        ANS_URL,
      ),
    ).toBe("Molten Salt Fuel Chemistry");
  });

  it("leaves every real name in B's corpus BYTE-IDENTICAL", () => {
    // The three A's implied separator fix would have truncated, plus the three
    // it happened to spare. `R&D / Innovation Summit 2026` is the worst case:
    // a separator rule renders the two-character name `R&D`.
    for (const name of [
      "Gordon Research Conference / Batteries",
      "Electrochemistry -- Fundamentals and Applications Symposium",
      "R&D / Innovation Summit 2026",
      "Materials and Chemistry for Molten Salt Systems",
      "AI/ML for Energy Storage Workshop 2026",
    ]) {
      expect(bestEventTitleSegment(name)).toBe(name);
    }
  });

  it("requires THREE separators — two is untested, so two does not fire", () => {
    expect(bestEventTitleSegment("Conference / Workshop / 2026")).toBe(
      "Conference / Workshop / 2026",
    );
  });

  it("counts only SPACE-DELIMITED separators", () => {
    // `AI/ML` has no spaces round its slash. Three of them still must not count.
    expect(bestEventTitleSegment("AI/ML and R&D/QA and Test/Dev Summit 2026")).toBe(
      "AI/ML and R&D/QA and Test/Dev Summit 2026",
    );
  });

  it("renders honest SILENCE rather than a chrome head — B's own residual", () => {
    // `Home / Events / 2026 / Battery Summit` is a real trail whose head is
    // worthless. The rule identifies the trail; the existing name-quality path
    // then refuses `Home`, so nothing is returned and `eventNameFrom` falls
    // through to its slug and snippet stages.
    expect(bestEventTitleSegment("Home / Events / 2026 / Battery Summit")).toBeUndefined();
  });

  it("an absent or separator-free title cannot fire the rule", () => {
    expect(bestEventTitleSegment("")).toBeUndefined();
    expect(bestEventTitleSegment("Battery Summit 2026 | Register | Home")).toBe(
      "Battery Summit 2026",
    );
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round 31 C (Ruling 84c, implementing B's item 3 §3.2 VERBATIM, both
// designs). A30-03: `stocktitan.net` investor-PR headlines are admitted as
// events because `isNewsArticleTitle`'s closed vocabulary doesn't reach
// financial-newswire PR shapes. See `TICKER_NEWS_PATH_RE`/`isTickerNewsPath`
// (design A, path structure) and `PR_ANNOUNCEMENT_HEADLINE_RE` (design B,
// title structure) in eventweb.ts for the full design. This guard had ZERO
// dedicated test coverage before this item — the base-case lock at the end
// of this block is Ruling 84c's own commissioned addition, closing that gap
// for the EXISTING guard before it grows two new disjuncts.
describe("Round 31 C — item 3, investor-PR headlines are not events (Ruling 84c)", () => {
  const LIVE_TITLE = "Birchtech plans 4 water conference stops as PFAS removal draws focus";
  const LIVE_URL =
    "https://www.stocktitan.net/news/BCHT/birchtech-to-exhibit-at-upcoming-water-industry-conferences-x.html";

  it("catches the live specimen with both title and URL present", () => {
    expect(isNewsArticleTitle(LIVE_TITLE, LIVE_URL)).toBe(true);
  });

  it("design A (ticker path) alone catches it, independent of the title", () => {
    // A neutral, non-PR-shaped title paired with the real URL — only the
    // ALL-CAPS ticker-slug path signal can be firing here.
    expect(isNewsArticleTitle("Water Industry Conferences Overview", LIVE_URL)).toBe(true);
  });

  it("design B (title shape) alone catches it, independent of the URL", () => {
    // The real title with no URL at all — only the subject+plans+digit
    // signal can be firing here.
    expect(isNewsArticleTitle(LIVE_TITLE)).toBe(true);
  });

  it("does NOT catch the file's own named counterexample — battery2030.eu's real /news/ page", () => {
    // The doc comment above `NEWS_HEADLINE_PATH_RE` names this exact page as
    // why bare "news" is deliberately excluded from the anchored path check.
    // `call-for-abstracts` is lowercase, not a 1-5-char all-caps ticker, so
    // design A cannot collide with it either.
    expect(
      isNewsArticleTitle(
        "Call for Abstracts for the Battery 2030+ Annual Conference 2026",
        "https://battery2030.eu/news/call-for-abstracts",
      ),
    ).toBe(false);
  });

  it("keeps admitting round 30 A's own nine ADMITTED real event titles", () => {
    for (const title of [
      "IEX 2026 technical training...",
      "EUCHEMSIL 2026: 30th EUCHEMS Meeting",
      "Molten Salt Electrochemistry Symposium (MoSES)",
      "Thorium and Molten Salt Recognition: EUROMOST 2026...",
      "Molten Salt Fuel Chemistry -- ANS / Conferences / 2026 ANS A...",
      "Solid-State Battery Summit 2026 | Quintus Technologies",
      "The Battery Show North America | Advanced Battery & EV Tech...",
      "Molten International Symposium - Topics - SIPS 2026 by FLOGE...",
      "Join us at the International Battery Seminar & Exhibit 2026 in Orlando! | Veryst Engineering",
    ]) {
      expect(isNewsArticleTitle(title)).toBe(false);
    }
  });

  it("does not catch numbered/ordinal real event titles or PR-adjacent titles with no trailing digit", () => {
    for (const title of [
      "5th Battery Gigafactory Summit USA",
      "2026 ANS Annual Conference",
      "27th International Conference on Ion Exchange",
      "The 250th ECS Meeting",
      "Advanced Planning Solutions Conference",
      "Schedule Optimization Summit",
    ]) {
      expect(isNewsArticleTitle(title)).toBe(false);
    }
  });

  // ROUND 37 C (Ruling 103, M36-01): PR_SETS_ORDINAL_HEADLINE_RE closes a
  // fresh gap the manager's own independent re-measurement window witnessed
  // organically -- a "sets <ordinal>" PR headline that PR_ANNOUNCEMENT_HEADLINE_RE
  // is structurally incapable of catching even if "sets" were added to its
  // verb list (see the doc comment above PR_SETS_ORDINAL_HEADLINE_RE in
  // eventweb.ts for the `\d+\b`-cannot-match-an-ordinal proof). Isolated in
  // its own describe block so this new regex's own contract is locked
  // separately from PR_ANNOUNCEMENT_HEADLINE_RE's pre-existing, byte-unchanged
  // one above.
  describe("Round 37 C (Ruling 103, M36-01): PR_SETS_ORDINAL_HEADLINE_RE — the ordinal-verb PR headline gap", () => {
    const WITNESS_TITLE = "Ion Exchange sets 62nd AGM for September 11, 2026";
    const WITNESS_URL =
      "https://scanx.trade/stock-market-news/companies/ion-exchange-sets-62nd-agm-september-11-2026/48600650";

    it("catches the M36-01 witness via isNewsArticleTitle, both with and without the URL", () => {
      expect(isNewsArticleTitle(WITNESS_TITLE, WITNESS_URL)).toBe(true);
      // Title alone: only the new subject+"sets"+ordinal shape can be firing
      // here. The URL's /stock-market-news/ path signal was measured and
      // declined (B's round 37 §1.5, Ruling 103), so it must not be load-
      // bearing for this assertion to hold.
      expect(isNewsArticleTitle(WITNESS_TITLE)).toBe(true);
    });

    it("drops the M36-01 witness as a whole row via webResultToRawEventItem", () => {
      expect(
        webResultToRawEventItem(
          {
            title: WITNESS_TITLE,
            url: WITNESS_URL,
            snippet: "Ion Exchange Ltd has announced its 62nd Annual General Meeting.",
          },
          Date.parse("2026-08-19T00:00:00Z"),
        ),
      ).toBeNull();
    });

    it("does not disturb round 31's stocktitan.net regression", () => {
      expect(isNewsArticleTitle(LIVE_TITLE, LIVE_URL)).toBe(true);
    });

    it("keeps admitting four plausible scholarly-society AGM-and-conference titles (the AGM-token veto was measured and DROPPED, not shipped — Ruling 103)", () => {
      for (const title of [
        "Royal Society of Chemistry Annual General Meeting and Conference 2026",
        "British Ecological Society AGM and Scientific Meeting",
        "Institution of Chemical Engineers -- Annual General Meeting & Symposium 2026",
        "American Nuclear Society Section AGM and Technical Conference",
      ]) {
        expect(isNewsArticleTitle(title)).toBe(false);
      }
    });

    it("keeps admitting round 31 B item 3's own ordinal adversarial set — the exact set that motivated the ordinal check in the first place", () => {
      for (const title of [
        "5th Battery Gigafactory Summit USA",
        "2026 ANS Annual Conference",
        "27th International Conference on Ion Exchange",
        "The 250th ECS Meeting",
      ]) {
        expect(isNewsArticleTitle(title)).toBe(false);
      }
    });

    it("requires an ORDINAL, not a bare digit, immediately after the verb 'sets'", () => {
      // "3" here carries no ordinal suffix (st/nd/rd/th) -- the new regex's
      // own \d+(?:st|nd|rd|th)\b arm must not fire on a bare count.
      expect(
        isNewsArticleTitle("Acme Corp sets 3 new manufacturing records this quarter"),
      ).toBe(false);
    });

    it("keeps admitting a representative slice of round 33/36's must-keep event corpus", () => {
      for (const title of [
        "EUCHEMSIL 2026: 30th EUCHEMS Meeting",
        "Molten Salt Electrochemistry Symposium (MoSES)",
        "Twenty-Seventh Congress and General Assembly",
        "Solid-State Battery Summit 2026",
        "The Battery Show North America",
        "26th Advanced Automotive Battery Conference (AABC)",
        "Nuclear Career Fair - S&T Women in Nuclear",
        "2026 Job Fair & Hiring Event Calendar - JobFairX",
      ]) {
        expect(isNewsArticleTitle(title)).toBe(false);
      }
    });
  });

  it("leaves the balchem earnings-call and gain.inl.gov event-hub /news/ paths untouched", () => {
    // Neither path segment after `/news/` is a 1-5-char all-caps ticker, so
    // design A cannot fire on either — both are pre-existing, unrelated
    // must-keeps (the balchem row is the documented, ACCEPTED
    // `isEarningsCallPage` under-catch; the gain.inl.gov row is A27-01's
    // `isEventHubResult` must-keep).
    expect(
      isNewsArticleTitle(
        "Conference Call for Fourth Quarter and Full Year 2026 Financial Results",
        "https://www.balchem.com/investors/news/conference-call-q4",
      ),
    ).toBe(false);
    expect(
      isNewsArticleTitle(
        "Events - Gateway for Accelerated Innovation in Nuclear",
        "https://gain.inl.gov/news/events",
      ),
    ).toBe(false);
  });

  // RULING 84c's base-case lock for the EXISTING guard — zero coverage
  // today, and it is about to grow two new disjuncts, so present behaviour
  // is locked first.
  describe("base case: the pre-existing `announcing` clause (zero prior coverage)", () => {
    it("an announcing-led title fires isNewsArticleTitle", () => {
      expect(
        isNewsArticleTitle("Announcing the 2026 Battery Gigafactory Summit: Registration Now Open"),
      ).toBe(true);
    });

    it("a real event title merely CONTAINING 'announcing' mid-sentence does not fire", () => {
      // `announcing\b` sits INSIDE `NEWS_TITLE_RE`'s start-anchor group — it
      // only fires if the title's first word is literally "announcing", not
      // when a real event's own title happens to contain the word later on.
      expect(
        isNewsArticleTitle("Registration is open for the 2026 Battery Summit, announcing new speakers"),
      ).toBe(false);
    });
  });

  // ROUND 33 C, ITEM 1 (Ruling 89b/90a, mirror of A31-01 / Round 32 C's
  // job-side trio, Ruling 87a): the EVENT pipeline had no guard for
  // JOB-CONTENT vocabulary. Round 33 B's own live trace widened the
  // must-catch corpus from one witness (A32-01) to four, and the full
  // 30-case adversarial corpus below is B's §1.3 table, transcribed
  // verbatim.
  describe("isJobListingContentTitle (Ruling 89b/90a — job-content pages are not events)", () => {
    it("catches all four must-catch rows (the original A32-01 witness plus three fresh live witnesses)", () => {
      for (const title of [
        "Ion Exchange Mumbai Job Openings Check here",
        "Ion Exchange Jobs,Jobs for Ion Exchange, -:JobItUs",
        "Executive Jobs in All-India - 12,878 Executive Job Vacancies in All-India - Aug 2026",
        "Ion Exchange India Careers, Ion Exchange India Jobs, August 2026 Company Page - iimjobs.com",
      ]) {
        expect(isJobListingContentTitle(title)).toBe(true);
      }
    });

    it("keeps Ruling 89b's four must-keep job/career-FAIR rows", () => {
      for (const title of [
        "Nuclear Career Fair - S&T Women in Nuclear",
        "2026 Job Fair & Hiring Event Calendar - JobFairX",
        "Career Expo & Job Fair",
        "Nittany Lion Careers",
      ]) {
        expect(isJobListingContentTitle(title)).toBe(false);
      }
    });

    it("keeps this item's own three live-witnessed job/career-fair rows", () => {
      for (const title of [
        "2026 MSE-NE Career Fair",
        "Clean Energy Job Fairs - RE+ Events",
        "Nuclear job fair",
      ]) {
        expect(isJobListingContentTitle(title)).toBe(false);
      }
    });

    it("keeps every ADMITTED row in round 32 A's full event artefact table (12 rows, incl. the two honest-host-fallback titles)", () => {
      for (const title of [
        "IEX 2026 technical training introductory course: Intro...", // rsc.org
        "Molten Salt Electrochemistry Symposium (MoSES)", // pyro.byu.edu
        "EUCHEMSIL 2026: 30th EUCHEMS Meeting", // euchemsil2026.com
        "Thorium and Molten Salt Recognition: EUROMOST 2026 and...", // flibe.com
        "Molten International Symposium - Topics - SIPS 2026 by...", // flogen.org
        "Molten Salt Fuel Chemistry -- ANS / Conferences / 2026 ...", // ans.org
        "Home", // events.ornl.gov, honest-host fallback
        "Homepage", // batterysummit.solarenergyevents.com, honest-host fallback
        "European Conference Calls For Coordinated Action On Mo...", // nucnet.org
        "The Battery Show North America | Advanced Battery & EV...", // thebatteryshow.com
        "Solid-State Battery Summit 2026 | Quintus Technologies", // quintustechnologies.com
        "Meeting Summary-2026 International Round Table on Tita...", // tirt7.com
      ]) {
        expect(isJobListingContentTitle(title)).toBe(false);
      }
    });

    it("resolves all seven adversarial constructions in their stated direction", () => {
      // Fair vocabulary must rescue a title that also carries "job openings".
      expect(isJobListingContentTitle("IT Job Fair 2026 - 500+ Job Openings Available")).toBe(
        false,
      );
      // Bare "vacancies", no rescue — must drop.
      expect(isJobListingContentTitle("Vacancies List for Engineers")).toBe(true);
      // "careers fair" — must keep (never triggers either clause at all).
      expect(isJobListingContentTitle("Company Careers Fair 2026")).toBe(false);
      // A single posting's own vacancy notice — must drop.
      expect(isJobListingContentTitle("Job Vacancy: Battery Research Scientist")).toBe(true);
      // Repeated-jobs trigger, no rescue vocabulary — must drop.
      expect(isJobListingContentTitle("Jobs Jobs Jobs: How to Land Your Dream Role")).toBe(true);
      // Both "job fair" and "career expo" — must keep.
      expect(
        isJobListingContentTitle("International Job Fair and Career Expo 2026"),
      ).toBe(false);
      // "job" used as an idiom, no trigger phrase at all — must keep.
      expect(isJobListingContentTitle("A Job Well Done: Conference Recap")).toBe(false);
    });
  });

  // ROUND 34 C (Ruling 92b/93, A33-01): a fifth job-content shape falls
  // through all seven guards -- a company's own job-postings ARCHIVE/INDEX
  // page ("Job Postings Archive - Ion Exchange" @
  // ionexchangeglobal.com/job_posting/, witnessed 2 of 5 pulls, round 33 A).
  // One additive alternative on JOB_LISTING_CONTENT_RE, gated on an
  // index/archive-shaped tail word (archive/board/directory) so the bare
  // "job postings"/"job listings" phrase alone cannot fire -- a bare trigger
  // was measured and rejected in round 34 B's design turn because it would
  // wrongly drop a constructed fair title ("Job Postings Fair 2026") that
  // looksLikeEvent's own "job fair" alternative cannot rescue (it requires
  // the two words literally adjacent). Corpus below is round 34 B's §2.4-2.5
  // table, transcribed verbatim.
  describe("isJobListingContentTitle (Ruling 92b/93 — job postings/listings ARCHIVE pages)", () => {
    it("catches the A33-01 specimen and drops it at webResultToRawEventItem", () => {
      expect(isJobListingContentTitle("Job Postings Archive - Ion Exchange")).toBe(true);
      expect(
        webResultToRawEventItem(
          {
            title: "Job Postings Archive - Ion Exchange",
            url: "https://ionexchangeglobal.com/job_posting/",
          },
          Date.now(),
        ),
      ).toBeNull();
    });

    it("still catches round 33's four must-catch rows (regression)", () => {
      for (const title of [
        "Ion Exchange Mumbai Job Openings Check here",
        "Ion Exchange Jobs,Jobs for Ion Exchange, -:JobItUs",
        "Executive Jobs in All-India - 12,878 Executive Job Vacancies in All-India - Aug 2026",
        "Ion Exchange India Careers, Ion Exchange India Jobs, August 2026 Company Page - iimjobs.com",
      ]) {
        expect(isJobListingContentTitle(title)).toBe(true);
      }
    });

    it("keeps the candidate-1a adversarial construction (gated alternative must not trigger on a bare phrase)", () => {
      // No archive/board/directory tail word -- the new alternative must not
      // fire, and looksLikeEvent cannot rescue it anyway (EVENT_SIGNAL_RE's
      // "job fair" alternative requires the words adjacent; "Postings" sits
      // between them here).
      expect(isJobListingContentTitle("Job Postings Fair 2026")).toBe(false);
    });

    it("keeps Ruling 89b's four and this item's own three live-witnessed fairs (the seven fairs)", () => {
      for (const title of [
        "Nuclear Career Fair - S&T Women in Nuclear",
        "2026 Job Fair & Hiring Event Calendar - JobFairX",
        "Career Expo & Job Fair",
        "Nittany Lion Careers",
        "2026 MSE-NE Career Fair",
        "Clean Energy Job Fairs - RE+ Events",
        "Nuclear job fair",
      ]) {
        expect(isJobListingContentTitle(title)).toBe(false);
      }
    });

    it("still admits 'Event Archive' at an /events path through isEventHubResult (candidate 2's collateral case)", () => {
      // Locks today's behaviour -- the rejected path-based candidate would
      // have dropped this real single-event page; the shipped design does
      // not touch isEventHubResult at all.
      expect(isEventHubResult("Event Archive", "https://example.test/events")).toBe(false);
    });

    it("resolves round 34 B's §2.6 adversarial constructions", () => {
      // A university's own archive, same class as the specimen -- must drop.
      expect(
        isJobListingContentTitle("Job Postings Archive - Careers at State University"),
      ).toBe(true);
      // The sibling "job listings" shape -- must drop.
      expect(isJobListingContentTitle("Job Listings Board - Acme Corp")).toBe(true);
      // Both the new trigger and real event vocabulary -- safety net fires
      // regardless of which clause matched -- must keep.
      expect(
        isJobListingContentTitle("Job Postings Fair and Career Expo 2026"),
      ).toBe(false);
      // No "postings"/"listings" word at all -- out of scope, must keep.
      expect(isJobListingContentTitle("Company Job Board")).toBe(false);
      // Single posting, no archive/board/directory tail -- named residual,
      // out of scope, must keep.
      expect(
        isJobListingContentTitle("Postdoc Job Posting: Battery Research Scientist"),
      ).toBe(false);
    });
  });
});

// Live witness, 2026-08-19, Tier-2 event pool (LLM-generated queries — a
// population the Tier-0 censuses never drew): `en.wikipedia.org`'s
// "Topochemical polymerization" article rendered as an event card. The JOB
// surface already refuses this host class (`isNonJobHost`, Ruling 87a
// Component A); these lock the same refusal on the event surface.
describe("encyclopedia hosts are not events", () => {
  // `webResultToRawEventItem` takes the clock as its second argument; every
  // other describe block in this file declares its own. A fixed instant keeps
  // these cases deterministic — the rows below are refused on HOST, before any
  // date reasoning, so the value only has to be stable, not meaningful.
  const NOW = Date.parse("2026-08-19T00:00:00Z");

  it("lists wikipedia.org in DENY_HOSTS", () => {
    expect(DENY_HOSTS).toContain("wikipedia.org");
  });

  it("drops the witnessed en.wikipedia.org article at ingestion", () => {
    expect(
      webResultToRawEventItem({
        title: "Topochemical polymerization",
        url: "https://en.wikipedia.org/wiki/Topochemical_polymerization",
        snippet:
          "Topochemical polymerization is a solid-state reaction in which monomer molecules...",
      }, NOW),
    ).toBeNull();
  });

  it("drops other language subdomains through the same suffix match", () => {
    expect(
      webResultToRawEventItem({
        title: "Festkörperchemie Symposium",
        url: "https://de.wikipedia.org/wiki/Topochemische_Polymerisation",
        snippet: "Ein Symposium über Festkörperchemie.",
      }, NOW),
    ).toBeNull();
  });

  it("keeps a real conference whose host merely contains the word wiki", () => {
    // Suffix match, not substring: `wikiconferences.org` is not `wikipedia.org`.
    expect(
      webResultToRawEventItem({
        title: "Molten Salt Chemistry Conference 2026",
        url: "https://wikiconferences.org/events/molten-salt-2026",
        // The date must be FUTURE relative to NOW or the row leaves on expiry
        // and proves nothing about host matching — the first draft used March
        // 2026 against an August NOW and failed for that reason, not because
        // the host rule was wrong.
        snippet:
          "The Molten Salt Chemistry Conference 2026 will be held in Chicago on December 3-5, 2026. Registration is open.",
      }, NOW),
    ).not.toBeNull();
  });
});

// Phase 3 round 3 C, ITEM 2 (F2, Ruling 120g item 2): ported
// `isDateStructuredResearchPath` from the job surface (jobweb.ts:100-108) —
// see the doc comment above the function in eventweb.ts for the full design
// trace. Corpus per Phase 3 round 2 B, Deliverable 2 Part C / Deliverable 3
// Design 1, and the exact witness URLs recorded earlier in this file's own
// Phase 3 round 1 A log.
describe("isDateStructuredResearchPath (F2, Phase 3 round 3 — lab blog posts are not events)", () => {
  // A fixed instant well before every constructed date below, so the
  // must-keep/safety-net cases below survive on their own merits and are not
  // accidentally dropped by expiry — the same discipline the "encyclopedia
  // hosts" block above already uses for the identical reason.
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  describe("must-catch — both of B's live-verified witnesses", () => {
    it("drops the first foundry.lbl.gov witness (F2a)", () => {
      expect(
        webResultToRawEventItem({
          title:
            "Slowing Down to Speed Up: Unveiling the Secrets of Topochemical Polymerization",
          url: "https://foundry.lbl.gov/2025/07/11/slowing-down-to-speed-up/",
          snippet: "A Molecular Foundry researcher describes a new technique.",
        }, NOW),
      ).toBeNull();
    });

    it("drops the second foundry.lbl.gov witness (F2b)", () => {
      expect(
        webResultToRawEventItem({
          title:
            "Unlocking topochemical polymerization in single crystals, polycrystals, and solution aggregates",
          url: "https://foundry.lbl.gov/2025/04/27/unlocking-topochemical-polymerization-in-single-crystals-polycrystals-and-solution-aggregates/",
          snippet: "A Molecular Foundry news post summarizing recent published research.",
        }, NOW),
      ).toBeNull();
    });
  });

  // The safety net named in B's own design: a suspicious URL shape cannot
  // drop a title that itself states real event vocabulary — the exact
  // shape B's TOLERATES section names (a dated-blog-path URL announcing a
  // real, on-topic symposium).
  it("must-keep / safety net: rescues a real event announced at a dated-blog-shaped URL", () => {
    expect(
      webResultToRawEventItem({
        title: "Battery Symposium 2026 Registration Open",
        url: "https://example-lab.test/2026/03/15/battery-symposium-2026-registration-open",
        snippet:
          "Registration is now open for the Battery Symposium 2026, taking place March 15, 2026.",
      }, NOW),
    ).not.toBeNull();
  });

  // Must-keep control from B's own corpus (Deliverable 2 Part D; also this
  // file's "long-standing MoSES witness", Ruling 120b) — a real control with
  // NO dated-blog path at all, so the new guard must show zero interaction.
  it("keeps this file's own long-standing MoSES control, unaffected by the new guard", () => {
    expect(
      webResultToRawEventItem({
        title: "Molten Salt Electrochemistry Symposium (MoSES)",
        url: "https://pyro.byu.edu/moses",
        snippet:
          "The Molten Salt Electrochemistry Symposium (MoSES) takes place in October 2026.",
      }, NOW),
    ).not.toBeNull();
  });
});

// Phase 3 round 6 C, ITEM 1 (F11, Rulings 123b/123e(1)/123g item 1): B's
// bounded fix, verbatim — NEWS_MEDIA_HOSTS (its own sibling list, not
// appended to DENY_HOSTS) plus the unanchored event-report(s) path regex.
// Corpus per Phase 3 round 5 B, Deliverable 2 — must-catch witnesses and the
// full 13-URL must-keep corpus, executed with zero collisions.
describe("F11 — press-wire hosts + event-report(s) path (Phase 3 round 6 C, ITEM 1)", () => {
  // A fixed instant well before every future-dated snippet below, matching
  // this file's own standing discipline for these blocks.
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  it("lists both press-wire/trade-media hosts in their own sibling list (Ruling 123e(1))", () => {
    expect(NEWS_MEDIA_HOSTS).toContain("prnewswire.com");
    expect(NEWS_MEDIA_HOSTS).toContain("news.metal.com");
  });

  describe("must-catch — B's live-verified witnesses (Phase 3 round 5 B, Deliverable 2)", () => {
    // A's own record carried a TRUNCATED URL for this witness
    // (`.../cibf2026-opens-in-shenzhen-...`); B's own completion attempt
    // 404'd and did NOT fabricate the rest of the path — the host itself is
    // the signal, so this case only needs to sit on the real host, not
    // reproduce an unverifiable exact path.
    it("drops the prnewswire.com witness by host alone", () => {
      expect(
        webResultToRawEventItem({
          title: "CIBF2026 Opens in Shenzhen",
          url: "https://www.prnewswire.com/apac/news-releases/cibf2026-opens-in-shenzhen-representative-example.html",
          snippet:
            "CIBF2026, the world's largest battery industry event, has officially commenced in Shenzhen.",
        }, NOW),
      ).toBeNull();
    });

    it("drops the news.metal.com witness, re-fetched live by B", () => {
      expect(
        webResultToRawEventItem({
          title:
            "Chicago Summit Sets the Tone for SSB Race: Oxide Route Prevails, Sulfide‑Route Mass Production Delayed until 2030",
          url: "https://news.metal.com/en/newscontent/104058915-chicago-summit-sets-the-tone-for-ssb-race-oxide-route-prevails-sulfide-route-mass-production-delayed-until-2030",
          snippet:
            "Coverage of the 6th Annual Global Solid-State Battery Summit held in Chicago on August 11, 2026.",
        }, NOW),
      ).toBeNull();
    });

    it("drops the fz-juelich.de event-report(s) witness via the new path regex", () => {
      expect(
        webResultToRawEventItem({
          title: "ELECTRA.Battery Symposium 2026",
          url: "https://www.fz-juelich.de/en/iet/iet-1/news/event-reports/electra-battery-symposium-2026",
          snippet:
            "A retrospective report on the ELECTRA.Battery Symposium 2026, held May 11-13, 2026.",
        }, NOW),
      ).toBeNull();
    });

    it("isolates the path-regex signal: isNewsArticleTitle is true on the fz-juelich.de witness though its title alone carries no news tell", () => {
      // The witness title has NO news-vocabulary word anywhere — B measured
      // this: title vocabulary reaches zero of the four re-fetched
      // witnesses. This must be the URL-path clause firing, not NEWS_TITLE_RE
      // or either PR-headline regex.
      expect(
        isNewsArticleTitle(
          "ELECTRA.Battery Symposium 2026",
          "https://www.fz-juelich.de/en/iet/iet-1/news/event-reports/electra-battery-symposium-2026",
        ),
      ).toBe(true);
      // And confirm the anchored existing NEWS_HEADLINE_PATH_RE genuinely
      // could not have reached it (B's own proof point): the same title/url
      // pair with the new path regex's own host swapped for a host that
      // cannot fire it must fall back to false.
      expect(isNewsArticleTitle("ELECTRA.Battery Symposium 2026")).toBe(false);
    });
  });

  describe("must-keep — B's 13-URL corpus, zero collisions (Phase 3 round 5 B, Deliverable 2)", () => {
    // Recorded exactly as B's own corpus lists them (Deliverable 2's must-keep
    // paragraph) — the every-host check below reproduces isDeniedUrl's own
    // www-stripped suffix-match algorithm precisely, which is the actual
    // mechanism NEWS_MEDIA_HOSTS plugs into.
    const MUST_KEEP_HOSTS = [
      "pyro.byu.edu",
      "thebatteryshow.com",
      "web.cvent.com",
      "volta.foundation",
      "globalevents.fastmarkets.com",
      "recyclinginternational.com",
      "www.rsc.org",
      "engr.ncsu.edu",
      "advancedautobat.com",
      "events.ornl.gov",
      "battery-business-forum.com",
      "smelab.org",
      "bepassociation.eu",
    ];

    it.each(MUST_KEEP_HOSTS)(
      "host %s does not suffix-match either new NEWS_MEDIA_HOSTS entry",
      (rawHost) => {
        const host = rawHost.toLocaleLowerCase().replace(/^www\./, "");
        for (const denied of NEWS_MEDIA_HOSTS) {
          expect(host === denied || host.endsWith(`.${denied}`)).toBe(false);
        }
      },
    );

    // The two witnesses B named as the corpus's own decisive controls, run
    // end to end through the real, unmodified webResultToRawEventItem rather
    // than only through the mechanical host check above.
    it("keeps the events.ornl.gov honest-host-fallback control end to end — the exact case a bare org-domain host entry would have broken (Ruling 84b(1))", () => {
      expect(
        webResultToRawEventItem({
          title: "Home",
          url: "https://events.ornl.gov/",
          snippet:
            "Upcoming workshop: the Molten Salt Reactor Workshop, registration open, December 2026.",
        }, NOW),
      ).not.toBeNull();
    });

    it("keeps the battery-business-forum.com forum-contrast control end to end — a real Forum-named conference, not a discussion forum", () => {
      expect(
        webResultToRawEventItem({
          title: "Battery Business Forum 2026",
          url: "https://battery-business-forum.com/",
          snippet:
            "The Battery Business Forum 2026 conference brings together industry leaders. Registration open for December 2026.",
        }, NOW),
      ).not.toBeNull();
    });
  });
});

// Phase 3 round 6 C, ITEM 2 (Disposition 1's fired reopen threshold, Rulings
// 123c/123g item 2): `laquo` added to `HTML_ENTITIES` (`lib/text/clean.ts`).
// End-to-end recovery per Phase 3 round 5 B, Deliverable 3 — the live F13
// witness (`msrworkshop2023.ornl.gov/msr2022/index.html`, byte-confirmed
// undecoded `&laquo;`) run through the REAL, unmodified `pageTitleFromHtml`
// (title-only HTML, no og:title, matching this witness's confirmed-live
// shape) and then the REAL, unmodified `eventNameFrom` — no local parallel
// copy of the decode fix, unlike B's own throwaway harness, because the
// product code itself now carries the fix.
describe("laquo entity recovery, end to end (Phase 3 round 6 C, ITEM 2)", () => {
  it("decodes the live &laquo; witness through pageTitleFromHtml and recovers the event name through eventNameFrom", () => {
    const html =
      "<html><head><title>MSR2022 &laquo; Molten Salt Reactor Workshop</title></head><body></body></html>";
    const url = "https://msrworkshop2023.ornl.gov/msr2022/index.html";

    const decodedTitle = pageTitleFromHtml(html);
    // The entity must be GONE, decoded to the table's own dash-family
    // convention — not merely "no longer the literal 7-character sequence"
    // but a specific, asserted value.
    expect(decodedTitle).toBe("MSR2022 - Molten Salt Reactor Workshop");

    expect(eventNameFrom(decodedTitle!, "", url)).toBe(
      "Molten Salt Reactor Workshop",
    );
  });

  it("regression: mdash/ndash/minus still decode to a plain hyphen, unchanged", () => {
    // The table's existing dash-family contract must survive byte-unchanged
    // — this is an additive table entry, not a rewrite of the others.
    const html =
      "<html><head><title>INL 2026 &mdash; Battery Innovation Summit</title></head><body></body></html>";
    expect(pageTitleFromHtml(html)).toBe("INL 2026 - Battery Innovation Summit");
  });

  it("raquo is deliberately NOT decoded — unwitnessed this round, not added blind", () => {
    const html =
      "<html><head><title>MSR2022 &raquo; Molten Salt Reactor Workshop</title></head><body></body></html>";
    expect(pageTitleFromHtml(html)).toBe(
      "MSR2022 &raquo; Molten Salt Reactor Workshop",
    );
  });
});

// Phase 3 round 6 C, ITEM 4 (F10, Rulings 123f/123g item 4): `product-category`
// added to `COMMERCE_PATH_RE` — one measured token, same discipline as J2's
// identical fix to the job surface's sibling regex one round ago.
describe("COMMERCE_PATH_RE gains product-category (F10, Phase 3 round 6 C, ITEM 4)", () => {
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  it("must-catch: matches the exact dynalene.com witness path", () => {
    expect(
      COMMERCE_PATH_RE.test(
        "/product-category/heat-transfer-fluids/dynalene-molten-salts/",
      ),
    ).toBe(true);
  });

  it("must-catch, end to end: drops the dynalene.com witness via webResultToRawEventItem", () => {
    expect(
      webResultToRawEventItem({
        title: "Dynalene Molten Salts",
        url: "https://www.dynalene.com/product-category/heat-transfer-fluids/dynalene-molten-salts/",
        snippet:
          "Browse Dynalene's molten salt heat transfer fluid product lines, with downloadable technical data sheets.",
      }, NOW),
    ).toBeNull();
  });

  it("regression: the existing `product`/`products` alternatives are unchanged", () => {
    expect(COMMERCE_PATH_RE.test("/product/battery-charger")).toBe(true);
    expect(COMMERCE_PATH_RE.test("/products/battery-charger")).toBe(true);
    expect(COMMERCE_PATH_RE.test("/shop/battery-charger")).toBe(true);
  });

  it("must-keep: does not reach any of F11's own 13-URL must-keep corpus", () => {
    // Reuses F11's exact corpus (same describe block earlier in this file) —
    // none of these paths carries a commerce segment at all, so this is a
    // straightforward zero-collision check on the widened regex.
    const MUST_KEEP_PATHS = [
      "/moses",
      "/en/co-located-workshops.html",
      "/event/db0a52d9-68fa-4c07-9bee-f3903554b231/summary",
      "/event",
      "/",
      "/spec-battery-bootcamp",
      "/battery-young-researcher-award-applications-open-today/",
      "/us",
      "/events/find-an-event/iex-2026-technical-training-introductory-course-introduction-to-ion-exchange-design-and-operation",
    ];
    for (const path of MUST_KEEP_PATHS) {
      expect(COMMERCE_PATH_RE.test(path)).toBe(false);
    }
  });

  it("must-keep, adversarial cross-check: F12's permies.com forum thread path is unaffected", () => {
    expect(
      COMMERCE_PATH_RE.test("/t/26737/composting/Composting-alkaline-batteries"),
    ).toBe(false);
  });
});

// Phase 3 round 6 C, ITEM 5 (F12, Rulings 123f/123e(2)/123g item 5): the
// job surface's own already-safe `FORUM_THREAD_URL_RE` ported to the event
// surface as its OWN guard (Ruling 123e(2) — not an isDeniedUrl clause).
// `isForumThreadUrl` is module-private (not exported), matching this file's
// own `isDateStructuredResearchPath` precedent — tested only through the
// full, real `webResultToRawEventItem`, exactly as B's own blast-radius note
// says the job surface's identical regex is ("copied read-only for
// measurement, not exported").
describe("forum-thread URL port (F12, Phase 3 round 6 C, ITEM 5)", () => {
  const NOW = Date.parse("2026-01-01T00:00:00Z");

  it("must-catch: drops the permies.com numeric-thread-ID witness", () => {
    expect(
      webResultToRawEventItem({
        title: "Composting alkaline batteries (composting forum at permies)",
        url: "https://permies.com/t/26737/composting/Composting-alkaline-batteries",
        snippet:
          "An ongoing discussion forum thread about composting alkaline batteries.",
      }, NOW),
    ).toBeNull();
  });

  it("must-keep: F3's original non-numeric witness (batteries-forum.com/t/lithium) stays UNCAUGHT by this guard — not reopened, not widened", () => {
    // A representative reconstruction of F3's original round-1 witness (exact
    // historical title not recorded in this session's own research) — what
    // matters for this guard specifically is the non-numeric `/t/lithium`
    // slug shape, which B confirmed by direct execution still does not match
    // FORUM_THREAD_URL_RE. This row stays admitted (a real, still-open
    // defect, per Disposition 6's own unchanged non-numeric-slug
    // disposition), not because this item fixed it.
    expect(
      webResultToRawEventItem({
        title: "Lithium battery chemistry (forum thread)",
        url: "https://www.batteries-forum.com/t/lithium",
        snippet:
          "Discussion forum thread on lithium battery chemistry, ongoing through December 2026.",
      }, NOW),
    ).not.toBeNull();
  });

  it("must-keep: the battery-business-forum.com forum-contrast control (F11's own corpus) is unaffected — no /t/NNN/-shaped path at all", () => {
    expect(
      webResultToRawEventItem({
        title: "Battery Business Forum 2026",
        url: "https://battery-business-forum.com/",
        snippet:
          "The Battery Business Forum 2026 conference brings together industry leaders. Registration open for December 2026.",
      }, NOW),
    ).not.toBeNull();
  });

  it("must-keep: a genuine posting-id-shaped event URL with a numeric segment elsewhere in the path is unaffected", () => {
    // Adversarial: proves the guard is anchored to the /t/NNN/ shape
    // specifically, not "any numeric path segment".
    expect(
      webResultToRawEventItem({
        title: "Battery Innovation Summit 2026",
        url: "https://example-conference.test/events/2026/battery-innovation-summit",
        snippet:
          "The Battery Innovation Summit 2026 takes place in December 2026. Registration open.",
      }, NOW),
    ).not.toBeNull();
  });
});
