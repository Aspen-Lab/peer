import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  availabilityFromResponse,
  uploadsReady,
  useUploadsAvailable,
  type UploadsAvailability,
} from "./use-uploads-available";

// UPLOAD-404 (§1bi.2): this repo has no @testing-library/react and no test
// anywhere mounts a live React effect (see private-pdf-status.test.tsx's own
// note, and use-batch-acknowledgement.test.ts's SSR-safety block, which this
// file follows). The two decisions that matter — what the fetch outcome
// means, and whether a call site should render its upload button for a
// given state — are both pure, exported predicates, tested exhaustively
// below with no rendering at all. The hook itself only gets an SSR-safety
// smoke test: `renderToStaticMarkup` never runs effects, so it proves the
// hook doesn't throw and starts at "unknown", not that the real fetch works.

describe("uploadsReady", () => {
  it("is true only once the server has confirmed uploads are available", () => {
    expect(uploadsReady("available")).toBe(true);
  });

  it("is false while the check is still unresolved — an entry point must not flash on and then disappear", () => {
    expect(uploadsReady("unknown")).toBe(false);
  });

  it("is false once the server has confirmed uploads are unavailable", () => {
    expect(uploadsReady("unavailable")).toBe(false);
  });
});

describe("availabilityFromResponse", () => {
  it("is available only for a 2xx response with an explicit enabled: true", () => {
    expect(availabilityFromResponse(true, { enabled: true })).toBe("available");
  });

  it("is unavailable for a 2xx response with enabled: false", () => {
    expect(availabilityFromResponse(true, { enabled: false })).toBe("unavailable");
  });

  it("is unavailable for a non-2xx response, even with a truthy body", () => {
    expect(availabilityFromResponse(false, { enabled: true })).toBe("unavailable");
  });

  it("is unavailable when the body has no enabled field, or no body at all — never assumed available", () => {
    expect(availabilityFromResponse(true, {})).toBe("unavailable");
    expect(availabilityFromResponse(true, null)).toBe("unavailable");
  });
});

describe("useUploadsAvailable — SSR safety", () => {
  // The state is rendered into the output itself (a text node), never
  // captured into an outer variable during render — that pattern trips this
  // repo's react-hooks purity lint (reassigning an external binding while
  // rendering is a side effect).
  function Host({ enabled }: { enabled?: boolean }) {
    const state: UploadsAvailability = useUploadsAvailable(enabled);
    return createElement("span", null, state);
  }

  it("renders to nothing without throwing, starting at 'unknown' (no live effect under renderToStaticMarkup)", () => {
    let html = "";
    expect(() => {
      html = renderToStaticMarkup(createElement(Host, {}));
    }).not.toThrow();
    expect(html).toContain("unknown");
  });

  it("also starts at 'unknown' when explicitly disabled (an upload's own page)", () => {
    const html = renderToStaticMarkup(createElement(Host, { enabled: false }));
    expect(html).toContain("unknown");
  });
});
