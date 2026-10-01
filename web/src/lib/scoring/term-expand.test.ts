import { describe, expect, it } from "vitest";
import type { RawItem } from "@/lib/sources/types";
import { passesRequiredGate, toScoringItem } from "@/lib/opportunities/shared";
import { scoreKeyword } from "./keyword";
import {
  ABBREVIATION_GROUPS,
  canonicalize,
  expandTerm,
  singularize,
  termMatches,
  termOccurrences,
  termSpecificity,
  termVariantMatches,
} from "./term-expand";

function paper(overrides: Partial<RawItem> = {}): RawItem {
  return {
    id: "paper:test",
    source: "openalex",
    title: "Unrelated title",
    authors: [],
    abstract: "",
    url: "https://example.test",
    publishedAt: "2026-01-01",
    tags: [],
    metadata: {},
    ...overrides,
  };
}

describe("canonicalize and termMatches", () => {
  it("matches battery against batteries", () => {
    expect(
      termMatches(
        canonicalize("International Conference on Batteries and Fuel Cells"),
        "battery",
      ),
    ).toBe(true);
  });

  it("treats solid-state and solid state as the same term", () => {
    expect(
      termMatches(
        canonicalize("Solid-State Battery Research Summit"),
        "solid state battery",
      ),
    ).toBe(true);
  });

  it("matches lithium ion against li-ion through bidirectional expansion", () => {
    expect(
      termMatches(canonicalize("Advances in Li-ion transport"), "lithium ion"),
    ).toBe(true);
  });

  // A generic word DOES match literally — termMatches is context-free on
  // purpose. What must not happen is a lone generic match being accepted as
  // proof of relevance, which is the gate's job, not the matcher's.
  it.each([
    "prepare marketing materials for the launch",
    "course materials will be provided",
    "training materials and onboarding docs",
  ])("a lone generic match never opens the relevance gate: %s", (text) => {
    const scoped = scoreKeyword(
      toScoringItem({
        id: "x",
        title: text,
        text,
        summary: text,
        tags: [],
      }),
      ["materials"],
      { scope: "titleAndSummary" },
    );
    expect(scoped.matched).toEqual(["materials"]);
    expect(passesRequiredGate(["materials"], scoped, scoped)).toBe(false);
  });

  it("a specific term does open the gate", () => {
    const text = "Solid-State Battery Summit 2026";
    const scoped = scoreKeyword(
      toScoringItem({ id: "y", title: text, text, summary: text, tags: [] }),
      ["solid state battery"],
      { scope: "titleAndSummary" },
    );
    expect(passesRequiredGate(["solid state battery"], scoped, scoped)).toBe(true);
  });

  it.each([
    ["solid electrolyte", "IEEE SE 2026: Conference on Software Engineering"],
    ["cyclic voltammetry", "Research Scientist — please send your CV to apply"],
  ])(
    "two-letter acronyms are not aliases, so %s does not match unrelated prose",
    (term, text) => {
      expect(termMatches(canonicalize(text), term)).toBe(false);
    },
  );

  it("still allows materials in a domain-specific phrase", () => {
    expect(
      termMatches(canonicalize("battery materials research"), "materials"),
    ).toBe(true);
  });

  it.each(["region", "fashion"])("does not match ion inside %s", (text) => {
    expect(termMatches(canonicalize(text), "ion")).toBe(false);
  });
});

// NON-ASCII-TEXT (ABC-JEV-INTEGRATION.md §1bo point 3,
// docs/jev-abc/NON-ASCII-TEXT-B-20260930T071406Z.md §1.3): written Chinese
// has no spaces between words, so the OLD whitespace-anchored word-boundary
// regex only ever matched a CJK Required tag against Chinese prose when the
// tag WAS the whole haystack or sat between literal whitespace on both
// sides — i.e. never, for real prose (an abstract, a title). Every "false"
// row the guide proved by execution is reproduced here as "true" now,
// through the same termMatches/canonicalize entry point the Required-gate
// (keyword.ts) actually calls.
describe("termVariantMatches / termMatches — CJK containment (NON-ASCII-TEXT §1bo point 3)", () => {
  it.each([
    ["这篇论文研究了电池的性能", "mid-sentence, no adjacent whitespace"],
    ["电池性能很好", "at the very start of the sentence"],
    ["我们研究电池", "at the very end of the sentence"],
  ])("matches a CJK Required tag against Chinese prose containing it: %s (%s)", (haystack) => {
    expect(termMatches(canonicalize(haystack), "电池")).toBe(true);
  });

  it("still matches when the tag is the whole haystack, or explicitly space-delimited (already worked before this fix)", () => {
    expect(termMatches(canonicalize("电池"), "电池")).toBe(true);
    expect(termMatches(canonicalize("关键词 电池 研究"), "电池")).toBe(true);
  });

  it("does not match a CJK tag that is genuinely absent from the prose", () => {
    expect(termMatches(canonicalize("这篇论文研究了充电桩的设计"), "电池")).toBe(false);
  });

  it("matches a multi-character CJK tag as a substring anywhere in prose (containment, not word-boundary)", () => {
    expect(termMatches(canonicalize("锂离子电池的固态电解质界面研究"), "固态电解质")).toBe(true);
  });

  it("termVariantMatches directly: plain containment for a CJK-only variant", () => {
    expect(termVariantMatches(canonicalize("这篇论文研究了电池的性能"), "电池")).toBe(true);
  });

  // Protective companion (task-required): the CJK carve-out must be scoped
  // to variants made ENTIRELY of Han-script characters, never a blanket
  // substring match — a short Latin-script tag still must not match inside
  // a longer, unrelated Latin word.
  it("does not match a short Latin-script tag inside a longer Latin word (protective companion)", () => {
    expect(termMatches(canonicalize("a category of interest"), "cat")).toBe(false);
    expect(termVariantMatches(canonicalize("category theory"), "cat")).toBe(false);
  });

  // A MIXED CJK+Latin variant is not "made of CJK characters" — it must
  // keep the exact old word-boundary behaviour, not the new containment
  // shortcut, so it still respects Latin word boundaries on either side.
  it("keeps the word-boundary regex path (not containment) for a MIXED CJK+Latin variant", () => {
    expect(termMatches(canonicalize("电池abcLCO电池xyz"), "LCO电池")).toBe(false);
    expect(termMatches(canonicalize("研究 LCO电池 数据"), "LCO电池")).toBe(true);
  });
});

// NON-ASCII-TEXT ROUND 2 (ABC-JEV-INTEGRATION.md §1bo.8, AMENDMENT): round 1
// scoped "CJK" to Han (Chinese) only. Japanese Hiragana/Katakana and Korean
// Hangul characters are ALSO `\p{L}` (Unicode Letter) but not `\p{Script=Han}`,
// so a Japanese or Korean Required tag was silently left on the old,
// never-matching whitespace-boundary regex path even after round 1 shipped.
// Reproduces round 1's Chinese proof table (§1.3) for a katakana tag, a
// hiragana tag and a Hangul tag.
describe("termVariantMatches / termMatches — kana and Hangul containment (NON-ASCII-TEXT round 2, §1bo.8)", () => {
  it.each([
    ["このバッテリーは高性能です", "mid-sentence, no adjacent whitespace"],
    ["バッテリー性能は高いです", "at the very start of the sentence"],
    ["私たちは高性能なバッテリーを開発しています", "at the very end of the sentence"],
  ])("matches a KATAKANA Required tag against Japanese prose containing it: %s (%s)", (haystack) => {
    expect(termMatches(canonicalize(haystack), "バッテリー")).toBe(true);
  });

  it.each([
    ["このでんちは高性能です", "mid-sentence, no adjacent whitespace"],
    ["でんちの性能はとても高いです", "at the very start of the sentence"],
  ])("matches a HIRAGANA Required tag against Japanese prose containing it: %s (%s)", (haystack) => {
    expect(termMatches(canonicalize(haystack), "でんち")).toBe(true);
  });

  it.each([
    ["이 배터리는 성능이 좋습니다", "mid-sentence, no adjacent whitespace"],
    ["배터리 성능이 뛰어납니다", "at the very start of the sentence"],
    ["우리는 고성능 배터리를 개발합니다", "at the very end of the sentence"],
  ])("matches a HANGUL Required tag against Korean prose containing it: %s (%s)", (haystack) => {
    expect(termMatches(canonicalize(haystack), "배터리")).toBe(true);
  });

  it("does not match a kana or Hangul tag that is genuinely absent from the prose", () => {
    expect(termMatches(canonicalize("この論文は太陽電池について研究しています"), "バッテリー")).toBe(false);
    expect(termMatches(canonicalize("이 논문은 태양광 패널을 연구합니다"), "배터리")).toBe(false);
  });

  // Mutation guard 2 (§1bo.8(g), bonus rigor beyond the 2 required
  // mutations): narrowing CJK_SCRIPT_CLASS back to Han-only turns these red.
  it("mutation guard: a katakana-only and a Hangul-only variant are classified as CJK-only (containment), not left on the boundary regex", () => {
    expect(termVariantMatches(canonicalize("このバッテリーは高性能です"), "バッテリー")).toBe(true);
    expect(termVariantMatches(canonicalize("이 배터리는 성능이 좋습니다"), "배터리")).toBe(true);
  });
});

// NON-ASCII-TEXT ROUND 2 (§1bo.8(c)): termOccurrences gets the same CJK
// containment branch as termVariantMatches, so a CJK tag's ranking weight
// (groundingWeight, keyword.ts) is no longer silently under-counted relative
// to its own admission through termMatches.
describe("termOccurrences — CJK containment (NON-ASCII-TEXT round 2, §1bo.8(c))", () => {
  it("counts multiple non-overlapping mentions of a CJK-only term in continuous prose", () => {
    const haystack = canonicalize("电池研究综述：电池的性能与电池的安全性至关重要");
    expect(termOccurrences(haystack, "电池")).toBe(3);
  });

  it("counts zero for a CJK term genuinely absent from the prose", () => {
    const haystack = canonicalize("这篇论文研究了充电桩的设计");
    expect(termOccurrences(haystack, "电池")).toBe(0);
  });

  it("counts katakana and Hangul term occurrences the same way", () => {
    const jaHaystack = canonicalize("バッテリーの性能。バッテリーの安全性。");
    expect(termOccurrences(jaHaystack, "バッテリー")).toBe(2);
    const koHaystack = canonicalize("배터리 성능과 배터리 안전성");
    expect(termOccurrences(koHaystack, "배터리")).toBe(2);
  });

  // Protective: a Latin term's occurrence counting is completely unchanged
  // (still the boundary-regex path) — same shape as round 1's Latin
  // byte-identical requirement, applied here to the sibling function.
  it("protective: Latin-term occurrence counting is unaffected (still boundary-regex, not containment)", () => {
    const haystack = canonicalize("battery performance and battery safety are both critical");
    expect(termOccurrences(haystack, "battery")).toBe(2);
    // A Latin substring inside a longer, unrelated word must still not count.
    expect(termOccurrences(canonicalize("a category of interest"), "cat")).toBe(0);
  });
});

describe("expandTerm", () => {
  it("does not globally expand ambiguous SEM outside a selected domain sense", () => {
    expect(expandTerm("scanning electron microscopy")).not.toContain("sem");
    expect(termMatches(canonicalize("SEM results"), "scanning electron microscopy")).toBe(false);
  });

  it("inflects the final word in both directions", () => {
    expect(expandTerm("cathode")).toContain("cathodes");
    expect(expandTerm("batteries")).toContain("battery");
    expect(expandTerm("DFT matrix")).toContain("dft matrices");
  });

  it.each(ABBREVIATION_GROUPS.map((group) => [group] as const))(
    "expands every abbreviation group bidirectionally: %j",
    (group) => {
      const canonicalGroup = Array.from(
        new Set(group.map((value) => canonicalize(value))),
      );
      for (const source of canonicalGroup) {
        const expanded = expandTerm(source);
        for (const target of canonicalGroup) {
          expect(expanded).toContain(target);
        }
      }
    },
  );

  it("does not singularize short forms that end in s", () => {
    expect(expandTerm("EIS")).not.toContain("ei");
    expect(expandTerm("XPS")).not.toContain("xp");
  });
});

describe("termSpecificity", () => {
  it("weights multi-word, rare, and generic terms as documented", () => {
    expect(termSpecificity("solid state battery")).toBe(1);
    expect(termSpecificity("topochemical")).toBe(0.7);
    expect(termSpecificity("battery")).toBe(0.5);
    expect(termSpecificity("materials")).toBe(0.3);
  });
});

describe("scoreKeyword", () => {
  it("does not dilute a strong match when unrelated topics are added", () => {
    const item = paper({ title: "Solid-state battery summit" });
    const focused = scoreKeyword(item, ["solid state battery"]);
    const broad = scoreKeyword(item, [
      "solid state battery",
      "electroplating",
      "XRD",
      "reliability",
      "topochemical",
    ]);
    expect(broad.score).toBe(focused.score);
    expect(broad.score).toBeCloseTo(2 / 3);
  });

  it("saturates after two strong matches", () => {
    const result = scoreKeyword(
      paper({ title: "Solid-state battery molten salt summit" }),
      ["solid state battery", "molten salt"],
    );
    expect(result.score).toBe(1);
  });

  it("keeps the paper default scope compatible with abstracts and tags", () => {
    expect(
      scoreKeyword(
        paper({ abstract: "Operando cathode characterization" }),
        ["operando"],
      ).matched,
    ).toEqual(["operando"]);
    expect(
      scoreKeyword(paper({ tags: ["electrochemistry"] }), ["electrochemistry"])
        .matched,
    ).toEqual(["electrochemistry"]);
  });

  it("limits the opportunity gate to title, summary, and tags", () => {
    const item = toScoringItem({
      id: "job:test",
      title: "Research Scientist",
      text: "The full description mentions batteries much later.",
      summary: "Solid electrolyte development",
      tags: ["electrochemistry"],
    });

    expect(
      scoreKeyword(item, ["battery"], { scope: "titleAndSummary" }).score,
    ).toBe(0);
    expect(
      scoreKeyword(item, ["solid electrolyte"], {
        scope: "titleAndSummary",
      }).matched,
    ).toEqual(["solid electrolyte"]);
    expect(
      scoreKeyword(item, ["electrochemistry"], {
        scope: "titleAndSummary",
      }).matched,
    ).toEqual(["electrochemistry"]);
    expect(scoreKeyword(item, ["battery"]).matched).toEqual(["battery"]);
  });
});

// TOKENIZE-PLURALS (ABC-JEV-INTEGRATION.md §1be point 5) — `singularize` was
// a private helper behind `isGenericTerm` until this item; it is now also
// reused (exported, not copied) by tokenize.ts's `tokenizeFolded`, applied
// to arbitrary document text at the Required-gate T4 comparison ONLY (the
// item shipped Option B's T4 half; the SENSE-CONTEXT short-tag context
// check stays unfolded — folding it exposed a separate, pre-existing path
// defect, moved to the new item SENSE-CONTEXT-EVIDENCE). These tests pin
// the guide's §2.4 validated rule directly, independent of any one T4
// fixture.
describe("singularize — protected words (guide §2.4)", () => {
  it.each(["physics", "mathematics", "kinetics", "ceramics", "electronics", "optics"])(
    "does not fold a science-writing '-ics' word that only looks plural: %s",
    (word) => {
      expect(singularize(word)).toBe(word);
    },
  );

  it.each(["arthritis", "osmosis", "synopsis"])(
    "does not fold a '-itis/-osis/-opsis' word: %s",
    (word) => {
      expect(singularize(word)).toBe(word);
    },
  );

  it("does not fold 'species' to the nonsense 'specy'", () => {
    expect(singularize("species")).toBe("species");
  });

  it("does not fold a short acronym+s form ('sems', from tokenized 'SEMs')", () => {
    expect(singularize("sems")).toBe("sems");
  });

  it("still folds a genuine plural to its singular (protection is not over-broad)", () => {
    expect(singularize("glasses")).toBe("glass");
    expect(singularize("electrolytes")).toBe("electrolyte");
    expect(singularize("cathodes")).toBe("cathode");
  });

  it("leaves an already-singular bare word untouched (too short to trigger the guard)", () => {
    expect(singularize("gas")).toBe("gas");
    expect(singularize("glass")).toBe("glass");
  });

  // §1be AMENDMENT g — "gases"/"biases"/"lenses" are the 3 real "-es"
  // (not plain "-s") plurals the plain "-s" rule cannot reach once "-ses"
  // no longer strips 2 for a single "s". Tripwire, not a claim of
  // correctness: this is a named, ACCEPTED under-fold (stays unmerged,
  // never a false merge) — today's shipped behaviour either way, since the
  // plain "-s" rule already mishandles the unrelated "focus"/"virus" the
  // same way. If this ever starts asserting "gas" again, the "-ses" rule
  // has silently widened back to swallowing single-s "-ses" words, which
  // is exactly the false-merge bug this amendment fixed (doses -> "dos").
  it("gases is an accepted under-fold, not 'gas' (§1be AMENDMENT g)", () => {
    expect(singularize("gases")).toBe("gase");
  });

  // SENSE-CONTEXT-EVIDENCE (§1bg point 8) — owed by TOKENIZE-PLURALS-A's own
  // independent review (LOW finding 1): "ion"/"ions" are both real, separate
  // reference-table keys, but the plain "-s" rule's `length > 4` guard
  // excludes this 4-letter plural, so they never merge. Safe for the same
  // reason as gases/biases/lenses (an under-fold, never a false merge) — a
  // small, now-named T4/context-check recall gap for a tag whose only
  // mismatch with a candidate paper is this word's grammatical number.
  it("ions is an accepted under-fold, not 'ion' (owed by TOKENIZE-PLURALS-A, closed in §1bg)", () => {
    expect(singularize("ions")).toBe("ions");
  });
});

// §1be AMENDMENT g — a census of the shipped reference-idf.json's 17,489
// keys found 68 real "-ses" keys; the OLD "-ses -> strip 2" rule was wrong
// for 46 of them (a plain, silent-e "-s" plural only ever needs 1 stripped)
// and created 5 real false merges (a DIFFERENT, unrelated key existed at
// the over-stripped form). Only a true double-consonant "-sses" strips 2.
describe("singularize — the '-ses' regression (§1be AMENDMENT g, found by a whole-table census)", () => {
  it.each([
    ["phases", "phase"],
    ["cases", "case"],
    ["responses", "response"],
  ])("folds the plain '-ses' plural %s to %s (strip 1, not 2)", (plural, singular) => {
    expect(singularize(plural)).toBe(singular);
  });

  it("folds 'doses' to 'dose' — never the false merge 'dos' (the density-of-states abbreviation)", () => {
    expect(singularize("doses")).toBe("dose");
  });

  it("still strips 2 for a true double-consonant '-sses' plural", () => {
    expect(singularize("processes")).toBe("process");
    expect(singularize("glasses")).toBe("glass");
  });
});

// §1be AMENDMENT h — the irregular map's own "pick the shorter form" test
// can never select "analysis" for "analyses" (same length, 8 == 8); fixed
// by also accepting a same-length irregular target ending in "sis".
describe("singularize — 'analyses' -> 'analysis' (§1be AMENDMENT h)", () => {
  it("folds the irregular round-trip pair correctly in both directions", () => {
    expect(singularize("analyses")).toBe("analysis");
    expect(singularize("analysis")).toBe("analysis"); // already singular, protected-suffix guard
  });
});

describe("singularize — the '-izes/-yzes' regression (guide §2.4, a real bug B found and fixed)", () => {
  // A bare `(?:ch|sh|x|z)es$` -> strip-2 rule cannot distinguish a true
  // double-consonant plural ("buzz"+"es"="buzzes") from a silent-e verb
  // ("analyze"+"s"="analyzes") — both end in "zes". Stripping 2 off the
  // second family produces a broken fragment instead of the real singular.
  it.each([
    ["analyzes", "analyze"],
    ["optimizes", "optimize"],
    ["synthesizes", "synthesize"],
    ["utilizes", "utilize"],
    ["recognizes", "recognize"],
    ["characterizes", "characterize"],
  ])("folds the silent-e '-izes' verb %s to %s, not a broken fragment", (plural, singular) => {
    const folded = singularize(plural);
    expect(folded).toBe(singular);
    expect(folded).not.toBe(plural.slice(0, -2)); // the old bug's output (stripped 2, not 1)
  });

  it("still folds a true double-consonant '-zzes' plural by stripping 2 (buzz-class)", () => {
    expect(singularize("buzzes")).toBe("buzz");
  });
});
