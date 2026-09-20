import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Paper } from "@/types";
import { PrivatePdfStatus } from "./private-pdf-status";

// 9-24 (A9-12): the profile's uploads list (and the reader page's own
// upload status line, which shares this component) gets two distinct
// actions — "Forget what Peer learned from this" (ledger only) separate
// from "Delete PDF" (the file). This repo has no @testing-library/react and
// no test anywhere simulates a click (matching figure-lightbox.test.ts's
// own note), so this is a static-markup smoke test of the two buttons'
// presence/labels, not their click behavior.

const upload: Paper = {
  id: "upload:aaaa000000000000",
  title: "A private upload",
  authors: [],
  relevanceReason: "",
  venue: "",
  source: "other",
  summaryIntro: "",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "",
  isSaved: false,
  uploadDocumentKey: "a".repeat(64),
};

describe("PrivatePdfStatus — two distinct actions (9-24)", () => {
  it("shows a ledger-only 'forget' action separate from deleting the PDF", () => {
    const html = renderToStaticMarkup(
      createElement(PrivatePdfStatus, { upload, onDeleted: () => {} }),
    );
    expect(html).toContain("Forget what Peer learned from this");
    expect(html).toContain("Delete PDF");
    // The old combined wording must not linger alongside the split actions.
    expect(html).not.toContain("Delete PDF and its learned signals");
  });

  it("omits the forget action when the upload has no ledger evidence key", () => {
    const html = renderToStaticMarkup(
      createElement(PrivatePdfStatus, {
        upload: { ...upload, uploadDocumentKey: undefined },
        onDeleted: () => {},
      }),
    );
    expect(html).not.toContain("Forget what Peer learned from this");
    expect(html).toContain("Delete PDF");
  });
});
