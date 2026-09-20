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

// 9-31 (A9-09): the supplement-attach flow's own status line, shown by the
// same shared component (this is the reader page's `uploadStatus`, not a
// separate one).
describe("PrivatePdfStatus — 'Attached to' status line (9-31)", () => {
  it("shows 'Attached to: <title>' when supplementing a foreign paper", () => {
    const html = renderToStaticMarkup(
      createElement(PrivatePdfStatus, {
        upload, onDeleted: () => {}, attachedToTitle: "Solid Electrolytes for Lithium Metal Batteries",
      }),
    );
    expect(html).toContain("Attached to: Solid Electrolytes for Lithium Metal Batteries");
  });

  it("omits the line for a standalone upload (nothing to be 'attached to')", () => {
    const html = renderToStaticMarkup(
      createElement(PrivatePdfStatus, { upload, onDeleted: () => {} }),
    );
    expect(html).not.toContain("Attached to:");
  });
});
