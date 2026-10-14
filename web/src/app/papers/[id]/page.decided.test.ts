import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Paper } from "@/types";

// P10-49 (BACKLOG-94, its first part; rule 2). `Reader` cannot be mounted in this Node-only suite
// (no jsdom, no component harness: see page.test.tsx), so the decided-read observer is the exported
// `watchForDecision`, run headlessly here with a fake IntersectionObserver and a fake clock, against
// the REAL feed store and a stubbed `fetch`: what a page does when the reading arrives and the
// observer is attached again. The page's own effect is held to its one join by reading its source,
// the way page.plain.test.ts does.
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), back: vi.fn(), replace: vi.fn() }),
}));

import { useFeedStore } from "@/store/feed";
import { useSyncGate } from "@/components/profile-sync";
import { useFeedSyncStatus } from "@/lib/feed/sync-status";
import { watchForDecision } from "./page";

const paper: Paper = {
  id: "openalex:W-decided",
  title: "A paper that is decided once",
  authors: ["Researcher"],
  relevanceReason: "Matches.",
  venue: "Example Journal",
  source: "other",
  summaryIntro: "Intro.",
  summaryExperimentKeywords: [],
  summaryResultDiscussion: "Result.",
  isSaved: false,
};

interface FakeObserver {
  callback: (entries: Array<{ intersectionRatio: number }>) => void;
  observed: unknown[];
  disconnected: boolean;
}
let observers: FakeObserver[] = [];
let fetchMock: ReturnType<typeof vi.fn>;

function readPosts(): number {
  return fetchMock.mock.calls.filter(
    (c) =>
      String(c[0]).split("?")[0] === "/api/read" &&
      (c[1] as RequestInit | undefined)?.method === "POST",
  ).length;
}
const isRead = () => Boolean(useFeedStore.getState().readItems[paper.id]);
/** The page's own wiring of the observer (see the source check below). */
function attach(el: unknown = {}) {
  const decide = () => useFeedStore.getState().markRead(paper.id, paper);
  return watchForDecision(el as Element, decide, () => isRead());
}
/** The block is 70% on screen. */
function see(o: FakeObserver) {
  o.callback([{ intersectionRatio: 0.7 }]);
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(0);
}

beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  class FakeIntersectionObserver {
    entry: FakeObserver;
    constructor(callback: FakeObserver["callback"]) {
      this.entry = { callback, observed: [], disconnected: false };
      observers.push(this.entry);
    }
    observe(el: unknown) {
      this.entry.observed.push(el);
    }
    disconnect() {
      this.entry.disconnected = true;
    }
  }
  vi.stubGlobal("IntersectionObserver", FakeIntersectionObserver);
  vi.stubGlobal("window", {
    setTimeout: (fn: () => void, ms: number) => globalThis.setTimeout(fn, ms),
    clearTimeout: (id: number) => globalThis.clearTimeout(id),
    matchMedia: () => ({ matches: false }),
  });
  fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
  useSyncGate.setState({ settled: true, authUserId: "user-decided", authOutcome: "signed-in" });
  useFeedSyncStatus.setState({ pendingKeys: {}, pushFailed: false });
  useFeedStore.setState({ readItems: {}, readAt: {}, library: {}, papers: [paper], savedPapers: [] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  useSyncGate.setState({ settled: true, authUserId: null, authOutcome: "signed-out" });
});

describe("the decided-read observer (P10-49)", () => {
  it("calls decide once the block has been 60% on screen for a second, not before, and not if it left", async () => {
    attach();
    expect(observers).toHaveLength(1);
    see(observers[0]);
    await vi.advanceTimersByTimeAsync(999);
    expect(isRead()).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(isRead()).toBe(true);

    useFeedStore.setState({ readItems: {}, readAt: {}, library: {} });
    const second = attach();
    see(observers[1]);
    await vi.advanceTimersByTimeAsync(500);
    observers[1].callback([{ intersectionRatio: 0.2 }]);
    await vi.advanceTimersByTimeAsync(2000);
    expect(isRead()).toBe(false);
    second();
    expect(observers[1].disconnected).toBe(true);
  });

  it("is not armed for a paper already decided: no observer, and nothing to clean up", async () => {
    useFeedStore.getState().markRead(paper.id, paper);
    await settle();
    expect(readPosts()).toBe(1);

    const stop = attach();
    expect(observers).toHaveLength(0);
    expect(() => stop()).not.toThrow();
    await vi.advanceTimersByTimeAsync(5000);
    expect(readPosts()).toBe(1);
  });

  it("a paper decided by the observer, then re-attached when the reading arrives, sends one post", async () => {
    const first = attach();
    see(observers[0]);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(readPosts()).toBe(1);

    // The reading arrives; the page's effect cleans up and attaches again.
    first();
    const again = attach();
    expect(observers).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(5000);
    again();
    expect(readPosts()).toBe(1);
  });

  it("an attach that was armed before the paper was decided sends no second post when its timer ends", async () => {
    // The reading arrived, the observer re-armed for a paper still unread, and a key decided it
    // inside the second: the observer's own decision is the second one and posts nothing.
    attach();
    see(observers[0]);
    useFeedStore.getState().markRead(paper.id, paper);
    await settle();
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(isRead()).toBe(true);
    expect(readPosts()).toBe(1);
  });

  it("a paper the reader un-reads is watched again by the next attach, and its read posts again", async () => {
    useFeedStore.getState().markRead(paper.id, paper);
    await settle();
    useFeedStore.getState().markUnread(paper.id);
    await settle();
    expect(isRead()).toBe(false);

    attach();
    expect(observers).toHaveLength(1);
    see(observers[0]);
    await vi.advanceTimersByTimeAsync(1000);
    await settle();
    expect(isRead()).toBe(true);
    expect(readPosts()).toBe(2);
  });
});

describe("the page's effect (P10-49)", () => {
  it("hands the observer the store's own answer to \"is this paper read\", and builds no observer of its own", () => {
    const source = readFileSync(resolve(__dirname, "page.tsx"), "utf8").replace(/\s+/g, " ");
    expect(source).toContain(
      "return watchForDecision(el, decide, () => Boolean(useFeedStore.getState().readItems[paper.id]));",
    );
    // The one observer for the decision is `watchForDecision`'s; the effect no longer builds one.
    const effect = /useEffect\(\(\) => \{ const el = \(hasBody.*?\}, \[decide[^\]]*\]\);/.exec(source)?.[0] ?? "";
    expect(effect).not.toBe("");
    expect(effect).not.toContain("new IntersectionObserver");
    expect(effect).toContain("paper.id");
  });
});
