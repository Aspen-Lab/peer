import { describe, expect, it } from "vitest";
import {
  PAPER_REPORT_CACHE_STORAGE_KEY,
  paperReportCacheKey,
} from "./report-cache-key";
import {
  DIGEST_CACHE_STORAGE_KEY,
  digestCacheKey,
} from "@/components/digest/digest-cache-key";
import type { AiMode } from "@/lib/feed/ai-tier";

/**
 * ABC-freemium 1-12 · R-UI-4, R-TEST-1.
 *
 * Both keys were built inline inside client components, which is why neither
 * had ever been tested: the components are not renderable in a unit test
 * without standing up their whole store graph. Extracting each into a pure
 * function is the minimum change that makes the requirement testable at all —
 * the same move `lib/feed/ai-tier.ts` documents for the chip strings.
 */

const MODES: AiMode[] = ["byok", "system", "none"];

const basePaper = {
  paperId: "paper-1",
  contextHint: "molten salt",
  deepReportRequested: true,
  feedAiProvider: "default",
  userProviderConfigured: false,
};

const baseDigest = {
  paperIds: "a|b|c",
  contextLength: 12,
  contextHash: "1x2y",
};

describe("paperReportCacheKey", () => {
  it("gives the three AI modes three different keys", () => {
    // The harm this closes: a report computed with NO model is written to the
    // cache under the fallback TTL, and every other component of the old key was
    // constant across the deploy that turned Peer's own AI on. Without this
    // segment the no-AI report is served as the AI report for six hours.
    const keys = MODES.map((aiMode) =>
      paperReportCacheKey({ ...basePaper, aiMode }),
    );

    expect(new Set(keys).size).toBe(3);
  });

  it("separates a BYOK reader from a system-AI reader", () => {
    expect(paperReportCacheKey({ ...basePaper, aiMode: "byok" })).not.toBe(
      paperReportCacheKey({ ...basePaper, aiMode: "system" }),
    );
  });

  it("keeps every discriminator the old key already had", () => {
    // A regression that dropped one of these would be invisible without this.
    const base = paperReportCacheKey({ ...basePaper, aiMode: "system" });
    expect(
      paperReportCacheKey({ ...basePaper, aiMode: "system", paperId: "other" }),
    ).not.toBe(base);
    expect(
      paperReportCacheKey({
        ...basePaper,
        aiMode: "system",
        contextHint: "other",
      }),
    ).not.toBe(base);
    expect(
      paperReportCacheKey({
        ...basePaper,
        aiMode: "system",
        deepReportRequested: false,
      }),
    ).not.toBe(base);
    expect(
      paperReportCacheKey({
        ...basePaper,
        aiMode: "system",
        userProviderConfigured: true,
      }),
    ).not.toBe(base);
  });

  it("bumps the storage version so pre-existing entries are unreadable", () => {
    // A key change alone leaves old entries readable under their OWN old keys,
    // so the poisoned reports would survive the fix.
    expect(PAPER_REPORT_CACHE_STORAGE_KEY).toBe("peer-paper-report-cache-v4");
    expect(PAPER_REPORT_CACHE_STORAGE_KEY).not.toBe(
      "peer-paper-report-cache-v3",
    );
  });
});

describe("digestCacheKey", () => {
  it("gives the three AI modes three different keys", () => {
    const keys = MODES.map((aiMode) => digestCacheKey({ ...baseDigest, aiMode }));

    expect(new Set(keys).size).toBe(3);
  });

  it("no longer emits the 'tier0' vocabulary", () => {
    // R-UI-1's spirit. It is a cache string rather than a rendered one, so A
    // correctly did not count it — but there is no reason to keep it.
    for (const aiMode of MODES) {
      expect(digestCacheKey({ ...baseDigest, aiMode })).not.toContain("tier0");
    }
  });

  it("still prefers the reader's own provider id when they supplied one", () => {
    expect(
      digestCacheKey({
        ...baseDigest,
        aiMode: "byok",
        overrideProvider: "anthropic",
      }),
    ).toContain("anthropic");
  });

  it("bumps the storage version so pre-existing entries are unreadable", () => {
    expect(DIGEST_CACHE_STORAGE_KEY).toBe("peer-digest-cache-v2");
    expect(DIGEST_CACHE_STORAGE_KEY).not.toBe("peer-digest-cache");
  });
});
