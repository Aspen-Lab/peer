import { describe, expect, it } from "vitest";
import { buildJevRequest } from "@/lib/decisions/jev-contract";
import { JEV_SMOKE_INPUTS } from "./inputs";

describe("JEV_SMOKE_INPUTS", () => {
  it("has exactly 4 fixed inputs, well under any sane ceiling", () => {
    expect(JEV_SMOKE_INPUTS).toHaveLength(4);
  });

  it("every input has a unique id", () => {
    const ids = JEV_SMOKE_INPUTS.map((input) => input.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every input builds a valid Jev wire request without throwing, via the same buildJevRequest production uses", () => {
    for (const input of JEV_SMOKE_INPUTS) {
      expect(() => buildJevRequest(input.request)).not.toThrow();
    }
  });

  it("every input asks at least one question", () => {
    for (const input of JEV_SMOKE_INPUTS) {
      expect(input.request.questions.length).toBeGreaterThan(0);
    }
  });

  it("includes exactly one CJK input, reusing the existing checked-in fixture rather than inventing a new one", () => {
    const cjkInput = JEV_SMOKE_INPUTS.find((input) => input.id === "cjk-truncation");
    expect(cjkInput).toBeDefined();
    expect(cjkInput?.request.title).toContain("锂离子电池");
    expect(JEV_SMOKE_INPUTS.filter((input) => /[㐀-鿿]/.test(input.request.title)).length).toBe(1);
  });

  it("carries no real user data — every paperId is a fixed jev-smoke-* id or the checked-in CJK fixture's own id", () => {
    for (const input of JEV_SMOKE_INPUTS) {
      const isFixedId = input.request.paperId.startsWith("jev-smoke-") || input.request.paperId === "fixture-cjk-001";
      expect(isFixedId, `unexpected paperId: ${input.request.paperId}`).toBe(true);
    }
  });

  it("includes at least one clear-match and one clear-mismatch case (the runner's own contract-mismatch reporting needs both a confident and an off-target answer to be meaningful)", () => {
    expect(JEV_SMOKE_INPUTS.some((input) => input.id === "clear-match")).toBe(true);
    expect(JEV_SMOKE_INPUTS.some((input) => input.id === "clear-mismatch")).toBe(true);
  });
});
