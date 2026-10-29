import { describe, expect, it } from "vitest";
import { readabilityOf } from "./readability";
import type { FullTextResult } from "./full-text";

const attempt = (outcome: string) => ({ link: { url: "https://example.org/file", kind: "pdf" as const, label: "input" as const, rank: 1 }, outcome });

describe("full-text availability", () => {
  it("requires extracted sections before claiming the paper is readable", () => {
    expect(readabilityOf({ status: "ok", doc: { sections: [{ heading: "Results", canonical: "results", text: "A meaningful research result ".repeat(20) }] }, attempts: [] } as unknown as FullTextResult)).toBe("readable");
    expect(readabilityOf({ status: "ok", doc: { sections: [] }, attempts: [] } as unknown as FullTextResult)).toBe("unknown");
    expect(readabilityOf({ status: "ok", doc: { sections: [{ canonical: "body", text: "###@!".repeat(100) }] }, attempts: [] } as unknown as FullTextResult)).toBe("unknown");
  });
  it("distinguishes a settled paywall or scan from a temporary source failure", () => {
    expect(readabilityOf({ status: "paywalled", attempts: [attempt("paywalled")] })).toBe("abstract");
    expect(readabilityOf({ status: "no_full_text", attempts: [attempt("source_unavailable: pdf-empty: no-text-layer")] })).toBe("abstract");
    expect(readabilityOf({ status: "no_full_text", attempts: [attempt("source_unavailable: timed out")] })).toBe("unknown");
    expect(readabilityOf({ status: "paywalled", attempts: [attempt("paywalled"), attempt("source_unavailable: 503")] })).toBe("unknown");
    expect(readabilityOf(null)).toBe("unknown");
  });
});
