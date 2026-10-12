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

// P9-23 (A P9-W2's N5): the two actions were 184 × 16 and 57 × 16 px on a phone, 16 px apart — small enough that a
// thumb on one lands on the other. Where there is no hover (`hover:none`) each takes the shell's touch rule
// (`[@media(hover:none)]:min-h-11`, the class notes-button.tsx and reader-tabs.tsx carry) with at least 8 px between
// them when the row wraps; with a mouse the size is unchanged. They stay two buttons with the same names.
// Layout is not computed in this node environment; the boxes are measured in the checkpoint
// (docs/reading-helper-abc/P9-23-C-*.md) and this file pins the classes that make them.
describe("PrivatePdfStatus — the two actions are touch targets under hover:none (P9-23, N5)", () => {
  const markup = () => renderToStaticMarkup(createElement(PrivatePdfStatus, { upload, onDeleted: () => {} }));
  const buttons = () => markup().match(/<button\b[^>]*>/g) ?? [];
  const classes = (tag: string) => (/\bclass="([^"]*)"/.exec(tag)?.[1] ?? "").split(/\s+/).filter(Boolean);

  it("are still two buttons, 'Forget what Peer learned from this' then 'Delete PDF'", () => {
    const html = markup();
    const found = [...html.matchAll(/<button\b[^>]*>([^<]*)<\/button>/g)].map((m) => m[1]);

    expect(found).toEqual(["Forget what Peer learned from this", "Delete PDF"]);
    for (const tag of buttons()) expect(tag).toContain('type="button"');
  });

  it("makes both at least 44 px tall where there is no hover", () => {
    const tags = buttons();

    expect(tags).toHaveLength(2);
    for (const tag of tags) expect(classes(tag)).toContain("[@media(hover:none)]:min-h-11");
  });

  it("keeps 8 px between them where there is no hover, also when the row wraps", () => {
    const row = /<div class="([^"]*flex-wrap[^"]*)"/.exec(markup())?.[1].split(/\s+/) ?? [];

    // The row was `gap-x-4 gap-y-1`: 16 px across, 4 px down when it wraps.
    expect(row).toContain("gap-x-4");
    expect(row).toContain("[@media(hover:none)]:gap-y-2");
  });

  it("leaves the mouse's boxes alone: the same underlined text, no touch height outside hover:none", () => {
    const row = /<div class="([^"]*flex-wrap[^"]*)"/.exec(markup())?.[1].split(/\s+/) ?? [];

    expect(row).toContain("gap-y-1");
    for (const tag of buttons()) {
      const cls = classes(tag);
      expect(cls).toContain("underline");
      expect(cls).toContain("underline-offset-4");
      // The 44 px floor stays behind the media query; a bare min-h-11 would grow the mouse's buttons too.
      expect(cls).not.toContain("min-h-11");
    }
  });
});
