import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  shouldAttemptBatchAcknowledgement,
  shouldRecordDeliveredLocal,
  useBatchAcknowledgement,
} from "./use-batch-acknowledgement";

// P4-S5a (Round 3) — ABC-JEV-INTEGRATION.md §1p.C.7: "the client
// acknowledges once, after the batch's cards have rendered (component
// effect after mount, not inside a Zustand `set` updater) AND
// document.visibilityState === 'visible' (a background-restored tab waits
// for visibilitychange) — no per-card viewport tracking."
//
// This repo has no @testing-library/react and no test anywhere mounts a
// live React effect or simulates an interaction (see
// src/components/reader/private-pdf-status.test.tsx's own note on this).
// The hook's actual decision logic is therefore extracted into this pure,
// exported predicate so it can be tested against the full truth table
// below without a DOM; the hook itself (use-batch-acknowledgement.ts) is a
// thin `useEffect` wrapper that calls this same predicate, plus the
// store's own `acknowledgePendingBatch` (tested directly, headlessly, in
// feed.test.ts's "P4-S5a: acknowledgePendingBatch" block — the response-
// code matrix, the "acknowledges once"/dedupe guarantee, and "retried
// before the next load" all live and are proven there, not here).
//
// P4-S5a-FIX (Round 3) — F-A-P4S5-01
// (docs/jev-abc/P4-S5a-S3FIX-A-20260924T062754Z.md): the predicate used to
// take a bare `hasPendingAck: boolean` — "is *something* pending" — with no
// way to tell whether the pending batch is the one whose cards are actually
// on screen. It now takes the two batch ids themselves (`pendingBatchId`,
// `renderedBatchId` — the latter read by the hook straight from the store,
// the same way it already reads `pendingBatchAck`) and only fires when they
// match. See the new "does not fire" cases below for the exact reproduction
// A demonstrated against the real code (a stale pending ack for a batch
// that was never part of the current render).
describe("shouldAttemptBatchAcknowledgement", () => {
  it("fires only when cards are rendered, the pending batch IS the rendered batch, and the tab is confirmed visible", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: "batch-1",
        renderedBatchId: "batch-1",
        visibilityState: "visible",
      }),
    ).toBe(true);
  });

  it("does not fire before the batch's cards have rendered", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: false,
        pendingBatchId: "batch-1",
        renderedBatchId: "batch-1",
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("does not fire when there is nothing pending to acknowledge", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: null,
        renderedBatchId: "batch-1",
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("does not fire while the tab is hidden — a background-restored tab waits for visibilitychange", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: "batch-1",
        renderedBatchId: "batch-1",
        visibilityState: "hidden",
      }),
    ).toBe(false);
  });

  it("does not fire when visibility cannot be confirmed at all (no document, e.g. during SSR)", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: "batch-1",
        renderedBatchId: "batch-1",
        visibilityState: undefined,
      }),
    ).toBe(false);
  });

  it("requires every condition together — rendered+pending alone, or pending+visible alone, is not enough", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: null,
        renderedBatchId: null,
        visibilityState: "hidden",
      }),
    ).toBe(false);
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: false,
        pendingBatchId: "batch-1",
        renderedBatchId: "batch-1",
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  // P4-S5a-FIX (Round 3) — F-A-P4S5-01, the headline finding this slice
  // closes. Direct reproduction of A's REPRO 1
  // (docs/jev-abc/P4-S5a-S3FIX-A-20260924T062754Z.md EVIDENCE 2): a batch
  // "batch-X-never-in-this-response" is still pending acknowledgment, but a
  // batchless response (flag off, signed out, or a legacy response) just
  // replaced `papers` with something unrelated, so `renderedBatchId` is
  // `null`. Cards ARE rendered (the unrelated ones) and the tab IS visible —
  // exactly the values `page.tsx`/the hook compute right now — yet the
  // predicate must refuse to fire, because the pending batch's own cards are
  // not what is on screen.
  it("does not fire when the pending batch is not the one currently rendered, even with cards rendered and the tab visible (F-A-P4S5-01)", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: "batch-X-never-in-this-response",
        renderedBatchId: null,
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  // Same defect, but proving it is a genuine ID comparison and not merely a
  // special case of "renderedBatchId happens to be null": a pending batch
  // and a rendered batch that are both non-null, both real ids, but
  // DIFFERENT batches, must not fire either.
  it("does not fire when the pending batch and the rendered batch are two different real batches (F-A-P4S5-01)", () => {
    expect(
      shouldAttemptBatchAcknowledgement({
        cardsRendered: true,
        pendingBatchId: "batch-X-older-still-pending",
        renderedBatchId: "batch-Y-currently-shown",
        visibilityState: "visible",
      }),
    ).toBe(false);
  });
});

// P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1 + this slice's manager refinement:
// the device-local "delivered" memory for a batchless response reuses the
// exact same render+visibility signal as shouldAttemptBatchAcknowledgement
// above, tested the same pure, no-DOM way for the same reason (see that
// describe block's own header comment).
describe("shouldRecordDeliveredLocal", () => {
  // P4-S5b-FIX (Round 3): pendingLocalDelivery now carries { ownerKey, ids }
  // instead of a bare array (closing docs/jev-abc/P4-S5b-A-20260924T095305Z.md
  // finding (b) — see feed.ts's FeedState doc comment on the field for why).
  // Every case below is rewritten to the new shape; the predicate's actual
  // behaviour (fires on ids.length > 0, regardless of which owner) is
  // unchanged, which owner it is plays no role in this predicate.
  it("fires when cards are rendered, something is pending, and the tab is confirmed visible", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-1"] },
        visibilityState: "visible",
      }),
    ).toBe(true);
  });

  it("does not fire before the cards have rendered", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: false,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-1"] },
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("does not fire when there is nothing pending to record", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: null,
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("does not fire when pendingLocalDelivery has an empty ids array", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: [] },
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("does not fire while the tab is hidden — a background-restored tab waits for visibilitychange", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-1"] },
        visibilityState: "hidden",
      }),
    ).toBe(false);
  });

  it("does not fire when visibility cannot be confirmed at all (no document, e.g. during SSR)", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-1"] },
        visibilityState: undefined,
      }),
    ).toBe(false);
  });

  it("requires every condition together — rendered+pending alone, or pending+visible alone, is not enough", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: null,
        visibilityState: "hidden",
      }),
    ).toBe(false);
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: false,
        pendingLocalDelivery: { ownerKey: "anonymous", ids: ["paper-1"] },
        visibilityState: "visible",
      }),
    ).toBe(false);
  });

  it("fires the same way regardless of which owner the pending delivery belongs to — this predicate does not inspect ownerKey", () => {
    expect(
      shouldRecordDeliveredLocal({
        cardsRendered: true,
        pendingLocalDelivery: { ownerKey: "user-a", ids: ["paper-1"] },
        visibilityState: "visible",
      }),
    ).toBe(true);
  });
});

describe("useBatchAcknowledgement — SSR safety", () => {
  // renderToStaticMarkup never runs effects (React server rendering skips
  // them entirely), so this proves only that the hook doesn't throw and
  // touches no browser-only global outside an effect — not its mount/
  // visibility wiring, which needs a real browser (recorded as REMAINING
  // in this slice's checkpoint). P4-S5b's two additional effects live
  // inside this same hook and are exercised by these same two tests for
  // the same reason — no separate SSR test needed for them.
  function Host({ cardsRendered }: { cardsRendered: boolean }) {
    useBatchAcknowledgement(cardsRendered);
    return null;
  }

  it("renders to nothing without throwing when cards have not rendered yet", () => {
    expect(() =>
      renderToStaticMarkup(createElement(Host, { cardsRendered: false })),
    ).not.toThrow();
  });

  it("renders to nothing without throwing once cards are rendered", () => {
    expect(() =>
      renderToStaticMarkup(createElement(Host, { cardsRendered: true })),
    ).not.toThrow();
  });
});
