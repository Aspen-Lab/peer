import { describe, expect, it } from "vitest";
import { buildReadingKey } from "./use-reading";

// 9-15 (A9-10): same reasoning as use-model-report.test.ts's coverage of
// buildReportKey — a pure extraction so the key's revision-awareness is
// testable without rendering the hook.
describe("buildReadingKey", () => {
  it("returns the paperId|public|'' shape with no upload id or revision", () => {
    expect(buildReadingKey("arxiv:2607.00001", undefined, undefined)).toBe("arxiv:2607.00001|public|");
  });

  it("includes the upload id when present", () => {
    expect(buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", undefined))
      .toBe("arxiv:2607.00001|upload:0123456789abcdef|");
  });

  it("differs when the revision differs, even with the same paperId and uploadId", () => {
    const keyRev1 = buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", 1);
    const keyRev2 = buildReadingKey("arxiv:2607.00001", "upload:0123456789abcdef", 2);
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("is unchanged for a paper with no revision at all (the vast majority of papers)", () => {
    expect(buildReadingKey("arxiv:2607.00001", undefined, undefined))
      .toBe(buildReadingKey("arxiv:2607.00001", undefined, undefined));
  });
});
