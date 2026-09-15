import { describe, expect, it } from "vitest";
import { looksLikePdf } from "./upload-button";

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
