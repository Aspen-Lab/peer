"use client";

// P11-14 rule 5 (B P11-02 §3.2 C P11-02b, D3; B P10-01's step 5): a local error boundary round the explain box. A throw in the box —
// the owner's "Maximum update depth exceeded" was one — used to reach the route's boundary (`app/papers/[id]/error.tsx`) and replace
// the WHOLE reader page with "This paper's page hit a snag." Now it stops here: the box and its card go, one quiet line says Explain
// is unavailable and that the paper is not, and the paper's text, the sticky notes, the notes window and every Tier 0 control stay
// as they are (product direction: Tier 0 must remain useful whatever a model-fed surface does).
//
// It asks nothing of the network or a model, takes no key, and writes nothing but the console. It also takes the explain card out of
// the margin's stack, so no header is left standing for a box that is gone. The page keys it by paper (`key={paper.id}`), so the next
// paper starts with a working box.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { EXPLAIN_WINDOW_ID, useWindows } from "@/lib/reader/windows";

/** The one line the reader sees in the box's place. */
export const EXPLAIN_UNAVAILABLE_LINE = "Explain is unavailable. The paper is unaffected.";

interface State {
  failed: boolean;
}

export class ExplainBoundary extends Component<{ children?: ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(error: unknown): State {
    void error;
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    useWindows.getState().close(EXPLAIN_WINDOW_ID);
    console.error("The explain box threw; the paper page is unaffected.", error, info.componentStack);
  }

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <p
        role="status"
        data-explain-unavailable=""
        className="annotation fixed bottom-10 right-4 z-[70] max-w-[min(360px,calc(100vw-2rem))] border border-border bg-surface px-3 py-2 text-text-faint"
      >
        {EXPLAIN_UNAVAILABLE_LINE}
      </p>
    );
  }
}
