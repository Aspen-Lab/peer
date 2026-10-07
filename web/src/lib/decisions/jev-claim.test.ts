import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  JEV_GAIN_NOT_MEASURED_SENTENCE,
  JEV_MEASURED_GAIN,
  jevGainSentence,
  type JevMeasuredGain,
} from "./jev-claim";

// The claim about how much a Jev key improves a reader's list lives in one
// place. The repository has no measurement, and its binding rule forbids a
// claim of a specified amount without paired measurements, so today the value
// is null and the sentence is the not-measured sentence. The filled branch is
// implemented and tested here with a made-up value; it is never filled by this
// code change.

const FAKE_GAIN: JevMeasuredGain = {
  papers: 120,
  projects: 4,
  metric: "precision@10",
  without: 0.41,
  with: 0.52,
  ciLow: 0.03,
  ciHigh: 0.19,
  reportPath: "docs/handoff/byok-only/JEV-EVAL.md",
};

// "much" alone is part of the mandated sentence ("How much this improves ..."); the claim it must not make is "much better".
const SIZE_WORDS = /\bmuch (better|more|sharper)\b|\b(far|greatly|sharper|sharp|better|best|faster|stronger|dramatic\w*|significant\w*|huge|big|large|major|boost\w*|leap)\b/i;

describe("the claim: no measurement, so no number", () => {
  it("nothing is measured: JEV_MEASURED_GAIN is null", () => {
    // If you are filling this in, you need a measured result and the report that
    // holds it (reportPath), checked in with the change; then update this test.
    expect(JEV_MEASURED_GAIN).toBeNull();
  });

  it("the null branch is exactly the not-measured sentence", () => {
    expect(jevGainSentence()).toBe("How much this improves your list is not yet measured.");
    expect(jevGainSentence(null)).toBe("How much this improves your list is not yet measured.");
    expect(JEV_GAIN_NOT_MEASURED_SENTENCE).toBe(jevGainSentence());
  });

  it("the null branch contains no digit, no percent sign, no currency and no adjective of size", () => {
    const sentence = jevGainSentence(null);
    expect(sentence).not.toMatch(/\d/);
    expect(sentence).not.toMatch(/[%$€£¢]/);
    expect(sentence).not.toMatch(SIZE_WORDS);
  });
});

describe("the filled branch (implemented and tested with a made-up value, never filled here)", () => {
  it("states what was measured, on how much, and the interval", () => {
    expect(jevGainSentence(FAKE_GAIN)).toBe(
      "In our test of 120 papers across 4 projects, precision at 10 was 0.52 with Jev against 0.41 without (95% interval for the difference 0.03 to 0.19).",
    );
  });

  it("names the metric it used", () => {
    expect(jevGainSentence({ ...FAKE_GAIN, metric: "ndcg@10" })).toContain("nDCG at 10");
    expect(jevGainSentence({ ...FAKE_GAIN, metric: "precision@10" })).toContain("precision at 10");
  });

  it("carries the path of the report behind it in its type, so a filled value cannot be anonymous", () => {
    const source = readFileSync(path.join(process.cwd(), "src/lib/decisions/jev-claim.ts"), "utf8");
    expect(source).toMatch(/reportPath:\s*string;/);
  });
});

describe("no other file states a size for Jev's effect", () => {
  it("only jev-claim.ts assigns JEV_MEASURED_GAIN", () => {
    const here = path.join(process.cwd(), "src");
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(ts|tsx)$/.test(entry.name) || /\.test\.(ts|tsx)$/.test(entry.name)) continue;
        if (entry.name === "jev-claim.ts") continue;
        if (/JEV_MEASURED_GAIN\s*(:|=)/.test(readFileSync(full, "utf8"))) offenders.push(full);
      }
    };
    walk(here);
    expect(offenders).toEqual([]);
  });
});
