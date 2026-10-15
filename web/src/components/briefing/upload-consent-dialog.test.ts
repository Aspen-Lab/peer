import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { UploadConsentDialog } from "./upload-consent-dialog";

// P7-12 (R1): the owner asked for the "Having subscription access alone may
// not grant these permissions." sentence to go from the consent checkbox —
// Peer has no subscriptions, so the caveat spoke of something the reader
// never meets. The checkbox now reads the one sentence it asks the reader to
// agree to. Nothing new is asked, so UPLOAD_RIGHTS_VERSION is not bumped.

const NOOP = () => {};

function render(): string {
  return renderToStaticMarkup(
    createElement(UploadConsentDialog, {
      file: new File(["%PDF-1.4"], "paper.pdf", { type: "application/pdf" }),
      onAccept: NOOP,
      onCancel: NOOP,
    }),
  );
}

function consentLabel(markup: string): string {
  const match = /<label\b[^>]*>([\s\S]*?)<\/label>/.exec(markup);
  expect(match, "the dialog renders its consent checkbox inside a <label>").not.toBeNull();
  return (match?.[1] ?? "").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

describe("the upload consent label (P7-12, R1)", () => {
  it("reads the one authorization sentence and does not mention a subscription", () => {
    const label = consentLabel(render());
    expect(label).toBe("I am authorized to upload, store and process this article in Peer, including with my AI provider.");
    expect(label).not.toMatch(/subscription/i);
  });

  it("the dialog says nothing about a subscription anywhere", () => {
    expect(render()).not.toMatch(/subscription/i);
  });

  it("the doc's quote of the consent screen drops the sentence too (the doc is kept in step with the dialog)", () => {
    const doc = readFileSync(new URL("../../../../docs/PRIVATE_PDF_UPLOADS.md", import.meta.url), "utf8");
    const start = doc.indexOf("## What the consent screen asserts");
    const end = doc.indexOf("\n## ", start + 1);
    expect(start).toBeGreaterThanOrEqual(0);
    const section = doc.slice(start, end === -1 ? undefined : end);
    expect(section).toContain("I am authorized to upload, store and process this article in Peer, including with my AI");
    expect(section).not.toMatch(/subscription/i);
  });
});
