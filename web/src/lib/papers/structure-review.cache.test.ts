import { describe, expect, it } from "vitest";
import {
  createStructureReviewCache,
  REVIEW_CAPS,
  REVIEW_PROMPT_VERSION,
  restoreReview,
  SKELETON_VERSION,
  STRUCTURE_RULES_VERSION,
  structureReviewKey,
  type StructureReviewEntry,
} from "./structure-review";

// P12-53 (B P12-42 §4; ruling §1h.424 (b) "cached per paper version, so a paper is reviewed once"): the key, the
// server's memory, and what an entry may hold. The route test reads the same memory from the other side.

const entry = (over: Partial<StructureReviewEntry> = {}): StructureReviewEntry => ({
  v: 1,
  docHash: "1abc",
  rulesVersion: STRUCTURE_RULES_VERSION,
  skeletonVersion: SKELETON_VERSION,
  promptVersion: REVIEW_PROMPT_VERSION,
  draftDigest: "0123456789abcd",
  corrections: [{ op: "set_role", part: 1, role: "method" }],
  unsure: [2],
  secondLooks: [{ part: 1, why: "contradicts-high", verdict: "review" }],
  model: "gemini/large",
  reviewedAt: 1_700_000_000_000,
  ...over,
});

describe("structureReviewKey — docHash | rules | skeleton | prompt", () => {
  it("is the paper version and the three versions, in that order, and nothing else", () => {
    expect(structureReviewKey("abc")).toBe(`abc|rules:${STRUCTURE_RULES_VERSION}|skel:${SKELETON_VERSION}|prompt:${REVIEW_PROMPT_VERSION}`);
    expect(structureReviewKey("abc")).not.toBe(structureReviewKey("abd"));
  });

  it("does not carry the model: a provider switch must not re-bill a reviewed paper (D5)", () => {
    expect(structureReviewKey("abc")).not.toMatch(/gemini|openai|anthropic|model/i);
  });
});

describe("createStructureReviewCache — finished reviews, in this process, for an hour", () => {
  it("returns what was set, and forgets it after the hour", () => {
    let now = 1_000;
    const cache = createStructureReviewCache({ now: () => now });
    cache.set("k", entry());

    expect(cache.get("k")).toEqual(entry());
    now += REVIEW_CAPS.cacheTtlMs;
    expect(cache.get("k")).toEqual(entry());
    now += 1;
    expect(cache.get("k")).toBeUndefined();
    expect(cache.size()).toBe(0);
  });

  it("keeps at most 32 entries, the oldest forgotten first, and a set again is the newest", () => {
    const cache = createStructureReviewCache();
    for (let i = 0; i < 40; i += 1) cache.set(`k${i}`, entry({ docHash: `d${i}` }));
    cache.set("k8", entry({ docHash: "again" }));
    cache.set("k40", entry());

    expect(cache.size()).toBe(REVIEW_CAPS.cacheEntries);
    expect(cache.get("k0")).toBeUndefined();
    expect(cache.get("k8")?.docHash).toBe("again");
    expect(cache.get("k9")).toBeUndefined();
    cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("misses for a key made under other versions of the rules, the skeleton or the prompt", () => {
    const cache = createStructureReviewCache();
    cache.set(structureReviewKey("abc"), entry());

    expect(cache.get(structureReviewKey("abc"))).toBeDefined();
    for (const other of ["rules:r0", "skel:s0", "prompt:p0"]) {
      const key = structureReviewKey("abc").replace(/(rules|skel|prompt):[^|]+/, other);
      expect(cache.get(key)).toBeUndefined();
    }
  });

  it("holds indices, role names and tags only: an entry is numbers and the five roles, no word of a paper", () => {
    const text = JSON.stringify(entry({ secondLooks: [{ part: 1, why: "contradicts-high", verdict: "review" }, { part: 2, why: "contradicts-low", verdict: "draft" }] }));
    const words = text.match(/"[A-Za-z][A-Za-z -]+"/g) ?? [];

    // Every string value is a key, an op, a role, a version, a verdict or the model's id.
    for (const word of words) {
      expect(word).toMatch(/^"(v|docHash|rulesVersion|skeletonVersion|promptVersion|draftDigest|corrections|unsure|secondLooks|model|reviewedAt|op|part|role|why|verdict|set_role|move_start|split|method|setup|evidence|interpretation|apparatus|contradicts-high|contradicts-medium|contradicts-low|review|draft|failed|toParagraph|atParagraph|gemini\/large)"$/);
    }
  });
});

describe("restoreReview — a kept or fetched review, read", () => {
  it("restores an entry as it was", () => {
    expect(restoreReview(JSON.parse(JSON.stringify(entry())))).toEqual(entry());
  });

  it("reads back an entry whose second looks include `contradicts-low` (P12-94), beside the kinds stored before it", () => {
    const secondLooks: StructureReviewEntry["secondLooks"] = [
      { part: 0, why: "contradicts-low", verdict: "review" },
      { part: 1, why: "contradicts-high", verdict: "draft" },
      { part: 2, why: "contradicts-medium", verdict: "failed" },
      { part: 3, why: "unsure", verdict: "review" },
    ];

    expect(restoreReview(JSON.parse(JSON.stringify(entry({ secondLooks }))))!.secondLooks).toEqual(secondLooks);
    // A kind that is not one of the four is still dropped.
    expect(restoreReview({ ...entry(), secondLooks: [{ part: 0, why: "contradicts-none", verdict: "review" }, { part: 1, why: "contradicts-low", verdict: "draft" }] })!.secondLooks).toEqual([
      { part: 1, why: "contradicts-low", verdict: "draft" },
    ]);
  });

  it("is null for another version of the rules, the skeleton or the prompt, a missing digest, and anything that is not an entry", () => {
    for (const bad of [
      entry({ rulesVersion: "old" }),
      entry({ skeletonVersion: "old" }),
      entry({ promptVersion: "old" }),
      entry({ draftDigest: "" }),
      { ...entry(), v: 2 },
      { ...entry(), corrections: "no" },
      null,
      "x",
      [],
    ]) {
      expect(restoreReview(bad)).toBeNull();
    }
  });

  it("drops a correction that is not one, and keeps the others", () => {
    const restored = restoreReview({
      ...entry(),
      corrections: [
        { op: "set_role", part: 1, role: "banana" },
        { op: "set_role", part: -1, role: "method" },
        { op: "move_start", part: "2", toParagraph: "11" },
        { op: "split", part: 2, atParagraph: 1.5, role: "evidence" },
        { op: "delete", part: 2 },
        "x",
        { op: "split", part: 2, atParagraph: 14, role: "Evidence" },
      ],
      unsure: [1, "2", -1, "x"],
      secondLooks: [{ part: 1, why: "unsure", verdict: "draft" }, { part: 1, why: "banana", verdict: "draft" }, "x"],
    })!;

    expect(restored.corrections).toEqual([
      { op: "move_start", part: 2, toParagraph: 11 },
      { op: "split", part: 2, atParagraph: 14, role: "evidence" },
    ]);
    expect(restored.unsure).toEqual([1, 2]);
    expect(restored.secondLooks).toEqual([{ part: 1, why: "unsure", verdict: "draft" }]);
  });

  it("reads at most forty corrections", () => {
    const many = Array.from({ length: 60 }, (_, k) => ({ op: "set_role", part: k, role: "method" }));

    expect(restoreReview({ ...entry(), corrections: many })!.corrections).toHaveLength(REVIEW_CAPS.corrections);
  });
});
