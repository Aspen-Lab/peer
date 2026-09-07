import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { JobReport } from "@/app/jobs/[id]/page";
import { scoredJobToJob } from "@/lib/jobs/mapper";
import { webResultToRawJobItem } from "@/lib/jobs/sources/jobweb";
import { cleanJobDescription } from "@/lib/opportunities/job-cleanup";
import type { Job } from "@/types";

const fixture = JSON.parse(
  readFileSync(
    new URL("./__fixtures__/job-extraction-artifacts.json", import.meta.url),
    "utf8",
  ),
) as {
  title: string;
  url: string;
  snippet: string;
  location: string;
  visa: NonNullable<Job["visa"]>;
};

describe("measured job extraction artifacts", () => {
  it("cleans CTA subtitle text, bracket debris, and duplicate visa output", () => {
    const raw = webResultToRawJobItem(fixture);
    expect(raw).not.toBeNull();

    const job = scoredJobToJob({
      ...raw!,
      location: fixture.location,
      visa: fixture.visa,
      score: 0.85,
      matchedKeywords: ["battery safety"],
      matchReason: "Matches your declared battery safety focus.",
    });
    const html = renderToStaticMarkup(
      createElement(JobReport, {
        job,
        // ABC-freemium 6-04 — `effectivePlan` is REQUIRED now: `JobReport`
        // dropped its `= "free"` default, because a default on a pass-through
        // handed a paid reader back to the upsell mid-hydration. This case is
        // about extraction artefacts in the copy, and it was always rendering
        // the free reader's tree, so it says so out loud rather than leaning on
        // a default that no longer exists.
        effectivePlan: "free",
        isSaved: false,
        isApplied: false,
        nowMs: Date.parse("2026-07-31T12:00:00Z"),
        onToggleSave: () => undefined,
        onAppliedChange: () => undefined,
        onDismiss: () => undefined,
      }),
    );

    expect(job.roleTitle).toBe("Research in Reno at American Battery");
    // B6-03 (round 6): hostname fallbacks are not employer evidence.
    expect(job.companyOrLab).toBeUndefined();
    expect(job.location).toBe("Reno, Nevada, United States");
    // A22-03(a) (round 22, round 22 C) — REWRITTEN, NOT DELETED. This case
    // used to assert that the summary contained "Dive into hands-on research",
    // prose taken from the provider's PAGE-SCOPED search snippet on a `jobweb`
    // row that never proved ownership of anything. That is precisely the value
    // A22-03 was raised to stop: on an aggregator page the snippet belongs to
    // whichever posting the provider chose to show, not necessarily this one.
    // The summary gate is now fail-closed, so the honest output is no summary
    // at all and the card falls back to the `Matches your …` line.
    //
    // The bracket-debris rule this line also used to guard is NOT lost: it is
    // asserted directly against `cleanJobDescription` in the "orphaned
    // formatting artifacts (B9-03)" block below, at the unit level, where it
    // cannot be made vacuous by an absent summary.
    expect(raw!.fetchedPostingScope).toBeUndefined();
    expect(job.summary).toBeUndefined();
    expect(html).not.toContain("Apply now!");
    // B-06 rewrote this. Plate 02 has a VISA tile, so the tile is no longer
    // absent — but what this test actually protects is that the visa fact is
    // not printed twice. It still holds: the header chip carries the long
    // phrase, the tile carries the plate's short value ("Not stated").
    expect(html.match(/Visa not stated/g)).toHaveLength(1);
    expect(html).toContain('data-job-fact="visa"');
  });
});

describe("orphaned formatting artifacts (B9-03)", () => {
  // The harder version of the existing bracket case above: an earlier,
  // unrelated BALANCED bracket pair sits before the remnant in the same
  // description. This is exactly the shape that can defeat
  // stripUnbalancedBrackets's stack-based pairing on a long real
  // description (a `[` from a different, already-stripped link elsewhere
  // could wrongly "close" against this `]`) -- this rule does not depend on
  // pairing at all, so it is unaffected by what else is in the text.
  it("strips an isolated markdown-link-remnant bracket past an unrelated earlier bracket pair", () => {
    const raw =
      "This role involves fieldwork (some travel required) and mentoring. Reach out to Career Services Staff at WBL@lco. ] Internships at LCOOU are posted every semester.";
    const cleaned = cleanJobDescription(raw);
    expect(cleaned).not.toContain("]");
    expect(cleaned).toContain("WBL@lco. Internships");
  });

  // B14-02 MUST-KEEP (round 14): `ISOLATED_BRACKET_REMNANT_RE` DELIBERATELY
  // STILL DOES NOT STRIP `".]"` — a `]` with no whitespace before it. Round 14
  // found the live shape that defeats this rule (`careers.gevernova.com`) and
  // fixed it at the DISPLAY stage in `summarize.ts` instead, because widening
  // this rule to reach a `]` after a sentence boundary was measured and
  // REJECTED: by the time it runs, `stripUnbalancedBrackets` has already
  // balanced the text, so deleting a `]` ORPHANS the `[` of a legitimate
  // bracketed clause and MANUFACTURES the very unmatched-bracket artifact this
  // rule family exists to remove. Ruling 40's stated reason for rejecting a fix
  // that creates the class it removes.
  //
  // This assertion exists so a later round does not "complete" B9-03 by
  // widening the rule here. If you are reading it because you were about to:
  // the two sentences below are what you would break.
  it("deliberately leaves a bracket with no whitespace before it — the widening was measured and rejected (B14-02)", () => {
    const raw =
      "Applicants must hold a PhD [or equivalent.] Candidates should apply early to be considered.";
    const cleaned = cleanJobDescription(raw);
    expect(cleaned).toContain("[or equivalent.]");
    expect(cleaned).toBe(raw);
  });

  // The www.aiu.edu live repro: a dash sitting where a bullet, colon, or
  // connector word most likely stood in the source markup.
  it("strips a dash orphaned immediately after a preposition (www.aiu.edu shape)", () => {
    const raw =
      "This graduate program enhances understanding of – charge transfer, ion mobility, and related transport phenomena in molten salts.";
    expect(cleanJobDescription(raw)).toBe(
      "This graduate program enhances understanding of charge transfer, ion mobility, and related transport phenomena in molten salts.",
    );
  });

  // The "should match nothing" hardest case per Ruling 31, named explicitly
  // in B's own guide: a real, legitimate em-dash parenthetical must survive
  // untouched. Both of its dashes are surrounded by whitespace too -- the
  // same surface shape as the defect above -- so what has to distinguish
  // them is that neither dash here follows one of the closed prepositions;
  // a real parenthetical follows a complete phrase, not a dangling "of".
  it("does not strip a real em-dash parenthetical used correctly", () => {
    const raw =
      "This position requires state-of-the-art equipment — and rare access to shared beamline time — for structural characterization work.";
    expect(cleanJobDescription(raw)).toBe(raw);
  });

  // Both shapes together in one description, proving the two rules compose
  // without interfering with each other.
  it("strips both artifact shapes together in the same description", () => {
    const raw =
      "Our lab focuses on materials characterization. ] The program covers aspects of – synthesis, testing, and scale-up for industrial partners.";
    expect(cleanJobDescription(raw)).toBe(
      "Our lab focuses on materials characterization. The program covers aspects of synthesis, testing, and scale-up for industrial partners.",
    );
  });
});
