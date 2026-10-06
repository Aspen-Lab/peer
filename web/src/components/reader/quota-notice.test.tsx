// P2-09 (§1g.14): the quota notice on the page. No component read
// `report.quota`, so a reader whose allowance was spent got the shorter report
// with no word about it. One Peer-voice line, in the label face, directly under
// the Decision block; nothing when there is nothing to say.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import type { QuotaSignal } from "@/lib/usage/deep-report-quota";
import { QUOTA } from "./copy";
import { QuotaNotice, quotaNoticeText } from "./quota-notice";

type Quota = Pick<QuotaSignal, "kind" | "reason">;

const EXHAUSTED = "Deep reports are used up for now. This is the shorter report.";
const COMPANY_BUDGET = "Peer's shared model budget is spent for now. This is the shorter report.";
// P2-08b (§1g.14 amendment 3, A's F7): reworded — the outage line now serves
// the company budget's check too, so it no longer says "your" allowance — and
// it says what is true of any outage: nothing was spent.
const UNAVAILABLE =
  "Peer could not check the deep-report allowance just now. This is the shorter report; nothing was spent.";

function render(quota: Quota | null | undefined): string {
  return renderToStaticMarkup(createElement(QuotaNotice, { quota }));
}

/** The text of the one element the notice renders, as a reader sees it (React
 *  escapes the apostrophe in "Peer's" to `&#x27;` in static markup). */
function line(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** A kind this build has never heard of: a newer server, or an older cache. */
function unknownKind(): Quota {
  return { kind: "something_new", reason: "exhausted" } as unknown as Quota;
}

describe("QuotaNotice (P2-09, §1g.14)", () => {
  it("renders nothing without a quota", () => {
    expect(render(undefined)).toBe("");
    expect(render(null)).toBe("");
    expect(quotaNoticeText(undefined)).toBeNull();
    expect(quotaNoticeText(null)).toBeNull();
  });

  // P2-08b: the UNAVAILABLE constant above is the amendment-3 wording; the
  // assertion (exactly the three ruled strings, exactly these) is unchanged.
  it("has exactly the three ruled strings", () => {
    expect(QUOTA.exhausted).toBe(EXHAUSTED);
    expect(QUOTA.companyBudget).toBe(COMPANY_BUDGET);
    expect(QUOTA.unavailable).toBe(UNAVAILABLE);
    // P3-02c (§1h.4 amendment): `QUOTA` also holds the two lines of the explain box
    // (the day's explanations used up; the allowance could not be checked). The
    // list of keys grows by exactly those two; the notice below never reads them.
    expect(Object.keys(QUOTA).sort()).toEqual(["companyBudget", "exhausted", "explainExhausted", "explainUnavailable", "unavailable"]);
    expect(QUOTA.explainExhausted).toBe("Explanations are used up for now.");
    expect(QUOTA.explainUnavailable).toBe("Peer could not check the explanation allowance just now. Nothing was spent.");
  });

  it("never shows an explain line under a report: the two are the explain box's, whatever the kind or reason", () => {
    for (const kind of ["deep_report", "breaker", "company_budget", "something_new"]) {
      for (const reason of ["exhausted", "unavailable", "somewhere_new"]) {
        const text = quotaNoticeText({ kind, reason } as unknown as Quota);

        expect(text).not.toBe(QUOTA.explainExhausted);
        expect(text).not.toBe(QUOTA.explainUnavailable);
      }
    }
  });

  it("says the allowance is used up for a spent deep-report or breaker allowance", () => {
    expect(line(render({ kind: "deep_report", reason: "exhausted" }))).toBe(EXHAUSTED);
    expect(line(render({ kind: "breaker", reason: "exhausted" }))).toBe(EXHAUSTED);
  });

  // P2-08b (§1g.14 amendment 3): this said "…, whatever the reason" and pinned
  // company_budget + unavailable to the budget-is-spent line. That is the
  // assertion the amendment reverses (an outage of the budget check is not a
  // spent budget), so it keeps the exhausted case and every reason but an
  // outage; the outage case moves to the test below.
  it("says the shared model budget is spent for the company budget, for every reason but an outage", () => {
    expect(line(render({ kind: "company_budget", reason: "exhausted" }))).toBe(COMPANY_BUDGET);
    expect(line(render({ kind: "company_budget", reason: "somewhere_new" } as unknown as Quota))).toBe(COMPANY_BUDGET);
    expect(line(render({ kind: "company_budget" } as unknown as Quota))).toBe(COMPANY_BUDGET);
  });

  // The ruling (§1g.14 amendment): an outage is never described as a spent
  // allowance — the store could not be read, so nothing was spent — and it is
  // not silent either: the reader is looking at a shorter report.
  // P2-08b (§1g.14 amendment 3): "on both kinds that can have one" is now all
  // three — the company budget's check can be down too — and the line says
  // "nothing was spent", not "your allowance is unchanged". The `not used up`
  // assertion stays, and `not budget is spent` joins it.
  it("tells an outage apart from a spent allowance or budget, on all three kinds that can have one", () => {
    expect(line(render({ kind: "deep_report", reason: "unavailable" }))).toBe(UNAVAILABLE);
    expect(line(render({ kind: "breaker", reason: "unavailable" }))).toBe(UNAVAILABLE);
    expect(line(render({ kind: "company_budget", reason: "unavailable" }))).toBe(UNAVAILABLE);
    expect(UNAVAILABLE).not.toBe(EXHAUSTED);
    expect(UNAVAILABLE).not.toBe(COMPANY_BUDGET);
    expect(UNAVAILABLE).not.toMatch(/used up/i);
    expect(UNAVAILABLE).not.toMatch(/budget is spent/i);
    expect(UNAVAILABLE).toMatch(/nothing was spent/);
  });

  it("treats any reason other than an outage as a spent allowance (an older cached report may carry none)", () => {
    const noReason = { kind: "deep_report" } as unknown as Quota;
    expect(quotaNoticeText(noReason)).toBe(EXHAUSTED);
    expect(quotaNoticeText({ kind: "breaker", reason: "somewhere_new" } as unknown as Quota)).toBe(EXHAUSTED);
  });

  // P2-08b: the amendment's "any kind" is the three kinds the ruling names; a
  // kind this build has never heard of may mean something else, so it stays
  // silent whatever its reason (a guard — green before and after).
  it("renders nothing for a kind it does not know, even with the outage reason", () => {
    expect(quotaNoticeText({ kind: "something_new", reason: "unavailable" } as unknown as Quota)).toBeNull();
    expect(render({ kind: "something_new", reason: "unavailable" } as unknown as Quota)).toBe("");
  });

  it("renders nothing for a kind it does not know", () => {
    expect(quotaNoticeText(unknownKind())).toBeNull();
    expect(render(unknownKind())).toBe("");
    expect(render({ kind: "unavailable", reason: "unavailable" } as unknown as Quota)).toBe("");
  });

  it("is one line in the label face and nothing else", () => {
    const html = render({ kind: "deep_report", reason: "exhausted" });
    // One element, no children, no link, no button.
    expect(html.match(/<[a-z]/g)).toEqual(["<p"]);
    expect(html).toMatch(/^<p class="[^"]*">[^<]+<\/p>$/);
    const classes = (html.match(/class="([^"]*)"/)?.[1] ?? "").split(" ");
    for (const name of ["font-mono", "text-caption", "text-text-muted"]) expect(classes).toContain(name);
    // Peer's words are not the paper's: nothing about it is quote-styled.
    expect(classes).not.toContain("font-reading");
    expect(html).not.toMatch(/<blockquote|<q>|<em>|<i>/);
  });

  it("never tells the reader not to read, in any of its lines", () => {
    for (const text of Object.values(QUOTA)) expect(text).not.toMatch(/skip|don['’]t read|ignore|not worth/i);
  });
});

describe("where the notice is mounted (P2-09)", () => {
  const pageSource = readFileSync(resolve(process.cwd(), "src/app/papers/[id]/page.tsx"), "utf8");

  // P2-09b (§1g.14 amendment 2) rewrites this check to the new contract: the
  // mount reads the hook's quota, which outlives a report that is not shown (a
  // company-budget refusal, a quota after `mode`). `QuotaNotice` renders nothing
  // for null, so the page no longer guards it on the report.
  it("is mounted in the additions slot on the hook's quota, not on the report's", () => {
    expect(pageSource).toMatch(/<QuotaNotice quota=\{model\.quota\} \/>/);
    expect(pageSource).not.toMatch(/report\??\.quota/);
    expect(pageSource).not.toMatch(/&&\s*<QuotaNotice/);
    expect(pageSource).toMatch(/import \{ QuotaNotice \} from "@\/components\/reader\/quota-notice";/);
  });

  // P2-08b (§1g.19 d, F8): the Decision block's availability sentence reads the
  // same hook quota the notice does, so the two never contradict: a refused
  // deep read is "not run", not "did not finish".
  it("tells the availability sentence when the deep read was refused: refused is the hook's quota", () => {
    const start = pageSource.indexOf("const sentences = useMemo(");
    expect(start).toBeGreaterThan(-1);
    const block = pageSource.slice(start, pageSource.indexOf("\n  );", start));
    expect(block).toMatch(/refused:\s*model\.quota !== null/);
    // The memo's dependency list (its last bracket pair) follows the quota too.
    expect(block.slice(block.lastIndexOf("["))).toContain("model.quota");
  });

  it("sits after the Decision block and before the answers and the notes", () => {
    const decision = pageSource.indexOf("decision={");
    const additions = pageSource.indexOf("additions={");
    const quota = pageSource.indexOf("<QuotaNotice", additions);
    const questions = pageSource.indexOf("<ForYourQuestions", additions);
    const notes = pageSource.indexOf("<PaperNotes", additions);

    expect(decision).toBeGreaterThan(-1);
    expect(additions).toBeGreaterThan(decision);
    expect(quota).toBeGreaterThan(additions);
    expect(quota).toBeLessThan(questions);
    expect(questions).toBeLessThan(notes);
  });

  // The brief's second condition: "no other notice for the same report already
  // renders there". `paywallNotice` is a field the server puts on a report; no
  // component or page reads it, so a report that carries it and a quota still
  // shows one line. This pins that fact: the day something renders it, this
  // test fails and the double-notice question has to be answered then.
  it("has no other notice for the report to double up with: nothing in the reader reads paywallNotice", () => {
    function sources(dir: string): string[] {
      return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return sources(path);
        return /\.(ts|tsx)$/.test(name) && !/\.test\.(ts|tsx)$/.test(name) ? [path] : [];
      });
    }
    const roots = ["src/components", "src/app/papers"].map((dir) => resolve(process.cwd(), dir));
    const files = roots.flatMap(sources);

    expect(files.length).toBeGreaterThan(50);
    expect(files.filter((file) => /\bpaywallNotice\b/.test(readFileSync(file, "utf8")))).toEqual([]);
  });
});
