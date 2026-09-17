import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DecisionBlock } from "./decision-block";

// S21 (round 7, item 7-03): B recommended (not mandated) a
// renderToStaticMarkup smoke test of the icon row, the same shape
// app/profile/page.test.tsx's ColorThemePicker test already established
// (6-11) for an aria-pressed/label-swap assertion. Tried that shape here
// first and it does not work for this component, for a reason worth
// recording rather than silently working around: ColorThemePicker takes
// its value as a PROP, but DecisionBlock reads `fit` directly off
// `useReadingPrefsStore`. Confirmed by execution: zustand v5's default
// React hook (node_modules/zustand/esm/react.mjs) passes
// `() => selector(api.getInitialState())` as `useSyncExternalStore`'s
// SERVER snapshot — under `renderToStaticMarkup` this always reads the
// store's state as captured at module load, ignoring any `setState` call
// made before rendering (by design, so a real SSR pass can't mismatch a
// fresh client's first paint). A `useReadingPrefsStore.setState({fit:
// true})` immediately before rendering was confirmed (via
// `.getState().fit`) to update the live store, yet the rendered button
// still showed the store's original default — proving the store, not the
// component's own aria wiring, is what a test would need to control, and
// this framework path cannot control it. So this file only exercises the
// one state `renderToStaticMarkup` can reliably reach: the store's actual
// default (fit off) and `useSpread()`'s own hardcoded server snapshot
// (always `false` — reader-layout.tsx's own SSR-safe default, unrelated to
// viewport). The "fit on" / "spread on, enabled" paths need a real DOM —
// the manager's own Browser-pane check.

const NOOP = () => {};

function renderDecisionBlock() {
  return renderToStaticMarkup(
    createElement(DecisionBlock, {
      sentences: ["Read from the abstract."],
      stage: null,
      source: null,
      isSaved: false,
      showAddKey: false,
      onSave: NOOP,
      onSkip: NOOP,
      onCopy: NOOP,
      onOpen: NOOP,
      onCopyDoi: NOOP,
    }),
  );
}

function fitButton(html: string): string {
  const match = html.match(/<button[^>]*aria-label="(?:Fit to screen|Book layout)"[^>]*>/);
  if (!match) throw new Error(`Fit button not found in: ${html}`);
  return match[0];
}

describe("DecisionBlock — Fit button, default (server-snapshot) render", () => {
  it("shows 'Fit to screen', unpressed", () => {
    const button = fitButton(renderDecisionBlock());
    expect(button).toContain('aria-label="Fit to screen"');
    expect(button).toContain('aria-pressed="false"');
  });

  it("is disabled with an explanatory title — useSpread()'s server snapshot is always false", () => {
    const button = fitButton(renderDecisionBlock());
    expect(button).toContain('disabled=""');
    expect(button).toContain('title="Fit needs the two-column layout"');
  });
});
