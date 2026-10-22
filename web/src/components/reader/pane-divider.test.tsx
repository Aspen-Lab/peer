import { createElement, type RefObject } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PaneDivider, dragWidth, DRAG_THRESHOLD_PX } from "./pane-divider";

// P11-10 rule 2 (B P11-01 §2.6; ruling §1h.113 (a)): the separator between two panes — its markup (a `role="separator"` with the three
// aria values) and the pure arithmetic of a drag. The pointer and keyboard paths are in `pane-divider.flow.test.tsx`.

const target = { current: null } as RefObject<HTMLElement | null>;
const render = (over: Partial<Parameters<typeof PaneDivider>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(PaneDivider, {
      pane: "left",
      value: 320,
      room: { viewport: 1440, other: 360 },
      target,
      variable: "--left-pane-w",
      label: "Resize left panel",
      controls: "reader-left-pane",
      onCommit: () => {},
      ...over,
    }),
  );

describe("PaneDivider's markup", () => {
  it("is a focusable vertical separator with aria-valuemin, aria-valuemax and aria-valuenow, a name and the pane it controls", () => {
    const html = render();
    expect(html).toContain('role="separator"');
    expect(html).toContain('aria-orientation="vertical"');
    expect(html).toContain('aria-valuemin="240"');
    expect(html).toContain('aria-valuemax="480"');
    expect(html).toContain('aria-valuenow="320"');
    expect(html).toContain('aria-label="Resize left panel"');
    expect(html).toContain('aria-controls="reader-left-pane"');
    expect(html).toContain('tabindex="0"');
    expect(html).toContain('data-reader-divider="left"');
    expect(html).toContain("reader-divider");
  });

  it("the margin's separator reports the margin's range and width", () => {
    const html = render({ pane: "margin", value: 360, label: "Resize margin", controls: "reader-margin", room: { viewport: 1440, other: 320 } });
    expect(html).toContain('aria-valuemin="280"');
    expect(html).toContain('aria-valuemax="560"');
    expect(html).toContain('aria-valuenow="360"');
    expect(html).toContain('data-reader-divider="margin"');
  });

  it("the greatest value is what the window leaves the centre: at 1024 with a 280 margin, the left pane may reach 280", () => {
    const html = render({ value: 280, room: { viewport: 1024, other: 280 } });
    expect(html).toContain('aria-valuemin="240"');
    expect(html).toContain('aria-valuemax="280"');
  });

  it("has no children and no text: the line is drawn by CSS", () => {
    expect(render()).toMatch(/<div [^>]*><\/div>$/);
  });
});

describe("dragWidth — the width a drag has reached", () => {
  it("the left pane grows as the pointer goes right, the margin as it goes left", () => {
    expect(dragWidth("left", 320, 40, 1)).toBe(360);
    expect(dragWidth("left", 320, -40, 1)).toBe(280);
    expect(dragWidth("margin", 360, -40, 1)).toBe(400);
    expect(dragWidth("margin", 360, 40, 1)).toBe(320);
  });

  it("divides the pointer's distance by Fit's zoom: window px to layout px", () => {
    expect(dragWidth("left", 320, 100, 1.25)).toBe(400);
    expect(dragWidth("margin", 360, -150, 1.5)).toBe(460);
    // The same distance on the screen moves a zoomed pane less in layout px; a zoom it cannot read is no zoom.
    expect(dragWidth("left", 320, 60, 2)).toBe(350);
    expect(dragWidth("left", 320, 60, Number.NaN)).toBe(380);
    expect(dragWidth("left", 320, 60, 0)).toBe(380);
    expect(dragWidth("left", 320, 60, -1)).toBe(380);
  });

  it("is clamped to the pane's range and to what leaves the centre its minimum", () => {
    expect(dragWidth("left", 320, 900, 1)).toBe(480);
    expect(dragWidth("left", 320, -900, 1)).toBe(240);
    expect(dragWidth("margin", 360, -900, 1)).toBe(560);
    expect(dragWidth("margin", 360, 900, 1)).toBe(280);
    expect(dragWidth("left", 280, 900, 1, { viewport: 1024, other: 280 })).toBe(280);
  });

  it("keeps whole px", () => {
    expect(Number.isInteger(dragWidth("left", 320, 33, 1.37))).toBe(true);
  });

  it("the threshold is the lightbox's 4 px", () => {
    expect(DRAG_THRESHOLD_PX).toBe(4);
  });
});
