"use client";

// UPLOAD-404 (§1bi.2): whether this server can store a NEW private PDF at
// all right now — read from the server's own `hostedUploadsEnabled()`
// (upload-access.ts) via a tiny GET, never a `NEXT_PUBLIC_*` build-time flag
// that could disagree with it (a build-time value cannot see a runtime-only
// `PEER_UPLOADS_ENABLED`/`PEER_PRIVATE_UPLOAD_DIR`, and both this app's
// upload entry points are plain Client Components with no server-rendered
// props to carry the real value down instead).
//
// "unknown" is the value on every first render, server and client alike, so
// hydration always agrees. Every upload entry point in the product (the
// home page, a paper's own page) treats "unknown" the same as "unavailable"
// via `uploadsReady` below — nothing renders until the server has actually
// said yes, so a reader on a server with uploads off never sees the button
// flash on and then vanish a moment later. The accepted trade-off is the
// other direction: on a server where uploads ARE on, the button appears a
// beat after first paint instead of being there immediately — a normal
// progressive-enhancement delay, not a button that looks broken.
//
// A failed check (offline, a server error) fails the same closed way: no
// button, never one that would just answer 503.

import { useEffect, useState } from "react";

export type UploadsAvailability = "unknown" | "available" | "unavailable";

/**
 * The fetch outcome, reduced to the one bit this hook keeps — a pure map so
 * it is directly testable without running a live effect (this repo has no
 * @testing-library/react; `renderToStaticMarkup` never runs effects at all,
 * so the fetch itself cannot be exercised through a render). Anything short
 * of an explicit `enabled: true` fails closed, including a non-2xx response,
 * a response with no body, and a malformed one — never assume available.
 */
export function availabilityFromResponse(ok: boolean, data: { enabled?: boolean } | null): UploadsAvailability {
  return ok && data?.enabled === true ? "available" : "unavailable";
}

export function useUploadsAvailable(enabled = true): UploadsAvailability {
  const [state, setState] = useState<UploadsAvailability>("unknown");
  useEffect(() => {
    if (!enabled) return;
    const controller = new AbortController();
    fetch("/api/papers/upload-availability", { cache: "no-store", signal: controller.signal })
      .then(async (res) => {
        const data = await res.json().catch(() => null) as { enabled?: boolean } | null;
        if (!controller.signal.aborted) setState(availabilityFromResponse(res.ok, data));
      })
      .catch(() => {
        if (!controller.signal.aborted) setState(availabilityFromResponse(false, null));
      });
    return () => controller.abort();
  }, [enabled]);
  return state;
}

/** The one predicate every call site uses to decide whether to render an
 *  upload entry point — see the header comment above for why "unknown"
 *  reads as not-ready rather than as ready. */
export function uploadsReady(state: UploadsAvailability): boolean {
  return state === "available";
}
