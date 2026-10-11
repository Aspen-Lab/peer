import { describe, expect, it } from "vitest";
import { MAX_QUESTION_CHARS } from "@/store/reading-questions";
import { ASK } from "./copy";

// P7-13 (R11a, §1h.29 Q7): the question box takes 500 characters, and its counter says so. The
// limit is one constant (`MAX_QUESTION_CHARS`); the words of the counter are a copy string, so
// they are pinned here against it.

describe("ASK.counter — the count a long question shows", () => {
  it("is n/500", () => {
    expect(ASK.counter(401)).toBe("401/500");
    expect(ASK.counter(500)).toBe("500/500");
  });

  it("names the limit the box actually enforces", () => {
    expect(ASK.counter(1)).toBe(`1/${MAX_QUESTION_CHARS}`);
    expect(MAX_QUESTION_CHARS).toBe(500);
  });
});
