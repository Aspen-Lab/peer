// EMPTY-EMAIL-REASON (ABC-JEV-INTEGRATION.md §1bj). Real (unmocked)
// renderDigestHtml/renderDigestPlaintext tests -- no prior digest-template
// test file existed (confirmed via Glob before writing this; send-digest.
// test.ts mocks this whole module, so it never exercised real rendering).
//
// Per code: the ruled sentence renders in BOTH the HTML and plaintext parts.
// A missing or unrecognized code falls back to today's pre-existing generic
// sentence in both, never a guess (§1bj.1). Non-empty input is unaffected by
// any emptyReasonCode value, and its full rendered output is pinned against
// a literal captured from THIS file's own real functions at HEAD (before
// this item's edits), via a temporary probe
// (web/src/lib/email/__c_snapshot_probe.test.ts, run scoped to itself, then
// deleted -- see the C checkpoint for the exact capture transcript).
import { describe, expect, it, vi } from "vitest";
import { renderDigestHtml, renderDigestPlaintext } from "./digest-template";
import type { FeedEmptyReasonCode } from "@/lib/feed/types";
import type { ScoredItem } from "@/lib/scoring/types";

const ORIGIN = "https://example.test";

const FIXED_ITEM: ScoredItem = {
  id: "openalex:W_SNAPSHOT_FIXTURE",
  source: "openalex",
  title: "A Fixed Snapshot Paper Title For Regression Testing",
  authors: ["A. One", "B. Two", "C. Three", "D. Four"],
  abstract: "A fixed abstract used only to pin byte-identical non-empty rendering.",
  url: "https://example.org/snapshot-fixture",
  publishedAt: "2026-07-20",
  venue: "Journal of Snapshot Testing",
  tags: ["solid-state battery"],
  metadata: {},
  score: 0.8734,
  scoreBreakdown: { keyword: 0.5, tfidf: 0.4, topicality: 0.6, recency: 0.7, source: 1.0, combined: 0.8734 },
  matchedKeywords: ["solid-state battery"],
  relevanceReason: "Matches your interest in solid-state battery electrolytes.",
};

// Captured verbatim from HEAD (47c4a1db, before this item's edits) via a
// temporary probe that called the real, unmodified renderDigestHtml/
// renderDigestPlaintext with this exact FIXED_ITEM, firstName "Ada",
// originUrl ORIGIN, and system time frozen at 2026-09-29T12:00:00.000Z --
// the same fixture and frozen time used by the "non-empty regression"
// test below. The probe file was deleted immediately after the capture.
const HEAD_NON_EMPTY_HTML =
  "<!doctype html>\n<html lang=\"en\">\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">\n<title>Peer briefing</title>\n</head>\n<body style=\"margin: 0; padding: 0; background: #F5EDD7;\">\n<!-- Preheader (hidden, shown in inbox preview) -->\n<div style=\"display: none; max-height: 0; overflow: hidden; opacity: 0;\">\nA Fixed Snapshot Paper Title For Regression Testing — 1 items picked for you\n</div>\n\n<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"background: #F5EDD7;\">\n  <tr>\n    <td align=\"center\" style=\"padding: 40px 16px;\">\n\n      <table role=\"presentation\" width=\"600\" cellpadding=\"0\" cellspacing=\"0\" border=\"0\" style=\"max-width: 600px; width: 100%; background: #FFFFFF; border-radius: 16px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.04);\">\n\n        <!-- Header -->\n        <tr>\n          <td style=\"padding: 28px 24px 20px;\">\n            <div style=\"font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; font-weight: 600; letter-spacing: 0.2em; color: #F58414; text-transform: uppercase; margin-bottom: 8px;\">\n              PEER · TUESDAY, SEPTEMBER 29\n            </div>\n            <div style=\"font-family: Georgia, 'Instrument Serif', serif; font-size: 28px; line-height: 1.15; color: #1C1A16; font-weight: 600; letter-spacing: -0.01em;\">\n              Hi Ada, <span style=\"font-style: italic; color: #6B6358;\">here's what you missed</span>.\n            </div>\n            <div style=\"font-family: -apple-system, sans-serif; font-size: 13px; color: #6B6358; margin-top: 10px;\">\n              1 items, picked from your sources and ranked against your topics.\n            </div>\n          </td>\n        </tr>\n\n        <!-- Divider -->\n        <tr><td style=\"border-top: 1px solid #E3D9BF; font-size: 0; line-height: 0;\">&nbsp;</td></tr>\n\n        <!-- Items -->\n        \n<tr>\n  <td style=\"padding: 18px 24px; border-bottom: 1px solid #E3D9BF;\">\n    <a href=\"https://example.test/papers/openalex%3AW_SNAPSHOT_FIXTURE\" style=\"color: #1C1A16; text-decoration: none; display: block;\">\n      <div style=\"font-family: Georgia, 'Source Serif 4', serif; font-size: 17px; line-height: 1.35; font-weight: 600; color: #1C1A16; margin-bottom: 6px;\">\n        A Fixed Snapshot Paper Title For Regression Testing\n      </div>\n    </a>\n    <div style=\"font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 12px; color: #6B6358; margin-bottom: 8px;\">\n        A. One, B. Two, C. Three et al. <span style=\"color: #9A9286;\">·</span> <span style=\"color: #9A9286;\">Journal of Snapshot Testing</span>\n      </div>\n    <div style=\"font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 13px; line-height: 1.5; color: #6B6358;\">\n        Matches your interest in solid-state battery electrolytes.\n      </div>\n    <div style=\"margin-top: 10px; font-family: -apple-system, 'Segoe UI', sans-serif; font-size: 11px; color: #9A9286; letter-spacing: 0.04em; text-transform: uppercase;\">\n      <a href=\"https://example.test/papers/openalex%3AW_SNAPSHOT_FIXTURE\" style=\"color: #F58414; text-decoration: none; font-weight: 600;\">Read briefing →</a>\n      <span style=\"color: #9A9286; margin-left: 12px;\">87% match</span>\n    </div>\n  </td>\n</tr>\n        \n\n        <!-- Footer -->\n        <tr>\n          <td style=\"padding: 24px; background: #F5EDD7;\">\n            <div style=\"font-family: -apple-system, sans-serif; font-size: 12px; color: #6B6358; line-height: 1.6;\">\n              <a href=\"https://example.test\" style=\"color: #1C1A16; text-decoration: underline;\">Open in browser</a>\n              &nbsp;·&nbsp;\n              <a href=\"https://example.test/profile\" style=\"color: #1C1A16; text-decoration: underline;\">Edit signals or pause digest</a>\n            </div>\n            <div style=\"font-family: -apple-system, sans-serif; font-size: 11px; color: #9A9286; margin-top: 12px; line-height: 1.5;\">\n              You're receiving this because you enabled daily digests in Peer. Change preferences or unsubscribe at <a href=\"https://example.test/profile\" style=\"color: #9A9286;\">https://example.test/profile</a>.\n            </div>\n          </td>\n        </tr>\n\n      </table>\n\n    </td>\n  </tr>\n</table>\n</body>\n</html>";

const HEAD_NON_EMPTY_TEXT =
  "PEER BRIEFING — Tuesday, September 29\n\nHi Ada,\n\nHere are 1 items worth your attention today.\n\n1. A Fixed Snapshot Paper Title For Regression Testing\n   A. One, B. Two, C. Three et al.\n   Journal of Snapshot Testing\n   Why: Matches your interest in solid-state battery electrolytes.\n   https://example.test/papers/openalex%3AW_SNAPSHOT_FIXTURE\n\n—\nRead in browser: https://example.test\nAdjust or turn off this digest: https://example.test/profile";

// §1bj.2 -- the exact ruled wording, keyed by code, reused by every test
// below rather than retyped per-assertion so the HTML/plaintext pair for one
// code can never quietly drift from each other.
const REASON_SENTENCES: Record<FeedEmptyReasonCode, { html: string; text: string }> = {
  "sources-unreachable": {
    html: "Couldn&#39;t reach today&#39;s paper sources. The next email will try again.",
    text: "Couldn't reach today's paper sources. The next email will try again.",
  },
  "no-results": {
    html: "Nothing new for these topics today.",
    text: "Nothing new for these topics today.",
  },
  "no-required-match": {
    html:
      "None of today&#39;s papers passed your Required topics and filters. To see more, try a broader Required topic in " +
      `<a href="${ORIGIN}/profile" style="color: #F58414;">Profile</a>.`,
    text:
      "None of today's papers passed your Required topics and filters. To see more, try a broader Required topic in " +
      `Profile (${ORIGIN}/profile).`,
  },
  // EMPTY-EMAIL-REASON (§1bj.10) — SECOND CORRECTED sentence: §1bj.8's
  // "Past briefings" link was itself untrue for some readers (that page
  // renders only its newest 20 rows; this code's own 30-day exclusion
  // window reads every row in that range). Reworded to a plain sentence, no
  // link, that claims only the always-true 30-day fact and points nowhere.
  "already-delivered": {
    html: "You&#39;re caught up: every paper that matched today was already picked for you in the past 30 days.",
    text: "You're caught up: every paper that matched today was already picked for you in the past 30 days.",
  },
};

const GENERIC_HTML = `No items matched your topics today. Try adjusting your <a href="${ORIGIN}/profile" style="color: #F58414;">signals</a>.`;
const GENERIC_TEXT = `No items matched your topics today. Try adjusting your signals (${ORIGIN}/profile).`;

const CODES = Object.keys(REASON_SENTENCES) as FeedEmptyReasonCode[];

describe("renderDigestHtml / renderDigestPlaintext -- empty-case reason sentences (EMPTY-EMAIL-REASON)", () => {
  describe.each(CODES)("code: %s", (code) => {
    it("renders the code's own sentence in the HTML part", () => {
      const html = renderDigestHtml({ items: [], originUrl: ORIGIN, emptyReasonCode: code });
      expect(html).toContain(REASON_SENTENCES[code].html);
      // No other code's sentence, and not the generic fallback, leak in.
      for (const other of CODES) {
        if (other !== code) expect(html).not.toContain(REASON_SENTENCES[other].html);
      }
      expect(html).not.toContain("No items matched your topics today.");
    });

    it("renders the code's own sentence in the plaintext part", () => {
      const text = renderDigestPlaintext({ items: [], originUrl: ORIGIN, emptyReasonCode: code });
      expect(text).toContain(REASON_SENTENCES[code].text);
      for (const other of CODES) {
        if (other !== code) expect(text).not.toContain(REASON_SENTENCES[other].text);
      }
      expect(text).not.toContain("No items matched your topics today.");
    });
  });

  it("no-required-match's link points at <origin>/profile with 'Profile' as the anchor text in HTML", () => {
    const html = renderDigestHtml({ items: [], originUrl: ORIGIN, emptyReasonCode: "no-required-match" });
    expect(html).toContain(`<a href="${ORIGIN}/profile" style="color: #F58414;">Profile</a>`);
  });

  it("no-required-match's link is a plain URL (no markup) in plaintext", () => {
    const text = renderDigestPlaintext({ items: [], originUrl: ORIGIN, emptyReasonCode: "no-required-match" });
    expect(text).toContain(`Profile (${ORIGIN}/profile)`);
    expect(text).not.toContain("<a ");
    expect(text).not.toContain("href=");
  });

  describe("missing code -- falls back to today's generic sentence, never a guess", () => {
    it("HTML: byte-identical to the pre-existing generic sentence", () => {
      const html = renderDigestHtml({ items: [], originUrl: ORIGIN });
      expect(html).toContain(GENERIC_HTML);
    });

    it("plaintext: the new generic fallback sentence (parity fix -- previously nothing at all)", () => {
      const text = renderDigestPlaintext({ items: [], originUrl: ORIGIN });
      expect(text).toContain(GENERIC_TEXT);
    });
  });

  describe("unrecognized code -- same fallback, never throws, never shows the raw string", () => {
    const unknownCode = "some-future-code-this-build-does-not-know" as FeedEmptyReasonCode;

    it("HTML falls back to the generic sentence and never shows the raw code", () => {
      const html = renderDigestHtml({ items: [], originUrl: ORIGIN, emptyReasonCode: unknownCode });
      expect(html).toContain(GENERIC_HTML);
      expect(html).not.toContain("some-future-code-this-build-does-not-know");
    });

    it("plaintext falls back to the generic sentence and never shows the raw code", () => {
      const text = renderDigestPlaintext({ items: [], originUrl: ORIGIN, emptyReasonCode: unknownCode });
      expect(text).toContain(GENERIC_TEXT);
      expect(text).not.toContain("some-future-code-this-build-does-not-know");
    });

    it("never throws for either renderer", () => {
      expect(() => renderDigestHtml({ items: [], originUrl: ORIGIN, emptyReasonCode: unknownCode })).not.toThrow();
      expect(() => renderDigestPlaintext({ items: [], originUrl: ORIGIN, emptyReasonCode: unknownCode })).not.toThrow();
    });
  });

  describe("non-empty items -- emptyReasonCode is a should-never-happen combination and must be ignored", () => {
    it.each(CODES)("HTML: with items present and emptyReasonCode=%s, items render normally and no empty-case sentence appears", (code) => {
      const html = renderDigestHtml({ items: [FIXED_ITEM], originUrl: ORIGIN, emptyReasonCode: code });
      expect(html).toContain("A Fixed Snapshot Paper Title For Regression Testing");
      expect(html).not.toContain(REASON_SENTENCES[code].html);
      expect(html).not.toContain("No items matched your topics today.");
    });

    it.each(CODES)("plaintext: with items present and emptyReasonCode=%s, items render normally and no empty-case sentence appears", (code) => {
      const text = renderDigestPlaintext({ items: [FIXED_ITEM], originUrl: ORIGIN, emptyReasonCode: code });
      expect(text).toContain("A Fixed Snapshot Paper Title For Regression Testing");
      expect(text).not.toContain(REASON_SENTENCES[code].text);
      expect(text).not.toContain("No items matched your topics today.");
    });
  });

  describe("non-empty regression -- byte-identical to HEAD's own rendering, before this item", () => {
    it("renderDigestHtml matches the literal captured from HEAD, with no emptyReasonCode passed", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
      const html = renderDigestHtml({ firstName: "Ada", items: [FIXED_ITEM], originUrl: ORIGIN });
      vi.useRealTimers();
      expect(html).toBe(HEAD_NON_EMPTY_HTML);
    });

    it("renderDigestPlaintext matches the literal captured from HEAD, with no emptyReasonCode passed", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
      const text = renderDigestPlaintext({ firstName: "Ada", items: [FIXED_ITEM], originUrl: ORIGIN });
      vi.useRealTimers();
      expect(text).toBe(HEAD_NON_EMPTY_TEXT);
    });

    it("an emptyReasonCode passed alongside non-empty items changes NOTHING -- byte-identical to the same literal", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-29T12:00:00.000Z"));
      const html = renderDigestHtml({
        firstName: "Ada",
        items: [FIXED_ITEM],
        originUrl: ORIGIN,
        emptyReasonCode: "no-required-match",
      });
      const text = renderDigestPlaintext({
        firstName: "Ada",
        items: [FIXED_ITEM],
        originUrl: ORIGIN,
        emptyReasonCode: "no-required-match",
      });
      vi.useRealTimers();
      expect(html).toBe(HEAD_NON_EMPTY_HTML);
      expect(text).toBe(HEAD_NON_EMPTY_TEXT);
    });
  });
});
