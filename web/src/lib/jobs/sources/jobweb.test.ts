import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// RULING 75 (round 28 C, item 0). Only `searchGemini` is stood in for; the
// provider-order helpers stay REAL.
const geminiSearchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/sources/gemini-search", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/sources/gemini-search")>()),
  searchGemini: geminiSearchMock,
}));

import {
  CAREERS_INDEX_TITLE_RE,
  isListingPage,
  JOB_PATH_RE,
  jobweb,
  LISTING_TITLE_RE,
  NON_JOB_PATH_RE,
  resolveSearchProvider,
  webResultToRawJobItem,
} from "./jobweb";
import {
  getCounterStore,
  resetCounterStoreForTests,
  forcedRebuildDayKey,
} from "@/lib/usage/counters";
import { FORCED_REBUILDS_PER_DAY } from "@/lib/usage/rebuild-breaker";
import {
  setUsageEventsClientForTests,
  type UsageEventRow,
} from "@/lib/usage/events";

describe("job aggregator listing pages", () => {
  it.each([
    "60 Molten Salt Jobs, Employment July 22, 2026 (9 New Openings)",
    "1,204 Battery Engineer Jobs, Employment",
    "25+ Postdoc Positions in Materials Science",
    "Browse Chemistry Jobs",
    "Latest Research Scientist Vacancies",
  ])("rejects aggregate listing title: %s", (title) => {
    expect(isListingPage(title, "indeed.com", "/jobs")).toBe(true);
  });

  it.each([
    "Molten Salt Electrochemistry Summer Internship",
    "Research Scientist, Solid-State Batteries",
    "Postdoctoral Researcher — Battery Materials",
  ])("keeps a real posting title: %s", (title) => {
    expect(isListingPage(title, "careers.inl.gov", "/job/12345")).toBe(false);
  });

  it("rejects an aggregator search URL even with a neutral title", () => {
    expect(
      isListingPage("Molten Salt", "indeed.com", "/jobs?q=molten+salt&l=Chicago"),
    ).toBe(true);
  });

  it("does not over-block an employer's own careers search landing page", () => {
    expect(
      isListingPage(
        "Research Engineer, Battery Systems",
        "careers.ford.com",
        "/search?q=battery",
      ),
    ).toBe(false);
  });

  it("filters the Indeed listing end to end", () => {
    expect(
      webResultToRawJobItem({
        title: "60 Molten Salt Jobs, Employment July 22, 2026 (9 New Openings)",
        url: "https://www.indeed.com/q-molten-salt-jobs.html",
        snippet: "Apply now to molten salt jobs. Research Scientist roles available.",
      }),
    ).toBeNull();
  });

  it("still accepts a genuine posting", () => {
    const item = webResultToRawJobItem({
      title: "Molten Salt Electrochemistry Summer Internship - INL Careers",
      url: "https://inl.jobs/careers/job/12345",
      snippet: "Internship in molten salt electrochemistry. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Molten Salt Electrochemistry Summer Internship");
  });
});

describe("careers index and aggregator category pages", () => {
  it.each(["CAREERS", "Careers", "Jobs", "Open Positions", "Join our team", "Vacancies"])(
    "rejects careers index title: %s",
    (title) => {
      expect(isListingPage(title, "acunextlab.org", "/careers")).toBe(true);
    },
  );

  it("rejects an aggregator category page with no posting id", () => {
    expect(
      isListingPage(
        "Internship Battery Research Scientist Jobs San Jose, CA",
        "ziprecruiter.com",
        "/Jobs/Internship-Battery-Research-Scientist/-in-San-Jose,CA",
      ),
    ).toBe(true);
  });

  it("keeps an aggregator posting that carries an id", () => {
    expect(
      isListingPage("Battery Research Scientist", "ziprecruiter.com", "/c/Acme/Job/Battery-Scientist/-in-San-Jose?jid=1234567"),
    ).toBe(false);
  });

  it("keeps a specific posting on an employer careers path", () => {
    expect(
      isListingPage("Internship Battery R&D", "hyetlithium.com", "/careers/internship-battery-research"),
    ).toBe(false);
  });
});

describe("company derivation", () => {
  // B4-03 (round 4): no test asserted `.company` anywhere in this file
  // before this round (grepped, zero hits) — this is the first coverage of
  // webResultToRawJobItem's company-picking logic at all.
  it("does not mistake an internship cohort/season segment for the company", () => {
    const item = webResultToRawJobItem({
      title: "Battery R&D Intern - Summer 2027 - Acme Corp",
      url: "https://acme.test/careers/job/9912",
      snippet: "Research internship in molten salt battery R&D. Apply now.",
    });
    expect(item?.company).toBe("Acme Corp");
  });

  // B6-03 (round 6): a rejected candidate must not become an unguarded host
  // fallback; absence is an honest employer value.
  it("leaves the company absent when only a season segment survives", () => {
    const item = webResultToRawJobItem({
      title: "Battery R&D Intern - Summer 2027",
      url: "https://acme.test/careers/job/9912",
      snippet: "Research internship in molten salt battery R&D. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  // B12-06 (round 12): openmc.discourse.group rendered the employer as
  // "Page 2" — round 12 A's worst single value of the round. Not a missing
  // pagination rule: a missing FAMILY MEMBER. The event side has had chrome
  // checks whose job is "this segment is site furniture, not a name" since
  // round 5, and its own word list even contains "page"; the employer slot had
  // no member of that family at all. Its six existing rejections all ask "is
  // this a known-bad KIND of name", never "is this navigation".
  describe("navigation chrome in the employer slot (B12-06)", () => {
    // All three plausible Discourse title shapes for a paginated thread. B
    // reproduced the observed value byte-for-byte on every one of them, and
    // recorded the reconstruction as a reconstruction; asserting all three is
    // what makes the fix independent of which shape the provider actually
    // sends.
    // RESTATED BY B14-01 (round 14, Ruling 43), NOT DELETED. This block used to
    // carry the real openmc forum URL. B14-01 drops that URL at
    // `isListingPage`, so `webResultToRawJobItem` now returns `null` and
    // `item?.company` would be `undefined` FOR THE WRONG REASON — the assertion
    // would keep PASSING while B12-06's pagination guard stopped being
    // exercised at all. B named this exact class: a test that goes green while
    // the guard it exercises becomes unreachable. The URL is repointed at a
    // non-forum posting so the pagination guard is genuinely tested again; the
    // openmc URL's new drop is asserted separately below.
    it.each([
      "Job vacancies looking for OpenMC skills - Page 2 - Users - OpenMC Discourse",
      "Job vacancies looking for OpenMC skills - Page 2 - OpenMC Discourse",
      "Job vacancies looking for OpenMC skills | Page 2 | OpenMC",
    ])("does not mistake a pagination label for the employer: %s", (title) => {
      const item = webResultToRawJobItem({
        title,
        url: "https://example.test/careers/job/9912?page=2",
        snippet: "Several groups are hiring for molten salt reactor work. Apply now.",
      });
      expect(item).not.toBeNull();
      expect(item?.company).not.toBe("Page 2");
    });

    // B14-01: the counterpart assertion. The real openmc forum thread URL no
    // longer produces an item at all, so no employer can be derived from it —
    // which is how Ruling 43's wrong value is closed. Kept next to B12-06's
    // block so the two contracts are read together rather than one silently
    // masking the other.
    it("drops the real openmc forum thread outright (B14-01) — no item, so no employer", () => {
      const item = webResultToRawJobItem({
        title: "Job vacancies looking for OpenMC skills - Page 2 - Announcements - OpenMC",
        url: "https://openmc.discourse.group/t/job-vacancies-looking-for-openmc-skills/1727?page=2",
        snippet: "Several groups are hiring for molten salt reactor work. Apply now.",
      });
      expect(item).toBeNull();
    });

    // The rest of the closed vocabulary, asserted on the guard's own shape so
    // each alternative is covered rather than assumed.
    // RESTATED BY B14-01 (round 14), NOT DELETED. The URL here was
    // `https://example.test/forum/t/thread/1?page=2` — a forum-thread shape,
    // which B14-01 now drops. The assertion would have kept PASSING with
    // `item` null and `item?.company` undefined for the wrong reason, so the
    // whole closed nav-chrome vocabulary would have stopped being checked
    // without a single red test. Repointed at a non-forum posting URL, plus an
    // explicit `not.toBeNull()` so this can never silently go vacuous again.
    it.each(["Page 2", "Page 12 of 40", "3 of 10", "Next", "Home", "Previous", "Back"])(
      "rejects the nav-chrome segment %s",
      (segment) => {
        const item = webResultToRawJobItem({
          title: `Battery Research Scientist - ${segment}`,
          url: "https://example.test/careers/job/9913?page=2",
          snippet: "Open position in battery R&D. Apply now.",
        });
        expect(item).not.toBeNull();
        expect(item?.company).toBeUndefined();
      },
    );

    // THE must-survive cases, and the reason the check is anchored to the whole
    // segment. Every one of these is a real company whose name BEGINS with a
    // word the guard rejects on its own. An unanchored check would delete all
    // four employers.
    it.each([
      "Home Depot",
      "Page Industries",
      "First Solar",
      "Next Energy Technologies",
      "Idaho National Laboratory",
      "Battery Ventures",
    ])("keeps the real employer %s", (company) => {
      const item = webResultToRawJobItem({
        title: `Battery Research Scientist - ${company}`,
        url: "https://example.test/careers/job/9912",
        snippet: "Open position in battery R&D. Apply now.",
      });
      expect(item?.company).toBe(company);
    });

    // Ruling 32 from the render side: absence, not a placeholder. Both the job
    // card and the feed tile guard on companyOrLab, so the employer line is
    // omitted entirely rather than showing anything rejected.
    // RESTATED BY B14-01 (round 14), NOT DELETED. Its subject is
    // `looksLikeNavChrome`, not the host, so repointing the URL preserves what
    // it actually tests. It used the openmc forum URL, which B14-01 now drops
    // before the employer chain runs; `expect(item).not.toBeNull()` would have
    // failed loudly. The contract asserted here — absence, not a placeholder —
    // is unchanged.
    it("leaves the employer absent when only nav chrome survives", () => {
      const item = webResultToRawJobItem({
        title: "Battery Research Scientist - Page 2",
        url: "https://example.test/careers/job/9912",
        snippet: "Open position in battery R&D. Apply now.",
      });
      expect(item).not.toBeNull();
      expect(item?.company).toBeUndefined();
    });
  });

  // B12-07 (round 12): the same widening, seen through the real entry point.
  // talents.vaia.com rendered "Talents by Vaia" as the employer — the job
  // board's own composed brand, sitting in the slot meant for who is hiring.
  describe("job board brand spanning two DNS labels (B12-07)", () => {
    it("does not mistake a two-label board brand for the employer", () => {
      const item = webResultToRawJobItem({
        title: "Postdoctoral Research Associate - Talents by Vaia",
        url: "https://talents.vaia.com/companies/savannah-river-national-laboratory/jobs/1234",
        snippet: "Postdoctoral position in molten salt chemistry. Apply now.",
      });
      expect(item?.company).toBeUndefined();
    });

    // THE must-survive: the SAME host, the SAME posting, with the provider's
    // other title variant — the one that names the real employer. B12-08
    // established the provider alternates between these two titles for this
    // one URL, so both have to behave correctly or the fix trades one wrong
    // value for another.
    it("keeps the real employer on that same host and posting", () => {
      const item = webResultToRawJobItem({
        title: "Postdoctoral Research Associate at Savannah River National Laboratory",
        url: "https://talents.vaia.com/companies/savannah-river-national-laboratory/jobs/1234",
        snippet: "Postdoctoral position in molten salt chemistry. Apply now.",
      });
      expect(item?.company).toBe("Savannah River National Laboratory");
    });
  });

  // B5-03 (round 5): all three of A's real jobs wrongly showed a job board's
  // own brand name or a bare location as the company. Neither shape is a
  // known job-board *domain*, so `KNOWN_JOB_BOARD_DOMAINS` never caught
  // either — both need their own guard.
  it("does not mistake a job board's own brand name for the company", () => {
    const item = webResultToRawJobItem({
      title: "Battery R&D Intern - GreenJobsBoard",
      url: "https://greenjobsboard.io/careers/job/9912",
      snippet: "Research internship in molten salt battery R&D. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  it("does not mistake a bare city/state location segment for the company", () => {
    const item = webResultToRawJobItem({
      title: "Battery R&D Intern - Cambridge, MA",
      url: "https://acme.test/careers/job/9913",
      snippet: "Research internship in molten salt battery R&D. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  // Confirms the new host-brand guard is one-directional, per its own
  // comment in shared.ts: a real company's display name legitimately shares
  // a root with its own domain (the domain label is a short PREFIX of a
  // longer, real name) and must not be rejected the same way a job board's
  // own, longer-or-equal brand is.
  it("keeps a real company name that merely shares a root with its own domain", () => {
    const item = webResultToRawJobItem({
      title: "Battery R&D Intern - Acme Materials Group",
      url: "https://acme.test/careers/job/9914",
      snippet: "Research internship in molten salt battery R&D. Apply now.",
    });
    expect(item?.company).toBe("Acme Materials Group");
  });

  // B6-04 (round 6): title-based employer evidence must use the same guarded
  // candidate pool and take precedence over a trailing job-board label.
  it("extracts an employer stated after 'at' without a punctuation separator", () => {
    const item = webResultToRawJobItem({
      title: "Battery Engineering Internship at Tesla",
      url: "https://ev.careers/jobs/9915",
      snippet: "Battery research internship. Apply now.",
    });
    expect(item?.company).toBe("Tesla");
  });

  it("does not treat a lowercase phrase after 'at' as an employer", () => {
    const item = webResultToRawJobItem({
      title: "Battery Researcher based at our campus",
      url: "https://acme.test/careers/job/9916",
      snippet: "Battery research position. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  it("prefers a title-stated employer over a trailing job-board brand", () => {
    const item = webResultToRawJobItem({
      title: "Battery Engineering Internship at Tesla | EV.Careers",
      url: "https://ev.careers/jobs/9917",
      snippet: "Battery research internship. Apply now.",
    });
    expect(item?.company).toBe("Tesla");
  });

  // B8-01 (round 8): the pre-fix character class had no space, so it could
  // only ever match a one-word employer. Round 6's own regression test used
  // "at Tesla" - one word - so the bug shipped undetected for two rounds
  // (Ruling 31). This is the hardest shape for that bug specifically: a
  // real, multi-word research employer, immediately followed by a trailing
  // " - Brand" segment the multi-word match must win against. Mirrors the
  // live example B8-01 traced ("... at Savannah River National Laboratory
  // - Vaia" wrongly producing "Vaia").
  it("extracts a multi-word employer stated after 'at', preferring it over a trailing brand", () => {
    const item = webResultToRawJobItem({
      title: "Postdoctoral Researcher at Idaho National Laboratory - LabCareers",
      url: "https://labcareers.test/jobs/9918",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBe("Idaho National Laboratory");
  });

  // B8-01: the punctuated hardest-case. A real employer name legitimately
  // carries internal punctuation (comma, period) that the character class
  // already allowed pre-fix; this confirms the multi-word widening did not
  // disturb that and still stops at the trailing separator, not inside the
  // punctuated name.
  it("extracts a punctuated multi-word employer (comma and abbreviation) stated after 'at'", () => {
    const item = webResultToRawJobItem({
      title: "Research Fellow at Alphabet, Inc. - Remote",
      url: "https://alphabet.test/careers/job/9919",
      snippet: "Research fellowship. Apply now.",
    });
    expect(item?.company).toBe("Alphabet, Inc.");
  });

  // B8-01: the "should match nothing" hardest case, and the one that is
  // easiest to get wrong when "fixing" this bug. A title with a multi-word
  // employer but NO trailing punctuation at all - just ordinary lowercase
  // prose running on after it - has no honest boundary between the employer
  // name and the rest of the sentence. The naive fix (widen the character
  // class to include a bare space) was tried first and failed this exact
  // case: it captured "Bell Labs remote position with great benefits" as
  // the employer, trading a silent absence for wrong data. The shipped fix
  // requires each additional word to be Title-Case or a small closed
  // connector ("of"/"and"/"for"/"the"/"&"), so it cannot extend past "Bell
  // Labs", and with no separator or end-of-string to close on, the whole
  // match correctly fails rather than guessing.
  it("does not swallow unpunctuated trailing prose into a multi-word employer", () => {
    const item = webResultToRawJobItem({
      title: "Postdoc at Bell Labs remote position with great benefits",
      url: "https://belllabs.test/careers/job/9920",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  // B9-02a (round 9): inl.referrals.selectminds.com's live repro. The real
  // employer name clears every guard above cleanly (it is not a job board,
  // season label, bare location, or host-brand collision) but still carries
  // a careers-page suffix nothing stripped before this fix. Multi-word
  // hardest case per Ruling 31, matching the live shape B traced.
  it("strips a trailing careers-page suffix from an otherwise-real multi-word employer", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist - Idaho National Laboratory Careers",
      url: "https://inl.referrals.selectminds.com/jobs/12345",
      snippet: "Battery research position. Apply now.",
    });
    expect(item?.company).toBe("Idaho National Laboratory");
  });

  // B9-02a: the punctuated hardest case. The strip must remove only the
  // trailing chrome word, not the punctuation that legitimately belongs to
  // the real employer name sitting in front of it.
  it("strips trailing careers-page chrome without disturbing punctuation inside the real name", () => {
    const item = webResultToRawJobItem({
      title: "Research Fellow - Alphabet, Inc. Careers",
      url: "https://alphabet.test/careers/job/9921",
      snippet: "Research fellowship. Apply now.",
    });
    expect(item?.company).toBe("Alphabet, Inc.");
  });

  // B9-02a: the "should match nothing" hardest case, and the one this fix
  // is most likely to get wrong. A real, longer employer name that happens
  // to end in an ordinary word must survive untouched - only the closed
  // careers/jobs/employment vocabulary strips, never a general "trailing
  // capitalised word" rule that would eat a name like this one.
  it("does not strip a real trailing word that is not careers-page chrome", () => {
    const item = webResultToRawJobItem({
      title: "Research Fellow - State University Board of Regents",
      url: "https://stateu.test/careers/job/9922",
      snippet: "Research fellowship. Apply now.",
    });
    expect(item?.company).toBe("State University Board of Regents");
  });
});

describe("company derivation — hosting-platform boilerplate phrase (B10-01, item 2)", () => {
  // B10-01's live repro (postdocjobs.com): `looksLikeHostBrand` never
  // rejects this — it is deliberately one-directional and only rejects a
  // candidate no LONGER than a host DNS label, and "Job posted on
  // PostdocJobs.com" is far longer than "postdocjobs". This is the
  // must-now-reject case the new check exists for.
  it("does not mistake a hosting-platform's own posting boilerplate for the company", () => {
    const item = webResultToRawJobItem({
      title: "Postdoctoral Fellow | Job posted on PostdocJobs.com",
      url: "https://postdocjobs.com/job/999003",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  // Same shape, a different closed phrase from the same list.
  it.each([
    "Posted by PostdocJobs.com",
    "Listing on PostdocJobs.com",
    "See more jobs at PostdocJobs.com",
  ])("rejects another hosting-platform boilerplate phrasing: %s", (phrase) => {
    const item = webResultToRawJobItem({
      title: `Postdoctoral Fellow | ${phrase}`,
      url: "https://postdocjobs.com/job/999004",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });

  // Must-survive: a real, non-boilerplate-shaped multi-word employer name
  // must be completely unaffected by this new check (INL's own real name,
  // already covered above, re-asserted here as the cross-check that this
  // item's addition did not narrow it).
  it("keeps a real multi-word employer name that is not boilerplate-shaped", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist - Idaho National Laboratory Careers",
      url: "https://inl.referrals.selectminds.com/jobs/12346",
      snippet: "Battery research position. Apply now.",
    });
    expect(item?.company).toBe("Idaho National Laboratory");
  });

  // Must-not-overreach (item 1 stays open, on purpose): "University of
  // Pennsylvania" is a real, grammatical organisation name, not shaped like
  // "Job posted on X"/"Posted by X"/etc. This check must NOT fire on it —
  // item 1's harder "real name, wrong institution" residual is a flagged
  // POLICY question (§1 MANAGER CARRY-FORWARD), not something this closed
  // phrase check may silently absorb.
  it("does not fire on a real organisation name merely because it is long (item 1 stays open)", () => {
    const item = webResultToRawJobItem({
      title: "Postdoctoral Researcher - University of Pennsylvania",
      url: "https://careerservices.upenn.edu/job/12347",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBe("University of Pennsylvania");
  });
});

describe("company derivation with the profile's own topics (B9-02b/c)", () => {
  const topics = ["molten salt", "battery"];

  // B9-02b: postdocjobs.com's live repro. Multi-word hardest case per
  // Ruling 31 - the topic followed by a multi-word academic-field
  // continuation ("Chemical and Electrochemical Engineering").
  it("does not mistake a topic-prefixed research-field label for the company (postdocjobs.com shape)", () => {
    const item = webResultToRawJobItem(
      {
        title: "Postdoctoral Fellow - Molten Salt Chemical and Electrochemical Engineering",
        url: "https://postdocjobs.com/job/999001",
        snippet: "Postdoctoral research position. Apply now.",
      },
      topics,
    );
    expect(item?.company).toBeUndefined();
  });

  // B9-02c: careerservices.upenn.edu's live repro, unchanged across two
  // rounds before this fix - the simpler of the two live shapes, the topic
  // followed by a single field noun.
  it("does not mistake a topic-prefixed research-field label for the company (careerservices.upenn.edu shape)", () => {
    const item = webResultToRawJobItem(
      {
        title: "Research Associate - Molten Salt Characterization",
        url: "https://careerservices.upenn.edu/jobs/12345",
        snippet: "Research position in molten salt characterization. Apply now.",
      },
      topics,
    );
    expect(item?.company).toBeUndefined();
  });

  // The "should match nothing" hardest case, named explicitly in B's own
  // guide: a real employer name that happens to share a word with a search
  // topic must survive. The topic is not a PREFIX of this candidate (it
  // sits in the middle), and "Technologies" is not in the closed
  // field-vocabulary list either - two independent reasons it survives.
  it("does not reject a real employer name that merely shares a word with a topic", () => {
    const item = webResultToRawJobItem(
      {
        title: "Battery R&D Intern - Acme Molten Salt Technologies",
        url: "https://acme.test/careers/job/9930",
        snippet: "Research internship in molten salt battery R&D. Apply now.",
      },
      topics,
    );
    expect(item?.company).toBe("Acme Molten Salt Technologies");
  });

  // The other "must survive" case B named: a multi-word employer sharing no
  // words with any topic at all is trivially unaffected.
  it("does not reject a multi-word employer name sharing no words with any topic", () => {
    const item = webResultToRawJobItem(
      {
        title: "Battery R&D Intern - Idaho National Laboratory",
        url: "https://inl.jobs/careers/job/9931",
        snippet: "Research internship in molten salt battery R&D. Apply now.",
      },
      topics,
    );
    expect(item?.company).toBe("Idaho National Laboratory");
  });

  // Additive and optional, per this loop's own standing contract: the
  // identical postdocjobs.com-shaped candidate above, with NO topics
  // supplied at all, must reproduce exactly today's pre-fix behaviour -
  // proving the new guard cannot fire unless a caller opts in.
  it("does not apply the topic-label guard when no topics are supplied", () => {
    const item = webResultToRawJobItem({
      title: "Postdoctoral Fellow - Molten Salt Chemical and Electrochemical Engineering",
      url: "https://postdocjobs.com/job/999001",
      snippet: "Postdoctoral research position. Apply now.",
    });
    expect(item?.company).toBe("Molten Salt Chemical and Electrochemical Engineering");
  });
});

describe("listing titles hidden behind site chrome", () => {
  it("rejects a careers index whose label is only the first title segment", () => {
    expect(
      webResultToRawJobItem({
        title: "CAREER | Acme Materials",
        url: "https://acme.test/careers",
        snippet: "Research scientist openings. Apply now.",
      }),
    ).toBeNull();
  });

  it("keeps a real role that carries site chrome", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist | Acme Materials",
      url: "https://acme.test/careers/job/9912",
      snippet: "Open position in battery R&D. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Battery Research Scientist");
  });
});

// B13-01 Gap A (round 13): a BARE careers-section label reached the employer
// slot. `CAREERS_INDEX_TITLE_RE` — the closed, anchored list that names exactly
// this class — is defined in the same source file and was applied only to the
// whole title and to `roleTitle`, never to an employer candidate.
//
// EVIDENCE CLASS: this gap is LATENT, not live. Round 13 A's census contains no
// `Careers` employer render; B found it by executing the chain against
// breadcrumb shapes. Recorded here so no later round logs it as a
// live-confirmed defect.
//
// GAP B (`Announcements` on openmc.discourse.group) IS NOT FIXED and must not
// be — Ruling 42a defers it to Ruling 39c's forum-thread drop. There is no
// assertion for it here, deliberately.
describe("careers-section label in the employer slot (B13-01 Gap A)", () => {
  it.each(["Careers", "Jobs", "Vacancies", "Employment", "Open Positions", "Join our team"])(
    "does not mistake the bare section label %s for the employer",
    (label) => {
      const item = webResultToRawJobItem({
        title: `Battery Research Scientist - ${label} - Idaho National Laboratory`,
        url: "https://inl.test/careers/job/9940",
        snippet: "Open position in battery R&D. Apply now.",
      });
      expect(item?.company).toBe("Idaho National Laboratory");
    },
  );

  it("omits the employer when the section label is the only candidate", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist - Careers",
      url: "https://inl.test/careers/job/9941",
      snippet: "Open position in battery R&D. Apply now.",
    });
    expect(item).not.toBeNull();
    // Ruling 32 from the render side, and B13-01 corrected B12-06's count:
    // FOUR render sites omit the employer line rather than substituting
    // anything — job-card.tsx:87 and feed-tile.tsx:535 guard on
    // `companyOrLab`; briefing-hero.tsx:133 and briefing-quick-hit.tsx:49
    // `.filter(Boolean).join(" · ")`, so the separator goes with the value.
    expect(item?.company).toBeUndefined();
  });

  // MUST-KEEP, AND THE REASON THE REGEX'S WHOLE-SEGMENT ANCHOR IS LOAD-BEARING.
  // Every one of these is a real company whose name CONTAINS a word the list
  // rejects on its own. An unanchored version would delete all of them.
  it.each([
    "Home Depot",
    "Page Industries",
    "First Solar",
    "Next Energy Technologies",
    "Careers Australia Group",
    "Open Society Foundations",
  ])("keeps the real employer %s through the new clause", (company) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Scientist - ${company}`,
      url: "https://example.test/careers/job/9942",
      snippet: "Open position in battery R&D. Apply now.",
    });
    expect(item?.company).toBe(company);
  });

  // The `at`-captured employer path reaches the same veto chain, so the guard
  // must hold there too rather than only on punctuation segments.
  it("does not accept a section label captured after 'at'", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist at Careers",
      url: "https://example.test/careers/job/9943",
      snippet: "Open position in battery R&D. Apply now.",
    });
    expect(item?.company).toBeUndefined();
  });
});

// B13-02 (round 13): four items in round 13 A's live pool were not job
// postings at all. NONE of isListingPage's five existing checks fired on ANY
// of them — verified by execution before the design, not assumed. They are
// THREE distinct holes in that one function, and each addition below carries
// exactly one of A's instances, with no overlap.
//
// WHAT RENDERS WHEN ONE OF THESE IS DROPPED: NOTHING. isListingPage returning
// true makes webResultToRawJobItem return null; both search functions filter
// nulls before returning; the item never reaches dedup, scoring, the mapper or
// any card. There is no placeholder, no substitution and no backfill —
// buildDailyJobPool ends with a `.slice()` CAP, never a top-up. The pool
// simply shrinks (4 of 20 items on round 13's sample, ~20%). That is the fix
// working, not the pipeline degrading: those four occupied slots a real
// posting could have had.
describe("non-posting pool items (B13-02)", () => {
  describe("hole 1 — a count with a thousands separator", () => {
    // A's live instance: linkedin.com/jobs/molten-salt-jobs rendered this as
    // its role title. `1000+ …` fired today; ONE COMMA defeated the whole
    // alternative.
    it("rejects a live thousands-separated aggregate count", () => {
      expect(
        isListingPage(
          "1,000+ Molten Salt jobs in United States",
          "linkedin.com",
          "/jobs/molten-salt-jobs",
        ),
      ).toBe(true);
    });

    it("rejects a five-digit thousands-separated count", () => {
      expect(
        isListingPage(
          "10,000 Battery Engineer positions in Germany",
          "example.test",
          "/jobs",
        ),
      ).toBe(true);
    });

    // REGRESSION LOCK on the alternation shape. These three are the cases B's
    // own first draft (`\d{1,3}(?:,\d{3})*`) silently lost — with the comma
    // group optional, `\d{1,3}` can never consume a 4- or 5-digit run. If a
    // later round "tidies" the regex into a single group, these fail.
    it.each([
      "1000+ Molten Salt jobs in United States",
      "12345 vacancies",
      "999 Battery Openings",
    ])("still rejects the plain-number count form: %s", (title) => {
      expect(isListingPage(title, "example.test", "/jobs")).toBe(true);
    });
  });

  describe("hole 2 — a syndication endpoint is never one posting", () => {
    // A's live instance: an author RSS feed ingested as a job, whose role
    // title rendered as the bare host slug `lco-cdo`.
    it("rejects a live author RSS feed URL", () => {
      expect(
        isListingPage("lco-cdo", "lco-cdo.org", "/en/author/lco_admin/feed/"),
      ).toBe(true);
    });

    it.each([
      "/blog/feed",
      "/rss/",
      "/news/atom",
      "/updates.rss",
      "/index.xml",
      "/news/?feed=rss2",
    ])("rejects the syndication endpoint %s", (pathAndQuery) => {
      expect(
        isListingPage("Battery Research Scientist", "example.test", pathAndQuery),
      ).toBe(true);
    });

    // MUST-KEEP: real-shaped posting slugs that merely CONTAIN a feed token as
    // a substring. This is why the check is anchored to whole path segments —
    // an unanchored version deletes all four of these real postings.
    it.each([
      "/jobs/feedstock-process-engineer",
      "/careers/rss-platform-engineer",
      "/jobs/atomic-layer-deposition-scientist",
      "/jobs/feeder-line-technician",
    ])("keeps a real posting whose slug contains a feed token: %s", (pathAndQuery) => {
      expect(
        isListingPage("Battery Research Scientist", "example.test", pathAndQuery),
      ).toBe(false);
    });
  });

  describe("hole 3 — a title that names a section, not a role", () => {
    // A's two live instances: two views of one board's listing page.
    it.each([
      ["Intern Jobs at Battery Ventures Companies", "/jobs?jobTypes=Intern"],
      ["Jobs at Battery Ventures Companies", "/jobs?jobTypes="],
    ])("rejects the live board listing view: %s", (title, pathAndQuery) => {
      expect(isListingPage(title, "jobs.battery.com", pathAndQuery)).toBe(true);
    });

    it.each([
      "Vacancies at CERN",
      "Careers with Acme Materials",
      "Openings in Materials Science",
    ])("rejects the section-title form: %s", (title) => {
      expect(isListingPage(title, "example.test", "/jobs")).toBe(true);
    });

    // MUST-KEEP, AND THE REASON `for` IS NOT IN THE PREPOSITION LIST. B's
    // first draft included it and these three real role titles were destroyed
    // — 3 of 15. Do not add `for` back.
    it.each([
      "Jobs for Veterans Program Manager",
      "Job for a Battery Engineer",
      "Career for Life Coordinator",
    ])("keeps a real role title using the preposition 'for': %s", (title) => {
      expect(isListingPage(title, "example.test", "/careers/role")).toBe(false);
    });

    // MUST-KEEP traps: a role that BEGINS with `Jobs` (the preposition must
    // follow the section word immediately), and `positions`, deliberately
    // absent from the section-word list because real postings use it.
    it.each([
      "Jobs Data Analyst at the Bureau of Labor Statistics",
      "Research positions at CERN",
      "Career Development Scientist at Acme",
    ])("keeps the real posting title: %s", (title) => {
      expect(isListingPage(title, "example.test", "/careers/role")).toBe(false);
    });
  });

  // RESTATED BY B14-01 (round 14), NOT DELETED. This assertion was written by
  // round 13 C to catch exactly a change that took Ruling 39c's DEFERRED drop
  // without a ruling — its comment said "if a future change makes this fail,
  // that change is taking a deferred decision without a ruling."
  //
  // RULING 43 IS THAT RULING. It authorises and requires the drop, and the
  // manager's round-14 verification of Agent B endorsed the URL-route
  // instrument specifically. So the contract inverts: the openmc forum thread
  // must now be dropped, and the test that guarded the old contract states the
  // new one instead of being removed.
  it("drops the openmc forum thread — Ruling 43 authorises it, B14-01 implements it", () => {
    expect(
      isListingPage(
        "Job vacancies looking for OpenMC skills - Page 2 - OpenMC Discourse",
        "openmc.discourse.group",
        "/t/job-vacancies/1234?page=2",
      ),
    ).toBe(true);
  });

  // Eleven live-confirmed real postings from round 13 A's own census must all
  // still survive all three additions.
  it.each([
    ["Postdoctoral Research Associate - Talents by Vaia", "talents.vaia.com", "/companies/savannah-river-national-laboratory/jobs/1234"],
    ["Project and Website Coordinator", "lco-cdo.org", "/en/jobs/project-and-website-coordinator/"],
    ["2027 Summer Investment Internship", "employbl.com", "/jobs/2027-summer-investment-internship-battery-ventures-1410243"],
    ["Battery Research Scientist", "careers.inl.gov", "/job/12345"],
    ["Internship Battery R&D", "hyetlithium.com", "/careers/internship-battery-research"],
  ])("keeps the live posting %s", (title, host, pathAndQuery) => {
    expect(isListingPage(title, host, pathAndQuery)).toBe(false);
  });

  // B14-01 (round 14, Ruling 43): the forum-thread route rule, asserted as B's
  // own 58-case adversarial matrix — 15 must-drop and 43 must-keep. B scored
  // the recommended design 57/58: every must-keep survives with ZERO false
  // fires, and 14 of the 15 must-drops are caught. The fifteenth is the
  // deliberate named miss asserted at the bottom of this block.
  //
  // Every case here uses a TITLE THAT IS NOT ITSELF A LISTING TITLE, so a pass
  // can only come from the URL rule — otherwise a must-drop could go green on
  // `LISTING_TITLE_RE` and this block would prove nothing about B14-01.
  describe("forum threads are not postings (B14-01, Ruling 43)", () => {
    // THE 14 CAUGHT MUST-DROPS. Three forum-software routing conventions:
    // Discourse `/t/[<slug>/]<id>[/<post>]`, the phpBB/vBulletin script
    // filenames, and XenForo's `/threads/<slug>.<id>`.
    it.each([
      // Discourse — the live shape and its recorded siblings
      ["live openmc thread", "openmc.discourse.group", "/t/job-vacancies-looking-for-openmc-skills/1727?page=2"],
      ["openmc page-1 shape", "openmc.discourse.group", "/t/job-vacancies-looking-for-openmc-skills/1727"],
      ["the shipped suite's openmc URL", "openmc.discourse.group", "/t/job-vacancies/1234?page=2"],
      ["a bare topic id", "openmc.discourse.group", "/t/1727"],
      ["a post permalink", "openmc.discourse.group", "/t/job-vacancies-looking-for-openmc-skills/1727/14"],
      ["a trailing-slash form", "openmc.discourse.group", "/t/job-vacancies/1234/"],
      // Discourse is a PLATFORM, not a site — a host list would not have closed
      // this item. These two are the concrete reason.
      ["another Discourse host", "discuss.example.org", "/t/hiring-postdocs/8891"],
      ["a SUBFOLDER Discourse install", "example.test", "/community/t/hiring-postdocs/8891"],
      // phpBB / vBulletin — literal script filenames
      ["phpBB viewtopic.php", "forum.example.test", "/viewtopic.php?t=1234"],
      ["phpBB viewforum.php", "forum.example.test", "/viewforum.php?f=12"],
      ["vBulletin showthread.php", "forum.example.test", "/showthread.php?t=1234"],
      ["vBulletin forumdisplay.php", "forum.example.test", "/forumdisplay.php?f=12"],
      // XenForo — the `.` + id suffix is REQUIRED, never the bare word
      ["XenForo /threads/<slug>.<id>", "forum.example.test", "/threads/hiring-battery-postdocs.8891/"],
      // This suite's own idea of a forum thread URL. It is the reason the
      // Discourse alternative is NOT anchored to `^/t/` — that draft scored
      // 55/58 because it missed this and subfolder installs.
      ["this suite's own forum URL", "example.test", "/forum/t/thread/1?page=2"],
    ])("drops %s", (_label, host, pathAndQuery) => {
      expect(isListingPage("Battery Research Scientist", host, pathAndQuery)).toBe(true);
    });

    // THE 43 MUST-KEEPS — 20 real postings from A's censuses (rounds 11–14) and
    // this suite, then 23 adversarial shapes B wrote to break its own draft.
    // ZERO false fires is the property that matters here: a guard's false fire
    // leaves a field empty, but a DROP's false fire destroys a whole real
    // posting. That asymmetry is why the design gave up a matrix point.
    it.each([
      // --- 20 real postings ---
      ["talents.vaia.com", "talents.vaia.com", "/companies/savannah-river-national-laboratory/jobs/1234"],
      ["lco-cdo.org coordinator posting", "lco-cdo.org", "/en/jobs/project-and-website-coordinator/"],
      ["employbl.com", "employbl.com", "/jobs/2027-summer-investment-internship-battery-ventures-1410243"],
      ["careers.inl.gov", "careers.inl.gov", "/job/12345"],
      // isListingPage's own doc-comment must-keep — a real posting with NO id.
      ["hyetlithium.com", "hyetlithium.com", "/careers/internship-battery-research"],
      ["inl.referrals.selectminds.com", "inl.referrals.selectminds.com", "/jobs/12345"],
      ["careerservices.upenn.edu", "careerservices.upenn.edu", "/job/12347"],
      ["postdocjobs.com", "postdocjobs.com", "/job/999003"],
      ["ev.careers", "ev.careers", "/jobs/battery-cell-engineer-1234"],
      ["careers.gevernova.com", "careers.gevernova.com", "/global/en/job/GEVEGLOBAL12345/Battery-Engineer"],
      ["grad.wisc.edu", "grad.wisc.edu", "/funding/graduate-assistantship-battery-research/"],
      ["a linkedin.com deep posting", "linkedin.com", "/jobs/view/battery-research-scientist-at-acme-4123456789"],
      ["terra.do", "terra.do", "/climate-jobs/battery-systems-engineer/"],
      ["mykelly.com", "mykelly.com", "/job/battery-lab-technician-1234567/"],
      // Round 14 A's part-2 Finding 4 observation. B14-01 does not touch it —
      // it is an internships index, not a forum thread, and closing it (if it
      // is ever ruled a defect) is a different item.
      ["lco.global/about/interns", "lco.global", "/about/interns"],
      ["jobs.lbl.gov", "jobs.lbl.gov", "/jobs/battery-materials-postdoc-1234"],
      ["jobs.ac.uk", "jobs.ac.uk", "/job/DKL123/postdoctoral-research-associate-in-battery-science"],
      ["a Greenhouse board deep link", "boards.greenhouse.io", "/acmebattery/jobs/4123456"],
      ["this suite's ziprecruiter deep link", "ziprecruiter.com", "/c/Acme/Job/Battery-Scientist/-in-San-Jose?jid=1234567"],
      ["careers.inl.gov, second posting", "careers.inl.gov", "/job/12346"],
      // --- 23 adversarial shapes: forum tokens as ordinary slug substrings ---
      // These 8 are the naive token-only draft's false fires. That draft scored
      // 46/58 and destroyed real postings; do not simplify the rule back to it.
      ["threading-machine-operator", "example.test", "/jobs/threading-machine-operator"],
      ["topical-drug-formulation-scientist", "example.test", "/jobs/topical-drug-formulation-scientist"],
      ["discourse-analysis-researcher", "example.test", "/careers/discourse-analysis-researcher"],
      ["viewtopic-ux-designer", "example.test", "/careers/viewtopic-ux-designer"],
      ["t-shirt-designer", "example.test", "/t-shirt-designer/jobs/1234"],
      ["threads-of-innovation", "example.test", "/threads-of-innovation/careers/1234"],
      ["forum/careers", "example.test", "/forum/careers/battery-scientist"],
      ["topics/battery", "example.test", "/topics/battery/jobs/1234"],
      // These prove the CONFIRMING STRUCTURAL TOKEN requirement: a `/t/`
      // segment with no id, digits with no segment boundary, a dot with no id,
      // and a `.php` that is not one of the four forum scripts.
      ["a /t/ segment with NO id", "example.test", "/t/battery-research-scientist"],
      ["digits with no segment boundary", "example.test", "/t/2026-battery-intern"],
      ["a dot with no id", "example.test", "/threads/hiring.today"],
      ["a .php that is not a forum script", "example.test", "/careers/apply.php?id=1234"],
      ["another non-forum .php", "example.test", "/jobs/viewjob.php?id=99"],
      ["/topic/ with a non-id slug", "example.test", "/topic/battery-research/jobs/1234"],
      ["bare /threads/ with no id", "example.test", "/threads/battery-careers"],
      ["bare /thread/ singular", "example.test", "/thread/battery-jobs"],
      ["/topics/ with no id", "example.test", "/forums/topics/battery"],
      ["a /t segment at the end with no id", "example.test", "/careers/t"],
      ["a /t/ segment naming a team", "example.test", "/about/t/team"],
      ["threadneedle in a slug", "example.test", "/jobs/threadneedle-street-analyst"],
      ["showthread in a slug", "example.test", "/careers/showthread-content-strategist"],
      ["forumdisplay in a slug", "example.test", "/careers/forumdisplay-engineer"],
      ["a numeric team path", "example.test", "/team/1234/battery-scientist"],
    ])("keeps %s", (_label, host, pathAndQuery) => {
      expect(isListingPage("Battery Research Scientist", host, pathAndQuery)).toBe(false);
    });

    // THE FIFTEENTH MUST-DROP, DELIBERATELY MISSED. Adding NodeBB/Invision's
    // `/topic/<id>` scores 58/58 instead of 57/58 and is still wrong: its
    // true-fire shape and its false-fire shapes are BOTH `/topic/<digits>-<slug>`
    // and no structural test separates them — a four-digit year is a four-digit
    // id, so raising the digit floor does not help. The two false-fire shapes
    // are asserted underneath. Assert the miss so that widening this rule later
    // is a deliberate act with its own evidence, not a drift.
    it("does NOT drop a NodeBB/Invision thread — a deliberate, named miss", () => {
      expect(
        isListingPage("Battery Research Scientist", "forum.example.test", "/topic/8891-hiring-battery-postdocs/"),
      ).toBe(false);
    });

    it.each([
      "/topic/12-month-battery-fellowship",
      "/topic/2026-summer-internship",
    ])("is why NodeBB was cut — %s is a real posting sharing that shape", (pathAndQuery) => {
      expect(isListingPage("Battery Research Scientist", "example.test", pathAndQuery)).toBe(false);
    });

    // TITLE-INDEPENDENCE — the property that made the URL route beat every
    // string-side design tried across six rounds, and how Ruling 43's "both
    // observed shapes, not one string" is satisfied. All five recorded title
    // shapes for this one page drop from the same URL rule, INCLUDING the
    // `Users` shape that did not appear in round 14's census. A sixth title
    // shape appearing tomorrow drops too, because the rule never reads a title.
    it.each([
      ["paginated Announcements (live round 14, 5/5)", "Job vacancies looking for OpenMC skills - Page 2 - Announcements - OpenMC"],
      ["page-1 Announcements", "Job vacancies looking for OpenMC skills - Announcements - OpenMC"],
      ["the Users shape (recorded round 13)", "Job vacancies looking for OpenMC skills - Page 2 - Users - OpenMC Discourse"],
      ["the round 12 pipe-separated variant", "Job vacancies looking for OpenMC skills | Page 2 | OpenMC"],
      ["the no-category variant", "Job vacancies looking for OpenMC skills - Page 2 - OpenMC Discourse"],
    ])("drops the openmc thread regardless of title shape: %s", (_label, title) => {
      expect(
        isListingPage(title, "openmc.discourse.group", "/t/job-vacancies-looking-for-openmc-skills/1727?page=2"),
      ).toBe(true);
    });

    // RULING 32's QUESTION, ANSWERED FROM THE RENDER SIDE: when this fires the
    // item never exists, so there is no field to fill and nothing rejected can
    // be reinserted. The pool simply shrinks by one — `buildDailyJobPool` ends
    // in a `.slice()` CAP, never a top-up, so no substitute is pulled in.
    it("produces no item at all when it fires, so no employer can be derived", () => {
      const item = webResultToRawJobItem({
        title: "Job vacancies looking for OpenMC skills - Page 2 - Announcements - OpenMC",
        url: "https://openmc.discourse.group/t/job-vacancies-looking-for-openmc-skills/1727?page=2",
        snippet: "Several groups are hiring for molten salt reactor work. Apply now.",
      });
      expect(item).toBeNull();
    });
  });

  // B15-01 (round 15, Rulings 45c and 46a): a GENERATED SEARCH-RESULTS PAGE
  // restates its own query — its URL slug IS the query, and its title is that
  // same query followed by a location. A real posting's title is a ROLE.
  //
  // B's adversarial matrix is 92 cases (29 must-drop / 63 must-keep) and the
  // shipped design scored 89/92 on it, with ONE named false fire and TWO named
  // misses. All three are asserted at the bottom of this block rather than
  // buried in the total — B14-01's named-miss pattern extended to a named cost.
  //
  // `LISTING_TITLE_RE` IS NOT TOUCHED, so the count-form regression lock in the
  // "hole 1" block above still stands. The naive repair — making that leading
  // count optional — was measured at 71/92 with 19 false fires, FOUR of which
  // are must-keeps this very file already asserts. Do not re-litigate it.
  describe("countless topic landing pages are not postings (B15-01, Ruling 45c)", () => {
    // A's LIVE INSTANCE, round 15, 1 of 5 pulls: an aggregate search-results
    // page sitting in the job pool, rendering an empty employer and no summary.
    it("drops round 15 A's live countless listing page", () => {
      expect(
        isListingPage(
          "Ion Exchange Resin jobs in United States",
          "linkedin.com",
          "/jobs/ion-exchange-resin-jobs",
        ),
      ).toBe(true);
    });

    // THE PROOF THAT B13-02 WAS COUNT-DEPENDENT, AND THE REASON THIS ITEM IS
    // BIGGER THAN ONE PAGE. This is B13-02's OWN named target on its OWN URL,
    // with the leading count absent. Before B15-01 it was KEPT — so round 14
    // A's confirmation of B13-02 was an accident of that day's rendering, not
    // coverage. A later round must not read that confirmation as stronger than
    // it was.
    it("drops the COUNTLESS form of B13-02's own named target", () => {
      expect(
        isListingPage(
          "Molten Salt jobs in United States",
          "linkedin.com",
          "/jobs/molten-salt-jobs",
        ),
      ).toBe(true);
    });

    // THE ELEVEN COUNTLESS-CLASS MUST-DROPS. Note `jobboard.test`: the rule is
    // NOT a host list, and the identical shape drops on a different host. That
    // is A's brief and Ruling 32's headline complaint.
    it.each([
      ["A's count re-added (still drops via LISTING_TITLE_RE)", "1,000+ Ion Exchange Resin jobs in United States", "linkedin.com", "/jobs/ion-exchange-resin-jobs"],
      ["a trailing slash", "Ion Exchange Resin jobs in United States", "linkedin.com", "/jobs/ion-exchange-resin-jobs/"],
      ["a query tail", "Ion Exchange Resin jobs in United States", "linkedin.com", "/jobs/ion-exchange-resin-jobs?position=1"],
      ["another topic", "Solid State Battery jobs in Canada", "linkedin.com", "/jobs/solid-state-battery-jobs"],
      ["the `near` preposition", "Lithium Ion jobs near Boston", "linkedin.com", "/jobs/lithium-ion-jobs"],
      ["the `vacancies` noun", "Battery Research vacancies in Germany", "linkedin.com", "/jobs/battery-research-vacancies"],
      ["the `openings` noun", "Fuel Cell openings in Japan", "linkedin.com", "/jobs/fuel-cell-openings"],
      ["THE SAME SHAPE ON A DIFFERENT HOST — not a host list", "Ion Exchange Resin jobs in United States", "jobboard.test", "/jobs/ion-exchange-resin-jobs"],
      ["a locale slug tail", "Ion Exchange Resin jobs in United States", "linkedin.com", "/jobs/ion-exchange-resin-jobs-united-states"],
      ["a board tail whose brand carries no dot", "Ion Exchange Resin jobs in United States - JobBoard", "jobboard.test", "/jobs/ion-exchange-resin-jobs"],
      ["an all-lowercase render", "ion exchange resin jobs in united states", "linkedin.com", "/jobs/ion-exchange-resin-jobs"],
    ])("drops %s", (_label, title, host, pathAndQuery) => {
      expect(isListingPage(title, host, pathAndQuery)).toBe(true);
    });

    // RULING 46a's EVIDENCE, ASSERTED SO IT CANNOT BE TRADED AWAY QUIETLY.
    // A letter-case test (require the job noun lowercase) removes this block's
    // one false fire and scores 88/92 with ZERO false fires — but it MISSES
    // this Title-Case form. B13-02's own recorded live target `Intern Jobs at
    // Battery Ventures Companies` proves Title-Case listing titles occur in
    // this loop's real data, so shipping a fix a re-casing defeats is exactly
    // the failure that created this item. The manager ENDORSED the refusal
    // (Ruling 46a). If someone later adds the case test, THIS test fails —
    // which is the point.
    it("drops the TITLE-CASE render — why Ruling 46a refused a letter-case test", () => {
      expect(
        isListingPage(
          "Ion Exchange Resin Jobs in United States",
          "linkedin.com",
          "/jobs/ion-exchange-resin-jobs",
        ),
      ).toBe(true);
    });

    // THE OPEN-CLASS TRAPS — real role titles that contain the job nouns, an
    // employer brand ending in `Jobs`, and the HARD cases whose slug itself
    // ends at the noun. These are why all four conjuncts are load-bearing: the
    // URL-leaf test ALONE scores 79/92 and destroys the first five of these.
    //
    // COMMENT-ONLY CORRECTION BY ROUND 19's C (B19-01). One row's LABEL below
    // is now out of date and its ASSERTION IS DELIBERATELY UNTOUCHED (§3).
    // "the COMMA form — punctuation the slug cannot carry" was true when it was
    // written; after B19-01 a slug CAN carry a comma. This row still keeps, and
    // for a reason the label does not state: its SLUG has no comma
    // (`/jobs/manager-green-jobs`), so conjunct 3 cannot agree with the title's
    // `Manager, Green ...` opening. The row whose slug DOES carry the comma is
    // asserted in the B19-01 block below as a named accepted cost. Read this
    // row as "a comma in the title alone is not enough", not as coverage of
    // punctuated slugs.
    it.each([
      ["a role using `of` in the slug", "Director of Green Jobs in Boston", "example.test", "/jobs/director-of-green-jobs"],
      ["another `of` slug", "Head of Green Jobs in Ontario", "example.test", "/jobs/head-of-green-jobs"],
      ["`Head of Jobs`", "Head of Jobs in Manchester", "example.test", "/jobs/head-of-jobs"],
      ["the COMMA form — punctuation the slug cannot carry", "Manager, Green Jobs in Ontario", "example.test", "/jobs/manager-green-jobs"],
      ["an EMPLOYER BRAND ending in `Jobs`", "Battery Engineer at Rocket Jobs in Berlin", "example.test", "/jobs/battery-engineer-rocket-jobs"],
      ["the natural word order", "Green Jobs Program Manager", "example.test", "/jobs/green-jobs-program-manager"],
      ["`Youth Jobs Coordinator`", "Youth Jobs Coordinator in Ontario", "example.test", "/jobs/youth-jobs-coordinator"],
      ["a slug tail after the noun on a REAL role", "Green Jobs Coordinator in Ontario", "example.test", "/jobs/green-jobs-coordinator"],
      ["`Jobs Board Administrator`", "Battery Jobs Board Administrator", "example.test", "/jobs/battery-jobs-board-administrator"],
      ["`careers` is NOT in any list", "Head of Careers at Imperial College London", "example.test", "/jobs/head-of-careers"],
      ["`careers` again", "Careers Adviser in Manchester", "example.test", "/jobs/careers-adviser"],
      ["`positions` is NOT in any list", "Research positions in Chemistry at ETH", "example.test", "/jobs/research-positions"],
      ["`opportunities` is NOT in any list", "Funding opportunities in Battery Science", "example.test", "/jobs/funding-opportunities"],
      ["a brand ending in `Jobs`, comma form", "Senior Engineer, Rocket Jobs", "example.test", "/jobs/senior-engineer-rocket-jobs"],
      ["`Smart Jobs Inc`", "Software Engineer at Smart Jobs Inc", "example.test", "/jobs/software-engineer-smart-jobs"],
      ["the noun not followed by `in`/`near`", "Battery Jobs Fair Coordinator", "example.test", "/jobs/battery-jobs"],
      ["`Vacancies Manager`", "Vacancies Manager at Acme Materials", "example.test", "/jobs/vacancies-manager"],
      ["`Openings Coordinator`", "Openings Coordinator in Berlin", "example.test", "/jobs/openings-coordinator"],
      ["the topic word WITHOUT the job noun in the slug", "Ion Exchange Chemist in United States", "linkedin.com", "/jobs/ion-exchange-chemist"],
      ["a real molten-salt role", "Molten Salt Reactor Engineer in Idaho", "linkedin.com", "/jobs/molten-salt-reactor-engineer"],
    ])("keeps %s", (_label, title, host, pathAndQuery) => {
      expect(isListingPage(title, host, pathAndQuery)).toBe(false);
    });

    // THE TWO OTHER FILES THAT CALL `webResultToRawJobItem`, replayed here.
    // B proved zero tests at risk by cross-producting every string literal in
    // `jobweb.test.ts`, `scoring.test.ts` and `job-cleanup.test.ts` — 32,840
    // combinations, none changing verdict. These two are the concrete rows:
    // `job-cleanup.test.ts`'s fixture URL is not a literal in that file, so it
    // could only ever be checked by hand.
    it.each([
      ["job-cleanup.test.ts's fixture", "…Research in Reno at American Battery - Apply now!", "americanbattery.example", "/careers/job/42"],
      ["scoring.test.ts's QuantumScape posting", "Battery R&D Scientist - QuantumScape", "careers.quantumscape.com", "/jobs/battery-rd-scientist"],
    ])("keeps %s", (_label, title, host, pathAndQuery) => {
      expect(isListingPage(title, host, pathAndQuery)).toBe(false);
    });

    // ROUND 15 A's OWN CENSUS POSTINGS, using the titles A actually recorded.
    // Marked RECORDED-TITLE because A's log does not carry their exact live
    // paths — the paths here are plausible reconstructions, per A's own
    // correction that a GUESSED path is bad input rather than evidence.
    it.each([
      ["RECORDED-TITLE talents.vaia.com", "Actinide Chemistry & Ion Exchange Postdoc", "talents.vaia.com", "/companies/savannah-river-national-laboratory/jobs/1234"],
      ["RECORDED-TITLE befjobs.breakthroughenergy.org", "Battery R&D Intern @ LiftOFF Technology", "befjobs.breakthroughenergy.org", "/companies/liftoff-technology/jobs/1234"],
      ["RECORDED-TITLE grad.wisc.edu", "Graduate Assistantship at Thermo Fisher Scientific", "grad.wisc.edu", "/funding/graduate-assistantship-battery-research/"],
      ["RECORDED-TITLE terra.do", "Battery Systems Engineer at Idaho National Laboratory", "terra.do", "/climate-jobs/battery-systems-engineer/"],
      ["RECORDED-TITLE ev.careers", "Internship, Battery Engineering (Summer 2026) at Tesla", "ev.careers", "/jobs/battery-cell-engineer-1234"],
      ["RECORDED-TITLE magnet.me", "Battery Engineer in Amsterdam at AquaBattery", "magnet.me", "/jobs/battery-engineer-1234"],
      ["RECORDED-TITLE climatetechlist.com", "Battery Data Scientist", "climatetechlist.com", "/job/mantel-battery-data-scientist-1234"],
    ])("keeps %s", (_label, title, host, pathAndQuery) => {
      expect(isListingPage(title, host, pathAndQuery)).toBe(false);
    });

    // THE ONE NAMED FALSE FIRE — A REAL POSTING SHAPE THIS RULE DESTROYS.
    // The cost belongs in a test where it is measured, not only in a doc
    // comment. A role title that is a function-word-free noun phrase ending in
    // a bare plural job noun, rendered `<phrase> in <place>`, with a slug that
    // is exactly that phrase, IS a search query grammatically — no structural
    // test separates them. Same argument B14-01 used to cut NodeBB.
    //
    // Measured frequency: ZERO such titles across rounds 8–15's censuses (150+
    // observed postings). The nearest real shapes all survive and are asserted
    // in the must-keep block above. If round 16 A ever SIGHTS this shape live,
    // that observation is what reopens the trade — not taste (Ruling 46a).
    it("DROPS `Manager Green Jobs in Ontario` — a named, accepted cost, not a win", () => {
      expect(
        isListingPage("Manager Green Jobs in Ontario", "example.test", "/jobs/manager-green-jobs"),
      ).toBe(true);
    });

    // THE TWO NAMED MISSES, asserted so that widening this rule later is a
    // deliberate act with its own evidence rather than a drift. Both are
    // constructed, and both fail in the SAFE direction — the status quo, never
    // a new wrong value.
    it("does NOT drop a brand-first title — a deliberate, named miss", () => {
      // `webResultToRawJobItem` re-tests only the FIRST `|`-separated segment
      // (see the second `isListingPage` call there), so a query in the second
      // segment is out of reach. Closing this means changing that call pattern
      // — a wider blast radius than a constructed case earns.
      expect(
        isListingPage(
          "LinkedIn | Ion Exchange Resin jobs in United States",
          "linkedin.com",
          "/jobs/ion-exchange-resin-jobs",
        ),
      ).toBe(false);
    });

    it("does NOT drop a location-less query title — a deliberate, named miss", () => {
      // Allowing end-of-title instead of requiring `in`/`near` scores 81/92
      // with 8 false fires. The miss is bought deliberately.
      expect(
        isListingPage(
          "Ion Exchange Resin jobs",
          "linkedin.com",
          "/jobs/ion-exchange-resin-jobs",
        ),
      ).toBe(false);
    });

    // RULING 32's MANDATORY QUESTION, ANSWERED FROM THE RENDER SIDE: nothing is
    // rendered, because the item never exists. `isListingPage` true makes
    // `webResultToRawJobItem` return null and both search functions filter
    // nulls, so the page never reaches dedup, scoring, the mapper or any card.
    // No placeholder, no substitution, no backfill — and no top-up either, since
    // `MAX_OPPORTUNITY_POOL_ITEMS` is 200 and the pool is nowhere near the cap.
    it("produces no item at all when it fires, so no empty employer can render", () => {
      const item = webResultToRawJobItem({
        title: "Ion Exchange Resin jobs in United States",
        url: "https://www.linkedin.com/jobs/ion-exchange-resin-jobs",
        snippet: "Apply now to the latest ion exchange resin vacancies.",
      });
      expect(item).toBeNull();
    });

    // The counterpart: when the rule does NOT fire, behaviour is exactly what
    // it is today — a real posting on the same host and the same path family
    // still becomes an item. This is what stops the block above going vacuous.
    it("still produces an item for a real posting on the same host", () => {
      const item = webResultToRawJobItem({
        title: "Battery Research Scientist at Acme",
        url: "https://www.linkedin.com/jobs/view/battery-research-scientist-at-acme-4123456789",
        snippet: "We are hiring a battery research scientist. Apply now.",
      });
      expect(item).not.toBeNull();
    });
  });
});

// B19-01 (round 19, Ruling 52a): THE PUNCTUATED SEARCH-RESULTS SLUG.
//
// `jobright.ai` put a "1000+ results" search page on a job card in 5 pulls of
// 5, headed `Internship, Battery Engineering (summer 2026) Jobs in United
// States` — in the SAME run in which this file correctly dropped
// `linkedin.com`'s `1,000+ Molten Salt jobs in United States`. Caught on one
// host, missed on another, same round.
//
// THE TWO ROWS ARE SEPARATED BY TWO DIFFERENT CLAUSES, which is what sized the
// fix. LinkedIn drops on the LEADING COUNT (`LISTING_TITLE_RE`). The jobright
// title carries no count at all — its `(1000+)` lives in the page's own <h1>,
// and this guard runs at ingestion and never sees the page. So the clause that
// should have caught it is B15-01's, and it failed on two of its four
// conjuncts, both because a character class excluded the punctuation this
// host's LOSSLESS slugifier preserves.
//
// THE FIX IS THREE TOKENS, NOT ONE, AND THAT IS PROVED BY THE NEGATIVE-PROOF
// STRUCTURE OF THIS BLOCK rather than asserted in prose. Round 19's C
// re-measured it by execution before writing the code: widening the leaf alone
// leaves the live row KEPT, widening the title token alone leaves it KEPT.
//
// `LISTING_TITLE_RE` IS NOT TOUCHED BY THIS ITEM — not one byte — so every
// count-form lock above still stands and Ruling 46a is not re-opened.
describe("punctuated search-results slugs are not postings (B19-01, Ruling 52a)", () => {
  const JOBRIGHT_TITLE =
    "Internship, Battery Engineering (summer 2026) Jobs in United States";
  const JOBRIGHT_URL =
    "https://jobright.ai/jobs/internship,-battery-engineering-(summer-2026)-jobs-in-united-states";

  // 1 + 2. A19-01's LIVE ROW, in both title forms the provider may hand over.
  // The whole-title call site sees the ` | Jobright` tail; the role-segment
  // call does not, so both have to drop.
  it.each([
    ["the bare title", JOBRIGHT_TITLE],
    ["the title with its `| Jobright` tail", `${JOBRIGHT_TITLE} | Jobright`],
  ])("drops round 19 A's live jobright.ai search page — %s", (_label, title) => {
    expect(webResultToRawJobItem({ title, url: JOBRIGHT_URL })).toBeNull();
  });

  // 3. THE "NOT A HOST RULE" LOCK. `jobright.ai` was deliberately NOT added to
  // AGGREGATOR_HOSTS — that route was measured and is dead on a number, because
  // the path contains `2026` so `POSTING_ID_RE` matches and the aggregator
  // branch returns false. The identical shape must drop on a host nobody has
  // ever heard of.
  it("drops the identical shape on an unrelated host", () => {
    expect(
      webResultToRawJobItem({
        title: JOBRIGHT_TITLE,
        url: "https://jobboard.test/jobs/internship,-battery-engineering-(summer-2026)-jobs-in-united-states",
      }),
    ).toBeNull();
  });

  // 4 + 6. THE LEAF-HEAD TOKEN'S OWN CASES. Both of these go red if and only if
  // the leaf HEAD class is reverted: neither title's word before the job noun
  // carries punctuation, and neither slug carries punctuation after it, so
  // neither the title token nor the leaf tail can rescue them.
  it.each([
    ["a comma", "Internship, Battery Engineering Jobs in United States", "https://jobright.ai/jobs/internship,-battery-engineering-jobs-in-united-states"],
    ["a dot and an ampersand", "R&D Scientist, M.S. Level Jobs in Ohio", "https://jobright.ai/jobs/r&d-scientist,-m.s.-level-jobs-in-ohio"],
  ])("drops a slug head carrying %s", (_label, title, url) => {
    expect(webResultToRawJobItem({ title, url })).toBeNull();
  });

  // 5. THE LEAF-TAIL TOKEN'S OWN CASE, and the ONLY assertion in this file that
  // goes red for that token alone. The head (`battery-engineering-jobs`) is
  // punctuation-free and so is the word before the job noun, so this row is
  // reachable only once the class AFTER the job noun accepts a comma. It is
  // what makes the two-token form (leaf head + title) score one short.
  it("drops a locale tail carrying a comma", () => {
    expect(
      webResultToRawJobItem({
        title: "Battery Engineering Jobs in United States, Remote",
        url: "https://jobright.ai/jobs/battery-engineering-jobs-in-united-states,-remote",
      }),
    ).toBeNull();
  });

  // THE TITLE TOKEN IS LOAD-BEARING AND HAS NO ISOLATING TEST. THAT IS
  // STRUCTURAL, NOT A GAP IN THE CORPUS — Ruling 53b requires it be documented
  // as untestable here rather than papered over with a test that cannot in fact
  // isolate it.
  //
  // WHY NO SUCH TEST CAN EXIST: conjunct 3 requires the de-slugified leaf head
  // to be the title's opening phrase, so the title's word before the job noun
  // is ALWAYS the leaf head's second-to-last segment. A title token carrying
  // punctuation therefore FORCES a leaf head carrying the same punctuation, and
  // any row that needs the widened title token needs the widened leaf head too.
  // Both B and C tried to build a separating row and both failed.
  //
  // WHAT PROVES IT IS LOAD-BEARING ANYWAY: revert the title token alone and the
  // two live-row assertions at the top of this block go red. That is a COMBINED
  // revert, and it is the honest evidence — do not replace this comment with an
  // assertion that merely looks isolating.
  it("documents that the title token's own effect is proved by a COMBINED revert", () => {
    // The live row needs BOTH the widened leaf head and the widened title
    // token. This assertion is the combined proof and is deliberately not
    // claimed as an isolating one.
    expect(webResultToRawJobItem({ title: JOBRIGHT_TITLE, url: JOBRIGHT_URL })).toBeNull();
  });

  // 7. THE ADMITTED CONTROL (Ruling 51 / round 18 C's vacuity standard). Every
  // drop above is paired with the SAME title on a slug that does NOT restate
  // it. If a later change ever made this clause fire on the title alone, these
  // go red instead of the drops silently becoming vacuous.
  it.each([
    ["the live title", JOBRIGHT_TITLE],
    ["the leaf-head comma title", "Internship, Battery Engineering Jobs in United States"],
    ["the dot/ampersand title", "R&D Scientist, M.S. Level Jobs in Ohio"],
    ["the comma-tail title", "Battery Engineering Jobs in United States, Remote"],
  ])("KEEPS %s when the slug does not restate it", (_label, title) => {
    expect(
      webResultToRawJobItem({
        title,
        url: "https://jobright.ai/jobs/some-other-role-12345",
        snippet: "Apply now for this open position.",
      }),
    ).not.toBeNull();
  });

  // 8. ROUND 15 B's NINE NAMED MUST-KEEPS, all of them, by name. These are the
  // real role titles the widened classes must still let through.
  it.each([
    ["Manager, Green Jobs in Ontario", "https://example.test/jobs/manager-green-jobs-in-ontario-88213"],
    ["Green Jobs Program Manager", "https://example.test/jobs/green-jobs-program-manager"],
    ["Youth Jobs Coordinator in Ontario", "https://example.test/jobs/youth-jobs-coordinator"],
    ["Director of Green Jobs in Boston", "https://example.test/jobs/director-of-green-jobs"],
    ["Head of Green Jobs in Ontario", "https://example.test/jobs/head-of-green-jobs"],
    ["Battery Engineer at Rocket Jobs in Berlin", "https://example.test/jobs/battery-engineer-at-rocket-jobs"],
    ["Head of Jobs in Manchester", "https://example.test/jobs/head-of-jobs"],
    ["Jobs Data Analyst at the Bureau of Labor Statistics", "https://example.test/jobs/jobs-data-analyst"],
    ["Research positions at CERN", "https://jobs.cern.test/jobs/research-positions"],
  ])("keeps round 15 B's must-keep: %s", (title, url) => {
    expect(
      webResultToRawJobItem({ title, url, snippet: "Apply now for this open position." }),
    ).not.toBeNull();
  });

  // 9. RULING 49a's OREGON MUST-KEEP, the segment the card actually renders.
  it("keeps Ruling 49a's Oregon must-keep", () => {
    expect(
      webResultToRawJobItem({
        title: "M.S. Internship Program",
        url: "https://electrochemistry.uoregon.edu/careers/ms-internship-program-2026",
        snippet: "Applications are invited for this internship.",
      }),
    ).not.toBeNull();
  });

  // 10. THE CONJUNCT-4 LOCK. A punctuated slug that ALSO carries a function
  // word must still be kept, because the function-word check runs on the head
  // before conjunct 3 is ever reached. THIS IS THE ASSERTION THAT FAILS IF A
  // LATER ROUND "TIDIES" `TOPIC_LANDING_FUNCTION_WORD_RE`.
  it("keeps a punctuated slug that still carries a function word", () => {
    expect(
      webResultToRawJobItem({
        title: "Head of R&D, Green Jobs in Ontario",
        url: "https://example.test/jobs/head-of-r&d,-green-jobs",
        snippet: "Apply now for this open position.",
      }),
    ).not.toBeNull();
  });

  // 11. THE NAMED ACCEPTED COST, IN A TEST RATHER THAN ONLY IN A COMMENT — and
  // WITH THE MEASUREMENT THAT SAYS WHAT KIND OF COST IT IS.
  //
  // These two are B15-01's own named accepted cost in its COMMA form: a
  // function-word-free noun phrase ending in a bare plural job noun, rendered
  // `<phrase> in <place>`, with a slug that is exactly that phrase. B15-01
  // already priced and shipped that cost; B19-01 removes punctuation as an
  // ACCIDENTAL SHIELD over it. Both were CONSTRUCTED; the catch above is LIVE
  // 5 of 5. Measured frequency of the class: zero real postings across rounds
  // 8–19's censuses.
  it.each([
    ["Manager, Green Jobs in Ontario", "https://example.test/jobs/manager,-green-jobs"],
    ["Senior Engineer, Green Jobs in Ontario at Hydro One", "https://example.test/jobs/senior-engineer,-green-jobs"],
  ])("DROPS %s — a named, accepted cost, not a win", (title, url) => {
    expect(webResultToRawJobItem({ title, url })).toBeNull();
  });

  // THE DOCUMENTED-KNOWN CONTROL FOR THE TWO COSTS ABOVE, AND THE REASON THIS
  // CHANGE CREATES NO NEW FAILURE MODE: the UN-PUNCTUATED TWIN of each one
  // ALREADY DROPPED BEFORE B19-01 EXISTED. Re-measured by execution against the
  // shipped file. If a later round ever "rescues" this class, these go red
  // first and the rescue is revealed as a change to B15-01, not to B19-01.
  it.each([
    ["Manager Green Jobs in Ontario", "https://example.test/jobs/manager-green-jobs"],
    ["Senior Engineer Green Jobs in Ontario at Hydro One", "https://example.test/jobs/senior-engineer-green-jobs"],
  ])("documents that the un-punctuated twin already dropped: %s", (title, url) => {
    expect(webResultToRawJobItem({ title, url })).toBeNull();
  });

  // 12. THE NAMED UNDER-CATCH, AND IT IS NOT FIXABLE BY ANY CHARACTER CLASS.
  // `new URL()` percent-encodes a non-ASCII path before this rule ever sees it
  // (`/jobs/ing%C3%A9nieur-...`), so the de-slugified leaf can never agree with
  // the title. Measured, not assumed. Widening the class further would be
  // vacuous here, which is why no accented character was added.
  it("does NOT drop a non-ASCII slug — a deliberate, named under-catch", () => {
    expect(
      webResultToRawJobItem({
        title: "Ingénieur Batterie Jobs in France",
        url: "https://example.test/jobs/ingénieur-batterie-jobs-in-france",
        snippet: "Apply now for this open position.",
      }),
    ).not.toBeNull();
  });

  // THE TWO OTHER FILES THAT CALL `webResultToRawJobItem`, replayed here so
  // this item's blast radius is asserted in the file that changed.
  it.each([
    ["scoring.test.ts's QuantumScape posting", "Battery R&D Scientist - QuantumScape", "https://careers.quantumscape.com/jobs/battery-rd-scientist"],
    ["job-cleanup.test.ts's fixture row", "…Research in Reno at American Battery - Apply now!", "https://americanbattery.example/careers/job/42"],
  ])("keeps %s", (_label, title, url) => {
    expect(
      webResultToRawJobItem({ title, url, snippet: "Apply now for this open position." }),
    ).not.toBeNull();
  });

  // RULING 32 — WHAT RENDERS ON REJECTION, ANSWERED FROM THE RENDER SIDE.
  // Nothing renders, because the item never exists: the reader simply sees one
  // fewer job card. What renders TODAY without this item is worse — a card
  // headed like a role whose link opens a list of a thousand postings.
  it("produces no item at all when it fires", () => {
    expect(
      webResultToRawJobItem({
        title: JOBRIGHT_TITLE,
        url: JOBRIGHT_URL,
        snippet: "Apply now to the latest battery engineering internships.",
      }),
    ).toBeNull();
  });

  // AND THE COUNTERPART THAT STOPS THE BLOCK GOING VACUOUS: a real posting on
  // the SAME host with a punctuated slug still becomes an item.
  it("still produces an item for a real punctuated posting on the same host", () => {
    expect(
      webResultToRawJobItem({
        title: "Battery Engineer (Cell Design)",
        url: "https://jobright.ai/jobs/battery-engineer-(cell-design)-55120",
        snippet: "We are hiring a battery engineer. Apply now.",
      }),
    ).not.toBeNull();
  });
});

// B16-01 (round 16, Ruling 47b): AN INTERNSHIPS PROGRAMME INDEX IS NOT A
// POSTING. `lco.global/about/interns` reached the job pool in 5 of 5 pulls in
// each of rounds 13, 14, 15 and 16, rendering the bare word `Internships` as
// its role title — a card that promises a vacancy and names no role.
//
// THE FIX IS ONE WORD ADDED TO `CAREERS_INDEX_TITLE_RE`, NOT A URL RULE, and
// that is the load-bearing design decision this block exists to lock. All three
// URL routes were scored and all three are worse; the reasons are in the regex's
// own doc comment. The route below reaches an index on ANY host at ANY path,
// which no URL route could.
describe("internships programme index is not a posting (B16-01, Ruling 47b)", () => {
  // 1. THE LIVE INSTANCE, at its real host and path.
  it("drops the live `lco.global/about/interns` index", () => {
    expect(isListingPage("Internships", "lco.global", "/about/interns")).toBe(true);
  });

  // 2. THE END-TO-END ROUTE, WHICH IS THE ONE THAT MATTERS. The reader never
  // sees the bare word — they see the site's full `<title>`. It is the SECOND
  // `isListingPage` call in `webResultToRawJobItem` (on the first
  // separator-delimited segment) that catches these, exactly as this file's own
  // comment says that call exists to do. Without it the fix would not reach the
  // shape A actually measured.
  it.each([
    ["hyphen separator", "Internships - Las Cumbres Observatory"],
    ["pipe separator", "Internships | Las Cumbres Observatory"],
    ["bare title", "Internships"],
  ])("produces no item at all for the live render (%s)", (_label, title) => {
    const item = webResultToRawJobItem({
      title,
      url: "https://lco.global/about/interns",
      snippet: "Applications are open for our summer internship programme.",
    });
    expect(item).toBeNull();
  });

  // 3. NOT A HOST LIST — Ruling 32's headline complaint. The same bare title
  // drops wherever it appears.
  it.each([
    ["observatory.example", "/education/internships"],
    ["acme.test", "/careers"],
    ["some-employer.example", "/jobs"],
  ])("drops the same bare title at %s%s", (host, pathAndQuery) => {
    expect(isListingPage("Internships", host, pathAndQuery)).toBe(true);
  });

  // 4. THE GENERALITY NO URL ROUTE COULD REACH: an employer's own
  // `/careers/internships` index — the single most common URL this shape has.
  // The best-scoring URL candidate (leaf is `interns`/`internships` and no
  // job-path segment) survives this exact case, which is why it lost.
  it("drops an employer's own /careers/internships index", () => {
    expect(isListingPage("Internships", "acme.test", "/careers/internships")).toBe(true);
  });

  // 5. THE PLURAL NARROWING, PRICED AS A MUST-KEEP RATHER THAN LEFT IN A
  // COMMENT. Allowing the singular scores ONE FALSE FIRE, and this is it: a
  // real posting can be titled the bare singular. Measured, not inherited —
  // B13-02 part 3 established the same narrowing for `LISTING_SECTION_TITLE_RE`
  // and it was re-scored on this item's own data. DO NOT ADD THE SINGULAR.
  it("KEEPS the bare singular `Internship` — the priced cost of plural-only", () => {
    expect(isListingPage("Internship", "acme.test", "/careers/internship-2027")).toBe(false);
  });

  // 6. REAL INTERNSHIP POSTINGS SURVIVE. Per Ruling 31 the hardest cases are
  // included deliberately: a multi-word case whose title BEGINS with the added
  // plural (`Internships in Battery Science at Acme`), and a case carrying the
  // plural inside a longer role (`Research Internships Coordinator`).
  it.each([
    "Internship Battery R&D",
    "Molten Salt Electrochemistry Summer Internship",
    "Chemical and Materials Engineering Internship",
    "2027 Summer Investment Internship",
    "Internships in Battery Science at Acme",
    "Summer Internships 2027",
    "Research Internships Coordinator",
    "Internship Programme Lead",
  ])("keeps the real internship posting: %s", (title) => {
    expect(isListingPage(title, "acme.test", "/careers/1234")).toBe(false);
  });

  // 7. B14-01's OWN `/about/interns` MUST-KEEP ROW, RESTATED HERE RATHER THAN
  // TRUSTED AT A DISTANCE. It carries a real role title on the very URL this
  // item is about, and it must stay green: it is the proof that B16-01 is a
  // TITLE rule and not a URL rule. Ruling 47b is not authority to drop this URL
  // on its path.
  it("keeps a real posting on the very URL this item is about (B14-01's row)", () => {
    expect(
      isListingPage("Battery Research Scientist", "lco.global", "/about/interns"),
    ).toBe(false);
  });

  // 8. THE TWO REAL POSTINGS THE UNCONDITIONAL `/about/` URL ROUTE WOULD HAVE
  // DESTROYED, asserted so that route cannot be reintroduced quietly. Employers
  // really do file careers pages under `/about/`.
  it.each([
    ["Battery Engineer", "/about/careers/battery-engineer"],
    ["Process Engineer", "/about/jobs/1234"],
  ])("keeps the real posting a `/about/` URL rule would destroy: %s", (title, pathAndQuery) => {
    expect(isListingPage(title, "acme.test", pathAndQuery)).toBe(false);
  });
});

// B16-02 (round 16, Rulings 47c and 48a): THE LISTING GUARD WAS DESTROYING REAL
// SINGLE POSTINGS, AND FIFTEEN ROUNDS COULD NOT SEE IT. Every earlier round
// asked "did the guard over-fire?" by replaying the items IN THE POOL — but an
// item the guard drops is by definition not in the pool, so that check is
// structurally incapable of finding an over-fire. Round 16 A scored all 298 rows
// the provider OFFERED and found two real postings being destroyed: 0.7%.
//
// THREE EDITS, ONE CHANGE, AND RULING 48a MAKES THAT MANDATORY RATHER THAN
// TIDY. The two title narrowings fix independent gaps; the employer guard exists
// because recovering a posting is not a win if it comes back with a wrong
// employer. Landing the title fixes alone would trade a MISSING item for a WRONG
// one, which Ruling 23 ranks worse.
const INL_URL =
  "https://careers.inl.gov/psc/hrprd/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL/job/1515?Page=HRS_APP_JBPST_FL";
const INL_PATH =
  "/psc/hrprd/EMPLOYEE/HRMS/c/HRS_HRAM_FL.HRS_CG_SEARCH_FL.GBL/job/1515?Page=HRS_APP_JBPST_FL";
const KAIROS_TITLE =
  "Chemical and Materials Engineering Internship - Summer 2027 job in Albuquerque at Kairos Power | Lensa";
const KAIROS_PATH = "/job-v1/a1b2c3d4e5f60718293a4b5c6d7e8f90";

describe("the listing guard must not destroy real postings (B16-02, Ruling 47c)", () => {
  // 1. A's TWO LIVE INSTANCES, at their real hosts and paths. These are the
  // whole item.
  it("keeps the real INL requisition behind its site's `- Search Jobs` chrome", () => {
    expect(
      isListingPage("Molten Salt R&D Engineer - Search Jobs", "careers.inl.gov", INL_PATH),
    ).toBe(false);
  });

  it("keeps the real Kairos Power internship whose title carries a YEAR", () => {
    expect(isListingPage(KAIROS_TITLE, "lensa.com", KAIROS_PATH)).toBe(false);
  });

  // 2. THE TWO GAPS ARE INDEPENDENT, AND THIS IS ASSERTED SO A LATER ROUND
  // CANNOT COLLAPSE THE TWO EDITS INTO ONE. Measured by execution, each edit
  // applied alone against the real function:
  //   - anchoring alternative 4 alone  -> INL saved, Kairos STILL dropped, and
  //     four more year-class shapes still destroyed (5 false fires).
  //   - the year lookahead alone       -> Kairos saved, INL STILL dropped, and
  //     four more chrome shapes still destroyed (6 false fires).
  // Together: zero. The two titles below are the evidence, and they fire
  // DIFFERENT alternatives of the same regex — the INL title has no number at
  // all, the Kairos title does not begin with a listing verb.
  it("the two gaps fire different alternatives — neither edit alone is sufficient", () => {
    // The INL title contains no digit run, so the year lookahead is irrelevant
    // to it; only the anchoring saves it.
    expect(/\d/.test("Molten Salt R&D Engineer - Search Jobs")).toBe(false);
    // The Kairos title does not open with a listing verb, so the anchoring is
    // irrelevant to it; only the year lookahead saves it.
    expect(/^\s*(?:browse|search|find|latest|top|best)\b/i.test(KAIROS_TITLE)).toBe(false);
    // And both are kept now.
    expect(
      isListingPage("Molten Salt R&D Engineer - Search Jobs", "careers.inl.gov", INL_PATH),
    ).toBe(false);
    expect(isListingPage(KAIROS_TITLE, "lensa.com", KAIROS_PATH)).toBe(false);
  });

  // 3. THE CHROME CLASS BEYOND A's INSTANCE — at least three verbs wide. A
  // tested `- Search Jobs` (dropped) and `- View Jobs` (kept); `- Find Jobs` and
  // `- Browse Jobs` were being destroyed too and A never tested them.
  it.each([
    "Battery Research Scientist - Search Jobs",
    "Battery Research Scientist - Find Jobs",
    "Battery Research Scientist - Browse Jobs",
    "Battery Research Scientist - View Jobs",
  ])("keeps a real posting behind trailing ATS chrome: %s", (title) => {
    expect(isListingPage(title, "careers.acme.test", "/job/44231")).toBe(false);
  });

  // 4. NOT A HOST LIST — Ruling 32's headline complaint. The `- Search Jobs`
  // chrome is an applicant-tracking-system convention, not one site's quirk, so
  // the fix is asserted on a host unrelated to A's instance.
  it("keeps the same shape on an unrelated employer host", () => {
    expect(
      isListingPage("Postdoctoral Researcher - Search Jobs", "careers.acme.test", "/job/44231"),
    ).toBe(false);
  });

  // 5. THE STRIP-THE-CHROME-FIRST DESIGN IS LOCKED OUT BY THIS ROW. It is the
  // obvious fix, it is the class of widening that has burned this loop twice,
  // and it was measured at 184/191 with SIX false fires. This title is why:
  // the chrome is in the MIDDLE, so no trailing strip can reach it, and any
  // design that leaves alternative 4 unanchored destroys the posting. Per
  // Ruling 31 this is also the item's hardest multi-word case.
  it("keeps a posting whose chrome is mid-title — the strip-first design's own victim", () => {
    expect(
      isListingPage(
        "Senior Battery Engineer | Search Jobs | Acme Careers",
        "careers.acme.test",
        "/job/44231",
      ),
    ).toBe(false);
  });

  // 6. THE YEAR CLASS BEYOND A's INSTANCE — at least four shapes wide. All four
  // are CONSTRUCTED, not sighted: A's 2 of 298 remains the only measured rate.
  it.each([
    ["Battery R&D Intern - Summer 2027 job in Reno at Acme Corp", "/jobs/9912"],
    ["2026 Summer Analyst Positions at Kairos Power", "/careers/9913"],
    ["Class of 2027 Openings at Acme Labs", "/careers/9914"],
    ["Summer 2027 Internship - Job in Albuquerque at Kairos Power", "/jobs/9915"],
  ])("keeps a real posting whose title carries a year: %s", (title, pathAndQuery) => {
    expect(isListingPage(title, "acme.test", pathAndQuery)).toBe(false);
  });

  // 7. B13-02's COUNT-FORM REGRESSION LOCK, RE-ASSERTED UNDER THE NEW
  // ALTERNATIVE 1. The lookahead sits in FRONT of the alternation and the
  // alternation shape is byte-identical, but "it should still work" is not
  // evidence — these five run again here.
  it.each([
    "1000+ Molten Salt jobs in United States",
    "1,000+ Molten Salt jobs in United States",
    "12345 vacancies",
    "999 Battery Openings",
    "10,000 Battery Engineer positions in Germany",
  ])("still drops B13-02's locked count form: %s", (title) => {
    expect(isListingPage(title, "example.test", "/jobs")).toBe(true);
  });

  // 8. THE LOOKAHEAD'S OWN RELEASE CONDITIONS. It excludes a BARE four-digit
  // year and nothing else: a `+` suffix or a fifth digit means the run really is
  // a count, so the exclusion lifts. Without these two rows the lookahead could
  // be widened into "ignore any four-digit number" without a red test.
  it.each(["2000+ Battery Jobs in Germany", "20000 Battery Jobs"])(
    "still drops a genuine count that looks year-shaped: %s",
    (title) => {
      expect(isListingPage(title, "example.test", "/jobs")).toBe(true);
    },
  );

  // The expected miss that did NOT materialise, and C should not "fix" it: a
  // real four-digit count that IS year-shaped still drops, through
  // `LISTING_SECTION_TITLE_RE`'s optional one-word prefix. Neither narrowing
  // touches that rule. Asserted because it is load-bearing for the trade above.
  it("still drops `1999 jobs in Berlin` — a sibling rule already covers the blind spot", () => {
    expect(isListingPage("1999 jobs in Berlin", "example.test", "/jobs")).toBe(true);
  });

  // 9. ALTERNATIVE 4's OWN CATCH IS INTACT. The anchoring narrows WHERE the
  // verb may appear, not WHICH verbs count — a page genuinely titled as a
  // listing still drops.
  it.each([
    "Browse Chemistry Jobs",
    "Latest Research Scientist Vacancies",
    "Search Molten Salt Jobs in Chicago",
    "Find Postdoc Openings",
    "Best Materials Science Jobs",
    "Latest Vacancies",
  ])("still drops a title that OPENS with a listing verb: %s", (title) => {
    expect(isListingPage(title, "example.test", "/careers")).toBe(true);
  });

  // 10. THE NAMED MISS, ASSERTED AS A COST RATHER THAN BURIED IN A TOTAL —
  // B14-01's and B15-01's pattern. A brand-first search page now survives,
  // because that title and A's real INL posting are THE SAME SHAPE: a name, a
  // separator, then the chrome. No structural test separates them, which is the
  // same argument B14-01 used to cut NodeBB. On the nine AGGREGATOR_HOSTS the
  // aggregator branch still drops it; the miss only bites on an employer or
  // unlisted host. The trade: this costs one hypothetical listing page, the
  // status quo costs a real on-topic vacancy on an employer's own system — and
  // A's instance is OBSERVED while this one is CONSTRUCTED.
  //
  // Asserted so that widening this later is a deliberate act with its own
  // evidence rather than a drift.
  // A29-04 (round 29 C, item 3) — **RESTATED, NOT DELETED, AND THE MISS IS NOW
  // CLOSED FOR THIS ROW.** The comment above accepted the miss on one explicit
  // ground: *"No structural test separates them."* **One exists now, and it is
  // not a title test.** `/careers` is a section ROOT — a path that ENDS at the
  // section segment — whereas A's real INL requisition is
  // `/psc/…/job/1515?Page=…`: a deep path, a posting id, and a query. The two
  // rows are separated by structure, on the axis the comment said was empty,
  // so the trade it was pricing no longer has to be paid.
  //
  // **THE MISS IS NOT ABOLISHED, ONLY NARROWED, AND THE REMAINDER IS ASSERTED
  // BELOW:** a brand-first search page on a path that is NOT a section root
  // still survives, because there the title is still the only axis and the
  // original argument stands unchanged.
  it("drops a brand-first search page ONLY at a section-root path", () => {
    expect(isListingPage("Acme Corporation - Search Jobs", "acme.test", "/careers")).toBe(true);
    // The remainder of B16-02's priced miss, unchanged.
    expect(
      isListingPage("Acme Corporation - Search Jobs", "acme.test", "/en/talent/search"),
    ).toBe(false);
  });

  // 11. THE STRING SWEEP'S ONE VERDICT CHANGE, ASSERTED AS BENIGN RATHER THAN
  // LEFT AS A CLAIM. Both narrowings are pure TITLE rules — neither reads host
  // or path — so the title axis is the only axis a verdict can move on, which
  // makes a literal sweep COMPLETE for this change rather than a sample. B swept
  // 9,606 distinct string literals across 337 files in `web/src` and found
  // exactly ONE whose `LISTING_TITLE_RE` verdict changes: the SNIPPET below,
  // from the B15-01 block above. It is never a title.
  //
  // `webResultToRawJobItem` passes only `title` and its first separator-
  // delimited segment to `isListingPage`; a snippet reaches `JOB_TEXT_RE`,
  // `isRemote` and `cleanJobDescription` and nothing else. The verdict change is
  // therefore unreachable, and the test that uses this snippet still drops its
  // item — through `isTopicLandingPage` on the TITLE, which neither narrowing
  // touches. Asserted here so the sweep's single finding stays true by test
  // rather than by memory.
  it("the string sweep's one verdict change is on a SNIPPET that never reaches this rule", () => {
    const snippet = "Apply now to the latest ion exchange resin vacancies.";
    // The verdict on the literal did change — this is the sweep's one hit.
    expect(LISTING_TITLE_RE.test(snippet)).toBe(false);
    // And it is unreachable: the item carrying it still drops, on its title.
    const item = webResultToRawJobItem({
      title: "Ion Exchange Resin jobs in United States",
      url: "https://www.linkedin.com/jobs/ion-exchange-resin-jobs",
      snippet,
    });
    expect(item).toBeNull();
  });
});

// GAP 2C — THE PAIRED EMPLOYER GUARD. Ruling 48a: this lands in the SAME change
// as the two narrowings above, because recovering a posting that comes back with
// a wrong employer is not a fix. Ruling 32's question, run from the render side.
describe("ATS action controls in the employer slot (B16-02 gap 2C, Ruling 48a)", () => {
  // 1. THE PAIRING ITSELF: the recovered INL posting renders its real role title
  // AND an ABSENT employer — not `Search`. Without this guard `parts.slice(1)`
  // offers `Search Jobs`, it clears all eight existing vetoes, and
  // `stripTrailingCareersChrome` removes the trailing ` Jobs`, leaving `Search`.
  it("renders the recovered INL posting with no employer rather than `Search`", () => {
    const item = webResultToRawJobItem({
      title: "Molten Salt R&D Engineer - Search Jobs",
      url: INL_URL,
      snippet: "Idaho National Laboratory is hiring. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Molten Salt R&D Engineer");
    expect(item!.company).toBeUndefined();
  });

  // 2. THE SHAPE THAT IS LIVE TODAY WITH NO CHANGE AT ALL. `- View Jobs` was
  // KEPT by the shipped guard before this round (`view` is not in the title
  // rule's verb list) and rendered the employer `View`. Evidence class: LATENT,
  // not live — reproduced by executing the chain, never sighted in a census.
  it("renders `- View Jobs` with no employer rather than `View` — live before this round", () => {
    const item = webResultToRawJobItem({
      title: "Battery Research Scientist - View Jobs",
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a battery research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Battery Research Scientist");
    expect(item!.company).toBeUndefined();
  });

  // 3. THE OTHER RECOVERED POSTING COMES BACK CLEAN AND UNCHANGED. This is the
  // counterpart that stops the block above being read as "the guard blanks
  // employers": the Kairos posting keeps its real employer.
  it("renders the recovered Kairos posting with its real employer intact", () => {
    const item = webResultToRawJobItem({
      title: KAIROS_TITLE,
      url: `https://lensa.com${KAIROS_PATH}`,
      snippet: "Kairos Power is hiring interns. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe("Kairos Power");
  });

  // 4. B12-06's FOUR HARDEST MUST-KEEPS, PLUS EIGHT ADVERSARIAL REAL COMPANY
  // NAMES BUILT FROM THE VERY SAME VERBS. This is the whole reason every added
  // alternative is whole-segment anchored and requires VERB + JOB NOUN: no bare
  // single word is added, and `search` alone is deliberately NOT in the list.
  // It does not need to be, because this veto runs BEFORE the trailing-chrome
  // strip.
  it.each([
    "Home Depot",
    "Page Industries",
    "First Solar",
    "Next Energy Technologies",
    "Search Party Media",
    "View Systems Inc",
    "Find Therapeutics",
    "Browse AI",
    "Best Buy",
    "Top Glove Corporation",
    "All Jobs Ltd",
    "Search Laboratories",
  ])("keeps the real employer name: %s", (company) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Scientist - ${company}`,
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a battery research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe(company);
  });

  // 5. THE ADDED VOCABULARY ACTUALLY FIRES, asserted at the segment level so the
  // block above cannot go vacuous if the title rules change again.
  it.each([
    "Search Jobs",
    "Browse Jobs",
    "Find Careers",
    "View Openings",
    "See All Jobs",
    "All Positions",
    "Job Search",
  ])("rejects the ATS action control `%s` in the employer slot", (chrome) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Scientist - ${chrome}`,
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a battery research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBeUndefined();
  });
});

// B17-01 (round 17, Rulings 49a/49b): AN EMPLOYER'S OWN INTERNSHIP/PROGRAMME
// BROCHURE PAGE, admitted as if it were a vacancy. Two live instances in round
// 17 A's census. TWO additive checks, deliberately NOT merged into one and
// deliberately NOT added to `CAREERS_INDEX_TITLE_RE` — see the constants' doc
// comment for both measurements. C re-measured B's whole matrix by execution on
// a 95-row corpus (11 must-drop, 84 must-keep) before writing a line:
// baseline 84/95 with 11 misses and zero false fires, the shipped result
// 94/95 with ONE named miss and ZERO false fires.
describe("employer programme-brochure pages are not vacancies (B17-01)", () => {
  // 1. THE TWO LIVE INSTANCES, at their real hosts and paths, BOTH shipped
  // `isListingPage` calls. Before this item all four of these returned false.
  it.each([
    [
      "EnerSys Internship Program: Powering Future Innovators",
      "enersys.com",
      "/en/careers/enersys-internship-program",
    ],
    ["CATL Internships", "ev.careers", "/catl-internships"],
  ])("drops the live brochure page: %s", (title, host, pathAndQuery) => {
    expect(isListingPage(title, host, pathAndQuery)).toBe(true);
  });

  // 2. END TO END, which is what proves the fix reaches the render: the CATL
  // title carries separators, so the WHOLE-title call still returns false and
  // it is the SECOND `isListingPage` call — on the role segment — that drops
  // it. The shipped call pattern doing the job its own comment says it exists
  // for. Asserted at both levels so neither can go vacuous.
  it("drops the full offered CATL title end to end, via the second call", () => {
    const full =
      "CATL Internships - Battery Cell, R&D & Gigafactory Programs - EV.Careers";
    expect(isListingPage(full, "ev.careers", "/catl-internships")).toBe(false);
    expect(isListingPage("CATL Internships", "ev.careers", "/catl-internships")).toBe(
      true,
    );
    expect(
      webResultToRawJobItem({
        title: full,
        url: "https://ev.careers/catl-internships",
        snippet: "Apply now for this internship; applications are open.",
      }),
    ).toBeNull();
  });

  // 3. THE `<h1>` FORM DROPS TOO, so a title change upstream does not reopen
  // the item — the EnerSys page's `<h1>` is the colonless string.
  it("drops the EnerSys <h1> form, with no marketing tagline", () => {
    expect(
      isListingPage(
        "EnerSys Internship Program",
        "enersys.com",
        "/en/careers/enersys-internship-program",
      ),
    ).toBe(true);
  });

  // 4. NOT A HOST LIST. The same title drops on an unrelated host at an
  // unrelated path: check (a) is a pure title rule.
  it.each([
    ["acme.test", "/careers/internships"],
    ["northvolt.test", "/students"],
  ])("drops `Acme Internships` at %s%s — not a host list", (host, pathAndQuery) => {
    expect(isListingPage("Acme Internships", host, pathAndQuery)).toBe(true);
  });

  // 5. THE LIVE MUST-KEEP, AND IT IS THE MOST IMPORTANT ASSERTION IN THIS
  // BLOCK. Round 11 A fetched this posting directly, scored it CORRECT, and
  // called it "an own-domain research center hosting its own internship
  // posting". The tempting UNIFIED one-signal design — strip the tagline and
  // the `Program(me)` suffix, then test for an owner in front of a section
  // label — reaches both brochure pages with one statement AND DESTROYS BOTH
  // OF THESE ROWS, because grammatically the Oregon posting and the EnerSys
  // brochure are the same string. C reproduced that destruction by execution.
  // Ruling 49a refused to reclassify this page to make the one-signal design
  // available. If these two ever go red, the one-signal design has been
  // reintroduced.
  //
  // ENCODING REPAIR, round 20 C item 0. This title, and 16 other lines in this
  // file, were mangled when round 17's C wrote them (commit `909b6bf`): a
  // UTF-8 punctuation mark was read back through a Chinese code page, so
  // `– ` became two junk characters. The separator here is restored to the EN
  // DASH that the SAME commit's own doc comment in `jobweb.ts` spells it with,
  // unmangled. **Measured: this assertion's verdict does not depend on the
  // separator at all** — en dash, em dash and a plain hyphen all pass — so no
  // contract was ever riding on the mangled bytes. Nothing else changed.
  it.each([
    "M.S. Internship Program – Oregon Center for Electrochemistry",
    "M.S. Internship Program",
  ])("keeps round 11 A's live-sighted Oregon posting: %s", (title) => {
    expect(
      isListingPage(title, "electrochemistry.uoregon.edu", "/internships"),
    ).toBe(false);
  });

  // 6. THE `of` TRAP — the false fires B wrote to break its own first draft,
  // and two more C added. Ordinary HR and university role titles, not exotica.
  // Six false fires without the closed function-word exclusion, zero with it,
  // and no catch is lost either way.
  it.each([
    "Head of Careers",
    "Head of Careers - Imperial College London",
    "Manager of Vacancies",
    "Head of Internships",
    "Head Of Careers",
    "Director of Internships",
  ])("keeps the real `of` role title: %s", (title) => {
    expect(isListingPage(title, "example.test", "/jobs/1234")).toBe(false);
  });

  // 7. THE HOST-BRAND NARROWING IS LOAD-BEARING. Check (b) is a TITLE/HOST
  // RELATION, not a host list: the identical shape at an unrelated host is
  // kept, and a real posting on the very host that carries the brochure is
  // kept. The singular with no programme suffix is kept on its own host too.
  it.each([
    [
      "a real posting on the brochure's OWN host",
      "EnerSys Summer Internship - Battery Chemistry",
      "enersys.com",
    ],
    ["the same shape at an UNRELATED host", "Acme Fellowship Program", "othersite.test"],
    ["…with a colon tail, unrelated host", "Acme Internships: Apply Now", "othersite.test"],
    ["a programme designation, unrelated host", "Acme Graduate Programme", "example.test"],
    ["the singular with no programme suffix", "Acme Internship", "acme.test"],
  ])("keeps %s", (_label, title, host) => {
    expect(isListingPage(title, host, "/careers/1234")).toBe(false);
  });

  // 8. ROUND 16's PRICED SINGULAR AND ALL EIGHT OF B16-01's INTERNSHIP
  // MUST-KEEPS STILL HOLD. Round 16 C bought the bare singular by execution at
  // the cost of one destroyed posting; neither new check may re-spend it.
  it.each([
    "Internship",
    "Internship Battery R&D",
    "Molten Salt Electrochemistry Summer Internship",
    "Chemical and Materials Engineering Internship",
    "2027 Summer Investment Internship",
    "Internships in Battery Science at Acme",
    "Summer Internships 2027",
    "Research Internships Coordinator",
    "Internship Programme Lead",
  ])("keeps round 16's internship must-keep: %s", (title) => {
    expect(isListingPage(title, "acme.test", "/careers/1234")).toBe(false);
  });

  // 9. THE EMPLOYER-SLOT NON-INTERFERENCE, ASSERTED END TO END. These three
  // fail if the new shapes are ever moved into `CAREERS_INDEX_TITLE_RE`, which
  // has a SECOND call site in the employer veto chain. THAT IS THE POINT OF
  // THEM. C measured the widening on the real file: at a two-token owner budget
  // it turns `Tesla Careers` and `Kairos Power Careers` into silence; at three
  // tokens it additionally breaks the shipped `Idaho National Laboratory
  // Careers` assertion — THREE shipped tests red in total.
  it.each([
    ["Tesla Careers", "Tesla"],
    ["Kairos Power Careers", "Kairos Power"],
    ["Idaho National Laboratory Careers", "Idaho National Laboratory"],
  ])("still renders the real employer behind `%s`", (segment, expected) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Scientist - ${segment}`,
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a battery research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe(expected);
  });

  // 10. THE NAMED MISS, asserted so a later widening is a DELIBERATE ACT rather
  // than a drift. A three-token owner is not caught. The three-token budget
  // that catches it scores 95/95 on C's corpus against the shipped 94/95, and
  // it is refused because the miss costs only the status quo while the widened
  // form is one careless edit away from the shipped assertion above.
  it("does NOT drop a three-token owner — a deliberate, named miss", () => {
    expect(
      isListingPage("Idaho National Laboratory Internships", "inl.gov", "/internships"),
    ).toBe(false);
  });

  // 11. ROUND 21, ITEM 1 (A21-01). `jobs` was missing from
  // OWNER_INDEX_TITLE_RE's section-noun list while being present in every other
  // section-noun list in the module. `ev.careers/jobs/internship` is a category
  // page that rendered as a single job card on 5 of 5 live pulls.
  // THIS ASSERTION IS UNIQUELY RED WITHOUT THE ONE-WORD EDIT: reverted, this
  // test and only this test fails (measured, 386/387).
  it("drops an owner-section index title ending in `Jobs` (A21-01)", () => {
    expect(
      isListingPage("Internship EV Jobs", "ev.careers", "/jobs/internship"),
    ).toBe(true);
    expect(
      webResultToRawJobItem({
        title: "Internship EV Jobs - EV.Careers",
        url: "https://ev.careers/jobs/internship",
        snippet:
          "Find the best electric vehicle Internship jobs on EV.Careers today.",
      }),
    ).toBeNull();
  });

  // The must-keeps that make the edit narrow rather than a blanket. A real role
  // that merely CONTAINS `Jobs`, or an employer whose NAME ends in `Jobs`, is a
  // vacancy and must survive. `positions` stays out of the list (see the module
  // doc comment): `Research positions at CERN` is a shipped must-keep.
  it.each([
    "Jobs Data Analyst at the Bureau of Labor Statistics",
    "Green Jobs Analyst",
    "Battery Technician - Sunshine Jobs",
    "Research positions at CERN",
  ])("keeps a real vacancy containing `Jobs`: %s (A21-01)", (title) => {
    expect(isListingPage(title, "acme.test", "/jobs/44231")).toBe(false);
  });
});

// ROUND 21, ITEM 2 (A21-02): A LINK A READER CANNOT FOLLOW.
// `jobs.manchester.ac.uk/Job/GetJobAdvertDocument?Id=` carried an EMPTY id and
// a nine-byte body. The signal is closed and costs zero fetches: an
// identifier-NAMED parameter with an EMPTY value, on a path carrying no posting
// identifier of its own. This is NOT a host rule — the host appears nowhere in
// it, and it is asserted here on unrelated constructed hosts.
describe("a posting URL with an empty identifier is not reachable (A21-02)", () => {
  const admits = (url: string) =>
    webResultToRawJobItem({
      title: "Research Associate in Molten Salt Chemistry",
      url,
      snippet: "We are hiring a research scientist. Apply now.",
    }) !== null;

  it.each([
    ["the measured dead link", "https://www.jobs.manchester.ac.uk/Job/GetJobAdvertDocument?Id="],
    ["an empty jk on another host", "https://boards.acme.test/job/apply?jk="],
    ["an empty requisition that is not the last param", "https://boards.acme.test/job/apply?requisition=&src=rss"],
  ])("drops %s", (_label, url) => {
    expect(admits(url)).toBe(false);
  });

  // Each of these is red under a DIFFERENT mutant, so neither conjunct is
  // decoration. The live round-21 row `/job/1515?lastSelectedFacet=` is
  // protected by BOTH conjuncts at once, which is why it cannot stand in for
  // either and each has its own case here.
  it.each([
    ["conjunct 1 sharp: empty NON-identifier param on a slug path", "https://careers.inl.gov/jobs/battery-scientist?lastSelectedFacet="],
    ["conjunct 2 sharp: identifier-named empty param, real id in the PATH", "https://careers.acme.test/job/88123?reqId="],
    ["the live round-21 row, doubly protected", "https://careers.inl.gov/job/1515?lastSelectedFacet="],
    ["a populated identifier", "https://jobs.acme.test/Job/Get?Id=88123"],
    ["a populated non-identifier param", "https://jobs.acme.test/job/44231?jobTypes=Intern"],
  ])("keeps %s", (_label, url) => {
    expect(admits(url)).toBe(true);
  });

  // THE LATENT HOLE B RECORDED, CLOSED WITHOUT EDITING POSTING_ID_RE.
  // On an aggregator host `isListingPage` ends `return !POSTING_ID_RE.test(...)`
  // and POSTING_ID_RE MATCHES the empty `?id=`, so the shipped code kept such a
  // row for an affirmatively wrong reason. The new check runs before
  // `isListingPage` is ever called, so the row never reaches that line.
  it("closes the aggregator empty-id hole ahead of POSTING_ID_RE", () => {
    expect(admits("https://www.indeed.com/viewjob?id=")).toBe(false);
  });
});

// ROUND 21, ITEM 3 (A21-03): THE EMPLOYER FIELD WAS WRONG ON 3 OF 8 NON-NULL
// VALUES, ON TWO DISTINCT MECHANISMS. Two edits, one commit:
//   (a) a job board naming ITSELF in the employer slot;
//   (b) an en-dash role tail treated as an employer segment — ONE edit, BOTH
//       postdocjobs.com cards.
// Neither is a host rule: `postdocjobs.com` and `befjobs.breakthroughenergy.org`
// appear in neither, and both are asserted here on constructed hosts too.
describe("a board's own name is not the employer (A21-03a)", () => {
  const employerOf = (title: string, url = "https://careers.acme.test/job/44231") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  it("renders honest silence instead of the job board's own name", () => {
    expect(
      employerOf(
        "Summer Engineering Internship @ Mantel | Breakthrough Energy Fellows Job Board",
        "https://befjobs.breakthroughenergy.org/companies/mantel/jobs/44231",
      ),
    ).toBeUndefined();
  });

  it.each([
    "Battery Research Scientist - Acme Talent Portal",
    "Battery Research Scientist - Nordic Careers Hub",
  ])("also vetoes the constructed sibling `%s`", (title) => {
    expect(employerOf(title)).toBeUndefined();
  });

  // THE ADJACENCY REQUIREMENT. `National Labor Relations Board` is the sharp
  // case: it ENDS in a board noun, so an end-anchored veto without the job-word
  // adjacency requirement would wrongly destroy it. `Board of Regents` is an
  // ADMITTED CONTROL — its board noun is not at the end, so it survives either
  // way and proves nothing.
  it.each([
    ["National Labor Relations Board", "National Labor Relations Board"],
    ["Board of Regents", "Board of Regents"],
    ["Battery Board Games Inc", "Battery Board Games Inc"],
  ])("keeps the real employer `%s`", (segment, expected) => {
    expect(employerOf(`Battery Research Scientist - ${segment}`)).toBe(expected);
  });
});

describe("an en-dash role tail is not the employer (A21-03b)", () => {
  const employerOf = (title: string, url = "https://postdocjobs.com/posting/7317952") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  // BOTH cards, ONE edit. A reported them separately because a reader sees two.
  it.each([
    "Postdoctoral Appointee – Molten Salt Chemical and Electrochemical ... - Job posted on PostdocJobs.com",
    "Postdoctoral Researcher – MSR Fuel Cycle - Job posted on PostdocJobs.com",
  ])("renders honest silence for `%s`", (title) => {
    expect(employerOf(title)).toBeUndefined();
  });

  // RULING 49a's LOCK, AND IT IS WHAT THE "ALSO USES A CHROME SEPARATOR"
  // CONJUNCT EXISTS FOR. An en dash and NOTHING else means nothing is excluded.
  // Drop that conjunct and this goes silent — measured.
  it.each([
    ["M.S. Internship Program – Oregon Center for Electrochemistry", "Oregon Center for Electrochemistry"],
    ["Battery Scientist – Acme Energy Ltd", "Acme Energy Ltd"],
  ])("keeps `%s` — en dash only, so nothing is excluded", (title, expected) => {
    expect(employerOf(title, "https://careers.acme.test/job/44231")).toBe(expected);
  });

  // The vetoes are not blankets: a real employer later in the chain still wins.
  it("still renders a real employer behind chrome separators", () => {
    expect(
      employerOf(
        "Battery Cell Engineer - CATL - Battery Cell, R&D & Gigafactory Programs - EV.Careers",
        "https://careers.acme.test/job/44231",
      ),
    ).toBe("CATL");
  });
});

// OPTIONAL LATENT CLOSURE landed in the same commit, CLASSED HONESTLY.
// A truncation marker is not a word. This closes NOTHING on its own and is NOT
// counted as closing A21-03 — with item 3(b) shipped, the two rows that
// inspired it never reach this check. It is reachable only through a
// HYPHEN-ONLY title, which is what this asserts. Evidence class: LATENT, not
// live — no census has recorded this shape.
describe("a truncated field label is still a field label (round 21, latent)", () => {
  it("vetoes a topic label whose tail was clipped to an ellipsis", () => {
    expect(
      webResultToRawJobItem(
        {
          title: "Postdoctoral Appointee - Molten Salt Chemical and Electrochemical ...",
          url: "https://careers.acme.test/job/44231",
          snippet: "We are hiring a research scientist. Apply now.",
        },
        ["battery", "molten salt", "electrochemistry"],
      )?.company,
    ).toBeUndefined();
  });
});

// B17-02 (round 17, Rulings 48a + 49b): A LIST OF PROGRAMME AREAS IN THE
// EMPLOYER SLOT. Landed in the SAME commit as B17-01 because B17-01 removes the
// only page a census has ever sighted this value on — land the drop alone and
// the defect stops being visible without stopping being real. C re-measured:
// 4/4 caught, 0 of 46 real employer names destroyed.
describe("programme-area lists are not employers (B17-02)", () => {
  const render = (title: string) =>
    webResultToRawJobItem({
      title,
      url: "https://ev.careers/jobs/44231",
      snippet: "We are hiring a battery cell engineer. Apply now.",
    });

  // 1. THE LIVE VALUE IS VETOED, asserted on the KEPT REAL-POSTING FORM. An
  // assertion on the brochure row would be vacuous — B17-01 drops that page —
  // and would pass for the wrong reason. This is the row that proves the wrong
  // value is a property of the BOARD'S TITLE TEMPLATE, not of the brochure.
  it("renders no employer for the live programme-area list on a real posting", () => {
    const item = render(
      "Battery Cell Engineer - Battery Cell, R&D & Gigafactory Programs - EV.Careers",
    );
    expect(item).not.toBeNull();
    expect(item!.title).toBe("Battery Cell Engineer");
    expect(item!.company).toBeUndefined();
  });

  // 2. ALL THREE COORDINATORS FIRE, and the British spelling fires.
  it.each([
    ["the comma + ampersand form", "Engineering, Science & Technology Programs"],
    ["the bare `and` form", "Science and Engineering Programs"],
    ["the British spelling", "Graduate, Placement & Internship Programmes"],
  ])("vetoes %s", (_label, segment) => {
    const item = render(`Senior Materials Scientist - ${segment} - EV.Careers`);
    expect(item).not.toBeNull();
    expect(item!.company).toBeUndefined();
  });

  // 3. A VETO, NOT A BLANKET: a real employer later in the chain still wins.
  it("still renders a real employer that sits earlier in the same title", () => {
    const item = render(
      "Battery Cell Engineer - CATL - Battery Cell, R&D & Gigafactory Programs - EV.Careers",
    );
    expect(item).not.toBeNull();
    expect(item!.company).toBe("CATL");
  });

  // 4. THE SHIPPED STRIP IS UNTOUCHED, END TO END. The first draft of this
  // guard also allowed `careers` / `vacancies` / `openings` in the trailing-noun
  // list and destroyed FIVE real employers, one of them the shipped
  // `Alphabet, Inc.` assertion — a real company name with a comma plus trailing
  // careers chrome is the same shape. Those words are
  // `TRAILING_CAREERS_CHROME_RE`'s territory. C reproduced all five by
  // execution. Do not widen the list.
  it.each([
    ["Alphabet, Inc. Careers", "Alphabet, Inc."],
    ["Idaho National Laboratory Careers", "Idaho National Laboratory"],
    ["Baker, Smith & Co Careers", "Baker, Smith & Co"],
    ["Johnson & Johnson Careers", "Johnson & Johnson"],
    ["Smith, Jones & Partners Vacancies", "Smith, Jones & Partners Vacancies"],
    ["Procter & Gamble Openings", "Procter & Gamble Openings"],
  ])("keeps the careers-chrome employer `%s`", (segment, expected) => {
    const item = webResultToRawJobItem({
      title: `Research Fellow - ${segment}`,
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a research fellow. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe(expected);
  });

  // 5. THE COORDINATION REQUIREMENT IS LOAD-BEARING. The first five real names
  // below end in a plural programme noun and carry no comma, ampersand or
  // `and`. Dropping the coordination conjunct destroys every one of them — C
  // measured it. 6. THE COORDINATION-COMMA TRAPS follow: real names that DO
  // carry the coordinator but do not end in a programme noun. 7. `United
  // Nations Development Programme` is the hardest "must match nothing" case
  // (Ruling 31) — the SINGULAR is deliberately not in the list.
  it.each([
    "Advanced Technology Programs",
    "Head Start Programs",
    "Youth Programs",
    "Special Programs",
    "Wildlife Conservation Programs",
    "Baker, Smith & Co",
    "Johnson & Johnson",
    "Marks & Spencer",
    "Ernst & Young",
    "R&D Systems",
    "United Nations Development Programme",
    "Head Start Program",
  ])("keeps the real employer name `%s`", (segment) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Scientist - ${segment}`,
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a battery research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe(segment);
  });

  // 8. THE FORBIDDEN REPAIR IS LOCKED OUT BY A TEST, NOT A COMMENT. Adding
  // `programs?` to `TRAILING_CAREERS_CHROME_RE` turns the live value into
  // `Battery Cell, R&D & Gigafactory` — a DIFFERENTLY WRONG value, which is
  // Ruling 48a's named forbidden move. C measured that widening on the real
  // file: it produces three differently-wrong values AND destroys SEVEN real
  // names, including `United Nations Development Programme` above. The strip
  // can never produce silence anyway, because it returns the ORIGINAL candidate
  // when the strip would empty it. Only the veto chain can.
  it("never renders the trailing-chrome-stripped form of the live value", () => {
    const item = render(
      "Battery Cell Engineer - Battery Cell, R&D & Gigafactory Programs - EV.Careers",
    );
    expect(item!.company).not.toBe("Battery Cell, R&D & Gigafactory");
    expect(item!.company).toBeUndefined();
  });
});

// A22-06 and A22-07 (round 22): ONE LINE, `jobweb.ts`'s two-clause OR
// `if (!JOB_PATH_RE.test(pathname) && !JOB_TEXT_RE.test(text)) return null;`.
// It is simultaneously TOO NARROW on the URL — a real Los Alamos vacancy at
// `/search/jobdetails/<slug>/<uuid>` drops — and TOO LOOSE on the text — a
// retail shop's `/collections/batteries` catalogue page is admitted on its own
// `Apply Now` button. B established by execution that fixing either half alone
// re-opens the other, so both land in one commit and are tested together.
describe("the job-detection line, both halves (A22-06 + A22-07)", () => {
  it("keeps a real vacancy on an ATS jobdetails route (A22-07)", () => {
    const item = webResultToRawJobItem({
      title: "Nuclear Materials and Molten Salt Technologist 1 - Research Technologist 1",
      url: "https://lanl.jobs/search/jobdetails/nuclear-materials-and-molten-salt-technologist-1/9afb00cb-1111-2222-3333-444455556666",
      snippet: "Los Alamos National Laboratory seeks a technologist for molten salt work.",
    });
    expect(item).not.toBeNull();
    expect(item!.title).toContain("Molten Salt Technologist");
  });

  it("drops a retail shop's product category page (A22-06)", () => {
    // The snippet carries the shop's own `Apply Now` button text, which is
    // what `JOB_TEXT_RE` matched. Nothing about a catalogue page distinguishes
    // it from a posting once that phrase is present, so the URL has to decide.
    expect(
      webResultToRawJobItem({
        title: "Batteries",
        url: "https://batteryjunction.com/collections/batteries",
        snippet: "Shop batteries and chargers. Apply Now for our trade account.",
      }),
    ).toBeNull();
  });

  // B's NAMED CONTROL. This row is kept today on `JOB_PATH_RE` alone and must
  // stay kept: it is the proof that widening the path list did not disturb the
  // segments already in it.
  it("keeps B's named control — a posting kept on the path clause alone", () => {
    expect(
      webResultToRawJobItem({
        title: "Actinide Chemistry/Ion Exchange Postdoc Research Associate",
        url: "https://salutemyjob.com/jobs/actinide-chemistry-ion-exchange-postdoc-research-associate-columbia-south-carolina/2893886008-2",
        snippet: "Savannah River National Laboratory postdoctoral appointment.",
      }),
    ).not.toBeNull();
  });

  // VACUITY: each half must be able to fail on its own, so neither token is
  // decoration. `collections` must not swallow a genuine posting whose URL is
  // job-shaped, and `jobdetails` must not rescue a page the text clause never
  // wanted.
  it("does not let the storefront segment drop a posting that is otherwise job-shaped", () => {
    expect(
      webResultToRawJobItem({
        title: "Research Scientist, Battery Collections Group",
        url: "https://example.test/careers/research-scientist-battery",
        snippet: "We are hiring a research scientist for our collections group.",
      }),
    ).not.toBeNull();
  });

  it("still drops a page that is neither job-shaped by URL nor by text", () => {
    expect(
      webResultToRawJobItem({
        title: "About our battery chemistry programme",
        url: "https://example.test/about/programme",
        snippet: "An overview of our research areas and facilities.",
      }),
    ).toBeNull();
  });

  // The regexes themselves, so a later reader can see exactly which segments
  // were bought and which were deliberately not.
  it("buys jobdetails, collections and (Phase 3 round 3, J2) products; nothing else in either family", () => {
    expect(JOB_PATH_RE.test("/search/jobdetails/role/uuid")).toBe(true);
    expect(NON_JOB_PATH_RE.test("/collections/batteries")).toBe(true);
    // Named as UNEARNED in source: no live case in this pull, so §3's vacuity
    // rule leaves them out. If a later round earns one, this is where it lands.
    expect(JOB_PATH_RE.test("/search/job-details/role")).toBe(false);
    expect(JOB_PATH_RE.test("/search/jobdetail/role")).toBe(false);
    // Phase 3 round 3 C, ITEM 3 (J2, Ruling 120g item 3): CONTRACT CHANGE.
    // This asserted `false` before this item — `products` was named in
    // source as deliberately left out for vacuity (no live case in that
    // pull). Phase 3 round 2 B's fresh Tier-2 census supplied that live
    // case (neicorporation.com's product-catalogue page, admitted 1 of 5
    // pulls) and this file's own comment had predicted the gap in advance.
    // Rewritten to state the new, bought contract — never deleted.
    expect(NON_JOB_PATH_RE.test("/products/batteries")).toBe(true);
    // `shop` remains unbought — still no live witness this round either,
    // exactly as the source comment continues to state.
    expect(NON_JOB_PATH_RE.test("/shop/batteries")).toBe(false);
  });
});

// Phase 3 round 3 C, ITEM 3 (J2, Ruling 120g item 3): `NON_JOB_PATH_RE` gains
// `products`. Same family and same failure direction as A22-06 immediately
// above (a DROP-the-row guard, held to the higher bar Ruling 55c states) —
// the shipped code's own comment at `NON_JOB_PATH_RE`'s declaration named
// this exact gap in advance ("`products`... LEFT OUT for the same vacuity
// reason... no live case in this pull"); Phase 3 round 2 B's fresh Tier-2
// census supplied that live case.
describe("a product-catalogue page is not a job posting (J2, Phase 3 round 3)", () => {
  it("drops the real neicorporation.com witness", () => {
    expect(
      webResultToRawJobItem({
        title: "Lithium Cobalt Oxide Powder",
        url: "https://neicorporation.com/products/batteries/cathode-anode-powders/lithium-cobalt-oxide/",
        snippet: "Battery-grade lithium cobalt oxide cathode and anode powders.",
      }),
    ).toBeNull();
  });
});

// A22-04(a) (round 22, `zerobonline.com`, Ruling 60a): the employer IS on the
// row — in the title's parentheses — and it never reached the slot the report
// reads, because `jobweb`'s title splitter has no `(` in its separator class.
// The row rendered no employer line at all for a posting that names its
// employer plainly. **This closes a wrong SILENCE. It does NOT close A22-04**:
// B executed the shipped 57b guard with this name supplied and it still returns
// `false`, so the row stays in the pool and the guard half stays deferred.
describe("a parenthetical employer reaches the employer slot (A22-04a)", () => {
  it("names the employer the title states in parentheses", () => {
    const item = webResultToRawJobItem({
      title: "Opening For Marketing Intern (Ion Exchange Ltd.)",
      url: "https://zerobonline.test/jobs/marketing-intern-mumbai",
      snippet: "Marketing internship supporting BMS and social media campaigns.",
    });
    expect(item).not.toBeNull();
    expect(item!.company).toBe("Ion Exchange Ltd.");
  });

  // IT IS AN ORDINARY CANDIDATE, LAST IN LINE. These are the assertions behind
  // the claim that it can only ever turn a silence into a name.
  it("never displaces a better-evidenced employer", () => {
    const item = webResultToRawJobItem({
      title: "Research Scientist at Idaho National Laboratory (Battery Programme)",
      url: "https://example.test/jobs/research-scientist-battery",
      snippet: "Battery research role.",
    });
    expect(item!.company).toBe("Idaho National Laboratory");
  });

  it("never displaces an employer named by a separator segment", () => {
    // The separator segment already carries whatever follows it, parentheses
    // included — pre-existing behaviour this item does not touch. What is
    // asserted here is only that the parenthetical, being LAST in line, never
    // becomes the answer when a segment already produced one.
    const item = webResultToRawJobItem({
      title: "Research Scientist | Example Energy Ltd. (Ion Exchange Ltd.)",
      url: "https://example.test/jobs/research-scientist-battery-two",
      snippet: "Battery research role.",
    });
    expect(item!.company).not.toBe("Ion Exchange Ltd.");
    expect(item!.company).toContain("Example Energy");
  });

  // **THE CASE THAT CHANGED THE FIX.** B's guide says the existing candidate
  // guard chain still applies, and it does — but the chain does not screen this
  // shape at all: `looksLikeBareLocation` only matches a TRAILING US STATE
  // CODE. Without an organisation test, this row would render `Mumbai, India`
  // as the employer, trading a wrong silence for a wrong VALUE. A trailing
  // parenthetical holds a place or a qualifier at least as often as an
  // employer, so the parenthetical must name an organisation to be admitted.
  it.each([
    ["a bare non-US location", "Battery Research Intern (Mumbai, India)"],
    ["a US location", "Battery Research Intern (Boston, MA)"],
    ["a work-mode qualifier", "Battery Research Intern (Remote)"],
    ["a contract qualifier", "Battery Research Intern (Full-time)"],
    ["a subject qualifier", "Battery Research Intern (Batteries)"],
  ])("refuses %s in the parentheses", (_label, title) => {
    const item = webResultToRawJobItem({
      title,
      url: "https://example.test/jobs/battery-research-intern-guarded",
      snippet: "Battery research internship.",
    });
    expect(item!.company).toBeUndefined();
  });

  // Every token of the closed designator vocabulary, asserted. Only `Ltd` is
  // earned by a live row; the rest are the same grammatical class and are
  // covered by constructed cases, which is proportionate for a rule that can
  // only ever ADMIT a name that is silent today.
  it.each([
    "Ion Exchange Ltd.", "Ion Exchange Limited", "Aspen Materials Inc.",
    "Aspen Materials Incorporated", "Aspen Materials LLC", "Aspen Partners LLP",
    "Aspen Holdings PLC", "Aspen Systems Pvt", "Aspen Corp", "Aspen Corporation",
    "Aspen Co.", "Aspen GmbH", "Aspen AG", "Aspen SA", "Aspen BV", "Aspen NV",
    "Aspen AB", "Aspen Oy", "Aspen AS", "Aspen Pty", "Riverside University",
    "Riverside Institute", "Riverside Laboratory", "Riverside Laboratories",
    "Riverside Lab", "Riverside Labs", "Riverside College", "Riverside Hospital",
    "Riverside Foundation", "Riverside Academy", "Riverside Centre",
    "Riverside Center",
  ])("admits the organisation designator in %s", (employer) => {
    const item = webResultToRawJobItem({
      title: `Battery Research Intern (${employer})`,
      url: "https://example.test/jobs/battery-research-intern-org",
      snippet: "Battery research internship.",
    });
    expect(item!.company).toBe(employer);
  });

  it("requires the designator to be what the name FINISHES on", () => {
    // `Limited Openings` is not an organisation; the anchor is what makes the
    // vocabulary a shape test rather than a keyword search.
    const item = webResultToRawJobItem({
      title: "Battery Research Intern (Limited Openings)",
      url: "https://example.test/jobs/battery-research-intern-anchor",
      snippet: "Battery research internship.",
    });
    expect(item!.company).toBeUndefined();
  });

  // **A22-04 IS NOT CLOSED BY THIS AND THE LOG SAYS SO (Ruling 60a).** The row
  // still enters the pool: B executed the shipped 57b guard with this employer
  // supplied and it still returns false. What changed is only that the reader
  // now sees who the employer is. The guard half is deferred with its shape
  // recorded, and no clause of the 57b guard was touched.
  it("does not remove the row from the pool — the guard half is deferred", () => {
    const item = webResultToRawJobItem({
      title: "Opening For Marketing Intern (Ion Exchange Ltd.)",
      url: "https://zerobonline.test/jobs/marketing-intern-mumbai",
      snippet: "Marketing internship supporting BMS and social media campaigns.",
    });
    expect(item).not.toBeNull();
  });
});

// A23-01(c) / Ruling 62d — THE THREE BOUNDED CLAUSES.
//
// Half (a) — "prefer the last surviving segment" — is NOT shipped and NOT
// tested here; see round 23 C item 2 for the measurement that held it. Half (b)
// — the positive organisation test — is DEFERRED by 62d and C does not design
// it. The must-keep block at the end is the corpus that governs both.
describe("A23-01(c) — bounded employer-candidate rejections", () => {
  const employerOf = (title: string, url = "https://careers.acme.test/job/44231") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  // CLAUSE 1 — the truncated provider string.
  //
  // Round 28 item 1 (B28-01): the middle row was
  // `"Jobs and Internships - Youth & Young Adult Programs ..."` — its own
  // head, "Jobs and Internships", is now a conjoined-section-label match, so
  // `webResultToRawJobItem` returns `null` before clause 1 is ever reached
  // and `employerOf` reads `undefined` off a null item, not off a real one
  // whose candidate was rejected. Swapped to a role-shaped head so the row
  // still reaches clause 1's own code and the assertion stays non-vacuous;
  // the trailing truncated segment is untouched.
  it.each([
    "Graduate Intern – Focused Ion Beam, Electron Microscopy ...",
    "Battery Research Intern - Youth & Young Adult Programs ...",
    "Graduate Intern – Focused Ion Beam, Electron Microscopy …",
  ])("renders silence for the truncated candidate in `%s`", (title) => {
    expect(employerOf(title)).toBeUndefined();
  });

  it("is not itself a listing page, so clause 1 is the reason the employer is silent", () => {
    // The uniquely-red half of the repair above: without this, a future
    // change that dropped clause 1 entirely would still pass the `it.each`
    // above if the row were dropped upstream by `isListingPage` instead.
    const item = webResultToRawJobItem({
      title: "Battery Research Intern - Youth & Young Adult Programs ...",
      url: "https://careers.acme.test/job/44231",
      snippet: "We are hiring a research scientist. Apply now.",
    });
    expect(item).not.toBeNull();
  });

  it("is END-anchored — a mid-string ellipsis is a different shape", () => {
    // `Johnson & Johnson … Careers` mid-string must not be caught by a clause
    // written for a tail the provider cut off.
    expect(employerOf("Battery Scientist - Johnson … Johnson Ltd")).toBe(
      "Johnson … Johnson Ltd",
    );
  });

  // CLAUSE 2 — the careers-office label.
  it.each([
    "Nuclear Engineering Internship Summer 2027 - Career Services",
    "Molten Salt Internship - Careers Office",
    "Battery Internship - Career Center",
  ])("renders silence for the careers office in `%s`", (title) => {
    expect(employerOf(title)).toBeUndefined();
  });

  it("is WHOLE-SEGMENT anchored — a real name CONTAINING the phrase survives", () => {
    // B13-01 Gap A's own anchor. These are employers, not offices, and both
    // contain the office phrase in full.
    expect(employerOf("Battery Scientist - Career Services International Ltd")).toBe(
      "Career Services International Ltd",
    );
    expect(employerOf("Battery Scientist - Global Careers Office Solutions Inc")).toBe(
      "Global Careers Office Solutions Inc",
    );
  });

  // CLAUSE 3 — the address tail. TRIM, NEVER REJECT.
  it("trims a postal address off an otherwise correct employer", () => {
    expect(
      employerOf(
        "Nuclear Engineering Internship - Summer 2027 at Kairos Power, Alameda, California, United States | Intern Insider",
      ),
    ).toBe("Kairos Power");
  });

  it("leaves a state-code tail to the existing bare-location guard, which gets there first", () => {
    // A state-code arm of the trim would be UNREACHABLE, not merely unearned:
    // `looksLikeBareLocation` rejects any candidate ending `, MA` before a
    // winner exists to trim, and moving the trim earlier to reach it is the
    // forbidden ordering the next test pins. So this stays silent — today's
    // behaviour, recorded rather than rediscovered.
    expect(
      employerOf("Battery Scientist - Acme Energy Ltd, Cambridge, MA"),
    ).toBeUndefined();
  });

  it("does not cut a comma'd company name that has no place tail", () => {
    // The trigger is the LAST comma-part naming a gazetteer COUNTRY, not merely
    // the presence of a comma. Both heads here are multi-word, so the head
    // requirement cannot be what is doing the work.
    expect(employerOf("Battery Scientist - Smith Jones, Barnes & Partners")).toBe(
      "Smith Jones, Barnes & Partners",
    );
    expect(employerOf("Battery Scientist - Smith, Jones & Co")).toBe(
      "Smith, Jones & Co",
    );
  });

  it("does not trim a candidate that is ONLY an address — the whole address stays visible", () => {
    // Trimming here would print `Alameda` as an employer: still wrong, but no
    // longer visibly wrong to a census reading the column. Ruling 49b — a
    // hidden defect is worse than a deferred one.
    expect(
      employerOf("Battery Research Scientist - Alameda, California, United States"),
    ).toBe("Alameda, California, United States");
  });

  it("still rejects a bare `City, ST` candidate outright", () => {
    // A must-keep, not an ordering proof — and C states the difference rather
    // than dressing it up. Once the state-code arm was removed, moving the trim
    // ahead of the guard chain stopped changing any measured outcome, so the
    // after-the-chain placement is defence in depth with no red case of its
    // own. It is kept because trimming candidates is the shape that WOULD blind
    // `looksLikeBareLocation` if the state-code arm ever returned.
    expect(employerOf("Battery Research Scientist - Cambridge, MA")).toBeUndefined();
  });

  // THE MUST-KEEP CORPUS. Ruling 62d names these; they govern (b) when it is
  // taken up, and they must not move now.
  it.each([
    [
      "M.S. Internship Program – Oregon Center for Electrochemistry",
      "Oregon Center for Electrochemistry",
    ],
    [
      "Battery Research Scientist - Careers - Idaho National Laboratory",
      "Idaho National Laboratory",
    ],
    ["Opening For Marketing Intern (Ion Exchange Ltd.)", "Ion Exchange Ltd."],
    ["Molten Salt Chemistry Summer 2025 Internship - INL Careers", "INL"],
  ])("keeps `%s`", (title, expected) => {
    expect(employerOf(title)).toBe(expected);
  });

  it.each([
    "Molten Salt Chemical and Electrochemical Engineering – MSR Fuel Cycle - PostdocJobs.com",
    "Battery Research Intern (Mumbai, India)",
    "Molten Salt Postdoc (Summer 2027)",
  ])("keeps the honest silence for `%s`", (title) => {
    expect(employerOf(title, "https://postdocjobs.com/posting/7317952")).toBeUndefined();
  });

  // Ruling 49a's pair, restated in one place because it is the whole difficulty
  // of this item: SAME separator, SAME segment count, OPPOSITE outcome. Only a
  // positive organisation test — deferred half (b) — can separate them, and the
  // ellipsis clause is what carries the second one today.
  it("holds the 49a pair apart", () => {
    expect(employerOf("M.S. Internship Program – Oregon Center for Electrochemistry"))
      .toBe("Oregon Center for Electrochemistry");
    expect(employerOf("Graduate Intern – Focused Ion Beam, Electron Microscopy ..."))
      .toBeUndefined();
  });
});

// Round 30, Ruling 81a (B's item 1, the three-clause partial discharging
// Ruling 79b's commission). ONLY TWO OF THE THREE DESIGNED CLAUSES SHIP —
// `ROLE_TEXT_CANDIDATE_RE` and `BOARD_DOMAIN_BRAND_RE` — see their doc
// comments in jobweb.ts for the full reasoning and the residuals left open
// on purpose, not solved here (the `CSE`-class acronym collision, the
// segment-order problem, the `@ Septerna` shape). The THIRD designed clause,
// `CAREERS_OFFICE_HEAD_RE`, was implemented and then found to also veto the
// shipped must-keep "Career Services International Ltd" (the "is
// WHOLE-SEGMENT anchored" test above) — a structural collision, not a
// tuning slip, filed `POLICY — manager decides` in round 30 C's §4 entry.
// `Career Connections Center University of Florida`, the shape that clause
// was meant to reach, stays a NAMED, UNADDRESSED residual — asserted below
// as still rendering its full (wrong) string, not silence.
describe("Round 30, Ruling 81a — the three-clause partial", () => {
  const employerOf = (title: string, url = "https://careers.acme.test/job/44231") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  // CLAUSE 1 — ROLE_TEXT_CANDIDATE_RE. Recorded must-drops plus the fresh
  // live catch (`Scientist`) B's item 1 §1.4 reproduced against a real pull.
  it.each([
    "Battery Scientist Program - Research Technologist 1",
    "Battery Scientist Program - Internship battery R&D",
    "Battery Scientist Program - Co-ops",
    "Battery Scientist Program - Membrane Scientist for Electrodialysis",
    "Molten Salt Research Program - Scientist",
  ])("vetoes the role-text candidate in `%s`", (title) => {
    expect(employerOf(title)).toBeUndefined();
  });

  // CLAUSE 2 WAS NOT SHIPPED (see the describe-block comment above): `Career
  // Services` is still vetoed, but only by the PRE-EXISTING whole-segment
  // `CAREERS_OFFICE_LABEL_RE`, not by anything new this round.
  it("still vetoes `Career Services` — via the pre-existing whole-segment guard", () => {
    expect(employerOf("Battery Scientist Program - Career Services")).toBeUndefined();
  });

  // NAMED RESIDUAL, ASSERTED HONESTLY: `Career Connections Center University
  // of Florida` was the shape `CAREERS_OFFICE_HEAD_RE` was designed to reach.
  // With that clause withheld (the `Career Services International Ltd`
  // collision above), nothing else in the chain catches it, so it renders
  // its full string as the employer — today's status quo, unchanged by this
  // round, recorded so the gap is visible rather than silently reopened.
  it("does NOT yet veto `Career Connections Center University of Florida` — a named, unaddressed residual", () => {
    expect(
      employerOf(
        "Battery Scientist Program - Career Connections Center University of Florida",
      ),
    ).toBe("Career Connections Center University of Florida");
  });

  // CLAUSE 3 — BOARD_DOMAIN_BRAND_RE. Ruling 63a's own trigger shape.
  // `looksLikeHostBrand` cannot see it (it only compares the host's FIRST DNS
  // label), so without this clause the full board-brand string would survive
  // as the sole candidate whenever it is not beaten to the chain by a
  // higher-priority segment.
  it("vetoes the board-brand domain string in `EV.Careers`", () => {
    expect(employerOf("Battery Scientist Program - EV.Careers")).toBeUndefined();
  });

  // HONEST SILENCE: every surviving candidate vetoed renders `company`
  // `undefined`, never an invented value (Ruling 32) — asserted end to end
  // with two DIFFERENT new clauses each removing one of two candidates.
  it("renders honest silence when every candidate is vetoed by a different new clause", () => {
    expect(
      employerOf("Battery Scientist Program - Research Technologist 1 - EV.Careers"),
    ).toBeUndefined();
  });

  // MUST-KEEP INVARIANCE — the 21-row corpus B's item 1 §1.0 lists verbatim.
  // None of these real organisation names contain either shipped new
  // clause's vocabulary, so all continue to survive untouched.
  it.each([
    ["Battery Scientist Program - BD", "BD"],
    ["Battery Scientist Program - J&J", "J&J"],
    ["Battery Scientist Program - BMS", "BMS"],
    ["Battery Scientist Program - Tesla", "Tesla"],
    ["Battery Scientist Program - INL", "INL"],
    ["Battery Scientist Program - Oak Crest", "Oak Crest"],
    [
      "M.S. Internship Program – Oregon Center for Electrochemistry",
      "Oregon Center for Electrochemistry",
    ],
    [
      "Battery Scientist Program - Sandia National Laboratories",
      "Sandia National Laboratories",
    ],
    ["Battery Scientist Program - Kairos Power", "Kairos Power"],
    ["Battery Scientist Program - CATL", "CATL"],
    ["Opening For Marketing Intern (Ion Exchange Ltd.)", "Ion Exchange Ltd."],
    ["Battery Scientist Program - HyET Lithium", "HyET Lithium"],
  ])("keeps the must-keep `%s` untouched", (title, expected) => {
    expect(employerOf(title)).toBe(expected);
  });
});

// ───────────────────────────────────────────────────────────────────────
// B28-01 / A28-01 (round 28, item 1; Ruling 76b). THE CONJOINED SECTION
// LABEL. See the doc comment above `isConjoinedSectionLabelTitle` in
// jobweb.ts for the full design. This block is the vacuity check named
// there: false on all 37 must-keeps/traps below, false on the 6 named
// misses, true on the 12 catches it is built for.
// ───────────────────────────────────────────────────────────────────────
describe("B28-01 — the conjoined section label", () => {
  const HOST = "example.test";
  const PATH = "/careers/role";

  it.each([
    "Internships & Co-ops",
    "Internships & Co-ops Jobs",
    "Internships & Co-ops Job Opportunities",
    "Internships and co-ops",
    "Battelle Internships and Co-ops",
    "Internships & Fellowships",
    "Internships & Research Opportunities",
    "Jobs and Internships",
    "Research Careers & Internships",
    "Students and Graduates",
    // A28-01's own `careers.emdgroup.com` row, corrected: §4 round 28 A/B's
    // transcription reads "Students And Graduates I EMD Group" (a plain
    // capital I, not a pipe) — no live credentials in this run to refetch
    // the real page title, so this fixture uses the separator the design
    // itself names (` | `) rather than guessing at an unverified live
    // string. Flagged here rather than silently matched either way.
    "Students And Graduates | EMD Group",
    "Internships & Entry Level Jobs",
  ])("catches `%s`", (title) => {
    expect(isListingPage(title, HOST, PATH)).toBe(true);
  });

  // Shape two (modifier + bare programme) is REFUSED on Ruling 49a's own
  // measurement — a rule reaching these would also destroy
  // `M.S. Internship Program`, asserted as a must-keep below. Named misses,
  // not designed for.
  it.each([
    "Summer Internship Program",
    "Summer Internship Program (SIP)",
    "Science Undergraduate Laboratory Internships (SULI)",
    "Undergraduate & Graduate Intern Programs",
    // Two singletons: neither shape, no vocabulary addition for a one-row
    // miss (Ruling 32's headline).
    "Talent Network",
    "2027 AI College Jobs",
  ])("misses `%s` — named, not designed for", (title) => {
    expect(isListingPage(title, HOST, PATH)).toBe(false);
  });

  // Corpus B: this file's own recorded must-keeps (19), plus 18 traps B
  // wrote to break its own rule — end-anchored, so every trap carries a
  // real role noun after the conjoined labels.
  it.each([
    // must-keeps
    "M.S. Internship Program – Oregon Center for Electrochemistry",
    "M.S. Internship Program",
    "Internship Program: Battery Characterization Track",
    "Internship",
    "Acme Fellowship Program",
    "Research positions at CERN",
    "Head of Careers",
    "Head of Careers - Imperial College London",
    "Manager of Vacancies",
    "Head of Internships",
    "Jobs for Veterans Program Manager",
    "Job for a Battery Engineer",
    "Career for Life Coordinator",
    "Jobs Data Analyst at the Bureau of Labor Statistics",
    "Idaho National Laboratory Careers",
    // `Tesla Careers` / `Kairos Power Careers` are deliberately NOT asserted
    // here as bare `isListingPage` titles: measured, they already return
    // `true` via the pre-existing `isOwnerSectionIndexTitle` (B17-01a, an
    // owner token in front of a bare section word) — unrelated to this
    // item, which never sees a conjunction in either string. Their
    // must-keep status is about the EMPLOYER SEGMENT inside a longer title
    // (`Battery Research Scientist - Tesla Careers`), asserted above at
    // "9. THE EMPLOYER-SLOT NON-INTERFERENCE". Neither string contains `&`
    // or `and`, so B28-01's own rule cannot reach either one either way.
    "Battery Research Scientist",
    "Nuclear Materials and Molten Salt Technologist 1",
    // traps
    "Internships and Co-ops Coordinator",
    "Internships & Co-ops Program Manager",
    "Head of Internships and Careers",
    "Director of Careers and Opportunities",
    "Jobs and Internships Manager",
    "Students and Graduates Programme Lead",
    "Research Careers & Internships Officer",
    "Graduate Research Assistant",
    "Undergraduate Research Assistant",
    "Student Worker - Battery Lab",
    "Research & Development Engineer",
    "Sales & Marketing Manager",
    "Careers and Employability Adviser",
    "Vacancies and Recruitment Officer",
    "Postdoctoral Research Associate (PDRA)",
    "Research Scientist (Batteries)",
    "Summer Research Intern - Photovoltaics",
    "Graduate Engineer - Molten Salt",
  ])("keeps `%s` — a real role title, not a section label", (title) => {
    expect(isListingPage(title, HOST, PATH)).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// A27-02 (round 27, item 2). THE AGGREGATE FILTER'S FALSE POSITIVE.
//
// `LISTING_TITLE_RE`'s first alternative used the run `[\w\s,&/-]{0,40}`
// between the count and the count-noun. That class holds the HYPHEN and the
// SPACE, so it bridged a title's own segment separator: on a real, single,
// on-topic Los Alamos vacancy the engine read the job GRADE `1` as a count,
// walked `- LANL ` across the ` - `, landed on `Jobs`, and dropped the row.
// Offered 5 of 5, dropped 5 of 5, pooled 0 of 5 in round 27 A's census.
//
// The run is now made of WORD-INITIAL tokens, which is exactly the treatment
// the shipped class already gave the PIPE (`|` was never in it, so
// `1,200 | Engineering Jobs` was already admitted before this change).
//
// The whole shipped must-drop corpus above is unchanged and still green; these
// blocks pin the two rows that MOVE and the two boundaries that MUST NOT.
// ───────────────────────────────────────────────────────────────────────
describe("A27-02: a segment separator between the count and the count-noun", () => {
  const LANL_PATH =
    "/search/jobdetails/nuclear-materials-and-molten-salt-technologist-1---research-technologist-1/9afb00cb";

  it("admits the real LANL vacancy whose job grade was read as a count", () => {
    expect(
      isListingPage(
        "Nuclear Materials and Molten Salt Technologist 1 - LANL Jobs",
        "lanl.jobs",
        LANL_PATH,
      ),
    ).toBe(false);
  });

  it("admits the same shape on an unrelated host — it was never host-specific", () => {
    // A's own control. `sandia.gov` is not an aggregator and shares no
    // vocabulary with `lanl.jobs`; the defect was in the title rule alone.
    expect(
      isListingPage(
        "Research Technologist 3 - Sandia Jobs",
        "sandia.gov",
        "/careers/job/12345",
      ),
    ).toBe(false);
  });

  it("still drops a separator-led count on an AGGREGATOR host — the backstop", () => {
    // Residual 1, priced rather than hidden. This exact title on a
    // NON-aggregator host is now admitted (constructed, never sighted, and the
    // pipe form was already admitted). On the nine `AGGREGATOR_HOSTS` the URL
    // limb still drops it, so the admission-side judgement is locked here
    // rather than assumed.
    expect(
      isListingPage("1,200 - Engineering Jobs", "indeed.com", "/q-engineering-jobs.html"),
    ).toBe(true);
  });

  it.each(["500 Entry-Level Battery R&D Jobs", "1,200 Full-Time Jobs"])(
    "still drops a genuine aggregate whose noun phrase contains a hyphen or ampersand: %s",
    (title) => {
      // The `[\w,&/-]*` tail inside each token. This is the clause a later
      // tidy-up would delete first, so it gets its own red case.
      expect(isListingPage(title, "example.test", "/jobs")).toBe(true);
    },
  );

  it("keeps the empty run firing — the count-noun may follow the count directly", () => {
    // The group is optional and carries its own trailing `\s+`; make it
    // MANDATORY and `12345 vacancies` stops matching this rule.
    //
    // DISCLOSED VACUITY, FOUND BY MUTATION: asserting this through
    // `isListingPage` alone is DECORATION — with the group made mandatory the
    // whole file stayed green, because a sibling limb drops that title too.
    // The clause is only uniquely red at the rule itself, so the rule is what
    // is asserted first. The chain assertion below is kept as an ADMITTED
    // CONTROL: it records the end-to-end verdict, not this clause.
    expect(LISTING_TITLE_RE.test("12345 vacancies")).toBe(true);
    expect(isListingPage("12345 vacancies", "example.test", "/jobs")).toBe(true);
    // `999 Battery Openings` has a token in its run, so it is NOT a witness
    // for optionality — it is here as the shipped B13-02 must-drop it is.
    expect(isListingPage("999 Battery Openings", "example.test", "/jobs")).toBe(true);
  });

  it("bounds the run's reach at six tokens", () => {
    // The `{0,6}` cap replaces the reach limit the `{0,40}` characters
    // provided. It is one leading token plus up to six more, so SEVEN tokens
    // still bridge and an eighth does not — measured, not assumed.
    expect(LISTING_TITLE_RE.test("60 a b c d e f g Jobs")).toBe(true);
    expect(LISTING_TITLE_RE.test("60 a b c d e f g h Jobs")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// RULING 75 (round 28 C, item 0) — THE PROVIDER SEAM ON THIS SURFACE.
//
// Same shape as eventweb's block, and the same two defects: this adapter never
// read `webSearch.provider`, and with Tavily disabled it was dark. The one job
// surface-specific rule is at the bottom — **no aggregator pre-screen**.
// ═══════════════════════════════════════════════════════════════════════════

describe("RULING 75 — jobweb provider resolution", () => {
  const baseQuery = {
    topics: ["molten salt"],
    queries: ["molten salt postdoc"],
    locations: [],
    limit: 60,
  };

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
    expect(jobweb.enabled(baseQuery)).toBe(false);
  });

  // ABC-freemium 2-04 — an ENTITLED query. Every case below that exercises
  // provider resolution now has to say so, because Vertex and grounding sit
  // behind `systemSearchAllowed` exactly as the Tavily and Brave keys do.
  const entitledQuery = {
    ...baseQuery,
    webSearch: { systemSearchAllowed: true },
  };

  it("stays DARK even when Vertex is present and the query asks for gemini", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12), Ruling 13
    // point 4. Was "comes back on when Vertex is present…", asserting
    // `.toBe("gemini")` and `enabled` true.
    //
    // A RULING 75 case inherited from the report-parity loop, whose subject D2a
    // removed: grounding is operator-funded and so is unreachable on every
    // plan. Rewritten in place with the same inputs because the inverted
    // assertion is the stronger statement — a configured Vertex project, an
    // explicit `provider` preference AND a forced entitlement flag together
    // still reach nothing.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    const query = {
      ...baseQuery,
      webSearch: { provider: "gemini" as const, systemSearchAllowed: true },
    };
    expect(resolveSearchProvider(query)).toBeNull();
    expect(jobweb.enabled(query)).toBe(false);
  });

  it("refuses an EXPLICIT gemini or vertex preference when the reader is not entitled", () => {
    // THE case an order-only fix would have left open, and the reason 2-04
    // gates the availability inputs rather than the ordering clauses. The
    // pipeline sets `provider` from the server's own environment, so a free or
    // anonymous caller lands on the explicit branch and never reaches the auto
    // order at all.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "peer-web");

    for (const provider of ["gemini", "vertex"] as const) {
      const query = {
        ...baseQuery,
        webSearch: { provider, systemSearchAllowed: false },
      };
      expect(resolveSearchProvider(query)).toBeNull();
      expect(jobweb.enabled(query)).toBe(false);
    }
  });

  it("picks NOTHING on auto, entitled or not, once the operator stops paying", () => {
    // REWRITTEN, NOT DELETED — 5-04 · D2a, Ruling 13 point 4. Was "picks gemini
    // on auto when the reader is entitled…" and asserted `.toBe("gemini")` for
    // the entitled query. Both halves now answer `null`: under D2a the
    // entitlement no longer changes what search a reader gets, because nobody
    // gets operator-funded search.
    withoutKeys();
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    expect(resolveSearchProvider(entitledQuery)).toBeNull();
    expect(resolveSearchProvider(baseQuery)).toBeNull();
  });

  // CREDIT MIGRATION — the new default, pinned beside the old one.
  it("does NOT pick vertex on auto, even with a Search App configured", () => {
    // REWRITTEN, NOT DELETED — 5-04 · D2a, Ruling 13 point 4. Was "picks vertex
    // on auto once a Search App is configured", asserting `.toBe("vertex")`. A
    // configured Vertex AI Search app is operator-funded search, so D2a makes it
    // unreachable however completely it is configured. The CREDIT MIGRATION
    // ordering this used to pin (a Search App outranks grounding) no longer
    // decides anything, and the case records that rather than pretending.
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

  // ABC-freemium 1-05 · R-KEY-3 — REWRITTEN, NOT DELETED. This case asserted
  // that the operator's environment Tavily key alone resolved `"tavily"`. That
  // was the leak: nothing on that path read a session or an entitlement, so an
  // unauthenticated request spent the operator's search credits. The env key now
  // requires `systemSearchAllowed`, which only the route can set and only from
  // the entitlement, so the case is split in two and both halves are asserted.
  it("NEVER spends the operator's env Tavily key, entitled or not (D2a)", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12). The entitled
    // half asserted `.toBe("tavily")` and `enabled` true; it now answers `null`
    // and `false` like the unentitled half. The env key is armed on purpose, so
    // zero is a statement about the gate and not about an empty environment.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("TAVILY_API_KEY", "env-tavily");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");

    // Not entitled — and a query that says nothing is not entitled either.
    expect(resolveSearchProvider(baseQuery)).toBeNull();
    expect(jobweb.enabled(baseQuery)).toBe(false);

    // "Entitled" — and it makes no difference any more. That is the whole of
    // D2a: the operator's key has no branch left to be reached from.
    const entitled = {
      ...baseQuery,
      webSearch: { systemSearchAllowed: true },
    };
    expect(resolveSearchProvider(entitled)).toBeNull();
    expect(jobweb.enabled(entitled)).toBe(false);
  });

  it("spends the operator's env Brave key only when the request is entitled", () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 2-04 · Ruling 5 point 2. This case
    // was "keeps the shipped Brave behaviour exactly", and its comment said
    // R-KEY-3 leaves Brave ungated because D2 bans it on Vercel. A ban on
    // Vercel is not a gate on a self-host or a developer machine, and Brave is
    // operator-funded on both. Split in two exactly like the Tavily case above,
    // with both halves asserted.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "env-brave");

    // Not entitled.
    expect(resolveSearchProvider(baseQuery)).toBeNull();
    expect(jobweb.enabled(baseQuery)).toBe(false);

    // Entitled: the shipped behaviour, unchanged.
    expect(resolveSearchProvider(entitledQuery)).toBe("brave");
    expect(jobweb.enabled(entitledQuery)).toBe(true);
  });

  it("an aggregator row still reaches the shipped posting-id rule, not a pre-screen", () => {
    // ADMISSION-NEUTRALITY, PROVED RATHER THAN ARGUED. The gemini adapter is
    // deliberately given NO deny list on this surface: `AGGREGATOR_HOSTS` does
    // not deny, it REQUIRES a posting id. These two rows are the control pair —
    // both on the same aggregator host, admitted and refused by the posting id
    // alone. A host pre-screen would have silenced both.
    const admitted = webResultToRawJobItem(
      {
        title: "Postdoctoral Researcher, Molten Salt Chemistry",
        url: "https://www.indeed.com/viewjob?jk=abc123def456",
        snippet: "Apply now for this research position.",
      },
      ["molten salt"],
    );
    const refused = webResultToRawJobItem(
      {
        title: "Postdoctoral Researcher, Molten Salt Chemistry",
        url: "https://www.indeed.com/q-molten-salt-jobs.html",
        snippet: "Apply now for this research position.",
      },
      ["molten salt"],
    );
    expect(admitted).not.toBeNull();
    expect(refused).toBeNull();
  });
});

// RULING 75 — STAGE 2b's BOUNDARY, PROVED AT THE SEAM.
// The job surface hands the gemini adapter NO deny list, and that omission is
// the design. `AGGREGATOR_HOSTS` is the obvious candidate and exactly the wrong
// one: this surface does not DENY those hosts, it REQUIRES a posting id on
// them, so pre-screening would drop rows the shipped rule admits. If a deny
// list ever appears in these options, this test is what says so.
describe("RULING 75 — jobweb hands the gemini adapter NO deny list", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    geminiSearchMock.mockReset();
  });

  it("never calls the gemini adapter, so it passes no options at all (D2a)", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · **Ruling 13 point 4**, option
    // (a). Old assertions kept verbatim so the knowledge survives the coverage:
    //
    //     expect(geminiSearchMock).toHaveBeenCalledTimes(1);
    //     const options = geminiSearchMock.mock.calls[0][1] as Record<string, unknown>;
    //     expect(options.denyHosts).toBeUndefined();
    //     expect(options.excludeDomains).toBeUndefined();
    //
    // **ACCEPTED COVERAGE COST — 1 of the 4 A tallies every round** ("Ruling 75
    // option-building cases now asserting absence rather than content"). The
    // code under test is jobweb's own option construction inside `fetchImpl`,
    // which D2a makes unreachable; re-pointing it would need a production seam
    // D2a did not ask for. **Threshold: if grounding is re-enabled for any plan,
    // all four go back to content assertions in the same round.**
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    geminiSearchMock.mockResolvedValue([]);

    const items = await jobweb.fetch({
      topics: ["molten salt"],
      queries: ["molten salt postdoc"],
      locations: [],
      limit: 60,
      webSearch: { provider: "gemini", systemSearchAllowed: true },
    });

    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(items).toEqual([]);
  });

  it("never reaches the suffixing step, because the adapter is never called (D2a)", async () => {
    // REWRITTEN, NOT DELETED — 5-04 · Ruling 13 point 4, option (a). The old
    // assertion, kept verbatim:
    //
    //     expect(geminiSearchMock.mock.calls[0][0]).toBe(
    //       "molten salt postdoc position opening apply",
    //     );
    //
    // **ACCEPTED COVERAGE COST — 2 of the 4.** The query-suffixing rule loses
    // live coverage under D2a; same threshold as above.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    geminiSearchMock.mockResolvedValue([]);

    await jobweb.fetch({
      topics: ["molten salt"],
      queries: ["molten salt postdoc"],
      locations: [],
      limit: 60,
      webSearch: { provider: "gemini", systemSearchAllowed: true },
    });

    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(geminiSearchMock.mock.calls).toEqual([]);
  });

  it("maps a grounded row through the SHIPPED admission, unchanged", async () => {
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    geminiSearchMock.mockResolvedValue([
      {
        title: "Nuclear Materials and Molten Salt Technologist 1",
        url: "https://lanl.jobs/search/jobdetails/nuclear-materials/992",
        snippet: "Los Alamos National Laboratory is hiring.",
      },
      {
        // The listing page the shipped rule refuses. It arrives with a real
        // page title, and it is still refused — the provider swap moved the
        // TITLE SOURCE, not the admission rules.
        title: "60 Molten Salt Jobs, Employment July 22, 2026 (9 New Openings)",
        url: "https://www.indeed.com/q-molten-salt-jobs.html",
        snippet: "Browse openings.",
      },
    ]);

    const rows = await jobweb.fetch({
      topics: ["molten salt"],
      queries: ["molten salt postdoc"],
      locations: [],
      limit: 60,
      webSearch: { provider: "gemini", systemSearchAllowed: true },
    });

    // REWRITTEN, NOT DELETED — 5-04 · Ruling 13 point 4, option (a). The old
    // assertions, kept verbatim:
    //
    //     expect(rows).toHaveLength(1);
    //     expect(rows[0].title).toBe(
    //       "Nuclear Materials and Molten Salt Technologist 1",
    //     );
    //
    // **ACCEPTED COVERAGE COST — 3 of the 4.** The shipped admission rule
    // (a real posting admits, an aggregator LISTING page does not, however
    // real its page title) is still enforced everywhere else in this file for
    // the providers that remain reachable; what it loses is its proof on the
    // GROUNDED row shape specifically. Same threshold as above.
    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 1 (A29-01, job side) — family (ii) abstain-on-absence.
// Ruling 79a. Each case is uniquely red without the clause.
// ---------------------------------------------------------------------------

describe("A29-01 — absence is not evidence (job side)", () => {
  // THE PATH BELOW IS DELIBERATELY NOT JOB-SHAPED. `JOB_PATH_RE` matches
  // `/opportunity/`, `/position/`, `/vacancy/` and six more, so a row on any of
  // those admits today for reasons that have nothing to do with this clause —
  // a test built on one would be VACUOUS and would pass with the clause
  // reverted. `/listing/` matches neither `JOB_PATH_RE` nor `NON_JOB_PATH_RE`,
  // and `Technologist` is not in `JOB_TEXT_RE`, so BOTH arms are genuinely
  // silent here and only the abstain clause can decide the row.
  const STARVED = {
    title: "Nuclear Materials and Molten Salt Technologist 1",
    url: "https://example.org/listing/48211",
  };

  it("ABSTAINS instead of refusing when the snippet is empty after trim", () => {
    // The shipped disjunction refused on the second arm's SILENCE; a kind miss
    // belongs on the ADMISSION side.
    expect(webResultToRawJobItem({ ...STARVED, snippet: "  " })).not.toBeNull();
  });

  it("still REFUSES when a snippet is present and neither arm names a job", () => {
    // The admitted control. A present description is tested exactly as before,
    // however short — "absent" means EMPTY, never "short".
    const item = webResultToRawJobItem({
      ...STARVED,
      snippet: "Our laboratory studies the chemistry of high temperature salts.",
    });
    expect(item).toBeNull();
  });

  it("keeps admitting on the TITLE alone when the snippet is empty", () => {
    const item = webResultToRawJobItem({
      title: "Postdoctoral Position in Molten Salt Electrochemistry",
      url: "https://example.org/listing/48212",
      snippet: "",
    });
    expect(item).not.toBeNull();
  });

  it("does NOT weaken the guards that still have evidence", () => {
    // The boundary that keeps B's adversarial shapes dropping. `isListingPage`
    // runs BELOW this gate and `NON_JOB_PATH_RE` ABOVE it; an empty snippet
    // moves neither.
    expect(
      webResultToRawJobItem({
        title: "60 Molten Salt Jobs, Employment July 22, 2026 (9 New Openings)",
        url: "https://indeed.com/jobs",
        snippet: "",
      }),
    ).toBeNull();
    expect(
      webResultToRawJobItem({
        title: "Molten Salt Technologist Named Fellow",
        url: "https://example.org/news/molten-salt-technologist-named-fellow",
        snippet: "",
      }),
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// ROUND 29 C, ITEM 3 (A29-04) — the structural careers-section-root rule.
// Round 29 B's ten-row corpus, plus the boundaries B stated.
// ---------------------------------------------------------------------------

describe("A29-04 — a careers section root is a path that ends at the section", () => {
  it("closes A's falsifier pair — the same page in any language", () => {
    // One site, one path, one section. Before this item the English label was
    // refused and every other language reached a reader as a role title.
    for (const label of [
      "Careers",
      "キャリア",
      "Carrières",
      "Empleo",
      "Karriere",
      "採用情報",
      "Vagas",
    ]) {
      expect(isListingPage(label, "ionexchangeglobal.com", "/int/careers/")).toBe(true);
    }
  });

  it("classes B's five section roots as index pages", () => {
    expect(isListingPage("キャリア", "acme.com", "/careers/")).toBe(true);
    expect(isListingPage("キャリア", "acme.com", "/careers")).toBe(true);
    expect(isListingPage("採用情報", "acme.co.jp", "/jp/recruit/")).toBe(true);
    expect(isListingPage("キャリア", "acme.com", "/careers/jobs/")).toBe(true);
    expect(isListingPage("Empleo", "acme.es", "/es/empleo")).toBe(true);
  });

  it("leaves B's five posting paths alone — 0 of 10 wrong", () => {
    // **B's shape-2 row is a REAL POSTING and must KEEP.** Its path continues
    // past the section segment, so the rule cannot reach it — which is the
    // whole point of choosing structure over vocabulary.
    expect(
      isListingPage(
        "Careers Open application",
        "hyetlithium.com",
        "/careers/internship-battery-research/",
      ),
    ).toBe(false);
    expect(isListingPage("Postdoc 2026", "acme.com", "/careers/postdoc-2026")).toBe(false);
    expect(isListingPage("Battery Engineer", "acme.com", "/jobs/12345")).toBe(false);
    expect(isListingPage("MSR Fuel Cycle", "postdocjobs.com", "/posting/7308863")).toBe(false);
    expect(
      isListingPage(
        "Nuclear Materials and Molten Salt Technologist 1",
        "lanl.jobs",
        "/search/jobdetails/x/1",
      ),
    ).toBe(false);
  });

  it("BOTH halves of the conjunction are required — the title half", () => {
    // B's boundary, verbatim: "A real posting that happens to sit at
    // `/careers/` with a role-shaped title must not be dropped."
    expect(isListingPage("Postdoctoral Researcher", "acme.com", "/careers/")).toBe(false);
    expect(isListingPage("Battery R&D Internship", "acme.com", "/careers")).toBe(false);
  });

  it("BOTH halves of the conjunction are required — the path half", () => {
    // A section-shaped title on a path that is not a section root is decided by
    // the title rules that already existed, not by this one.
    expect(isListingPage("キャリア", "acme.com", "/about/team")).toBe(false);
  });

  it("does not fire on a query string", () => {
    // A board that hangs a posting id off a section root must not be deleted on
    // evidence nobody measured. C wrote an explicit `includes("?")` guard for
    // this and the mandated revert proved it VACUOUS — the query rides in the
    // last path segment and fails the section test by itself. The guard was
    // deleted; this assertion is kept, so the behaviour stays checked.
    expect(isListingPage("キャリア", "acme.com", "/careers/?gh_jid=1234")).toBe(false);
    expect(isListingPage("キャリア", "acme.com", "/careers?gh_jid=1234")).toBe(false);
  });

  it("an absent title never fires the rule", () => {
    expect(isListingPage("", "acme.com", "/careers/")).toBe(false);
    expect(isListingPage("   ", "acme.com", "/careers/")).toBe(false);
  });

  it("does not touch the two locked constants' own behaviour", () => {
    // 76b/49a: `CAREERS_INDEX_TITLE_RE` keeps its second call site — the
    // employer-candidate veto — so these must still be seen as section labels
    // by that regex and NOT be silenced anywhere by this item.
    expect(CAREERS_INDEX_TITLE_RE.test("Careers")).toBe(true);
    expect(CAREERS_INDEX_TITLE_RE.test("Tesla Careers")).toBe(false);
    expect(CAREERS_INDEX_TITLE_RE.test("Kairos Power Careers")).toBe(false);
  });
});

// Round 30, Ruling 81b (B's item 2, the V2 structural-guard extensions,
// approved as written). `CAREERS_SECTION_SEGMENT_RE`'s two additions: a
// static-page file extension tolerance, and the one witnessed compound
// `career-paths?`. See the constant's own doc comment in jobweb.ts.
describe("Round 30, Ruling 81b — the careers-section-segment V2 extension", () => {
  it("catches the two live careers-explorer specimens B reproduced", () => {
    expect(
      isListingPage(
        "Career Paths - MIT Department of Materials Science and Engineering",
        "dmse.mit.edu",
        "/about-us/career-paths/",
      ),
    ).toBe(true);
    expect(
      isListingPage(
        "Careers and Outcomes - Materials Science Graduate Program",
        "physics.missouristate.edu",
        "/MaterialsScience/careers.htm",
      ),
    ).toBe(true);
  });

  it("leaves the real geosi.com posting untouched", () => {
    expect(
      isListingPage(
        "Battery Materials Scientist | Green Energy Origin (GEO)",
        "geosi.com",
        "/job-opening/battery-materials-scientist/",
      ),
    ).toBe(false);
  });

  it("does NOT catch a constructed `careers-advisor-job` posting path — the deliberate boundary", () => {
    // B's own §2.3 adversarial check: a real `Career Advisor`-titled posting
    // at a hyphen-qualified `careers`-shaped path must survive, because the
    // extension is a closed exact-alternative list, not a hyphen-prefix or
    // substring rule.
    expect(
      isListingPage("Career Advisor", "acme.com", "/careers-advisor-job/"),
    ).toBe(false);
  });
});

// ───────────────────────────────────────────────────────────────────────
// Round 31 C (Ruling 84a, implementing B's item 1 §1.2 verbatim). A30-01:
// `BALDER Project (Licensing Support for a Molten Salt Reactor)` rendered as
// the employer for a real `psi.ch` internship. See `looksLikeProjectLabelWithDescription`
// in jobweb.ts for the full design. Five assertion groups, per the commission.
describe("Round 31 C — a trailing `Project (<description>)` is not an employer (Ruling 84a)", () => {
  const employerOf = (title: string, url = "https://careers.acme.test/job/55231") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  // GROUP 1 — the live specimen, exact recorded title/url, catches it with
  // honest silence (no other candidate survives behind it).
  it("catches the live specimen — `BALDER Project (Licensing Support for a Molten Salt Reactor)`", () => {
    expect(
      webResultToRawJobItem(
        {
          title:
            "Summer Internship Opportunity - BALDER Project (Licensing Support for a Molten Salt Reactor)",
          url: "https://www.psi.ch/en/ahl/summer-internship-2026",
          snippet:
            "PSI is looking for a summer intern to support licensing work for a molten salt reactor project. Apply now for this internship opportunity.",
        },
        ["molten salt"],
      )?.company,
    ).toBeUndefined();
  });

  // GROUP 2 — the 21-row must-keep corpus (round 30 B item 1 §1.0, verbatim).
  // None share the `Project (<description>)` shape, so all survive untouched.
  it.each([
    "BD",
    "J&J",
    "BMS",
    "Tesla",
    "INL",
    "Oak Crest",
    "Thermo Fisher Scientific",
    "Battery Ventures",
    "GSK US",
    "Johnson & Johnson",
    "Sandia National Laboratories",
    "Idaho National Laboratory",
    "Oregon Center for Electrochemistry",
    "Ionis Pharmaceuticals",
    "Department of Energy",
    "HyET Lithium",
    "CATL",
    "AquaBattery",
    "Ion Exchange",
    "Ion Exchange Ltd.",
    "Kairos Power",
  ])("keeps the must-keep `%s` untouched", (name) => {
    expect(employerOf(`Battery Scientist Program - ${name}`)).toBe(name);
  });

  // GROUP 3 — nine constructed real "Project"-named organisations. This is
  // the adversarial pass that keeps the veto keyed on STRUCTURE, not the
  // bare word "Project" — a bare-word veto would delete every one of these.
  it.each([
    "Project44",
    "Project HOPE",
    "Project Management Institute",
    "The Manhattan Project",
    "Project HOPE (Global Health)",
    "Project Canary",
    // The first-draft regression case: an end-anchored designator check
    // missed this because "Institute" doesn't END the inner string. Must
    // SURVIVE — see the doc comment above `ORG_DESIGNATOR_ANYWHERE_RE`.
    "Genome Research Project (Institute of Genomics)",
    // Short qualifying tags, not descriptions — caught by the 3-word floor.
    "XYZ Project (US)",
    "XYZ Project (Ltd)",
  ])("does NOT veto the real organisation name `%s`", (name) => {
    expect(employerOf(`Battery Scientist Program - ${name}`)).toBe(name);
  });

  // GROUP 4 — the 14-row must-drop corpus (round 30 B item 1 §1.0, verbatim).
  // Not this veto's job — none share the `Project (<description>)` shape, so
  // this addition changes nothing about how they are already handled: the
  // ones a pre-existing guard already vetoes stay `undefined`; the ones that
  // are still an unaddressed, named residual (`CSE`, `Chemistry`, `Chemical
  // Engineering`, the `@ Septerna` shape, `Career Connections Center
  // University of Florida`) still survive as their own full string, exactly
  // as before this item shipped — confirmed by direct execution, not
  // assumed.
  it.each([
    ["Research Technologist 1", undefined],
    ["Internship battery R&D", undefined],
    ["Focused Ion Beam, Electron Microscopy ...", undefined],
    ["Co-ops", undefined],
    ["Youth & Young Adult Programs ...", undefined],
    ["CSE", "CSE"],
    ["Chemistry", "Chemistry"],
    ["Chemical Engineering", "Chemical Engineering"],
    ["Career Services", undefined],
    ["Kairos Power, Alameda, California, United States", "Kairos Power"],
    [
      "Medicinal Chemistry (Graduate Student level) @ Septerna",
      "Medicinal Chemistry (Graduate Student level) @ Septerna",
    ],
    [
      "Career Connections Center University of Florida",
      "Career Connections Center University of Florida",
    ],
    ["Membrane Scientist for Electrodialysis", undefined],
    ["EV.Careers", undefined],
  ] as const)("must-drop corpus row `%s` is unaffected by this veto", (name, expected) => {
    expect(employerOf(`Battery Scientist Program - ${name}`)).toBe(expected);
  });

  // GROUP 5 — zero collision with the `isListingPage` matrix row `Project
  // and Website Coordinator` (jobweb.test.ts, the round 13 live-postings
  // matrix). That string contains "Project" but never a trailing
  // `Project (<...>)` parenthetical, so this new employer-slot veto (a
  // different function entirely, `looksLikeProjectLabelWithDescription`)
  // cannot match it either.
  it("does not collide with the isListingPage matrix row `Project and Website Coordinator`", () => {
    expect(
      employerOf("Battery Scientist Program - Project and Website Coordinator"),
    ).toBe("Project and Website Coordinator");
    // The isListingPage assertion itself is already locked at :814/:820 —
    // unchanged and re-confirmed still true by the full suite run.
  });
});

// ---------------------------------------------------------------------------
// ROUND 32 C, ITEM 1 (A31-01, Ruling 87a) — the job page-kind guard: three
// additive components. Component A (`NON_JOB_HOSTS`/`isNonJobHost`) and
// Component B (`DATE_STRUCTURED_PATH_RE`/`isDateStructuredResearchPath`) run
// at `webResultToRawJobItem`'s early kind-rejection point, immediately after
// `NON_JOB_PATH_RE`. Component C (`isBrandOnlySearchResultsPage`) is an
// additive clause inside `isListingPage`, alongside `isCareersSectionRoot`.
// Corpus verbatim from Round 32 B's §1.2 table.
// ---------------------------------------------------------------------------
describe("Round 32 C, ITEM 1 — job page-kind guard (Components A, B, C; Ruling 87a)", () => {
  describe("must CATCH — 5 of 5, per B's §1.2 table", () => {
    it("drops the live en.wikipedia.org specimen (Component A, host)", () => {
      expect(
        webResultToRawJobItem({
          title: "Topochemical polymerization - Wikipedia",
          url: "https://en.wikipedia.org/wiki/Topochemical_polymerization",
          snippet:
            "Topochemical polymerization is a type of polymerization reaction.",
        }),
      ).toBeNull();
    });

    it("drops a constructed de.wikipedia.org specimen (Component A, language-subdomain suffix)", () => {
      expect(
        webResultToRawJobItem({
          title: "Topochemische Polymerisation – Wikipedia",
          url: "https://de.wikipedia.org/wiki/Topochemische_Polymerisation",
          snippet: "Die topochemische Polymerisation ist eine Reaktion.",
        }),
      ).toBeNull();
    });

    it("drops the live foundry.lbl.gov specimen (Component B, date-structured research path)", () => {
      expect(
        webResultToRawJobItem({
          title: "Slowing Down to Speed Up",
          url: "https://foundry.lbl.gov/2025/07/11/slowing-down-to-speed-up/",
          snippet: "A Molecular Foundry researcher describes a new technique.",
        }),
      ).toBeNull();
    });

    it.each([
      [
        "query 1 (summer-2027-chemical-engineering-intern)",
        "https://jobright.ai/jobs/summer-2027-chemical-engineering-intern-jobs-in-united-states",
      ],
      [
        "query 2 (battery-management-algorithms-internship)",
        "https://jobright.ai/jobs/battery-management-algorithms-internship-jobs-in-united-states",
      ],
    ])(
      "drops the live jobright.ai brand-tagline row, %s (Component C)",
      (_label, url) => {
        expect(
          webResultToRawJobItem({
            title: "Jobright: Your AI Job Search Copilot",
            url,
            snippet: "",
          }),
        ).toBeNull();
      },
    );
  });

  describe("must-keep corpus — 0 of 11 false positives, per B's §1.2 table", () => {
    it("keeps psi.ch's BALDER row — renders with honest-silent company, NOT dropped", () => {
      const item = webResultToRawJobItem(
        {
          title:
            "Summer Internship Opportunity - BALDER Project (Licensing Support for a Molten Salt Reactor)",
          url: "https://www.psi.ch/en/ahl/summer-internship-2026",
          snippet:
            "PSI is looking for a summer intern to support licensing work for a molten salt reactor project. Apply now for this internship opportunity.",
        },
        ["molten salt"],
      );
      expect(item).not.toBeNull();
      expect(item?.company).toBeUndefined();
    });

    it("keeps careers.gevernova.com", () => {
      expect(
        isListingPage(
          "Battery Engineer",
          "careers.gevernova.com",
          "/global/en/job/GEVEGLOBAL12345/Battery-Engineer",
        ),
      ).toBe(false);
      expect(
        webResultToRawJobItem({
          title: "Battery Engineer",
          url: "https://careers.gevernova.com/global/en/job/GEVEGLOBAL12345/Battery-Engineer",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("keeps talents.vaia.com", () => {
      expect(
        webResultToRawJobItem({
          title: "Postdoctoral Research Associate - Talents by Vaia",
          url: "https://talents.vaia.com/companies/savannah-river-national-laboratory/jobs/1234",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("keeps hyetlithium.com", () => {
      expect(
        webResultToRawJobItem({
          title: "Internship Battery R&D",
          url: "https://hyetlithium.com/careers/internship-battery-research",
          snippet: "Apply now for this internship.",
        }),
      ).not.toBeNull();
    });

    it("keeps postdocjobs.com", () => {
      expect(
        webResultToRawJobItem({
          title: "Postdoctoral Fellow | Job posted on PostdocJobs.com",
          url: "https://postdocjobs.com/job/999003",
          snippet: "Postdoctoral research position. Apply now.",
        }),
      ).not.toBeNull();
    });

    it("keeps ev.careers / Tesla", () => {
      expect(
        webResultToRawJobItem({
          title: "Battery Engineering Internship at Tesla | EV.Careers",
          url: "https://ev.careers/jobs/9917",
          snippet: "Battery research internship. Apply now.",
        }),
      ).not.toBeNull();
    });

    it("keeps enovix.wd12.myworkdayjobs.com", () => {
      expect(
        webResultToRawJobItem({
          title: "Battery Manufacturing Engineer",
          url: "https://enovix.wd12.myworkdayjobs.com/en-US/Enovix/job/Fremont-CA/Battery-Manufacturing-Engineer_R1234",
          snippet: "Apply now for this open position at Enovix.",
        }),
      ).not.toBeNull();
    });

    it("keeps bebee.com", () => {
      expect(
        webResultToRawJobItem({
          title: "Battery Research Engineer - San Francisco",
          url: "https://bebee.com/job/20260101-battery-research-engineer-san-francisco",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("keeps jobright.ai's own real-posting numeric-ID control (jobweb.test.ts admitted-control shape)", () => {
      expect(
        webResultToRawJobItem({
          title:
            "Internship, Battery Engineering (summer 2026) Jobs in United States",
          url: "https://jobright.ai/jobs/some-other-role-12345",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("keeps enersys.com's shipped brochure-host must-keep (Ruling 49a) — sanity check on the new brand-only check", () => {
      expect(
        isListingPage(
          "EnerSys Summer Internship - Battery Chemistry",
          "enersys.com",
          "/careers/1234",
        ),
      ).toBe(false);
    });
  });

  describe("adversarial: must NOT drop a genuine posting — 0 of 4, per B's §1.2 table", () => {
    it("does not drop on 'wikipedia' as a substring, not a suffix, of the host", () => {
      expect(
        webResultToRawJobItem({
          title: "Battery Research Scientist",
          url: "https://wikipedia.org.fake-mirror.test/jobs/12345",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("does not drop a date-structured path whose title carries real job vocabulary (title safety net)", () => {
      expect(
        webResultToRawJobItem({
          title: "Postdoctoral Researcher in Battery Chemistry - Apply Now",
          url: "https://example.test/2026/03/15/postdoctoral-researcher-battery-chemistry/",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("does not drop a `<Company>: <role>` title at a non-listing URL", () => {
      expect(
        webResultToRawJobItem({
          title: "Acme Corp: Battery Research Scientist",
          url: "https://acme.test/careers/battery-research-scientist",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });

    it("does not drop a brand-shaped title at a non-listing-slug URL", () => {
      expect(
        webResultToRawJobItem({
          title: "Jobright: Your AI Job Search Copilot",
          url: "https://example.test/careers/battery-engineer-12345",
          snippet: "Apply now for this open position.",
        }),
      ).not.toBeNull();
    });
  });
});

// Phase 3 round 6 C, ITEM 6 (J7, Rulings 123f/123g item 6): TRAILING_ZIP_RE,
// an additional OR-clause inside looksLikeBareLocation alongside the
// existing state-code check. Corpus per Phase 3 round 5 B, IF-BUDGET-REMAINS
// ITEMS. "Cell" (the bare-generic-word witness) stays dispositioned per A's
// own open-class caution — not attempted here, per the brief.
describe("J7 — the ZIP-ending location shape (Phase 3 round 6 C, ITEM 6)", () => {
  const employerOf = (title: string, url = "https://careers.acme.test/job/44231") =>
    webResultToRawJobItem(
      { title, url, snippet: "We are hiring a research scientist. Apply now." },
      ["battery", "molten salt", "electrochemistry"],
    )?.company;

  describe("must-catch", () => {
    it("rejects the live diedremoire.com witness's ZIP-ending candidate, end to end", () => {
      expect(
        employerOf(
          "Battery Materials Research Scientist - Lansing, MI, Michigan, 11021",
          "https://diedremoire.com/Battery-Materials-Research-Scientist-Lansing-MI-1044-1-11021.html",
        ),
      ).toBeUndefined();
    });

    it("rejects the same candidate shape regardless of URL — the guard is title-structural, not host-specific", () => {
      expect(
        employerOf("Battery Scientist - Lansing, MI, Michigan, 11021"),
      ).toBeUndefined();
    });

    it("also rejects the extended ZIP+4 form", () => {
      expect(
        employerOf("Battery Scientist - Lansing, MI, Michigan, 11021-4567"),
      ).toBeUndefined();
    });
  });

  describe("regression — TRAILING_STATE_CODE_RE's own contract is byte-unchanged", () => {
    it("still rejects a bare state-code-ending candidate outright", () => {
      expect(employerOf("Battery Research Scientist - Cambridge, MA")).toBeUndefined();
    });

    it("still leaves a state-code tail to the pre-existing guard when a real employer precedes it", () => {
      expect(
        employerOf("Battery Scientist - Acme Energy Ltd, Cambridge, MA"),
      ).toBeUndefined();
    });
  });

  // The nuance B checked rather than glossed over: a DIFFERENT, later-stage
  // mechanism (clause 3, `trimEmployerAddressTail`, Ruling 49b/62d) governs
  // an ONLY-an-address candidate that ends in a COUNTRY, not a ZIP — the two
  // must not collide, and they don't, because neither of these strings ends
  // in a trailing ZIP at all.
  describe("regression — clause 3's address-tail trim is unaffected (neither case ends in a ZIP)", () => {
    it("still trims a postal address off an otherwise correct employer", () => {
      expect(
        employerOf(
          "Nuclear Engineering Internship - Summer 2027 at Kairos Power, Alameda, California, United States | Intern Insider",
        ),
      ).toBe("Kairos Power");
    });

    it("still leaves a candidate that is ONLY a country-ending address fully visible, not rejected to blank", () => {
      expect(
        employerOf("Battery Research Scientist - Alameda, California, United States"),
      ).toBe("Alameda, California, United States");
    });
  });

  describe("must-keep — adversarial digit-bearing and short real company names", () => {
    it.each([
      "3M",
      "7-Eleven",
      "Booking.com",
      "23andMe",
      "Mercor",
    ])("keeps `%s` untouched", (company) => {
      expect(employerOf(`Battery Scientist - ${company}`)).toBe(company);
    });
  });
});

/**
 * ABC-freemium 2-04 · R-METER-2 · R-QUOTA-2 · Ruling 5 point 2.
 *
 * The breaker and the usage row used to be charged under
 * `keys.provenance === "system" && provider === "tavily"` — a hard-coded pair.
 * Three of the four operator-funded providers therefore ran free of the 500/day
 * cap and wrote no row at all, and the row that did get written carried the
 * literal `"tavily"` whatever had actually run.
 */
describe("2-04 — every operator-funded provider is charged and metered", () => {
  const rows: UsageEventRow[] = [];

  beforeEach(() => {
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
    geminiSearchMock.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    setUsageEventsClientForTests(undefined);
    resetCounterStoreForTests();
    geminiSearchMock.mockReset();
  });

  function query(overrides: Record<string, unknown>) {
    return {
      topics: ["molten salt"],
      queries: ["molten salt postdoc"],
      locations: [],
      limit: 60,
      ...overrides,
    };
  }

  it("writes NO search row at all, on the most generous input there is (D2a)", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12).
    //
    // Was "writes a row naming GEMINI, not the literal tavily". The old
    // assertion is kept verbatim because the row's SHAPE is what 2-04 bought —
    // the row names the `provider` that actually ran, never a hard-coded
    // `"tavily"` — and that knowledge should not leave the file with the
    // assertion:
    //
    //     expect(rows).toHaveLength(1);
    //     expect(rows[0]).toMatchObject({
    //       kind: "search", surface: "jobs", provider: "gemini",
    //       query_count: 1, byok: false,
    //     });
    //
    // **This case IS standing tally 2 of Ruling 12 point 7 for the jobs
    // surface** — `kind:"search"` usage rows produced must be 0 — and it is
    // measured on the most generous input the surface accepts: a configured
    // Vertex project, an explicit `provider`, a real user id and the entitlement
    // flag forced `true`.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");

    await jobweb.fetch(
      query({
        webSearch: {
          provider: "gemini",
          systemSearchAllowed: true,
          userId: "user-1",
        },
      }),
    );

    expect(rows).toHaveLength(0);
    expect(rows.filter((row) => row.kind === "search")).toEqual([]);
  });

  it("refuses BEFORE the breaker is ever consulted, so nothing is charged (D2a)", async () => {
    // REWRITTEN, NOT DELETED — ABC-freemium 5-04 · D2a (Ruling 12), and it is
    // here because B flagged it as a **FALSE GREEN**: was "charges the 500/day
    // breaker for a grounding fan-out", and after D2a all three of its original
    // assertions are satisfied by "no provider resolved at all". It would have
    // gone on passing with the breaker deleted, which is Ruling 10 point 2b's
    // exact class of worthless green.
    //
    // It now says what it actually proves: the surface refuses at the gate, one
    // step EARLIER than the breaker, so the counter is untouched rather than
    // charged-and-refused. The pre-loaded counter below is left in place on
    // purpose — it is what makes "untouched" measurable.
    //
    // The breaker's own live coverage is elsewhere and is unaffected:
    // `lib/usage/deep-report-quota.test.ts`, driven through the forced-rebuild
    // caller that Ruling 13 point 1 keeps alive.
    //
    // Before 2-04 this fan-out was free of the cap entirely, so the breaker
    // protected one of the four ways to spend the operator's money.
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    await getCounterStore().increment(
      forcedRebuildDayKey("user-1", new Date()),
      null,
      FORCED_REBUILDS_PER_DAY,
    );

    const items = await jobweb.fetch(
      query({
        webSearch: {
          provider: "gemini",
          systemSearchAllowed: true,
          userId: "user-1",
        },
      }),
    );

    // The same degraded value a keyless reader gets — but now reached at the
    // gate rather than at the breaker.
    expect(items).toEqual([]);
    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows.filter((r) => r.kind === "search")).toHaveLength(0);
    // 5-04 — THE ASSERTION THAT MAKES THIS CASE MEAN SOMETHING AGAIN. A
    // breaker that had been consulted and tripped would have written its own
    // `kind: "breaker"` row. Nothing was consulted, so there is no row of any
    // kind, and the counter still holds exactly what was pre-loaded.
    expect(rows).toEqual([]);
    expect(
      (await getCounterStore().read(forcedRebuildDayKey("user-1", new Date())))
        .value,
    ).toBe(FORCED_REBUILDS_PER_DAY);
  });

  it("charges NEITHER breaker nor row for a BYOK Tavily fan-out", async () => {
    // A reader's own key costs the operator nothing, so attributing it would be
    // noise. This is the one provider with two possible payers, and it is why
    // `provenance` still describes Tavily specifically.
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "");
    vi.stubEnv("TAVILY_API_KEY", "");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "");
    const before = await getCounterStore().read(
      forcedRebuildDayKey("user-1", new Date()),
    );

    await jobweb.fetch(
      query({
        webSearch: {
          tavilyApiKey: "USER-NOT-A-KEY",
          systemSearchAllowed: false,
          userId: "user-1",
        },
      }),
    );

    expect(rows).toHaveLength(0);
    expect(
      (await getCounterStore().read(forcedRebuildDayKey("user-1", new Date())))
        .value,
    ).toBe(before.value);
  });

  it("spends nothing at all for an unentitled reader", async () => {
    // Every candidate configured, and the reader is still refused: no provider,
    // no fan-out, no breaker charge, no row. This is R-POOL-3's "still respond
    // from the free structured sources" seen from the spend side.
    vi.stubEnv("TAVILY_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("BRAVE_SEARCH_API_KEY", "OPERATOR-NOT-A-KEY");
    vi.stubEnv("GOOGLE_VERTEX_PROJECT", "some-project");
    vi.stubEnv("GOOGLE_VERTEX_SEARCH_ENGINE_ID", "peer-web");

    const items = await jobweb.fetch(
      query({ webSearch: { systemSearchAllowed: false, userId: "user-1" } }),
    );

    expect(items).toEqual([]);
    expect(geminiSearchMock).not.toHaveBeenCalled();
    expect(rows).toHaveLength(0);
  });
});
