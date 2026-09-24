import { describe, expect, it } from "vitest";
import {
  applyPreferenceSignal,
  cleanPreferenceLedger,
  preferenceKey,
  prepareLedger,
  scorePreferenceMatch,
  setTermLean,
  termLean,
} from "./ledger";
import type { PreferenceConcept } from "@/types";
import type { RawItem } from "@/lib/sources/types";

const AT = "2026-09-18T12:00:00.000Z";
const NOW = Date.parse(AT);
const SUB_AREA = "Machine Learning and Data Classification";

function openAlexTopic(label: string, id: string): PreferenceConcept {
  return { key: preferenceKey(label, "openalex_topic", id), label, source: "openalex_topic" };
}

function paperFiledUnder(label: string): RawItem {
  return {
    id: "openalex:W1",
    source: "openalex",
    title: "A paper",
    authors: [],
    url: "",
    publishedAt: "",
    metadata: { preferenceSignals: [openAlexTopic(label, "T10028")] },
  };
}

describe("setTermLean / termLean", () => {
  it("records a lean and reads it back", () => {
    expect(termLean(setTermLean({}, SUB_AREA, "more", AT), SUB_AREA)).toBe("more");
    expect(termLean(setTermLean({}, SUB_AREA, "less", AT), SUB_AREA)).toBe("less");
  });

  it("replaces the lean rather than netting it — more after less means more", () => {
    const less = setTermLean({}, SUB_AREA, "less", AT);
    expect(termLean(setTermLean(less, SUB_AREA, "more", AT), SUB_AREA)).toBe("more");
  });

  it("removes it with null", () => {
    const more = setTermLean({}, SUB_AREA, "more", AT);
    expect(termLean(setTermLean(more, SUB_AREA, null, AT), SUB_AREA)).toBeNull();
  });

  it("does not report a lean for evidence that came from liking papers", () => {
    const liked = applyPreferenceSignal({}, [openAlexTopic(SUB_AREA, "T10028")], "positive", { at: AT });
    expect(termLean(liked, SUB_AREA)).toBeNull();
  });

  it("survives the cleaning every request puts the ledger through", () => {
    const leaned = setTermLean({}, SUB_AREA, "less", AT);
    expect(termLean(cleanPreferenceLedger(leaned), SUB_AREA)).toBe("less");
  });
});

describe("a deliberate lean moves the score", () => {
  const required = ["machine learning"];

  it("'less' lowers a paper filed under a sub-area of the reader's own topic", () => {
    // The required-topic protection would have swallowed this: the label
    // contains "machine learning". The lean is explicit, so it is not shielded.
    // `penalty` is a multiplier on the score: 1 is untouched.
    const ledger = setTermLean({}, SUB_AREA, "less", AT);
    const score = scorePreferenceMatch(paperFiledUnder(SUB_AREA), prepareLedger(ledger), required, {
      now: NOW,
    });
    expect(score.penalty).toBeLessThan(1);
  });

  it("while an ordinary dismissal of the same concept stays protected", () => {
    const dismissed = applyPreferenceSignal({}, [openAlexTopic(SUB_AREA, "T10028")], "negative", {
      at: AT,
    });
    const score = scorePreferenceMatch(paperFiledUnder(SUB_AREA), prepareLedger(dismissed), required, {
      now: NOW,
    });
    expect(score.penalty).toBe(1);
  });

  it("'more' raises it, reaching the OpenAlex-keyed concept by its label", () => {
    const ledger = setTermLean({}, SUB_AREA, "more", AT);
    const score = scorePreferenceMatch(paperFiledUnder(SUB_AREA), prepareLedger(ledger), required, {
      now: NOW,
    });
    expect(score.boost).toBeGreaterThan(0);
  });
});
