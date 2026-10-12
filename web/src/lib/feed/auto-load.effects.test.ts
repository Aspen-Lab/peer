// P8-01 (BACKLOG-29 = 22; ABC-DEEP-REPORT-READING-HELPER.md §1h.41 (a)): the
// home page's auto-load effect with its effects running, against the REAL feed
// store and a stubbed `fetch` that answers /api/feed with a 503.
//
// `app/page.tsx` itself cannot be rendered in this project's node test
// environment (see `app/page.test.tsx`: no DOM, and the page depends on the
// auth gate, batch acknowledgement, the digest loader and more). What the loop
// lived in is the page's auto-load effect, which is `useFeedAutoLoad` now; the
// page hands it the store's state exactly as `useHomePage` below does. So the
// count below is the effect and the store together, on `test-support/
// hook-runtime`, with `fetch` counted in a 500 ms window of fake time.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  const { hookRuntime } = await import("@/test-support/hook-runtime");
  return { ...actual, ...hookRuntime.hooks };
});

// The store is not persisted in this file (no localStorage in the node
// environment); only its state and actions are under test.
vi.mock("zustand/middleware", () => ({
  persist: (initializer: unknown) => initializer,
}));

import { useCallback, useEffect, useRef, useState } from "react";
import { hookRuntime } from "@/test-support/hook-runtime";
import { defaultProfile } from "@/types";
import { activePaperTopicsKey, useFeedStore } from "@/store/feed";
import { useProfileStore } from "@/store/profile";
import { useSyncGate } from "@/components/profile-sync";
import { useFeedAutoLoad } from "./auto-load";

interface Shown {
  topicsKey: string | null;
  failedKey: string | null;
  loading: boolean;
}

function shownOf(): Shown {
  const s = useFeedStore.getState();
  return { topicsKey: s.feedTopicsKey, failedKey: s.feedFailedKey, loading: s.isLoading };
}

/**
 * The page's own wiring of the effect, minus everything else the page does.
 *
 * React renders once per committed store change, and the effect reads what
 * that render showed. The hook runtime renders once per round and a round
 * outlasts a whole stubbed load, so it would show the effect only the first
 * and the last state and never `loading: true` in between, which is the state
 * the loop is made of. So this driver hands the hook one distinct store state
 * per render, in order, as the browser's renders do.
 */
function useHomePage() {
  const [, rerender] = useState(0);
  const unrendered = useRef<Shown[]>([]);
  const shown = useRef<Shown | null>(null);
  useEffect(() => {
    let last = shownOf();
    return useFeedStore.subscribe(() => {
      const next = shownOf();
      if (
        next.topicsKey === last.topicsKey &&
        next.failedKey === last.failedKey &&
        next.loading === last.loading
      ) {
        return;
      }
      last = next;
      unrendered.current.push(next);
      rerender((n) => n + 1);
    });
  }, []);
  if (!shown.current) shown.current = shownOf();
  else if (unrendered.current.length > 0) shown.current = unrendered.current.shift()!;
  if (unrendered.current.length > 0) rerender((n) => n + 1);
  const load = useCallback(() => {
    void useFeedStore.getState().loadFeed({ lanes: ["papers"] });
  }, []);
  useFeedAutoLoad({
    ready: true,
    autoLoadKey: activePaperTopicsKey(useProfileStore.getState().profile),
    topicsKey: shown.current.topicsKey,
    failedKey: shown.current.failedKey,
    loading: shown.current.loading,
    load,
  });
}

function setTopic(topic: string) {
  useProfileStore.setState({
    profile: {
      ...defaultProfile,
      researchTopics: [topic],
      activeSearchInputs: {
        papers: { required: [topic], explore: [] },
        locationPreferences: [],
        promotedOn: "2026-07-29",
      },
    },
  });
}

let feedCalls = 0;
let feedStatus = 503;

describe("the home page's auto-load against a failing /api/feed (P8-01)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    feedCalls = 0;
    feedStatus = 503;
    vi.stubGlobal("fetch", async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.pathname : input.url;
      if (url !== "/api/feed") return new Response("{}", { status: 404 });
      feedCalls += 1;
      return feedStatus === 200
        ? new Response(JSON.stringify({ items: [], meta: {} }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          })
        : new Response("{}", { status: feedStatus });
    });
    useSyncGate.setState({ settled: true, authUserId: null, authOutcome: "signed-out" });
    setTopic("materials");
    useFeedStore.setState({
      papers: [],
      isLoading: false,
      papersLoading: false,
      lastRefresh: null,
      feedTopicsKey: null,
      feedFailedKey: null,
      feedError: null,
      emptyReasonCode: null,
      pendingBatchAck: null,
      renderedBatchId: null,
      pendingLocalDelivery: null,
      recentlyShownIds: {},
      deliveredLocalByOwner: {},
      deliveredLocalOwnerOrder: [],
      paperFeedback: {},
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** One page open, then 500 ms of fake time for everything it starts. */
  async function openHome() {
    // A bound well above what one request needs: the loop, when there is one,
    // runs until it, as it ran until the tab closed.
    const opening = hookRuntime.mount(() => useHomePage(), { maxRounds: 60 });
    await vi.advanceTimersByTimeAsync(500);
    const opened = await opening;
    opened.unmount();
  }

  it("asks once for the key, then not again: a 503 is one request in a 500 ms window, not about 85 a second", async () => {
    await openHome();

    expect(feedCalls).toBe(1);
    const state = useFeedStore.getState();
    expect(state.feedError).toBeTruthy();
    expect(state.feedFailedKey).toBe(activePaperTopicsKey(useProfileStore.getState().profile));
    expect(state.feedTopicsKey).toBeNull();
    expect(state.isLoading).toBe(false);

    // Nothing else is scheduled: no timed retry sneaks in later.
    await vi.advanceTimersByTimeAsync(500);
    expect(feedCalls).toBe(1);
  });

  it("opening the page again with the same failed key does not ask again (the error state's Try again is the recovery)", async () => {
    await openHome();
    expect(feedCalls).toBe(1);

    await openHome();
    expect(feedCalls).toBe(1);
  });

  it("a manual Try again is one request per press, and a failure of it records the key again", async () => {
    await openHome();
    expect(feedCalls).toBe(1);

    // The error state's button calls loadFeed directly.
    await useFeedStore.getState().loadFeed({ lanes: ["papers"] });
    expect(feedCalls).toBe(2);
    expect(useFeedStore.getState().feedFailedKey).toBe(
      activePaperTopicsKey(useProfileStore.getState().profile),
    );

    // The page being open (mounted) does not turn the press into a loop.
    await openHome();
    expect(feedCalls).toBe(2);
  });

  it("a different key (the reader changed their topics) is asked for once", async () => {
    await openHome();
    expect(feedCalls).toBe(1);

    setTopic("catalysis");
    await openHome();
    expect(feedCalls).toBe(2);
    expect(useFeedStore.getState().feedFailedKey).toBe(
      activePaperTopicsKey(useProfileStore.getState().profile),
    );

    await openHome();
    expect(feedCalls).toBe(2);
  });

  it("a key that loads is asked for once and builds the page from it (as before)", async () => {
    feedStatus = 200;
    await openHome();

    expect(feedCalls).toBe(1);
    const state = useFeedStore.getState();
    expect(state.feedTopicsKey).toBe(activePaperTopicsKey(useProfileStore.getState().profile));
    expect(state.feedFailedKey).toBeNull();
    expect(state.feedError).toBeNull();

    await openHome();
    expect(feedCalls).toBe(1);
  });
});
