import { describe, expect, it } from "vitest";
import { buildReportKey } from "./use-model-report";

// 9-15 (A9-10): `buildReportKey` is a pure extraction of the report cache
// key so it can be unit-tested without rendering the hook (this project's
// Vitest config runs in a plain Node environment, no DOM). The load-bearing
// behavior: `revision` (9-12) must be part of the key, so a delete-then-
// re-upload of the identical bytes (the same hash16, the same
// `fullTextUploadId` string, but a fresh lifecycle instance) never reuses a
// stale in-memory/localStorage entry built against the previous instance.
describe("buildReportKey", () => {
  it("returns an empty key with no paper", () => {
    expect(buildReportKey(undefined, "abstract", "", "default")).toBe("");
  });

  it("includes the paper id, upload id, depth, project hash and provider", () => {
    const key = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined, revision: undefined },
      "deep",
      "my project",
      "default",
    );
    expect(key).toContain("arxiv:2607.00001");
    expect(key).toContain("public");
    expect(key).toContain("deep");
    expect(key).toContain("default");
  });

  it("differs when the revision differs, even with the same paper id and fullTextUploadId", () => {
    const base = { id: "arxiv:2607.00001", fullTextUploadId: "upload:0123456789abcdef" };
    const keyRev1 = buildReportKey({ ...base, revision: 1 }, "deep", "", "default");
    const keyRev2 = buildReportKey({ ...base, revision: 2 }, "deep", "", "default");
    expect(keyRev1).not.toBe(keyRev2);
  });

  it("is unchanged for a paper with no revision at all (the vast majority of papers)", () => {
    const withoutField = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined },
      "abstract",
      "",
      "default",
    );
    const withUndefined = buildReportKey(
      { id: "arxiv:2607.00001", fullTextUploadId: undefined, revision: undefined },
      "abstract",
      "",
      "default",
    );
    expect(withoutField).toBe(withUndefined);
  });

  it("still differs on paper id / fullTextUploadId / depth / provider as before", () => {
    const key = buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "default");
    expect(key).not.toBe(buildReportKey({ id: "b", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: "upload:x", revision: undefined }, "deep", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "abstract", "p", "default"));
    expect(key).not.toBe(buildReportKey({ id: "a", fullTextUploadId: undefined, revision: undefined }, "deep", "p", "gemini"));
  });
});
