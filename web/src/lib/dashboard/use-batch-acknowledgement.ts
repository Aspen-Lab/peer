"use client";

// P4-S5a — fires the batch acknowledgment POST once the day's cards have
// actually rendered and the tab is visible (ABC-JEV-INTEGRATION.md §1p.C.7:
// "the client acknowledges once, after the batch's cards have rendered...
// (component effect after mount, not inside a Zustand `set` updater) AND
// document.visibilityState === 'visible' (a background-restored tab waits
// for visibilitychange)... no per-card viewport tracking").
//
// `cardsRendered` is the caller's own signal that SOME batch's cards are
// actually in the committed render — page.tsx passes `papers.length > 0`,
// the exact same condition that already gates rendering the cards grid.
// This hook never inspects card content, count, or scroll position itself.
// WHICH batch those cards belong to is a separate question, answered by
// `renderedBatchId`, read straight from the store below (the same pattern
// already used for `pendingBatchAck`) — see P4-S5a-FIX.
//
// P4-S5a-FIX (Round 3) — F-A-P4S5-01
// (docs/jev-abc/P4-S5a-S3FIX-A-20260924T062754Z.md): `cardsRendered` alone
// cannot tell "the pending batch's own cards are rendered" apart from "some
// cards are rendered, and something unrelated happens to be pending" — a
// response with no `batchId` at all (flag off, signed out, or a legacy
// response) replaces `papers` while leaving a stale `pendingBatchAck` for a
// DIFFERENT batch untouched, and the old boolean-only predicate could not
// see the mismatch. The predicate now compares the two batch ids directly.
//
// The decision of whether to fire right now is the exported
// `shouldAttemptBatchAcknowledgement` predicate below — a pure function,
// unit-tested directly in use-batch-acknowledgement.test.ts. This repo has
// no @testing-library/react and no test anywhere mounts a live effect (see
// src/components/reader/private-pdf-status.test.tsx's own note), so the
// hook's real decision logic lives in something testable without a DOM, and
// this file stays a thin effect wrapper with nothing left in it that needs
// its own state-machine test.
//
// The actual network call and the "acknowledges once" guarantee live in the
// store (`acknowledgePendingBatch`, web/src/store/feed.ts): an in-flight
// dedupe there — not here — is what stops two overlapping POSTs when this
// hook's mount effect and loadFeed's own retry-before-load step race.
// `acknowledgePendingBatch` ALSO independently re-checks the same batch-id
// match (its own doc comment explains why: it is the one place that ever
// performs the POST, so checking there protects loadFeed's reconcile step
// too, not just this hook) — the predicate here and that check are
// deliberate defense in depth, not a single point of trust. On failure,
// `acknowledgePendingBatch` either keeps `pendingBatchAck` set (401/503/
// network error) or clears it (200/400/404) — this hook does not need to
// know which; it just re-attempts whenever its own two triggers
// (cardsRendered/pendingBatchAck/renderedBatchId changing, or a
// hidden->visible transition) fire again while something is still pending.

import { useEffect } from "react";
import { useFeedStore } from "@/store/feed";

export function shouldAttemptBatchAcknowledgement(input: {
  cardsRendered: boolean;
  pendingBatchId: string | null;
  renderedBatchId: string | null;
  visibilityState: DocumentVisibilityState | undefined;
}): boolean {
  return (
    input.cardsRendered &&
    input.pendingBatchId !== null &&
    input.pendingBatchId === input.renderedBatchId &&
    input.visibilityState === "visible"
  );
}

// P4-S5b — ABC-JEV-INTEGRATION.md §1p.C.1 + this slice's manager refinement:
// the device-local "delivered" memory for a batchless response (no server
// batch/ledger involved at all) reuses the exact same render + visibility
// signal as the predicate above, but has nothing to compare ids against —
// `pendingLocalDelivery` (armed by the store, see feed.ts's papersLane) IS
// already the exact set to record, unconditionally, once it's non-empty and
// the cards are confirmed rendered and visible.
//
// P4-S5b-FIX (Round 3) — ABC-JEV-INTEGRATION.md §1c, closing
// docs/jev-abc/P4-S5b-A-20260924T095305Z.md finding (b): `pendingLocalDelivery`
// now carries `{ ownerKey, ids }` instead of a bare array (the owner this
// render's ids belong to, captured at arm time — see feed.ts's FeedState doc
// comment for why). This predicate only cares about `ids.length`; which
// owner it is plays no role in WHETHER to fire, only in which namespace
// `recordPendingLocalDelivery` (called by the hook below, unchanged) ends up
// writing into.
export function shouldRecordDeliveredLocal(input: {
  cardsRendered: boolean;
  pendingLocalDelivery: { ownerKey: string; ids: string[] } | null;
  visibilityState: DocumentVisibilityState | undefined;
}): boolean {
  return (
    input.cardsRendered &&
    (input.pendingLocalDelivery?.ids.length ?? 0) > 0 &&
    input.visibilityState === "visible"
  );
}

function currentVisibilityState(): DocumentVisibilityState | undefined {
  return typeof document === "undefined" ? undefined : document.visibilityState;
}

export function useBatchAcknowledgement(cardsRendered: boolean): void {
  const pendingBatchAck = useFeedStore((s) => s.pendingBatchAck);
  // P4-S5a-FIX (Round 3) — F-A-P4S5-01: read the same way pendingBatchAck
  // already is, so the predicate below can compare the two ids directly.
  const renderedBatchId = useFeedStore((s) => s.renderedBatchId);
  const acknowledgePendingBatch = useFeedStore((s) => s.acknowledgePendingBatch);
  // P4-S5b — the batchless counterpart of pendingBatchAck/renderedBatchId
  // above; see feed.ts's FeedState doc comments for both fields.
  const pendingLocalDelivery = useFeedStore((s) => s.pendingLocalDelivery);
  const recordPendingLocalDelivery = useFeedStore(
    (s) => s.recordPendingLocalDelivery,
  );

  // The mount/render trigger. Re-runs only when `cardsRendered`,
  // `pendingBatchAck`, or `renderedBatchId` actually change —
  // `pendingBatchAck`/`renderedBatchId` only change reference on a genuine
  // state transition (a new batch appearing, or one clearing), never merely
  // because the page re-rendered for an unrelated reason — so this does not
  // re-fire on every render while a 401/503 keeps the same pending entry
  // outstanding. A hidden tab is left for the visibilitychange effect below.
  useEffect(() => {
    if (
      shouldAttemptBatchAcknowledgement({
        cardsRendered,
        pendingBatchId: pendingBatchAck?.batchId ?? null,
        renderedBatchId,
        visibilityState: currentVisibilityState(),
      })
    ) {
      void acknowledgePendingBatch();
    }
  }, [cardsRendered, pendingBatchAck, renderedBatchId, acknowledgePendingBatch]);

  // A background-restored tab: retry on the hidden->visible transition.
  // Reads fresh state at event time (not a closed-over value) since this
  // listener is attached once per `cardsRendered` value and may fire long
  // after the render that registered it.
  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      const state = useFeedStore.getState();
      if (
        shouldAttemptBatchAcknowledgement({
          cardsRendered,
          pendingBatchId: state.pendingBatchAck?.batchId ?? null,
          renderedBatchId: state.renderedBatchId,
          visibilityState: currentVisibilityState(),
        })
      ) {
        void state.acknowledgePendingBatch();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [cardsRendered]);

  // P4-S5b — the batchless counterpart of the two effects above, same
  // mount/visibility triggers, writing to the device-local memory instead of
  // POSTing to the server. Kept as its own pair of effects (not merged into
  // the ones above) so each concern's dependency array and trigger reasoning
  // stays independently readable.
  useEffect(() => {
    if (
      shouldRecordDeliveredLocal({
        cardsRendered,
        pendingLocalDelivery,
        visibilityState: currentVisibilityState(),
      })
    ) {
      recordPendingLocalDelivery();
    }
  }, [cardsRendered, pendingLocalDelivery, recordPendingLocalDelivery]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    const onVisibilityChange = () => {
      const state = useFeedStore.getState();
      if (
        shouldRecordDeliveredLocal({
          cardsRendered,
          pendingLocalDelivery: state.pendingLocalDelivery,
          visibilityState: currentVisibilityState(),
        })
      ) {
        state.recordPendingLocalDelivery();
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [cardsRendered]);
}
