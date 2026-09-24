import { describe, expect, it } from "vitest";
import { isOverUploadCap, looksLikePdf } from "./upload-button";

describe("looksLikePdf", () => {
  it("accepts a file whose browser-reported type is application/pdf", () => {
    expect(looksLikePdf({ type: "application/pdf", name: "anything" })).toBe(true);
  });

  it("accepts a file with no reported type but a .pdf name (some OSes/browsers omit type)", () => {
    expect(looksLikePdf({ type: "", name: "My Paper.PDF" })).toBe(true);
  });

  it("rejects a file that is neither typed nor named as a PDF", () => {
    expect(looksLikePdf({ type: "image/png", name: "figure.png" })).toBe(false);
    expect(looksLikePdf({ type: "", name: "notes.txt" })).toBe(false);
  });
});

// 5-03: the client-side refusal before any request is sent — mirrors the
// server's own MAX_UPLOAD_BYTES gate (route.ts, item 5-02) so an obviously
// oversized file never makes a round trip.
describe("isOverUploadCap", () => {
  it("accepts a file at exactly the 25 MB cap", () => {
    expect(isOverUploadCap({ size: 25 * 1024 * 1024 })).toBe(false);
  });

  it("rejects a file over the 25 MB cap", () => {
    expect(isOverUploadCap({ size: 25 * 1024 * 1024 + 1 })).toBe(true);
  });
});
